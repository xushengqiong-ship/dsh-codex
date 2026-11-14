/**
 * 插件冒烟测试：不启动 DSH，用桩替换 @deepseek-ai/dsh-tools，
 * 验证 apply() 能注册工具、工具结构正确、execute 的参数校验不炸。
 *
 * 注意：这里刻意只测「会在启动 Codex 之前就返回」的分支，
 * 所以不会真的调用模型，也不会触发 codex debug models 之外的开销。
 */
const mod = await import('../lib/index.mjs')

const registered = []
const ctx = {
  tools: { register: (t) => { registered.push(t) } },
  logger: { warn: (m) => console.log('WARN', m), error: (m) => console.log('ERROR', m) },
  inject: () => {},
}

console.log('name  =', mod.name)
console.log('inject=', JSON.stringify(mod.inject))

mod.apply(ctx)
console.log('tools =', registered.map((t) => t.name).join(', '))

const expected = ['codex_delegate', 'codex_models', 'codex_status']
for (const want of expected) {
  if (!registered.some((t) => t.name === want)) throw new Error(`工具未注册: ${want}`)
}

// 1) 结构检查
for (const t of registered) {
  if (!t.description) throw new Error(`${t.name} 缺 description`)
  if (!t.parameters) throw new Error(`${t.name} 缺 parameters`)
  if (!t.output?.render) throw new Error(`${t.name} 缺 output.render`)
}
console.log('结构   OK')

const status = registered.find((t) => t.name === 'codex_status')
const delegate = registered.find((t) => t.name === 'codex_delegate')
const models = registered.find((t) => t.name === 'codex_models')

// 2) codex_status 真跑一次（只跑 --version，不花钱）
const st = await status.execute({})
console.log('status.ok =', st.ok, '| exe =', st.exe)

// 3) codex_delegate 空任务：必须立刻拒绝，且不应启动 Codex
const bad = await delegate.execute({ task: '   ' })
console.log('空任务拦住了 =', bad.ok === false, '|', bad.message.split('\n')[0])
if (bad.ok !== false) throw new Error('空任务没有被拦住')

// 4) 非法 sandbox：必须立刻拒绝
const bad2 = await delegate.execute({ task: 'x', sandbox: 'yolo' })
console.log('非法沙箱拦住了 =', bad2.ok === false, '|', bad2.message.split('\n')[0])
if (bad2.ok !== false) throw new Error('非法 sandbox 没有被拦住')

// 5) codex_models 在没装 Codex 的环境下也不能抛异常
const mm = await models.execute({})
console.log('models.ok =', mm.ok, '| 模型数 =', (mm.models || []).length)
if (typeof mm.message !== 'string') throw new Error('codex_models 未返回 message')

console.log('\n冒烟测试通过')
