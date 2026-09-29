import React, { useEffect, useState } from 'react'
import { Upload, RotateCcw } from 'lucide-react'
import { useApp } from '../../store/AppStore'
import { SwitchRow } from '../../components/ui'

export default function SplashSection(): React.JSX.Element {
  const { settings, saveSettings } = useApp()
  const [media, setMedia] = useState<{ custom: boolean; name: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function action(kind: 'status' | 'pick' | 'reset'): Promise<void> {
    setBusy(true); setError('')
    try {
      const res = await window.aimis.splash[kind]()
      if (!res.ok) throw new Error(res.error)
      if (res.data) setMedia(res.data)
    } catch (err) { setError(String(err)) }
    finally { setBusy(false) }
  }
  useEffect(() => { void action('status') }, [])
  return <section style={{ marginBottom: 24 }} data-testid="splash-settings">
    <h3>开屏动画</h3>
    <SwitchRow title="启动时播放开屏动画" desc="下次启动生效" on={!settings?.general.skipSplash} onChange={enabled => {
      if (settings) void saveSettings({ general: { ...settings.general, skipSplash: !enabled } })
    }} />
    <p>{media?.name || '读取中'}</p>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      <button className="btn sm" disabled={busy} onClick={() => void action('pick')}><Upload size={15} />选择自定义动画</button>
      <button className="btn ghost sm" disabled={busy || !media?.custom} onClick={() => void action('reset')}><RotateCcw size={15} />恢复默认</button>
    </div>
    {media?.url && <video key={media.url} src={media.url} controls muted playsInline preload="metadata" style={{ width: '100%', maxWidth: 560, aspectRatio: '16/9', objectFit: 'contain', background: '#111' }} onError={() => setError('无法播放此视频，请改用 H.264 MP4 或 VP8/VP9 WebM，或恢复默认动画。')} />}
    {error && <p role="alert" style={{ color: 'var(--err)' }}>{error}</p>}
  </section>
}
