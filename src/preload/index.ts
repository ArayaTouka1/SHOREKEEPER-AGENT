import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/channels'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

const api = {
  splash: {
    status: () => invoke('splash:status'),
    pick: () => invoke('splash:pick'),
    reset: () => invoke('splash:reset')
  },
  approvals: {
    pending: () => invoke('approval:pending'),
    decide: (id: string, approved: boolean) => invoke('approval:decide', id, approved)
  },
  configuration: () => invoke('app:configuration'),
  onStateChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('app:stateChanged', listener)
    return () => ipcRenderer.removeListener('app:stateChanged', listener)
  },
  bootstrap: () => invoke(CH.bootstrap),

  character: {
    list: () => invoke(CH.characterList),
    save: (patch: unknown) => invoke(CH.characterSave, patch),
    remove: (id: string) => invoke(CH.characterDelete, id),
    activate: (id: string) => invoke(CH.characterActivate, id)
  },
  persona: {
    list: () => invoke(CH.personaList),
    save: (patch: unknown) => invoke(CH.personaSave, patch),
    reset: (id: string) => invoke(CH.personaReset, id),
    remove: (id: string) => invoke(CH.personaDelete, id),
    pickFile: () => invoke(CH.personaPickFile),
    openDir: () => invoke(CH.personaOpenDir),
    packs: () => invoke(CH.personaPacks),
    import: (input: { sourcePath: string; name?: string; bindToCharacter?: boolean }) =>
      invoke(CH.personaImport, input)
  },
  conversation: {
    list: (characterId?: string) => invoke(CH.conversationList, characterId),
    create: (characterId: string, title?: string) => invoke(CH.conversationCreate, characterId, title),
    remove: (id: string) => invoke(CH.conversationDelete, id)
  },
  message: {
    list: (conversationId: string) => invoke(CH.messageList, conversationId),
    append: (input: unknown) => invoke(CH.messageAppend, input)
  },
  chat: {
    greet: () => invoke('chat:greet'),
    send: (input: {
      conversationId: string
      text: string
      attachmentIds?: string[]
      image?: unknown
    }) => invoke(CH.chatSend, input),
    abort: (conversationId: string) => invoke(CH.chatAbort, conversationId),
    onStream: (cb: (chunk: unknown) => void) => {
      const listener = (_e: unknown, chunk: unknown): void => cb(chunk)
      ipcRenderer.on(CH.chatStream, listener)
      return () => ipcRenderer.removeListener(CH.chatStream, listener)
    }
  },
  memory: {
    list: (characterId?: string) => invoke(CH.memoryList, characterId),
    add: (input: unknown) => invoke(CH.memoryAdd, input),
    remove: (id: string) => invoke(CH.memoryDelete, id),
    search: (q: { query: string; characterId: string; topK?: number }) => invoke(CH.memorySearch, q)
  },
  tool: {
    list: () => invoke(CH.toolList),
    run: (input: { name: string; params: Record<string, unknown> }) => invoke(CH.toolRun, input),
    approve: (input: { toolCallId: string; approved: boolean }) => invoke(CH.toolApprove, input)
  },
  settings: {
    get: () => invoke(CH.settingsGet),
    save: (patch: unknown) => invoke(CH.settingsSave, patch),
    reset: () => invoke(CH.settingsReset)
  },
  voice: {
    presets: () => invoke(CH.voicePresets),
    assets: () => invoke(CH.voiceAssets),
    resolve: (input: { voicePackFile: string; customPackPath: string | null }) => invoke(CH.voiceResolve, input),
    pickFile: () => invoke(CH.voicePickFile),
    importFile: () => invoke(CH.voiceImport),
    remove: (fileName: string) => invoke(CH.voiceDelete, fileName)
  },
  inworld: {
    voices: (patch?: unknown) => invoke(CH.inworldVoices, patch),
    test: (patch?: unknown) => invoke(CH.inworldTest, patch),
    synthesize: (input: { text: string; voiceId: string; modelId?: string; rate?: number; pitch?: number }) =>
      invoke(CH.inworldSynthesize, input),
    clone: (input: unknown) => invoke(CH.inworldClone, input),
    providers: () => invoke(CH.ttsProviders),
    models: (provider?: string) => invoke(CH.ttsModels, provider),
    switchProvider: (provider: string) => invoke(CH.ttsSwitchProvider, provider)
  },
  ttsEnv: {
    status: () => invoke(CH.ttsEnvStatus),
    setup: () => invoke(CH.ttsEnvSetup),
    remove: () => invoke(CH.ttsEnvRemove),
    report: () => invoke(CH.ttsEnvReport),
    models: () => [],
    pickModel: () => null,
    setModel: () => null,
    synthesize: () => ({ ok: false, error: '本地语音生成引擎已移除' }),
    probe: () => ({ ok: false, error: '本地语音生成引擎已移除' }),
    onProgress: () => () => undefined
  },
  sticker: {
    list: (characterId: string) => invoke(CH.stickerList, characterId),
    stats: () => invoke(CH.stickerStats),
    pick: (input: unknown) => invoke(CH.stickerPick, input),
    add: (input: unknown) => invoke(CH.stickerAdd, input),
    pickFile: () => invoke(CH.stickerPickFile),
    remove: (input: unknown) => invoke(CH.stickerRemove, input),
    search: (input: unknown) => invoke(CH.stickerSearch, input),
    scrape: (input: unknown) => invoke(CH.stickerScrape, input),
    download: (input: unknown) => invoke(CH.stickerDownload, input),
    openDir: () => invoke(CH.stickerOpenDir),
    send: (input: unknown) => invoke(CH.stickerSend, input),
    proactive: (input: unknown) => invoke(CH.stickerProactive, input)
  },
  background: {
    list: () => invoke(CH.bgList),
    pickFile: () => invoke(CH.bgPickFile),
    importFile: (mode?: 'copy' | 'external') => invoke(CH.bgImport, mode),
    external: (path: string) => invoke(CH.bgExternal, path),
    remove: (id: string) => invoke(CH.bgDelete, id),
    patch: (patch: unknown) => invoke(CH.bgPatch, patch),
    reset: () => invoke(CH.bgReset)
  },
  relationship: {
    get: (id?: string) => invoke(CH.relationshipGet, id),
    reset: (id: string) => invoke(CH.relationshipReset, id)
  },
  model: {
    list: () => invoke(CH.modelList),
    selectable: () => invoke(CH.modelSelectable),
    state: () => invoke(CH.modelState),
    setActive: (id: string) => invoke(CH.modelSetActive, id),
    probe: (input: { id: string; baseUrl?: string; apiKey?: string }) => invoke(CH.modelProbe, input),
    add: (input: unknown) => invoke(CH.modelAdd, input),
    remove: (id: string) => invoke(CH.modelRemove, id),
    update: (input: { id: string; patch: unknown }) => invoke(CH.modelUpdate, input),
    markConnected: (input: { id: string; ok: boolean }) => invoke(CH.modelMarkConnected, input),
    disconnect: (id: string) => invoke(CH.modelDisconnect, id),
    disconnectAll: () => invoke(CH.modelDisconnectAll)
  },
  attachment: {
    list: () => invoke(CH.attList),
    pick: () => invoke(CH.attPick),
    importFile: (path: string) => invoke(CH.attImport, path),
    external: (path: string) => invoke(CH.attExternal, path),
    remove: (id: string) => invoke(CH.attDelete, id),
    open: (path: string) => invoke(CH.attOpen, path)
  },
  agent: {
    security: () => invoke(CH.workspaceSecurity),
    trust: (trusted: boolean) => invoke(CH.workspaceTrust, trusted),
    saveRule: (input: { command: string; effect: 'allow' | 'deny' }) => invoke(CH.commandRuleSave, input),
    removeRule: (id: string) => invoke(CH.commandRuleRemove, id),
    clearApprovals: () => invoke(CH.approvalsClear),
    roots: () => invoke(CH.fileRoots),
    openDocument: (path: string) => invoke(CH.documentOpen, path),
    pickDocument: () => invoke(CH.documentPick),
    tools: () => invoke(CH.agentTools),
    features: () => invoke(CH.featureList),
    toggleFeature: (input: { id: string; enabled: boolean }) => invoke(CH.featureToggle, input),
    run: (input: { name: string; params: Record<string, unknown> }) => invoke(CH.agentRun, input),
    jobs: () => invoke(CH.agentJobs),
    jobOutput: (input: { jobId: string; tail?: number }) => invoke(CH.agentJobOutput, input),
    jobKill: (jobId: string) => invoke(CH.agentJobKill, jobId),
    todos: () => invoke(CH.agentTodos),
    deliverables: () => invoke(CH.agentDeliverables),
    workspace: () => invoke(CH.agentWorkspace),
    setWorkspace: (p: string) => invoke(CH.agentSetWorkspace, p),
    pickWorkspace: () => invoke(CH.agentPickWorkspace),
    skills: () => invoke(CH.agentSkills),
    skillLoad: (name: string) => invoke(CH.agentSkillLoad, name),
    machinePermission: () => invoke(CH.machinePermissionGet),
    setMachinePermission: (tier: string) => invoke(CH.machinePermissionSet, tier),
    trayMenu: () => invoke(CH.trayMenu),
    trayAction: (action: string) => invoke(CH.trayAction, action),
    onNavigate: (cb: (route: string) => void) => {
      const listener = (_e: unknown, route: string): void => cb(route)
      ipcRenderer.on('tray:navigate', listener)
      return () => ipcRenderer.removeListener('tray:navigate', listener)
    }
  },
  plugin: {
    list: () => invoke(CH.pluginList),
    dir: () => invoke(CH.pluginDir),
    importFolder: () => invoke(CH.pluginImport),
    remove: (id: string) => invoke(CH.pluginRemove, id),
    toggle: (id: string, enabled?: boolean) => invoke(CH.pluginToggle, { id, enabled }),
    invoke: (id: string, command: string, args?: unknown) => invoke(CH.pluginInvoke, { id, command, args }),
    reveal: (id?: string) => invoke(CH.pluginReveal, id)
  },
  window: {
    minimize: () => ipcRenderer.send(CH.windowMinimize),
    maximize: () => ipcRenderer.send(CH.windowMaximize),
    close: () => ipcRenderer.send(CH.windowClose),
    closeAction: (action: 'minimize' | 'quit') => invoke(CH.windowCloseAction, action),
    getClosePref: () => invoke(CH.windowGetClosePref),
    setClosePref: (input: { action?: 'ask' | 'minimize' | 'quit'; askDisabled?: boolean }) =>
      invoke(CH.windowSetClosePref, input),
    onShowCloseDialog: (cb: () => void) => {
      const listener = (): void => cb()
      ipcRenderer.on(CH.windowShowCloseDialog, listener)
      return () => ipcRenderer.removeListener(CH.windowShowCloseDialog, listener)
    }
  },
  theme: {
    presets: () => invoke(CH.themePresets),    state: () => invoke(CH.themeState),
    setActive: (id: string) => invoke(CH.themeSetActive, id),
    patchCustom: (patch: unknown) => invoke(CH.themePatchCustom, patch),
    setCustom: (next: unknown) => invoke(CH.themeSetCustom, next),
    saveCustom: (input: { name: string; desc: string }) => invoke(CH.themeSaveCustom, input),
    deleteSaved: (id: string) => invoke(CH.themeDeleteSaved, id),
    forkPreset: (id: string) => invoke(CH.themeForkPreset, id),
    resetCustom: () => invoke(CH.themeResetCustom)
  },
  system: {
    hardware: () => invoke(CH.hardwareStatus),
    launchApp: (input: { appName: string; exePath?: string }) => invoke(CH.launchApp, input),
    installedApps: () => invoke(CH.installedApps),
    closeApp: (appName: string) => invoke(CH.appClose, appName),
    runningApps: () => invoke(CH.appRunningList),
    /**
     */
    appRunningList: async () => {
      const res = (await invoke(CH.appRunningList)) as {
        ok: boolean
        data?: Array<{ key: string; appName: string; pids: number[] }>
        error?: string
      }
      if (!res || !res.ok || !res.data) return { ok: false, error: res?.error ?? '读取失败' }
      return {
        ok: true,
        data: res.data.map((a) => ({
          name: a.key,
          display: a.appName,
          running: true,
          pids: a.pids
        }))
      }
    },
    openExternal: (url: string) => invoke(CH.openExternal, url),
    pickImage: () => invoke(CH.pickImage),
    pickMedia: () => invoke(CH.pickMedia),
    pickAudio: () => invoke(CH.pickAudio),
    exportData: (json: string) => invoke(CH.exportData, json),
    importData: () => invoke(CH.importData)
  }
}

contextBridge.exposeInMainWorld('aimis', api)

export type AimisApi = typeof api
