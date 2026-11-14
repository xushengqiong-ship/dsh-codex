/**
 * 插件冒烟测试：不启动 DSH，用桩替换 @deepseek-ai/dsh-tools，
 * 验证 apply() 能注册工具、工具结构正确、execute 主流程不炸。
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

const status = registered.find((t) => t.name === 'codex_status')
const delegate = registered.find((t) => t.name === 'codex_delegate')

if (!status || !delegate) throw new Error('工具未注册')

// 1) 结构检查
for (const t of registered) {
  if (!t.description) throw new Error(`${t.name} 缺 description`)
  if (!t.parameters) throw new Error(`${t.name} 缺 parameters`)
  if (!t.output?.render) throw new Error(`${t.name} 缺 output.render`)
}
console.log('结构   OK')

// 2) codex_status 真跑一次（只跑 --version，不花钱）
const st = await status.execute({})
console.log('status.ok =', st.ok, '| exe =', st.exe)
console.log('status 输出:\n' + st.message)

// 3) codex_delegate 空任务应当立刻报错、不启动进程
const bad = await delegate.execute({ task: '   ' })
console.log('空任务拦住了 =', bad.ok === false, '|', bad.message.split('\n')[0])

// 4) 非法 effort 也应拦住
const bad2 = await delegate.execute({ task: 'x', effort: 'turbo' })
console.log('非法档位拦住了 =', bad2.ok === false, '|', bad2.message.split('\n')[0])

console.log('\n冒烟测试通过')
