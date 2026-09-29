import React, { useEffect, useState } from 'react'

/**
 */
export default function CloseDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.ReactElement | null {
  const [dontAsk, setDontAsk] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setDontAsk(false)
      setBusy(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter') void act('minimize')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dontAsk])

  const act = async (action: 'minimize' | 'quit'): Promise<void> => {
    setBusy(true)
    try {
      if (dontAsk) {
        await window.aimis.window.setClosePref({ action, askDisabled: true })
      }
      await window.aimis.window.closeAction(action)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="close-mask" data-testid="close-dialog" onMouseDown={onClose}>
      <div className="close-box" onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>要关闭窗口吗？</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 18, lineHeight: 1.7 }}>
          最小化后程序会留在右下角托盘，随时可以叫回来。
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            className="btn primary"
            data-testid="close-minimize"
            disabled={busy}
            onClick={() => void act('minimize')}
            style={{ justifyContent: 'center', padding: '11px 18px' }}
          >
            最小化到托盘
          </button>
          <button
            className="btn danger"
            data-testid="close-quit"
            disabled={busy}
            onClick={() => void act('quit')}
            style={{ justifyContent: 'center', padding: '11px 18px' }}
          >
            直接退出
          </button>
        </div>

        <label className="close-check">
          <input
            type="checkbox"
            data-testid="close-dontask"
            checked={dontAsk}
            onChange={(e) => setDontAsk(e.target.checked)}
          />
          <span>以后不再提醒</span>
        </label>

        <button className="btn ghost sm" style={{ width: '100%', marginTop: 12 }} onClick={onClose}>
          取消
        </button>
      </div>

      <style>{`
        .close-mask {
          position: absolute; inset: 0; z-index: 300;
          background: rgba(60, 40, 65, 0.28);
          backdrop-filter: blur(8px);
          display: grid; place-items: center;
          animation: fadeIn 160ms var(--ease);
        }
        .close-box {
          width: min(360px, 84vw);
          padding: 24px;
          border-radius: 20px;
          background: var(--glass-strong);
          border: 1px solid var(--stroke-strong);
          backdrop-filter: blur(30px) saturate(1.2);
          box-shadow: var(--shadow-pop);
          animation: fadeIn 200ms var(--ease);
        }
        .close-check {
          display: flex; align-items: center; gap: 8px;
          margin-top: 16px;
          font-size: 12.5px; color: var(--text-3);
          cursor: pointer;
        }
        .close-check input {
          width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer;
        }
      `}</style>
    </div>
  )
}
