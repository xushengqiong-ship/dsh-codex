/**
 * 隔离发现测试：不碰真实环境，造几个假的安装形态，验证解析顺序。
 *
 * 覆盖场景：
 *   A. 只有 IDE 扩展（模拟「只装了 VS Code 插件、没装 CLI/桌面版」的用户）
 *   B. 扩展完整 + 桌面版残缺 → 必须选扩展
 *
 * 做法：把 HOME / USERPROFILE / LOCALAPPDATA / APPDATA / PATH 全指到临时目录，
 * 再动态 import run.mjs（模块加载时读这些环境变量），最后清理。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const isWin = process.platform === 'win32'
const exeName = isWin ? 'codex.exe' : 'codex'
const root = mkdtempSync(path.join(tmpdir(), 'codex-discovery-'))

const home = path.join(root, 'home')
const localAppData = path.join(root, 'localappdata')
const appData = path.join(root, 'appdata')

function makeExt(version, complete = true) {
  const platDir = isWin ? 'windows-x86_64' : 'linux-x86_64'
  const dir = path.join(home, '.vscode', 'extensions', `openai.chatgpt-${version}-x64`, 'bin', platDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, exeName), '')
  if (isWin && complete) writeFileSync(path.join(dir, 'codex-command-runner.exe'), '')
  return path.join(dir, exeName)
}

function makeDesktopInstall(hash, complete) {
  const dir = path.join(localAppData, 'OpenAI', 'Codex', 'bin', hash)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, exeName), '')
  if (isWin && complete) writeFileSync(path.join(dir, 'codex-command-runner.exe'), '')
  return path.join(dir, exeName)
}

const results = []
const check = (label, cond, detail = '') => {
  results.push({ label, ok: !!cond, detail })
  console.log(`${cond ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`)
}

try {
  // 环境隔离：真实安装一律看不到
  process.env.HOME = home
  process.env.USERPROFILE = home
  process.env.LOCALAPPDATA = localAppData
  process.env.APPDATA = appData
  process.env.PATH = '' // 让 where / which 失败，避免发现真实 CLI

  // 场景 A：只有 IDE 扩展
  const extExe = makeExt('1.0.0')
  let mod = await import('../lib/run.mjs')
  let list = mod.listCodexCandidates()
  check('A. 只有 IDE 扩展时能被发现', list.length === 1 && list[0].exe === extExe, `找到 ${list.length} 个`)
  check('A. 解析结果指向扩展内的 CLI', mod.resolveCodexExe() === extExe)
  check('A. 该候选被判为完整', list[0]?.complete === true)

  // 场景 B：再加一个「残缺的桌面版」（只有 codex.exe，缺执行组件）
  const broken = makeDesktopInstall('deadbeef', false)
  // 换个新模块实例，避免模块级缓存（ESM 缓存的是同一个模块，直接复用也行）
  list = mod.listCodexCandidates()
  const top = list[0]
  if (isWin) {
    check('B. 残缺桌面版被识别出来', list.some((c) => c.exe === broken))
    check('B. 残缺的排在完整之后', top.exe === extExe && list[0].complete === true, `首位=${top.exe}`)
    const brokenEntry = list.find((c) => c.exe === broken)
    check('B. 残缺候选 complete=false', brokenEntry && brokenEntry.complete === false)
  } else {
    check('B. 非 Windows 无执行组件概念，跳过', true)
  }
} catch (error) {
  check('测试执行', false, error && error.message)
} finally {
  rmSync(root, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log('')
if (failed.length) {
  console.error(`失败 ${failed.length} 项`)
  process.exit(1)
}
console.log('隔离发现测试全部通过')
