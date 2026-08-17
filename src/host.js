/**
 * dsh-plugin-zquota — host half (plain ESM, no build step).
 *
 * GLM Coding Plan 账号面板的宿主侧：
 * - API Key（机密）存于 $DSH_HOME/.credentials.yaml（经 ctx.credentials，
 *   条目 ZAI_QUOTA_KEY_<id> 每账号一条）——凭据库只放真机密
 * - 账号索引、名称、额度快照（非机密状态）存于插件自有状态文件
 *   $DSH_HOME/zquota-state.json（0600、temp+rename 原子写），
 *   含一次性迁移：旧版曾把索引放进凭据文件（ZAI_QUOTA_ACCOUNTS）
 * - 配额查询经 ctx.shell 调 curl 直连智谱端点；API Key 只经环境变量注入，
 *   绝不进入命令行参数
 * - 「设为当前」= 写 ZAI_CODING_CN_API_KEY，llm-pi-ai 每请求重新解析凭据，
 *   下一次模型请求即生效，无需重启
 * - 浏览器半通过 webServer 前缀路由 /zquota-api 以同源 JSON API 通信
 *   （静态包没有动态插件的包私有 RPC 通道，同源 fetch 是等价替代）
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { env } from 'node:process'

export const inject = ['credentials', 'shell', 'webServer']

const ENDPOINTS = { cn: 'https://open.bigmodel.cn', intl: 'https://api.z.ai' }
const LIVE_REF = 'ZAI_CODING_CN_API_KEY'
const LEGACY_INDEX_REF = 'ZAI_QUOTA_ACCOUNTS'
const API_PREFIX = '/zquota-api'
const CLIENT_HEADER = 'x-zquota-client'
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i

/** 插件自有状态文件：非机密的账号索引与额度快照。 */
const STATE_PATH = join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'zquota-state.json')

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

  // ── 一次性迁移：旧版把非机密索引存进凭据文件（ZAI_QUOTA_ACCOUNTS）。
  //    API Key 条目（ZAI_QUOTA_KEY_*）不受影响，留在凭据库。 ──
  async function migrateLegacyIndex () {
    try { await readFile(STATE_PATH, 'utf8'); return } catch (e) { /* 状态文件不存在 → 检查迁移源 */ }
    const hit = await ctx.credentials.resolve(LEGACY_INDEX_REF)
    if (hit === undefined) return
    let list = []
    try {
      const v = JSON.parse(String(hit.value))
      if (Array.isArray(v)) list = v
    } catch (e) { /* 解析失败 → 放弃迁移，从空列表开始 */ }
    await persistState({ version: 1, accounts: list })
    try { await ctx.credentials.unset(LEGACY_INDEX_REF) } catch (e) { /* 只读源遮蔽等场景：留着无害 */ }
    if (list.length > 0) console.log('zquota: migrated', list.length, 'account record(s) from credentials store to', STATE_PATH)
  }

  const ready = migrateLegacyIndex()

  async function loadIndex () {
    await ready
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

  async function snapshot () {
    const list = await loadIndex()
    const liveHit = await ctx.credentials.resolve(LIVE_REF)
    const live = (liveHit === undefined || liveHit.value === '') ? undefined : String(liveHit.value)
    const accounts = []
    for (const a of list) {
      const key = await readKey(a.keyId || a.id)
      accounts.push({
        id: a.id,
        name: a.name,
        endpoint: a.endpoint || 'cn',
        createdAt: a.createdAt || null,
        lastResult: a.lastResult || null,
        lastUpdated: a.lastUpdated || null,
        lastError: a.lastError || null,
        live: live !== undefined && key !== '' && key === live,
      })
    }
    let liveInfo = null
    try {
      const d = await ctx.credentials.describe(LIVE_REF)
      liveInfo = { configured: !!d.configured, source: d.source || null, writable: !!d.writable }
    } catch (e) { liveInfo = null }
    return { ok: true, accounts, liveInfo }
  }

  // ── 配额查询：key 经环境变量注入，绝不进入命令行参数 ──
  let curlPath = '/usr/bin/curl'
  const curlReady = (async () => {
    try {
      const subprocess = ctx.get('subprocess')
      if (subprocess !== undefined) curlPath = await subprocess.resolveExecutable('curl')
    } catch (e) { /* 保持默认绝对路径 */ }
  })()

  async function refreshOne (a) {
    const keyId = a.keyId || a.id
    const key = await readKey(keyId)
    if (key === '') { a.lastError = '未存储 API Key'; return }
    const base = ENDPOINTS[a.endpoint || 'cn']
    try {
      await curlReady
      const spec = ctx.shell.resolve({
        command: curlPath + ' -sS -m 20 -H "Authorization: $ZQ_KEY" "$ZQ_URL/api/monitor/usage/quota/limit"',
        env: { ZQ_KEY: key, ZQ_URL: base },
        timeoutMs: 30000,
        stdoutMaxBytes: 65536,
      })
      const res = await ctx.shell.run(spec)
      if (res.exitCode !== 0) {
        throw new Error('curl 退出码 ' + res.exitCode + (res.stderr && res.stderr.text ? '：' + res.stderr.text.slice(0, 120) : ''))
      }
      let json
      try { json = JSON.parse(res.stdout.text) } catch (e) { throw new Error('响应非 JSON') }
      if (!json.success) throw new Error(json.msg || json.error || '查询失败')
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
    const list = await loadIndex()
    const targets = (args && args.id) ? list.filter(a => a.id === args.id) : list
    await Promise.all(targets.map(refreshOne))
    await saveIndex(list)
    return snapshot()
  }

  async function opSave (args) {
    const name = String((args && args.name) || '').trim()
    const endpoint = (args && args.endpoint === 'intl') ? 'intl' : 'cn'
    const apiKey = String((args && args.apiKey) || '').trim()
    if (!name) return { ok: false, error: '请填写名称' }
    const list = await loadIndex()
    if (args && args.id) {
      const a = list.find(x => x.id === args.id)
      if (!a) return { ok: false, error: '账号不存在' }
      a.name = name
      a.endpoint = endpoint
      if (apiKey !== '') {
        if (!apiKey.includes('.')) return { ok: false, error: 'API Key 格式应为 id.secret' }
        const nk = idFromKey(apiKey)
        const old = a.keyId || a.id
        if (nk !== old) {
          await ctx.credentials.set(keyRef(nk), apiKey)
          try { await ctx.credentials.unset(keyRef(old)) } catch (e) { /* absent */ }
          a.keyId = nk
        }
      }
    } else {
      if (!apiKey.includes('.')) return { ok: false, error: 'API Key 格式应为 id.secret' }
      const keyId = idFromKey(apiKey)
      if (list.some(x => (x.keyId || x.id) === keyId)) return { ok: false, error: '该 API Key 已存在' }
      await ctx.credentials.set(keyRef(keyId), apiKey)
      list.push({ id: keyId, keyId, name, endpoint, createdAt: Date.now(), lastResult: null, lastUpdated: null, lastError: null })
    }
    list.sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0))
    await saveIndex(list)
    return { ok: true }
  }

  async function opDelete (args) {
    const list = await loadIndex()
    const i = list.findIndex(x => x.id === (args && args.id))
    if (i < 0) return { ok: false, error: '账号不存在' }
    try { await ctx.credentials.unset(keyRef(list[i].keyId || list[i].id)) } catch (e) { /* absent */ }
    list.splice(i, 1)
    await saveIndex(list)
    return { ok: true }
  }

  async function opActivate (args) {
    const list = await loadIndex()
    const a = list.find(x => x.id === (args && args.id))
    if (!a) return { ok: false, error: '账号不存在' }
    if ((a.endpoint || 'cn') !== 'cn') return { ok: false, error: '国际版账号暂不支持切换（未配置国际版模型路由）' }
    const key = await readKey(a.keyId || a.id)
    if (key === '') return { ok: false, error: '未存储 API Key' }
    try {
      await ctx.credentials.set(LIVE_REF, key)
    } catch (e) {
      return { ok: false, error: '写入凭据失败：' + ((e && e.message) || String(e)) }
    }
    return { ok: true }
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

  const OPS = { state: snapshot, refresh: opRefresh, save: opSave, delete: opDelete, activate: opActivate }

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
