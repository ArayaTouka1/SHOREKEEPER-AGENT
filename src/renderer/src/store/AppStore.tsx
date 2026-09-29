import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentToolSpec,
  AppBootstrap,
  AppSettings,
  Attachment,
  BackgroundConfig,
  BackgroundMedia,
  Character,
  CloudTtsConfig,
  ChatMessage,
  ChatSendChunk,
  Conversation,
  Deliverable,
  HardwareStatus,
  InworldVoice,
  JobInfo,
  MemoryItem,
  MessageAttachment,
  MessageImage,
  ModelInfo,
  ModelState,
  Persona,
  ThemePreset,
  ThemeState,
  ThemeTokens,
  ToolCallRecord,
  ToolSpec,
  SkillInfo,
  TodoItem,
  TtsEnvStatus,
  TtsSetupProgress,
  VoiceAsset,
  VoicePreset
} from '../../../shared/types'

function extnameOf(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0) return ''
  return name.slice(i).toLowerCase()
}

interface ToastItem {
  id: number
  ok: boolean
  text: string
}

interface AppState {
  toast: ToastItem | null
  pushToast: (t: { ok: boolean; text: string }) => void

  ready: boolean
  bootError: string | null
  character: Character | null
  characters: Character[]
  persona: Persona | null
  personas: Persona[]
  conversations: Conversation[]
  activeConversationId: string | null
  messages: ChatMessage[]
  streamingText: string
  awaitingText: boolean
  syncText: string
  syncRatio: number
  busy: boolean
  memories: MemoryItem[]
  settings: AppSettings | null
  tools: ToolSpec[]
  hardware: HardwareStatus | null
  voicePresets: VoicePreset[]
  voiceAssets: VoiceAsset[]
  theme: ThemeState | null
  themePresets: ThemePreset[]
  activeTokens: ThemeTokens | null
  backgrounds: BackgroundMedia[]
  inworldVoices: InworldVoice[]
  ttsEnv: TtsEnvStatus | null
  models: ModelInfo[]
  activeModelId: string
  attachments: Attachment[]
  // Agent
  agentTools: AgentToolSpec[]
  jobs: JobInfo[]
  todos: TodoItem[]
  deliverables: Deliverable[]
  workspace: string
  skills: SkillInfo[]
  version: string
  splashVideo: string
}

interface AppActions {
  reloadBootstrap: () => Promise<void>
  switchCharacter: (id: string) => Promise<void>
  saveCharacter: (patch: Partial<Character>) => Promise<Character | null>
  createCharacter: (patch?: Partial<Character>) => Promise<Character | null>
  deleteCharacter: (id: string) => Promise<void>
  savePersona: (patch: Partial<Persona>) => Promise<void>
  resetPersona: (id: string) => Promise<void>
  deletePersona: (id: string) => Promise<void>
  selectConversation: (id: string) => Promise<void>
  newConversation: () => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  sendMessage: (text: string, attachmentIds?: string[], image?: MessageImage) => Promise<void>
  approveTool: (toolCallId: string, approved: boolean) => Promise<void>
  refreshHardware: () => Promise<void>
  refreshMemories: () => Promise<void>
  addMemory: (text: string, weight?: number) => Promise<void>
  deleteMemory: (id: string) => Promise<void>
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>
  runTool: (name: string, params: Record<string, unknown>) => Promise<unknown>
  greetOnEntry: () => Promise<{ openingOpus: string | null; didGreet: boolean } | null>
  setAutoSpeak: (fn: ((text: string) => void) | null) => void
  setSyncRatio: (p: number) => void
  refreshVoicePresets: () => Promise<void>
  refreshVoiceAssets: () => Promise<void>
  setTheme: (id: string) => Promise<void>
  patchCustomTheme: (patch: Partial<ThemeTokens>) => Promise<void>
  saveCustomTheme: (name: string, desc: string) => Promise<void>
  deleteSavedTheme: (id: string) => Promise<void>
  forkThemePreset: (id: string) => Promise<void>
  resetCustomTheme: () => Promise<void>
  refreshBackgrounds: () => Promise<void>
  patchBackground: (patch: Partial<BackgroundConfig>) => Promise<void>
  resetBackground: () => Promise<void>
  // Inworld
  refreshInworldVoices: (apiKey?: string) => Promise<number>
  testInworld: (apiKey?: string) => Promise<{ ok: boolean; message: string }>
  refreshTtsEnv: () => Promise<void>
  setupTtsEnv: (input?: { pythonPath?: string; useMirror?: boolean }) => Promise<{ ok: boolean; message: string }>
  removeTtsEnv: () => Promise<{ ok: boolean; message: string }>
  refreshModels: () => Promise<void>
  selectModel: (id: string) => Promise<void>
  probeModel: (id: string, baseUrl?: string, apiKey?: string) => Promise<{ ok: boolean; message: string }>
  addModel: (input: {
    name: string
    kind: 'api' | 'local'
    baseUrl: string
    model: string
    note?: string
  }) => Promise<void>
  removeModel: (id: string) => Promise<void>
  disconnectModel: (id: string) => Promise<void>
  disconnectAllModels: () => Promise<void>
  refreshAttachments: () => Promise<void>
  pickAttachments: () => Promise<Attachment[]>
  removeAttachment: (id: string) => Promise<void>
  // Agent
  refreshJobs: () => Promise<void>
  killJob: (id: string) => Promise<void>
  refreshTodos: () => Promise<void>
  refreshDeliverables: () => Promise<void>
  refreshWorkspace: () => Promise<void>
  pickWorkspace: () => Promise<string | null>
  refreshSkills: () => Promise<void>
}

type Ctx = AppState & AppActions

const AppCtx = createContext<Ctx | null>(null)

export function useApp(): Ctx {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用')
  return ctx
}

function unwrap<T>(res: { ok: boolean; data?: T; error?: string } | undefined): T {
  if (!res) throw new Error('IPC 无响应')
  if (!res.ok) throw new Error(res.error ?? '未知错误')
  return res.data as T
}

const INITIAL: AppState = {
  toast: null,
  pushToast: () => {},
  ready: false,
  bootError: null,
  character: null,
  characters: [],
  persona: null,
  personas: [],
  conversations: [],
  activeConversationId: null,
  messages: [],
  streamingText: '',
  awaitingText: false,
  syncText: '',
  syncRatio: 0,
  busy: false,
  memories: [],
  settings: null,
  tools: [],
  hardware: null,
  voicePresets: [],
  voiceAssets: [],
  theme: null,
  themePresets: [],
  activeTokens: null,
  backgrounds: [],
  inworldVoices: [],
  ttsEnv: null,
  models: [],
  activeModelId: '',
  attachments: [],
  agentTools: [],
  jobs: [],
  todos: [],
  deliverables: [],
  workspace: '',
  skills: [],
  version: '0.4.0',
  splashVideo: ''
}

function resolveTokens(state: ThemeState | null, presets: ThemePreset[]): ThemeTokens | null {
  if (!state) return null
  if (state.activeId === 'custom') return state.customTokens
  const builtin = presets.find((p) => p.id === state.activeId)
  if (builtin) return builtin.tokens
  const saved = state.saved ? state.saved.find((p) => p.id === state.activeId) : undefined
  if (saved) return saved.tokens
  return presets[0] ? presets[0].tokens : null
}

export function AppProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = useState<AppState>(INITIAL)
  const streamRef = useRef('')
  const stateRef = useRef<AppState>(INITIAL)
  stateRef.current = state

  const refreshMessages = useCallback(async (conversationId?: string) => {
    const id = conversationId ?? stateRef.current.activeConversationId
    if (!id) return
    const res = await window.aimis.message.list(id)
    if (res.ok && res.data) setState((s) => s.activeConversationId === id ? ({ ...s, messages: res.data as ChatMessage[] }) : s)
  }, [])

  const refreshConversations = useCallback(async () => {
    const character = stateRef.current.character
    if (!character) return
    const res = await window.aimis.conversation.list(character.id)
    if (res.ok && res.data) setState((s) => ({ ...s, conversations: res.data as Conversation[] }))
  }, [])

  const refreshMemories = useCallback(async () => {
    const character = stateRef.current.character
    if (!character) return
    const res = await window.aimis.memory.list(character.id)
    if (res.ok && res.data) setState((s) => ({ ...s, memories: res.data as MemoryItem[] }))
  }, [])

  const refreshVoicePresets = useCallback(async () => {
    const res = await window.aimis.voice.presets()
    if (res.ok && res.data) setState((s) => ({ ...s, voicePresets: res.data as VoicePreset[] }))
  }, [])

  const refreshVoiceAssets = useCallback(async () => {
    const res = await window.aimis.voice.assets()
    if (res.ok && res.data) setState((s) => ({ ...s, voiceAssets: res.data as VoiceAsset[] }))
  }, [])


  const reloadBootstrap = useCallback(async () => {
    try {
      const boot = unwrap<AppBootstrap>(await window.aimis.bootstrap())
      const conv = boot.conversations[0] ?? null
      const presets = boot.themePresets ?? []
      setState((s) => ({
        ...s,
        ready: true,
        bootError: null,
        character: boot.character,
        characters: boot.characters,
        persona: boot.persona,
        personas: boot.personas,
        conversations: boot.conversations,
        activeConversationId: conv ? conv.id : null,
        memories: boot.memories,
        settings: boot.settings,
        workspace: boot.settings.agent.workspace || '',
        tools: boot.tools,
        hardware: boot.hardware,
        voicePresets: boot.voicePresets ?? [],
        voiceAssets: boot.voiceAssets ?? [],
        theme: boot.theme,
        themePresets: presets,
        activeTokens: resolveTokens(boot.theme, presets),
        backgrounds: boot.backgrounds ?? [],
        inworldVoices: boot.inworldVoices ?? [],
        ttsEnv: boot.ttsEnv ?? null,
        models: boot.models ?? [],
        activeModelId: boot.activeModelId ?? '',
        attachments: boot.attachments ?? [],
        agentTools: boot.agentTools ?? [],
        version: boot.version,
        splashVideo: boot.splashVideo ?? ''
      }))
      if (conv) await refreshMessages(conv.id)
    } catch (err) {
      setState((s) => ({ ...s, ready: true, bootError: err instanceof Error ? err.message : String(err) }))
    }
  }, [refreshMessages])

  useEffect(() => {
    void reloadBootstrap()
  }, [reloadBootstrap])

  useEffect(() => {
    let sequence = 0
    let disposed = false
    const off = window.aimis.onStateChanged(() => {
      const current = ++sequence
      void window.aimis.configuration().then(result => {
        if (disposed || current !== sequence || !result.ok || !result.data) return
        const boot = result.data
        setState(s => ({ ...s, settings: boot.settings, character: boot.character, characters: boot.characters, persona: boot.persona, personas: boot.personas, models: boot.models ?? [], activeModelId: boot.activeModelId ?? '', workspace: boot.workspace }))
      })
    })
    return () => { disposed = true; off() }
  }, [])


  const greetOnEntry = useCallback(async (): Promise<{ openingOpus: string | null; didGreet: boolean } | null> => {
    if (stateRef.current.busy) return null
    const result = await window.aimis.chat.greet()
    if (!result.ok || !result.data) return null
    const data = result.data
    setState(s => s.character?.id !== data.characterId || s.busy ? s : ({ ...s, conversations: data.conversations, activeConversationId: data.conversation.id, messages: data.messages }))
    return { openingOpus: data.openingOpus ?? null, didGreet: data.didGreet === true }
  }, [])

  const autoSpeakRef = useRef<((text: string) => void) | null>(null)
  const setAutoSpeak = useCallback((fn: ((text: string) => void) | null) => {
    autoSpeakRef.current = fn
  }, [])

  const setSyncRatio = useCallback((p: number) => {
    const ratio = Math.min(1, Math.max(0, p))
    setState((s) => {
      if (!s.syncText) return s
      if (ratio >= 1) return { ...s, syncText: '', syncRatio: 1 }
      return { ...s, syncRatio: ratio }
    })
  }, [])

  useEffect(() => {
    const off = window.aimis.chat.onStream((chunk: ChatSendChunk) => {
      if (chunk.type === 'delta' && chunk.text) {
        streamRef.current += chunk.text
        setState((s) => ({ ...s, streamingText: '', busy: true, awaitingText: true }))
        return
      }
      if (chunk.type === 'done') {
        const spoken = chunk.text ?? streamRef.current
        streamRef.current = ''
        setState((s) => ({ ...s, streamingText: '', busy: false, awaitingText: false, syncText: spoken && autoSpeakRef.current ? spoken : '', syncRatio: 1 }))
        void refreshMessages()
        void refreshConversations()
        void refreshMemories()
        if (spoken && autoSpeakRef.current) {
          autoSpeakRef.current(spoken)
        }
        return
      }
      if (chunk.type === 'error') {
        streamRef.current = ''
        setState((s) => ({ ...s, streamingText: '', busy: false, awaitingText: false }))
        return
      }
      if (chunk.type === 'tool') {
        void refreshMessages()
        void refreshMemories()
      }
    })
    return off
  }, [refreshMessages, refreshConversations, refreshMemories])


  const switchCharacter = useCallback(
    async (id: string) => {
      const data = unwrap<{
        character: Character
        persona: Persona
        conversations: Conversation[]
        memories: MemoryItem[]
      }>(await window.aimis.character.activate(id))
      const conv = data.conversations[0] ?? null
      setState((s) => ({
        ...s,
        character: data.character,
        persona: data.persona,
        conversations: data.conversations,
        activeConversationId: conv ? conv.id : null,
        memories: data.memories,
        messages: [],
        streamingText: '', syncText: '', syncRatio: 1, awaitingText: false
      }))
      if (conv) await refreshMessages(conv.id)
    },
    [refreshMessages]
  )

  const saveCharacter = useCallback(async (patch: Partial<Character>) => {
    const activeId = stateRef.current.character ? stateRef.current.character.id : undefined
    const payload: Partial<Character> = patch.id ? patch : { ...patch, id: activeId }
    const data = unwrap<{ character: Character; characters: Character[]; personas: Persona[] }>(
      await window.aimis.character.save(payload)
    )
    setState((s) => ({ ...s, character: data.character, characters: data.characters, personas: data.personas }))
    return data.character
  }, [])

  const createCharacter = useCallback(async (patch: Partial<Character> = {}) => {
    const data = unwrap<{ character: Character; characters: Character[]; personas: Persona[] }>(
      await window.aimis.character.save({
        name: '新角色',
        latinName: 'NEW',
        greeting: '今天想一起聊聊什么?',
        ...patch
      })
    )
    setState((s) => ({ ...s, character: data.character, characters: data.characters, personas: data.personas }))
    return data.character
  }, [])

  const deleteCharacter = useCallback(
    async (id: string) => {
      const list = unwrap<Character[]>(await window.aimis.character.remove(id))
      const target = list[0]
      if (!target) {
        setState((s) => ({ ...s, characters: list }))
        return
      }
      const active = unwrap<{
        character: Character
        persona: Persona
        conversations: Conversation[]
        memories: MemoryItem[]
      }>(await window.aimis.character.activate(target.id))
      const conv = active.conversations[0] ?? null
      setState((s) => ({
        ...s,
        characters: list,
        character: active.character,
        persona: active.persona,
        conversations: active.conversations,
        activeConversationId: conv ? conv.id : null,
        memories: active.memories,
        messages: []
      }))
      if (conv) await refreshMessages(conv.id)
    },
    [refreshMessages]
  )

  const savePersona = useCallback(async (patch: Partial<Persona>) => {
    const data = unwrap<{ persona: Persona; personas: Persona[] }>(await window.aimis.persona.save(patch))
    setState((s) => {
      const nextPersona = s.character && s.character.personaId === data.persona.id ? data.persona : s.persona
      return { ...s, personas: data.personas, persona: nextPersona }
    })
  }, [])

  const resetPersona = useCallback(async (id: string) => {
    const data = unwrap<{ persona: Persona | null; personas: Persona[] }>(await window.aimis.persona.reset(id))
    setState((s) => {
      const nextPersona = s.character && s.character.personaId === id ? data.persona : s.persona
      return { ...s, personas: data.personas, persona: nextPersona }
    })
  }, [])

  const deletePersona = useCallback(async (id: string) => {
    const list = unwrap<Persona[]>(await window.aimis.persona.remove(id))
    setState((s) => ({ ...s, personas: list }))
  }, [])


  const selectConversation = useCallback(
    async (id: string) => {
      setState((s) => ({ ...s, activeConversationId: id, streamingText: '' }))
      await refreshMessages(id)
    },
    [refreshMessages]
  )

  const newConversation = useCallback(async () => {
    const character = stateRef.current.character
    if (!character) return
    const conv = unwrap<Conversation>(await window.aimis.conversation.create(character.id))
    const list = unwrap<Conversation[]>(await window.aimis.conversation.list(character.id))
    setState((s) => ({ ...s, conversations: list, activeConversationId: conv.id, messages: [], streamingText: '' }))
  }, [])

  const deleteConversation = useCallback(
    async (id: string) => {
      const list = unwrap<Conversation[]>(await window.aimis.conversation.remove(id))
      const current = stateRef.current.activeConversationId
      const stillExists = list.some((c) => c.id === current)
      const nextId = stillExists ? current : list[0] ? list[0].id : null
      setState((s) => ({
        ...s,
        conversations: list,
        activeConversationId: nextId,
        messages: stillExists ? s.messages : []
      }))
      if (nextId && !stillExists) await refreshMessages(nextId)
    },
    [refreshMessages]
  )


  const sendMessage = useCallback(
    async (text: string, attachmentIds: string[] = [], image?: MessageImage) => {
      const trimmed = text.trim()
      if (!trimmed && attachmentIds.length === 0 && !image) return
      let convId = stateRef.current.activeConversationId
      const character = stateRef.current.character
      if (!convId && character) {
        const conv = unwrap<Conversation>(await window.aimis.conversation.create(character.id))
        convId = conv.id
        setState((s) => ({ ...s, activeConversationId: conv.id, conversations: [conv, ...s.conversations] }))
      }
      if (!convId) return
      const cid = convId

      streamRef.current = ''
      const atts: MessageAttachment[] = attachmentIds
        .map((id) => stateRef.current.attachments.find((a) => a.id === id))
        .filter((a): a is Attachment => Boolean(a))
        .map((a) => ({
          name: a.name,
          path: a.path,
          kind: a.kind,
          size: a.size,
          ext: extnameOf(a.name)
        }))
      const localMsg: ChatMessage = {
        id: 'local_' + Date.now(),
        conversationId: cid,
        role: 'user',
        text: trimmed || '（看看我上传的文件）',
        createdAt: Date.now(),
        images: image ? [image] : undefined,
        attachments: atts.length ? atts : undefined
      }
      setState((s) => ({ ...s, busy: true, streamingText: '', awaitingText: true, messages: [...s.messages, localMsg] }))
      try {
        const result = await window.aimis.chat.send({ conversationId: cid, text: trimmed, attachmentIds, image })
        if (!result.ok) throw new Error(result.error || '发送失败')
      } catch (error) {
        setState(s => ({ ...s, busy: false, messages: s.messages.filter(m => m.id !== localMsg.id) }))
        throw error
      }
    },
    []
  )

  const approveTool = useCallback(async (toolCallId: string, approved: boolean) => {
    await window.aimis.tool.approve({ toolCallId, approved })
    setState((s) => ({
      ...s,
      messages: s.messages.map((m) => {
        if (!m.toolCall || m.toolCall.id !== toolCallId) return m
        const next: ToolCallRecord = {
          ...m.toolCall,
          state: approved ? 'running' : 'denied',
          summary: approved ? '已允许，正在执行' : '用户拒绝了这次操作'
        }
        return { ...m, toolCall: next }
      })
    }))
  }, [])


  const refreshHardware = useCallback(async () => {
    const hw = unwrap<HardwareStatus>(await window.aimis.system.hardware())
    setState((s) => ({ ...s, hardware: hw }))
  }, [])

  const addMemory = useCallback(
    async (text: string, weight = 0.7) => {
      const character = stateRef.current.character
      if (!character || !text.trim()) return
      await window.aimis.memory.add({ text: text.trim(), characterId: character.id, weight })
      await refreshMemories()
    },
    [refreshMemories]
  )

  const deleteMemory = useCallback(async (id: string) => {
    const list = unwrap<MemoryItem[]>(await window.aimis.memory.remove(id))
    setState((s) => ({ ...s, memories: list }))
  }, [])

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = unwrap<AppSettings>(await window.aimis.settings.save(patch))
    setState((s) => ({ ...s, settings: next, workspace: next.agent.workspace || s.workspace }))
  }, [])

  const runTool = useCallback(async (name: string, params: Record<string, unknown>) => {
    const res = await window.aimis.tool.run({ name, params })
    if (!res.ok) throw new Error(res.error ?? '工具执行失败')
    return res.data
  }, [])


  const applyThemeState = useCallback((themeState: ThemeState) => {
    setState((s) => ({
      ...s,
      theme: themeState,
      activeTokens: resolveTokens(themeState, s.themePresets)
    }))
  }, [])

  const setTheme = useCallback(
    async (id: string) => {
      applyThemeState(unwrap<ThemeState>(await window.aimis.theme.setActive(id)))
    },
    [applyThemeState]
  )

  const patchCustomTheme = useCallback(
    async (patch: Partial<ThemeTokens>) => {
      applyThemeState(unwrap<ThemeState>(await window.aimis.theme.patchCustom(patch)))
    },
    [applyThemeState]
  )

  const saveCustomTheme = useCallback(
    async (name: string, desc: string) => {
      applyThemeState(unwrap<ThemeState>(await window.aimis.theme.saveCustom({ name, desc })))
    },
    [applyThemeState]
  )

  const deleteSavedTheme = useCallback(
    async (id: string) => {
      applyThemeState(unwrap<ThemeState>(await window.aimis.theme.deleteSaved(id)))
    },
    [applyThemeState]
  )

  const forkThemePreset = useCallback(
    async (id: string) => {
      applyThemeState(unwrap<ThemeState>(await window.aimis.theme.forkPreset(id)))
    },
    [applyThemeState]
  )

  const resetCustomTheme = useCallback(async () => {
    applyThemeState(unwrap<ThemeState>(await window.aimis.theme.resetCustom()))
  }, [applyThemeState])


  const refreshBackgrounds = useCallback(async () => {
    const res = await window.aimis.background.list()
    if (res.ok && res.data) setState((s) => ({ ...s, backgrounds: res.data as BackgroundMedia[] }))
  }, [])

  const patchBackground = useCallback(
    async (patch: Partial<BackgroundConfig>) => {
      const next = unwrap<ThemeState>(await window.aimis.background.patch(patch))
      applyThemeState(next)
    },
    [applyThemeState]
  )

  const resetBackground = useCallback(async () => {
    const next = unwrap<ThemeState>(await window.aimis.background.reset())
    applyThemeState(next)
  }, [applyThemeState])

  /* ---------------- Inworld ---------------- */

  const refreshInworldVoices = useCallback(async (apiKey?: string) => {
    const res = await window.aimis.inworld.voices(apiKey ? { apiKey } : undefined)
    if (res.ok && res.data) {
      const list = res.data as InworldVoice[]
      setState((s) => ({ ...s, inworldVoices: list }))
      return list.length
    }
    return 0
  }, [])

  const testInworld = useCallback(async (apiKey?: string) => {
    const res = await window.aimis.inworld.test(apiKey ? { apiKey } : undefined)
    if (!res.ok) return { ok: false, message: res.error ?? '测试失败' }
    const data = res.data as { ok: boolean; message: string; voices: number }
    if (data.ok) {
      const list = await window.aimis.inworld.voices()
      if (list.ok && list.data) setState((s) => ({ ...s, inworldVoices: list.data as InworldVoice[] }))
    }
    return { ok: data.ok, message: data.message }
  }, [])


  const refreshTtsEnv = useCallback(async () => {
    const res = await window.aimis.ttsEnv.status()
    if (res.ok && res.data) setState((s) => ({ ...s, ttsEnv: res.data as TtsEnvStatus }))
  }, [])

  const setupTtsEnv = useCallback(async () => {
    return { ok: false, message: '本地语音生成引擎已移除' }
  }, [])

  const removeTtsEnv = useCallback(async () => {
    return { ok: false, message: '本地语音生成引擎已移除' }
  }, [])


  const refreshModels = useCallback(async () => {
    const res = await window.aimis.model.list()
    const st = await window.aimis.model.state()
    if (res.ok && res.data) {
      setState((s) => ({
        ...s,
        models: res.data as ModelInfo[],
        activeModelId: st.ok && st.data ? (st.data as ModelState).activeId : s.activeModelId
      }))
    }
  }, [])

  const selectModel = useCallback(async (id: string) => {
    const res = await window.aimis.model.setActive(id)
    if (!res.ok) throw new Error(res.error || '模型切换失败')
    if (res.ok && res.data) {
      const d = res.data as { models: ModelInfo[]; active: ModelInfo }
      setState((s) => ({ ...s, models: d.models, activeModelId: d.active.id }))
    }
  }, [])

  const probeModel = useCallback(async (id: string, baseUrl?: string, apiKey?: string) => {
    const res = await window.aimis.model.probe({ id, baseUrl, apiKey })
    const list = await window.aimis.model.list()
    if (list.ok && list.data) setState((s) => ({ ...s, models: list.data as ModelInfo[] }))
    if (!res.ok) return { ok: false, message: res.error ?? '探测失败' }
    const d = res.data as { ok: boolean; message: string }
    return { ok: d.ok, message: d.message }
  }, [])

  const addModel = useCallback(
    async (input: { name: string; kind: 'api' | 'local'; baseUrl: string; model: string; apiKey?: string; note?: string }) => {
      const res = await window.aimis.model.add(input)
      if (res.ok && res.data) {
        const d = res.data as { models: ModelInfo[] }
        setState((s) => ({ ...s, models: d.models }))
      }
    },
    []
  )

  const removeModel = useCallback(async (id: string) => {
    const res = await window.aimis.model.remove(id)
    if (res.ok && res.data) {
      const d = res.data as { state: ModelState; models: ModelInfo[] }
      setState((s) => ({ ...s, models: d.models, activeModelId: d.state.activeId }))
    }
  }, [])

  const disconnectModel = useCallback(async (id: string) => {
    const res = await window.aimis.model.disconnect(id)
    if (res.ok && res.data) {
      const d = res.data as { models: ModelInfo[]; active: ModelInfo }
      setState((s) => ({ ...s, models: d.models, activeModelId: d.active.id }))
    }
  }, [])

  const disconnectAllModels = useCallback(async () => {
    const res = await window.aimis.model.disconnectAll()
    if (res.ok && res.data) {
      const d = res.data as { models: ModelInfo[]; active: ModelInfo }
      setState((s) => ({ ...s, models: d.models, activeModelId: d.active.id }))
    }
  }, [])


  const refreshAttachments = useCallback(async () => {
    const res = await window.aimis.attachment.list()
    if (res.ok && res.data) setState((s) => ({ ...s, attachments: res.data as Attachment[] }))
  }, [])

  const pickAttachments = useCallback(async () => {
    const res = await window.aimis.attachment.pick()
    if (!res.ok || !res.data) return []
    const d = res.data as { attachments: Attachment[]; list: Attachment[] }
    setState((s) => ({ ...s, attachments: d.list }))
    return d.attachments
  }, [])

  const removeAttachment = useCallback(async (id: string) => {
    const res = await window.aimis.attachment.remove(id)
    if (res.ok && res.data) setState((s) => ({ ...s, attachments: res.data as Attachment[] }))
  }, [])

  /* ---------------- Agent ---------------- */

  const refreshJobs = useCallback(async () => {
    const res = await window.aimis.agent.jobs()
    if (res.ok && res.data) setState((s) => ({ ...s, jobs: res.data as JobInfo[] }))
  }, [])

  const killJob = useCallback(async (id: string) => {
    const res = await window.aimis.agent.jobKill(id)
    if (res.ok && res.data) {
      const d = res.data as { jobs: JobInfo[] }
      setState((s) => ({ ...s, jobs: d.jobs }))
    }
  }, [])

  const refreshTodos = useCallback(async () => {
    const res = await window.aimis.agent.todos()
    if (res.ok && res.data) setState((s) => ({ ...s, todos: res.data as TodoItem[] }))
  }, [])

  const refreshDeliverables = useCallback(async () => {
    const res = await window.aimis.agent.deliverables()
    if (res.ok && res.data) setState((s) => ({ ...s, deliverables: res.data as Deliverable[] }))
  }, [])

  const refreshWorkspace = useCallback(async () => {
    const res = await window.aimis.agent.workspace()
    if (res.ok && res.data) setState((s) => ({ ...s, workspace: String(res.data) }))
  }, [])

  const pickWorkspace = useCallback(async () => {
    const res = await window.aimis.agent.pickWorkspace()
    if (!res.ok || !res.data) return null
    const p = String(res.data)
    const updated = await window.aimis.settings.get()
    setState((s) => ({ ...s, workspace: p, settings: updated.ok && updated.data ? updated.data : s.settings }))
    return p
  }, [])

  const refreshSkills = useCallback(async () => {
    const res = await window.aimis.agent.skills()
    if (res.ok && res.data) setState((s) => ({ ...s, skills: res.data as SkillInfo[] }))
  }, [])


  const [toast, setToast] = useState<ToastItem | null>(null)
  const toastTimer = useRef<number | null>(null)

  const pushToast = useCallback((t: { ok: boolean; text: string }) => {
    setToast({ id: Date.now(), ok: t.ok, text: t.text })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])


  const actions = useMemo(
    () => ({
      toast,
      pushToast,
      reloadBootstrap,
      switchCharacter,
      saveCharacter,
      createCharacter,
      deleteCharacter,
      savePersona,
      resetPersona,
      deletePersona,
      selectConversation,
      newConversation,
      deleteConversation,
      sendMessage,
      approveTool,
      refreshHardware,
      refreshMemories,
      addMemory,
      deleteMemory,
      saveSettings,
      runTool,
      greetOnEntry,
      setAutoSpeak,
      setSyncRatio,
      refreshVoicePresets,
      refreshVoiceAssets,
      setTheme,
      patchCustomTheme,
      saveCustomTheme,
      deleteSavedTheme,
      forkThemePreset,
      resetCustomTheme,
      refreshBackgrounds,
      patchBackground,
      resetBackground,
      refreshInworldVoices,
      testInworld,
      refreshTtsEnv,
      setupTtsEnv,
      removeTtsEnv,
      refreshModels,
      selectModel,
      probeModel,
      addModel,
      removeModel,
      disconnectModel,
      disconnectAllModels,
      refreshAttachments,
      pickAttachments,
      removeAttachment,
      refreshJobs,
      killJob,
      refreshTodos,
      refreshDeliverables,
      refreshWorkspace,
      pickWorkspace,
      refreshSkills
    }),
    [
      reloadBootstrap,
      switchCharacter,
      saveCharacter,
      createCharacter,
      deleteCharacter,
      savePersona,
      resetPersona,
      deletePersona,
      selectConversation,
      newConversation,
      deleteConversation,
      sendMessage,
      approveTool,
      refreshHardware,
      refreshMemories,
      addMemory,
      deleteMemory,
      saveSettings,
      runTool,
      greetOnEntry,
      setAutoSpeak,
      setSyncRatio,
      refreshVoicePresets,
      refreshVoiceAssets,
      setTheme,
      patchCustomTheme,
      saveCustomTheme,
      deleteSavedTheme,
      forkThemePreset,
      resetCustomTheme,
      refreshBackgrounds,
      patchBackground,
      resetBackground,
      refreshInworldVoices,
      testInworld,
      refreshTtsEnv,
      setupTtsEnv,
      removeTtsEnv,
      refreshModels,
      selectModel,
      probeModel,
      addModel,
      removeModel,
      disconnectModel,
      disconnectAllModels,
      refreshAttachments,
      pickAttachments,
      removeAttachment,
      refreshJobs,
      killJob,
      refreshTodos,
      refreshDeliverables,
      refreshWorkspace,
      pickWorkspace,
      refreshSkills
    ]
  )

  const value = useMemo<Ctx>(() => ({ ...state, ...actions }), [state, actions])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
