import React, { useCallback, useEffect, useState } from 'react'
import type { RunningApp } from '../../../shared/types'

/**
 *
 */

export default function RunningAppsPanel(): React.ReactElement {
  const [apps, setApps] = useState<RunningApp[]>([])
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const r = await window.aimis.system.runningApps()
      if (!r.ok) throw new Error(r.error ?? '读取失败')
      setApps((r.data as RunningApp[]) ?? [])
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(t)
  }, [toast])

  const doClose = async (app: RunningApp): Promise<void> => {
    setBusy(app.key)
    setConfirming(null)
    try {
      const r = await window.aimis.system.closeApp(app.key)
      if (!r.ok) throw new Error(r.error ?? '关闭失败')
      const data = r.data
      setToast({ ok: !!data?.closed, text: data?.message ?? '已处理' })
      await refresh()
    } catch (e) {
      setToast({ ok: false, text: '关闭失败：' + (e instanceof Error ? e.message : String(e)) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card card-pad" data-testid="running-app-list">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          已启动的应用（{apps.length}）
        </div>
        <button className="btn sm" data-testid="running-app-refresh" disabled={loading} onClick={() => void refresh()}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      {apps.length === 0 && !err && (
        <div style={{ fontSize: 12, color: 'var(--text-4)' }}>
          登记过的应用现在都没在运行。让角色「打开网易云音乐」之类的话，开起来后会出现在这里。
        </div>
      )}
      {err && <div style={{ fontSize: 12, color: 'var(--err)' }}>读取失败：{err}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {apps.map((a) => {
          const isConfirming = confirming === a.key
          return (
            <div
              key={a.key}
              className="card"
              style={{ padding: '10px 13px', background: 'var(--glass)' }}
            >
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13 }}>{a.appName}</span>
                <span className="mono" style={{ color: 'var(--text-4)' }}>
                  PID {a.pids.join('、')}
                </span>
              </div>
              <div className="mono truncate" style={{ color: 'var(--text-4)', marginBottom: 8 }} title={a.exeName}>
                {a.exeName}
              </div>

              {a.protected ? (
                <div style={{ fontSize: 11.5, color: 'var(--warn)' }}>
                  这是系统关键进程，已锁定，不能从这里关闭。
                </div>
              ) : isConfirming ? (
                <div className="row" style={{ gap: 8 }} data-testid="close-app-confirm-row">
                  <span style={{ fontSize: 11.5, color: 'var(--warn)', flex: 1 }}>
                    确定要关掉「{a.appName}」吗？没保存的内容会丢。
                  </span>
                  <button
                    className="btn sm danger"
                    data-testid="close-app-confirm"
                    disabled={busy === a.key}
                    onClick={() => void doClose(a)}
                  >
                    {busy === a.key ? '关闭中…' : '确认关闭'}
                  </button>
                  <button className="btn sm ghost" onClick={() => setConfirming(null)}>
                    取消
                  </button>
                </div>
              ) : (
                <button
                  className="btn sm"
                  data-testid={`close-app-${a.key}`}
                  disabled={busy === a.key}
                  onClick={() => setConfirming(a.key)}
                >
                  {busy === a.key ? '关闭中…' : '关闭'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {toast && (
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            color: toast.ok ? 'var(--ok)' : 'var(--err)'
          }}
          data-testid="close-app-toast"
        >
          {toast.ok ? '✓ ' : '✕ '}
          {toast.text}
        </div>
      )}
    </div>
  )
}
