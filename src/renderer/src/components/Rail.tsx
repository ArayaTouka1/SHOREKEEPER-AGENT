import React from 'react'
import type { Route } from '../App'

const ITEMS: Array<{ key: Route; glyph: string; label: string }> = [
  { key: 'home', glyph: 'H', label: '首页' },
  { key: 'chat', glyph: 'C', label: '对话' },
  { key: 'memory', glyph: 'M', label: '记忆' },
  { key: 'task', glyph: 'T', label: '任务' },
  { key: 'agent', glyph: 'A', label: '智能体' }
]

export default function Rail({
  route,
  onNavigate,
  onOpenPalette
}: {
  route: Route
  onNavigate: (r: Route) => void
  onOpenPalette?: () => void
}): React.ReactElement {
  return (
    <div className="rail">
      {ITEMS.map((it) => (
        <button
          key={it.key}
          className={`rail-item ${route === it.key ? 'active' : ''}`}
          onClick={() => onNavigate(it.key)}
          title={it.label}
        >
          <span className="rail-glyph">{it.glyph}</span>
          <span className="rail-label">{it.label}</span>
        </button>
      ))}

      <div className="rail-spacer" />

      {onOpenPalette && (
        <button className="rail-item" onClick={onOpenPalette} title="命令面板 (Ctrl+K)">
          <span className="rail-glyph">⌘</span>
          <span className="rail-label">命令</span>
        </button>
      )}

      <button
        className={`rail-item ${route === 'settings' ? 'active' : ''}`}
        onClick={() => onNavigate('settings')}
        title="设置"
      >
        <span className="rail-glyph">⚙</span>
        <span className="rail-label">设置</span>
      </button>
    </div>
  )
}
