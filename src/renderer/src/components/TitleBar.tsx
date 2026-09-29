import React, { useEffect, useState } from 'react'
import { useApp } from '../store/AppStore'

export default function TitleBar(): React.ReactElement {
  const { jobs } = useApp()
  const [closePref, setClosePref] = useState<{ action: 'ask' | 'minimize' | 'quit'; askDisabled: boolean } | null>(null)

  useEffect(() => {
    void window.aimis.window.getClosePref().then((res) => {
      if (res.ok && res.data) setClosePref(res.data)
    })
  }, [])

  const onClose = async (): Promise<void> => {
    const pref = await window.aimis.window.getClosePref().then((r) => (r.ok && r.data ? r.data : null))
    setClosePref(pref)

    if (!pref || pref.action === 'ask') {
      window.aimis.window.close()
      return
    }
    if (pref.action === 'quit') await window.aimis.window.closeAction('quit')
    else await window.aimis.window.closeAction('minimize')
  }

  const runningJobs = jobs.filter((j) => j.status === 'running').length

  return (
    <div className="titlebar">
      {runningJobs > 0 && (
        <span
          className="status-pill running"
          style={{ fontSize: 10.5, padding: '2px 9px', marginRight: 6, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={`${runningJobs} 个后台任务运行中`}
        >
          <span className="status-dot" />
          {runningJobs}
        </span>
      )}

      <button className="titlebar-btn" data-testid="win-min" onClick={() => window.aimis.window.minimize()} title="最小化">
        <svg width="11" height="11" viewBox="0 0 11 11">
          <line x1="1" y1="5.5" x2="10" y2="5.5" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </button>
      <button className="titlebar-btn" data-testid="win-max" onClick={() => window.aimis.window.maximize()} title="最大化">
        <svg width="11" height="11" viewBox="0 0 11 11">
          <rect x="1.2" y="1.2" width="8.6" height="8.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </button>
      <button className="titlebar-btn close" data-testid="win-close" onClick={() => void onClose()} title="关闭">
        <svg width="11" height="11" viewBox="0 0 11 11">
          <line x1="1.6" y1="1.6" x2="9.4" y2="9.4" stroke="currentColor" strokeWidth="1.1" />
          <line x1="9.4" y1="1.6" x2="1.6" y2="9.4" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </button>
    </div>
  )
}
