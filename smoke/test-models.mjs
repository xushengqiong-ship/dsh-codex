/**
 * 模型目录解析与校验的单元测试。
 *
 * 全部用固件数据，不启动 Codex、不联网、不花钱。
 * 目的：保证「用户自选模型/档位」这套逻辑在 OpenAI 上新品时不会瞎拦。
 */
import { parseCatalog, checkChoice, findModel } from '../lib/models.mjs'

const FIXTURE = {
  models: [
    {
      slug: 'gpt-6.1-sol',
      display_name: 'GPT-6.1-Sol',
      description: 'workhorse',
      default_reasoning_level: 'low',
      priority: 1,
      visibility: 'list',
      supported_reasoning_levels: [
        { effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'max' },
      ],
    },
    {
      slug: 'gpt-6-astra',
      display_name: 'GPT-6-Astra',
      default_reasoning_level: 'medium',
      priority: 2,
      visibility: 'list',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
    },
    {
      slug: 'secret-model',
      visibility: 'hide',
      priority: 9,
      supported_reasoning_levels: [{ effort: 'low' }],
    },
  ],
}

const results = []
const check = (label, cond, detail = '') => {
  results.push({ label, ok: !!cond })
  console.log(`${cond ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`)
}

// --- 解析 ---
const models = parseCatalog(FIXTURE)
check('解析出 3 个模型', models.length === 3)
check('按 priority 升序', models[0].slug === 'gpt-6.1-sol' && models[2].slug === 'secret-model')
check('档位被抽出', models[0].efforts.join(',') === 'low,medium,high,max', models[0].efforts.join(','))
check('保留 visibility', models[2].visibility === 'hide')
check('字符串形态的档位也能解析', parseCatalog([{ slug: 'x', supported_reasoning_levels: ['low', 'high'] }])[0].efforts.join(',') === 'low,high')

// --- 查找 ---
check('大小写不敏感查找', findModel(models, 'GPT-6.1-SOL')?.slug === 'gpt-6.1-sol')
check('找不到返回 null', findModel(models, 'nope') === null)

// --- 校验 ---
check('合法组合通过', checkChoice(models, 'gpt-6.1-sol', 'max').ok === true)
check('模型存在但档位不支持要报错', checkChoice(models, 'gpt-6-astra', 'max').ok === false)
check('报错里给出可用档位', /low, high/.test(checkChoice(models, 'gpt-6-astra', 'max').error || ''))
check('未知模型要报错', checkChoice(models, 'gpt-9-future', 'max').ok === false)
check('未知模型的报错只列可见模型', !/secret-model/.test(checkChoice(models, 'gpt-9-future', 'max').error || ''))
check('目录为空时放行（不让读不到目录变成拦路虎）', checkChoice([], 'whatever', 'weird').ok === true)
check('空档位放行', checkChoice(models, 'gpt-6.1-sol', '').ok === true)

// --- 未来新模型 ---
const future = parseCatalog({
  models: [{ slug: 'gpt-7-omega', supported_reasoning_levels: [{ effort: 'hyper' }], priority: 1 }],
})
check('未来新模型 + 新档位无需改代码即可通过', checkChoice(future, 'gpt-7-omega', 'hyper').ok === true)

const failed = results.filter((r) => !r.ok)
console.log('')
if (failed.length) {
  console.error(`失败 ${failed.length} 项`)
  process.exit(1)
}
console.log('模型目录测试全部通过')
