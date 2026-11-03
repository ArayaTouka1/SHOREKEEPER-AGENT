import React from 'react'
import type { Route } from '../ui/navigation'
import AgentPage from '../pages/AgentPage'
import ChatPage from '../pages/ChatPage'
import HomePage from '../pages/HomePage'
import MemoryPage from '../pages/MemoryPage'
import SettingsPage from '../pages/SettingsPage'
import TaskPage from '../pages/TaskPage'

interface PageHostProps {
  route: Route
  onNavigate: (route: Route) => void
}

function RoutedPage({ route, onNavigate }: PageHostProps): React.ReactElement | null {
  switch (route) {
    case 'home': return <HomePage onNavigate={onNavigate} />
    case 'memory': return <MemoryPage />
    case 'task': return <TaskPage onNavigate={onNavigate} />
    case 'agent': return <AgentPage />
    case 'settings': return <SettingsPage />
    case 'chat': return null
  }
}

/** Keeps the chat mounted while other pages can mount independently. */
export default function PageHost({ route, onNavigate }: PageHostProps): React.ReactElement {
  return <>
    <div className="main-area" style={route === 'chat' ? undefined : { display: 'none' }} data-testid="chat-host">
      <ChatPage active={route === 'chat'} />
    </div>
    {route !== 'chat' && <div className="main-area" key={route}><RoutedPage route={route} onNavigate={onNavigate} /></div>}
  </>
}
