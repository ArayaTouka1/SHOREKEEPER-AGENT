import React, { useEffect, useState } from 'react'
import { useApp } from './store/AppStore'
import { applyTheme } from './hooks/useTheme'
import Splash from './components/Splash'
import TitleBar from './components/TitleBar'
import Rail from './components/Rail'
import CommandPalette from './components/CommandPalette'
import BackgroundLayer from './components/BackgroundLayer'
import CloseDialog from './components/CloseDialog'
import DocumentPreview from './components/DocumentPreview'
import PluginRuntime from './components/PluginRuntime'
import PageHost from './components/PageHost'
import { isRoute, routeForShortcut, type Route } from './ui/navigation'
import CallWindow from './pages/CallWindow'
import CallRenderPreview from './pages/CallRenderPreview'

export type { Route } from './ui/navigation'

export default function App(): React.ReactElement {
  const { ready, bootError, settings, activeTokens, theme, refreshJobs, character } = useApp()
  const [route, setRoute] = useState<Route>('home')
  const [splashDone, setSplashDone] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)


  useEffect(() => {
    if (activeTokens) applyTheme(activeTokens)
  }, [activeTokens])

  useEffect(() => {
    const on = !!(theme && theme.background && theme.background.enabled && theme.background.mediaKind)
    document.documentElement.setAttribute('data-bg-on', on ? '1' : '0')
  }, [theme])

  useEffect(() => {
    if (settings?.general.skipSplash) setSplashDone(true)
  }, [settings?.general.skipSplash])

  useEffect(() => {
    const off = window.aimis.window.onShowCloseDialog(() => setCloseOpen(true))
    return off
  }, [])

  useEffect(() => {
    const off = window.aimis.agent.onNavigate((r) => {
      if (isRoute(r)) setRoute(r)
    })
    return off
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      const target = routeForShortcut(e.key)
      if (target) {
        e.preventDefault()
        setRoute(target)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => void refreshJobs(), 5000)
    return () => window.clearInterval(t)
  }, [refreshJobs])

  if (!ready) {
    return (
      <div className="app-shell" style={{ display: 'grid', placeItems: 'center' }}>
        <TitleBar />
        <div className="empty">
          <div className="empty-glyph">◍</div>
          <div>正在唤醒……</div>
        </div>
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="app-shell" style={{ display: 'grid', placeItems: 'center' }}>
        <TitleBar />
        <div className="card card-pad" style={{ maxWidth: 520 }}>
          <div className="card-title">启动失败</div>
          <div style={{ color: 'var(--text-2)', fontSize: 13 }}>{bootError}</div>
        </div>
      </div>
    )
  }

  if (new URLSearchParams(window.location.search).get('view') === 'call') {
    return <CallWindow />
  }
  if (new URLSearchParams(window.location.search).get('view') === 'call-render-preview') {
    return <CallRenderPreview />
  }

  return (
    <div className="app-shell">
      <BackgroundLayer />
      <TitleBar />
      {!splashDone && <Splash onDone={() => setSplashDone(true)} />}

      <Rail route={route} onNavigate={setRoute} onOpenPalette={() => setPaletteOpen(true)} />

      <PageHost route={route} onNavigate={setRoute} />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={setRoute} />
      <CloseDialog open={closeOpen} onClose={() => setCloseOpen(false)} />
      <AppToast />
      <DocumentPreview />
      <PluginRuntime />
    </div>
  )
}

function AppToast(): React.ReactElement | null {
  const { toast } = useApp()
  if (!toast) return null
  return (
    <div className={`toast ${toast.ok ? '' : 'err'}`} data-testid="app-toast">
      {toast.text}
    </div>
  )
}
