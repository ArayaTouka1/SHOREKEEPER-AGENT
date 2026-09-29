/**
 */

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface CharacterAvatar {
  main: string
  secondary: string
  banner: string
  bannerKind?: 'image' | 'video'
  bannerOpacity?: number
}

/**
 */
export type VoiceEngine = 'voice-pack' | 'inworld' | 'system' | 'none'

/**
 */
export type LocalBackend = 'kokoro' | 'gpt-sovits' | 'cosyvoice' | 'qwen3'


export type Qwen3Variant = '1.7b' | '0.6b'

export type Qwen3Device = 'cpu' | 'cuda'

export interface LocalModelEntry {
  name: string
  path: string
  kind: 'dir' | 'file'
  size: number
  backend: LocalBackend
}

export interface LocalTtsConfig {
  backend: LocalBackend
  endpoint: string
  refAudioPath: string
  refText: string
  modelPath: string
  spkId: string
  targetLang: string
  lastProbeOk: boolean
  lastProbeMessage: string


  qwen3Variant: Qwen3Variant
  qwen3VoiceId: string
  qwen3VoiceFile: string
  qwen3RefText: string
  qwen3Runner: string
  qwen3Language: string
  qwen3Device: Qwen3Device


  serviceCommand: string
  autoStart: boolean
}

export interface CharacterVoice {
  engine: VoiceEngine
  /**
   */
  voicePackFile: string
  customPackPath: string | null
  /**
   */
  voiceId: string
  rate: number
  pitch: number
  volume: number
  autoSpeak: boolean
  endpoint: string
  localBackend: LocalBackend
  inworldModel: string
}

export interface VoicePreset {
  id: string
  name: string
  desc: string
  engine: VoiceEngine
  voicePackFile?: string
  voiceId: string
  rate: number
  pitch: number
  gender: 'female' | 'male' | 'neutral'
}

export interface VoiceAsset {
  key: string
  label: string
  characterId?: string
  path: string
  builtin: boolean
  durationSec: number | null
}

export interface Character {
  id: string
  name: string
  latinName: string
  tagline: string
  avatar: CharacterAvatar
  personaId: string
  voice: CharacterVoice
  greeting: string
  /**
   */
  userAddressOverride?: string
  builtin: boolean
  createdAt: number
  updatedAt: number
}

export interface Persona {
  id: string
  name: string
  content: string
  source: 'builtin' | 'custom'
  builtin: boolean
  updatedAt: number
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface ThemeTokens {
  bgBase: string
  bgGradA: string
  bgGradB: string
  bgGradC: string
  glass: string
  glassHover: string
  stroke: string
  strokeStrong: string
  accent: string
  accent2: string
  accentGradFrom: string
  accentGradMid: string
  accentGradTo: string
  text1: string
  text2: string
  text3: string
  text4: string
  bubbleUserFrom: string
  bubbleUserTo: string
  bubbleChar: string
  shadow: string
  dark: boolean
  uiOpacity: number
}

export interface ThemePreset {
  id: string
  name: string
  desc: string
  tokens: ThemeTokens
  builtin: boolean
}

export interface ThemeState {
  activeId: string
  customTokens: ThemeTokens
  saved: ThemePreset[]
  background: BackgroundConfig
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface BackgroundMedia {
  id: string
  name: string
  kind: 'image' | 'video'
  path: string
  url: string
  size: number
  addedAt: number
}

export interface BackgroundConfig {
  enabled: boolean
  mediaId: string
  /**
   */
  mediaPath: string
  mediaKind: 'image' | 'video' | ''
  blur: number
  overlay: number
  overlayColor: string
  playbackRate: number
  loop: boolean
  fit: 'cover' | 'contain' | 'fill'
  opacity: number
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface InworldVoice {
  voiceId: string
  displayName: string
  langCode: string
  source: string
  gender: string
  description: string
  owned: boolean
}

export type TtsProvider = 'inworld' | 'openai-compatible' | 'custom'

export interface CloudTtsConfig {
  provider: TtsProvider
  apiKey: string
  baseUrl: string
  model: string
  authMode: 'basic' | 'bearer' | 'none'
  customModels: string[]
  voicesPath: string
  speechPath: string
  voiceId: string
  verified: boolean
}

export interface InworldConfig {
  apiKey: string
  model: string
  verified: boolean
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface PythonCandidate {
  path: string
  version: string
  source: string
}

export interface TtsEnvStatus {
  venvReady: boolean
  depsReady: boolean
  pythonPath: string
  packages: Record<string, string>
  pythons: PythonCandidate[]
  root: string
  modelDir: string
  models: string[]
}

export interface TtsSetupProgress {
  stage: 'detect' | 'venv' | 'pip-upgrade' | 'install' | 'verify' | 'done' | 'error'
  message: string
  detail?: string
  percent: number
  ok?: boolean
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export type Qwen3Part = 'common' | '1.7b' | '0.6b'

export interface Qwen3ManifestEntry {
  path: string
  size: number
  part: Qwen3Part
  sha256: string
  bundled: boolean
}

export interface Qwen3EnvStatus {
  bundled: boolean
  onnxRuntime: boolean
  model1_7b: boolean
  model0_6b: boolean
  ready: boolean
  missing: string[]
  bytesOnDisk: number
  python?: never
  sizes: { bundled: number; onnxRuntime: number; model1_7b: number; model0_6b: number }
  root: string
  bundledDir: string
  runner: string
  runnerReady: boolean
}

export interface Qwen3Progress {
  file: string
  index: number
  total: number
  received: number
  totalBytes: number
  percent: number
  stage: 'idle' | 'download' | 'extract' | 'verify' | 'done' | 'error' | 'cancelled'
  message: string
}

export interface Qwen3Voice {
  id: string
  name: string
  path: string
  size: number
  format: string
  refText: string
  builtin: boolean
}

export interface Qwen3SynthResult {
  path: string
  bytes: number
  runner: string
  ms: number
}

/* ------------------------------------------------------------------ *
 *  Memory Layer
 * ------------------------------------------------------------------ */

/**
 *
 */
export type MemoryKind = 'seed' | 'fact' | 'event' | 'preference' | 'summary'

export interface MemoryItem {
  id: string
  kind: MemoryKind
  text: string
  characterId: string
  /**
   */
  conversationId?: string
  weight: number
  hits: number
  createdAt: number
  lastHitAt: number | null
  tags: string[]
}

export interface StickerSource {
  id: string
  label: string
  searchUrl: string
  enabled: boolean
  builtin: boolean
}

export interface StickerConfig {
  searchEnabled: boolean
  autoFetch: boolean
  sources: StickerSource[]
  activeSourceId: string
  maxPerFetch: number
  fetchEveryNTurns: number
}

export interface StickerWithUrl {  id: string
  file: string
  path: string
  characterId: string
  mood: string
  tags: string[]
  source: 'local' | 'user' | 'web'
  originalName?: string
  size?: number
  /** base64 data URL */
  dataUrl: string
}

export type MessageRole = 'user' | 'character' | 'system' | 'tool'

export interface MessageImage {
  path: string
  sticker?: boolean
  mood?: string
  source?: 'local' | 'user' | 'web' | 'upload'
  name?: string
  alt?: string
}

export interface ChatMessage {
  id: string
  conversationId: string
  role: MessageRole
  text: string
  createdAt: number
  toolCall?: ToolCallRecord
  streaming?: boolean
  images?: MessageImage[]
  proactive?: boolean
  attachments?: MessageAttachment[]
}

export interface MessageAttachment {
  name: string
  path: string
  kind: 'image' | 'text' | 'pdf' | 'audio' | 'video' | 'other'
  size: number
  ext: string
}

export interface Conversation {
  id: string
  characterId: string
  title: string
  summary: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

/* ------------------------------------------------------------------ *
 *  Action Layer
 * ------------------------------------------------------------------ */

export type ToolPermissionState = 'idle' | 'waiting' | 'running' | 'done' | 'failed' | 'denied'

export interface ToolCallRecord {
  id: string
  name: string
  displayName: string
  actionLabel: string
  description: string
  params: Record<string, unknown>
  state: ToolPermissionState
  result: unknown
  summary: string
  error?: string
  createdAt: number
  finishedAt: number | null
}

export interface ToolSpec {
  name: string
  displayName: string
  actionLabel: string
  description: string
  defaultPermission: 'once' | 'always' | 'deny'
  params: Array<{ key: string; label: string; required: boolean; example?: string }>
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface HardwareStatus {
  status: 'ok' | 'error'
  snapshot: {
    timestamp: string
    status: 'ok' | 'error'
    cpu: {
      name: string
      loadPercent: number
      temperatureC: number | null
      maxCoreTemperatureC: number | null
      cores: number
      threads: number
      speedGHz: number
    }
    memory: {
      totalGB: number
      usedGB: number
      usedPercent: number
    }
    gpu: {
      name: string
      temperatureC: number | null
      loadPercent: number | null
      vramUsedGB: number | null
      vramTotalGB: number | null
    } | null
    disk: Array<{ mount: string; totalGB: number; usedGB: number; usedPercent: number }>
    os: { platform: string; release: string; hostname: string; uptimeHours: number }
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface LlmConfig {
  provider: 'openai-compatible' | 'offline'
  baseUrl: string
  apiKey: string
  model: string
  visionModel: string
  temperature: number
  maxTokens: number
  systemExtra: string
}

export interface ChatConfig {
  stream: boolean
  typeSpeedMs: number
  memoryTopK: number
  autoSpeak: boolean
}

export interface CoopConfig {
  enabled: boolean
  requireApproval: boolean
  maxToolCallsPerTurn: number
}

export interface VoiceConfig {
  sttEnabled: boolean
  sttModelDir: string
  sttLanguage: string
  ttsEnabled: boolean
  packMode: 'greeting-only' | 'every-reply'
}

export interface GeneralConfig {
  launchOnStartup: boolean
  minimizeToTray: boolean
  skipSplash: boolean
  theme: string
  closeAction: 'ask' | 'minimize' | 'quit'
  closeAskDisabled: boolean
}

export interface AppSettings {
  llm: LlmConfig
  chat: ChatConfig
  coop: CoopConfig
  voice: VoiceConfig
  general: GeneralConfig
  inworld: InworldConfig
  cloudTts: CloudTtsConfig
  localTts: LocalTtsConfig
  sticker: StickerConfig
  agent: AgentConfig
}

/**
 *
 */
export type MachinePermission = 'view' | 'workspace' | 'full'

export type ToolKind = 'read' | 'write' | 'exec'

export interface PermissionDecision {
  allowed: boolean
  reason: string
  tier: MachinePermission
  kind: ToolKind
}

export interface AgentConfig {
  enabled: boolean
  workspace: string
  maxToolCalls: number
  allowShell: boolean
  allowWeb: boolean
  allowWrite: boolean
  machinePermission: MachinePermission
  /**
   */
  features: Record<string, boolean>
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface AppBootstrap {
  character: Character
  characters: Character[]
  persona: Persona
  personas: Persona[]
  conversations: Conversation[]
  settings: AppSettings
  theme: ThemeState
  themePresets: ThemePreset[]
  backgrounds: BackgroundMedia[]
  tools: ToolSpec[]
  memories: MemoryItem[]
  hardware: HardwareStatus
  voicePresets: VoicePreset[]
  voiceAssets: VoiceAsset[]
  inworldVoices: InworldVoice[]
  ttsEnv: TtsEnvStatus
  models: ModelInfo[]
  activeModelId: string
  agentTools: AgentToolSpec[]
  attachments: Attachment[]
  version: string
  splashVideo: string
}

export interface LaunchAppRequest {
  appName: string
  exePath?: string
}

export interface LaunchAppResult {
  launched: boolean
  appName: string
  resolvedPath: string | null
  message: string
  launchedAt: string
}

export interface CloseAppResult {
  closed: boolean
  appName: string
  message: string
  killedPids: number[]
}

export interface RunningApp {
  appName: string
  key: string
  exeName: string
  pids: number[]
  protected: boolean
}

export interface ChatSendRequest {
  conversationId: string
  text: string
}

export interface ChatSendChunk {
  type: 'delta' | 'done' | 'tool' | 'error'
  text?: string
  toolCall?: ToolCallRecord
  messageId?: string
  error?: string
}

export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: string
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export type ModelKind = 'api' | 'local'

export interface ModelInfo {
  apiKey?: string
  id: string
  name: string
  kind: ModelKind
  provider: string
  baseUrl: string
  model: string
  needKey: boolean
  available: boolean
  connectedAt?: number
  note?: string
}

export interface ModelState {
  overrides?: Record<string, Partial<Pick<ModelInfo, 'baseUrl' | 'model' | 'apiKey'>>>
  activeId: string
  custom: ModelInfo[]
  localConnections: Record<string, number>
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface Attachment {
  id: string
  name: string
  path: string
  url: string
  kind: 'image' | 'text' | 'pdf' | 'audio' | 'video' | 'other'
  size: number
  preview?: string
  addedAt: number
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  content: string
  status: TodoStatus
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export type JobStatus = 'running' | 'completed' | 'failed' | 'killed'

export interface JobInfo {
  id: string
  label: string
  command: string
  status: JobStatus
  exitCode: number | null
  startedAt: number
  endedAt: number | null
  outputLines: number
  tail: string
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface Deliverable {
  id: string
  name: string
  path: string
  description: string
  size: number
  createdAt: number
}

export interface AskOption {
  label: string
  description?: string
}

export interface AskRequest {
  id: string
  header?: string
  question: string
  options?: AskOption[]
  multiSelect: boolean
  createdAt: number
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export type ToolCategory = 'fs' | 'shell' | 'web' | 'agent' | 'plan' | 'interaction' | 'system'

export interface AgentToolSpec {
  name: string
  displayName: string
  description: string
  category: ToolCategory
  permission: 'always' | 'once' | 'deny'
  params: Array<{ key: string; label: string; required: boolean; example?: string }>
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface SkillInfo {
  name: string
  description: string
  path: string
  content: string
  builtin: boolean
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface PluginCommandSpec {
  name: string
  label: string
  description: string
}

/**
 */
export interface PluginCommandInfo extends PluginCommandSpec {
  registered: boolean
}

/**
 */
export interface PluginManifest {
  id: string
  name: string
  version: string
  author: string
  description: string
  main: string
  /**
   */
  icon: string | null
  enabled: boolean
  commands: PluginCommandSpec[]
}

export interface PluginInfo {
  manifest: PluginManifest
  dir: string
  builtin: boolean
  enabled: boolean
  loaded: boolean
  error: string | null
  commands: PluginCommandInfo[]
  missing: string[]
  logs: string[]
  /**
   */
  iconUrl: string | null
}

export interface BrokenPlugin {
  dir: string
  error: string
}

export interface PluginListResult {
  plugins: PluginInfo[]
  broken: BrokenPlugin[]
  dir: string
}

export interface PluginImportResult {
  plugin: PluginInfo | null
  replaced: boolean
  list: PluginListResult
}

export interface PluginInvokeResult {
  ok: boolean
  result: unknown
  error: string | null
  ms: number
}

export interface PluginState {
  enabled: Record<string, boolean>
}
