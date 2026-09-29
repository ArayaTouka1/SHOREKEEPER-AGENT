import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/AppStore'
import type { Persona } from '../../../shared/types'

/**
 *
 */
export default function PersonaSwitcher(): React.ReactElement {
  const { personas, character, characters, saveCharacter, switchCharacter, reloadBootstrap } = useApp()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

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

  const ownerOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of personas) {
      if (!p.builtin) continue
      const head = p.name.split(/[·・|]/)[0].trim()
      const c = characters.find((x) => x.id === p.id.replace(/^persona_/, 'char_'))
      if (c) map.set(p.id, c.id)
    }
    return map
  }, [personas, characters])

  const current = useMemo(() => personas.find((p) => p.id === character?.personaId) ?? null, [personas, character])

  const grouped = useMemo(() => {
    const builtin: Persona[] = []
    const custom: Persona[] = []
    for (const p of personas) { if (p.builtin) builtin.push(p); else if (!character?.builtin) custom.push(p) }
    return { builtin, custom }
  }, [personas])

  /**
   */
  const apply = async (p: Persona): Promise<void> => {
    if (!character) return
    if (p.id === character.personaId) {
      setOpen(false)
      return
    }
    setBusy(p.id)
    try {
      const ownerId = ownerOf.get(p.id)
      if (ownerId && ownerId !== character.id) {
        await switchCharacter(ownerId)
        await reloadBootstrap()
        setToast({ ok: true, text: `已切到「${p.name}」，音色同步切换` })
      } else {
        await saveCharacter({ personaId: p.id })
        setToast({ ok: true, text: `人格已换成「${p.name}」` })
      }
      setOpen(false)
    } catch (err) {
      setToast({ ok: false, text: '切换失败：' + (err instanceof Error ? err.message : String(err)) })
    } finally {
      setBusy(null)
    }
  }

  const voiceLabel = (): string => {
    const v = character?.voice
    if (!v) return '无音色'
    if (v.engine === 'voice-pack') return v.voicePackFile ? `语音包 ${v.voicePackFile}` : '语音包未设置'
    if (v.engine === 'inworld') return '云合成'
    if (v.engine === 'system') return '系统合成'
    return '不发声'
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        className="btn sm"
        data-testid="persona-switcher"
        data-persona={character?.personaId ?? ''}
        onClick={() => setOpen((v) => !v)}
        title="切换角色"
        style={{ maxWidth: 220, gap: 6 }}
      >
        <span style={{ color: 'var(--accent)', fontSize: 11 }}>❖</span>
        <span className="truncate" style={{ maxWidth: 108 }}>
          {current ? current.name.split(/[·・|]/)[0].trim() : '未绑定人格'}
        </span>
        <span style={{ fontSize: 9, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="persona-pop" data-testid="persona-popover">
          {/* 当前状态 */}
          <div className="pp-head">
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              当前：<b style={{ color: 'var(--accent)' }}>{current?.name ?? '未绑定'}</b>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 3 }}>音色：{voiceLabel()}</div>
          </div>

          {/* 内置人格 */}
          <div className="pp-group">内置人格（切换会同步换音色）</div>
          {grouped.builtin.map((p) => {
            const on = p.id === character?.personaId
            const ownerId = ownerOf.get(p.id)
            const owner = characters.find((c) => c.id === ownerId)
            return (
              <button
                key={p.id}
                data-persona-option={p.id}
                className={`pp-item ${on ? 'on' : ''}`}
                disabled={busy === p.id}
                onClick={() => void apply(p)}
              >
                <div className="row" style={{ gap: 8, width: '100%' }}>
                  {owner && (
                    <img
                      src={owner.avatar.main}
                      alt=""
                      style={{ width: 26, height: 26, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                    />
                  )}
                  <span className="truncate" style={{ fontSize: 13, flex: 1, textAlign: 'left' }}>
                    {p.name}
                  </span>
                  {busy === p.id && <span style={{ fontSize: 10, color: 'var(--text-4)' }}>切换中…</span>}
                  {on && <span style={{ fontSize: 11, color: 'var(--accent)' }}>✓</span>}
                </div>
                <div className="pp-desc truncate">
                  {owner ? `${owner.name} 的人格与音色` : '内置人格'}
                  
                </div>
              </button>
            )
          })}

          {/* 自定义人格 */}
          {grouped.custom.length > 0 && (
            <>
              <div className="pp-group">自定义人格（只换人格，音色不变）</div>
              {grouped.custom.map((p) => {
                const on = p.id === character?.personaId
                return (
                  <button
                    key={p.id}
                    data-persona-option={p.id}
                    className={`pp-item ${on ? 'on' : ''}`}
                    disabled={busy === p.id}
                    onClick={() => void apply(p)}
                  >
                    <div className="row" style={{ gap: 8, width: '100%' }}>
                      <span style={{ fontSize: 13, flex: 1, textAlign: 'left' }}>{p.name}</span>
                      {on && <span style={{ fontSize: 11, color: 'var(--accent)' }}>✓</span>}
                    </div>
                    <div className="pp-desc">{p.content.length} 字</div>
                  </button>
                )
              })}
            </>
          )}

          <div className="pp-foot">
            角色资料与羁绊
          </div>
        </div>
      )}

      {/* 切换反馈 */}
      {toast && (
        <div className={`pp-toast ${toast.ok ? 'ok' : 'err'}`} data-testid="persona-toast">
          {toast.ok ? '✓ ' : '✕ '}
          {toast.text}
        </div>
      )}

      <style>{`
        .persona-pop {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 320px;
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
        .pp-head {
          padding: 10px 10px 12px;
          border-bottom: 1px solid var(--stroke);
          margin-bottom: 6px;
        }
        .pp-group {
          font-size: 10.5px;
          letter-spacing: 0.08em;
          color: var(--text-4);
          padding: 9px 10px 5px;
        }
        .pp-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
          width: 100%;
          padding: 8px 10px;
          border-radius: 11px;
          transition: background 140ms var(--ease);
        }
        .pp-item:hover:not(:disabled) { background: var(--glass-hover); }
        .pp-item.on { background: var(--accent-soft); }
        .pp-item:disabled { opacity: 0.6; cursor: wait; }
        .pp-desc {
          font-size: 10.5px;
          color: var(--text-4);
          text-align: left;
          padding-left: 2px;
        }
        .pp-foot {
          font-size: 10.5px;
          color: var(--text-4);
          padding: 10px;
          border-top: 1px solid var(--stroke);
          margin-top: 6px;
        }
        .pp-toast {
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
        .pp-toast.ok { color: var(--ok); }
        .pp-toast.err { color: var(--err); }
      `}</style>
    </div>
  )
}
