import OperationApproval from './components/OperationApproval'
import React, { useEffect, useState } from 'react'
import { useApp } from './store/AppStore'
import { applyTheme } from './hooks/useTheme'
import Splash from './components/Splash'
import TitleBar from './components/TitleBar'
import Rail from './components/Rail'
import CommandPalette from './components/CommandPalette'
import BackgroundLayer from './components/BackgroundLayer'
import CloseDialog from './components/CloseDialog'
import HomePage from './pages/HomePage'
import ChatPage from './pages/ChatPage'
import MemoryPage from './pages/MemoryPage'
import TaskPage from './pages/TaskPage'
import AgentPage from './pages/AgentPage'
import SettingsPage from './pages/SettingsPage'
import DocumentPreview from './components/DocumentPreview'

export type Route = 'home' | 'chat' | 'memory' | 'task' | 'agent' | 'settings'

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
      if (['home', 'chat', 'memory', 'task', 'agent', 'settings'].includes(r)) {
        setRoute(r as Route)
      }
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
      const map: Record<string, Route> = {
        '1': 'home',
        '2': 'chat',
        '3': 'memory',
        '4': 'task',
        '5': 'agent',
        '6': 'settings'
      }
      const target = map[e.key]
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

  return (
    <div className="app-shell">
      <BackgroundLayer />
      <TitleBar />
      {!splashDone && <Splash onDone={() => setSplashDone(true)} />}

      <Rail route={route} onNavigate={setRoute} onOpenPalette={() => setPaletteOpen(true)} />

      {/* ChatPage 常驻：始终挂载，非激活时用 display 隐藏，切页不打断对话/语音。
          主动问候由 active 驱动 —— 只有真正进入对话页才会问候并播放语音。 */}
      <div
        className="main-area"
        style={route === 'chat' ? undefined : { display: 'none' }}
        data-testid="chat-host"
      >
        <ChatPage active={route === 'chat'} />
      </div>

      {/* 其它页面按路由条件挂载（key 触发 route-fade 入场动画） */}
      {route !== 'chat' && (
        <div className="main-area" key={route}>
          {route === 'home' && <HomePage onNavigate={setRoute} />}
          {route === 'memory' && <MemoryPage />}
          {route === 'task' && <TaskPage onNavigate={setRoute} />}
          {route === 'agent' && <AgentPage />}
          {route === 'settings' && <SettingsPage />}
        </div>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={setRoute} />
      <CloseDialog open={closeOpen} onClose={() => setCloseOpen(false)} />
      <AppToast />
      <DocumentPreview />
      <OperationApproval />
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
