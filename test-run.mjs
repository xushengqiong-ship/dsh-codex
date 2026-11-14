/**
 * 脱离 DSH 直接测 lib/run.mjs。
 *
 * 用法：
 *   node test-run.mjs "你的任务"                          # 只读，用配置里的默认模型
 *   node test-run.mjs "你的任务" --write                   # workspace-write，允许改文件
 *   node test-run.mjs "你的任务" --model=gpt-6-astra       # 指定模型
 *   node test-run.mjs "你的任务" --effort=high             # 指定推理档位
 *
 * 可用模型和档位：node smoke/_list-models.mjs（或 codex_models 工具）
 * 注意：每次冷启动约 2 分钟（WebSocket 回退），属正常。
 */
import { runCodex, resolveCodexExe } from './lib/run.mjs'
import { resolveDefaults } from './lib/config.mjs'

const argv = process.argv.slice(2)
const task = argv.find((a) => !a.startsWith('--'))
const write = argv.includes('--write')
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

const defaults = resolveDefaults()
const model = flag('model') || defaults.model
const effort = flag('effort') || defaults.effort

if (!task) {
  console.log('用法: node test-run.mjs "任务描述" [--write] [--model=xxx] [--effort=xxx]')
  console.log('codex:', resolveCodexExe())
  console.log(`默认: ${defaults.model} + ${defaults.effort}（${defaults.sources.model} / ${defaults.sources.effort}）`)
  process.exit(1)
}

console.log(`exe      ${resolveCodexExe()}`)
console.log(`model    ${model} / ${effort}`)
console.log(`sandbox  ${write ? 'workspace-write' : 'read-only'}`)
console.log('--- 开始 ---')

const r = await runCodex({
  task,
  model,
  effort,
  sandbox: write ? 'workspace-write' : 'read-only',
  cwd: process.cwd(),
})

console.log(`ok       ${r.ok}`)
console.log(`exit     ${r.exitCode}`)
console.log(`elapsed  ${r.durationSec}s`)
if (r.error) console.log(`error    ${r.error}`)
console.log('--- answer ---')
console.log(r.answer || '（空）')
if (r.logTail) {
  console.log('--- log tail ---')
  console.log(r.logTail)
}
process.exit(r.ok ? 0 : 1)
