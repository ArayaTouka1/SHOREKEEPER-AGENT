import { requestOperationApproval, pendingOperationApprovals, decideOperationApproval } from './operationApproval'
import { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } from 'electron'
import { join, extname } from 'node:path'
import { splashMediaStatus, pickSplashMedia, resetSplashMedia } from './splashMedia'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { recordInteraction, relationshipSnapshot, resetRelationship } from './characterRuntime'
import { findOpusByLine, opusToFileUrl, hasOpus, opusDir } from './opus'
import { CH } from '../shared/channels'
import type {
  AppBootstrap,
  AppSettings,
  Attachment,
  ChatSendChunk,
  Character,
  MemoryItem,
  ModelInfo,
  Persona,
  ThemeTokens,
  BackgroundConfig,
  CloudTtsConfig,
  LocalBackend,
  TtsProvider,
  ToolCallRecord
} from '../shared/types'
import { handle, registerSystemIpc } from './ipc'
import { characterRepo, makeAvatars } from './character'
import { chatRepo } from './chat'
import { memoryRepo, looksMemorable, purgeSeedMemories } from './memory'
import { settingsRepo } from './settings'
import { themeRepo } from './theme'
import { collectHardware } from './hardware'
import { TOOL_SPECS, launchApp, closeApp, listRunningApps } from './apps'
import { detectIntent, makeToolCall, runTool, offlineNarrate, toolSpec } from './agent'
import { buildSystemPrompt, streamOpenAICompatible } from './llm'
import { ensureDataDir } from './store'
import { VOICE_PRESETS, listVoiceAssets, resolveVoicePath, importVoiceFile, deleteVoiceFile } from './voice'
import {
  listCloudVoices,
  synthesize as cloudSynthesize,
  testConnection as cloudTest,
  pruneTtsCache,
  builtinModelsOf,
  PROVIDER_DEFAULTS,
  type CloudVoice
} from './cloudTts'
import {
  registerAppFileScheme,
  installAppFileProtocol,
  allowRoot,
  toAppFileUrl
} from './localFile'
import {
  listStickers,
  stickerStats,
  pickSticker,
  addSticker,
  removeSticker,
  searchWebStickers,
  searchAllSources,
  scrapePageImages,
  downloadSticker,
  userStickerDir,
  stickerToDataUrl,
  type Sticker
} from './stickers'
import { decideProactiveSticker, buildImageReaction } from './stickerReaction'
import {
  listBackgrounds,
  importBackground,
  deleteBackground,
  externalBackground
} from './background'
import { modelRepo, probeEndpoint, BUILTIN_API_MODELS } from './models'
import {
  AGENT_TOOLS,
  runAgentTool,
  listJobs,
  jobOutput,
  killJob,
  getWorkspace,
  setWorkspace,
  listDeliverables,
  getTodos,
  previewPermission
} from './agentTools'
import { featureListForUi, resolveFeatureToggles, FEATURE_MANIFEST } from './featureManifest'
import { bootFeatures, createFeatureContext, formatBootReport, type BootReport } from './featureBoot'
import { listAttachments, importAttachment, externalAttachment, deleteAttachment } from './attachments'
import { allowFile, allowFiles } from './localFile'
import { importPersonaFile, readCharacterCard, readInternalPrompt, userPersonaDir } from './persona'
import {
  getMachinePermission,
  setMachinePermission,
  PERMISSION_LABELS,
  PERMISSION_HINTS
} from './permission'
import {
  listPlugins,
  getPlugin,
  setPluginEnabled,
  removePlugin,
  importPluginFolder,
  invokePluginCommand,
  revealPluginFolder,
  userPluginDir
} from './plugins'
import { pickWorldBook, renderWorldBook } from './characterCard'
import { buildPersonaCard, classifyIntent, personaReply, violatesPersona } from './personaCard'
import { TRAY_ICON_DATA_URL } from './trayIcon'
import { installApprovalPrompt, securityState, setWorkspaceTrust, putCommandRule, removeCommandRule, clearApprovals } from './workspaceSecurity'
import { openDocument } from './documents'
import { detectFileIntent } from './fileIntent'
import { modelRoute } from './modelRouting'

const isDev = !!process.env['ELECTRON_RENDERER_URL']
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
/**
 */
let isQuitting = false

/**
 */
let lastBootReport: BootReport | null = null

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    title: '守岸人陪伴终端',
    backgroundColor: '#FDF7FB',
    autoHideMenuBar: true,
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), '../icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  //
  mainWindow.on('close', (e) => {
    if (isQuitting) return

    const g = settingsRepo.get().general

    if (g.closeAction === 'quit') {
      isQuitting = true
      return
    }

    e.preventDefault()

    if (g.closeAction === 'minimize') {
      hideToTray()
      return
    }

    mainWindow?.webContents.send(CH.windowShowCloseDialog)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] as string)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 */
function hideToTray(): void {
  if (!tray) createTray()
  mainWindow?.hide()
}

/**
 */
function quitApp(): void {
  isQuitting = true
  try {
    tray?.destroy()
  } catch {
  }
  tray = null
  app.quit()
}

function createTray(): void {
  if (tray) return
  try {
    const icon = nativeImage.createFromPath(app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), '../icon.png'))
    if (icon.isEmpty()) {
      console.error('[tray] 图标解码为空，托盘可能不可见')
    }
    tray = new Tray(icon)
    tray.setToolTip('守岸人陪伴终端')
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu() as any))
    tray.on('click', () => {
      if (!mainWindow) return
      if (mainWindow.isVisible() && !mainWindow.isMinimized()) mainWindow.hide()
      else {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    })
    tray.on('double-click', () => {
      mainWindow?.show()
      mainWindow?.focus()
    })
  } catch (err) {
    console.error('[tray] 创建失败', err)
  }
}

function buildTrayMenu(): Array<{ label?: string; type?: string; click?: () => void; enabled?: boolean }> {
  const active = modelRepo.active()
  const char = characterRepo.active()
  const jobs = listJobs().filter((j) => j.status === 'running')

  return [
    { label: `当前角色：${char.name}`, enabled: false },
    { label: `当前模型：${active.name}`, enabled: false },
    { label: `后台任务：${jobs.length} 个运行中`, enabled: false },
    { type: 'separator' },
    { label: '显示主窗口', click: () => mainWindow?.show() },
    { label: '隐藏到托盘', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: '首页', click: () => navigateTo('home') },
    { label: '对话', click: () => navigateTo('chat') },
    { label: '记忆', click: () => navigateTo('memory') },
    { label: '智能体', click: () => navigateTo('agent') },
    { label: '设置', click: () => navigateTo('settings') },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]
}

function navigateTo(route: string): void {
  mainWindow?.show()
  mainWindow?.focus()
  mainWindow?.webContents.send('tray:navigate', route)
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

interface SkillRecord {
  name: string
  description: string
  path: string
  content: string
  builtin: boolean
}

function listSkills(): SkillRecord[] {
  const out: SkillRecord[] = []
  const dirs = [join(app.getPath('userData'), 'skills'), join(process.resourcesPath ?? '', 'skills')]

  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      const full = join(dir, name)
      let mdPath = ''
      if (existsSync(join(full, 'SKILL.md'))) mdPath = join(full, 'SKILL.md')
      else if (name.endsWith('.md')) mdPath = full
      if (!mdPath || !existsSync(mdPath)) continue
      try {
        const content = readFileSync(mdPath, 'utf-8')
        const fm = content.match(/^---\s*\n([\s\S]*?)\n---/)
        let desc = ''
        let skillName = name.replace(/\.md$/, '')
        if (fm) {
          const d = fm[1].match(/description:\s*(.+)/)
          const n = fm[1].match(/name:\s*(.+)/)
          if (d) desc = d[1].trim()
          if (n) skillName = n[1].trim()
        }
        if (!desc) {
          const firstText = content.replace(/^---[\s\S]*?---/, '').trim().split('\n').find((l) => l.trim() && !l.startsWith('#'))
          desc = (firstText ?? '').trim().slice(0, 120)
        }
        out.push({ name: skillName, description: desc, path: mdPath, content, builtin: dir.includes('resources') })
      } catch {
      }
    }
  }
  return out
}

function loadSkill(name: string): SkillRecord | null {
  const all = listSkills()
  return all.find((s) => s.name === name) ?? null
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

interface PendingApproval {
  toolCall: ToolCallRecord
  conversationId: string
  userText: string
  resolve: (approved: boolean) => void
}

const pendingApprovals = new Map<string, PendingApproval>()
const aborters = new Map<string, AbortController>()

function send(chunk: ChatSendChunk): void {
  mainWindow?.webContents.send(CH.chatStream, chunk)
}

function bootstrap(): AppBootstrap {
  const character = characterRepo.active()
  return {
    character,
    characters: characterRepo.list(),
    persona: characterRepo.personaOf(character),
    personas: characterRepo.personas(),
    conversations: chatRepo.conversations(character.id),
    settings: settingsRepo.get(),
    theme: themeRepo.state(),
    themePresets: themeRepo.presets(),
    backgrounds: listBackgrounds(),
    tools: TOOL_SPECS,
    memories: memoryRepo.list(character.id),
    hardware: null as never,
    voicePresets: VOICE_PRESETS,
    voiceAssets: listVoiceAssets(),
    inworldVoices: cachedCloudVoices,
    ttsEnv: await0Env(),
    models: modelRepo.list(),
    activeModelId: modelRepo.state().activeId,
    agentTools: AGENT_TOOLS,
    attachments: listAttachments(),
    version: app.getVersion(),
    splashVideo: resolveSplashVideo()
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

let cachedCloudVoices: CloudVoice[] = []
let cachedEnv: AppBootstrap['ttsEnv'] | null = null

function await0Env(): AppBootstrap['ttsEnv'] {
  return (
    cachedEnv ?? {
      venvReady: false,
      depsReady: false,
      pythonPath: '',
      packages: {},
      pythons: [],
      root: '',
      modelDir: '',
      models: []
    }
  )
}

async function refreshCaches(): Promise<void> {
  try {
    const cfg = settingsRepo.get().cloudTts
    if ((cfg.apiKey ?? '').trim() || cfg.provider !== 'inworld') {
      cachedCloudVoices = await listCloudVoices(cfg)
    }
  } catch (err) {
    console.error('[tts] 拉取音色失败（忽略）', err)
  }
}

function worldBookFor(character: Character, userText: string): string {
  try {
    const card = readCharacterCard(character.id)
    if (!card || !card.worldBook.length) return ''
    const picked = pickWorldBook(card.worldBook, userText)
    return renderWorldBook(picked)
  } catch {
    return ''
  }
}

function withStickerDataUrl(s: Sticker): Sticker & { dataUrl: string; fileUrl: string } {
  return { ...s, dataUrl: stickerToDataUrl(s), fileUrl: toAppFileUrl(s.path) }
}

function internalPromptFor(character: Character): string {
  try {
    return readInternalPrompt(character.id)
  } catch {
    return ''
  }
}

/**
 *
 */
function ensureMemoryCleanup(): void {
  try {
    purgeSeedMemories()
  } catch (err) {
    console.error('[memory] 启动清理失败（忽略）', err)
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

interface AgentIntent {
  tool: string
  params: Record<string, unknown>
}

function detectAgentIntent(text: string, settings: AppSettings): AgentIntent | null {
  const fileIntent = detectFileIntent(text)
  if (fileIntent) return fileIntent
  const t = text.trim()
  const has = (...k: string[]): boolean => k.some((x) => t.includes(x))

  if (settings.agent.allowWeb && has('搜索', '搜一下', '查一下网上', '百度', 'google', '联网查') && !has('文件', '目录')) {
    const m = t.match(/(?:搜索|搜一下|查一下|联网查)\s*[：:]?\s*(.+)$/)
    if (m && m[1].trim().length >= 2) return { tool: 'web_search', params: { query: m[1].trim() } }
  }

  const urlMatch = t.match(/https?:\/\/[^\s，。]+/)
  if (settings.agent.allowWeb && urlMatch && has('抓', '打开看', '读一下', '看看这个', '获取')) {
    return { tool: 'web_fetch', params: { url: urlMatch[0] } }
  }


  if (settings.agent.allowShell && has('执行命令', '运行命令', '跑个命令', 'powershell', '命令行里')) {
    const m = t.match(/(?:执行命令|运行命令|跑个命令)\s*[：:]?\s*(.+)$/)
    if (m) return { tool: 'shell_run', params: { command: m[1].trim() } }
  }

  if (settings.agent.allowShell && has('后台跑', '后台执行', '挂后台')) {
    const m = t.match(/(?:后台跑|后台执行|挂后台)\s*[：:]?\s*(.+)$/)
    if (m) return { tool: 'shell_job', params: { command: m[1].trim() } }
  }

  if (has('后台任务', '任务列表') && has('看', '列', '有哪些')) {
    return { tool: 'job_list', params: {} }
  }

  if (has('待办', 'todo', '任务清单')) {
    return { tool: 'goal_get', params: {} }
  }

  return null
}

async function runAgentIntent(args: {
  conversationId: string
  userText: string
  character: Character
  persona: Persona
  settings: AppSettings
  model: ModelInfo
  attachments: Attachment[]
  intent: AgentIntent
}): Promise<boolean> {
  const { conversationId, userText, character, persona, settings, model, attachments, intent } = args

  const spec = AGENT_TOOLS.find((x) => x.name === intent.tool)
  if (!spec) return false

  if (spec.permission === 'deny') return false

  const decision = previewPermission(spec.name, intent.params)
  if (!decision.allowed) {
    const blocked: ToolCallRecord = {
      id: 'tool_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: spec.name,
      displayName: spec.displayName,
      actionLabel: spec.displayName,
      description: spec.description,
      params: intent.params,
      state: 'denied',
      result: null,
      summary: decision.reason,
      error: decision.reason,
      createdAt: Date.now(),
      finishedAt: Date.now()
    }
    const blockedMsg = chatRepo.append({ conversationId, role: 'tool', text: blocked.actionLabel, toolCall: blocked })
    send({ type: 'tool', toolCall: blocked, messageId: blockedMsg.id })
    const text = `${decision.reason}`
    const m = chatRepo.append({ conversationId, role: 'character', text })
    send({ type: 'done', text, messageId: m.id })
    return true
  }

  // All Agent entry points use the same main-process approval broker.
  const needsApproval = false

  const toolCall: ToolCallRecord = {
    id: 'tool_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: spec.name,
    displayName: spec.displayName,
    actionLabel: spec.displayName,
    description: spec.description,
    params: intent.params,
    state: needsApproval ? 'waiting' : 'running',
    result: null,
    summary: '',
    createdAt: Date.now(),
    finishedAt: null
  }

  const toolMsg = chatRepo.append({ conversationId, role: 'tool', text: toolCall.actionLabel, toolCall })
  send({ type: 'tool', toolCall, messageId: toolMsg.id })

  let approved = !needsApproval
  if (needsApproval) {
    approved = await new Promise<boolean>((resolve) => {
      pendingApprovals.set(toolCall.id, { toolCall, conversationId, userText, resolve })
      setTimeout(() => {
        if (pendingApprovals.has(toolCall.id)) {
          pendingApprovals.delete(toolCall.id)
          resolve(false)
        }
      }, 60_000)
    })
  }

  if (!approved) {
    const denied: ToolCallRecord = { ...toolCall, state: 'denied', summary: '用户拒绝了这次操作', finishedAt: Date.now() }
    chatRepo.updateMessage(toolMsg.id, { toolCall: denied })
    send({ type: 'tool', toolCall: denied, messageId: toolMsg.id })
    const card = buildPersonaCard(character, persona)
    const text = pickPersonaLine(card, `好，那这次就不做了。需要的时候再叫我。`)
    const msg = chatRepo.append({ conversationId, role: 'character', text })
    send({ type: 'done', text, messageId: msg.id })
    return true
  }

  const running: ToolCallRecord = { ...toolCall, state: 'running' }
  chatRepo.updateMessage(toolMsg.id, { toolCall: running })
  send({ type: 'tool', toolCall: running, messageId: toolMsg.id })

  try {
    const output = await runAgentTool(spec.name, intent.params)
    const done: ToolCallRecord = {
      ...running,
      state: 'done',
      result: output.result,
      summary: output.summary,
      finishedAt: Date.now()
    }
    chatRepo.updateMessage(toolMsg.id, { toolCall: done })
    send({ type: 'tool', toolCall: done, messageId: toolMsg.id })

    const text = await narrateAgentResult({
      character,
      persona,
      settings,
      model,
      userText,
      attachments,
      context: output.context,
      fallback: output.context || output.summary,
      conversationId
    })
    const msg = chatRepo.append({ conversationId, role: 'character', text })
    send({ type: 'done', text, messageId: msg.id })
    return true
  } catch (err) {
    const failed: ToolCallRecord = {
      ...running,
      state: 'failed',
      error: err instanceof Error ? err.message : String(err),
      summary: '执行失败',
      finishedAt: Date.now()
    }
    chatRepo.updateMessage(toolMsg.id, { toolCall: failed })
    send({ type: 'tool', toolCall: failed, messageId: toolMsg.id })
    const card = buildPersonaCard(character, persona)
    const text = `${card.incapable[0]} 报错是：${failed.error}`
    const msg = chatRepo.append({ conversationId, role: 'character', text })
    send({ type: 'done', text, messageId: msg.id })
    return true
  }
}

async function narrateAgentResult(args: {
  character: Character
  persona: Persona
  settings: AppSettings
  model: ModelInfo
  userText: string
  attachments: Attachment[]
  context: string
  fallback: string
  conversationId?: string
}): Promise<string> {
  const { character, persona, settings, model, userText, attachments, context, fallback, conversationId } = args
  const useRemote = isModelUsable(model, settings)
  if (!useRemote) return fallback

  const memories = memoryRepo.search(userText, character.id, settings.chat.memoryTopK, conversationId)
  const system = await buildSystemPrompt({
    character,
    persona,
    memories,
    settings,
    toolContext: context,
    model,
    attachments,
    toolsEnabled: settings.agent.enabled,
    workspace: getWorkspace(),
    worldBook: worldBookFor(character, userText),
    internalPrompt: internalPromptFor(character)
  })

  let full = ''
  let errored = false
  await streamOpenAICompatible({
    settings,
    system,
    history: [],
    userText: userText || '（工具执行完了）',
    signal: new AbortController().signal,
    override: modelOverride(model, settings),
    cb: {
      onDelta: (d) => {
        full += d
        send({ type: 'delta', text: d })
      },
      onDone: () => {},
      onError: () => {
        errored = true
      }
    }
  })
  if (errored || !full) return fallback
  return full
}

function isModelUsable(model: ModelInfo, settings: AppSettings): boolean {
  try { modelRoute(model, settings); return true } catch { return false }
}

function modelOverride(model: ModelInfo, settings: AppSettings): { baseUrl: string; model: string; apiKey?: string } {
  return modelRoute(model, settings)
}

function pickPersonaLine(card: ReturnType<typeof buildPersonaCard>, base: string): string {
  if (card.selfTone === 'lively') return base.replace('好，那这次就不做了', '诶，那这次就不做了')
  return base
}

async function handleUserTurn(
  conversationId: string,
  userText: string,
  character: Character,
  attachmentIds: string[] = [],
  userImage?: { path: string; sticker?: boolean; mood?: string; source?: string; name?: string; alt?: string },
  opening = false
): Promise<void> {
  const settings = settingsRepo.get()
  const persona = characterRepo.personaOf(character)
  const card = buildPersonaCard(character, persona)
  const model = modelRepo.active()

  const attachments = attachmentIds.length
    ? listAttachments().filter((a) => attachmentIds.includes(a.id))
    : chatRepo.messages(conversationId).filter(m => m.role === 'user' && m.attachments?.length).slice(-1).flatMap(m => m.attachments ?? []).map(a => listAttachments().find(item => item.path === a.path)).filter((a): a is Attachment => !!a).slice(0, 6)

  if (looksMemorable(userText)) {
    const dup = memoryRepo.list(character.id, conversationId).some((m) => m.text === userText.trim())
    if (!dup) {
      memoryRepo.add({
        characterId: character.id,
        conversationId,
        kind: 'event',
        weight: 0.72,
        text: userText.trim()
      })
      send({ type: 'tool' })
    }
  }

  if (settings.agent.enabled) {
    const agentIntent = isModelUsable(model, settings) ? null : detectAgentIntent(userText, settings)
    if (agentIntent) {
      const handled = await runAgentIntent({
        conversationId,
        userText,
        character,
        persona,
        settings,
        model,
        attachments,
        intent: agentIntent
      })
      if (handled) return
    }
  }

  const detected = attachments.length ? null : detectIntent(userText)
  const intent = detected && isModelUsable(model, settings) && ['search_files', 'open_path'].includes(detected.tool) ? null : detected
  if (settings.coop.enabled && intent) {
    const localDecision = previewPermission(intent.tool, intent.params)
    if (!localDecision.allowed) {
      const blocked: ToolCallRecord = {
        ...makeToolCall(intent, false),
        state: 'denied',
        summary: localDecision.reason,
        error: localDecision.reason,
        finishedAt: Date.now()
      }
      const blockedMsg = chatRepo.append({
        conversationId,
        role: 'tool',
        text: blocked.actionLabel,
        toolCall: blocked
      })
      send({ type: 'tool', toolCall: blocked, messageId: blockedMsg.id })
      const text = localDecision.reason
      const m = chatRepo.append({ conversationId, role: 'character', text })
      send({ type: 'done', text, messageId: m.id })
      return
    }

    const needsApproval = false
    const toolCall = makeToolCall(intent, needsApproval)

    const toolMsg = chatRepo.append({
      conversationId,
      role: 'tool',
      text: toolCall.actionLabel,
      toolCall
    })
    send({ type: 'tool', toolCall, messageId: toolMsg.id })

    let approved = !needsApproval
    if (needsApproval) {
      approved = await new Promise<boolean>((resolve) => {
        pendingApprovals.set(toolCall.id, { toolCall, conversationId, userText, resolve })
        setTimeout(() => {
          if (pendingApprovals.has(toolCall.id)) {
            pendingApprovals.delete(toolCall.id)
            resolve(false)
          }
        }, 60_000)
      })
    }

    if (!approved) {
      const denied: ToolCallRecord = {
        ...toolCall,
        state: 'denied',
        summary: '用户拒绝了这次操作',
        finishedAt: Date.now()
      }
      chatRepo.updateMessage(toolMsg.id, { toolCall: denied })
      send({ type: 'tool', toolCall: denied, messageId: toolMsg.id })
      const text = `好，那这次就不动了。需要的时候再叫我。`
      const msg = chatRepo.append({ conversationId, role: 'character', text })
      send({ type: 'done', text, messageId: msg.id })
      return
    }

    const running: ToolCallRecord = { ...toolCall, state: 'running' }
    chatRepo.updateMessage(toolMsg.id, { toolCall: running })
    send({ type: 'tool', toolCall: running, messageId: toolMsg.id })

    try {
      const output = await runTool(intent.tool, intent.params)
      const done: ToolCallRecord = {
        ...running,
        state: 'done',
        result: output.result,
        summary: output.summary,
        finishedAt: Date.now()
      }
      chatRepo.updateMessage(toolMsg.id, { toolCall: done })
      send({ type: 'tool', toolCall: done, messageId: toolMsg.id })

      const text = await narrateResult({
        character,
        persona,
        settings,
        userText,
        context: output.context,
        fallback: () => offlineNarrate(intent.tool, intent.params, output.result),
        conversationId
      })
      const msg = chatRepo.append({ conversationId, role: 'character', text })
      send({ type: 'done', text, messageId: msg.id })
    } catch (err) {
      const failed: ToolCallRecord = {
        ...running,
        state: 'failed',
        error: err instanceof Error ? err.message : String(err),
        summary: '执行失败',
        finishedAt: Date.now()
      }
      chatRepo.updateMessage(toolMsg.id, { toolCall: failed })
      send({ type: 'tool', toolCall: failed, messageId: toolMsg.id })
      const text = `这一步我没做成，报错是：${failed.error}`
      const msg = chatRepo.append({ conversationId, role: 'character', text })
      send({ type: 'done', text, messageId: msg.id })
    }
    return
  }

  if (userImage) {
    const recent = chatRepo.recentStickerIds(conversationId, 8)
    const reaction = buildImageReaction({
      character,
      count: 1,
      isSticker: !!userImage.sticker,
      text: /^\[表情包:/.test(userText) ? '' : userText,
      recentStickerIds: recent
    })

    const images: Array<Record<string, unknown>> = []
    if (reaction.sticker) {
      images.push({
        path: reaction.sticker.path,
        sticker: true,
        mood: reaction.sticker.mood,
        source: 'local',
        name: reaction.sticker.file,
        alt: reaction.sticker.tags.join(' ')
      })
    }

    await emitTypewriter(reaction.text)
    const msg = chatRepo.append({
      conversationId,
      role: 'character',
      text: reaction.text,
      images: images.length ? (images as never) : undefined
    })
    send({
      type: 'done',
      text: reaction.text,
      messageId: msg.id,
      sticker: reaction.sticker ? withStickerDataUrl(reaction.sticker) : undefined
    } as never)
    return
  }

  const history = chatRepo.recent(conversationId, 20)
  const memories = memoryRepo.search(userText, character.id, settings.chat.memoryTopK, conversationId)
  const system = await buildSystemPrompt({
    character,
    persona,
    memories,
    settings,
    opening,
    model,
    attachments,
    toolsEnabled: settings.agent.enabled,
    workspace: getWorkspace(),
    worldBook: worldBookFor(character, userText),
    internalPrompt: internalPromptFor(character)
  })

  const useRemote = isModelUsable(model, settings)

  const maybeSticker = (replyText: string): { path: string; mood: string; name: string } | null => {
    try {
      const conv = chatRepo.conversations(character.id).find((c) => c.id === conversationId)
      const decision = decideProactiveSticker({
        character,
        card,
        userText,
        replyText,
        messageCount: conv?.messageCount ?? 0,
        recentStickerIds: chatRepo.recentStickerIds(conversationId, 8),
        requested: /(表情包|发个图|发张图|来张图)/.test(userText)
      })
      if (!decision.send || !decision.sticker) return null
      return { path: decision.sticker.path, mood: decision.sticker.mood, name: decision.sticker.file }
    } catch {
      return null
    }
  }

  const attachSticker = (messageId: string, st: { path: string; mood: string; name: string }): unknown => {
    chatRepo.updateMessage(messageId, {
      images: [
        {
          path: st.path,
          sticker: true,
          mood: st.mood,
          source: 'local',
          name: st.name,
          alt: st.mood
        }
      ]
    })
    return st
  }

  if (!useRemote) {
    let text = '模型尚未连接。'
    if (/^(你好|在吗|嗨|早上好|上午好|中午好|下午好|晚上好|早安|晚安|hello|hi)[！!。？?\s]*$/i.test(userText.trim())) text = relationshipSnapshot(character).greeting
    else try { modelRoute(model, settings) } catch (error) { text = error instanceof Error ? error.message : String(error) }
    await emitTypewriter(text)
    const msg = chatRepo.append({ conversationId, role: 'character', text })
    const st = maybeSticker(text)
    const payload = st ? attachSticker(msg.id, st) : undefined
    send({ type: 'done', text, messageId: msg.id, sticker: payload } as never)
    return
  }

  const controller = new AbortController()
  aborters.set(conversationId, controller)

  let full = ''
  await streamOpenAICompatible({
    settings,
    system,
    history,
    userText,
    signal: controller.signal,
    override: modelOverride(model, settings),
    tools: settings.agent.enabled ? AGENT_TOOLS.filter(t => t.category === 'fs' || (t.category === 'shell' && settings.agent.allowShell) || (t.category === 'web' && settings.agent.allowWeb)) : undefined,
    executeTool: async (name, params) => {
      controller.signal.throwIfAborted()
      const spec = AGENT_TOOLS.find(t => t.name === name)!
      const toolCall: ToolCallRecord = {
        id: 'tool_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        name, displayName: spec.displayName, actionLabel: spec.displayName, description: spec.description,
        params, state: 'running', result: null, summary: '', createdAt: Date.now(), finishedAt: null
      }
      const message = chatRepo.append({ conversationId, role: 'tool', text: spec.displayName, toolCall })
      send({ type: 'tool', toolCall, messageId: message.id })
      try {
        const output = await runAgentTool(name, params, controller.signal)
        const done: ToolCallRecord = { ...toolCall, state: 'done', result: output.result, summary: output.summary, finishedAt: Date.now() }
        chatRepo.updateMessage(message.id, { toolCall: done })
        send({ type: 'tool', toolCall: done, messageId: message.id })
        return output.context
      } catch (error) {
        const failed: ToolCallRecord = { ...toolCall, state: 'failed', error: error instanceof Error ? error.message : String(error), finishedAt: Date.now() }
        chatRepo.updateMessage(message.id, { toolCall: failed })
        send({ type: 'tool', toolCall: failed, messageId: message.id })
        throw error
      }
    },
    cb: {
      onDelta: (delta) => {
        full += delta
        send({ type: 'delta', text: delta })
      },
      onDone: (text) => {
        aborters.delete(conversationId)
        const finalText = text || full
        if (!finalText) {
          send({ type: 'error', error: '模型没有返回内容' })
          return
        }
        const msg = chatRepo.append({ conversationId, role: 'character', text: finalText })
        const st = maybeSticker(finalText)
        const payload = st ? attachSticker(msg.id, st) : undefined
        send({ type: 'done', text: finalText, messageId: msg.id, sticker: payload } as never)
      },
      onError: (error) => {
        aborters.delete(conversationId)
        send({ type: 'error', error })
        const fallback = `本轮未完成：${error}`
        const msg = chatRepo.append({ conversationId, role: 'character', text: fallback })
        send({ type: 'done', text: fallback, messageId: msg.id })
      }
    }
  })
}

/**
 */
function personaChatReply(args: {
  character: Character
  persona: Persona
  userText: string
  memories: MemoryItem[]
}): string {
  const { character, persona, userText, memories } = args
  const card = buildPersonaCard(character, persona)
  const intent = classifyIntent(userText)

  const text = personaReply({ card, intent, userText, memories })

  const bad = violatesPersona(text, card)
  if (bad) {
    return card.selfTone === 'lively' ? '嗯……我想想怎么说。你先说说看？' : '嗯。你说。'
  }
  return text
}

async function emitTypewriter(text: string): Promise<void> {
  const settings = settingsRepo.get()
  const speed = settings.chat.typeSpeedMs
  if (!settings.chat.stream || speed <= 0) {
    send({ type: 'delta', text })
    return
  }
  const chunks = text.match(/[^，。！？!?,\n]+[，。！？!?,\n]?/g) ?? [text]
  for (const c of chunks) {
    send({ type: 'delta', text: c })
    await new Promise((r) => setTimeout(r, Math.min(420, speed * c.length)))
  }
}

async function narrateResult(args: {
  character: Character
  persona: Persona
  settings: AppSettings
  userText: string
  context: string
  fallback: () => string
  conversationId?: string
}): Promise<string> {
  const { character, persona, settings, userText, context, fallback, conversationId } = args
  const selected = modelRepo.active()
  const useRemote = isModelUsable(selected, settings)
  if (!useRemote) {
    const text = fallback()
    await emitTypewriter(text)
    return text
  }
  const memories = memoryRepo.search(userText, character.id, settings.chat.memoryTopK, conversationId)
  const system = await buildSystemPrompt({ character, persona, memories, settings, toolContext: context })
  let full = ''
  let errored = false
  await streamOpenAICompatible({
    settings,
    system,
    history: [],
    userText,
    override: modelOverride(selected, settings),
    signal: new AbortController().signal,
    cb: {
      onDelta: (d) => {
        full += d
        send({ type: 'delta', text: d })
      },
      onDone: () => {},
      onError: () => {
        errored = true
      }
    }
  })
  if (errored || !full) {
    const text = fallback()
    await emitTypewriter(text)
    return text
  }
  return full
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/**
 *
 *
 */
async function bootCapabilities(): Promise<void> {
  const toggles = resolveFeatureToggles(settingsRepo.get().agent.features)
  const features = FEATURE_MANIFEST.map((f) => ({ ...f, register: () => {} }))

  const ctx = createFeatureContext({
    ipcMain,
    getWindow: () => mainWindow,
    getSetting: <T,>(path: string): T | undefined => {
      const [group, key] = path.split('.')
      const s = settingsRepo.get() as unknown as Record<string, Record<string, unknown>>
      return (key ? s[group]?.[key] : s[group]) as T | undefined
    }
  })

  lastBootReport = await bootFeatures(features, ctx, toggles)
  for (const line of formatBootReport(lastBootReport)) console.log(line)
}

function featureOn(id: string): boolean {
  const saved = settingsRepo.get().agent.features
  const def = FEATURE_MANIFEST.find((f) => f.id === id)
  return saved?.[id] ?? def?.defaultEnabled !== false
}

const greetedCharacters = new Set<string>()

/** Resolve the selected video without copying its bytes into every bootstrap response. */
function resolveSplashVideo(): string {
  return splashMediaStatus().url
}

function registerIpc(): void {
  handle('splash:status', () => splashMediaStatus())
  handle('splash:pick', () => pickSplashMedia())
  handle('splash:reset', () => resetSplashMedia())
  handle('app:configuration', () => {
    const character = characterRepo.active()
    const splashVideo = resolveSplashVideo()
    return { settings: settingsRepo.get(), character, characters: characterRepo.list(), persona: characterRepo.personaOf(character), personas: characterRepo.personas(), models: modelRepo.list(), activeModelId: modelRepo.active().id, workspace: getWorkspace(), splashVideo }
  })
  handle('chat:greet', () => {
    const character = characterRepo.active()
    const conversation = chatRepo.ensureConversation(character.id)
    let didGreet = false
    if (!greetedCharacters.has(character.id)) {
      greetedCharacters.add(character.id)
      const snap = relationshipSnapshot(character)
      chatRepo.append({ conversationId: conversation.id, role: 'character', text: snap.greeting, proactive: true })
      didGreet = true
    }
    let openingOpus: string | null = null
    if (didGreet) {
      try {
        const raw = relationshipSnapshot(character).greetingRaw
        const picked = findOpusByLine(character.id, raw)
        if (picked) openingOpus = opusToFileUrl(picked.path)
        else console.warn('[greet] Opus 未匹配到台词：', JSON.stringify(raw), '| dir=', opusDir(character.id))
      } catch (err) {
        console.warn('[greet] Opus 匹配失败：', err)
      }
    }
    return { conversation, messages: chatRepo.messages(conversation.id), conversations: chatRepo.conversations(character.id), characterId: character.id, openingOpus, didGreet }
  })
  registerSystemIpc()
  installApprovalPrompt(requestOperationApproval)
  handle('approval:pending', () => pendingOperationApprovals())
  handle('approval:decide', (id: string, approved: boolean) => decideOperationApproval(id, approved))
  handle(CH.workspaceSecurity, () => securityState(getWorkspace()))
  handle(CH.workspaceTrust, (trusted: boolean) => {
    if (typeof trusted !== 'boolean') throw new Error('无效信任状态')
    return setWorkspaceTrust(getWorkspace(), trusted)
  })
  handle(CH.commandRuleSave, (input: { command: string; effect: 'allow' | 'deny' }) => putCommandRule(getWorkspace(), input.command, input.effect))
  handle(CH.commandRuleRemove, (id: string) => removeCommandRule(getWorkspace(), id))
  handle(CH.approvalsClear, () => { clearApprovals(); return securityState(getWorkspace()) })
  handle(CH.documentOpen, (path: string) => openDocument(path))
  handle(CH.documentPick, async () => {
    const result = await dialog.showOpenDialog({ title: '打开文档', properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0]
  })
  handle(CH.fileRoots, () => {
    const roots = ['desktop', 'documents', 'downloads', 'home'].map(key => ({ name: ({ desktop: '桌面', documents: '文档', downloads: '下载', home: '用户目录' } as Record<string, string>)[key], path: app.getPath(key as 'home') }))
    if (process.platform === 'win32') for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const path = `${letter}:\\`
      if (existsSync(path)) roots.push({ name: `${letter}:`, path })
    }
    else roots.push({ name: '/', path: '/' })
    return roots
  })

  handle(CH.bootstrap, async (): Promise<AppBootstrap> => {
    const character = characterRepo.active()
    ensureMemoryCleanup()
    let hw: any = null
    try {
      hw = await collectHardware()
    } catch {
      hw = null
    }
    return { ...bootstrap(), hardware: hw }
  })

  handle(CH.characterList, () => characterRepo.list())
  handle(CH.characterSave, (patch: Partial<Character>) => {
    const saved = characterRepo.saveCharacter(patch)
    if (!patch.id) characterRepo.activate(saved.id)
    return { character: characterRepo.active(), characters: characterRepo.list(), personas: characterRepo.personas() }
  })
  handle(CH.characterDelete, (id: string) => characterRepo.deleteCharacter(id))
  handle(CH.characterActivate, (id: string) => {
    const character = characterRepo.activate(id)
    return {
      character,
      persona: characterRepo.personaOf(character),
      conversations: chatRepo.conversations(character.id),
      memories: memoryRepo.list(character.id)
    }
  })

  handle(CH.relationshipGet, (id?: string) => {
    const character = id ? characterRepo.list().find(c => c.id === id) : characterRepo.active()
    if (!character) throw new Error('角色不存在')
    return relationshipSnapshot(character)
  })
  handle(CH.relationshipReset, (id: string) => {
    const character = characterRepo.list().find(c => c.id === id)
    if (!character) throw new Error('角色不存在')
    resetRelationship(id)
    return relationshipSnapshot(character)
  })
  handle(CH.personaList, () => characterRepo.personas())
  handle(CH.personaSave, (patch: Partial<Persona>) => {
    const saved = characterRepo.savePersona(patch)
    return { persona: saved, personas: characterRepo.personas() }
  })
  handle(CH.personaReset, (id: string) => {
    const reset = characterRepo.resetPersona(id)
    return { persona: reset, personas: characterRepo.personas() }
  })
  handle(CH.personaDelete, (id: string) => {
    characterRepo.deletePersona(id)
    return characterRepo.personas()
  })
  handle(CH.personaOpenDir, async () => {
    const dir = userPersonaDir()
    await shell.openPath(dir)
    return dir
  })

  handle(CH.personaPacks, () => {
    const dir = userPersonaDir()
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => {
          const full = join(dir, e.name)
          let files: string[] = []
          try {
            files = readdirSync(full).filter((f) => /\.(md|txt)$/i.test(f))
          } catch {
            /* ignore */
          }
          return { id: e.name, name: e.name, path: full, fileCount: files.length }
        })
    } catch {
      return []
    }
  })

  handle(CH.personaPickFile, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择人格文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '人格文件', extensions: ['txt', 'md', 'markdown', 'json', 'yaml', 'yml'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (res.canceled || !res.filePaths.length) return null
    return res.filePaths
  })
  handle(CH.personaImport, async (input: { sourcePath: string; name?: string; bindToCharacter?: boolean }) => {
    const imported = importPersonaFile(input.sourcePath, input.name)
    const persona = characterRepo.registerPersonaFile(imported.fileName, imported.name, imported.content)
    if (input.bindToCharacter) characterRepo.bindPersona(persona.id)
    return { persona, personas: characterRepo.personas(), chars: imported.chars }
  })

  handle(CH.conversationList, (characterId?: string) => chatRepo.conversations(characterId))
  handle(CH.conversationCreate, (characterId: string, title?: string) => chatRepo.create(characterId, title))
  handle(CH.conversationDelete, (id: string) => {
    try {
      memoryRepo.clearConversation(id)
    } catch {
    }
    return chatRepo.delete(id)
  })
  handle(CH.messageList, (conversationId: string) => chatRepo.messages(conversationId))
  handle(CH.messageAppend, (input: { conversationId: string; role: any; text: string }) => chatRepo.append(input))

  handle(
    CH.chatSend,
    async (req: {
      conversationId: string
      text: string
      attachmentIds?: string[]
      image?: {
        path: string
        sticker?: boolean
        mood?: string
        source?: 'local' | 'user' | 'web' | 'upload'
        name?: string
        alt?: string
      }
    }) => {
      const character = characterRepo.active()
      const requestedAttachments = req.attachmentIds ?? []
      const selectedAttachments = listAttachments().filter(a => requestedAttachments.includes(a.id))
      if (selectedAttachments.length !== new Set(requestedAttachments).size) throw new Error('部分附件已不存在，请重新选择后发送')
      const userMsg = chatRepo.append({
        conversationId: req.conversationId,
        role: 'user',
        text: req.text,
        images: req.image ? [req.image] : undefined,
        attachments: selectedAttachments.map(a => ({ name: a.name, path: a.path, kind: a.kind, size: a.size, ext: extname(a.name) }))
      })
      const opening = recordInteraction(character.id, userMsg.id, req.text)
      void handleUserTurn(req.conversationId, req.text || '请阅读并概括附件内容。', character, requestedAttachments, req.image, opening).catch(error => {
        const text = `本轮未完成：${error instanceof Error ? error.message : String(error)}`
        const message = chatRepo.append({ conversationId: req.conversationId, role: 'character', text })
        send({ type: 'error', error: text })
        send({ type: 'done', text, messageId: message.id })
      })
      return { messageId: userMsg.id }
    }
  )

  handle(
    CH.stickerProactive,
    (input: { conversationId: string; mood?: string; force?: boolean }) => {
      const character = characterRepo.active()
      const conv = input.conversationId || chatRepo.ensureConversation(character.id).id
      const recent = chatRepo.recentStickerIds(conv, 8)
      const r = pickSticker({ characterId: character.id, mood: input.mood ?? 'chat', recentIds: recent })
      if (!r.sticker) return { sent: false, message: r.reason }
      const msg = chatRepo.append({
        conversationId: conv,
        role: 'character',
        text: '',
        images: [
          {
            path: r.sticker.path,
            sticker: true,
            mood: r.sticker.mood,
            source: 'local',
            name: r.sticker.file,
            alt: r.sticker.tags.join(' ')
          }
        ],
        proactive: true
      })
      return { sent: true, messageId: msg.id, sticker: withStickerDataUrl(r.sticker), reason: r.reason }
    }
  )
  handle(CH.chatAbort, (conversationId: string) => {
    aborters.get(conversationId)?.abort()
    aborters.delete(conversationId)
    return true
  })

  handle(CH.memoryList, (characterId?: string, conversationId?: string) =>
    memoryRepo.list(characterId, conversationId)
  )
  handle(CH.memoryAdd, (input: {
    text: string
    characterId: string
    conversationId?: string
    kind?: any
    weight?: number
  }) => memoryRepo.add(input))
  handle(CH.memoryDelete, (id: string) => memoryRepo.delete(id))
  handle(CH.memorySearch, (q: { query: string; characterId: string; topK?: number; conversationId?: string }) =>
    memoryRepo.search(q.query, q.characterId, q.topK ?? 4, q.conversationId)
  )

  handle(CH.toolList, () => TOOL_SPECS)
  handle(CH.toolRun, async (input: { name: string; params: Record<string, unknown> }) =>
    runTool(input.name, input.params)
  )
  handle(CH.toolApprove, (input: { toolCallId: string; approved: boolean }) => {
    const pending = pendingApprovals.get(input.toolCallId)
    if (!pending) return { handled: false }
    pendingApprovals.delete(input.toolCallId)
    pending.resolve(input.approved)
    return { handled: true }
  })

  handle(CH.settingsGet, () => settingsRepo.get())
  handle(CH.settingsSave, (patch: Partial<AppSettings>) => {
    if (patch.agent?.workspace) setWorkspace(patch.agent.workspace)
    if (patch.agent) clearApprovals()
    return settingsRepo.save(patch)
  })
  handle(CH.settingsReset, () => settingsRepo.reset())

  handle(CH.voicePresets, () => VOICE_PRESETS)
  handle(CH.voiceAssets, () => listVoiceAssets())
  handle(CH.voiceResolve, (input: { voicePackFile: string; customPackPath: string | null }) =>
    resolveVoicePath(input.voicePackFile, input.customPackPath)
  )
  handle(CH.voicePickFile, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择语音文件',
      properties: ['openFile'],
      filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }]
    })
    if (res.canceled || !res.filePaths.length) return null
    return res.filePaths[0]
  })
  handle(CH.voiceImport, async () => {
    const res = await dialog.showOpenDialog({
      title: '导入语音到语音库',
      properties: ['openFile'],
      filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }]
    })
    if (res.canceled || !res.filePaths.length) return null
    const info = importVoiceFile(res.filePaths[0])
    return { ...info, sourcePath: res.filePaths[0], assets: listVoiceAssets() }
  })
  handle(CH.voiceDelete, (fileName: string) => {
    deleteVoiceFile(fileName)
    return listVoiceAssets()
  })

  handle(CH.inworldVoices, async (patch?: Partial<CloudTtsConfig>) => {
    const cfg = { ...settingsRepo.get().cloudTts, ...(patch ?? {}) }
    cachedCloudVoices = await listCloudVoices(cfg)
    return cachedCloudVoices
  })
  /**
   */
  handle(CH.ttsSwitchProvider, (provider: TtsProvider) => {
    const cur = settingsRepo.get().cloudTts
    const def = PROVIDER_DEFAULTS[provider]
    const next: CloudTtsConfig = {
      ...cur,
      provider,
      baseUrl: def.baseUrl,
      model: def.model,
      authMode: def.authMode,
      customModels: provider === cur.provider ? cur.customModels : [],
      verified: false
    }
    settingsRepo.save({ cloudTts: next })
    return next
  })
  handle(CH.inworldTest, async (patch?: Partial<CloudTtsConfig>) => {
    const cur = settingsRepo.get().cloudTts
    const cfg = { ...cur, ...(patch ?? {}) }
    const r = await cloudTest(cfg)
    settingsRepo.save({ cloudTts: { ...cfg, verified: r.ok } })
    if (r.ok) {
      try {
        cachedCloudVoices = await listCloudVoices(cfg)
      } catch {
      }
    }
    return r
  })
  handle(CH.inworldSynthesize, async (input: { text: string; voiceId: string; modelId?: string; rate?: number; pitch?: number }) => {
    const cfg = settingsRepo.get().cloudTts
    const r = await cloudSynthesize({
      config: cfg,
      text: input.text,
      voiceId: input.voiceId,
      modelId: input.modelId ?? cfg.model,
      rate: input.rate,
      pitch: input.pitch
    })
    return { ...r, url: 'file:///' + r.path.replace(/\\/g, '/') }
  })
  handle(CH.inworldClone, async () => {
    throw new Error('当前云合成服务商不支持音色克隆。如需克隆音色，请在 Inworld 控制台完成后再填入音色 ID。')
  })
  handle(CH.ttsProviders, () => ({
    providers: Object.entries(PROVIDER_DEFAULTS).map(([k, v]) => ({ id: k, ...v })),
    builtinModels: builtinModelsOf(settingsRepo.get().cloudTts.provider)
  }))
  handle(CH.ttsModels, (provider?: TtsProvider) => builtinModelsOf(provider ?? settingsRepo.get().cloudTts.provider))


  if (featureOn('stickers')) {
  handle(CH.stickerList, (characterId: string) => listStickers(characterId).map(withStickerDataUrl))
  handle(CH.stickerStats, () => stickerStats())
  handle(CH.stickerPick, (input: { characterId: string; mood?: string; recentIds?: string[] }) =>
    pickSticker({
      characterId: input.characterId,
      mood: input.mood ?? 'chat',
      recentIds: input.recentIds
    })
  )
  handle(CH.stickerAdd, (input: { characterId: string; sourcePath: string; mood?: string; tags?: string[] }) => {
    allowFile(input.sourcePath)
    const s = addSticker(input.characterId, input.sourcePath, input.mood, input.tags)
    allowFile(s.path)
    return withStickerDataUrl(s)
  })
  handle(CH.stickerPickFile, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择表情包图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    })
    if (res.canceled) return []
    return res.filePaths
  })
  handle(CH.stickerRemove, (input: { characterId: string; stickerId: string }) =>
    removeSticker(input.characterId, input.stickerId)
  )
  handle(CH.stickerSearch, async (input: { query: string; limit?: number; first?: number }) => {
    const cfg = settingsRepo.get().sticker
    const sources = (cfg?.sources ?? []).map((s) => ({ searchUrl: s.searchUrl, enabled: s.enabled }))
    const enabled = sources.filter((s) => s.enabled)
    return searchAllSources(input.query, input.limit ?? 60, enabled.length > 0 ? enabled : [])
  })
  handle(CH.stickerScrape, async (input: { url: string; limit?: number }) =>
    scrapePageImages(input.url, input.limit ?? 60)
  )
  handle(CH.stickerDownload, async (input: { characterId: string; url: string; mood?: string; tags?: string[] }) => {
    const s = await downloadSticker(input.characterId, input.url, input.mood, input.tags)
    allowFile(s.path)
    return withStickerDataUrl(s)
  })
  handle(CH.stickerOpenDir, async () => {
    const d = userStickerDir()
    await shell.openPath(d)
    return d
  })
  }

  handle(CH.ttsEnvStatus, () => cachedEnv ?? await0Env())
  handle(CH.ttsEnvSetup, () => ({ result: { ok: false, message: '本地语音生成引擎已移除' }, status: cachedEnv }))
  handle(CH.ttsEnvRemove, () => ({ result: { ok: false, message: '本地语音生成引擎已移除' }, status: cachedEnv }))
  handle(CH.ttsEnvReport, () => '')

  if (featureOn('background')) {
  handle(CH.bgList, () => listBackgrounds())
  handle(CH.bgPickFile, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择背景图片或视频',
      properties: ['openFile'],
      filters: [
        { name: '图片与视频', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp4', 'webm', 'mov', 'mkv', 'm4v'] },
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
        { name: '视频', extensions: ['mp4', 'webm', 'mov', 'mkv', 'm4v'] }
      ]
    })
    if (res.canceled || !res.filePaths.length) return null
    allowFile(res.filePaths[0])
    return res.filePaths[0]
  })
  handle(CH.bgImport, async (mode?: 'copy' | 'external') => {
    const res = await dialog.showOpenDialog({
      title: mode === 'external' ? '选择背景文件（不复制）' : '导入背景到素材库',
      properties: ['openFile'],
      filters: [
        { name: '图片与视频', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp4', 'webm', 'mov', 'mkv', 'm4v'] }
      ]
    })
    if (res.canceled || !res.filePaths.length) return null
    allowFile(res.filePaths[0])
    const media =
      mode === 'external' ? externalBackground(res.filePaths[0]) : importBackground(res.filePaths[0])
    if (!media) throw new Error('不支持的文件格式')
    if (media.path) allowFile(media.path)
    return { media, list: listBackgrounds() }
  })
  handle(CH.bgExternal, (path: string) => {
    allowFile(path)
    const media = externalBackground(path)
    if (media) allowFile(media.path)
    return media
  })
  handle(CH.bgDelete, (id: string) => {
    deleteBackground(id)
    return listBackgrounds()
  })
  /**
   */
  handle(CH.bgPatch, (patch: Partial<BackgroundConfig>) => {
    if (typeof patch?.mediaPath === 'string' && patch.mediaPath) allowFile(patch.mediaPath)
    return themeRepo.patchBackground(patch)
  })
  handle(CH.bgReset, () => themeRepo.resetBackground())
  }

  handle(CH.themePresets, () => themeRepo.presets())
  handle(CH.themeState, () => themeRepo.state())
  handle(CH.themeSetActive, (id: string) => themeRepo.setActive(id))
  handle(CH.themePatchCustom, (patch: Partial<ThemeTokens>) => themeRepo.patchCustom(patch))
  handle(CH.themeSetCustom, (next: ThemeTokens) => themeRepo.setCustomFull(next))
  handle(CH.themeSaveCustom, (input: { name: string; desc: string }) => themeRepo.saveCustom(input.name, input.desc))
  handle(CH.themeDeleteSaved, (id: string) => themeRepo.deleteSaved(id))
  handle(CH.themeForkPreset, (id: string) => themeRepo.forkPreset(id))
  handle(CH.themeResetCustom, () => themeRepo.resetCustom())

  handle(CH.hardwareStatus, () => collectHardware())
  handle(CH.launchApp, (input: { appName: string; exePath?: string }) => launchApp(input.appName, input.exePath))
  handle(CH.appClose, (appName: string) => closeApp(typeof appName === 'string' ? appName : String((appName as any)?.appName ?? '')))
  handle(CH.appRunningList, () => listRunningApps())
  handle(CH.installedApps, () => TOOL_SPECS)

  handle(CH.modelList, () => modelRepo.list())
  handle(CH.modelSelectable, () => modelRepo.selectable())
  handle(CH.modelState, () => modelRepo.state())
  handle(CH.modelSetActive, (id: string) => {
    modelRepo.setActive(id)
    return { state: modelRepo.state(), models: modelRepo.list(), active: modelRepo.active() }
  })
  handle(CH.modelProbe, async (input: { id: string; baseUrl?: string; apiKey?: string }) => {
    const models = modelRepo.list()
    const target = models.find((m) => m.id === input.id)
    const baseUrl = input.baseUrl ?? target?.baseUrl ?? ''
    if (!target) throw new Error('模型不存在')
    const cfg = settingsRepo.get()
    const sameOrigin = new URL(baseUrl).origin === new URL(cfg.llm.baseUrl).origin
    const apiKey = input.apiKey ?? target.apiKey ?? (sameOrigin ? cfg.llm.apiKey : '')
    const r = await probeEndpoint(baseUrl, apiKey || undefined, 8000, target?.model)
    if (target && target.kind === 'local') {
      modelRepo.markConnected(target.id, r.ok)
    }
    return { ...r, models: modelRepo.list() }
  })
  handle(
    CH.modelAdd,
    (input: { name: string; kind: 'api' | 'local'; baseUrl: string; model: string; apiKey?: string; note?: string }) => {
      const m = modelRepo.addModel(input)
      return { model: m, models: modelRepo.list() }
    }
  )
  handle(CH.modelRemove, (id: string) => {
    modelRepo.removeModel(id)
    return { state: modelRepo.state(), models: modelRepo.list() }
  })
  handle(CH.modelUpdate, (input: { id: string; patch: Partial<ModelInfo> }) => {
    modelRepo.updateModel(input.id, input.patch)
    return { state: modelRepo.state(), models: modelRepo.list() }
  })
  handle(CH.modelDisconnect, (id: string) => {
    modelRepo.disconnect(id)
    return { state: modelRepo.state(), models: modelRepo.list(), active: modelRepo.active() }
  })
  handle(CH.modelDisconnectAll, () => {
    modelRepo.disconnectAll()
    return { state: modelRepo.state(), models: modelRepo.list(), active: modelRepo.active() }
  })
  handle(CH.modelMarkConnected, (input: { id: string; ok: boolean }) => {
    modelRepo.markConnected(input.id, input.ok)
    return { state: modelRepo.state(), models: modelRepo.list() }
  })

  if (featureOn('attachment')) {
  handle(CH.attList, () => listAttachments())
  handle(CH.attPick, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择要上传的附件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '常用文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'md', 'json', 'csv', 'pdf', 'log'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (res.canceled || !res.filePaths.length) return null
    const imported = res.filePaths.map((p) => importAttachment(p))
    return { attachments: imported, list: listAttachments() }
  })
  handle(CH.attImport, (sourcePath: string) => {
    const a = importAttachment(sourcePath)
    return { attachment: a, list: listAttachments() }
  })
  handle(CH.attExternal, (sourcePath: string) => externalAttachment(sourcePath))
  handle(CH.attDelete, (id: string) => {
    deleteAttachment(id)
    return listAttachments()
  })
  handle(CH.attOpen, async (path: string) => {
    const err = await shell.openPath(path)
    return { ok: !err, error: err }
  })
  }

  handle(CH.agentTools, () => AGENT_TOOLS)
  handle(CH.agentRun, async (input: { name: string; params: Record<string, unknown> }) =>
    runAgentTool(input.name, input.params)
  )

  handle(CH.featureList, () => {
    const saved = settingsRepo.get().agent.features ?? {}
    return { features: featureListForUi(saved), report: lastBootReport }
  })
  handle(CH.featureToggle, (input: { id: string; enabled: boolean }) => {
    const agent = settingsRepo.get().agent
    const features = { ...(agent.features ?? {}), [input.id]: input.enabled }
    settingsRepo.save({ agent: { ...agent, features } })
    return { features: featureListForUi(features) }
  })
  handle(CH.agentJobs, () => listJobs())
  handle(CH.agentJobOutput, (input: { jobId: string; tail?: number }) => jobOutput(input.jobId, input.tail))
  handle(CH.agentJobKill, (jobId: string) => ({ killed: killJob(jobId), jobs: listJobs() }))
  handle(CH.agentTodos, () => getTodos())
  handle(CH.agentDeliverables, () => listDeliverables())
  handle(CH.agentWorkspace, () => getWorkspace())
  handle(CH.agentSetWorkspace, (p: string) => {
    const next = setWorkspace(p)
    settingsRepo.save({ agent: { ...settingsRepo.get().agent, workspace: next } })
    return next
  })
  handle(CH.agentPickWorkspace, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择 Agent 工作区目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths.length) return null
    const next = setWorkspace(res.filePaths[0])
    settingsRepo.save({ agent: { ...settingsRepo.get().agent, workspace: next } })
    return next
  })
  handle(CH.agentSkills, () => listSkills())
  handle(CH.agentSkillLoad, (name: string) => loadSkill(name))

  handle(CH.machinePermissionGet, () => ({
    tier: getMachinePermission(),
    label: PERMISSION_LABELS[getMachinePermission()],
    hint: PERMISSION_HINTS[getMachinePermission()],
    options: (['view', 'workspace', 'full'] as const).map((t) => ({
      tier: t,
      label: PERMISSION_LABELS[t],
      hint: PERMISSION_HINTS[t]
    }))
  }))
  handle(CH.machinePermissionSet, (tier: string) => {
    clearApprovals()
    const next = setMachinePermission(tier as never)
    return {
      tier: next,
      label: PERMISSION_LABELS[next],
      hint: PERMISSION_HINTS[next],
      changedAt: new Date().toISOString()
    }
  })

  if (featureOn('plugins')) {
  handle(CH.pluginList, () => listPlugins())
  handle(CH.pluginDir, () => userPluginDir())
  handle(CH.pluginImport, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择插件文件夹',
      message: '选中含 plugin.json 的插件文件夹（或包含它的上一层目录）',
      properties: ['openDirectory'],
      buttonLabel: '导入此插件'
    })
    if (res.canceled || !res.filePaths.length) return null
    const picked = res.filePaths[0]
    if (existsSync(join(picked, 'plugin.json'))) return importPluginFolder(picked)
    const candidates = readdirSync(picked)
      .map((n) => join(picked, n))
      .filter((p) => existsSync(join(p, 'plugin.json')))
    if (candidates.length === 1) return importPluginFolder(candidates[0])
    if (candidates.length === 0) throw new Error('选的文件夹里没有 plugin.json，不是合法的插件目录')
    throw new Error(`选的文件夹里有 ${candidates.length} 个插件，请直接选中其中一个`)
  })
  handle(CH.pluginRemove, (id: string) => removePlugin(id))
  handle(CH.pluginToggle, (input: { id: string; enabled?: boolean }) => {
    const current = getPlugin(input.id)
    if (!current) throw new Error(`插件不存在：${input.id}`)
    const next = typeof input.enabled === 'boolean' ? input.enabled : !current.enabled
    setPluginEnabled(input.id, next)
    return listPlugins()
  })
  handle(CH.pluginInvoke, (input: { id: string; command: string; args?: unknown }) =>
    invokePluginCommand(input.id, input.command, input.args)
  )
  handle(CH.pluginReveal, (id?: string) => revealPluginFolder(id))
  }

  handle(CH.windowGetClosePref, () => {
    const g = settingsRepo.get().general
    return { action: g.closeAction, askDisabled: g.closeAskDisabled }
  })
  handle(CH.windowSetClosePref, (input: { action?: 'ask' | 'minimize' | 'quit'; askDisabled?: boolean }) => {
    const g = settingsRepo.get().general
    return settingsRepo.save({
      general: {
        ...g,
        closeAction: input.action ?? g.closeAction,
        closeAskDisabled: input.askDisabled ?? g.closeAskDisabled
      }
    }).general
  })
  handle(CH.windowCloseAction, (action: 'minimize' | 'quit') => {
    if (action === 'quit') quitApp()
    else hideToTray()
    return true
  })
  handle(CH.trayMenu, () => {
    const active = modelRepo.active()
    const char = characterRepo.active()
    const jobs = listJobs().filter((j) => j.status === 'running')
    return [
      { label: `当前角色：${char.name}`, enabled: false },
      { label: `当前模型：${active.name}`, enabled: false },
      { label: `后台任务：${jobs.length} 个运行中`, enabled: false },
      { type: 'separator' },
      { label: '显示主窗口', action: 'show' },
      { label: '隐藏到托盘', action: 'hide' },
      { type: 'separator' },
      { label: '首页', action: 'route:home' },
      { label: '对话', action: 'route:chat' },
      { label: '记忆', action: 'route:memory' },
      { label: '智能体', action: 'route:agent' },
      { label: '设置', action: 'route:settings' },
      { type: 'separator' },
      { label: '退出', action: 'quit' }
    ]
  })
  handle(CH.trayAction, (action: string) => {
    if (action === 'show') {
      mainWindow?.show()
      mainWindow?.focus()
    } else if (action === 'hide') mainWindow?.hide()
    else if (action === 'quit') quitApp()
    else if (action.startsWith('route:')) {
      mainWindow?.show()
      mainWindow?.focus()
      mainWindow?.webContents.send('tray:navigate', action.slice(6))
    }
    return true
  })

  ipcMain.on(CH.windowMinimize, () => mainWindow?.minimize())
  ipcMain.on(CH.windowMaximize, () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.on(CH.windowClose, () => mainWindow?.close())
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

registerAppFileScheme()

app.whenReady().then(() => {
  installAppFileProtocol()
  try {
    allowRoot(getWorkspace())
    const bg = themeRepo.state()?.background
    if (bg?.mediaPath) allowFile(bg.mediaPath)
    for (const c of characterRepo.list()) {
      for (const u of [c.avatar?.main, c.avatar?.secondary, c.avatar?.banner]) {
        if (u && !/^https?:/i.test(u)) {
          const p = String(u).replace(/^file:\/\/\/?/i, '').replace(/^appfile:\/\/\/?/i, '')
          if (p && /^[a-zA-Z]:/.test(p)) allowFile(p)
        }
      }
      if (c.voice?.customPackPath) allowFile(c.voice.customPackPath)
    }
  } catch {
  }
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  ensureDataDir()
  ensureMemoryCleanup()
  registerIpc()
  void bootCapabilities()
  createWindow()
  if (settingsRepo.get().general.minimizeToTray) createTray()

  void refreshCaches()

  try {
    pruneTtsCache(60)
  } catch {
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // ???????????????????????
  if (settingsRepo.get().general.minimizeToTray && !isQuitting) return
  if (process.platform !== 'darwin') quitApp()
})

app.on('before-quit', () => {
  isQuitting = true
})

export { makeAvatars }
