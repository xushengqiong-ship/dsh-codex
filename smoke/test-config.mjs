/**
 * 配置优先级测试：工具参数 > 环境变量 > 配置文件 > 内置默认。
 * 全程用临时 HOME，不碰真实配置、不启动 Codex、不花钱。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'codex-config-'))
const results = []
const check = (label, cond, detail = '') => {
  results.push({ label, ok: !!cond })
  console.log(`${cond ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`)
}

const savedEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  DSH_CODEX_MODEL: process.env.DSH_CODEX_MODEL,
  DSH_CODEX_EFFORT: process.env.DSH_CODEX_EFFORT,
}

try {
  process.env.HOME = root
  process.env.USERPROFILE = root
  delete process.env.DSH_CODEX_MODEL
  delete process.env.DSH_CODEX_EFFORT

  const { resolveDefaults, configPath, DEFAULTS } = await import('../lib/config.mjs')

  // 1) 什么都没有 → 内置默认
  let d = resolveDefaults()
  check('无配置时用内置默认', d.model === DEFAULTS.model && d.effort === DEFAULTS.effort, `${d.model}/${d.effort}`)
  check('默认来源标注正确', d.sources.model === '默认')

  // 2) 配置文件生效
  const cfgFile = path.join(root, '.dsh', 'codex-delegate.json')
  mkdirSync(path.dirname(cfgFile), { recursive: true })
  writeFileSync(cfgFile, JSON.stringify({ model: 'gpt-6-astra', effort: 'high', timeoutSec: 300 }))
  d = resolveDefaults()
  check('配置文件覆盖模型', d.model === 'gpt-6-astra', d.model)
  check('配置文件覆盖档位', d.effort === 'high', d.effort)
  check('配置文件覆盖超时', d.timeoutSec === 300, String(d.timeoutSec))
  check('来源标注为 config', d.sources.model.startsWith('config'), d.sources.model)
  check('configPath 指向 HOME 下', configPath() === cfgFile)

  // 3) 环境变量优先级高于配置文件
  process.env.DSH_CODEX_MODEL = 'gpt-6.1-sol'
  process.env.DSH_CODEX_EFFORT = 'max'
  d = resolveDefaults()
  check('环境变量压过配置文件', d.model === 'gpt-6.1-sol' && d.effort === 'max', `${d.model}/${d.effort}`)
  check('来源标注为 env', d.sources.model.startsWith('env'), d.sources.model)

  // 4) 坏配置不炸
  writeFileSync(cfgFile, '{ this is not json')
  delete process.env.DSH_CODEX_MODEL
  delete process.env.DSH_CODEX_EFFORT
  d = resolveDefaults()
  check('配置损坏时回退到内置默认', d.model === DEFAULTS.model, d.model)
} catch (error) {
  check('测试执行', false, error && error.message)
} finally {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(root, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log('')
if (failed.length) {
  console.error(`失败 ${failed.length} 项`)
  process.exit(1)
}
console.log('配置优先级测试全部通过')
