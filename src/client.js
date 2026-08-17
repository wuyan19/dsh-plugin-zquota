/**
 * dsh-plugin-zquota — client half source.
 *
 * 设置面板「GLM 编程套餐」页：账号卡片（5 小时 / 每周 / MCP 月三格 meter、
 * 精确到小时/分钟的重置倒计式）、添加/编辑/删除、单账号与全量刷新、
 * 「设为当前」一键切换。数据经同源 /zquota-api JSON API 取自 host 半；
 * API Key 明文永不进入浏览器。
 *
 * 经 tsdown 打成 lib/client.js（window.__ModuleLoader__.load 闭包工厂格式，
 * react/ui-slots 等为平台 external，由 loader 模块表解析）。
 */
import * as React from 'react'

export const inject = ['slots', 'timer']

// apply() 里赋值：组件树通过它使用 ctx.interval / ctx.timeout
let clientCtx = null

const CSS = [
  '.gq-section{max-width:720px;display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary)}',
  '.gq-head{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap}',
  '.gq-title{margin:0;font-size:16px;font-weight:500;line-height:24px}',
  '.gq-sub{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
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

// >1 天：天+小时；<1 天：小时+分钟
function fmtReset (ms) {
  const diff = ms - Date.now()
  if (diff <= 0) return '已重置'
  const min = Math.floor(diff / 60000)
  if (min < 60) return min + ' 分钟'
  const hh = Math.floor(min / 60)
  if (hh < 24) {
    const mm = min % 60
    return mm > 0 ? (hh + ' 小时 ' + mm + ' 分钟') : (hh + ' 小时')
  }
  const d = Math.floor(hh / 24)
  const r = hh % 24
  return r > 0 ? (d + ' 天 ' + r + ' 小时') : (d + ' 天')
}

function timeAgo (ms) {
  const diff = Date.now() - ms
  if (diff < 60000) return '刚刚'
  const m = Math.floor(diff / 60000)
  if (m < 60) return m + ' 分钟前'
  const hh = Math.floor(m / 60)
  if (hh < 24) return hh + ' 小时前'
  return Math.floor(hh / 24) + ' 天前'
}

const h = React.createElement
const LEVELS = { lite: 'Lite', pro: 'Pro', max: 'Max' }

// 内联小时钟图标（平台图标库无 clock 类图标；11px、跟随 currentColor）
function ClockIcon () {
  return h('svg', { viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': 'true' },
    h('circle', { cx: 6, cy: 6, r: 5, stroke: 'currentColor', 'stroke-width': 1.2 }),
    h('path', { d: 'M6 3.4V6l1.9 1.2', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
}

function MeterCell (label, item) {
  if (!item) {
    return h('div', { className: 'gq-cell', key: label },
      h('div', { className: 'gq-cell-lbl' }, label),
      h('div', { className: 'gq-cell-val' }, '—'),
      h('div', { className: 'gq-track' }),
      h('div', { className: 'gq-cell-sub' }, '\u00a0'))
  }
  const pct = (typeof item.percentage === 'number') ? item.percentage : null
  const cls = (pct == null) ? '' : (pct >= 90 ? 'gq-crit' : (pct >= 70 ? 'gq-warn' : ''))
  const hasUsage = (typeof item.currentValue === 'number' && typeof item.usage === 'number')
  let title = null
  if (Array.isArray(item.usageDetails) && item.usageDetails.length > 0) {
    title = '各工具用量：\n' + item.usageDetails.map(r => r.modelCode + '：' + r.usage).join('\n')
  }
  const subChildren = []
  if (hasUsage) subChildren.push(item.currentValue + ' / ' + item.usage)
  if (item.nextResetTime) {
    if (subChildren.length > 0) subChildren.push(' · ')
    subChildren.push(h('span', { className: 'gq-reset', title: '重置于 ' + new Date(item.nextResetTime).toLocaleString() },
      h(ClockIcon), fmtReset(item.nextResetTime)))
  }
  const width = (pct == null) ? 0 : Math.max(0, Math.min(100, pct))
  return h('div', { className: 'gq-cell' + (cls ? ' ' + cls : ''), key: label, title: title || undefined },
    h('div', { className: 'gq-cell-lbl' }, label),
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
  const tick0 = React.useState(0)
  const setTick = tick0[1]

  // 每分钟强制重算倒计时（状态自增触发重渲染）
  React.useEffect(() => clientCtx.interval(() => setTick(t => t + 1), 60000), [])

  async function call (op, args) {
    try {
      const res = await fetch('/zquota-api/' + op, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zquota-client': '1' },
        body: JSON.stringify(args === undefined ? {} : args),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    } catch (e) {
      setErr('通信失败：' + String((e && e.message) || e))
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
    if (!r.ok) { setErr(r.error || '切换失败'); return }
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
    if (!r.ok) { setErr(r.error || '删除失败'); return }
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
    if (!r.ok) { setEdErr(r.error || '保存失败'); return }
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
        a.live ? h('span', { className: 'gq-live' }, '使用中') : null,
        h('span', { className: 'gq-cardactions' },
          h('button', { className: 'gq-icon', disabled: busy || idx === 0, title: '上移', onClick: () => moveAccount(a, -1) }, '\u2191'),
          h('button', { className: 'gq-icon', disabled: busy || idx === arr.length - 1, title: '下移', onClick: () => moveAccount(a, 1) }, '\u2193'),
          a.live ? null : h('button', {
            className: 'gq-btn gq-secondary gq-usebtn',
            disabled: busy,
            title: '把该账号的 API Key 写入 ZAI_CODING_CN_API_KEY，下一次请求生效',
            onClick: () => activate(a),
          }, '设为当前'),
          h('button', { className: 'gq-icon', disabled: busy, title: '刷新', onClick: () => refreshSingle(a) }, '\u21bb'),
          h('button', { className: 'gq-icon', disabled: busy, title: '编辑', onClick: () => openEditor(a) }, '\u270e'),
          h('button', {
            className: 'gq-icon gq-icondanger' + (confirming ? ' gq-confirm' : ''),
            disabled: busy,
            title: confirming ? '再次点击确认删除' : '删除',
            onClick: () => removeAccount(a),
          }, confirming ? '\u2713' : '\u2715'))),
      (r || a.lastError) ? h('div', { className: 'gq-meters' },
        MeterCell('5 小时', r && r.fiveHour),
        MeterCell('每周', r && r.weekly),
        MeterCell('MCP 月', r && r.monthlyMcp)) : null,
      a.lastError ? h('p', { className: 'gq-err' }, a.lastError) : null,
      h('div', { className: 'gq-foot' },
        h('span', { className: 'gq-ts' }, a.lastUpdated ? ('更新于 ' + timeAgo(a.lastUpdated)) : '未刷新')))
  }

  function renderEditor () {
    return h('div', { className: 'gq-editor', key: 'editor' },
      h('div', { className: 'gq-field' },
        h('span', { className: 'gq-fieldlabel' }, '名称'),
        h('input', {
          className: 'gq-input',
          value: editor.name,
          placeholder: '例如：工作账号',
          autoComplete: 'off',
          onChange: e => setEditor(Object.assign({}, editor, { name: e.target.value })),
        })),
      h('div', { className: 'gq-field' },
        h('span', { className: 'gq-fieldlabel' }, 'API Key'),
        h('input', {
          className: 'gq-input gq-mono',
          value: editor.apiKey,
          placeholder: editor.id ? 'id.secret（留空则保持不变）' : 'id.secret',
          autoComplete: 'off',
          spellCheck: false,
          onChange: e => setEditor(Object.assign({}, editor, { apiKey: e.target.value })),
        })),
      h('div', { className: 'gq-field' },
        h('span', { className: 'gq-fieldlabel' }, '版本'),
        h('div', { className: 'gq-seg' },
          h('button', {
            className: editor.endpoint === 'cn' ? 'active' : '',
            onClick: () => setEditor(Object.assign({}, editor, { endpoint: 'cn' })),
          }, '国内版 open.bigmodel.cn'),
          h('button', {
            className: editor.endpoint === 'intl' ? 'active' : '',
            onClick: () => setEditor(Object.assign({}, editor, { endpoint: 'intl' })),
          }, '国际版 api.z.ai'))),
      edErr ? h('p', { className: 'gq-err' }, edErr) : null,
      h('div', { className: 'gq-editoractions' },
        h('button', { className: 'gq-btn gq-secondary', disabled: saving, onClick: () => setEditor(null) }, '取消'),
        h('button', { className: 'gq-btn gq-primary', disabled: saving, onClick: saveEditor }, saving ? '保存中…' : '保存')))
  }

  const accounts = data ? data.accounts : []
  const liveInfo = data ? data.liveInfo : null
  let liveHint = null
  if (liveInfo && liveInfo.source === 'env') {
    liveHint = h('p', { className: 'gq-warnline' }, '当前凭据来自进程环境变量（ZAI_CODING_CN_API_KEY），在面板内切换不会生效。')
  } else if (liveInfo && !liveInfo.configured) {
    liveHint = h('p', { className: 'gq-warnline' }, '尚未配置 ZAI_CODING_CN_API_KEY，请选择一个账号点「设为当前」。')
  }

  return h('div', { className: 'gq-section' },
    h('div', { className: 'gq-head' },
      h('div', null,
        h('h3', { className: 'gq-title' }, 'GLM 编程套餐'),
        h('p', { className: 'gq-sub' }, '智谱 Coding Plan 用量监控 · 「设为当前」切换账号，下一次请求即生效')),
      h('div', { className: 'gq-headactions' },
        h('button', {
          className: 'gq-btn gq-secondary',
          disabled: busyAll || !data || accounts.length === 0,
          onClick: refreshAll,
        }, busyAll ? '刷新中…' : '刷新全部'),
        h('button', { className: 'gq-btn gq-primary', onClick: () => openEditor(null) }, '添加账号'))),
    err ? h('p', { className: 'gq-err' }, err) : null,
    liveHint,
    editor ? renderEditor() : null,
    data === null
      ? h('p', { className: 'gq-ts' }, '加载中…')
      : (accounts.length === 0
          ? h('div', { className: 'gq-empty' },
              h('div', null, '还没有账号'),
              h('button', { className: 'gq-btn gq-primary', onClick: () => openEditor(null) }, '添加账号'))
          : h('ul', { className: 'gq-rows' }, accounts.map(renderRow))))
}

export function apply (ctx) {
  clientCtx = ctx
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
    { name: 'settings.section', id: 'glm-quota', order: 12, label: 'GLM 编程套餐' },
    GlmSection,
  ))
}
