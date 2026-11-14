/**
 * 脱离 DSH 直接测 lib/run.mjs。
 *
 * 用法：
 *   node test-run.mjs "你的任务"           # 只读，默认
 *   node test-run.mjs "你的任务" --write   # workspace-write，允许改文件
 *
 * 注意：每次冷启动约 2 分钟（WebSocket 回退），属正常。
 */
import { runCodex, resolveCodexExe, DEFAULT_MODEL, DEFAULT_EFFORT } from './lib/run.mjs'

const task = process.argv[2]
const write = process.argv.includes('--write')

if (!task) {
  console.log('用法: node test-run.mjs "任务描述" [--write]')
  console.log('codex:', resolveCodexExe())
  process.exit(1)
}

console.log(`exe      ${resolveCodexExe()}`)
console.log(`model    ${DEFAULT_MODEL} / ${DEFAULT_EFFORT}`)
console.log(`sandbox  ${write ? 'workspace-write' : 'read-only'}`)
console.log('--- 开始 ---')

const r = await runCodex({
  task,
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
