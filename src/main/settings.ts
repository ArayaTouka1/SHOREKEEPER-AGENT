import { JsonStore } from './store'
import type { AppSettings } from '../shared/types'

export const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    provider: 'offline',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    visionModel: '',
    temperature: 0.85,
    maxTokens: 1024,
    systemExtra: ''
  },
  chat: {
    stream: true,
    typeSpeedMs: 18,
    memoryTopK: 4,
    autoSpeak: false,
    appearance: {
      userBubbleFrom: '#123e79',
      userBubbleTo: '#123054',
      characterBubble: '#f5fafc',
      bubbleStyle: 'resonance',
      showCharacterAvatar: true,
      showUserAvatar: true,
      userAvatar: ''
    }
  },
  coop: {
    enabled: true,
    requireApproval: true,
    maxToolCallsPerTurn: 4
  },
  voice: {
    sttEnabled: false,
    sttModelDir: '',
    sttLanguage: 'zh',
    ttsEnabled: true,
    packMode: 'every-reply'
  },
  general: {
    launchOnStartup: false,
    minimizeToTray: true,
    skipSplash: false,
    theme: 'sakura',
    closeAction: 'ask',
    closeAskDisabled: false,
    autoUpdateEnabled: true
  },
  network: {
    mode: 'system',
    proxyRules: '',
    proxyBypassRules: '<local>'
  },
  inworld: {
    apiKey: '',
    model: 'inworld-tts-2',
    verified: false
  },
  cloudTts: {
    provider: 'inworld',
    apiKey: '',
    baseUrl: 'https://api.inworld.ai',
    model: 'inworld-tts-2',
    authMode: 'basic',
    customModels: [],
    voicesPath: '',
    speechPath: '',
    voiceId: '',
    verified: false
  },
  localTts: {
    backend: 'indextts',
    endpoint: 'http://127.0.0.1:36365',
    refAudioPath: '',
    refAudioDirectory: '',
    refText: '',
    modelPath: '',
    spkId: '中文女',
    targetLang: 'zh',
    lastProbeOk: false,
    lastProbeMessage: '',
    qwen3Variant: '0.6b',
    qwen3VoiceId: 'shorekeeper',
    qwen3VoiceFile: '',
    qwen3RefText: '',
    qwen3Runner: '',
    qwen3Language: 'ZH',
    qwen3Device: 'cuda',
    gptSovitsEndpoint: 'http://127.0.0.1:9880',
    gptSovitsTtsPath: '/tts',
    gptSovitsProbePath: '/docs',
    gptSovitsTextLang: 'zh',
    gptSovitsPromptLang: 'zh',
    openAiTtsEndpoint: 'http://127.0.0.1:8000/v1/audio/speech',
    openAiTtsModel: 'tts-1',
    openAiTtsVoice: 'alloy',
    openAiTtsApiKey: '',
    genericTtsEndpoint: 'http://127.0.0.1:5000/tts',
    genericTtsMethod: 'POST',
    genericTtsBody: '{"text":"{{text}}","voice":"{{voice}}"}',
    genericTtsResponse: 'audio',
    genericTtsBase64Field: 'audio',
    genericTtsVoice: '',
    genericTtsApiKey: '',
    serviceCommand: '',
    autoStart: false,
  },
  live2d: {
    modelPath: '',
    corePath: ''
  },
  voiceCall: {
    inputDeviceId: '',
    outputDeviceId: '',
    backgroundPath: '',
    backgroundKind: 'image',
    backgroundByCharacter: {},
    renderByModel: {},
    ringtoneEnabled: true,
    ringtoneStyle: 'classic',
    ringtoneVolume: 65,
    ringtonePath: ''
  },
  sticker: {
    searchEnabled: true,
    autoFetch: false,
    activeSourceId: 'bing',
    maxPerFetch: 3,
    fetchEveryNTurns: 12,
    sources: [
      {
        id: 'bing',
        label: 'Bing 图片',
        searchUrl: 'https://www.bing.com/images/search?q={q}',
        enabled: true,
        builtin: true
      },
      {
        id: 'baidu',
        label: '百度图片',
        searchUrl: 'https://image.baidu.com/search/index?tn=baiduimage&word={q}',
        enabled: false,
        builtin: true
      },
      {
        id: 'sogou',
        label: '搜狗图片',
        searchUrl: 'https://pic.sogou.com/pics?query={q}',
        enabled: false,
        builtin: true
      }
    ]
  },
  agent: {
    enabled: true,
    workspace: '',
    maxToolCalls: 6,
    allowShell: true,
    allowWeb: true,
    allowWrite: true,
    machinePermission: 'view',
    /**
     */
    features: {} as Record<string, boolean>
  }
}

export const settingsStore = new JsonStore<AppSettings>('settings', () => structuredClone(DEFAULT_SETTINGS))

function deepMerge<T>(base: T, patch: Partial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) }
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge((base as any)[k] ?? {}, v as any)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out as T
}

export interface EngineInfo {
  mode: 'offline' | 'remote'
  ready: boolean
  reason: string
  label: string
}

export const settingsRepo = {
  get(): AppSettings {
    const merged = deepMerge(DEFAULT_SETTINGS, settingsStore.read())
    if ((merged.localTts.backend as string) === 'kokoro') {
      merged.localTts.backend = 'indextts'
    }
    if (!merged.cloudTts.baseUrl) merged.cloudTts.baseUrl = DEFAULT_SETTINGS.cloudTts.baseUrl
    if (!merged.cloudTts.authMode) merged.cloudTts.authMode = DEFAULT_SETTINGS.cloudTts.authMode
    return merged
  },
  save(patch: Partial<AppSettings>): AppSettings {
    const next = deepMerge(this.get(), patch)
    settingsStore.write(next)
    return next
  },
  reset(): AppSettings {
    settingsStore.write(structuredClone(DEFAULT_SETTINGS))
    return this.get()
  },

  /**
   */
  engineInfo(): EngineInfo {
    const s = this.get()
    if (s.llm.provider === 'offline') {
      return { mode: 'offline', ready: true, reason: '正在使用内置离线引擎', label: '本地离线引擎' }
    }
    if (!s.llm.apiKey.trim()) {
      return {
        mode: 'offline',
        ready: false,
        reason: '已选择 OpenAI 兼容接口，但还没填 API Key —— 当前会回退到离线引擎',
        label: 'OpenAI 兼容接口（未配置）'
      }
    }
    return {
      mode: 'remote',
      ready: true,
      reason: `已接入 ${s.llm.model || '未命名模型'}（${s.llm.baseUrl}）`,
      label: 'OpenAI 兼容接口'
    }
  }
}
