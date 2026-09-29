import React, { useCallback, useEffect, useState } from 'react'
import type { PluginInfo, PluginListResult } from '../../../../shared/types'

/* ==================================================================
   插件 —— 用户可扩展能力
   丢一个文件夹进 %APPDATA%/shorekeeper-agent/plugins/<插件id>/ 就能用，
   也可以在下面点「导入插件」把一个现成的文件夹复制进来。
   每个插件渲染成一张卡片：图标（清单里的 icon，没有就首字母占位）+ 名称 +
   版本/作者 + 说明，下面是开关、逐条命令的运行按钮与删除。
   ================================================================== */

function placeholderLetter(name: string): string {
  const ch = (name || '?').trim().charAt(0)
  return ch || '?'
}

function placeholderHue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

export default function PluginSection(): React.ReactElement {
  const [data, setData] = useState<PluginListResult | null>(null)
  const [busy, setBusy] = useState('')
  const [flash, setFlash] = useState('')
  const [err, setErr] = useState('')
  const [outputs, setOutputs] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [logFor, setLogFor] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const res = await window.aimis.plugin.list()
    if (res.ok && res.data) setData(res.data)
    else setErr(res.error ?? '读取插件列表失败')
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const say = (text: string, isErr = false): void => {
    if (isErr) {
      setErr(text)
      setFlash('')
    } else {
      setFlash(text)
      setErr('')
    }
    window.setTimeout(() => (isErr ? setErr('') : setFlash('')), 2600)
  }

  const applyList = (res: { ok: boolean; data?: PluginListResult | null; error?: string }): void => {
    if (res.ok && res.data) {
      setData(res.data)
      return
    }
    if (res.ok) return
    say(res.error ?? '操作失败', true)
  }

  const doImport = async (): Promise<void> => {
    setBusy('import')
    try {
      const res = await window.aimis.plugin.importFolder()
      if (!res.ok) {
        say(res.error ?? '导入失败', true)
        return
      }
      if (!res.data) return // 用户取消
      setData(res.data.list)
      say(`${res.data.replaced ? '已覆盖并导入' : '已导入'}：${res.data.plugin?.manifest.name ?? ''}`)
    } finally {
      setBusy('')
    }
  }

  const doToggle = async (p: PluginInfo): Promise<void> => {
    setBusy('toggle:' + p.manifest.id)
    try {
      applyList(await window.aimis.plugin.toggle(p.manifest.id, !p.enabled))
    } finally {
      setBusy('')
    }
  }

  const doRemove = async (p: PluginInfo): Promise<void> => {
    if (!window.confirm(`确定删除插件「${p.manifest.name}」？目录会被整个删掉，此操作不可撤销。`)) return
    setBusy('remove:' + p.manifest.id)
    try {
      applyList(await window.aimis.plugin.remove(p.manifest.id))
      say(`已删除：${p.manifest.name}`)
    } finally {
      setBusy('')
    }
  }

  const doRun = async (p: PluginInfo, command: string): Promise<void> => {
    const key = `${p.manifest.id}:${command}`
    setBusy(key)
    try {
      const res = await window.aimis.plugin.invoke(p.manifest.id, command, {})
      if (!res.ok) {
        setOutputs((prev) => ({ ...prev, [key]: { ok: false, text: '调用失败：' + (res.error ?? '未知错误') } }))
        return
      }
      const r = res.data
      if (!r) {
        setOutputs((prev) => ({ ...prev, [key]: { ok: false, text: '没有返回数据' } }))
        return
      }
      setOutputs((prev) => ({
        ...prev,
        [key]: {
          ok: r.ok,
          text: r.ok ? formatResult(r.result) + `  （${r.ms}ms）` : '插件报错：' + (r.error ?? '未知错误')
        }
      }))
    } finally {
      setBusy('')
    }
  }

  const doReveal = async (id?: string): Promise<void> => {
    const res = await window.aimis.plugin.reveal(id)
    if (!res.ok) say(res.error ?? '打开目录失败', true)
  }

  const plugins = data?.plugins ?? []
  const broken = data?.broken ?? []
  const enabledCount = plugins.filter((p) => p.enabled).length

  return (
    <>
      <div className="sec-title">插件</div>
      <div className="sec-desc">
        把一个文件夹丢进 <span className="mono">{data?.dir ?? '%APPDATA%/shorekeeper-agent/plugins'}</span>，
        里面放 <span className="mono">plugin.json</span> 和入口 JS，就能在这里启用、运行。
        插件脚本跑在受限沙箱里（没有 require / process / fs）。
      </div>

      {/* 工具栏 */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            已安装（{enabledCount}/{plugins.length} 已启用）
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn sm"
              data-testid="plugin-refresh"
              onClick={() => void load()}
              title="重新扫描插件目录（刚复制进来的文件夹点这里就能看到）"
            >
              刷新
            </button>
            <button
              className="btn sm"
              data-testid="plugin-open-dir"
              onClick={() => void doReveal()}
              title="在资源管理器里打开插件目录"
            >
              打开插件目录
            </button>
            <button
              className="btn sm primary"
              data-testid="plugin-import"
              disabled={busy === 'import'}
              onClick={() => void doImport()}
            >
              {busy === 'import' ? '导入中…' : '＋ 导入插件'}
            </button>
          </div>
        </div>

        <div className="field-hint">
          导入会把你选中的文件夹整体复制到用户插件目录，原文件夹不受影响。同名插件会被覆盖。
        </div>

        {(flash || err) && (
          <div
            data-testid="plugin-flash"
            style={{ fontSize: 12.5, marginTop: 10, color: err ? 'var(--err)' : 'var(--ok)' }}
          >
            {err || flash}
          </div>
        )}
      </div>

      {/* 插件卡片列表：图标 + 文字说明 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
        {plugins.length === 0 && (
          <div className="card card-pad" style={{ fontSize: 12.5, color: 'var(--text-4)' }}>
            还没有插件。点上面的「＋ 导入插件」选一个插件文件夹，或者自己写一个丢进插件目录。
          </div>
        )}

        {plugins.map((p) => {
          const m = p.manifest
          const logsOpen = logFor === m.id
          const hue = placeholderHue(m.id)
          return (
            <div key={m.id} className="card card-pad" data-plugin-id={m.id} data-plugin-enabled={p.enabled}>
              {/* 封面行：左图标 / 右名称 · 版本 · 作者 · 说明 */}
              <div className="row" style={{ gap: 14, alignItems: 'flex-start', marginBottom: 12 }}>
                {p.iconUrl ? (
                  <img
                    src={p.iconUrl}
                    alt={m.name}
                    data-testid={`plugin-icon-${m.id}`}
                    style={{
                      width: 64,
                      height: 64,
                      flexShrink: 0,
                      borderRadius: 14,
                      objectFit: 'cover',
                      border: '1px solid var(--stroke)',
                      background: 'var(--glass)'
                    }}
                  />
                ) : (
                  <div
                    data-testid={`plugin-icon-placeholder-${m.id}`}
                    title="清单里没有声明 icon，这是首字母占位图"
                    style={{
                      width: 64,
                      height: 64,
                      flexShrink: 0,
                      borderRadius: 14,
                      border: '1px solid var(--stroke)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 26,
                      fontWeight: 600,
                      color: '#fff',
                      background: `linear-gradient(135deg, hsl(${hue} 62% 58%), hsl(${(hue + 48) % 360} 62% 46%))`
                    }}
                  >
                    {placeholderLetter(m.name)}
                  </div>
                )}

                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                    <div className="row" style={{ gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 16, fontWeight: 500 }}>{m.name}</span>
                      <span
                        data-testid={`plugin-source-${m.id}`}
                        style={{
                          fontSize: 10,
                          padding: '1px 7px',
                          borderRadius: 999,
                          border: '1px solid var(--stroke)',
                          color: p.builtin ? 'var(--info)' : 'var(--ok)',
                          flexShrink: 0
                        }}
                      >
                        {p.builtin ? '内置' : '用户'}
                      </span>
                    </div>
                    <div className="row" style={{ gap: 8, flexShrink: 0, alignItems: 'center' }}>
                      <span style={{ fontSize: 10.5, color: p.enabled ? 'var(--ok)' : 'var(--text-4)' }}>
                        {p.enabled ? '● 已启用' : '○ 已停用'}
                      </span>
                      <button
                        className={`switch ${p.enabled ? 'on' : ''}`}
                        data-testid={`plugin-toggle-${m.id}`}
                        disabled={busy === 'toggle:' + m.id}
                        title={p.enabled ? '停用这个插件' : '启用这个插件'}
                        onClick={() => void doToggle(p)}
                      />
                    </div>
                  </div>

                  {/* 版本 + 作者（小字） */}
                  <div className="row" style={{ gap: 6, fontSize: 11.5, color: 'var(--text-4)', marginBottom: 6 }}>
                    <span className="mono">v{m.version}</span>
                    <span>·</span>
                    <span>{m.author ? `作者：${m.author}` : '作者：未署名'}</span>
                  </div>

                  {/* 说明正文 */}
                  {m.description && (
                    <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.7, marginBottom: 6 }}>
                      {m.description}
                    </div>
                  )}

                  <div className="mono truncate" style={{ color: 'var(--text-4)' }} title={p.dir}>
                    {p.dir}
                  </div>
                </div>
              </div>

              {/* 加载状态 */}
              {p.error && (
                <div style={{ fontSize: 11.5, marginBottom: 10, color: 'var(--err)' }}>加载失败：{p.error}</div>
              )}
              {!p.error && p.missing.length > 0 && (
                <div style={{ fontSize: 11.5, marginBottom: 10, color: 'var(--warn)' }}>
                  {p.enabled
                    ? `清单声明但入口脚本没有注册的命令：${p.missing.join(', ')}`
                    : `停用中，${p.missing.length} 条命令未注册（启用后即可运行）`}
                </div>
              )}

              {/* 命令按钮 */}
              {p.commands.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {p.commands.map((c) => {
                    const key = `${m.id}:${c.name}`
                    const out = outputs[key]
                    const running = busy === key
                    const runnable = p.enabled && c.registered
                    return (
                      <div key={c.name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                          <button
                            className="btn sm"
                            data-testid={`plugin-run-${m.id}-${c.name}`}
                            disabled={!runnable || running}
                            title={
                              !p.enabled
                                ? '插件已停用，先启用'
                                : !c.registered
                                  ? '入口脚本没有注册这条命令'
                                  : c.description || '运行这条命令'
                            }
                            onClick={() => void doRun(p, c.name)}
                          >
                            {running ? '运行中…' : '运行'}
                          </button>
                          <div className="grow" style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12.5 }}>{c.label}</div>
                            <div className="mono" style={{ color: 'var(--text-4)' }}>
                              {m.id}.{c.name}
                              {c.description ? ` · ${c.description}` : ''}
                            </div>
                          </div>
                        </div>
                        {out && (
                          <pre
                            data-testid={`plugin-out-${m.id}-${c.name}`}
                            style={{
                              margin: 0,
                              padding: '9px 12px',
                              borderRadius: 10,
                              border: '1px solid var(--stroke)',
                              background: 'var(--glass)',
                              color: out.ok ? 'var(--text-2)' : 'var(--err)',
                              fontFamily: "'Cascadia Code', Consolas, monospace",
                              fontSize: 11.5,
                              lineHeight: 1.65,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              maxHeight: 260,
                              overflow: 'auto'
                            }}
                          >
                            {out.text}
                          </pre>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 11.5, color: 'var(--text-4)' }}>
                  这个插件没有提供任何命令{p.enabled ? '' : '（停用状态下不加载入口脚本）'}。
                </div>
              )}

              {/* 操作行 */}
              <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn ghost sm" onClick={() => setLogFor(logsOpen ? null : m.id)}>
                  {logsOpen ? '收起日志' : `日志（${p.logs.length}）`}
                </button>
                <button className="btn ghost sm" onClick={() => void doReveal(m.id)} title="在资源管理器里打开这个插件的目录">
                  打开目录
                </button>
                {!p.builtin && (
                  <button
                    className="btn ghost sm danger"
                    data-testid={`plugin-remove-${m.id}`}
                    disabled={busy === 'remove:' + m.id}
                    onClick={() => void doRemove(p)}
                  >
                    删除
                  </button>
                )}
                {p.builtin && (
                  <span style={{ fontSize: 11, color: 'var(--text-4)', alignSelf: 'center' }}>
                    内置插件不可删除，只能停用
                  </span>
                )}
              </div>

              {logsOpen && (
                <pre
                  data-testid={`plugin-logs-${m.id}`}
                  style={{
                    margin: '10px 0 0',
                    padding: '9px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--stroke)',
                    background: 'var(--glass)',
                    color: 'var(--text-3)',
                    fontFamily: "'Cascadia Code', Consolas, monospace",
                    fontSize: 11.5,
                    lineHeight: 1.65,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 200,
                    overflow: 'auto'
                  }}
                >
                  {p.logs.length ? p.logs.join('\n') : '（没有日志）'}
                </pre>
              )}
            </div>
          )
        })}
      </div>

      {/* 坏插件报告 */}
      {broken.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 18 }} data-testid="plugin-broken">
          <div className="card-title" style={{ color: 'var(--warn)' }}>
            无法加载的插件目录（{broken.length}）
          </div>
          <div className="field-hint" style={{ marginBottom: 10 }}>
            这些目录里的清单有问题，已跳过。修好 plugin.json 后点「刷新」即可。
          </div>
          {broken.map((b) => (
            <div key={b.dir} style={{ padding: '8px 0', borderBottom: '1px solid var(--stroke)' }}>
              <div className="mono truncate" style={{ color: 'var(--text-2)' }} title={b.dir}>
                {b.dir}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--err)' }}>{b.error}</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function formatResult(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return String(v)
  if (typeof v !== 'object') return String(v)
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
