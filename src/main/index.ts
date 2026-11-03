import { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage, session } from 'electron'
import { autoUpdater } from 'electron-updater'
import { ConversationTurns } from './conversationTurns'
import { join, extname, dirname, basename, sep, resolve as resolvePath } from 'node:path'
import { splashMediaStatus, pickSplashMedia, resetSplashMedia } from './splashMedia'
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { recordInteraction, relationshipSnapshot, resetRelationship, stageIndex } from './characterRuntime'
import { findOpusByLine, opusToFileUrl, hasOpus, opusDir } from './opus'
import { CH } from '../shared/channels'
import { SHOREKEEPER_CALL_MODEL } from '../shared/callModels'
import type {
  AppBootstrap,
  AppSettings,
  Attachment,
  ChatMessage,
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
import { applyNetworkConfig } from './network'
import { indexTtsStatus, installIndexTts, listReferenceVoices, synthesizeIndexTts } from './indexTts'
import { probeGptSovits, synthesizeGptSovits } from './gptSovits'
import { synthesizeLocalHttpTts } from './localHttpTts'
import { themeRepo } from './theme'
import { collectHardware } from './hardware'
import { TOOL_SPECS, launchApp, closeApp, listRunningApps } from './apps'
import { detectIntent, makeToolCall, runTool, offlineNarrate, toolSpec } from './agent'
import { buildSystemPrompt, formatCasualSpeech, streamOpenAICompatible } from './llm'
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
import { securityState, setWorkspaceTrust, putCommandRule, removeCommandRule, clearApprovals } from './workspaceSecurity'
import { openDocument } from './documents'
import { detectFileIntent } from './fileIntent'
import { modelRoute } from './modelRouting'

const isDev = !!process.env['ELECTRON_RENDERER_URL']
let mainWindow: BrowserWindow | null = null
let callWindow: BrowserWindow | null = null
let renderPreviewWindow: BrowserWindow | null = null
let tray: Tray | null = null
/**
 */
let isQuitting = false

type AppUpdateState = {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'not-available' | 'error'
  message: string
  version?: string
  percent?: number
}
let appUpdateState: AppUpdateState = { status: 'idle', message: '尚未检查更新' }

function setAppUpdateState(state: AppUpdateState): void {
  appUpdateState = state
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(CH.appUpdateState, state)
}

function getAppUpdateErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/latest\.yml.*(?:404|not found)|(?:404|not found).*latest\.yml/i.test(message)) {
    return '更新清单不存在（GitHub Release 未发布或缺少 latest.yml），请稍后重试或前往项目发布页手动下载。'
  }
  if (/\b404\b|not found/i.test(message)) {
    return '更新资源不存在，请稍后重试或前往项目发布页手动下载。'
  }
  if (/\b401\b|\b403\b|unauthorized|forbidden|authentication token/i.test(message)) {
    return '无法访问更新资源，请检查网络或发布权限。'
  }
  if (/network|timeout|ENOTFOUND|ECONN|ETIMEDOUT/i.test(message)) {
    return '连接更新服务器失败，请检查网络后重试。'
  }
  return '检查更新失败，请稍后重试或前往项目发布页手动下载。'
}

async function checkForAppUpdates(): Promise<void> {
  if (!app.isPackaged) {
    setAppUpdateState({ status: 'not-available', message: '开发环境不检查更新' })
    return
  }
  setAppUpdateState({ status: 'checking', message: '正在检查更新…' })
  await autoUpdater.checkForUpdates()
}

function setupAppUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => setAppUpdateState({ status: 'checking', message: '正在检查更新…' }))
  autoUpdater.on('update-available', (info) => setAppUpdateState({
    status: 'available', message: `发现新版本 ${info.version}，正在后台下载…`, version: info.version
  }))
  autoUpdater.on('download-progress', (progress) => setAppUpdateState({
    status: 'downloading', message: `正在下载更新 ${Math.floor(progress.percent)}%`, percent: progress.percent
  }))
  autoUpdater.on('update-downloaded', (info) => setAppUpdateState({
    status: 'ready', message: `新版本 ${info.version} 已就绪，重启后完成更新。`, version: info.version
  }))
  autoUpdater.on('update-not-available', () => setAppUpdateState({ status: 'not-available', message: '当前已是最新版本' }))
  autoUpdater.on('error', (error) => setAppUpdateState({ status: 'error', message: getAppUpdateErrorMessage(error) }))
}

/**
 */
let lastBootReport: BootReport | null = null

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function createWindow(): void {
  if (process.platform === 'win32') app.setAppUserModelId('com.shorekeeper.agent')
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
    icon: app.isPackaged ? join(process.resourcesPath, 'app.ico') : join(app.getAppPath(), '../build/icon.ico'),
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
    const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
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
const conversationTurns = new ConversationTurns()
const callConversationIds = new Set<string>()
const activeCallConversationIds = new Set<string>()
const inFlightCallConversationIds = new Map<string, symbol>()
const deferredCallReplies = new Map<string, string>()
let callMainConversationId: string | null = null
let callConversationId: string | null = null
let callSeedMessageCount = 0
let callStartedAt = 0
let callCharacterId: string | null = null
type CallMode = 'voice' | 'video'
let pendingCharacterCall: { conversationId: string; characterId: string; mode: CallMode } | null = null
type CallInitiator = 'user' | 'character'
type CallPhase = 'ringing' | 'active' | 'rejected'
let callInitiator: CallInitiator = 'user'
let callPhase: CallPhase = 'active'
let callMode: CallMode = 'video'

function send(chunk: ChatSendChunk, conversationId?: string): void {
  const payload = conversationId ? { ...chunk, conversationId } : chunk
  if (conversationId && callConversationIds.has(conversationId)) {
    callWindow?.webContents.send(CH.chatStream, payload)
    return
  }
  mainWindow?.webContents.send(CH.chatStream, payload)
}

function pickCallLine(lines: string[]): string {
  return formatCasualSpeech(lines[Math.floor(Math.random() * lines.length)])
}

function formatCallDuration(durationSeconds: number): string {
  const hours = Math.floor(durationSeconds / 3600)
  const minutes = Math.floor((durationSeconds % 3600) / 60)
  const seconds = durationSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function callGreeting(character: Character): { text: string; opusUrl: string | null } {
  const greeting = relationshipSnapshot(character, new Date(), true)
  const opus = findOpusByLine(character.id, greeting.greetingRaw)
  return { text: formatCasualSpeech(greeting.greeting), opusUrl: opus ? opusToFileUrl(opus.path) : null }
}

async function callFarewell(character: Character, durationSeconds: number, conversationId: string, callHistory: ChatMessage[]): Promise<string> {
  const settings = settingsRepo.get()
  const model = modelRepo.active()
  if (isModelUsable(model, settings)) {
    try {
      const persona = characterRepo.personaOf(character)
      const memories = memoryRepo.search('语音通话结束', character.id, settings.chat.memoryTopK, conversationId)
      const relationship = relationshipSnapshot(character)
      const system = await buildSystemPrompt({
        character,
        persona,
        memories,
        settings,
        model,
        internalPrompt: [
          internalPromptFor(character),
          `当前语音通话已经结束。请完全依照你的身份、人设、说话习惯和当前关系阶段，为这次通话说一句自然的结束语。通话时长：${formatCallDuration(durationSeconds)}。时长和关系程度只用于调整语气与情绪，不要提及数值、阶段或规则。不要套用通用客服话术，不要虚构通话中没有发生的具体事情，也不要复述用户说过的话。只输出给用户听的结束语。`
        ].filter(Boolean).join('\n\n')
      })
      let full = ''
      let failed = false
      await streamOpenAICompatible({
        settings,
        system,
        history: callHistory.slice(-24),
        userText: `通话刚刚结束。通话时长为${formatCallDuration(durationSeconds)}，当前关系阶段是${relationship.stage}。请根据你自己的性格自然道别。`,
        signal: new AbortController().signal,
        override: modelOverride(model, settings),
        cb: {
          onDelta: (delta) => { full += delta },
          onDone: (text) => { if (text) full = text },
          onError: () => { failed = true }
        }
      })
      if (!failed && full.trim()) return formatCasualSpeech(full.trim())
    } catch (error) {
      console.warn('[call] 生成符合人设的结束语失败：', error)
    }
  }
  const persona = characterRepo.personaOf(character)
  const card = buildPersonaCard(character, persona)
  return formatCasualSpeech(personaReply({
    card,
    intent: 'farewell',
    userText: `结束一通${durationSeconds < 30 ? '很短的' : durationSeconds > 180 ? '聊了很久的' : ''}语音通话`,
    memories: []
  }))
}

function rejectedCallReply(score: number, name: string): string {
  const stage = stageIndex(score)
  if (stage < 1) return pickCallLine(['没关系，你现在不方便也正常。我先不打扰了。', `知道了，${name}也不是一定要现在接。下次再说吧。`])
  if (stage < 2) return pickCallLine(['好吧，看来你现在不方便。等有空再聊。', '没关系，我晚点再找你。'])
  if (stage < 4) return pickCallLine(['有点遗憾，不过没关系，等你有空再接我吧。', '看来我来得不是时候。那就下次再聊。'])
  return pickCallLine(['咦，这就挂断啦？好吧，等你有空时再接我，好吗？', '被挂断还是有点失落……不过我会等你有空再打来的。'])
}

function isCallRequest(text: string, conversationId?: string): boolean {
  if (/(别|不要|不用|不想|拒绝|不用给我|别给我)/.test(text)) return false
  if (/(?:给我|和我|跟我|我们).{0,12}(?:打视频电话|视频通话|视频聊天)/.test(text)) return true
  if (/(?:打给我|拨给我|打过来|拨过来|给我来电话|给我打|现在有空了|现在方便了)/.test(text) && /(?:打给我|拨给我|打过来|拨过来|给我来电话|给我打|打电话|电话|通话|有空|方便)/.test(text)) return true
  if (/(?:你.{0,16}(?:给我|打给我|拨给我|和我|跟我|我们).{0,12}(?:电话|通话|call|phone)|(?:和我|跟我|我们).{0,8}(?:打电话|打个电话|通话)|给我.{0,10}(?:打电话|来电话|通话)|(?:打电话|打个电话|拨电话|通话).{0,10}(?:给我|和我|跟我)|我想.{0,12}(?:你|和你|跟你).{0,10}(?:打电话|通话)|call\s+me|phone\s+me)/i.test(text)) return true
  if (!conversationId || !/(有空|方便|现在可以|现在行|可以打|打吧|拨吧)/.test(text)) return false
  const earlierOffer = chatRepo.recent(conversationId, 8)
    .filter((message) => message.role === 'character')
    .slice(-3)
    .some((message) => /(?:我(?:(?:晚点|一会儿|等下|待会儿)?再(?:打|拨|找你)|晚点再找你)|有空(?:就|了)?(?:给你|我就)|等你(?:有空|方便)|我再(?:打|拨)过去|打给你|拨给你)/.test(message.text))
  return earlierOffer
}

function clearlyAcceptsCall(text: string): boolean {
  if (/(不行|不能|不可以|不方便|不太方便|没空|不想|不要|没法|改天|下次|以后|考虑|再看看|也许|可能|暂时不|先不了|拒绝)/.test(text)) return false
  return /(?:可以(?:呀|啊|的|了|\s*[，,。.!！？?]|$)|可以.{0,12}(?:现在|马上|这就|给你|打给你|拨给你|给你打|打电话|通话)|好(?:呀|啊|[，,])|当然|愿意|没问题|现在就|马上|这就|我.{0,8}(?:打|拨).{0,8}(?:给你|电话|过去|过来)|(?:再)?(?:打|拨).{0,6}(?:给你|过去|过来)|打给你|拨给你|给你打|calling you|call you)/i.test(text)
}

function callRequestPrompt(userText: string, conversationId?: string): string {
  return isCallRequest(userText, conversationId)
    ? `用户正在询问你是否愿意给他打${/视频|视讯|video/i.test(userText) ? '视频' : '语音'}电话。本应用确实支持角色主动呼叫，不能因为“我无法打电话/我做不到”这样的技术限制而拒绝。按当前关系和你的性格自然决定是否接受；若接受，请明确说出“好，我现在打给你”一类清楚的答应，让应用随后向用户发起来电；若你的人设和关系使你不愿意，则以角色自己的理由自然婉拒。不要声称已经拨出电话，除非你明确接受。`
    : ''
}

function maybeRingCharacterCall(conversationId: string, character: Character, userText: string, reply: string): void {
  if (!isCallRequest(userText, conversationId) || !clearlyAcceptsCall(reply)) return
  if (callWindow && !callWindow.isDestroyed()) return
  pendingCharacterCall = { conversationId, characterId: character.id, mode: /视频|视讯|video/i.test(userText) ? 'video' : 'voice' }
}

function appendRejectedCall(conversationId: string): void {
  const character = characterRepo.list().find((item) => item.id === callCharacterId) ?? characterRepo.active()
  if (!chatRepo.conversations().some((item) => item.id === conversationId && item.characterId === character.id)) return
  chatRepo.append({ conversationId, role: 'user', text: `我挂断了${character.name}的来电` })
  const text = rejectedCallReply(relationshipSnapshot(character).score, character.name)
  deferredCallReplies.set(conversationId, text)
  send({ type: 'done', text, conversationId, deferTextUntilSpeechFinished: true, forceSpeak: true }, conversationId)
}

function openCallWindow(conversationId?: string, initiator: CallInitiator = 'user', phase: CallPhase = 'active', mode: CallMode = 'video'): boolean {
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.show()
    callWindow.focus()
    return true
  }
  callMainConversationId = conversationId ?? null
  callCharacterId = characterRepo.active().id
  callInitiator = initiator
  callPhase = phase
  callMode = mode
  callStartedAt = phase === 'active' ? Date.now() : 0
  callWindow = new BrowserWindow({
    width: mode === 'voice' ? 420 : 480,
    height: mode === 'voice' ? 620 : 720,
    minWidth: 360,
    minHeight: 520,
    frame: false,
    resizable: true,
    title: mode === 'voice' ? '角色语音通话' : '角色视频通话',
    backgroundColor: '#101927',
    autoHideMenuBar: true,
    icon: app.isPackaged ? join(process.resourcesPath, 'app.ico') : join(app.getAppPath(), '../build/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  mainWindow?.webContents.send('call:active', true)
  callWindow.on('closed', () => {
    const endedInitiator = callInitiator
    const endedPhase = callPhase
    const durationMs = callStartedAt ? Math.max(0, Date.now() - callStartedAt) : 0
    const conversationId = callMainConversationId
    const callHistory = callConversationId ? chatRepo.messages(callConversationId) : []
    const callOnlyHistory = callHistory.slice(callSeedMessageCount).filter((message) => message.role === 'user' || message.role === 'character')
    callWindow = null
    mainWindow?.webContents.send('call:active', false)
    cleanupCallSession()
    if (conversationId && endedPhase === 'ringing') {
      appendRejectedCall(conversationId)
    } else if (conversationId && endedPhase === 'active' && chatRepo.conversations().some((item) => item.id === conversationId)) {
      const totalSeconds = Math.floor(durationMs / 1000)
      if (callOnlyHistory.length) {
        const transcript = callOnlyHistory.map((message) => `${message.role === 'user' ? '用户' : characterRepo.active().name}：${message.text}`).join('\n').slice(-1800)
        memoryRepo.add({
          characterId: callCharacterId ?? characterRepo.active().id,
          kind: 'summary',
          weight: 0.78,
          text: `最近一次语音通话（${formatCallDuration(totalSeconds)}）：\n${transcript}`
        })
      }
      chatRepo.append({ conversationId, role: endedInitiator, text: `语音通话已结束 · ${formatCallDuration(totalSeconds)}` })
      const character = characterRepo.list().find((item) => item.id === callCharacterId) ?? characterRepo.active()
      void callFarewell(character, totalSeconds, conversationId, callHistory).then((text) => {
        if (!chatRepo.conversations().some((item) => item.id === conversationId)) return
        deferredCallReplies.set(conversationId, text)
        send({ type: 'done', text, conversationId, deferTextUntilSpeechFinished: true, forceSpeak: true }, conversationId)
      }).catch((error) => {
        console.warn('[call] 结束语写入失败：', error)
        mainWindow?.webContents.send(CH.callEnded, conversationId)
      })
    }
    callMainConversationId = null
    callConversationId = null
    callSeedMessageCount = 0
    callCharacterId = null
    callStartedAt = 0
    callInitiator = 'user'
    callPhase = 'active'
    callMode = 'video'
  })
  if (isDev) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'] as string)
    url.searchParams.set('view', 'call')
    url.searchParams.set('mode', mode)
    void callWindow.loadURL(url.toString())
  } else {
    void callWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'call', mode } })
  }
  return true
}

function openRenderPreviewWindow(characterId: string, renderKey: string, config: unknown): boolean {
  if (!characterRepo.list().some((item) => item.id === characterId)) throw new Error('角色不存在')
  if (!renderPreviewWindow || renderPreviewWindow.isDestroyed()) {
    renderPreviewWindow = new BrowserWindow({
      width: 520,
      height: 760,
      minWidth: 360,
      minHeight: 500,
      show: false,
      title: '语音通话模型渲染预览',
      backgroundColor: '#f3f7fc',
      autoHideMenuBar: true,
      icon: app.isPackaged ? join(process.resourcesPath, 'app.ico') : join(app.getAppPath(), '../build/icon.ico'),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    renderPreviewWindow.on('closed', () => {
      renderPreviewWindow = null
      mainWindow?.webContents.send(CH.callRenderPreviewClosed)
    })
  }
  const preview = renderPreviewWindow
  const query = { view: 'call-render-preview', characterId }
  const loading = isDev
    ? (() => {
        const url = new URL(process.env['ELECTRON_RENDERER_URL'] as string)
        url.searchParams.set('view', query.view)
        url.searchParams.set('characterId', characterId)
        return preview.loadURL(url.toString())
      })()
    : preview.loadFile(join(__dirname, '../renderer/index.html'), { query })
  void loading.then(() => {
    if (!preview.isDestroyed()) {
      preview.show()
      preview.focus()
      preview.webContents.send(CH.callRenderPreviewUpdate, renderKey, config)
    }
  })
  return true
}

function cleanupCallSession(): void {
  for (const id of activeCallConversationIds) {
    conversationTurns.cancel(id)
    try {
      memoryRepo.clearConversation(id)
      chatRepo.delete(id)
    } catch { /* Temporary call session may already be gone. */ }
  }
  activeCallConversationIds.clear()
  for (const id of callConversationIds) {
    if (!inFlightCallConversationIds.has(id)) callConversationIds.delete(id)
  }
}

const TEST_LIVE2D_MODEL = 'H:\\人物模型\\L2D\\Thelema2Elysia0829_by_MomokaSono_8eb77c3b82bddb450fa7761286bec4e4.zip'
const TEST_MMD_MODEL = 'H:\\人物模型\\鸣潮_爱弥斯_校服（绑骨修模后）_by_鸣潮_64cc613d0d129d40b5b59e95f6eb0ee7\\鸣潮_爱弥斯_校服1.25.pmx'
const OFFICIAL_LIVE2D_WEB_CORE = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'

function bundledLive2DCorePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'live2d', 'live2dcubismcore.min.js')
    : join(app.getAppPath(), 'resources', 'live2d', 'live2dcubismcore.min.js')
}

function findLive2DModelJson(root: string): string | null {
  if (!existsSync(root)) return null
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()!
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) stack.push(path)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.model3.json')) return path
    }
  }
  return null
}

async function unpackLive2DArchive(zipPath: string): Promise<string> {
  const archiveBytes = readFileSync(zipPath)
  const archiveId = createHash('sha256').update(archiveBytes).digest('hex').slice(0, 20)
  const destination = join(app.getPath('userData'), 'live2d-models', archiveId)
  const existing = findLive2DModelJson(destination)
  if (existing) return existing
  const archive = await JSZip.loadAsync(archiveBytes)
  mkdirSync(destination, { recursive: true })
  const root = resolvePath(destination)
  for (const entry of Object.values(archive.files)) {
    if (entry.dir) continue
    const output = resolvePath(destination, entry.name)
    if (!output.startsWith(root + sep)) continue
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, await entry.async('nodebuffer'))
  }
  const model = findLive2DModelJson(destination)
  if (!model) throw new Error('压缩包里没有找到 .model3.json 模型入口')
  return model
}

async function prepareLive2DModel(characterId?: string): Promise<{ modelUrl: string; coreUrl: string; shaderUrl: string; modelName: string; missingCore: boolean; format: 'cubism' | 'mmd-pmx' | 'gltf'; idleMotionUrl?: string; talkMotionUrl?: string }> {
  const config = settingsRepo.get().live2d
  const character = characterId ? characterRepo.list().find((item) => item.id === characterId) : characterRepo.active()
  const characterModelPath = character?.callModelPath?.trim()
  const modelSource = characterModelPath || config.modelPath.trim()
    || (character?.id === 'char_shorekeeper' && existsSync(SHOREKEEPER_CALL_MODEL) ? SHOREKEEPER_CALL_MODEL : '')
    || (!app.isPackaged ? (existsSync(TEST_MMD_MODEL) ? TEST_MMD_MODEL : (existsSync(TEST_LIVE2D_MODEL) ? TEST_LIVE2D_MODEL : '')) : '')
  if (!modelSource) throw new Error('尚未选择视频通话模型，请在「设置 → 语音通话」中选择模型文件')
  if (!existsSync(modelSource)) throw new Error(`模型文件已移动或不存在，请重新选择：${modelSource}`)
  if (extname(modelSource).toLowerCase() === '.glb') {
    allowRoot(dirname(modelSource))
    const idleMotion = join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'shorekeeper-motion', 'stand1.glb')
    const useShorekeeperMotion = character?.id === 'char_shorekeeper' && modelSource === SHOREKEEPER_CALL_MODEL
    if (useShorekeeperMotion && existsSync(idleMotion)) allowFile(idleMotion)
    return {
      modelUrl: toAppFileUrl(modelSource),
      coreUrl: '', shaderUrl: '', modelName: character?.name || basename(modelSource, '.glb'),
      missingCore: false, format: 'gltf',
      idleMotionUrl: useShorekeeperMotion && existsSync(idleMotion) ? toAppFileUrl(idleMotion) : undefined
    }
  }
  if (extname(modelSource).toLowerCase() === '.pmx') {
    allowRoot(dirname(modelSource))
    const motionDir = app.isPackaged ? join(process.resourcesPath, 'mmd-motions') : join(app.getAppPath(), 'resources', 'mmd-motions')
    const wideIdleMotion = join(motionDir, 'idle-wait-loop-arms-wide.vmd')
    const idleMotion = existsSync(wideIdleMotion) ? wideIdleMotion : join(motionDir, 'idle-wait-loop.vmd')
    const talkMotion = join(motionDir, 'conversation-head-scratch.vmd')
    if (existsSync(idleMotion) || existsSync(talkMotion)) allowRoot(motionDir)
    return {
      modelUrl: toAppFileUrl(modelSource),
      coreUrl: '',
      shaderUrl: '',
      modelName: basename(modelSource, extname(modelSource)),
      missingCore: false,
      format: 'mmd-pmx',
      idleMotionUrl: existsSync(idleMotion) ? toAppFileUrl(idleMotion) : undefined,
      talkMotionUrl: existsSync(talkMotion) ? toAppFileUrl(talkMotion) : undefined
    }
  }
  let modelJson: string | null = null
  if (statSync(modelSource).isDirectory()) modelJson = findLive2DModelJson(modelSource)
  else if (extname(modelSource).toLowerCase() === '.zip') modelJson = await unpackLive2DArchive(modelSource)
  else if (modelSource.toLowerCase().endsWith('.model3.json')) modelJson = modelSource
  if (!modelJson || !existsSync(modelJson)) throw new Error('未能在选择的位置找到有效的 Cubism 3/4 模型入口文件')
  allowRoot(dirname(modelJson))
  if (!config.modelPath && modelSource === TEST_LIVE2D_MODEL) settingsRepo.save({ live2d: { ...config, modelPath: modelSource } })
  const corePath = config.corePath && existsSync(config.corePath) ? config.corePath : bundledLive2DCorePath()
  const coreUrl = existsSync(corePath) ? toAppFileUrl(corePath) : OFFICIAL_LIVE2D_WEB_CORE
  if (existsSync(corePath)) allowFile(corePath)
  const shaderDir = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'live2d', 'shaders')
  if (!existsSync(shaderDir)) {
    const localShaderDir = join(app.getAppPath(), 'resources', 'live2d', 'shaders')
    if (existsSync(localShaderDir)) allowRoot(localShaderDir)
  }
  const effectiveShaderDir = existsSync(shaderDir) ? shaderDir : join(app.getAppPath(), 'resources', 'live2d', 'shaders')
  return {
    modelUrl: toAppFileUrl(modelJson),
    coreUrl,
    shaderUrl: toAppFileUrl(effectiveShaderDir + sep),
    modelName: basename(dirname(modelJson)),
    missingCore: false,
    format: 'cubism'
  }
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
  signal?: AbortSignal
}): Promise<boolean> {
  const { conversationId, userText, character, persona, settings, model, attachments, intent } = args
  const emit = (chunk: ChatSendChunk): void => { args.signal?.throwIfAborted(); send(chunk, conversationId) }

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
    emit({ type: 'tool', toolCall: blocked, messageId: blockedMsg.id })
    const text = `${decision.reason}`
    const m = chatRepo.append({ conversationId, role: 'character', text })
    emit({ type: 'done', text, messageId: m.id })
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
  emit({ type: 'tool', toolCall, messageId: toolMsg.id })

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
    emit({ type: 'tool', toolCall: denied, messageId: toolMsg.id })
    const card = buildPersonaCard(character, persona)
    const text = pickPersonaLine(card, `好，那这次就不做了。需要的时候再叫我。`)
    const msg = chatRepo.append({ conversationId, role: 'character', text })
    emit({ type: 'done', text, messageId: msg.id })
    return true
  }

  const running: ToolCallRecord = { ...toolCall, state: 'running' }
  chatRepo.updateMessage(toolMsg.id, { toolCall: running })
  emit({ type: 'tool', toolCall: running, messageId: toolMsg.id })

  try {
    const output = await runAgentTool(spec.name, intent.params, args.signal)
    args.signal?.throwIfAborted()
    const done: ToolCallRecord = {
      ...running,
      state: 'done',
      result: output.result,
      summary: output.summary,
      finishedAt: Date.now()
    }
    chatRepo.updateMessage(toolMsg.id, { toolCall: done })
    emit({ type: 'tool', toolCall: done, messageId: toolMsg.id })

    const text = await narrateAgentResult({
      character,
      persona,
      settings,
      model,
      userText,
      attachments,
      context: output.context,
      fallback: output.context || output.summary,
      conversationId,
      signal: args.signal
    })
    args.signal?.throwIfAborted()
    const msg = chatRepo.append({ conversationId, role: 'character', text })
    emit({ type: 'done', text, messageId: msg.id })
    return true
  } catch (err) {
    args.signal?.throwIfAborted()
    const failed: ToolCallRecord = {
      ...running,
      state: 'failed',
      error: err instanceof Error ? err.message : String(err),
      summary: '执行失败',
      finishedAt: Date.now()
    }
    chatRepo.updateMessage(toolMsg.id, { toolCall: failed })
    emit({ type: 'tool', toolCall: failed, messageId: toolMsg.id })
    const card = buildPersonaCard(character, persona)
    const text = `${card.incapable[0]} 报错是：${failed.error}`
    const msg = chatRepo.append({ conversationId, role: 'character', text })
    emit({ type: 'done', text, messageId: msg.id })
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
  signal?: AbortSignal
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
    internalPrompt: [internalPromptFor(character), callRequestPrompt(userText, conversationId)].filter(Boolean).join('\n\n')
  })

  let full = ''
  let errored = false
  await streamOpenAICompatible({
    settings,
    system,
    history: [],
    userText: userText || '（工具执行完了）',
    signal: args.signal ?? new AbortController().signal,
    override: modelOverride(model, settings),
    cb: {
      onDelta: (d) => {
        if (args.signal?.aborted) return
        full += d
        send({ type: 'delta', text: d }, conversationId)
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
  const turn = conversationTurns.start(conversationId, callConversationIds.has(conversationId) ? 70000 : 120000)
  const onAbort = (): void => {
    if (turn.isCurrent() && turn.controller.signal.reason?.name === 'TimeoutError') {
      send({ type: 'error', error: '等待模型回复超时，请检查连接后重试' }, conversationId)
    }
  }
  turn.controller.signal.addEventListener('abort', onAbort, { once: true })
  try {
    await performUserTurn(conversationId, userText, character, attachmentIds, userImage, opening, turn.controller)
  } catch (error) {
    if (!turn.controller.signal.aborted) throw error
  } finally {
    turn.controller.signal.removeEventListener('abort', onAbort)
    turn.finish()
  }
}

async function performUserTurn(
  conversationId: string,
  userText: string,
  character: Character,
  attachmentIds: string[],
  userImage: { path: string; sticker?: boolean; mood?: string; source?: string; name?: string; alt?: string } | undefined,
  opening: boolean,
  controller: AbortController
): Promise<void> {
  const emit = (chunk: ChatSendChunk): void => {
    controller.signal.throwIfAborted()
    send(chunk, conversationId)
  }
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
        ...(callConversationIds.has(conversationId) ? {} : { conversationId }),
        kind: 'event',
        weight: 0.72,
        text: userText.trim()
      })
      emit({ type: 'tool' })
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
        intent: agentIntent,
        signal: controller.signal
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
      emit({ type: 'tool', toolCall: blocked, messageId: blockedMsg.id })
      const text = localDecision.reason
      const m = chatRepo.append({ conversationId, role: 'character', text })
      emit({ type: 'done', text, messageId: m.id })
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
    emit({ type: 'tool', toolCall, messageId: toolMsg.id })

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
      emit({ type: 'tool', toolCall: denied, messageId: toolMsg.id })
      const text = `好，那这次就不动了。需要的时候再叫我。`
      const msg = chatRepo.append({ conversationId, role: 'character', text })
      emit({ type: 'done', text, messageId: msg.id })
      return
    }

    const running: ToolCallRecord = { ...toolCall, state: 'running' }
    chatRepo.updateMessage(toolMsg.id, { toolCall: running })
    emit({ type: 'tool', toolCall: running, messageId: toolMsg.id })

    try {
      const output = await runTool(intent.tool, intent.params)
      controller.signal.throwIfAborted()
      const done: ToolCallRecord = {
        ...running,
        state: 'done',
        result: output.result,
        summary: output.summary,
        finishedAt: Date.now()
      }
      chatRepo.updateMessage(toolMsg.id, { toolCall: done })
      emit({ type: 'tool', toolCall: done, messageId: toolMsg.id })

      const text = await narrateResult({
        character,
        persona,
        settings,
        userText,
        context: output.context,
        fallback: () => offlineNarrate(intent.tool, intent.params, output.result),
        conversationId,
        signal: controller.signal
      })
      controller.signal.throwIfAborted()
      const msg = chatRepo.append({ conversationId, role: 'character', text })
      emit({ type: 'done', text, messageId: msg.id })
    } catch (err) {
      controller.signal.throwIfAborted()
      const failed: ToolCallRecord = {
        ...running,
        state: 'failed',
        error: err instanceof Error ? err.message : String(err),
        summary: '执行失败',
        finishedAt: Date.now()
      }
      chatRepo.updateMessage(toolMsg.id, { toolCall: failed })
      emit({ type: 'tool', toolCall: failed, messageId: toolMsg.id })
      const text = `这一步我没做成，报错是：${failed.error}`
      const msg = chatRepo.append({ conversationId, role: 'character', text })
      emit({ type: 'done', text, messageId: msg.id })
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

    const reactionText = formatCasualSpeech(reaction.text)
    await emitTypewriter(reactionText, conversationId, controller.signal)
    const msg = chatRepo.append({
      conversationId,
      role: 'character',
      text: reactionText,
      images: images.length ? (images as never) : undefined
    })
    emit({
      type: 'done',
      text: reactionText,
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
    internalPrompt: [internalPromptFor(character), callRequestPrompt(userText, conversationId)].filter(Boolean).join('\n\n')
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
    if (/^(你好|在吗|嗨|早上好|上午好|中午好|下午好|晚上好|早安|晚安|hello|hi)[！!。？?\s]*$/i.test(userText.trim())) text = formatCasualSpeech(relationshipSnapshot(character, new Date(), true).greeting)
    else try { modelRoute(model, settings) } catch (error) { text = error instanceof Error ? error.message : String(error) }
    await emitTypewriter(text, conversationId, controller.signal)
    const msg = chatRepo.append({ conversationId, role: 'character', text })
    const st = maybeSticker(text)
    const payload = st ? attachSticker(msg.id, st) : undefined
    emit({ type: 'done', text, messageId: msg.id, sticker: payload } as never)
    return
  }

  controller.signal.throwIfAborted()

  let full = ''
  await streamOpenAICompatible({
    settings,
    system,
    history,
    userText,
    signal: controller.signal,
    override: modelOverride(model, settings),
    tools: settings.agent.enabled ? AGENT_TOOLS.filter(t => t.category === 'fs' || (t.category === 'shell' && settings.agent.allowShell && settings.agent.machinePermission === 'full') || (t.category === 'web' && settings.agent.allowWeb)) : undefined,
    executeTool: async (name, params) => {
      controller.signal.throwIfAborted()
      const spec = AGENT_TOOLS.find(t => t.name === name)!
      const toolCall: ToolCallRecord = {
        id: 'tool_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        name, displayName: spec.displayName, actionLabel: spec.displayName, description: spec.description,
        params, state: 'running', result: null, summary: '', createdAt: Date.now(), finishedAt: null
      }
      const message = chatRepo.append({ conversationId, role: 'tool', text: spec.displayName, toolCall })
      emit({ type: 'tool', toolCall, messageId: message.id })
      try {
        const output = await runAgentTool(name, params, controller.signal)
        controller.signal.throwIfAborted()
        const done: ToolCallRecord = { ...toolCall, state: 'done', result: output.result, summary: output.summary, finishedAt: Date.now() }
        chatRepo.updateMessage(message.id, { toolCall: done })
        emit({ type: 'tool', toolCall: done, messageId: message.id })
        return output.context
      } catch (error) {
        const failed: ToolCallRecord = { ...toolCall, state: 'failed', error: error instanceof Error ? error.message : String(error), finishedAt: Date.now() }
        chatRepo.updateMessage(message.id, { toolCall: failed })
        emit({ type: 'tool', toolCall: failed, messageId: message.id })
        throw error
      }
    },
    cb: {
      onDelta: (delta) => {
        if (controller.signal.aborted) return
        full += delta
        emit({ type: 'delta', text: delta })
      },
      onDone: (text) => {
        if (controller.signal.aborted) return
        const finalText = text || full
        if (!finalText) {
          emit({ type: 'error', error: '模型没有返回内容' })
          return
        }
        const msg = chatRepo.append({ conversationId, role: 'character', text: finalText })
        const st = maybeSticker(finalText)
        const payload = st ? attachSticker(msg.id, st) : undefined
        maybeRingCharacterCall(conversationId, character, userText, finalText)
        emit({ type: 'done', text: finalText, messageId: msg.id, sticker: payload } as never)
      },
      onError: (error) => {
        if (controller.signal.aborted) return
        emit({ type: 'error', error })
        const fallback = `本轮未完成：${error}`
        const msg = chatRepo.append({ conversationId, role: 'character', text: fallback })
        emit({ type: 'done', text: fallback, messageId: msg.id })
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
    return card.selfTone === 'lively' ? '嗯 我想想怎么说 你先说说看' : '嗯 你说'
  }
  return formatCasualSpeech(text)
}

async function emitTypewriter(text: string, conversationId?: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const settings = settingsRepo.get()
  const speed = settings.chat.typeSpeedMs
  if (!settings.chat.stream || speed <= 0) {
    send({ type: 'delta', text }, conversationId)
    return
  }
  const chunks = text.match(/[^，。！？!?,\n]+[，。！？!?,\n]?/g) ?? [text]
  for (const c of chunks) {
    signal?.throwIfAborted()
    send({ type: 'delta', text: c }, conversationId)
    await new Promise((r) => setTimeout(r, Math.min(420, speed * c.length)))
  }
  signal?.throwIfAborted()
}

async function narrateResult(args: {
  character: Character
  persona: Persona
  settings: AppSettings
  userText: string
  context: string
  fallback: () => string
  conversationId?: string
  signal?: AbortSignal
}): Promise<string> {
  const { character, persona, settings, userText, context, fallback, conversationId } = args
  const selected = modelRepo.active()
  const useRemote = isModelUsable(selected, settings)
  if (!useRemote) {
    const text = fallback()
    await emitTypewriter(text, conversationId, args.signal)
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
    signal: args.signal ?? new AbortController().signal,
    cb: {
      onDelta: (d) => {
        if (args.signal?.aborted) return
        full += d
        send({ type: 'delta', text: d }, conversationId)
      },
      onDone: () => {},
      onError: () => {
        errored = true
      }
    }
  })
  args.signal?.throwIfAborted()
  if (errored || !full) {
    const text = fallback()
    await emitTypewriter(text, conversationId, args.signal)
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
  handle(CH.callRenderPreviewOpen, (characterId: string, renderKey: string, config: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口已关闭')
    return openRenderPreviewWindow(characterId, renderKey, config)
  })
  handle(CH.callRenderPreviewClose, () => {
    renderPreviewWindow?.close()
    return true
  })
  ipcMain.handle(CH.callRenderPreviewUpdate, (event, renderKey: unknown, config: unknown) => {
    if (event.sender !== mainWindow?.webContents || typeof renderKey !== 'string' || !config || typeof config !== 'object') {
      return { ok: false, error: '无效的渲染预览请求' }
    }
    renderPreviewWindow?.webContents.send(CH.callRenderPreviewUpdate, renderKey, config)
    return { ok: true, data: true }
  })
  ipcMain.handle(CH.callRuntimeUrl, (event) => {
    if (!callWindow || callWindow.isDestroyed() || event.sender !== callWindow.webContents) {
      return { ok: false, error: '仅通话窗口可读取识别引擎' }
    }
    const root = app.isPackaged
      ? join(process.resourcesPath, 'stt-runtime')
      : join(app.getAppPath(), 'resources', 'stt-runtime')
    if (!existsSync(join(root, 'ort-wasm-simd-threaded.jsep.mjs')) || !existsSync(join(root, 'ort-wasm-simd-threaded.jsep.wasm'))) {
      return { ok: false, error: '安装包缺少本地识别引擎文件' }
    }
    return { ok: true, data: toAppFileUrl(root + sep) }
  })
  ipcMain.handle(CH.callModelFile, async (event, relativePath: unknown) => {
    if (!callWindow || callWindow.isDestroyed() || event.sender !== callWindow.webContents) {
      return { ok: false, error: '仅通话窗口可读取识别模型' }
    }
    if (typeof relativePath !== 'string' || !/^[\w./-]+$/.test(relativePath) || relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
      return { ok: false, error: '无效的模型文件路径' }
    }
    const root = app.isPackaged
      ? join(process.resourcesPath, 'stt-model', 'onnx-community', 'whisper-tiny')
      : join(app.getAppPath(), 'resources', 'stt-model', 'onnx-community', 'whisper-tiny')
    const file = resolvePath(root, ...relativePath.split('/'))
    if (!file.startsWith(resolvePath(root) + sep)) return { ok: false, error: '无效的模型文件路径' }
    if (!existsSync(file)) return { ok: true, data: null }
    return { ok: true, data: new Uint8Array(readFileSync(file)) }
  })
  handle(CH.callOpen, (conversationId?: string, mode: CallMode = 'video') => openCallWindow(conversationId, 'user', 'active', mode === 'voice' ? 'voice' : 'video'))
  handle(CH.callStateGet, () => ({ phase: callPhase === 'ringing' ? 'ringing' : 'active', initiator: callInitiator, mode: callMode }))
  handle(CH.callSpeechFinished, (conversationId: string) => {
    const deferredReply = deferredCallReplies.get(conversationId)
    if (deferredReply) {
      deferredCallReplies.delete(conversationId)
      if (chatRepo.conversations().some((item) => item.id === conversationId)) {
        chatRepo.append({ conversationId, role: 'character', text: deferredReply })
        mainWindow?.webContents.send(CH.callEnded, conversationId)
      }
    }
    if (!pendingCharacterCall || pendingCharacterCall.conversationId !== conversationId) return false
    const pending = pendingCharacterCall
    pendingCharacterCall = null
    if (!chatRepo.conversations().some((item) => item.id === pending.conversationId)) return false
    return openCallWindow(pending.conversationId, 'character', 'ringing', pending.mode)
  })
  handle(CH.callAccept, () => {
    if (!callWindow || callWindow.isDestroyed() || callPhase !== 'ringing') throw new Error('当前没有等待接听的来电')
    callPhase = 'active'
    callStartedAt = Date.now()
    const character = characterRepo.list().find((item) => item.id === callCharacterId) ?? characterRepo.active()
    return { greeting: callGreeting(character) }
  })
  handle(CH.callReject, () => {
    if (!callWindow || callWindow.isDestroyed() || callPhase !== 'ringing') throw new Error('当前没有等待接听的来电')
    if (callMainConversationId) appendRejectedCall(callMainConversationId)
    callPhase = 'rejected'
    callWindow.close()
    return true
  })
  handle(CH.callBegin, () => {
    if (!callWindow || callWindow.isDestroyed()) throw new Error('通话窗口已关闭')
    if (callConversationId && activeCallConversationIds.has(callConversationId)) return { conversationId: callConversationId, greeting: null }
    const character = characterRepo.list().find(item => item.id === callCharacterId) ?? characterRepo.active()
    const conversation = chatRepo.create(character.id, '语音通话（临时）')
    const parentConversation = callMainConversationId
      ? chatRepo.conversations().find((item) => item.id === callMainConversationId && item.characterId === character.id)
      : undefined
    callSeedMessageCount = 0
    if (parentConversation) {
      for (const message of chatRepo.recent(parentConversation.id, 16)) {
        if (message.role === 'user' || message.role === 'character') {
          chatRepo.append({ conversationId: conversation.id, role: message.role, text: message.text })
          callSeedMessageCount++
        }
      }
    }
    callConversationId = conversation.id
    callConversationIds.add(conversation.id)
    activeCallConversationIds.add(conversation.id)
    const greeting = callPhase === 'active'
      ? callGreeting(characterRepo.list().find((item) => item.id === callCharacterId) ?? characterRepo.active())
      : null
    return { conversationId: conversation.id, greeting }
  })
  handle(CH.callSend, (req: { conversationId: string; text: string }) => {
    const text = req.text.trim()
    if (!callWindow || callWindow.isDestroyed()) throw new Error('通话窗口已关闭')
    if (!activeCallConversationIds.has(req.conversationId)) throw new Error('通话会话已结束，请重新打开通话')
    if (req.conversationId !== callConversationId || callPhase !== 'active') throw new Error('当前通话尚未接通')
    if (!text) throw new Error('请输入内容')
    const character = characterRepo.list().find(item => item.id === callCharacterId) ?? characterRepo.active()
    const userMsg = chatRepo.append({ conversationId: req.conversationId, role: 'user', text })
    recordInteraction(character.id, userMsg.id, text)
    const request = Symbol('call-turn')
    inFlightCallConversationIds.set(req.conversationId, request)
    void handleUserTurn(req.conversationId, text, character).catch((error) => {
      if (!activeCallConversationIds.has(req.conversationId) || inFlightCallConversationIds.get(req.conversationId) !== request) return
      const message = `本轮未完成：${error instanceof Error ? error.message : String(error)}`
      const response = chatRepo.append({ conversationId: req.conversationId, role: 'character', text: message })
      send({ type: 'error', error: message }, req.conversationId)
      send({ type: 'done', text: message, messageId: response.id }, req.conversationId)
    }).finally(() => {
      if (inFlightCallConversationIds.get(req.conversationId) !== request) return
      inFlightCallConversationIds.delete(req.conversationId)
      if (!activeCallConversationIds.has(req.conversationId)) {
        memoryRepo.clearConversation(req.conversationId)
        chatRepo.delete(req.conversationId)
        callConversationIds.delete(req.conversationId)
      }
    })
    return { messageId: userMsg.id }
  })
  ipcMain.on(CH.callClose, (event) => {
    if (callWindow && !callWindow.isDestroyed() && event.sender === callWindow.webContents) callWindow.close()
  })
  handle(CH.live2dPickModel, async (currentPath?: string) => {
    const current = currentPath || settingsRepo.get().live2d.modelPath
    const res = await dialog.showOpenDialog({
      title: '选择 Live2D、MMD 或 GLB 通话模型',
      defaultPath: current || (existsSync(TEST_LIVE2D_MODEL) ? TEST_LIVE2D_MODEL : undefined),
      properties: ['openFile'],
      filters: [
        { name: 'Live2D / 3D 通话模型', extensions: ['json', 'zip', 'pmx', 'glb'] },
        { name: 'Live2D 模型入口', extensions: ['json'] },
        { name: 'ZIP 压缩包', extensions: ['zip'] }
      ]
    })
    if (res.canceled || !res.filePaths.length) return null
    const modelPath = res.filePaths[0]
    return modelPath
  })
  handle(CH.live2dPickCore, async () => {
    const current = settingsRepo.get().live2d.corePath
    const res = await dialog.showOpenDialog({
      title: '选择 Live2D Cubism Core（官方 SDK 中的 JavaScript 文件）',
      defaultPath: current || undefined,
      properties: ['openFile'],
      filters: [{ name: 'JavaScript', extensions: ['js'] }]
    })
    if (res.canceled || !res.filePaths.length) return null
    const corePath = res.filePaths[0]
    settingsRepo.save({ live2d: { ...settingsRepo.get().live2d, corePath } })
    return corePath
  })
  handle(CH.live2dPrepare, (characterId?: string) => prepareLive2DModel(characterId))
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
    let openingOpus: string | null = null
    if (!greetedCharacters.has(character.id)) {
      greetedCharacters.add(character.id)
      const snap = relationshipSnapshot(character, new Date(), true)
      chatRepo.append({ conversationId: conversation.id, role: 'character', text: formatCasualSpeech(snap.greeting), proactive: true })
      didGreet = true
      try {
        const picked = findOpusByLine(character.id, snap.greetingRaw)
        if (picked) openingOpus = opusToFileUrl(picked.path)
        else console.warn('[greet] Opus 未匹配到台词：', JSON.stringify(snap.greetingRaw), '| dir=', opusDir(character.id))
      } catch (err) {
        console.warn('[greet] Opus 匹配失败：', err)
      }
    }
    return { conversation, messages: chatRepo.messages(conversation.id), conversations: chatRepo.conversations(character.id), characterId: character.id, openingOpus, didGreet }
  })
  registerSystemIpc()
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
    conversationTurns.cancel(id)
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
        if (!chatRepo.conversations().some(item => item.id === req.conversationId)) return
        const text = `本轮未完成：${error instanceof Error ? error.message : String(error)}`
        const message = chatRepo.append({ conversationId: req.conversationId, role: 'character', text })
        send({ type: 'error', error: text }, req.conversationId)
        send({ type: 'done', text, messageId: message.id }, req.conversationId)
      })
      return { messageId: userMsg.id }
    }
  )

  handle(CH.chatProactive, (conversationId: string) => {
    const character = characterRepo.active()
    if (!chatRepo.conversations(character.id).some((item) => item.id === conversationId)) return null

    const persona = characterRepo.personaOf(character)
    const card = buildPersonaCard(character, persona)
    const address = card.address || '你'
    const linesByTone: Record<typeof card.selfTone, string[]> = {
      warm: [
        `${address}，这会儿在忙什么呀？如果有点累，也可以和我说说。`,
        `${address}，最近有没有什么想做、但还没来得及开始的事？我可以陪你一起想想。`,
        `今天过得怎么样，${address}？有没有什么事情想和我分享？`
      ],
      lively: [
        `嘿，${address}！现在在做什么呢？今天有没有遇到什么有意思的事？`,
        `${address}，最近有什么想完成的小目标吗？要不要现在一起安排一下？`,
        `忙了一阵啦，${address}！现在最想做的事情是什么？`
      ],
      cold: [
        `${address}，现在方便聊聊吗？手头有没有一件需要优先处理的事？`,
        `你现在在忙什么，${address}？如果需要，我可以帮你理一下接下来的安排。`,
        `${address}，最近有什么计划还没决定好吗？`
      ],
      calm: [
        `${address}，现在在做什么呢？如果有需要处理的事，我们可以一起梳理。`,
        `今天还顺利吗，${address}？最近有没有什么想完成的事情？`,
        `${address}，这会儿有空聊两句吗？你最近最挂心的是什么？`
      ]
    }
    const candidates = linesByTone[card.selfTone]
    const recent = chatRepo.recent(conversationId, 12)
      .filter((message) => message.role === 'character' && message.proactive)
      .map((message) => message.text)
    const fresh = candidates.filter((line) => !recent.includes(line))
    const pool = fresh.length ? fresh : candidates
    const text = pool[Math.floor(Math.random() * pool.length)]
    return chatRepo.append({ conversationId, role: 'character', text, proactive: true })
  })

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
    conversationTurns.cancel(conversationId)
    send({ type: 'cancelled' }, conversationId)
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
  handle(CH.settingsSave, async (patch: Partial<AppSettings>) => {
    const previous = settingsRepo.get()
    if (patch.agent?.workspace) setWorkspace(patch.agent.workspace)
    if (patch.agent) clearApprovals()
    const next = settingsRepo.save(patch)
    if (patch.voiceCall?.backgroundPath) allowFile(patch.voiceCall.backgroundPath)
    for (const background of Object.values(patch.voiceCall?.backgroundByCharacter ?? {})) {
      if (background.path) allowFile(background.path)
    }
    if (patch.network) await applyNetworkConfig(next.network)
    if (patch.general?.autoUpdateEnabled && !previous.general.autoUpdateEnabled && app.isPackaged) void checkForAppUpdates().catch((error) => {
      setAppUpdateState({ status: 'error', message: getAppUpdateErrorMessage(error) })
    })
    return next
  })
  handle(CH.settingsReset, async () => {
    const next = settingsRepo.reset()
    await applyNetworkConfig(next.network)
    return next
  })
  handle(CH.appUpdateCheck, async () => {
    await checkForAppUpdates()
    return appUpdateState
  })
  handle(CH.appUpdateStateGet, () => appUpdateState)
  handle(CH.appUpdateInstall, () => {
    if (appUpdateState.status !== 'ready') return false
    autoUpdater.quitAndInstall()
    return true
  })

  handle(CH.voicePresets, () => VOICE_PRESETS)
  handle(CH.voiceAssets, () => listVoiceAssets())
  handle(CH.voiceResolve, (input: { voicePackFile: string; customPackPath: string | null }) =>
    resolveVoicePath(input.voicePackFile, input.customPackPath)
  )
  handle(CH.voicePickFile, async () => {
    const bundledReferenceVoices = app.isPackaged
      ? join(process.resourcesPath, 'reference-voices')
      : join(app.getAppPath(), 'resources', 'reference-voices')
    const res = await dialog.showOpenDialog({
      title: '选择语音文件',
      defaultPath: existsSync(bundledReferenceVoices) ? bundledReferenceVoices : undefined,
      properties: ['openFile'],
      filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }]
    })
    if (res.canceled || !res.filePaths.length) return null
    allowFile(res.filePaths[0])
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
  handle(CH.indexTtsStatus, () => {
    const cfg = settingsRepo.get().localTts
    const status = indexTtsStatus(cfg)
    if (status.ok && (
      cfg.serviceCommand !== status.paths.repo
      || cfg.qwen3Runner !== status.paths.python
      || cfg.modelPath !== status.paths.modelDir
    )) {
      settingsRepo.save({ localTts: {
        ...cfg,
        serviceCommand: status.paths.repo,
        qwen3Runner: status.paths.python,
        modelPath: status.paths.modelDir
      } })
    }
    return status
  })
  handle(CH.indexTtsVoices, (requestedDirectory?: string) => {
    const selected = requestedDirectory?.trim() || settingsRepo.get().localTts.refAudioDirectory.trim()
    const directory = selected || (app.isPackaged
      ? join(process.resourcesPath, 'reference-voices')
      : join(app.getAppPath(), 'resources', 'reference-voices'))
    const voices = listReferenceVoices(directory)
    for (const voice of voices) allowFile(voice.path)
    return { directory, voices }
  })
  handle(CH.indexTtsPickVoiceFolder, async () => {
    const current = settingsRepo.get().localTts.refAudioDirectory
    const res = await dialog.showOpenDialog({
      title: '选择参考音色文件夹',
      defaultPath: current || undefined,
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths.length) return null
    return res.filePaths[0]
  })
  handle(CH.indexTtsInstall, async () => {
    const installed = await installIndexTts((progress) => {
      mainWindow?.webContents.send(CH.indexTtsInstallProgress, progress)
    })
    const current = settingsRepo.get()
    settingsRepo.save({ localTts: {
      ...current.localTts,
      serviceCommand: installed.repo,
      qwen3Runner: installed.python,
      modelPath: installed.modelDir
    } })
    return installed
  })
  handle(CH.indexTtsSynthesize, async (input: { text: string; refAudioPath?: string }) => {
    const cfg = settingsRepo.get().localTts
    const result = await synthesizeIndexTts({ ...cfg, refAudioPath: input.refAudioPath || cfg.refAudioPath }, input.text)
    return { ...result, url: 'file:///' + result.path.replace(/\\/g, '/') }
  })
  handle(CH.gptSovitsProbe, (endpoint: string) => probeGptSovits(endpoint, settingsRepo.get().localTts.gptSovitsProbePath))
  handle(CH.gptSovitsSynthesize, (input: { text: string; refAudioPath?: string; refText?: string }) => {
    const cfg = settingsRepo.get().localTts
    return synthesizeGptSovits({ ...cfg, refAudioPath: input.refAudioPath || cfg.refAudioPath, refText: input.refText || cfg.refText }, input.text)
  })
  handle(CH.localHttpTtsSynthesize, (input: { engine: 'openai-local' | 'http-local'; text: string; voiceId?: string }) => {
    if (input.engine !== 'openai-local' && input.engine !== 'http-local') throw new Error('不支持的本地语音接口')
    return synthesizeLocalHttpTts(settingsRepo.get().localTts, input.engine, input.text, input.voiceId)
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
  handle(CH.modelConnectionTest, (input: { baseUrl: string; apiKey?: string; model?: string }) => {
    const url = new URL(input.baseUrl.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请填写有效的 HTTP(S) 服务地址，密钥请填入独立输入框')
    return probeEndpoint(url.toString().replace(/\/$/, ''), input.apiKey?.trim() || undefined, 15000, input.model?.trim() || undefined)
  })
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
    const r = await probeEndpoint(baseUrl, apiKey || undefined, 15000, target?.model)
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
  const audioOnlyMediaRequest = (details: unknown): boolean => {
    const mediaTypes = (details as { mediaTypes?: unknown })?.mediaTypes
    if (!Array.isArray(mediaTypes)) return true
    return !mediaTypes.includes('video')
  }
  // Settings needs temporary microphone access to reveal real device names;
  // the call window needs it for push-to-talk recording.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(permission === 'media' && (webContents === callWindow?.webContents || webContents === mainWindow?.webContents) && audioOnlyMediaRequest(details))
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    if (permission !== 'media' || (webContents !== callWindow?.webContents && webContents !== mainWindow?.webContents)) return false
    return audioOnlyMediaRequest(details)
  })
  installAppFileProtocol()
  void applyNetworkConfig(settingsRepo.get().network).catch((error) => console.warn('应用网络代理失败', error))
  setupAppUpdater()
  try {
    allowRoot(getWorkspace())
    const legacyCallBackground = settingsRepo.get().voiceCall
    if (legacyCallBackground.backgroundPath) {
      const activeCharacterId = characterRepo.active().id
      settingsRepo.save({ voiceCall: {
        ...legacyCallBackground,
        backgroundPath: '',
        backgroundByCharacter: {
          ...legacyCallBackground.backgroundByCharacter,
          [activeCharacterId]: legacyCallBackground.backgroundByCharacter?.[activeCharacterId] ?? {
            path: legacyCallBackground.backgroundPath,
            kind: legacyCallBackground.backgroundKind
          }
        }
      } })
    }
    const bg = themeRepo.state()?.background
    if (bg?.mediaPath) allowFile(bg.mediaPath)
    const ringtonePath = settingsRepo.get().voiceCall.ringtonePath
    if (ringtonePath && existsSync(ringtonePath)) allowFile(ringtonePath)
    const callBackgroundPath = settingsRepo.get().voiceCall.backgroundPath
    if (callBackgroundPath && existsSync(callBackgroundPath)) allowFile(callBackgroundPath)
    for (const background of Object.values(settingsRepo.get().voiceCall.backgroundByCharacter ?? {})) {
      if (background.path && existsSync(background.path)) allowFile(background.path)
    }
    const userAvatar = settingsRepo.get().chat.appearance.userAvatar
    if (userAvatar && !/^(https?:|data:)/i.test(userAvatar)) {
      const avatarPath = userAvatar.replace(/^(file|appfile):\/\/\/?/i, '')
      if (/^[a-zA-Z]:/.test(avatarPath)) allowFile(avatarPath)
    }
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
  if (settingsRepo.get().general.autoUpdateEnabled) {
    setTimeout(() => void checkForAppUpdates().catch((error) => {
      setAppUpdateState({ status: 'error', message: getAppUpdateErrorMessage(error) })
    }), 8000)
  }

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
