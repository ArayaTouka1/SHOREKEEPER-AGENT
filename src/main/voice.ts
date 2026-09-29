import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { join, basename, extname, isAbsolute } from 'node:path'
import type { VoiceAsset, VoicePreset } from '../shared/types'
import { VOICE_FILES } from './assets'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

let cachedDir: string | null = null

export function builtinVoiceDir(): string {
  if (cachedDir) return cachedDir

  const candidates = [
    join(process.resourcesPath ?? '', 'voices'),
    join(app.getAppPath(), 'resources', 'voices'),
    join(app.getAppPath(), '..', 'resources', 'voices'),
    join(__dirname, '..', '..', 'resources', 'voices')
  ]

  for (const dir of candidates) {
    if (dir && existsSync(dir)) {
      cachedDir = dir
      return dir
    }
  }

  const fallback = join(app.getPath('userData'), 'voices')
  if (!existsSync(fallback)) mkdirSync(fallback, { recursive: true })
  cachedDir = fallback
  return fallback
}

export function userVoiceDir(): string {
  const dir = join(app.getPath('userData'), 'voices')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const BUILTIN_MAP: Array<{ key: keyof typeof VOICE_FILES; characterId: string; label: string }> = [
  { key: 'shorekeeperVoice', characterId: 'char_shorekeeper', label: '守岸人 · 原声' },
  { key: 'aemeathVoice', characterId: 'char_aemeath', label: '爱弥斯 · 原声' },
  { key: 'fireflyVoice', characterId: 'char_firefly', label: '流萤 · 原声' }
]

export function listVoiceAssets(): VoiceAsset[] {
  const out: VoiceAsset[] = []

  const builtinDir = builtinVoiceDir()
  for (const item of BUILTIN_MAP) {
    const file = VOICE_FILES[item.key]
    if (!file) continue
    const full = join(builtinDir, file)
    if (existsSync(full)) {
      out.push({
        key: item.key,
        label: item.label,
        characterId: item.characterId,
        path: full,
        builtin: true,
        durationSec: null
      })
    }
  }

  const userDir = userVoiceDir()
  try {
    for (const f of readdirSync(userDir)) {
      const ext = extname(f).toLowerCase()
      if (!['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'].includes(ext)) continue
      const full = join(userDir, f)
      out.push({
        key: 'user:' + f,
        label: basename(f, ext),
        path: full,
        builtin: false,
        durationSec: null
      })
    }
  } catch {
  }

  return out
}

/**
 */
export function resolveVoicePath(voicePackFile: string, customPackPath: string | null): string | null {
  if (customPackPath && isAbsolute(customPackPath) && existsSync(customPackPath)) {
    return customPackPath
  }
  if (!voicePackFile) return null

  if (isAbsolute(voicePackFile) && existsSync(voicePackFile)) return voicePackFile

  const inUser = join(userVoiceDir(), voicePackFile)
  if (existsSync(inUser)) return inUser

  const inBuiltin = join(builtinVoiceDir(), voicePackFile)
  if (existsSync(inBuiltin)) return inBuiltin

  return null
}

export function importVoiceFile(sourcePath: string): { fileName: string; size: number } {
  const dir = userVoiceDir()
  const ext = extname(sourcePath) || '.mp3'
  const stamp = Date.now().toString(36)
  const safeBase = basename(sourcePath, ext).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
  const fileName = `${safeBase}_${stamp}${ext}`
  copyFileSync(sourcePath, join(dir, fileName))
  return { fileName, size: statSync(join(dir, fileName)).size }
}

export function deleteVoiceFile(fileName: string): boolean {
  const full = join(userVoiceDir(), basename(fileName))
  if (!existsSync(full)) return false
  try {
    const { unlinkSync } = require('node:fs')
    unlinkSync(full)
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'vp_inworld_clone',
    name: '云合成克隆音色（推荐）',
    desc: '云合成，用账号里克隆的角色音色朗读任意文本',
    engine: 'inworld',
    voiceId: '',
    rate: 1,
    pitch: 0,
    gender: 'neutral'
  },
  {
    id: 'vp_system_shorekeeper',
    name: '系统合成 · 清冷女声',
    desc: '走 Windows 合成，可离线使用',
    engine: 'system',
    voiceId: 'zh-CN-XiaoxiaoNeural',
    rate: 0.96,
    pitch: -2,
    gender: 'female'
  },
  {
    id: 'vp_off',
    name: '不发声',
    desc: '关闭朗读，只显示文字',
    engine: 'none',
    voiceId: '',
    rate: 1,
    pitch: 0,
    gender: 'neutral'
  }
]
