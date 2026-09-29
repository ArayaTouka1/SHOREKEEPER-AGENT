import type { Character, Persona, CharacterAvatar, CharacterVoice, VoiceEngine } from '../shared/types'
import { JsonStore, uid, ensureDataDir } from './store'
import { join } from 'node:path'
import { existsSync, copyFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { shorekeeperAvatar,
  shorekeeperBanner,
  aemeathAvatar,
  aemeathBanner,
  fireflyAvatar,
  fireflyBanner,
  VOICE_FILES, chloeAvatar, chloeBanner } from './assets'
import { loadBuiltinPersonas, readUserPersonas, PERSONA_FILES, userPersonaDir } from './persona'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function defaultVoice(packFile: string, rate = 1, pitch = 0): CharacterVoice {
  return {
    engine: 'voice-pack',
    voicePackFile: packFile,
    customPackPath: null,
    voiceId: '',
    rate,
    pitch,
    volume: 100,
    autoSpeak: true,
    endpoint: '',
    localBackend: 'gpt-sovits',
    inworldModel: 'inworld-tts-2'
  }
}

const DEFAULT_VOICE_PACK: Record<string, string> = {
  char_shorekeeper: VOICE_FILES.shorekeeperVoice ?? '',
  char_aemeath: VOICE_FILES.aemeathVoice ?? '',
  char_firefly: VOICE_FILES.fireflyVoice ?? '',
  char_chloe: VOICE_FILES.chloeVoice ?? ''
}

/** Cloud voice IDs belong to each user's account and are never preconfigured. */
export const DEFAULT_INWORLD_VOICE: Record<string, string> = {}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

const BUILTIN_AVATARS: Record<string, CharacterAvatar> = {
  char_shorekeeper: { main: shorekeeperAvatar, secondary: shorekeeperAvatar, banner: shorekeeperBanner },
  char_aemeath: { main: aemeathAvatar, secondary: aemeathAvatar, banner: aemeathBanner },
  char_firefly: { main: fireflyAvatar, secondary: fireflyAvatar, banner: fireflyBanner },
  char_chloe: { main: chloeAvatar, secondary: chloeAvatar, banner: chloeBanner }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function makeAvatarSvg(initial: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs>
<radialGradient id="g" cx="35%" cy="28%" r="85%">
<stop offset="0%" stop-color="#EFE6F5"/><stop offset="55%" stop-color="#C7B4E0"/><stop offset="100%" stop-color="#6A5A85"/>
</radialGradient>
</defs>
<rect width="256" height="256" rx="128" fill="url(#g)"/>
<text x="128" y="128" text-anchor="middle" dominant-baseline="central"
 font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="104" font-weight="600"
 fill="#ffffff" fill-opacity="0.95">${initial}</text>
</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`
}

function makeBannerSvg(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="#FFF7FB"/><stop offset="50%" stop-color="#EFE6F5"/><stop offset="100%" stop-color="#F3E9F6"/>
</linearGradient></defs>
<rect width="1200" height="360" fill="url(#bg)"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`
}

export function makeAvatars(initial: string): CharacterAvatar {
  return { main: makeAvatarSvg(initial), secondary: makeAvatarSvg(initial), banner: makeBannerSvg() }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function defaultCharacters(): Character[] {
  const now = Date.now()
  return [
    {
      id: 'char_shorekeeper',
      name: '守岸人',
      latinName: 'SHOREKEEPER',
      tagline: 'COMPANION SYSTEM',
      avatar: BUILTIN_AVATARS.char_shorekeeper,
      personaId: 'persona_shorekeeper',
      voice: defaultVoice(DEFAULT_VOICE_PACK.char_shorekeeper, 1, 0),
      greeting: '今天想一起做点什么?',
      builtin: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'char_aemeath',
      name: '爱弥斯',
      latinName: 'AEMEATH',
      tagline: 'COMPANION SYSTEM',
      avatar: BUILTIN_AVATARS.char_aemeath,
      personaId: 'persona_aemeath',
      voice: defaultVoice(DEFAULT_VOICE_PACK.char_aemeath, 1, 2),
      greeting: '今天想一起聊聊什么?',
      builtin: true,
      createdAt: now + 1,
      updatedAt: now + 1
    },
    {
      id: 'char_firefly',
      name: '流萤',
      latinName: 'FIREFLY',
      tagline: 'COMPANION SYSTEM',
      avatar: BUILTIN_AVATARS.char_firefly,
      personaId: 'persona_firefly',
      voice: defaultVoice(DEFAULT_VOICE_PACK.char_firefly, 1, 0),
      greeting: '今天想做点什么呢?',
      builtin: true,
      createdAt: now + 2,
      updatedAt: now + 2
    },
    {
      id: 'char_chloe',
      name: '嘉神川克罗艾',
      latinName: 'CHLOE',
      tagline: 'COMPANION SYSTEM',
      avatar: BUILTIN_AVATARS.char_chloe,
      personaId: 'persona_chloe',
      voice: defaultVoice(DEFAULT_VOICE_PACK.char_chloe, 1, 0),
      greeting: '今天想一起做点什么?',
      builtin: true,
      createdAt: now + 3,
      updatedAt: now + 3
    }
  ]
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

interface CharacterState {
  characters: Character[]
  personaOverrides: Record<string, string>
  activeCharacterId: string
}

const DEFAULT_ACTIVE = 'char_shorekeeper'

export const characterStore = new JsonStore<CharacterState>('characters', () => ({
  characters: defaultCharacters(),
  personaOverrides: {},
  activeCharacterId: DEFAULT_ACTIVE
}))

const VALID_ENGINES: VoiceEngine[] = ['voice-pack', 'inworld', 'system', 'none']

function migrate(state: CharacterState): CharacterState {
  let dirty = false

  if (!state.personaOverrides || typeof state.personaOverrides !== 'object') {
    state.personaOverrides = {}
    dirty = true
  }

  for (const def of defaultCharacters()) {
    if (!state.characters.some((c) => c.id === def.id)) {
      state.characters.push(def)
      dirty = true
    }
  }

  // Built-in identities are pinned to their own folder; legacy overrides are retained but inactive.
  for (const c of state.characters) {
    if (!c.builtin) continue
    if (c.personaId !== PERSONA_FILES.find(p => p.characterId === c.id)?.id) {
      const def = defaultCharacters().find((d) => d.id === c.id)
      if (def) {
        c.personaId = def.personaId
        dirty = true
      }
    }
  }

  for (const c of state.characters) {
    const v = c.voice as Partial<CharacterVoice> | undefined
    if (!v) {
      c.voice = defaultVoice(DEFAULT_VOICE_PACK[c.id] ?? '', 1, 0)
      dirty = true
    } else {
      const legacy = v.engine as string
      if (legacy === 'gpt-sovits' || legacy === 'cosyvoice' || legacy === 'local') {
        v.engine = 'voice-pack'
        dirty = true
      } else if (legacy === 'edge-tts') {
        v.engine = 'system'
        dirty = true
      }
      if (!VALID_ENGINES.includes(v.engine as VoiceEngine)) {
        v.engine = 'voice-pack'
        dirty = true
      }
      if (typeof v.voicePackFile !== 'string') {
        v.voicePackFile = DEFAULT_VOICE_PACK[c.id] ?? ''
        dirty = true
      }
      if (v.customPackPath === undefined) {
        v.customPackPath = null
        dirty = true
      }
      if (typeof v.autoSpeak !== 'boolean') {
        v.autoSpeak = true
        dirty = true
      }
      if (typeof v.endpoint !== 'string') {
        v.endpoint = ''
        dirty = true
      }
      if (!['kokoro', 'gpt-sovits', 'cosyvoice', 'qwen3'].includes(v.localBackend ?? '')) {
        v.localBackend = 'kokoro'
        dirty = true
      }
      if (typeof v.inworldModel !== 'string' || !v.inworldModel) {
        v.inworldModel = 'inworld-tts-2'
        dirty = true
      }
      if (!v.voicePackFile && DEFAULT_VOICE_PACK[c.id]) {
        v.voicePackFile = DEFAULT_VOICE_PACK[c.id]
        dirty = true
      }
      const inworldId = DEFAULT_INWORLD_VOICE[c.id]
      if (inworldId && !v.voiceId) {
        v.voiceId = inworldId
        dirty = true
      }
    }

    const builtinAvatar = BUILTIN_AVATARS[c.id]
    if (builtinAvatar && (!c.avatar || !c.avatar.main || c.avatar.main.startsWith('data:image/svg'))) {
      c.avatar = builtinAvatar
      dirty = true
    }

    const personaFile = PERSONA_FILES.find((p) => p.characterId === c.id)
    if (personaFile && !c.personaId) {
      c.personaId = personaFile.id
      dirty = true
    }
  }

  for (const d of defaultCharacters()) {
    if (!state.characters.some((c) => c.id === d.id)) {
      state.characters.push(d)
      dirty = true
    }
  }

  let seenNewRole = false
  const kept: Character[] = []
  for (const c of state.characters) {
    if (!c.builtin && c.name === '新角色') {
      if (seenNewRole) {
        dirty = true
        continue
      }
      seenNewRole = true
    }
    kept.push(c)
  }
  if (kept.length !== state.characters.length) state.characters = kept

  if (!state.characters.some((c) => c.id === state.activeCharacterId)) {
    state.activeCharacterId = state.characters[0]?.id ?? DEFAULT_ACTIVE
    dirty = true
  }

  if (dirty) characterStore.write(state)
  return state
}

export const characterRepo = {
  state(): CharacterState {
    const s = characterStore.read()
    if (!s.characters.length) {
      s.characters = defaultCharacters()
      s.activeCharacterId = DEFAULT_ACTIVE
      characterStore.write(s)
    }
    return migrate(s)
  },

  list(): Character[] {
    return this.state().characters
  },

  /**
   */
  personas(): Persona[] {
    const s = this.state()
    const builtin = loadBuiltinPersonas().map((p) => {
      const override = s.personaOverrides[p.id]
      return override && !p.builtin ? { ...p, content: override } : p
    })
    return builtin
  },

  active(): Character {
    const s = this.state()
    return s.characters.find((c) => c.id === s.activeCharacterId) ?? s.characters[0]
  },

  personaOf(character: Character): Persona {
    const all = this.personas()
    const fixed = PERSONA_FILES.find(p => p.characterId === character.id)
    const found = all.find((p) => p.id === (fixed?.id ?? character.personaId))
    if (found) return found
    const mapped = PERSONA_FILES.find((f) => f.characterId === character.id)
    if (mapped) {
      const byMap = all.find((p) => p.id === mapped.id)
      if (byMap) return byMap
    }
    return all[0]
  },

  activate(id: string): Character {
    const s = this.state()
    if (s.characters.some((c) => c.id === id)) {
      s.activeCharacterId = id
      characterStore.write(s)
    }
    return this.active()
  },

  saveCharacter(patch: Partial<Character> & { id?: string }): Character {
    const s = this.state()
    const now = Date.now()
    if (patch.id) {
      const idx = s.characters.findIndex((c) => c.id === patch.id)
      if (idx >= 0) {
        const merged: Character = { ...s.characters[idx], ...patch, id: s.characters[idx].id, updatedAt: now }
        const fixedPersona = PERSONA_FILES.find(p => p.characterId === merged.id)
        if (fixedPersona) merged.personaId = fixedPersona.id
        merged.latinName = (merged.latinName || merged.name).toUpperCase()
        merged.voice = { ...s.characters[idx].voice, ...(patch.voice ?? {}) }
        s.characters[idx] = merged
        characterStore.write(s)
        return merged
      }
    }
    const created: Character = {
      id: uid('char'),
      name: patch.name ?? '新角色',
      latinName: (patch.latinName ?? patch.name ?? 'NEW').toUpperCase(),
      tagline: patch.tagline ?? 'COMPANION SYSTEM',
      avatar: patch.avatar ?? makeAvatars((patch.name ?? '新').slice(0, 1)),
      personaId: patch.personaId ?? '',
      voice: patch.voice ?? defaultVoice('', 1, 0),
      greeting: patch.greeting ?? '今天想一起聊聊什么?',
      builtin: false,
      createdAt: now,
      updatedAt: now
    }
    s.characters.push(created)
    characterStore.write(s)
    return created
  },

  deleteCharacter(id: string): Character[] {
    const s = this.state()
    const target = s.characters.find((c) => c.id === id)
    if (!target || target.builtin) return s.characters
    s.characters = s.characters.filter((c) => c.id !== id)
    if (s.activeCharacterId === id) s.activeCharacterId = s.characters[0]?.id ?? ''
    characterStore.write(s)
    return s.characters
  },

  /**
   */
  /**
   */
  registerPersonaFile(fileName: string, name: string, content: string): Persona {
    const now = Date.now()
    const safeName = name.trim() || fileName.replace(/\.(txt|md|markdown)$/i, '')
    return {
      id: `user_persona:${fileName}`,
      name: safeName,
      content,
      source: 'custom',
      builtin: false,
      updatedAt: now
    }
  },

  bindPersona(personaId: string, characterId?: string): Character | null {
    const s = this.state()
    const targetId = characterId ?? s.activeCharacterId
    const c = s.characters.find((x) => x.id === targetId)
    if (!c) return null
    const fixed = PERSONA_FILES.find(p => p.characterId === c.id)
    if (fixed && fixed.id !== personaId) throw new Error('此角色固定使用自己的角色文件夹')
    c.personaId = personaId
    c.updatedAt = Date.now()
    characterStore.write(s)
    return c
  },

  savePersona(patch: Partial<Persona> & { id?: string }): Persona {
    if (PERSONA_FILES.some(p => p.id === patch.id)) throw new Error('内置角色固定使用角色文件夹，不能覆盖提示词')
    const s = this.state()
    const now = Date.now()

    if (patch.id && patch.id.startsWith('user_persona:')) {
      const fileName = patch.id.slice('user_persona:'.length)
      const content = patch.content ?? ''
      writeFileSync(join(userPersonaDir(), fileName), content, 'utf-8')
      return {
        id: patch.id,
        name: patch.name ?? fileName.replace(/\.(txt|md)$/i, ''),
        content,
        source: 'custom',
        builtin: false,
        updatedAt: now
      }
    }

    if (patch.id) {
      const meta = PERSONA_FILES.find((p) => p.id === patch.id)
      if (meta) {
        if (typeof patch.content === 'string') {
          s.personaOverrides[patch.id] = patch.content
          characterStore.write(s)
        }
        const base = loadBuiltinPersonas().find((p) => p.id === patch.id)
        return {
          id: patch.id,
          name: patch.name ?? meta.name,
          content: patch.content ?? base?.content ?? '',
          source: 'builtin',
          builtin: true,
          updatedAt: now
        }
      }
    }

    const name = patch.name?.trim() || '新人格'
    const content = patch.content ?? `# ${name}\n\n## 语气\n- \n\n## 行为\n- \n`
    const safe = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
    let fileName = `${safe}.txt`
    let n = 1
    while (existsSync(join(userPersonaDir(), fileName))) {
      fileName = `${safe}_${n++}.txt`
    }
    writeFileSync(join(userPersonaDir(), fileName), content, 'utf-8')
    return { id: 'user_persona:' + fileName, name, content, source: 'custom', builtin: false, updatedAt: now }
  },

  resetPersona(id: string): Persona | null {
    const meta = PERSONA_FILES.find((p) => p.id === id)
    if (!meta) return null
    const s = this.state()
    delete s.personaOverrides[id]
    characterStore.write(s)
    return loadBuiltinPersonas().find((p) => p.id === id) ?? null
  },

  deletePersona(id: string): boolean {
    if (!id.startsWith('user_persona:')) return false
    const full = join(userPersonaDir(), id.slice('user_persona:'.length))
    if (!existsSync(full)) return false
    try {
      unlinkSync(full)
      return true
    } catch {
      return false
    }
  },

  importAvatar(sourcePath: string, slot: 'main' | 'secondary' | 'banner', characterId: string): string {
    const dir = join(ensureDataDir(), 'assets')
    const ext = (sourcePath.split('.').pop() ?? 'png').toLowerCase()
    const name = `${characterId}_${slot}_${Date.now()}.${ext}`
    const dest = join(dir, name)
    copyFileSync(sourcePath, dest)
    return dest
  },

  assetFiles(): string[] {
    const dir = join(ensureDataDir(), 'assets')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
  }
}
