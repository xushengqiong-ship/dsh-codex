/**
 * 默认值与用户配置。
 *
 * 优先级：工具调用参数 > 环境变量 > 配置文件 > 内置默认。
 * 配置文件放在 ~/.dsh/codex-delegate.json，形如：
 *   { "model": "gpt-6-astra", "effort": "high", "sandbox": "read-only", "timeoutSec": 900 }
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_MODEL, DEFAULT_EFFORT } from './run.mjs'

export const DEFAULTS = {
  model: DEFAULT_MODEL,
  effort: DEFAULT_EFFORT,
  sandbox: 'read-only',
  timeoutSec: 900,
}

export function configPath() {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  return path.join(home, '.dsh', 'codex-delegate.json')
}

export function loadConfig() {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 解析当前生效的默认值，并标注每个值来自哪里（方便 status 展示与排查）。 */
export function resolveDefaults() {
  const cfg = loadConfig()
  const pick = (envKey, cfgKey, fallback) => {
    if (process.env[envKey]) return { value: process.env[envKey], from: `env ${envKey}` }
    if (cfg[cfgKey] !== undefined && cfg[cfgKey] !== '') return { value: cfg[cfgKey], from: `config ${cfgKey}` }
    return { value: fallback, from: '默认' }
  }

  const model = pick('DSH_CODEX_MODEL', 'model', DEFAULTS.model)
  const effort = pick('DSH_CODEX_EFFORT', 'effort', DEFAULTS.effort)
  const sandbox = pick('DSH_CODEX_SANDBOX', 'sandbox', DEFAULTS.sandbox)
  const timeout = pick('DSH_CODEX_TIMEOUT', 'timeoutSec', DEFAULTS.timeoutSec)

  return {
    model: model.value,
    effort: effort.value,
    sandbox: sandbox.value,
    timeoutSec: Number(timeout.value) || DEFAULTS.timeoutSec,
    sources: {
      model: model.from,
      effort: effort.from,
      sandbox: sandbox.from,
      timeoutSec: timeout.from,
    },
    configFile: configPath(),
  }
}
