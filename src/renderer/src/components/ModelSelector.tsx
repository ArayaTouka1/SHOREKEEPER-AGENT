import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/AppStore'
import type { ModelInfo } from '../../../shared/types'

/**
 *
 */
export default function ModelSelector(): React.ReactElement {
  const { models, activeModelId, selectModel, probeModel, disconnectModel, refreshModels, settings } = useApp()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [expandedLocal, setExpandedLocal] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void refreshModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (open) void refreshModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 5000)
    return () => window.clearTimeout(t)
  }, [toast])

  const active = useMemo(() => models.find((m) => m.id === activeModelId) ?? null, [models, activeModelId])
  const apiModels = useMemo(() => models.filter((m) => m.kind === 'api'), [models])
  const localReady = useMemo(() => models.filter((m) => m.kind === 'local' && m.available), [models])

  const VENDOR_LABELS: Record<string, string> = {
    deepseek: 'DeepSeek',
    openai: 'OpenAI',
    moonshot: '月之暗面 Kimi',
    dashscope: '通义千问',
    zhipu: '智谱 GLM',
    siliconflow: '硅基流动',
    minimax: 'MiniMax',
    baichuan: '百川',
    stepfun: '阶跃星辰',
    volcengine: '豆包',
    tencent: '腾讯混元',
    openrouter: 'OpenRouter',
    groq: 'Groq'
  }

  const apiGroups = useMemo(() => {
    const map = new Map<string, ModelInfo[]>()
    for (const m of apiModels) {
      const v = VENDOR_LABELS[m.provider] ?? m.provider
      if (!map.has(v)) map.set(v, [])
      map.get(v)!.push(m)
    }
    const entries = [...map.entries()]
    entries.sort((a, b) => {
      if (a[0] === 'DeepSeek') return -1
      if (b[0] === 'DeepSeek') return 1
      return a[0].localeCompare(b[0], 'zh')
    })
    return entries
  }, [apiModels])

  const [vendorOpen, setVendorOpen] = useState<Record<string, boolean>>({ DeepSeek: true })

  useEffect(() => {
    if (open) setVendorOpen((s) => ({ DeepSeek: true, ...s }))
  }, [open])
  const localNotReady = useMemo(() => models.filter((m) => m.kind === 'local' && !m.available), [models])

  const pick = async (m: ModelInfo): Promise<void> => {
    if (m.id === activeModelId) {
      setOpen(false)
      return
    }
    setBusy(m.id)
    try {
      await selectModel(m.id)
      setToast({ ok: true, text: `下一条消息使用 ${m.model}` })
      setOpen(false)
    } catch (err) {
      setToast({ ok: false, text: '切换失败：' + (err instanceof Error ? err.message : String(err)) })
    } finally {
      setBusy(null)
    }
  }

  const connectLocal = async (m: ModelInfo): Promise<void> => {
    setBusy(m.id)
    try {
      const r = await probeModel(m.id, m.baseUrl, undefined)
      if (r.ok) {
        await selectModel(m.id)
        setToast({ ok: true, text: `${m.name} 连接成功，已切换` })
        setOpen(false)
      } else {
        setToast({ ok: false, text: `${m.name} 连接失败：${r.message}` })
      }
    } finally {
      setBusy(null)
    }
  }

  const disconnectLocal = async (m: ModelInfo): Promise<void> => {
    setBusy(m.id)
    try {
      await disconnectModel(m.id)
      setToast({ ok: true, text: `已断开「${m.name}」` })
    } finally {
      setBusy(null)
    }
  }

  const badge = (m: ModelInfo): React.ReactElement => (
    <span
      style={{
        fontSize: 10,
        padding: '1px 7px',
        borderRadius: 999,
        border: '1px solid var(--stroke)',
        color: m.kind === 'local' ? 'var(--ok)' : 'var(--info)',
        flexShrink: 0
      }}
    >
      {m.kind === 'local' ? '本地' : 'API'}
    </span>
  )

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        className="btn sm"
        data-testid="model-selector"
        onClick={() => setOpen((v) => !v)}
        title={active ? `${active.baseUrl}\n模型 ID：${active.model}` : '选择对话模型'}
        style={{ maxWidth: 240, gap: 6 }}
      >
        <span style={{ color: 'var(--accent)', fontSize: 11 }}>◈</span>
        <span className="truncate" style={{ maxWidth: 128 }}>
          {busy && busy === activeModelId ? '切换中…' : active ? active.name : '选择模型'}
        </span>
        {active && (
          <span
            style={{
              fontSize: 9,
              padding: '0 5px',
              borderRadius: 999,
              background: active.kind === 'local' ? 'var(--ok)' : 'var(--accent-soft)',
              color: active.kind === 'local' ? '#fff' : 'var(--text-3)'
            }}
          >
            {active.kind === 'local' ? '本地' : 'API'}
          </span>
        )}
        <span style={{ fontSize: 9, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="model-pop" data-testid="model-popover">
          {/* API 联网 */}
          {/* API 联网 —— 按厂商分组，可展开收起 */}
          <div className="model-group">API 联网（按厂商）</div>
          {apiGroups.map(([vendor, list]) => (
            <div key={vendor}>
              <button
                className="model-vendor"
                data-testid={`chat-vendor-${vendor}`}
                onClick={() => setVendorOpen((s) => ({ ...s, [vendor]: !s[vendor] }))}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-3)',
                  fontSize: 11.5
                }}
              >
                <span style={{ width: 10 }}>{vendorOpen[vendor] ? '▾' : '▸'}</span>
                <span style={{ flex: 1, textAlign: 'left' }}>{vendor}</span>
                <span style={{ color: 'var(--text-4)' }}>{list.length}</span>
              </button>

              {vendorOpen[vendor] &&
                list.map((m) => (
                  <button
                    key={m.id}
                    data-model-id={m.id}
                    className={`model-item ${m.id === activeModelId ? 'on' : ''}`}
                    disabled={busy === m.id}
                    onClick={() => void pick(m)}
                  >
                    <div className="row" style={{ gap: 7, width: '100%' }}>
                      <span className="truncate" style={{ fontSize: 13, flex: 1, textAlign: 'left' }}>
                        {m.name}
                      </span>
                      {busy === m.id && <span style={{ fontSize: 10, color: 'var(--text-4)' }}>切换中…</span>}
                      {badge(m)}
                      {m.id === activeModelId && <span style={{ fontSize: 11, color: 'var(--accent)' }}>✓</span>}
                    </div>
                    <code style={{ fontSize: 11, color: 'var(--text-3)', overflowWrap: 'anywhere' }}>{m.model}</code>
                  </button>
                ))}
            </div>
          ))}
          {apiModels.length === 0 && <div className="model-empty">没有可用的 API 模型</div>}

          {/* 本地部署 —— 已连接 */}
          <div className="model-group">本地部署（已连接）</div>
          {localReady.map((m) => (
            <div key={m.id} className={`model-item ${m.id === activeModelId ? 'on' : ''}`}>
              <div className="row" style={{ gap: 7, width: '100%' }}>
                <button
                  data-model-id={m.id}
                  disabled={busy === m.id}
                  onClick={() => void pick(m)}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', display: 'flex', gap: 7, alignItems: 'center' }}
                >
                  <span className="truncate" style={{ fontSize: 13, flex: 1 }}>
                    {m.name}
                  </span>
                  {busy === m.id && <span style={{ fontSize: 10, color: 'var(--text-4)' }}>处理中…</span>}
                  {badge(m)}
                  {m.id === activeModelId && <span style={{ fontSize: 11, color: 'var(--accent)' }}>✓</span>}
                </button>
                <button
                  className="btn ghost sm danger"
                  data-testid={`chat-disconnect-${m.id}`}
                  disabled={busy === m.id}
                  title="断开这个本地模型"
                  onClick={() => void disconnectLocal(m)}
                  style={{ fontSize: 10.5, padding: '2px 8px', flexShrink: 0 }}
                >
                  断开
                </button>
              </div>
              <div className="model-desc truncate">{m.model}</div>
            </div>
          ))}
          {localReady.length === 0 && (
            <div className="model-empty">
              还没有已连接的本地模型。
              {localNotReady.length > 0 && '在下面点「连接」即可启用。'}
            </div>
          )}

          {/* 本地部署 —— 未连接 */}
          {localNotReady.length > 0 && (
            <>
              <button
                className="model-group model-group-btn"
                data-testid="local-toggle"
                data-open={expandedLocal ? '1' : '0'}
                onClick={() => setExpandedLocal((v) => !v)}
              >
                <span>本地部署（未连接 {localNotReady.length}）</span>
                <span style={{ fontSize: 10 }}>{expandedLocal ? '收起 ▲' : '展开 ▼'}</span>
              </button>
              {expandedLocal &&
                localNotReady.map((m) => (
                  <div key={m.id} className="model-item disabled">
                    <div className="row" style={{ gap: 7, width: '100%' }}>
                      <span className="truncate" style={{ fontSize: 13, flex: 1, textAlign: 'left', opacity: 0.7 }}>
                        {m.name}
                      </span>
                      {badge(m)}
                      <button
                        className="btn ghost sm"
                        data-testid={`local-connect-${m.id}`}
                        disabled={busy === m.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          void connectLocal(m)
                        }}
                        style={{ fontSize: 11, padding: '2px 8px' }}
                      >
                        {busy === m.id ? '连接中…' : '连接'}
                      </button>
                    </div>
                    <div className="model-desc truncate">{m.baseUrl}</div>
                  </div>
                ))}
            </>
          )}

          <div className="model-foot">
            本地模型需要先在电脑上启动服务（Ollama / LM Studio 等）。
            <br />
            更多设置见「设置 → 模型」。
          </div>
        </div>
      )}

      {/* 切换反馈 */}
      {toast && (
        <div className={`model-toast ${toast.ok ? 'ok' : 'err'}`} data-testid="model-toast">
          {toast.ok ? '✓ ' : '✕ '}
          {toast.text}
        </div>
      )}

      <style>{`
        .model-pop {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 330px;
          max-height: 62vh;
          overflow-y: auto;
          z-index: 90;
          padding: 8px;
          border-radius: 16px;
          background: var(--glass-strong);
          border: 1px solid var(--stroke-strong);
          backdrop-filter: blur(26px) saturate(1.2);
          box-shadow: var(--shadow-pop);
          animation: fadeIn 160ms var(--ease);
        }
        .model-group {
          font-size: 10.5px;
          letter-spacing: 0.1em;
          color: var(--text-4);
          padding: 9px 10px 5px;
        }
        .model-group-btn {
          display: flex;
          width: 100%;
          justify-content: space-between;
          align-items: center;
          border-radius: 9px;
          transition: background 140ms var(--ease);
        }
        .model-group-btn:hover { background: var(--glass-hover); }
        .model-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
          width: 100%;
          padding: 8px 10px;
          border-radius: 11px;
          transition: background 140ms var(--ease);
        }
        .model-item:hover:not(:disabled) { background: var(--glass-hover); }
        .model-item.on { background: var(--accent-soft); }
        .model-item:disabled { opacity: 0.65; cursor: wait; }
        .model-item.disabled { cursor: default; }
        .model-item.disabled:hover { background: transparent; }
        .model-desc {
          font-size: 10.5px;
          color: var(--text-4);
          text-align: left;
          padding-left: 2px;
        }
        .model-empty {
          font-size: 11.5px;
          color: var(--text-4);
          padding: 8px 10px 12px;
          line-height: 1.7;
        }
        .model-foot {
          font-size: 10.5px;
          color: var(--text-4);
          padding: 10px;
          border-top: 1px solid var(--stroke);
          margin-top: 6px;
          line-height: 1.7;
        }
        .model-toast {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          z-index: 95;
          padding: 9px 13px;
          border-radius: 12px;
          font-size: 12px;
          white-space: nowrap;
          background: var(--glass-strong);
          border: 1px solid var(--stroke-strong);
          backdrop-filter: blur(20px);
          box-shadow: var(--shadow-pop);
          animation: fadeIn 180ms var(--ease);
        }
        .model-toast.ok { color: var(--ok); }
        .model-toast.err { color: var(--err); }
      `}</style>
    </div>
  )
}
