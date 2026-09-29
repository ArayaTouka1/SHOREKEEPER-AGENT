import type {
  AgentToolSpec,
  AppBootstrap,
  AppSettings,
  Attachment,
  BackgroundConfig,
  BackgroundMedia,
  Character,
  ChatMessage,
  ChatSendChunk,
  CloseAppResult,
  CloudTtsConfig,
  Conversation,
  Deliverable,
  HardwareStatus,
  InworldVoice,
  IpcResult,
  JobInfo,
  LocalBackend,
  LocalModelEntry,
  LocalTtsConfig,
  MachinePermission,
  StickerWithUrl,
  MemoryItem,
  ModelInfo,
  ModelState,
  Persona,
  PluginImportResult,
  PluginInfo,
  PluginInvokeResult,
  PluginListResult,
  Qwen3EnvStatus,
  Qwen3ManifestEntry,
  Qwen3Progress,
  Qwen3SynthResult,
  Qwen3Variant,
  Qwen3Voice,
  RunningApp,
  SkillInfo,
  ThemePreset,
  ThemeState,
  ThemeTokens,
  TodoItem,
  ToolCallRecord,
  ToolSpec,
  TtsEnvStatus,
  TtsSetupProgress,
  VoiceAsset,
  VoicePreset
} from '../../../shared/types'

export interface MachinePermissionOption {
  tier: MachinePermission
  label: string
  hint: string
}

export interface MachinePermissionState {
  tier: MachinePermission
  label: string
  hint: string
  options: MachinePermissionOption[]
}

declare global {
  interface Window {
    aimis: {
      splash: {
        status(): Promise<IpcResult<{ custom: boolean; name: string; url: string }>>
        pick(): Promise<IpcResult<{ custom: boolean; name: string; url: string } | null>>
        reset(): Promise<IpcResult<{ custom: boolean; name: string; url: string }>>
      }
      approvals: {
        pending(): Promise<IpcResult<Array<{ id: string; workspace: string; name: string; params: Record<string, unknown> }>>>
        decide(id: string, approved: boolean): Promise<IpcResult<boolean>>
      }
      configuration(): Promise<IpcResult<Pick<AppBootstrap, 'settings' | 'character' | 'characters' | 'persona' | 'personas' | 'models' | 'activeModelId'> & { workspace: string }>>
      onStateChanged(cb: () => void): () => void
      bootstrap(): Promise<IpcResult<AppBootstrap>>
      character: {
        list(): Promise<IpcResult<Character[]>>
        save(
          patch: Partial<Character>
        ): Promise<IpcResult<{ character: Character; characters: Character[]; personas: Persona[] }>>
        remove(id: string): Promise<IpcResult<Character[]>>
        activate(
          id: string
        ): Promise<IpcResult<{ character: Character; persona: Persona; conversations: Conversation[]; memories: MemoryItem[] }>>
      }
      persona: {
        list(): Promise<IpcResult<Persona[]>>
        save(patch: Partial<Persona>): Promise<IpcResult<{ persona: Persona; personas: Persona[] }>>
        reset(id: string): Promise<IpcResult<{ persona: Persona | null; personas: Persona[] }>>
        remove(id: string): Promise<IpcResult<Persona[]>>
        pickFile(): Promise<IpcResult<string[] | null>>
        import(input: {
          sourcePath: string
          name?: string
          bindToCharacter?: boolean
        }): Promise<IpcResult<{ persona: Persona; personas: Persona[]; chars: number }>>
        openDir(): Promise<IpcResult<string>>
        packs(): Promise<IpcResult<Array<{ id: string; name: string; path: string; fileCount: number }>>>
      }
      conversation: {
        list(characterId?: string): Promise<IpcResult<Conversation[]>>
        create(characterId: string, title?: string): Promise<IpcResult<Conversation>>
        remove(id: string): Promise<IpcResult<Conversation[]>>
      }
      message: {
        list(conversationId: string): Promise<IpcResult<ChatMessage[]>>
        append(input: { conversationId: string; role: string; text: string }): Promise<IpcResult<ChatMessage>>
      }
      chat: {
        greet(): Promise<IpcResult<{ conversation: Conversation; messages: ChatMessage[]; conversations: Conversation[]; characterId: string; openingOpus: string | null; didGreet: boolean }>>
        send(input: {
          conversationId: string
          text: string
          attachmentIds?: string[]
          image?: MessageImage
        }): Promise<IpcResult<{ messageId: string }>>
        abort(conversationId: string): Promise<IpcResult<boolean>>
        onStream(cb: (chunk: ChatSendChunk) => void): () => void
      }
      memory: {
        list(characterId?: string): Promise<IpcResult<MemoryItem[]>>
        add(input: { text: string; characterId: string; kind?: string; weight?: number }): Promise<IpcResult<MemoryItem>>
        remove(id: string): Promise<IpcResult<MemoryItem[]>>
        search(q: { query: string; characterId: string; topK?: number }): Promise<IpcResult<MemoryItem[]>>
      }
      tool: {
        list(): Promise<IpcResult<ToolSpec[]>>
        run(input: { name: string; params: Record<string, unknown> }): Promise<IpcResult<unknown>>
        approve(input: { toolCallId: string; approved: boolean }): Promise<IpcResult<{ handled: boolean }>>
      }
      settings: {
        get(): Promise<IpcResult<AppSettings>>
        save(patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>>
        reset(): Promise<IpcResult<AppSettings>>
      }
      voice: {
        presets(): Promise<IpcResult<VoicePreset[]>>
        assets(): Promise<IpcResult<VoiceAsset[]>>
        resolve(input: { voicePackFile: string; customPackPath: string | null }): Promise<IpcResult<string | null>>
        pickFile(): Promise<IpcResult<string | null>>
        openDir(): Promise<IpcResult<string>>
        packs(): Promise<
          IpcResult<Array<{ id: string; name: string; path: string; fileCount: number }>>
        >
        importFile(): Promise<
          IpcResult<{ fileName: string; size: number; sourcePath: string; assets: VoiceAsset[] } | null>
        >
        remove(fileName: string): Promise<IpcResult<VoiceAsset[]>>
      }
      inworld: {
        voices(patch?: Partial<CloudTtsConfig>): Promise<IpcResult<InworldVoice[]>>
        test(patch?: Partial<CloudTtsConfig>): Promise<IpcResult<{ ok: boolean; message: string; voices: number }>>
        synthesize(input: {
          text: string
          voiceId: string
          modelId?: string
          rate?: number
          pitch?: number
        }): Promise<IpcResult<{ path: string; url: string; bytes: number; voiceId: string; modelId: string }>>
        clone(): Promise<IpcResult<never>>
        providers(): Promise<
          IpcResult<{
            providers: Array<{ id: string; baseUrl: string; authMode: string; model: string; label: string; hint: string }>
            builtinModels: string[]
          }>
        >
        models(provider?: string): Promise<IpcResult<string[]>>
        switchProvider(provider: string): Promise<IpcResult<CloudTtsConfig>>
      }
      /**
       */
      ttsEnv: {
        status(): Promise<IpcResult<TtsEnvStatus>>
        setup(): Promise<IpcResult<unknown>>
        remove(): Promise<IpcResult<unknown>>
        report(): Promise<IpcResult<string>>
        models(): IpcResult<unknown>
        pickModel(): string | null
        setModel(): null
        synthesize(): IpcResult<never>
        probe(): IpcResult<never>
        onProgress(): () => void
      }
      sticker: {
        list(characterId: string): Promise<IpcResult<StickerWithUrl[]>>
        stats(): Promise<IpcResult<Array<{ characterId: string; count: number; local: number; user: number }>>>
        pick(input: {
          characterId: string
          mood?: string
          recentIds?: string[]
        }): Promise<IpcResult<{ sticker: StickerWithUrl | null; reason: string }>>
        add(input: {
          characterId: string
          sourcePath: string
          mood?: string
          tags?: string[]
        }): Promise<IpcResult<StickerWithUrl>>
        pickFile(): Promise<IpcResult<string[]>>
        remove(input: { characterId: string; stickerId: string }): Promise<IpcResult<boolean>>
        search(input: {
          query: string
          limit?: number
          first?: number
        }): Promise<IpcResult<Array<{ url: string; thumbnail?: string; title?: string }>>>
        scrape(input: { url: string; limit?: number }): Promise<IpcResult<Array<{ url: string }>>>
        download(input: {
          characterId: string
          url: string
          mood?: string
          tags?: string[]
        }): Promise<IpcResult<StickerWithUrl>>
        openDir(): Promise<IpcResult<string>>
        send(input: unknown): Promise<IpcResult<unknown>>
      },
      background: {
        list(): Promise<IpcResult<BackgroundMedia[]>>
        pickFile(): Promise<IpcResult<string | null>>
        openDir(): Promise<IpcResult<string>>
        packs(): Promise<
          IpcResult<Array<{ id: string; name: string; path: string; fileCount: number }>>
        >
        importFile(
          mode?: 'copy' | 'external'
        ): Promise<IpcResult<{ media: BackgroundMedia; list: BackgroundMedia[] } | null>>
        external(path: string): Promise<IpcResult<BackgroundMedia | null>>
        remove(id: string): Promise<IpcResult<BackgroundMedia[]>>
        patch(patch: Partial<BackgroundConfig>): Promise<IpcResult<ThemeState>>
        reset(): Promise<IpcResult<ThemeState>>
      }
      relationship: {
        get(id?: string): Promise<IpcResult<import('../../../shared/relationship').CharacterRelationship>>
        reset(id: string): Promise<IpcResult<import('../../../shared/relationship').CharacterRelationship>>
      }
      model: {
        list(): Promise<IpcResult<ModelInfo[]>>
        selectable(): Promise<IpcResult<ModelInfo[]>>
        state(): Promise<IpcResult<ModelState>>
        setActive(id: string): Promise<IpcResult<{ state: ModelState; models: ModelInfo[]; active: ModelInfo }>>
        probe(input: {
          id: string
          baseUrl?: string
          apiKey?: string
        }): Promise<IpcResult<{ ok: boolean; message: string; models?: string[]; models2?: ModelInfo[] }>>
        add(input: {
          name: string
          kind: 'api' | 'local'
          baseUrl: string
          model: string
          apiKey?: string
          note?: string
        }): Promise<IpcResult<{ model: ModelInfo; models: ModelInfo[] }>>
        remove(id: string): Promise<IpcResult<{ state: ModelState; models: ModelInfo[] }>>
        update(input: { id: string; patch: Partial<ModelInfo> }): Promise<IpcResult<{ state: ModelState; models: ModelInfo[] }>>
        markConnected(input: { id: string; ok: boolean }): Promise<IpcResult<{ state: ModelState; models: ModelInfo[] }>>
        disconnect(
          id: string
        ): Promise<IpcResult<{ state: ModelState; models: ModelInfo[]; active: ModelInfo }>>
        disconnectAll(): Promise<IpcResult<{ state: ModelState; models: ModelInfo[]; active: ModelInfo }>>
      }
      attachment: {
        list(): Promise<IpcResult<Attachment[]>>
        pick(): Promise<IpcResult<{ attachments: Attachment[]; list: Attachment[] } | null>>
        importFile(path: string): Promise<IpcResult<{ attachment: Attachment; list: Attachment[] }>>
        external(path: string): Promise<IpcResult<Attachment | null>>
        remove(id: string): Promise<IpcResult<Attachment[]>>
        open(path: string): Promise<IpcResult<{ ok: boolean; error: string }>>
      }
      agent: {
        security(): Promise<IpcResult<import('../../../shared/workspace').WorkspaceSecurity>>
        trust(trusted: boolean): Promise<IpcResult<import('../../../shared/workspace').WorkspaceSecurity>>
        saveRule(input: { command: string; effect: 'allow' | 'deny' }): Promise<IpcResult<import('../../../shared/workspace').WorkspaceSecurity>>
        removeRule(id: string): Promise<IpcResult<import('../../../shared/workspace').WorkspaceSecurity>>
        clearApprovals(): Promise<IpcResult<import('../../../shared/workspace').WorkspaceSecurity>>
        roots(): Promise<IpcResult<Array<{ name: string; path: string }>>>
        openDocument(path: string): Promise<IpcResult<import('../../../shared/workspace').DocumentData>>
        pickDocument(): Promise<IpcResult<string | null>>
        tools(): Promise<IpcResult<AgentToolSpec[]>>
        features(): Promise<
          IpcResult<{
            features: Array<{
              id: string
              label: string
              description: string
              enabled: boolean
              requires: string[]
              locked: boolean
            }>
            report: {
              loaded: string[]
              disabled: string[]
              skipped: Array<{ id: string; reason: string }>
              failed: Array<{ id: string; error: string }>
            } | null
          }>
        >
        toggleFeature(input: {
          id: string
          enabled: boolean
        }): Promise<
          IpcResult<{
            features: Array<{
              id: string
              label: string
              description: string
              enabled: boolean
              requires: string[]
              locked: boolean
            }>
          }>
        >
        run(input: { name: string; params: Record<string, unknown> }): Promise<IpcResult<unknown>>
        jobs(): Promise<IpcResult<JobInfo[]>>
        jobOutput(input: { jobId: string; tail?: number }): Promise<IpcResult<{ info: JobInfo; output: string } | null>>
        jobKill(jobId: string): Promise<IpcResult<{ killed: boolean; jobs: JobInfo[] }>>
        todos(): Promise<IpcResult<TodoItem[]>>
        deliverables(): Promise<IpcResult<Deliverable[]>>
        workspace(): Promise<IpcResult<string>>
        setWorkspace(p: string): Promise<IpcResult<string>>
        pickWorkspace(): Promise<IpcResult<string | null>>
        skills(): Promise<IpcResult<SkillInfo[]>>
        skillLoad(name: string): Promise<IpcResult<SkillInfo | null>>
        machinePermission(): Promise<IpcResult<MachinePermissionState>>
        setMachinePermission(tier: MachinePermission): Promise<IpcResult<MachinePermissionState>>
        trayMenu(): Promise<IpcResult<Array<{ label?: string; type?: string; enabled?: boolean }>>>
        trayAction(action: string): Promise<IpcResult<boolean>>
        onNavigate(cb: (route: string) => void): () => void
      }
      theme: {
        presets(): Promise<IpcResult<ThemePreset[]>>
        state(): Promise<IpcResult<ThemeState>>
        setActive(id: string): Promise<IpcResult<ThemeState>>
        patchCustom(patch: Partial<ThemeTokens>): Promise<IpcResult<ThemeState>>
        setCustom(next: ThemeTokens): Promise<IpcResult<ThemeState>>
        saveCustom(input: { name: string; desc: string }): Promise<IpcResult<ThemeState>>
        deleteSaved(id: string): Promise<IpcResult<ThemeState>>
        forkPreset(id: string): Promise<IpcResult<ThemeState>>
        resetCustom(): Promise<IpcResult<ThemeState>>
      }
      system: {
        hardware(): Promise<IpcResult<HardwareStatus>>
        launchApp(input: { appName: string; exePath?: string }): Promise<IpcResult<unknown>>
        installedApps(): Promise<IpcResult<ToolSpec[]>>
        closeApp(appName: string): Promise<IpcResult<CloseAppResult>>
        runningApps(): Promise<IpcResult<RunningApp[]>>
        appRunningList(): Promise<
          IpcResult<Array<{ name: string; display: string; running: boolean; pids: number[] }>>
        >
        openExternal(url: string): Promise<IpcResult<boolean>>
        pickImage(): Promise<IpcResult<string | null>>
        pickMedia(): Promise<IpcResult<{ path: string; kind: 'image' | 'video' } | null>>
        pickAudio(): Promise<IpcResult<string | null>>
        exportData(json: string): Promise<IpcResult<string | null>>
        importData(): Promise<IpcResult<string | null>>
      }
      plugin: {
        list(): Promise<IpcResult<PluginListResult>>
        dir(): Promise<IpcResult<string>>
        importFolder(): Promise<IpcResult<PluginImportResult | null>>
        remove(id: string): Promise<IpcResult<PluginListResult>>
        toggle(id: string, enabled?: boolean): Promise<IpcResult<PluginListResult>>
        invoke(id: string, command: string, args?: unknown): Promise<IpcResult<PluginInvokeResult>>
        reveal(id?: string): Promise<IpcResult<string>>
      }
      window: {
        minimize(): void
        maximize(): void
        close(): void
        closeAction(action: 'minimize' | 'quit'): Promise<IpcResult<boolean>>
        getClosePref(): Promise<IpcResult<{ action: 'ask' | 'minimize' | 'quit'; askDisabled: boolean }>>
        setClosePref(input: {
          action?: 'ask' | 'minimize' | 'quit'
          askDisabled?: boolean
        }): Promise<IpcResult<{ action: 'ask' | 'minimize' | 'quit'; askDisabled: boolean }>>
        onShowCloseDialog(cb: () => void): () => void
      }
    }
  }
}

export type { ToolCallRecord }
