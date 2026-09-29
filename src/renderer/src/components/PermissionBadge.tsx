import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../store/AppStore'
import { createPortal } from 'react-dom'
import type { MachinePermission } from '../../../shared/types'
import type { MachinePermissionState } from '../types/global'

/**
 *
 *
 */

interface TierVisual {
  color: string
  bg: string
  icon: string
}

const TIER_VISUAL: Record<MachinePermission, TierVisual> = {
  view: { color: 'var(--text-3)', bg: 'var(--glass)', icon: '◌' },
  workspace: { color: 'var(--accent)', bg: 'var(--accent-soft)', icon: '◐' },
  full: { color: 'var(--warn)', bg: 'rgba(226,161,58,0.16)', icon: '◉' }
}

const FALLBACK_LABEL: Record<MachinePermission, string> = {
  view: '仅可查看',
  workspace: '工作目录内修改',
  full: '完全权限'
}

export default function PermissionBadge(props: { compact?: boolean } = {}): React.ReactElement {
  const { settings, saveSettings, workspace } = useApp()
  const [trusted, setTrusted] = useState(false)
  const { compact = false } = props
  const [state, setState] = useState<MachinePermissionState | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const tier: MachinePermission = settings?.agent.machinePermission ?? 'view'
  const label = FALLBACK_LABEL[tier]
  const visual = TIER_VISUAL[tier]

  const load = useCallback(async () => {
    try {
      const r = await window.aimis.agent.machinePermission()
      if (r.ok && r.data) setState(r.data)
    } catch {
    }
  }, [])

  useEffect(() => {
    void load()
    void window.aimis.agent.security().then(r => { if (r.ok && r.data) setTrusted(r.data.trusted) })
  }, [load, settings, workspace])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(t)
  }, [toast])

  const [riskOpen, setRiskOpen] = useState(false)

  const applyTier = async (next: MachinePermission): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.aimis.agent.setMachinePermission(next)
      if (!r.ok || !r.data) throw new Error(r.error ?? '切换失败')
      setState(r.data)
      const updated = await window.aimis.settings.get()
      if (updated.ok && updated.data) await saveSettings({ agent: updated.data.agent })
      setToast(`权限已切到「${r.data.label}」`)
    } catch (err) {
      setToast('切换失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  const choose = async (next: MachinePermission): Promise<void> => {
    setOpen(false)
    if (next === tier) return

    if (next === 'full') {
      setRiskOpen(true)
      return
    }

    await applyTier(next)
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        className="btn sm"
        data-testid="permission-badge"
        data-tier={tier}
        disabled={busy}
        title={state?.hint ?? label}
        onClick={() => setOpen((v) => !v)}
        style={{
          gap: 5,
          color: visual.color,
          background: visual.bg,
          borderColor: 'var(--stroke)',
          maxWidth: compact ? 132 : 180
        }}
      >
        <span style={{ fontSize: 11 }}>{visual.icon}</span>
        <span className="truncate" style={{ maxWidth: compact ? 92 : 140 }}>
          {label}
        </span>
        <span style={{ fontSize: 9, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          className="perm-pop"
          data-testid="permission-popover"
          style={{ left: 'auto', right: 0 }}
        >
          <div className="perm-title">本机权限</div>
          {(state?.options && state.options.length ? state.options : FALLBACK_PERMISSION_OPTIONS).map((opt) => {
            const v = TIER_VISUAL[opt.tier]
            const on = opt.tier === tier
            return (
              <button
                key={opt.tier}
                className={`perm-item ${on ? 'on' : ''}`}
                data-testid={`permission-option-${opt.tier}`}
                onClick={() => void choose(opt.tier)}
              >
                <div className="row" style={{ gap: 7, width: '100%', marginBottom: 2 }}>
                  <span style={{ fontSize: 11, color: v.color }}>{v.icon}</span>
                  <span style={{ fontSize: 13, flex: 1, textAlign: 'left' }}>{opt.label}</span>
                  {on && <span style={{ fontSize: 11, color: 'var(--accent)' }}>✓</span>}
                </div>
                <div className="perm-hint">{opt.hint}</div>
              </button>
            )
          })}
          <label style={{ display: 'flex', gap: 8, padding: 10, alignItems: 'center', fontSize: 12 }}>
            <input type="checkbox" aria-label="信任此工作区" checked={trusted} disabled={busy || tier === 'full'} onChange={async e => {
              const next = e.target.checked
              const result = await window.aimis.agent.trust(next)
              if (!result.ok) { setToast(result.error || '设置失败'); return }
              setTrusted(next)
              if (next && tier === 'view') await applyTier('workspace')
              if (!next && tier === 'workspace') await applyTier('view')
            }} />信任此工作区
          </label>
          <div className="perm-foot">
            完全权限下操作直接执行；工作区修改需要确认。
          </div>
        </div>
      )}

      {toast && (
        <div
          className="perm-toast"
          data-testid="permission-toast"
          style={{ left: compact ? 'auto' : 0, right: compact ? 0 : 'auto' }}
        >
          {toast}
        </div>
      )}

      {/* 完全权限的风险警告 —— 挂到 body，避免被祖先层叠上下文困住点不到 */}
      {riskOpen &&
        createPortal(
          <div className="perm-risk-mask" data-testid="permission-risk">
            <div className="perm-risk">
            <div className="perm-risk-head">
              <span style={{ fontSize: 20, color: 'var(--err)' }}>⚠</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>确定要开启「完全权限」吗？</div>
                <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 3 }}>
                  这是一个高风险档位，请确认你了解后果
                </div>
              </div>
            </div>

            <div className="perm-risk-body">
              <div className="perm-risk-line">· 角色可以**写入工作目录之外的任何位置**，包括系统目录</div>
              <div className="perm-risk-line">· 角色可以**执行任意命令**、启动或关闭你电脑上的程序</div>
              <div className="perm-risk-line">· 模型判断失误时，可能造成**文件被覆盖或删除**</div>
              <div className="perm-risk-line">· 开启后将不再逐次询问授权；可随时切回只读</div>
              <div className="perm-risk-line perm-risk-warn">
                后果自负：因使用完全权限导致的任何数据丢失或系统问题，需由你自行承担。
              </div>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn" data-testid="permission-risk-cancel" onClick={() => setRiskOpen(false)}>
                取消
              </button>
              <button
                className="btn danger"
                data-testid="permission-risk-confirm"
                disabled={busy}
                onClick={async () => {
                  setRiskOpen(false)
                  await applyTier('full')
                }}
              >
                我已知晓，开启完全权限
              </button>
            </div>
          </div>
        </div>,
          document.body
        )}

      <style>{`
        .perm-risk-mask {
          position: fixed;
          inset: 0;
          z-index: 300;
          display: grid;
          place-items: center;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(6px);
          animation: fadeIn 160ms var(--ease);
        }
        .perm-risk {
          width: min(520px, calc(100vw - 48px));
          padding: 22px 24px;
          border-radius: 20px;
          background: var(--bg-base);
          border: 1px solid var(--stroke-strong);
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
        }
        .perm-risk-head {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 16px;
        }
        .perm-risk-body {
          padding: 14px 16px;
          border-radius: 14px;
          background: color-mix(in srgb, var(--err) 8%, transparent);
          border: 1px solid color-mix(in srgb, var(--err) 24%, var(--stroke));
        }
        .perm-risk-line {
          font-size: 12.5px;
          line-height: 2;
          color: var(--text-2);
        }
        .perm-risk-warn {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid color-mix(in srgb, var(--err) 22%, transparent);
          color: var(--err);
          font-weight: 500;
        }
        .perm-pop {
          position: absolute;
          bottom: calc(100% + 8px);
          top: auto;
          width: 300px;
          max-width: calc(100vw - 32px);
          max-height: 70vh;
          overflow-y: auto;
          z-index: 92;
          padding: 8px;
          border-radius: 16px;
          background: var(--glass-strong);
          border: 1px solid var(--stroke-strong);
          backdrop-filter: blur(26px) saturate(1.2);
          box-shadow: var(--shadow-pop);
          animation: fadeIn 160ms var(--ease);
        }
        .perm-title {
          font-size: 10.5px;
          letter-spacing: 0.1em;
          color: var(--text-4);
          padding: 8px 10px 6px;
        }
        .perm-item {
          display: flex;
          flex-direction: column;
          width: 100%;
          padding: 9px 10px;
          border-radius: 11px;
          transition: background 140ms var(--ease);
        }
        .perm-item:hover { background: var(--glass-hover); }
        .perm-item.on { background: var(--accent-soft); }
        .perm-hint {
          font-size: 10.5px;
          line-height: 1.65;
          color: var(--text-4);
          text-align: left;
          padding-left: 18px;
          white-space: normal;
        }
        .perm-foot {
          font-size: 10.5px;
          line-height: 1.7;
          color: var(--text-4);
          padding: 9px 10px 6px;
          border-top: 1px solid var(--stroke);
          margin-top: 6px;
        }
        .perm-toast {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          z-index: 95;
          padding: 8px 12px;
          border-radius: 12px;
          font-size: 12px;
          white-space: nowrap;
          color: var(--ok);
          background: var(--glass-strong);
          border: 1px solid var(--stroke-strong);
          backdrop-filter: blur(20px);
          box-shadow: var(--shadow-pop);
          animation: fadeIn 180ms var(--ease);
        }
      `}</style>
    </div>
  )
}

const FALLBACK_PERMISSION_OPTIONS: MachinePermissionState['options'] = [
  { tier: 'view', label: '仅可查看', hint: '只能读文件、看硬件、列目录、看进程；写入与执行命令都会被拒绝' },
  {
    tier: 'workspace',
    label: '工作目录内修改',
    hint: '在「仅可查看」基础上，可以在工作目录内写文件、删文件；工作目录外仍然拒绝'
  },
  {
    tier: 'full',
    label: '完全权限',
    hint: '允许工作目录外写入、执行任意命令、启动与关闭应用；不再逐次询问授权'
  }
]
