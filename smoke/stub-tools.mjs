// 只验证工具定义的结构：真实包也就是把对象原样返回并做校验。
export function defineTool(tool) {
  if (!tool.name) throw new Error('defineTool: 缺少 name')
  if (typeof tool.execute !== 'function') throw new Error('defineTool: 缺少 execute')
  if (!tool.output || typeof tool.output.render !== 'function') throw new Error('defineTool: 缺少 output.render')
  return tool
}
