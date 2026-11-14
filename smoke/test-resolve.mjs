/**
 * 多来源发现测试：列出本机所有能找到的 codex 可执行文件，并校验解析结果。
 * 不调用模型、不花钱。
 *
 * 用途：
 *   - 推广给别人时，先跑这个看「能不能找到、找到了哪几个」
 *   - 回归时确认排序规则没被改坏
 */
import { existsSync, statSync } from 'node:fs'
import { listCodexCandidates, resolveCodexExe } from '../lib/run.mjs'

const candidates = listCodexCandidates()
const resolved = resolveCodexExe()

console.log('platform   :', process.platform)
console.log('home       :', process.env.HOME || process.env.USERPROFILE || '(未设置)')
console.log('candidates :', candidates.length)
console.log('')

const fmt = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '-')
candidates.forEach((c, i) => {
  const mark = c.exe === resolved ? '★' : ' '
  console.log(
    `${mark} ${String(i + 1).padStart(2)}. ${c.exe}`,
  )
  console.log(`      complete=${c.complete} priority=${c.priority} mtime=${fmt(c.mtime)}`)
})

console.log('')
console.log('resolved   :', resolved)

if (resolved === 'codex') {
  console.log('结果       : 没有找到具体路径，将退回 PATH 上的裸 `codex`')
} else {
  console.log('exists     :', existsSync(resolved))
  console.log('size       :', existsSync(resolved) ? statSync(resolved).size : '-')
  if (process.platform === 'win32') {
    const dir = resolved.replace(/[\\/][^\\/]+$/, '')
    console.log('runner     :', existsSync(`${dir}\\codex-command-runner.exe`))
  }
}

// 排序自检：解析结果必须是候选列表的第一个
if (candidates.length > 0 && candidates[0].exe !== resolved) {
  console.error('✗ 排序错误：resolveCodexExe() 与候选列表首位不一致')
  process.exit(1)
}
if (candidates.length > 0 && !candidates[0].complete) {
  console.error('✗ 排序错误：首选候选缺少执行组件')
  process.exit(1)
}
console.log('排序自检   : OK')
