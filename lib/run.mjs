/**
 * dsh-codex 的执行核心。
 *
 * 只做一件事：把一段任务描述交给本机 Codex CLI（非交互 `codex exec`），
 * 等它跑完，只把「最终答复」拿回来 —— 不把满屏进度日志塞进上下文。
 *
 * 刻意不依赖 DSH 运行时，方便用 node 直接测（见 test-run.mjs）。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const DEFAULT_MODEL = 'gpt-6.1-sol'
export const DEFAULT_EFFORT = 'max'
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'ultra', 'persistent', 'max']
export const SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access']

const ANSWER_MAX = 24000
const LOG_TAIL_MAX = 3000
// 有界缓冲上限：长任务可能刷出几十 MB 日志，不能无脑累加。
const STDOUT_MAX = 200_000
const STDERR_MAX = 60_000

/** 只保留尾部 max 个字符，避免内存随日志无限增长。 */
function bound(s, max) {
  return s.length > max ? s.slice(s.length - max) : s
}

/** 去掉 ANSI 颜色控制符，否则回传的日志里全是转义序列。 */
function stripAnsi(s) {
  return String(s)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
}

const IS_WIN = process.platform === 'win32'
const EXE_NAME = IS_WIN ? 'codex.exe' : 'codex'
const HOME = process.env.HOME || process.env.USERPROFILE || ''

// Codex 目前有几种存在形态，任一种都可能在别人机器上出现：
//   1. CLI（npm / brew / install.sh / GitHub release）
//   2. 桌面 App（macOS .app、Windows 安装包）—— 内部自带一份 CLI
//   3. IDE 扩展（VS Code / Cursor / Windsurf / VSCodium）—— 扩展包里也捆绑 CLI
// 只要找到其中之一的可执行文件就能工作，所以这里逐个来源扫。

function safeReadDir(dir) {
  try { return readdirSync(dir) } catch { return [] }
}

function mtimeOf(file) {
  try { return statSync(file).mtimeMs } catch { return 0 }
}

/**
 * Windows 上 codex.exe 需要同目录的 codex-command-runner.exe 才能执行命令；
 * 缺了会报「命令执行组件缺失」。mac/Linux 没有这一层，一律算完整。
 */
function isComplete(exePath) {
  if (!IS_WIN) return true
  return existsSync(path.join(path.dirname(exePath), 'codex-command-runner.exe'))
}

/** 统一的候选收集：去重、校验存在性、带完整性/优先级/时间。 */
function addCandidate(list, exePath, priority = 1) {
  if (!exePath || typeof exePath !== 'string') return
  try {
    if (!existsSync(exePath)) return
  } catch {
    return
  }
  if (list.some((c) => c.exe === exePath)) return
  list.push({
    exe: exePath,
    complete: isComplete(exePath),
    priority,
    mtime: mtimeOf(exePath),
  })
}

/** 有限深度递归查找某个文件名，防符号链接成环、防扫爆大目录。 */
function findExecutablesUnder(root, name, maxDepth = 4, limit = 6) {
  const out = []
  const walk = (dir, depth) => {
    if (depth > maxDepth || out.length >= limit) return
    for (const entry of safeReadDir(dir)) {
      const full = path.join(dir, entry)
      let st
      try { st = lstatSync(full) } catch { continue }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        walk(full, depth + 1)
      } else if (entry === name) {
        out.push(full)
        if (out.length >= limit) return
      }
    }
  }
  walk(root, 0)
  return out
}

/** Codex 自身安装目录（版本化布局：bin\<hash>\codex.exe）。 */
function fromCodexInstalls(list) {
  const roots = []
  if (IS_WIN) {
    if (process.env.LOCALAPPDATA) {
      roots.push(path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin'))
      // 桌面版还有一种 Programs\OpenAI\Codex\bin 布局
      roots.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin'))
    }
    if (process.env.USERPROFILE) {
      roots.push(path.join(process.env.USERPROFILE, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin'))
    }
  }
  for (const root of roots) {
    // 版本化子目录
    for (const entry of safeReadDir(root)) {
      addCandidate(list, path.join(root, entry, EXE_NAME))
    }
    // 也直接放在 bin 根下
    addCandidate(list, path.join(root, EXE_NAME))
  }
}

/** 常见 PATH 位置（brew / npm 全局 / volta / bun …）。 */
function fromCommonBinDirs(list) {
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
  if (HOME) {
    dirs.push(
      path.join(HOME, '.local', 'bin'),
      path.join(HOME, '.npm-global', 'bin'),
      path.join(HOME, '.volta', 'bin'),
      path.join(HOME, '.bun', 'bin'),
      path.join(HOME, '.codex', 'bin'),
    )
  }
  for (const dir of dirs) addCandidate(list, path.join(dir, EXE_NAME))
}

/** macOS 桌面 App 内部自带的 CLI。 */
function fromMacApp(list) {
  if (process.platform !== 'darwin') return
  for (const app of ['/Applications/Codex.app', path.join(HOME, 'Applications', 'Codex.app')]) {
    for (const exe of findExecutablesUnder(app, 'codex', 5, 4)) addCandidate(list, exe)
  }
}

/** IDE 扩展：openai.chatgpt-<version>-<platform>/bin/<platform>/codex(.exe) */
function fromIdeExtensions(list) {
  if (!HOME) return
  const roots = [
    ['.vscode', 'extensions'],
    ['.vscode-insiders', 'extensions'],
    ['.cursor', 'extensions'],
    ['.cursor-server', 'extensions'],
    ['.windsurf', 'extensions'],
    ['.vscodium', 'extensions'],
  ]
  for (const segs of roots) {
    const root = path.join(HOME, ...segs)
    for (const name of safeReadDir(root)) {
      if (!name.startsWith('openai.chatgpt-')) continue
      const binRoot = path.join(root, name, 'bin')
      for (const platform of safeReadDir(binRoot)) {
        addCandidate(list, path.join(binRoot, platform, EXE_NAME))
      }
    }
  }
}

/** 用户在 VS Code / Cursor 设置里显式指定的路径（chatgpt.cliExecutable）。 */
function fromVscodeSettings(list) {
  const candidates = []
  if (IS_WIN && process.env.APPDATA) {
    for (const ed of ['Code', 'Code - Insiders', 'Cursor', 'Windsurf', 'VSCodium']) {
      candidates.push(path.join(process.env.APPDATA, ed, 'User', 'settings.json'))
    }
  }
  if (process.platform === 'darwin' && HOME) {
    for (const ed of ['Code', 'Code - Insiders', 'Cursor', 'Windsurf', 'VSCodium']) {
      candidates.push(path.join(HOME, 'Library', 'Application Support', ed, 'User', 'settings.json'))
    }
  }
  if (process.platform === 'linux' && HOME) {
    for (const ed of ['Code', 'Code - Insiders', 'Cursor', 'Windsurf', 'VSCodium']) {
      candidates.push(path.join(HOME, '.config', ed, 'User', 'settings.json'))
    }
  }
  for (const file of candidates) {
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch { continue }
    // settings.json 是 JSONC，允许注释和尾逗号，用正则取字符串即可
    const m = text.match(/"chatgpt\.cliExecutable"\s*:\s*"([^"]*)"/)
    if (!m) continue
    // JSON 里的 Windows 路径是转义过的，还原一次
    addCandidate(list, m[1].replace(/\\\\/g, '\\'), 0)
  }
}

/** Codex 自己的 config.toml 里可能记着 CODEX_CLI_PATH。 */
function fromCodexConfig(list) {
  if (!HOME) return
  let text = ''
  try { text = readFileSync(path.join(HOME, '.codex', 'config.toml'), 'utf8') } catch { return }
  const m = text.match(/CODEX_CLI_PATH\s*=\s*['"]([^'"]+)['"]/)
  if (m) addCandidate(list, m[1])
}

/** 兜底：交给系统 PATH 解析（which / where）。 */
function fromPath(list) {
  try {
    const probe = spawnSync(IS_WIN ? 'where' : 'which', ['codex'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000,
    })
    if (probe.status !== 0 || !probe.stdout) return
    for (const line of probe.stdout.split(/\r?\n/)) {
      const p = line.trim()
      if (p) addCandidate(list, p)
    }
  } catch {}
}

/**
 * 列出所有找到的 codex 可执行文件，按「完整 → 用户显式指定 → 新」排序。
 * 导出给 codex_status 用，方便别人排查「为什么没找到」。
 */
export function listCodexCandidates() {
  const list = []
  fromCodexInstalls(list)
  fromCommonBinDirs(list)
  fromMacApp(list)
  fromIdeExtensions(list)
  fromVscodeSettings(list)
  fromCodexConfig(list)
  fromPath(list)
  list.sort(
    (a, b) =>
      Number(b.complete) - Number(a.complete) ||
      a.priority - b.priority ||
      b.mtime - a.mtime,
  )
  return list
}

/**
 * 找 codex 可执行文件。优先级：
 *   1. DSH_CODEX_EXE 环境变量（显式覆盖，不做校验以外的干预）
 *   2. 各种安装形态里「完整」的候选（完整优先于新）
 *   3. 找不到就返回裸 `codex`，让 spawn 自己按 PATH 解析
 */
export function resolveCodexExe() {
  const explicit = process.env.DSH_CODEX_EXE
  if (explicit) {
    try { if (existsSync(explicit)) return explicit } catch {}
  }
  const first = listCodexCandidates()[0]
  return first ? first.exe : 'codex'
}

function killTree(pid) {
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => {})
    } else {
      // 开了 detached，杀整个进程组，别留子孙进程
      try { process.kill(-pid, 'SIGKILL') } catch { process.kill(pid, 'SIGKILL') }
    }
  } catch {}
}

const tail = (s, n) => (s.length > n ? '…' + s.slice(-n) : s)

/**
 * 跑一次委派。
 * @returns {Promise<{ok:boolean, exitCode:number|null, timedOut:boolean,
 *   durationSec:number, answer:string, logTail:string, error?:string}>}
 */
export function runCodex(options = {}) {
  const {
    task,
    cwd = process.cwd(),
    model = DEFAULT_MODEL,
    effort = DEFAULT_EFFORT,
    sandbox = 'read-only',
    timeoutSec = 900,
    ephemeral = true,
    skipGitCheck = true,
    addDir,
  } = options

  if (!task || !String(task).trim()) {
    return Promise.resolve({
      ok: false, exitCode: null, timedOut: false, durationSec: 0,
      answer: '', logTail: '', error: 'task 不能为空',
    })
  }
  if (!EFFORTS.includes(effort)) {
    return Promise.resolve({
      ok: false, exitCode: null, timedOut: false, durationSec: 0,
      answer: '', logTail: '', error: `effort 只能是 ${EFFORTS.join(' / ')}`,
    })
  }
  if (!SANDBOXES.includes(sandbox)) {
    return Promise.resolve({
      ok: false, exitCode: null, timedOut: false, durationSec: 0,
      answer: '', logTail: '', error: `sandbox 只能是 ${SANDBOXES.join(' / ')}`,
    })
  }

  const exe = resolveCodexExe()
  // 加随机后缀：同进程同毫秒并发发起两次时不会撞名、串读答复
  const outFile = path.join(tmpdir(), `dsh-codex-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
  const args = [
    'exec',
    '-m', model,
    '-c', `model_reasoning_effort="${effort}"`,
    '-s', sandbox,
    '-C', cwd,
    '--color', 'never',
    '-o', outFile,
  ]
  if (skipGitCheck) args.push('--skip-git-repo-check')
  if (ephemeral) args.push('--ephemeral')
  if (addDir) args.push('--add-dir', addDir)
  args.push('-') // 任务文本从 stdin 读，避免 Windows 命令行长度/引号问题

  const started = Date.now()

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(exe, args, {
        cwd,
        windowsHide: true,
        env: process.env,
        // POSIX 下开进程组，超时才能连子孙一起收掉
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      return resolve({
        ok: false, exitCode: null, timedOut: false, durationSec: 0,
        answer: '', logTail: '', error: `启动 codex 失败：${error.message}`,
      })
    }

    // 有界缓冲：只留尾部，避免长任务把内存吃满（Codex 评审指出的问题）。
    // stdout 留得多一些，因为没拿到 -o 文件时要拿它兜底当答复。
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let killTimer

    const finish = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      resolve(payload)
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
      // taskkill 也可能失败或卡住；给一个硬兜底，别让 Promise 永远悬着
      killTimer = setTimeout(() => {
        finish({
          ok: false, exitCode: null, timedOut: true,
          durationSec: Math.round((Date.now() - started) / 1000),
          answer: '', logTail: tail(stripAnsi(stderr).trim(), LOG_TAIL_MAX),
          error: `超时 ${timeoutSec}s，进程未能确认退出（已强杀）`,
        })
      }, 15000)
    }, Math.max(30, timeoutSec) * 1000)

    child.stdout?.on('data', (d) => { stdout = bound(stdout + d.toString('utf8'), STDOUT_MAX) })
    child.stderr?.on('data', (d) => { stderr = bound(stderr + d.toString('utf8'), STDERR_MAX) })
    child.on('error', (error) => {
      finish({
        ok: false, exitCode: null, timedOut: false,
        durationSec: Math.round((Date.now() - started) / 1000),
        answer: '', logTail: '', error: `codex 启动失败：${error.message}`,
      })
    })

    child.on('close', (code) => {
      let answer = ''
      try {
        if (existsSync(outFile)) answer = readFileSync(outFile, 'utf8')
      } catch {}
      try { unlinkSync(outFile) } catch {}

      // 没拿到 -o 文件时退回 stdout 末尾（JSONL 或纯文本都能兜住）
      if (!answer.trim() && stdout.trim()) answer = stdout
      answer = stripAnsi(answer).trim()

      // 只保留尾部诊断信息；成功时由 index.mjs 决定要不要展示
      const logTail = tail(stripAnsi(stderr + (answer ? '' : '\n' + stdout)).trim(), LOG_TAIL_MAX)
      const ok = code === 0 && !timedOut

      finish({
        ok,
        exitCode: code,
        timedOut,
        durationSec: Math.round((Date.now() - started) / 1000),
        answer: answer.length > ANSWER_MAX ? tail(answer, ANSWER_MAX) : answer,
        logTail,
        ...(code !== 0 && !timedOut ? { error: `codex 退出码 ${code}` } : {}),
        ...(timedOut ? { error: `超时 ${timeoutSec}s，已终止` } : {}),
      })
    })

    if (child.stdin) {
      child.stdin.on('error', () => {})
      child.stdin.end(String(task), 'utf8')
    }
  })
}
