export type Route = 'home' | 'chat' | 'memory' | 'task' | 'agent' | 'settings'

export interface NavigationItem {
  key: Route
  glyph: string
  label: string
  shortcut: string
  placement: 'main' | 'footer'
}

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { key: 'home', glyph: '⌂', label: '首页', shortcut: '1', placement: 'main' },
  { key: 'chat', glyph: '◉', label: '对话', shortcut: '2', placement: 'main' },
  { key: 'memory', glyph: '◇', label: '记忆', shortcut: '3', placement: 'main' },
  { key: 'task', glyph: '◷', label: '任务', shortcut: '4', placement: 'main' },
  { key: 'agent', glyph: '⌘', label: '智能体', shortcut: '5', placement: 'main' },
  { key: 'settings', glyph: '⚙', label: '设置', shortcut: '6', placement: 'footer' }
] as const

const ROUTES = new Set<string>(NAVIGATION_ITEMS.map((item) => item.key))

export function isRoute(value: string): value is Route {
  return ROUTES.has(value)
}

export function routeForShortcut(key: string): Route | undefined {
  return NAVIGATION_ITEMS.find((item) => item.shortcut === key)?.key
}
