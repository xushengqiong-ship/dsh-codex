/**
 * Codex 模型目录。
 *
 * 从本机 CLI 的 `codex debug models` 读取真实可用的模型清单，以及每个模型
 * 支持的推理档位。这样 OpenAI 上了新模型、或者用户换了 provider，只要
 * 他本机的 Codex 能看到，插件不用改一行代码就能用。
 *
 * 目录读取失败（没登录、老版本 CLI、临时故障）时返回空列表，
 * 调用方据此退化为「不校验，直接交给 codex 自己判断」。
 */
import { execFileSync } from 'node:child_process'
import { resolveCodexExe } from './run.mjs'

const CACHE_TTL_MS = 5 * 60 * 1000
let cache = null
let cachedAt = 0

/** 纯函数：把 CLI 的原始 JSON 归一化成稳定结构，方便测试。 */
export function parseCatalog(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  const list = Array.isArray(data) ? data : (data && data.models) || []
  return list
    .map((m) => ({
      slug: m.slug || m.id || '',
      name: m.display_name || m.slug || m.id || '',
      description: m.description || '',
      defaultEffort: m.default_reasoning_level || '',
      efforts: (m.supported_reasoning_levels || [])
        .map((l) => (typeof l === 'string' ? l : l.effort))
        .filter(Boolean),
      priority: typeof m.priority === 'number' ? m.priority : 999,
      visibility: m.visibility || 'list',
    }))
    .filter((m) => m.slug)
    .sort((a, b) => a.priority - b.priority)
}

/** 读模型目录，带 5 分钟缓存。 */
export function listModels({ force = false } = {}) {
  if (!force && cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache
  try {
    const raw = execFileSync(resolveCodexExe(), ['debug', 'models'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      timeout: 60000,
    })
    cache = parseCatalog(raw)
    cachedAt = Date.now()
  } catch {
    // 读不到就沿用旧缓存；没有缓存就返回空数组
  }
  return cache || []
}

export function findModel(models, slug) {
  if (!slug) return null
  const needle = String(slug).toLowerCase()
  return models.find((m) => m.slug.toLowerCase() === needle) || null
}

/**
 * 校验 model + effort 组合。
 * 模型目录为空时不校验（交给 codex 报错），避免因为读不到目录就误拦。
 */
export function checkChoice(models, model, effort) {
  if (!Array.isArray(models) || models.length === 0) {
    return { ok: true, note: '模型目录不可用，跳过校验' }
  }

  const found = findModel(models, model)
  if (!found) {
    const visible = models.filter((m) => m.visibility === 'list').map((m) => m.slug)
    return {
      ok: false,
      error: `本机 Codex 没有模型 ${model}。可用：${visible.join(', ')}`,
    }
  }

  if (!effort || !found.efforts.length) return { ok: true, model: found }

  if (found.efforts.includes(effort)) return { ok: true, model: found }

  return {
    ok: false,
    model: found,
    error: `${found.slug} 不支持推理档 ${effort}。它支持：${found.efforts.join(', ')}`,
  }
}
