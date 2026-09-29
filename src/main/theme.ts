import { JsonStore } from './store'
import type { ThemeTokens, ThemePreset, ThemeState, BackgroundConfig } from '../shared/types'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function tokens(partial: Partial<ThemeTokens>): ThemeTokens {
  return {
    bgBase: '#fdf7fb',
    bgGradA: '#fff8fc',
    bgGradB: '#fdeef6',
    bgGradC: '#f3ecff',
    glass: 'rgba(255, 255, 255, 0.72)',
    glassHover: 'rgba(255, 255, 255, 0.9)',
    stroke: 'rgba(196, 150, 180, 0.22)',
    strokeStrong: 'rgba(196, 150, 180, 0.4)',
    accent: '#f4a3c8',
    accent2: '#b9a4f0',
    accentGradFrom: '#f9b6d4',
    accentGradMid: '#c9a8f5',
    accentGradTo: '#a8c8f8',
    text1: '#3a2b3f',
    text2: '#6b5570',
    text3: '#9b87a3',
    text4: '#bdaec4',
    bubbleUserFrom: '#fbc4dd',
    bubbleUserTo: '#e3b8f2',
    bubbleChar: 'rgba(255, 255, 255, 0.92)',
    shadow: 'rgba(190, 150, 190, 0.16)',
    dark: false,
    uiOpacity: 100,
    ...partial
  }
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'sakura',
    name: '樱粉',
    desc: '默认粉白，柔和通透',
    builtin: true,
    tokens: tokens({})
  },
  {
    id: 'shorekeeper',
    name: '守岸蓝',
    desc: '守岸人主题，冷调深海蓝',
    builtin: true,
    tokens: tokens({
      bgBase: '#f2f7fd',
      bgGradA: '#f7fbff',
      bgGradB: '#e8f1fb',
      bgGradC: '#e3ecfa',
      glass: 'rgba(255, 255, 255, 0.74)',
      stroke: 'rgba(120, 160, 200, 0.24)',
      strokeStrong: 'rgba(120, 160, 200, 0.42)',
      accent: '#7fb3e8',
      accent2: '#9ec8f0',
      accentGradFrom: '#a8d0f0',
      accentGradMid: '#8ab8e8',
      accentGradTo: '#b8d8f5',
      text1: '#2c3e52',
      text2: '#5a7085',
      text3: '#8ba0b5',
      text4: '#aec0d0',
      bubbleUserFrom: '#bcdcf5',
      bubbleUserTo: '#d3e8fa',
      shadow: 'rgba(120, 160, 200, 0.18)'
    })
  },
  {
    id: 'aemeath',
    name: '爱弥斯粉',
    desc: '爱弥斯主题，热烈粉红',
    builtin: true,
    tokens: tokens({
      bgBase: '#fff6fa',
      bgGradA: '#fff9fc',
      bgGradB: '#ffe9f3',
      bgGradC: '#ffe3ee',
      accent: '#ff8ab8',
      accent2: '#ffb0c8',
      accentGradFrom: '#ffb3ce',
      accentGradMid: '#ff8ab8',
      accentGradTo: '#ffc2d8',
      text1: '#4a2c3a',
      text2: '#7d5568',
      text3: '#ab8798',
      text4: '#c9aebc',
      bubbleUserFrom: '#ffc2d8',
      bubbleUserTo: '#ffa8c8',
      shadow: 'rgba(255, 140, 180, 0.2)'
    })
  },
  {
    id: 'firefly',
    name: '流萤绿',
    desc: '流萤主题，安静青绿',
    builtin: true,
    tokens: tokens({
      bgBase: '#f4fbf7',
      bgGradA: '#f9fdfb',
      bgGradB: '#e9f7f0',
      bgGradC: '#e4f5ee',
      accent: '#6fc9a0',
      accent2: '#9ddcc0',
      accentGradFrom: '#a8e0c4',
      accentGradMid: '#7fd0aa',
      accentGradTo: '#b8e8d0',
      text1: '#2c4438',
      text2: '#577a68',
      text3: '#87a89a',
      text4: '#aec8bc',
      bubbleUserFrom: '#b8e8d0',
      bubbleUserTo: '#d0f0e0',
      shadow: 'rgba(110, 190, 150, 0.18)'
    })
  },
  {
    id: 'midnight',
    name: '午夜',
    desc: '深色主题，夜里不刺眼',
    builtin: true,
    tokens: tokens({
      bgBase: '#0e0f1a',
      bgGradA: '#12131f',
      bgGradB: '#151629',
      bgGradC: '#1a1533',
      glass: 'rgba(255, 255, 255, 0.055)',
      glassHover: 'rgba(255, 255, 255, 0.09)',
      stroke: 'rgba(255, 255, 255, 0.1)',
      strokeStrong: 'rgba(255, 255, 255, 0.18)',
      accent: '#a89cf5',
      accent2: '#7fc8f0',
      accentGradFrom: '#b8a8f8',
      accentGradMid: '#8f88f0',
      accentGradTo: '#90c8f5',
      text1: 'rgba(255, 255, 255, 0.94)',
      text2: 'rgba(255, 255, 255, 0.68)',
      text3: 'rgba(255, 255, 255, 0.44)',
      text4: 'rgba(255, 255, 255, 0.28)',
      bubbleUserFrom: '#6a5fd0',
      bubbleUserTo: '#8a7ae0',
      bubbleChar: 'rgba(255, 255, 255, 0.075)',
      shadow: 'rgba(0, 0, 0, 0.45)',
      dark: true
    })
  },
  {
    id: 'graphite',
    name: '石墨',
    desc: '中性灰，专注工作',
    builtin: true,
    tokens: tokens({
      bgBase: '#f5f5f7',
      bgGradA: '#fafafa',
      bgGradB: '#f0f0f2',
      bgGradC: '#ebebef',
      glass: 'rgba(255, 255, 255, 0.8)',
      stroke: 'rgba(120, 120, 130, 0.2)',
      strokeStrong: 'rgba(120, 120, 130, 0.36)',
      accent: '#8a8a99',
      accent2: '#a8a8b8',
      accentGradFrom: '#b0b0bd',
      accentGradMid: '#9494a3',
      accentGradTo: '#c0c0cc',
      text1: '#2e2e34',
      text2: '#5c5c66',
      text3: '#8c8c96',
      text4: '#b0b0ba',
      bubbleUserFrom: '#c8c8d2',
      bubbleUserTo: '#dcdce4',
      shadow: 'rgba(100, 100, 110, 0.16)'
    })
  },
  {
    id: 'sunset',
    name: '暖阳',
    desc: '橙调暖色，明亮有活力',
    builtin: true,
    tokens: tokens({
      bgBase: '#fffaf3',
      bgGradA: '#fffcf7',
      bgGradB: '#fff2e3',
      bgGradC: '#ffeedd',
      accent: '#f5a86a',
      accent2: '#f8c98a',
      accentGradFrom: '#fcc89a',
      accentGradMid: '#f5a86a',
      accentGradTo: '#ffd8b0',
      text1: '#4a3524',
      text2: '#7d6248',
      text3: '#ab8f76',
      text4: '#c9b49e',
      bubbleUserFrom: '#fcd0a8',
      bubbleUserTo: '#ffc090',
      shadow: 'rgba(245, 170, 110, 0.2)'
    })
  },
  {
    id: 'cyber',
    name: '霓虹',
    desc: '深色高饱和，赛博感',
    builtin: true,
    tokens: tokens({
      bgBase: '#0a0a14',
      bgGradA: '#0d0d1c',
      bgGradB: '#12102a',
      bgGradC: '#1a0f33',
      glass: 'rgba(255, 255, 255, 0.05)',
      glassHover: 'rgba(255, 255, 255, 0.085)',
      stroke: 'rgba(120, 255, 220, 0.16)',
      strokeStrong: 'rgba(120, 255, 220, 0.3)',
      accent: '#5ce1e6',
      accent2: '#ff6ec7',
      accentGradFrom: '#5ce1e6',
      accentGradMid: '#7d8aff',
      accentGradTo: '#ff6ec7',
      text1: 'rgba(235, 255, 252, 0.95)',
      text2: 'rgba(200, 235, 240, 0.7)',
      text3: 'rgba(160, 210, 220, 0.46)',
      text4: 'rgba(140, 190, 200, 0.3)',
      bubbleUserFrom: '#3a8fa8',
      bubbleUserTo: '#6a5ac0',
      bubbleChar: 'rgba(255, 255, 255, 0.07)',
      shadow: 'rgba(0, 0, 0, 0.5)',
      dark: true
    })
  }
]

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export const DEFAULT_BACKGROUND: BackgroundConfig = {
  enabled: false,
  mediaId: '',
  mediaPath: '',
  mediaKind: '',
  blur: 0,
  overlay: 55,
  overlayColor: '#ffffff',
  playbackRate: 1,
  loop: true,
  fit: 'cover',
  opacity: 100
}

const DEFAULT_THEME_STATE: ThemeState = {
  activeId: 'sakura',
  customTokens: tokens({}),
  saved: [],
  background: { ...DEFAULT_BACKGROUND }
}

export const themeStore = new JsonStore<ThemeState>('theme', () => structuredClone(DEFAULT_THEME_STATE))

export const themeRepo = {
  presets(): ThemePreset[] {
    return THEME_PRESETS
  },

  state(): ThemeState {
    const s = themeStore.read()
    let dirty = false

    if (!s.customTokens) {
      s.customTokens = tokens({})
      dirty = true
    }
    if (!Array.isArray(s.saved)) {
      s.saved = []
      dirty = true
    }
    if (!s.background || typeof s.background !== 'object') {
      s.background = { ...DEFAULT_BACKGROUND }
      dirty = true
    } else {
      for (const [k, v] of Object.entries(DEFAULT_BACKGROUND)) {
        if ((s.background as any)[k] === undefined) {
          ;(s.background as any)[k] = v
          dirty = true
        }
      }
    }
    const known = [...THEME_PRESETS.map((p) => p.id), 'custom', ...s.saved.map((p) => p.id)]
    if (!known.includes(s.activeId)) {
      s.activeId = 'sakura'
      dirty = true
    }

    if (dirty) themeStore.write(s)
    return s
  },

  patchBackground(patch: Partial<BackgroundConfig>): ThemeState {
    return themeStore.update((s) => {
      s.background = { ...DEFAULT_BACKGROUND, ...(s.background ?? {}), ...patch }
    })
  },

  resetBackground(): ThemeState {
    return themeStore.update((s) => {
      s.background = { ...DEFAULT_BACKGROUND }
    })
  },

  activeTokens(): ThemeTokens {
    const s = this.state()
    if (s.activeId === 'custom') return s.customTokens
    const builtin = THEME_PRESETS.find((p) => p.id === s.activeId)
    if (builtin) return builtin.tokens
    const custom = s.saved.find((p) => p.id === s.activeId)
    if (custom) return custom.tokens
    return THEME_PRESETS[0].tokens
  },

  setActive(id: string): ThemeState {
    return themeStore.update((s) => {
      s.activeId = id
    })
  },

  patchCustom(patch: Partial<ThemeTokens>): ThemeState {
    return themeStore.update((s) => {
      s.customTokens = { ...s.customTokens, ...patch }
      s.activeId = 'custom'
    })
  },

  setCustomFull(next: ThemeTokens): ThemeState {
    return themeStore.update((s) => {
      s.customTokens = next
      s.activeId = 'custom'
    })
  },

  saveCustom(name: string, desc: string): ThemeState {
    return themeStore.update((s) => {
      const id = 'custom_' + Date.now().toString(36)
      s.saved.push({
        id,
        name: name.trim() || '我的主题',
        desc: desc.trim() || '自定义',
        tokens: { ...s.customTokens },
        builtin: false
      })
      s.activeId = id
    })
  },

  deleteSaved(id: string): ThemeState {
    return themeStore.update((s) => {
      s.saved = s.saved.filter((p) => p.id !== id)
      if (s.activeId === id) s.activeId = 'sakura'
    })
  },

  forkPreset(id: string): ThemeState {
    return themeStore.update((s) => {
      const src = THEME_PRESETS.find((p) => p.id === id) ?? s.saved.find((p) => p.id === id)
      if (src) {
        s.customTokens = { ...src.tokens }
        s.activeId = 'custom'
      }
    })
  },

  resetCustom(): ThemeState {
    return themeStore.update((s) => {
      s.customTokens = tokens({})
      s.activeId = 'custom'
    })
  }
}

export { tokens as makeThemeTokens }
