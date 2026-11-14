/**
 * dsh-codex — 把重活外包给本机 Codex CLI。
 *
 * 设计取舍（重要）：
 *   主模型（我）的 token 花在「判断」上，Codex 的额度花在「算」上。
 *   所以这个插件只回传最终答复（-o 输出文件），不搬进程日志；
 *   代价是主上下文看不到中间过程，因此适合自包含任务。
 *
 * 已知环境事实：这台机器上 codex exec 每次冷启动要等约 2 分钟
 * （WebSocket 握手超时后才回退 HTTPS，且没有配置项能关）。
 * 所以 timeout 默认给到 900s，别按小活儿的心理预期去设。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { spawnSync } from 'node:child_process'
import {
  resolveCodexExe, listCodexCandidates, runCodex,
  DEFAULT_MODEL, DEFAULT_EFFORT, EFFORTS, SANDBOXES,
} from './run.mjs'

export const name = 'dsh-codex'
export const inject = ['tools']

const textOut = () => ({
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: value.message }],
})

const delegateTool = defineTool({
  name: 'codex_delegate',
  description:
    '把一个自包含的任务交给本机 Codex（默认 gpt-6.1-sol + max 推理档）干，只把最终答复拿回来。' +
    '什么时候值得用：任务能用一段话描述清楚、需要大量读文件/跑命令/独立改代码，而我只需要一句结论或一段 diff。' +
    '什么时候别用：需要跟我来回商量、需要我逐步判断、或者产出本身就是大段文本——那样反而更贵。' +
    '注意：它看不到我们的对话，任务描述必须自包含；每次冷启动约 2 分钟，小活儿不划算。',
  parameters: {
    task: {
      type: 'string',
      description: '交给 Codex 的完整任务说明。它看不到本对话，必须自带背景、目标、验收标准。',
    },
    cwd: {
      type: 'string',
      description: '它的工作根目录，绝对路径。默认当前进程目录。要让它改文件就填目标目录。',
    },
    model: { type: 'string', description: `模型，默认 ${DEFAULT_MODEL}` },
    effort: {
      type: 'string',
      description: `推理档位，默认 ${DEFAULT_EFFORT}。可选：${EFFORTS.join(' / ')}。简单任务降档能快点。`,
    },
    sandbox: {
      type: 'string',
      description: `沙箱：${SANDBOXES.join(' / ')}。默认 read-only（只读分析）；要它写文件必须传 workspace-write。`,
    },
    timeoutSec: { type: 'number', description: '超时秒数，默认 900。冷启动就要 2 分钟，别给太小。' },
    addDir: { type: 'string', description: '额外允许写入的目录（绝对路径），可选。' },
    debug: {
      type: 'boolean',
      description: '成功时也附上进程日志尾部（默认只在失败时附）。排查问题用。',
    },
  },
  output: textOut(),
  execute: async (args) => {
    const result = await runCodex({
      task: args.task,
      cwd: args.cwd,
      model: args.model || DEFAULT_MODEL,
      effort: args.effort || DEFAULT_EFFORT,
      sandbox: args.sandbox || 'read-only',
      timeoutSec: args.timeoutSec || 900,
      addDir: args.addDir,
    })

    const lines = []
    if (result.ok) {
      lines.push(`✅ Codex 完成（${result.durationSec}s）`)
      lines.push('')
      lines.push(result.answer || '（没有返回内容）')
    } else {
      lines.push(`❌ Codex 失败（${result.durationSec}s）：${result.error || '未知原因'}`)
      if (result.answer) {
        lines.push('')
        lines.push('部分输出：')
        lines.push(result.answer)
      }
    }
    // 只在失败或显式 debug 时才附日志：成功时附日志既浪费 token，
    // 也可能把工具输出里的敏感内容带进上下文。
    if ((!result.ok || args.debug) && result.logTail) {
      lines.push('')
      lines.push('— 进程日志尾部 —')
      lines.push(result.logTail)
    }

    return {
      ok: result.ok,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationSec: result.durationSec,
      answer: result.answer,
      message: lines.join('\n'),
    }
  },
})

const statusTool = defineTool({
  name: 'codex_status',
  description:
    '检查本机 Codex 是否可用：找到的可执行文件、版本、以及各个安装形态的候选清单。' +
    '不调用模型，不花钱，用于委派前确认链路、或排查「为什么没找到 Codex」。',
  parameters: {},
  output: textOut(),
  execute: () => {
    const exe = resolveCodexExe()
    const candidates = listCodexCandidates()
    const probe = spawnSync(exe, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
    const version = (probe.stdout || '').trim().replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    const ok = probe.status === 0

    const lines = []
    if (ok) {
      lines.push('Codex 可用')
      lines.push(`  路径：${exe}`)
      lines.push(`  版本：${version}`)
    } else {
      lines.push('Codex 不可用')
      lines.push(`  路径：${exe}`)
      lines.push(`  错误：${(probe.stderr || '').trim() || '无输出'}`)
      lines.push('  提示：可设置环境变量 DSH_CODEX_EXE 指向 codex 可执行文件。')
    }

    if (candidates.length > 1) {
      lines.push('')
      lines.push(`发现 ${candidates.length} 个候选（按优先级排序）：`)
      for (const c of candidates.slice(0, 6)) {
        const flag = c.exe === exe ? '← 采用' : c.complete ? '' : '（缺执行组件）'
        lines.push(`  · ${c.exe}${flag ? ' ' + flag : ''}`)
      }
    }

    return { ok, exe, version, candidates: candidates.length, message: lines.filter(Boolean).join('\n') }
  },
})

function registerTool(ctx, tool) {
  const attempt = () => ctx.tools.register(tool)
  try {
    attempt()
    return
  } catch (error) {
    if (/duplicate/i.test(String((error && error.message) || error))) return
    ctx.logger?.warn?.(`[dsh-codex] 工具 ${tool.name} 注册失败，稍后重试：${(error && error.message) || error}`)
  }
  try {
    ctx.inject(['tools'], () => {
      try {
        attempt()
      } catch (error) {
        if (!/duplicate/i.test(String((error && error.message) || error))) {
          ctx.logger?.error?.(`[dsh-codex] 工具 ${tool.name} 注册仍然失败：${(error && error.message) || error}`)
        }
      }
    })
  } catch {}
}

export function apply(ctx) {
  for (const tool of [delegateTool, statusTool]) registerTool(ctx, tool)
}
