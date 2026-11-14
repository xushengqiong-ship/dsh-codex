/**
 * 命令行查看本机 Codex 可用模型与档位（等价于 codex_models 工具）。
 * 不调用模型、不花钱。
 *
 * 用法：node smoke/list-models.mjs [--refresh] [--all]
 */
const mod = await import('../lib/index.mjs')

const reg = []
mod.apply({
  tools: { register: (t) => reg.push(t) },
  logger: {},
  inject: () => {},
})

const models = reg.find((t) => t.name === 'codex_models')
if (!models) {
  console.error('codex_models 工具未注册')
  process.exit(1)
}

const r = await models.execute({
  refresh: process.argv.includes('--refresh'),
  all: process.argv.includes('--all'),
})

console.log(r.message)
process.exit(r.ok ? 0 : 1)
