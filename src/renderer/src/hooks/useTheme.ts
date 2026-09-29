import { useEffect } from 'react'
import type { ThemeTokens } from '../../../shared/types'

/**
 */
export function applyTheme(tokens: ThemeTokens): void {
  const root = document.documentElement
  const set = (name: string, value: string): void => root.style.setProperty(name, value)

  const uiAlpha = Math.min(1, Math.max(0, (tokens.uiOpacity ?? 100) / 100))
  const scaleAlpha = (color: string): string => {
    const m = color.match(/^rgba?\(([^)]+)\)$/i)
    if (!m) return color
    const parts = m[1].split(',').map((s) => s.trim())
    if (parts.length === 4) {
      const a = parseFloat(parts[3])
      if (Number.isFinite(a)) {
        parts[3] = String(Math.min(1, a * uiAlpha))
        return `rgba(${parts.join(', ')})`
      }
    }
    return color
  }

  set('--bg-base', tokens.bgBase)
  set('--bg-grad-a', tokens.bgGradA)
  set('--bg-grad-b', tokens.bgGradB)
  set('--bg-grad-c', tokens.bgGradC)

  set('--glass', scaleAlpha(tokens.glass))
  set('--glass-hover', scaleAlpha(tokens.glassHover))
  set('--glass-strong', scaleAlpha(tokens.glassHover))
  set('--stroke', tokens.stroke)
  set('--stroke-strong', tokens.strokeStrong)

  set('--accent', tokens.accent)
  set('--accent-2', tokens.accent2)
  set('--accent-grad', `linear-gradient(135deg, ${tokens.accentGradFrom} 0%, ${tokens.accentGradMid} 55%, ${tokens.accentGradTo} 100%)`)
  set('--accent-soft', hexToRgba(tokens.accent, 0.18))

  set('--text-1', tokens.text1)
  set('--text-2', tokens.text2)
  set('--text-3', tokens.text3)
  set('--text-4', tokens.text4)

  set('--bubble-user', `linear-gradient(135deg, ${tokens.bubbleUserFrom} 0%, ${tokens.bubbleUserTo} 100%)`)
  set('--bubble-char', tokens.bubbleChar)
  set('--bubble-tool', tokens.glass)

  set('--shadow-card', `0 8px 28px ${tokens.shadow}`)
  set('--shadow-pop', `0 16px 44px ${tokens.shadow}`)
  set('--glow', `0 6px 20px ${hexToRgba(tokens.accent, 0.4)}`)

  set('--scrollbar', tokens.dark ? 'rgba(255,255,255,0.16)' : 'rgba(196,150,180,0.28)')
  set('--scrollbar-hover', tokens.dark ? 'rgba(255,255,255,0.28)' : 'rgba(196,150,180,0.45)')
  set('--user-text', tokens.dark ? '#ffffff' : '#ffffff')

  root.style.colorScheme = tokens.dark ? 'dark' : 'light'
  root.setAttribute('data-theme-dark', tokens.dark ? '1' : '0')
}

/** #rrggbb / #rgb → rgba(...) */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.trim()
  if (h.startsWith('rgba') || h.startsWith('rgb')) return h
  let v = h.replace('#', '')
  if (v.length === 3) v = v.split('').map((c) => c + c).join('')
  if (v.length !== 6) return h
  const r = parseInt(v.slice(0, 2), 16)
  const g = parseInt(v.slice(2, 4), 16)
  const b = parseInt(v.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function useThemeEffect(tokens: ThemeTokens | null): void {
  useEffect(() => {
    if (tokens) applyTheme(tokens)
  }, [tokens])
}
