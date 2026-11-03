import React from 'react'
import { NAVIGATION_ITEMS, type Route } from '../ui/navigation'

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
      <div className="rail-caption">TERMINAL</div>
      {NAVIGATION_ITEMS.filter((item) => item.placement === 'main').map((it) => (
        <button
          key={it.key}
          className={`rail-item ${route === it.key ? 'active' : ''}`}
          onClick={() => onNavigate(it.key)}
        >
          <span className="rail-glyph">{it.glyph}</span>
          <span className="rail-label">{it.label}</span>
        </button>
      ))}

      <div className="rail-spacer" />

      {onOpenPalette && (
        <button className="rail-item" onClick={onOpenPalette} aria-label="命令面板 (Ctrl+K)">
          <span className="rail-glyph">⌘</span>
          <span className="rail-label">命令</span>
        </button>
      )}

      {NAVIGATION_ITEMS.filter((item) => item.placement === 'footer').map((item) => <button key={item.key} className={`rail-item ${route === item.key ? 'active' : ''}`} onClick={() => onNavigate(item.key)}><span className="rail-glyph">{item.glyph}</span><span className="rail-label">{item.label}</span></button>)}
      <div className="rail-version">WUTHERING<br/>TERMINAL</div>
    </div>
  )
}
