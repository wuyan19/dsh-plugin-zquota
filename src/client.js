/**
 * dsh-plugin-zquota — client half source.
 *
 * 设置面板「GLM 编程套餐」页：账号卡片（5 小时 / 每周 / MCP 月三格 meter、
 * 精确到小时/分钟的重置倒计式）、添加/编辑/删除、单账号与全量刷新、
 * 上移/下移排序、「设为当前」一键切换（host 侧同时自动补齐模型路由，
 * 响应携带 provision 结果供本页展示）。数据经同源 /zquota-api JSON API
 * 取自 host 半；API Key 明文永不进入浏览器。
 *
 * i18n：经 ctx.locale 注册 'zquota' 命名空间双语字典；t() 在调用时解析
 * 当前语言，语言切换经 subscribe 触发重渲染；当前语言随每个请求传给
 * host，用于其错误消息本地化。
 *
 * 经 tsdown 打成 lib/client.js（window.__ModuleLoader__.load 闭包工厂格式，
 * react/ui-slots 等为平台 external，由 loader 模块表解析）。
 */
import * as React from 'react'

export const inject = ['slots', 'timer', 'locale']

const NS = 'zquota'

// apply() 里赋值：组件树通过它们使用 ctx.interval / ctx.timeout / 字典
let clientCtx = null
let t = null

/** 简体中文字典（键集真源）。 */
const zh = {
  'nav.title': 'GLM 编程套餐',
  'action.refreshAll': '刷新全部',
  'action.refreshing': '刷新中…',
  'action.add': '添加账号',
  'action.use': '设为当前',
  'action.use.title': '写入该账号的 API Key 并自动补齐模型路由（API Key、glm-5.3、默认模型；端点用 DSH 内置默认），下一次请求生效',
  'action.refresh': '刷新',
  'action.edit': '编辑',
  'action.delete': '删除',
  'action.delete.confirm': '再次点击确认删除',
  'action.up': '上移',
  'action.down': '下移',
  'badge.live': '使用中',
  'meter.5h': '5 小时',
  'meter.weekly': '每周',
  'meter.mcp': 'MCP 月',
  'meter.5h.full': '5 小时额度',
  'meter.weekly.full': '每周额度',
  'meter.mcp.full': 'MCP 每月次数',
  'usage.detail': '各工具用量：\n{list}',
  'reset.at': '重置于 {time}',
  'reset.done': '已重置',
  'time.min': '{n} 分钟',
  'time.hour.min': '{h} 小时 {m} 分钟',
  'time.hour': '{h} 小时',
  'time.day.hour': '{d} 天 {h} 小时',
  'time.day': '{d} 天',
  'ago.now': '刚刚',
  'ago.min': '{n} 分钟前',
  'ago.hour': '{n} 小时前',
  'ago.day': '{n} 天前',
  'updated': '更新于 {ago}',
  'never.refreshed': '未刷新',
  'loading': '加载中…',
  'empty.title': '还没有账号',
  'field.name': '名称',
  'field.name.placeholder': '例如：工作账号',
  'field.key': 'API Key',
  'field.key.keep': 'id.secret（留空则保持不变）',
  'field.endpoint': '版本',
  'endpoint.cn': '国内版 open.bigmodel.cn',
  'endpoint.intl': '国际版 api.z.ai',
  'editor.cancel': '取消',
  'editor.save': '保存',
  'editor.saving': '保存中…',
  'err.comm': '通信失败：{msg}',
  'err.activate': '切换失败',
  'err.delete': '删除失败',
  'err.save': '保存失败',
  'err.provision': '账号已切换，但模型配置写入失败：{msg}',
  'provision.done': '已自动完成模型配置：{list}。',
  'provision.sep': '；',
  'provision.route-created': '新建 {route} 路由（API Key、glm-5.3，上下文 100 万 / 最大输出 128K；端点走 DSH 内置默认）',
  'provision.route-updated': '{route} 路由凭据引用已改指本面板写点',
  'provision.model-appended': '{route} 模型列表已追加 glm-5.3',
  'provision.model-detailed': '已为 glm-5.3 补全尺寸（上下文 1,000,000 / 最大输出 128,000）',
  'provision.defaults-switched': '默认模型已切换为 {route} / glm-5.3',
  'provision.defaults-model': '默认模型已对齐为 glm-5.3（当前路由保持不变）',
  'hint.env': '当前凭据来自进程环境变量，在面板内切换不会生效。',
  'hint.unset': '尚未配置 GLM 编程凭据，请选择一个账号点「设为当前」。',
}

/** 英文字典（键集与中文真源一致）。 */
const en = {
  'nav.title': 'GLM Coding Plan',
  'action.refreshAll': 'Refresh all',
  'action.refreshing': 'Refreshing…',
  'action.add': 'Add account',
  'action.use': 'Set active',
  'action.use.title': 'Write this account\u2019s API key and auto-provision the model route (API key, glm-5.3, default model; endpoint stays on the built-in default); effective on the next request',
  'action.refresh': 'Refresh',
  'action.edit': 'Edit',
  'action.delete': 'Delete',
  'action.delete.confirm': 'Click again to confirm deletion',
  'action.up': 'Move up',
  'action.down': 'Move down',
  'badge.live': 'Active',
  'meter.5h': '5-hour',
  'meter.weekly': 'Weekly',
  'meter.mcp': 'MCP/mo',
  'meter.5h.full': '5-hour window quota',
  'meter.weekly.full': 'Weekly quota',
  'meter.mcp.full': 'Monthly MCP usage',
  'usage.detail': 'Per-tool usage:\n{list}',
  'reset.at': 'Resets at {time}',
  'reset.done': 'Reset',
  'time.min': '{n}m',
  'time.hour.min': '{h}h {m}m',
  'time.hour': '{h}h',
  'time.day.hour': '{d}d {h}h',
  'time.day': '{d}d',
  'ago.now': 'just now',
  'ago.min': '{n}m ago',
  'ago.hour': '{n}h ago',
  'ago.day': '{n}d ago',
  'updated': 'Updated {ago}',
  'never.refreshed': 'Not refreshed',
  'loading': 'Loading…',
  'empty.title': 'No accounts yet',
  'field.name': 'Name',
  'field.name.placeholder': 'e.g. Work account',
  'field.key': 'API Key',
  'field.key.keep': 'id.secret (leave empty to keep)',
  'field.endpoint': 'Endpoint',
  'endpoint.cn': 'CN open.bigmodel.cn',
  'endpoint.intl': 'Intl api.z.ai',
  'editor.cancel': 'Cancel',
  'editor.save': 'Save',
  'editor.saving': 'Saving…',
  'err.comm': 'Request failed: {msg}',
  'err.activate': 'Switch failed',
  'err.delete': 'Delete failed',
  'err.save': 'Save failed',
  'err.provision': 'Account switched, but writing model settings failed: {msg}',
  'provision.done': 'Model settings auto-provisioned: {list}.',
  'provision.sep': '; ',
  'provision.route-created': 'created the {route} route (API key, glm-5.3; 1M context / 128K max output; endpoint stays on the built-in default)',
  'provision.route-updated': 're-pointed the {route} credential reference to this panel\u2019s write target',
  'provision.model-appended': 'appended glm-5.3 to the {route} model list',
  'provision.model-detailed': 'filled in glm-5.3 sizing (1,000,000 context / 128,000 max output)',
  'provision.defaults-switched': 'default model switched to {route} / glm-5.3',
  'provision.defaults-model': 'default model aligned to glm-5.3 (current route kept)',
  'hint.env': 'The active credential comes from the process environment; switching here will not take effect.',
  'hint.unset': 'No GLM coding credential is configured yet. Pick an account and click "Set active".',
}

const CSS = [
  '.gq-section{max-width:720px;display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary)}',
  '.gq-head{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap}',
  '.gq-title{margin:0;font-size:16px;font-weight:500;line-height:24px}',
  '.gq-headactions{display:flex;gap:6px;margin-left:auto;flex:none;align-items:center}',
  '.gq-btn{box-sizing:border-box;height:28px;font:inherit;cursor:pointer;border:none;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:0 12px;font-size:12px;line-height:18px}',
  '.gq-btn:disabled{opacity:.4;cursor:default}',
  '.gq-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
  '.gq-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
  '.gq-secondary{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:transparent}',
  '.gq-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
  '.gq-icon{width:26px;height:26px;padding:0;border-radius:6px;color:var(--dsw-alias-label-tertiary);background:transparent;border:none;font:inherit;font-size:12px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}',
  '.gq-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
  '.gq-icondanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}',
  '.gq-icon:disabled{opacity:.4;cursor:default}',
  '.gq-rows{display:flex;flex-direction:column;gap:8px;list-style:none;margin:0;padding:0}',
  '.gq-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}',
  '.gq-card.busy{opacity:.55;pointer-events:none}',
  '.gq-card.islive{border-color:var(--dsw-alias-brand-primary)}',
  '.gq-cardhead{display:flex;align-items:center;gap:8px;min-width:0}',
  '.gq-name{font-size:14px;font-weight:500;line-height:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.gq-tag{border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:4px;flex:none;padding:1px 6px;font-size:11px;line-height:16px}',
  '.gq-live{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-radius:4px;flex:none;padding:1px 6px;font-size:11px;line-height:16px}',
  '.gq-cardactions{display:inline-flex;align-items:center;gap:2px;margin-left:auto;flex:none}',
  '.gq-usebtn{height:24px;padding:0 10px;font-size:11px;line-height:16px;border-radius:12px}',
  '.gq-meters{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}',
  '.gq-cell{min-width:0;display:flex;flex-direction:column;gap:3px}',
  '.gq-cell-lbl{font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.gq-cell-val{font-family:var(--ds-font-family-code);font-size:14px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary)}',
  '.gq-unit{font-size:10px;font-weight:400;color:var(--dsw-alias-label-tertiary);margin-left:1px}',
  '.gq-track{height:3px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}',
  '.gq-fill{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-state-success-primary)}',
  '.gq-warn .gq-fill{background:var(--dsw-alias-state-warn-primary)}',
  '.gq-crit .gq-fill{background:var(--dsw-alias-state-error-primary)}',
  '.gq-cell-sub{font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default}',
  '.gq-reset{display:inline-flex;align-items:center;gap:3px;min-width:0;vertical-align:-2px}',
  '.gq-reset svg{width:11px;height:11px;flex:none;opacity:.75}',
  '.gq-err{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);word-break:break-word}',
  '.gq-warnline{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-label)}',
  '.gq-infoline{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
  '.gq-foot{display:flex;align-items:center;gap:8px;min-height:14px}',
  '.gq-ts{font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary)}',
  '.gq-empty{border:1px dashed var(--dsw-alias-border-l3);border-radius:10px;padding:28px 16px;display:flex;flex-direction:column;align-items:center;gap:12px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}',
  '.gq-editor{background:var(--dsw-alias-bg-module-platform);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
  '.gq-field{display:flex;flex-direction:column;gap:4px}',
  '.gq-fieldlabel{font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary)}',
  '.gq-input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);width:100%;height:30px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font-size:13px;line-height:20px}',
  '.gq-input:focus{border-color:var(--dsw-alias-brand-primary);outline:none}',
  '.gq-input::placeholder{color:var(--dsw-alias-label-dimmed)}',
  '.gq-mono{font-family:var(--ds-font-family-code);font-size:12px}',
  '.gq-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;width:fit-content}',
  '.gq-seg button{border:none;cursor:pointer;font:inherit;font-size:12px;line-height:18px;padding:5px 12px;background:transparent;color:var(--dsw-alias-label-secondary)}',
  '.gq-seg button.active{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
  '.gq-editoractions{display:flex;justify-content:flex-end;gap:6px;align-items:center}',
  '.gq-confirm{color:var(--dsw-alias-state-error-primary)!important;border-color:var(--dsw-alias-state-error-primary)!important}',
].join('\n')

// >1 天：天+小时；<1 天：小时+分钟；单位随字典本地化
function fmtReset (ms) {
  const diff = ms - Date.now()
  if (diff <= 0) return t('reset.done')
  const min = Math.floor(diff / 60000)
  if (min < 60) return t('time.min', { n: min })
  const hh = Math.floor(min / 60)
  if (hh < 24) {
    const mm = min % 60
    return mm > 0 ? t('time.hour.min', { h: hh, m: mm }) : t('time.hour', { h: hh })
  }
  const d = Math.floor(hh / 24)
  const r = hh % 24
  return r > 0 ? t('time.day.hour', { d, h: r }) : t('time.day', { d })
}

function timeAgo (ms) {
  const diff = Date.now() - ms
  if (diff < 60000) return t('ago.now')
  const m = Math.floor(diff / 60000)
  if (m < 60) return t('ago.min', { n: m })
  const hh = Math.floor(m / 60)
  if (hh < 24) return t('ago.hour', { n: hh })
  return t('ago.day', { n: Math.floor(hh / 24) })
}

const h = React.createElement
const LEVELS = { lite: 'Lite', pro: 'Pro', max: 'Max' }

// host activate 响应里 provision.notes 的白名单：未知键静默忽略，
// 防止旧 host / 新字典之间的键漂移把原始键名漏进界面文案
const PROVISION_NOTES = ['route-created', 'route-updated', 'model-appended', 'model-detailed', 'defaults-switched', 'defaults-model']

// 内联小时钟图标（平台图标库无 clock 类图标；11px、跟随 currentColor）
function ClockIcon () {
  return h('svg', { viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': 'true' },
    h('circle', { cx: 6, cy: 6, r: 5, stroke: 'currentColor', 'stroke-width': 1.2 }),
    h('path', { d: 'M6 3.4V6l1.9 1.2', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
}

function MeterCell (labelKey, fullKey, item) {
  if (!item) {
    return h('div', { className: 'gq-cell', key: labelKey },
      h('div', { className: 'gq-cell-lbl', title: t(fullKey) }, t(labelKey)),
      h('div', { className: 'gq-cell-val' }, '—'),
      h('div', { className: 'gq-track' }),
      h('div', { className: 'gq-cell-sub' }, '\u00a0'))
  }
  const pct = (typeof item.percentage === 'number') ? item.percentage : null
  const cls = (pct == null) ? '' : (pct >= 90 ? 'gq-crit' : (pct >= 70 ? 'gq-warn' : ''))
  const hasUsage = (typeof item.currentValue === 'number' && typeof item.usage === 'number')
  let title = null
  if (Array.isArray(item.usageDetails) && item.usageDetails.length > 0) {
    title = t('usage.detail', { list: item.usageDetails.map(r => r.modelCode + ': ' + r.usage).join('\n') })
  }
  const subChildren = []
  if (hasUsage) subChildren.push(item.currentValue + ' / ' + item.usage)
  if (item.nextResetTime) {
    if (subChildren.length > 0) subChildren.push(' · ')
    subChildren.push(h('span', {
      className: 'gq-reset',
      title: t('reset.at', { time: new Date(item.nextResetTime).toLocaleString() }),
    }, h(ClockIcon), fmtReset(item.nextResetTime)))
  }
  const width = (pct == null) ? 0 : Math.max(0, Math.min(100, pct))
  return h('div', { className: 'gq-cell' + (cls ? ' ' + cls : ''), key: labelKey, title: title || undefined },
    h('div', { className: 'gq-cell-lbl', title: t(fullKey) }, t(labelKey)),
    h('div', { className: 'gq-cell-val' }, pct == null ? '—' : String(pct), h('span', { className: 'gq-unit' }, '%')),
    h('div', { className: 'gq-track' }, h('span', { className: 'gq-fill', style: { width: width + '%' } })),
    h('div', { className: 'gq-cell-sub' }, subChildren.length > 0 ? subChildren : '\u00a0'))
}

function GlmSection (props) {
  const data0 = React.useState(null)
  const data = data0[0]
  const setData = data0[1]
  const err0 = React.useState(null)
  const err = err0[0]
  const setErr = err0[1]
  const busyAll0 = React.useState(false)
  const busyAll = busyAll0[0]
  const setBusyAll = busyAll0[1]
  const busyIds0 = React.useState({})
  const busyIds = busyIds0[0]
  const setBusyIds = busyIds0[1]
  const editor0 = React.useState(null)
  const editor = editor0[0]
  const setEditor = editor0[1]
  const edErr0 = React.useState(null)
  const edErr = edErr0[0]
  const setEdErr = edErr0[1]
  const saving0 = React.useState(false)
  const saving = saving0[0]
  const setSaving = saving0[1]
  const confirm0 = React.useState(null)
  const confirmId = confirm0[0]
  const setConfirmId = confirm0[1]
  const notes0 = React.useState({ notes: [], route: '' })
  const provisionNotes = notes0[0]
  const setProvisionNotes = notes0[1]
  const tick0 = React.useState(0)
  const setTick = tick0[1]

  // 每分钟重算倒计时 + 语言切换时重渲染（subscribe 返回退订函数）
  React.useEffect(() => clientCtx.interval(() => setTick(x => x + 1), 60000), [])
  React.useEffect(() => clientCtx.locale.subscribe(() => setTick(x => x + 1)), [])

  async function call (op, args) {
    try {
      const body = Object.assign({}, args === undefined ? {} : args)
      // 当前语言随请求传递，host 用它本地化错误消息
      try { body.lang = clientCtx.locale.getSnapshot().active } catch (e) { /* 缺省 zh */ }
      const res = await fetch('/zquota-api/' + op, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zquota-client': '1' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    } catch (e) {
      setErr(t('err.comm', { msg: String((e && e.message) || e) }))
      return null
    }
  }

  async function reload () {
    const d = await call('state')
    if (d && d.ok) setData(d)
  }

  React.useEffect(() => {
    let alive = true
    ;(async () => {
      const d = await call('state')
      if (!alive || !d || !d.ok) return
      setData(d)
      const stale = d.accounts.length > 0 && d.accounts.some(a => !a.lastUpdated || (Date.now() - a.lastUpdated) > 600000)
      if (stale) {
        setBusyAll(true)
        const r = await call('refresh')
        setBusyAll(false)
        if (alive && r && r.ok) setData(r)
      }
    })()
    return () => { alive = false }
  }, [])

  async function refreshAll () {
    setErr(null)
    setBusyAll(true)
    const r = await call('refresh')
    setBusyAll(false)
    if (r && r.ok) setData(r)
  }

  async function refreshSingle (a) {
    setErr(null)
    setBusyIds(p => { const n = Object.assign({}, p); n[a.id] = true; return n })
    const r = await call('refresh', { id: a.id })
    setBusyIds(p => { const n = Object.assign({}, p); delete n[a.id]; return n })
    if (r && r.ok) setData(r)
  }

  async function moveAccount (a, dir) {
    setErr(null)
    setBusyIds(p => { const n = Object.assign({}, p); n[a.id] = true; return n })
    const r = await call('move', { id: a.id, dir })
    setBusyIds(p => { const n = Object.assign({}, p); delete n[a.id]; return n })
    if (r && r.ok) setData(r)
  }

  async function activate (a) {
    setErr(null)
    const r = await call('activate', { id: a.id })
    if (!r) return
    if (!r.ok) { setErr(r.error || t('err.activate')); return }
    // host 在写凭据后顺带补齐模型路由；失败不回滚账号切换，仅提示。
    // route（zai-coding-cn / zai）随行返回，用于 notes 文案渲染。
    const p = r.provision
    if (p && p.error) setErr(t('err.provision', { msg: p.error }))
    setProvisionNotes({
      route: (p && typeof p.route === 'string') ? p.route : '',
      notes: (p && Array.isArray(p.notes)) ? p.notes.filter(n => PROVISION_NOTES.includes(n)) : [],
    })
    await reload()
  }

  async function removeAccount (a) {
    if (confirmId !== a.id) {
      setConfirmId(a.id)
      clientCtx.timeout(() => setConfirmId(c => (c === a.id ? null : c)), 4000)
      return
    }
    setConfirmId(null)
    setErr(null)
    const r = await call('delete', { id: a.id })
    if (!r) return
    if (!r.ok) { setErr(r.error || t('err.delete')); return }
    await reload()
  }

  function openEditor (a) {
    setEdErr(null)
    if (a === null) {
      setEditor({ id: null, name: '', apiKey: '', endpoint: 'cn' })
    } else {
      setEditor({ id: a.id, name: a.name, apiKey: '', endpoint: a.endpoint || 'cn' })
    }
  }

  async function saveEditor () {
    setEdErr(null)
    setSaving(true)
    // 仅编辑已有账号时携带 id，避免 undefined 混入 JSON
    const args = { name: editor.name, apiKey: editor.apiKey, endpoint: editor.endpoint }
    if (editor.id) args.id = editor.id
    const r = await call('save', args)
    setSaving(false)
    if (!r) return
    if (!r.ok) { setEdErr(r.error || t('err.save')); return }
    setEditor(null)
    await reload()
  }

  function renderRow (a, idx, arr) {
    const r = a.lastResult
    const level = r && r.level ? String(r.level).toLowerCase() : ''
    const levelLabel = LEVELS[level] || level
    const busy = !!busyIds[a.id]
    const confirming = confirmId === a.id
    return h('li', { className: 'gq-card' + (a.live ? ' islive' : '') + (busy ? ' busy' : ''), key: a.id },
      h('div', { className: 'gq-cardhead' },
        h('span', { className: 'gq-name' }, a.name),
        h('span', { className: 'gq-tag' }, a.endpoint === 'intl' ? 'INTL' : 'CN'),
        levelLabel ? h('span', { className: 'gq-tag' }, levelLabel) : null,
        a.live ? h('span', { className: 'gq-live' }, t('badge.live')) : null,
        h('span', { className: 'gq-cardactions' },
          h('button', { className: 'gq-icon', disabled: busy || idx === 0, title: t('action.up'), onClick: () => moveAccount(a, -1) }, '\u2191'),
          h('button', { className: 'gq-icon', disabled: busy || idx === arr.length - 1, title: t('action.down'), onClick: () => moveAccount(a, 1) }, '\u2193'),
          a.live ? null : h('button', {
            className: 'gq-btn gq-secondary gq-usebtn',
            disabled: busy,
            title: t('action.use.title'),
            onClick: () => activate(a),
          }, t('action.use')),
          h('button', { className: 'gq-icon', disabled: busy, title: t('action.refresh'), onClick: () => refreshSingle(a) }, '\u21bb'),
          h('button', { className: 'gq-icon', disabled: busy, title: t('action.edit'), onClick: () => openEditor(a) }, '\u270e'),
          h('button', {
            className: 'gq-icon gq-icondanger' + (confirming ? ' gq-confirm' : ''),
            disabled: busy,
            title: confirming ? t('action.delete.confirm') : t('action.delete'),
            onClick: () => removeAccount(a),
          }, confirming ? '\u2713' : '\u2715'))),
      (r || a.lastError) ? h('div', { className: 'gq-meters' },
        MeterCell('meter.5h', 'meter.5h.full', r && r.fiveHour),
        MeterCell('meter.weekly', 'meter.weekly.full', r && r.weekly),
        MeterCell('meter.mcp', 'meter.mcp.full', r && r.monthlyMcp)) : null,
      a.lastError ? h('p', { className: 'gq-err' }, a.lastError) : null,
      h('div', { className: 'gq-foot' },
        h('span', { className: 'gq-ts' }, a.lastUpdated ? t('updated', { ago: timeAgo(a.lastUpdated) }) : t('never.refreshed'))))
  }

  function renderEditor () {
    return h('div', { className: 'gq-editor', key: 'editor' },
      h('div', { className: 'gq-field' },
        h('span', { className: 'gq-fieldlabel' }, t('field.name')),
        h('input', {
          className: 'gq-input',
          value: editor.name,
          placeholder: t('field.name.placeholder'),
          autoComplete: 'off',
          onChange: e => setEditor(Object.assign({}, editor, { name: e.target.value })),
        })),
      h('div', { className: 'gq-field' },
        h('span', { className: 'gq-fieldlabel' }, t('field.key')),
        h('input', {
          className: 'gq-input gq-mono',
          value: editor.apiKey,
          placeholder: editor.id ? t('field.key.keep') : 'id.secret',
          autoComplete: 'off',
          spellCheck: false,
          onChange: e => setEditor(Object.assign({}, editor, { apiKey: e.target.value })),
        })),
      h('div', { className: 'gq-field' },
        h('span', { className: 'gq-fieldlabel' }, t('field.endpoint')),
        h('div', { className: 'gq-seg' },
          h('button', {
            className: editor.endpoint === 'cn' ? 'active' : '',
            onClick: () => setEditor(Object.assign({}, editor, { endpoint: 'cn' })),
          }, t('endpoint.cn')),
          h('button', {
            className: editor.endpoint === 'intl' ? 'active' : '',
            onClick: () => setEditor(Object.assign({}, editor, { endpoint: 'intl' })),
          }, t('endpoint.intl')))),
      edErr ? h('p', { className: 'gq-err' }, edErr) : null,
      h('div', { className: 'gq-editoractions' },
        h('button', { className: 'gq-btn gq-secondary', disabled: saving, onClick: () => setEditor(null) }, t('editor.cancel')),
        h('button', { className: 'gq-btn gq-primary', disabled: saving, onClick: saveEditor }, saving ? t('editor.saving') : t('editor.save'))))
  }

  const accounts = data ? data.accounts : []
  const liveInfo = data ? data.liveInfo : null
  let liveHint = null
  if (liveInfo && liveInfo.source === 'env') {
    liveHint = h('p', { className: 'gq-warnline' }, t('hint.env'))
  } else if (liveInfo && !liveInfo.configured) {
    liveHint = h('p', { className: 'gq-warnline' }, t('hint.unset'))
  }
  const provisionLine = provisionNotes.notes.length > 0
    ? h('p', { className: 'gq-infoline' }, t('provision.done', {
        list: provisionNotes.notes
          .map(n => t('provision.' + n, { route: provisionNotes.route || 'zai-coding-cn' }))
          .join(t('provision.sep')),
      }))
    : null

  return h('div', { className: 'gq-section' },
    h('div', { className: 'gq-head' },
      h('div', null,
        h('h3', { className: 'gq-title' }, t('nav.title'))),
      h('div', { className: 'gq-headactions' },
        h('button', {
          className: 'gq-btn gq-secondary',
          disabled: busyAll || !data || accounts.length === 0,
          onClick: refreshAll,
        }, busyAll ? t('action.refreshing') : t('action.refreshAll')),
        h('button', { className: 'gq-btn gq-primary', onClick: () => openEditor(null) }, t('action.add')))),
    err ? h('p', { className: 'gq-err' }, err) : null,
    liveHint,
    provisionLine,
    editor ? renderEditor() : null,
    data === null
      ? h('p', { className: 'gq-ts' }, t('loading'))
      : (accounts.length === 0
          ? h('div', { className: 'gq-empty' },
              h('div', null, t('empty.title')),
              h('button', { className: 'gq-btn gq-primary', onClick: () => openEditor(null) }, t('action.add')))
          : h('ul', { className: 'gq-rows' }, accounts.map(renderRow))))
}

export function apply (ctx) {
  clientCtx = ctx
  t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'zquota: dictionaries')

  const slots = ctx.get('slots')
  if (slots === undefined) return

  // 自管样式标签：静态包没有动态 runner 的 styles builtin，与官方 CSS 注入
  // 同构（data-plugin 标记），effect 清理保证可逆。
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-plugin-zquota'
    tag.dataset.pluginCss = 'dsh-plugin-zquota/styles'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => tag.remove()
  }, 'zquota: styles')

  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'glm-quota', order: 12, label: () => t('nav.title') },
    GlmSection,
  ))
}
