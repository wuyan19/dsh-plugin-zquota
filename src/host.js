/**
 * dsh-plugin-zquota — host half (plain ESM, no build step).
 *
 * GLM Coding Plan 账号面板的宿主侧：
 * - API Key（机密）存于 $DSH_HOME/.credentials.yaml（经 ctx.credentials，
 *   条目 ZAI_QUOTA_KEY_<id> 每账号一条）——凭据库只放真机密
 * - 账号索引、名称、额度快照（非机密状态）存于插件自有状态文件
 *   $DSH_HOME/zquota-state.json（0600、temp+rename 原子写）
 * - 配额查询用 Node 原生 fetch 直连智谱端点（进程内 HTTPS，不经
 *   ctx.shell/沙箱/外部 curl —— 任何平台、任何沙箱后端状态下都可用）；
 *   API Key 仅进入内存中的 Authorization 头，不落命令行与日志
 * - 「设为当前」= 写该端点的凭据引用（国内版 ZAI_CODING_CN_API_KEY /
 *   国际版 ZAI_API_KEY），llm-pi-ai 每请求重新解析凭据，下一次模型请求
 *   即生效，无需重启；国内版/国际版账号各走各的路由与凭据
 * - 模型路由自动补齐：activate 同时经 ctx.settings 补齐该端点的 llm-pi-ai
 *   路由（国内版 zai-coding-cn / 国际版 zai；apiKeyEnv / glm-5.3 模型项，
 *   端点由 pi-ai 内置目录默认提供，不写 baseURL）与 agent-default-model
 *   默认模型，只补缺失字段、绝不覆盖用户显式配置 —— 全新安装（未配置任何
 *   供应商）也能一键完成「配置 API Key、模型、上下文窗口、最大输出
 *   Token」并直接可用
 * - 浏览器半通过 webServer 前缀路由 /zquota-api 以同源 JSON API 通信
 *   （静态包没有动态插件的包私有 RPC 通道，同源 fetch 是等价替代）
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { env } from 'node:process'

export const inject = ['credentials', 'webServer', 'settings']

const ENDPOINTS = { cn: 'https://open.bigmodel.cn', intl: 'https://api.z.ai' }
const API_PREFIX = '/zquota-api'
const CLIENT_HEADER = 'x-zquota-client'
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i

/** 模型路由补齐所写的两个 settings 命名空间。 */
const NS_PI_AI = 'llm-pi-ai'
const NS_DEFAULT_MODEL = 'agent-default-model'
/**
 * 每个端点对应的模型路由事实。两条路由（zai-coding-cn / zai）pi-ai 内置
 * 目录都已收录：端点/协议由目录默认提供，任何情况下都不写 baseURL（写死
 * 会把用户钉在旧地址，目录更新后也不会跟进）。国内版/国际版是两套账号
 * 体系，凭据引用各自独立。
 */
const ROUTES = {
  cn: { route: 'zai-coding-cn', ref: 'ZAI_CODING_CN_API_KEY' },
  intl: { route: 'zai', ref: 'ZAI_API_KEY' },
}
/**
 * glm-5.3 尚未进入已安装 pi-ai 目录（两个目录最新都到 glm-5.2），新建路由
 * 时据此整条声明；两个端点同一模型、同一尺寸。contextWindow/maxTokens 是
 * 模型能力（对齐用户手工可用配置：1,000,000 / 128,000），不进入
 * configuredMaxTokens 请求默认上限。
 */
const DEFAULT_MODEL = { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1000000, maxTokens: 128000 }

/** 插件自有状态文件：非机密的账号索引与额度快照。 */
const STATE_PATH = join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'zquota-state.json')

/** 业务错误消息（client 每请求携带 lang；缺省 zh）。 */
const MSG = {
  zh: {
    nameRequired: '请填写名称',
    notFound: '账号不存在',
    badKey: 'API Key 格式应为 id.secret',
    dupKey: '该 API Key 已存在',
    noKey: '未存储 API Key',
    writeFailed: '写入凭据失败：',
    atEdge: '已在边界',
    badResponse: '响应非 JSON（HTTP {status}）',
  },
  en: {
    nameRequired: 'Name is required',
    notFound: 'Account not found',
    badKey: 'API key must look like id.secret',
    dupKey: 'This API key already exists',
    noKey: 'No API key stored',
    writeFailed: 'Failed to write credential: ',
    atEdge: 'Already at the edge',
    badResponse: 'Non-JSON response (HTTP {status})',
  },
}

function msgs (args) {
  return (args && args.lang === 'en') ? MSG.en : MSG.zh
}

function fill (template, params) {
  return String(template).replace(/\{(\w+)\}/g, (m, name) => (params && params[name] !== undefined ? String(params[name]) : m))
}

function keyRef (keyId) { return 'ZAI_QUOTA_KEY_' + keyId }

/** 由 API Key 确定性生成账号 id（FNV-1a 双向哈希 → 11 位大写十六进制）。 */
function idFromKey (key) {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  const hex = (h1.toString(16) + h2.toString(16)).toUpperCase()
  return 'A' + ('00000000000' + hex).slice(-11)
}

/** 值是否为普通对象（settings 分节的合法形状；数组与 null 不算）。 */
function isPlainObject (v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * dsh-vision-router 的自动识图孪生路由后缀：它为任意已启用路由注册
 * `<provider>-vision` 动态双路由，文字轮委托给原路由、共用同一凭据引用。
 */
const VISION_TWIN_SUFFIX = '-vision'

/** provider 是否指向这条 GLM 编程路由本体或其识图孪生（zai-coding-cn-vision）。 */
function isRouteOrVisionTwin (provider, route) {
  return provider === route || provider === route + VISION_TWIN_SUFFIX
}

/** 分节里 providers 字典的安全读法（缺失/形状不对都按空处理）。 */
function providersOf (section) {
  const p = isPlainObject(section) ? section.providers : undefined
  return isPlainObject(p) ? p : {}
}

/**
 * 计算把指定端点（cn → zai-coding-cn，intl → zai）的模型路由与默认模型
 * 补到可用所需的 settings 路径编辑。
 *
 * 纯函数（只读传入的两个已解析分节），导出供测试。原则：只补缺失，不覆盖
 * 用户显式配置 ——
 * - 路由不存在/形状非法：整条写入 { apiKeyEnv, models:[glm-5.3] }。端点/
 *   协议不写：路由键就是 pi-ai 内置目录的绑定，baseURL 留空即吃目录默认，
 *   目录更新后自动跟进
 * - 路由已存在：apiKeyEnv 缺失或指向他处时改指该端点的凭据引用（本面板
 *   「设为当前」的写点，改道后按钮才真实生效）；baseURL 不动（自定义网关
 *   保留，未声明的吃 pi-ai 目录官方默认）；models 列表存在但不含 glm-5.3
 *   时追加、含裸条目（只有 id/name、缺 contextWindow/maxTokens，如模型页
 *   「发现模型」写入的形状）时补全尺寸（未裁剪的列表 = 目录全量，天然含
 *   且自带尺寸）
 * - agent-default-model 未指向本端点路由（含 dsh-vision-router 的
 *   `<route>-vision` 孪生视为已指向，孪生与本体共用凭据）时整节写
 *   { provider, model }（与官方 saveSelection 同形；root set 不触碰浏览器
 *   永远看不见的其他字段）；已指向时只把 model 对齐 glm-5.3，provider
 *   原样保留 —— 用户选的识图孪生不会被降级回本体
 *
 * @param {object|undefined} piAiSection llm-pi-ai 已解析分节
 * @param {object|undefined} defaultModelSection agent-default-model 已解析分节
 * @param {'cn'|'intl'} endpoint 账号端点；缺省 cn（与账号存储缺省一致）
 * @returns {{ ops: Array<{op:'set', path:string[], value:unknown}>, notes: string[] }}
 *   ops 为空 = 一切已就绪，无需写入；notes 是给前端展示的事实性说明键。
 */
export function planRouteProvision (piAiSection, defaultModelSection, endpoint) {
  const facts = ROUTES[endpoint === 'intl' ? 'intl' : 'cn']
  const ops = []
  const notes = []
  const existing = providersOf(piAiSection)[facts.route]
  if (!isPlainObject(existing)) {
    ops.push({ op: 'set', path: ['providers', facts.route], value: { apiKeyEnv: facts.ref, models: [DEFAULT_MODEL] } })
    notes.push('route-created')
  } else {
    const models = Array.isArray(existing.models) ? existing.models : null
    if (models !== null) {
      const idx = models.findIndex(x => isPlainObject(x) && x.id === DEFAULT_MODEL.id)
      if (idx < 0) {
        ops.push({ op: 'set', path: ['providers', facts.route, 'models'], value: models.concat([DEFAULT_MODEL]) })
        notes.push('model-appended')
      } else if (typeof models[idx].contextWindow !== 'number' || typeof models[idx].maxTokens !== 'number') {
        // 缺尺寸的裸条目：不补全会落到路由兜底 262144/32768；已带尺寸的条目
        // （含用户故意调小的）一律不动，用户在条目上的其他字段（input 等）保留
        const sized = models.slice()
        sized[idx] = Object.assign({}, models[idx], DEFAULT_MODEL)
        ops.push({ op: 'set', path: ['providers', facts.route, 'models'], value: sized })
        notes.push('model-detailed')
      }
    }
    if (existing.apiKeyEnv !== facts.ref) {
      ops.push({ op: 'set', path: ['providers', facts.route, 'apiKeyEnv'], value: facts.ref })
      notes.push('route-updated')
    }
    // baseURL 任何情况下都不写：已存在的路由要么声明了自己的端点，要么吃
    // pi-ai 目录的官方默认；新建路由也不携带 —— 写死会钉住地址，目录更新
    // 后不会跟进。
  }
  const adm = isPlainObject(defaultModelSection) ? defaultModelSection : undefined
  const provider = (adm !== undefined && typeof adm.provider === 'string') ? adm.provider : ''
  if (isRouteOrVisionTwin(provider, facts.route)) {
    // 已指向本体或识图孪生：provider 不动，只把模型对齐 glm-5.3
    if (adm.model !== DEFAULT_MODEL.id) {
      ops.push({ op: 'set', path: ['model'], value: DEFAULT_MODEL.id })
      notes.push('defaults-model')
    }
  } else {
    ops.push({ op: 'set', path: [], value: { provider: facts.route, model: DEFAULT_MODEL.id } })
    notes.push('defaults-switched')
  }
  return { ops, notes }
}

export function apply (ctx) {
  // ── 状态文件 I/O（temp + rename 原子替换，0600；写入串行化） ──
  let writeChain = Promise.resolve()

  async function loadState () {
    try {
      const text = await readFile(STATE_PATH, 'utf8')
      const v = JSON.parse(text)
      if (v && typeof v === 'object' && Array.isArray(v.accounts)) return v
    } catch (e) { /* 不存在或损坏 → 全新状态 */ }
    return { version: 1, accounts: [] }
  }

  async function persistState (state) {
    const run = async () => {
      await mkdir(dirname(STATE_PATH), { recursive: true })
      const tmp = STATE_PATH + '.tmp'
      await writeFile(tmp, JSON.stringify(state), { mode: 0o600 })
      await rename(tmp, STATE_PATH)
    }
    writeChain = writeChain.then(run, run)
    await writeChain
  }

  async function loadIndex () {
    return (await loadState()).accounts
  }

  async function saveIndex (accounts) {
    await persistState({ version: 1, accounts })
  }

  // ── 凭据（机密）读取：resolve() 返回 { value, source } | undefined ──
  async function readKey (keyId) {
    const hit = await ctx.credentials.resolve(keyRef(keyId))
    if (hit === undefined) return ''
    return String(hit.value)
  }

  /**
   * 「使用中」徽章的真值：当前默认模型路由（agent-default-model 的已解析
   * provider）落在哪条 GLM 编程路由上，就比对那条路由的凭据引用。识图
   * 孪生（`<route>-vision`，dsh-vision-router 注册、与本体共用凭据）按其
   * 本体路由归属。默认供应商不是两条 GLM 编程路由（含孪生）之一时，
   * 没有任何账号在使用中（顺带避免双端点并存时两个 ref 都有值而亮出两个
   * 徽章）。返回 null 表示不在。
   */
  function activeGlRoute () {
    const adm = ctx.settings.get(NS_DEFAULT_MODEL)
    const provider = isPlainObject(adm) ? String(adm.provider || '') : ''
    for (const facts of Object.values(ROUTES)) {
      if (isRouteOrVisionTwin(provider, facts.route)) return facts
    }
    return null
  }

  async function describeRef (ref) {
    try {
      const d = await ctx.credentials.describe(ref)
      return { configured: !!d.configured, source: d.source || null, writable: !!d.writable }
    } catch (e) { return null }
  }

  async function snapshot () {
    const list = await loadIndex()
    const active = activeGlRoute()
    let live = undefined
    if (active !== null) {
      const liveHit = await ctx.credentials.resolve(active.ref)
      live = (liveHit === undefined || liveHit.value === '') ? undefined : String(liveHit.value)
    }
    const accounts = []
    for (const a of list) {
      const key = await readKey(a.keyId || a.id)
      const route = ROUTES[a.endpoint || 'cn'].route
      accounts.push({
        id: a.id,
        name: a.name,
        endpoint: a.endpoint || 'cn',
        createdAt: a.createdAt || null,
        lastResult: a.lastResult || null,
        lastUpdated: a.lastUpdated || null,
        lastError: a.lastError || null,
        live: live !== undefined && key !== '' && active !== null && active.route === route && key === live,
      })
    }
    // 提示行（环境变量警告 / 未配置提示）针对当前生效路由的引用；默认模型
    // 不在 GLM 编程路由上时退回国内版引用，保持全新安装时的引导语义
    const liveInfo = await describeRef(active !== null ? active.ref : ROUTES.cn.ref)
    return { ok: true, accounts, liveInfo }
  }

  // ── 配额查询：Node 原生 fetch 直连（不经 ctx.shell，沙箱后端不可用也不受影响） ──
  async function refreshOne (a, m) {
    const keyId = a.keyId || a.id
    const key = await readKey(keyId)
    if (key === '') { a.lastError = m.noKey; return }
    const base = ENDPOINTS[a.endpoint || 'cn']
    try {
      const res = await fetch(base + '/api/monitor/usage/quota/limit', {
        headers: { authorization: key },
        signal: AbortSignal.timeout(20000),
      })
      let json
      try { json = await res.json() } catch (e) { throw new Error(fill(m.badResponse, { status: res.status })) }
      if (!res.ok || !json.success) throw new Error(json.msg || json.error || 'HTTP ' + res.status)
      const limits = (json.data && json.data.limits) || []
      const tokens = limits.filter(l => l.type === 'TOKENS_LIMIT')
      a.lastResult = {
        level: (json.data && json.data.level) || '',
        fiveHour: tokens.find(t => t.number === 5) || null,
        weekly: tokens.find(t => t.number !== 5) || null,
        monthlyMcp: limits.find(l => l.type === 'TIME_LIMIT') || null,
      }
      a.lastUpdated = Date.now()
      a.lastError = null
    } catch (e) {
      a.lastError = (e && e.message) || String(e)
    }
  }

  // ── 业务操作 ──
  async function opRefresh (args) {
    const m = msgs(args)
    const list = await loadIndex()
    const targets = (args && args.id) ? list.filter(a => a.id === args.id) : list
    await Promise.all(targets.map(a => refreshOne(a, m)))
    await saveIndex(list)
    return snapshot()
  }

  async function opSave (args) {
    const m = msgs(args)
    const name = String((args && args.name) || '').trim()
    const endpoint = (args && args.endpoint === 'intl') ? 'intl' : 'cn'
    const apiKey = String((args && args.apiKey) || '').trim()
    if (!name) return { ok: false, error: m.nameRequired }
    const list = await loadIndex()
    if (args && args.id) {
      const a = list.find(x => x.id === args.id)
      if (!a) return { ok: false, error: m.notFound }
      a.name = name
      a.endpoint = endpoint
      if (apiKey !== '') {
        if (!apiKey.includes('.')) return { ok: false, error: m.badKey }
        const nk = idFromKey(apiKey)
        const old = a.keyId || a.id
        if (nk !== old) {
          await ctx.credentials.set(keyRef(nk), apiKey)
          try { await ctx.credentials.unset(keyRef(old)) } catch (e) { /* absent */ }
          a.keyId = nk
        }
      }
    } else {
      if (!apiKey.includes('.')) return { ok: false, error: m.badKey }
      const keyId = idFromKey(apiKey)
      if (list.some(x => (x.keyId || x.id) === keyId)) return { ok: false, error: m.dupKey }
      await ctx.credentials.set(keyRef(keyId), apiKey)
      list.push({ id: keyId, keyId, name, endpoint, createdAt: Date.now(), lastResult: null, lastUpdated: null, lastError: null })
    }
    // 不排序：列表顺序由用户通过「上移/下移」拥有，新账号追加在末尾
    await saveIndex(list)
    return { ok: true }
  }

  async function opDelete (args) {
    const m = msgs(args)
    const list = await loadIndex()
    const i = list.findIndex(x => x.id === (args && args.id))
    if (i < 0) return { ok: false, error: m.notFound }
    try { await ctx.credentials.unset(keyRef(list[i].keyId || list[i].id)) } catch (e) { /* absent */ }
    list.splice(i, 1)
    await saveIndex(list)
    return { ok: true }
  }

  // 上移/下移（dir: -1 | 1）：顺序持久化到状态文件
  async function opMove (args) {
    const m = msgs(args)
    const dir = (args && args.dir === 1) ? 1 : -1
    const list = await loadIndex()
    const i = list.findIndex(x => x.id === (args && args.id))
    if (i < 0) return { ok: false, error: m.notFound }
    const j = i + dir
    if (j < 0 || j >= list.length) return { ok: false, error: m.atEdge }
    const moved = list.splice(i, 1)[0]
    list.splice(j, 0, moved)
    await saveIndex(list)
    return snapshot()
  }

  /**
   * 模型路由自动补齐：经 ctx.settings 把该端点的路由（cn → zai-coding-cn，
   * intl → zai）与默认模型补到可用（计划由 planRouteProvision 纯函数给出）。
   * settings.mutate 从「分节当前存储值」出发应用路径编辑，因此不会覆盖并发
   * 修改，也绝不会删除任何已有字段（另一端点的路由是 providers 下的兄弟
   * 键，路径编辑天然不碰）。补齐失败不影响凭据切换结果 —— error 由前端提示。
   */
  async function provisionRoute (endpoint) {
    const facts = ROUTES[endpoint === 'intl' ? 'intl' : 'cn']
    const plan = planRouteProvision(ctx.settings.get(NS_PI_AI), ctx.settings.get(NS_DEFAULT_MODEL), endpoint)
    // 按命名空间划分：路由补齐都在 providers/ 下，默认模型是根路径整节写
    const providerOps = plan.ops.filter(op => op.path[0] === 'providers')
    const defaultsOps = plan.ops.filter(op => op.path.length === 0)
    const errors = []
    if (providerOps.length > 0) {
      try { await ctx.settings.mutate(NS_PI_AI, providerOps) } catch (e) { errors.push(String((e && e.message) || e)) }
    }
    if (defaultsOps.length > 0) {
      try { await ctx.settings.mutate(NS_DEFAULT_MODEL, defaultsOps) } catch (e) { errors.push(String((e && e.message) || e)) }
    }
    // 失败的写入不上报 notes；错误原样透出，由前端本地化包裹提示。
    // route 随行返回，前端用它渲染 notes 文案（两条路由共用一套说明键）。
    return { applied: plan.ops.length, route: facts.route, notes: errors.length > 0 ? [] : plan.notes, error: errors.length > 0 ? errors.join('; ') : undefined }
  }

  async function opActivate (args) {
    const m = msgs(args)
    const list = await loadIndex()
    const a = list.find(x => x.id === (args && args.id))
    if (!a) return { ok: false, error: m.notFound }
    const endpoint = a.endpoint === 'intl' ? 'intl' : 'cn'
    const key = await readKey(a.keyId || a.id)
    if (key === '') return { ok: false, error: m.noKey }
    try {
      await ctx.credentials.set(ROUTES[endpoint].ref, key)
    } catch (e) {
      return { ok: false, error: m.writeFailed + ((e && e.message) || String(e)) }
    }
    let provision
    try {
      provision = await provisionRoute(endpoint)
    } catch (e) {
      provision = { applied: 0, route: ROUTES[endpoint].route, notes: [], error: String((e && e.message) || e) }
    }
    return { ok: true, provision }
  }

  // ── HTTP 面 ──
  function send (res, status, obj) {
    const body = JSON.stringify(obj)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(body)
  }

  function readBody (req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', c => {
        size += c.length
        if (size > (1 << 20)) { reject(new Error('body too large')); req.destroy(); return }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  const OPS = { state: snapshot, refresh: opRefresh, save: opSave, delete: opDelete, activate: opActivate, move: opMove }

  async function handle (req, res) {
    // 本地防线：自定义头（跨站简单请求无法携带）+ loopback Host（DNS rebinding）。
    if (req.headers[CLIENT_HEADER] !== '1') return send(res, 403, { ok: false, error: 'forbidden' })
    if (!LOOPBACK_HOST.test(String(req.headers.host || ''))) return send(res, 403, { ok: false, error: 'forbidden host' })
    const u = new URL(req.url, 'http://localhost')
    const sub = u.pathname.slice(API_PREFIX.length).replace(/^\/+/, '').replace(/\/+$/, '')
    const op = OPS[sub]
    if (op === undefined) return send(res, 404, { ok: false, error: 'not found' })
    let args = {}
    if (req.method === 'POST') {
      const raw = await readBody(req)
      if (raw !== '') { try { args = JSON.parse(raw) } catch (e) { return send(res, 400, { ok: false, error: 'bad json' }) } }
    }
    send(res, 200, await op(args))
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: (req, res) => {
      handle(req, res).catch(e => {
        try { send(res, 500, { ok: false, error: String((e && e.message) || e) }) } catch (e2) { /* already sent */ }
      })
    },
  }), 'zquota: /zquota-api routes')
}
