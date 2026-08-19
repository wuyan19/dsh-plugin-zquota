/**
 * planRouteProvision 纯函数测试：activate 的模型路由自动补齐计划。
 *
 * 覆盖三态：全新安装（整条创建）、已配置（零写入）、部分配置（只补缺失、
 * 不覆盖用户显式值）。计划正确 ⇒ settings.mutate 应用结果正确（后者由
 * dsh-settings 自身的路径编辑语义保证）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { planRouteProvision } from '../src/host.js'

const LIVE_REF = 'ZAI_CODING_CN_API_KEY'
const INTL_REF = 'ZAI_API_KEY'
const ROUTE = ['providers', 'zai-coding-cn']
const INTL_ROUTE = ['providers', 'zai']
const MODEL = { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1000000, maxTokens: 128000 }
const DEFAULTS = { provider: 'zai-coding-cn', model: 'glm-5.3' }
const INTL_DEFAULTS = { provider: 'zai', model: 'glm-5.3' }

test('fresh install (cn, default endpoint): creates the whole route and switches defaults', () => {
  const { ops, notes } = planRouteProvision(undefined, undefined)
  assert.deepEqual(notes, ['route-created', 'defaults-switched'])
  assert.deepEqual(ops, [
    // 端点不写：路由键即 pi-ai 目录绑定，baseURL 留空吃目录默认
    { op: 'set', path: ROUTE, value: { apiKeyEnv: LIVE_REF, models: [MODEL] } },
    { op: 'set', path: [], value: DEFAULTS },
  ])
})

test('fresh install (intl): creates the zai route with the intl credential ref', () => {
  const { ops, notes } = planRouteProvision(undefined, undefined, 'intl')
  assert.deepEqual(notes, ['route-created', 'defaults-switched'])
  assert.deepEqual(ops, [
    { op: 'set', path: INTL_ROUTE, value: { apiKeyEnv: INTL_REF, models: [MODEL] } },
    { op: 'set', path: [], value: INTL_DEFAULTS },
  ])
})

test('intl provisioning never touches the sibling cn route', () => {
  const cnRoute = { apiKeyEnv: LIVE_REF, models: [MODEL] }
  const piAi = { providers: { 'zai-coding-cn': cnRoute } }
  const { ops } = planRouteProvision(piAi, DEFAULTS, 'intl')
  // 只产生 zai 路由与默认模型两类编辑；cn 路由是 providers 下的兄弟键，
  // 路径编辑天然不碰（写入前的分节也不含它的新值）
  for (const op of ops) {
    if (op.path[0] === 'providers') assert.equal(op.path[1], 'zai')
  }
  const created = ops.find(op => op.path.join('.') === INTL_ROUTE.join('.'))
  assert.ok(created, 'creates the intl route')
  assert.deepEqual(created.value, { apiKeyEnv: INTL_REF, models: [MODEL] })
})

test('intl route already fully provisioned: zero ops', () => {
  const piAi = { providers: { zai: { apiKeyEnv: INTL_REF, models: [MODEL] } } }
  const { ops, notes } = planRouteProvision(piAi, INTL_DEFAULTS, 'intl')
  assert.deepEqual(ops, [])
  assert.deepEqual(notes, [])
})

test('everything already provisioned: zero ops', () => {
  const piAi = { providers: { 'zai-coding-cn': { apiKeyEnv: LIVE_REF } } }
  const { ops, notes } = planRouteProvision(piAi, DEFAULTS)
  assert.deepEqual(ops, [])
  assert.deepEqual(notes, [])
})

test('curated model list without glm-5.3: appends without touching siblings', () => {
  const kept = { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 1000000, maxTokens: 131072 }
  const piAi = { providers: { 'zai-coding-cn': { apiKeyEnv: LIVE_REF, models: [kept] } } }
  const { ops, notes } = planRouteProvision(piAi, undefined)
  const append = ops.find(op => op.path.join('.') === ROUTE.concat('models').join('.'))
  assert.ok(append, 'appends a models op')
  assert.deepEqual(append.value, [kept, MODEL])
  assert.deepEqual(append.value[0], kept, 'existing entries are preserved verbatim')
  assert.deepEqual(notes, ['model-appended', 'defaults-switched'])
})

test('fully-sized glm-5.3 entry (even user-shrunk) is untouched', () => {
  const piAi = { providers: { 'zai-coding-cn': { apiKeyEnv: LIVE_REF, models: [{ id: 'glm-5.3', contextWindow: 262144, maxTokens: 65536 }] } } }
  const { ops, notes } = planRouteProvision(piAi, DEFAULTS)
  assert.equal(ops.filter(op => op.path[op.path.length - 1] === 'models').length, 0)
  assert.deepEqual(notes, [])
})

test('unsized glm-5.3 entry (models-page discovery shape) gets sized in place', () => {
  // 模型页「发现模型」写入的裸条目：只有 id/name，无 contextWindow/maxTokens
  const bare = { id: 'glm-5.3', name: 'GLM-5.3' }
  const sibling = { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 1000000, maxTokens: 131072 }
  const piAi = { providers: { 'zai-coding-cn': { apiKeyEnv: LIVE_REF, models: [sibling, bare] } } }
  const { ops, notes } = planRouteProvision(piAi, DEFAULTS)
  const modelsOp = ops.find(op => op.path[op.path.length - 1] === 'models')
  assert.ok(modelsOp, 'rewrites the models list')
  assert.deepEqual(modelsOp.value, [sibling, MODEL])
  assert.deepEqual(modelsOp.value[0], sibling, 'sibling entries untouched')
  assert.deepEqual(notes, ['model-detailed'])
})

test('unsized entry keeps user extras (input) while gaining sizes', () => {
  const bare = { id: 'glm-5.3', name: 'GLM-5.3', input: ['text', 'image'] }
  const piAi = { providers: { 'zai-coding-cn': { apiKeyEnv: LIVE_REF, models: [bare] } } }
  const { ops } = planRouteProvision(piAi, DEFAULTS)
  const modelsOp = ops.find(op => op.path[op.path.length - 1] === 'models')
  assert.deepEqual(modelsOp.value[0], { id: 'glm-5.3', name: 'GLM-5.3', input: ['text', 'image'], contextWindow: 1000000, maxTokens: 128000 })
})

test('route key present but malformed: replaced wholesale', () => {
  const piAi = { providers: { 'zai-coding-cn': 'broken' } }
  const { ops, notes } = planRouteProvision(piAi, DEFAULTS)
  const route = ops.find(op => op.path.join('.') === ROUTE.join('.'))
  assert.ok(route)
  assert.deepEqual(route.value, { apiKeyEnv: LIVE_REF, models: [MODEL] })
  assert.deepEqual(notes, ['route-created'])
})

test('baseURL is never written, on any path', () => {
  // 全新创建（undefined / 非法形状）与已存在路由都不产出 baseURL 编辑；
  // 端点一律由 pi-ai 目录默认或用户已有声明提供
  const cases = [
    undefined,
    { providers: { 'zai-coding-cn': 'broken' } },
    { providers: { 'zai-coding-cn': { apiKeyEnv: LIVE_REF } } },
    { providers: { 'zai-coding-cn': { apiKeyEnv: 'OTHER', baseURL: 'https://mirror.example/v4' } } },
  ]
  for (const piAi of cases) {
    const { ops } = planRouteProvision(piAi, DEFAULTS)
    assert.equal(ops.filter(op => op.path[op.path.length - 1] === 'baseURL').length, 0, `no baseURL op for ${JSON.stringify(piAi)}`)
  }
})

test('apiKeyEnv pointing elsewhere is re-pointed to the panel write target', () => {
  const piAi = { providers: { 'zai-coding-cn': { apiKeyEnv: 'OTHER_KEY' } } }
  const { ops, notes } = planRouteProvision(piAi, DEFAULTS)
  const env = ops.find(op => op.path[op.path.length - 1] === 'apiKeyEnv')
  assert.ok(env)
  assert.equal(env.value, LIVE_REF)
  assert.deepEqual(notes, ['route-updated'])
})

test('existing route without baseURL: catalog default serves, nothing pinned', () => {
  // README 的最小可用配置：路由只声明 apiKeyEnv，端点吃 pi-ai 目录默认
  const piAi = { providers: { 'zai-coding-cn': { apiKeyEnv: LIVE_REF } } }
  const { ops } = planRouteProvision(piAi, DEFAULTS)
  assert.equal(ops.filter(op => op.path[op.path.length - 1] === 'baseURL').length, 0)
})

test('defaults op is a two-key root write, dropping stale reasoningEffort', () => {
  const piAi = { providers: { 'zai-coding-cn': { apiKeyEnv: LIVE_REF } } }
  const { ops } = planRouteProvision(piAi, { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' })
  const root = ops.find(op => op.path.length === 0)
  assert.deepEqual(root, { op: 'set', path: [], value: DEFAULTS })
})

test('vision-router twin as default provider (zai-coding-cn-vision / glm-5.3): zero ops', () => {
  // dsh-vision-router 场景：用户在模型选择器选了识图孪生，DSH 把孪生键写进
  // agent-default-model。孪生与本体共用凭据，视为已指向 —— 不产生任何编辑
  const piAi = { providers: { 'zai-coding-cn': { apiKeyEnv: LIVE_REF, models: [MODEL] } } }
  const { ops, notes } = planRouteProvision(piAi, { provider: 'zai-coding-cn-vision', model: 'glm-5.3' })
  assert.deepEqual(ops, [])
  assert.deepEqual(notes, [])
})

test('twin with a different model: only the model is aligned, provider kept', () => {
  const piAi = { providers: { 'zai-coding-cn': { apiKeyEnv: LIVE_REF, models: [MODEL] } } }
  const { ops, notes } = planRouteProvision(piAi, { provider: 'zai-coding-cn-vision', model: 'glm-4.7' })
  assert.deepEqual(ops, [{ op: 'set', path: ['model'], value: 'glm-5.3' }])
  assert.deepEqual(notes, ['defaults-model'])
  // 没有根路径整节写 —— 孪生不会被降级回本体
  assert.equal(ops.filter(op => op.path.length === 0).length, 0)
})

test('base route as default with empty model: model-only op, provider kept', () => {
  const piAi = { providers: { 'zai-coding-cn': { apiKeyEnv: LIVE_REF, models: [MODEL] } } }
  const { ops } = planRouteProvision(piAi, { provider: 'zai-coding-cn', model: '' })
  assert.deepEqual(ops, [{ op: 'set', path: ['model'], value: 'glm-5.3' }])
})

test('the other endpoint\'s twin does not satisfy: cn activation still switches defaults', () => {
  const piAi = { providers: { 'zai-coding-cn': { apiKeyEnv: LIVE_REF, models: [MODEL] } } }
  const { ops, notes } = planRouteProvision(piAi, { provider: 'zai-vision', model: 'glm-5.3' })
  const root = ops.find(op => op.path.length === 0)
  assert.deepEqual(root, { op: 'set', path: [], value: DEFAULTS })
  assert.deepEqual(notes, ['defaults-switched'])
})

test('non-object providers section is treated as absent', () => {
  const { ops, notes } = planRouteProvision({ providers: ['nope'] }, DEFAULTS)
  assert.deepEqual(notes, ['route-created'])
  assert.ok(ops.some(op => op.path.join('.') === ROUTE.join('.')))
})
