import React, { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../store/AppStore'
import { useSpeech } from '../../hooks/useSpeech'
import { Field, SectionHeader, SliderField, SwitchRow } from '../../components/ui'
import CloudTtsPanel from './CloudTtsPanel'
import type { CharacterVoice, LocalTtsConfig, TtsSetupProgress, VoiceEngine } from '../../../../shared/types'

/* 角色语音引擎设置。 */

export default function VoiceSection(): React.ReactElement {
  const {
    settings,
    saveSettings,
    character,
    saveCharacter,
    inworldVoices,
    refreshInworldVoices,
    testInworld,
    ttsEnv,
    refreshTtsEnv,
    setupTtsEnv,
    removeTtsEnv
  } = useApp()

  const { speak, stop, mode, lastError } = useSpeech()
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  // Inworld
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState<null | { ok: boolean; message: string }>(null)
  const [progress, setProgress] = useState<TtsSetupProgress | null>(null)
  const [settingUp, setSettingUp] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [chosenPython, setChosenPython] = useState('')
  const [indexStatus, setIndexStatus] = useState<{ ok: boolean; message: string; paths?: { installDir: string } } | null>(null)
  const [indexInstalling, setIndexInstalling] = useState(false)
  const [indexInstallProgress, setIndexInstallProgress] = useState<{ message: string; percent: number } | null>(null)
  const [indexInstallError, setIndexInstallError] = useState('')
  const [referenceVoices, setReferenceVoices] = useState<Array<{ name: string; path: string; bytes: number }>>([])
  const [referenceDirectory, setReferenceDirectory] = useState('')
  const [gptSovitsStatus, setGptSovitsStatus] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    void refreshTtsEnv()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (character?.voice.engine !== 'indextts') return
    void window.aimis.indexTts.status().then((r) => setIndexStatus(r.ok && r.data ? r.data : { ok: false, message: r.error ?? '检测失败' }))
  }, [character?.voice.engine, settings?.localTts.modelPath, settings?.localTts.qwen3Runner])

  useEffect(() => window.aimis.indexTts.onInstallProgress((next) => setIndexInstallProgress(next)), [])

  useEffect(() => {
    if (!settings) return
    void window.aimis.indexTts.voices().then((result) => {
      if (!result.ok || !result.data) return
      setReferenceVoices(result.data.voices)
      setReferenceDirectory(result.data.directory)
    })
  }, [settings?.localTts.refAudioDirectory])

  useEffect(() => {
    if (inworldVoices.length === 0 && settings?.inworld.apiKey) {
      void refreshInworldVoices(settings.inworld.apiKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inworldVoices.length, settings?.inworld.apiKey])

  useEffect(() => {
    if (settings) setApiKey(settings.inworld.apiKey)
  }, [settings?.inworld.apiKey])


  if (!settings || !character) return <></>
  const v = settings.voice
  const cv = character.voice

  const patchVoice = async (patch: Partial<CharacterVoice>): Promise<void> => {
    await saveCharacter({ voice: { ...cv, ...patch } })
  }
  const patchLocalTts = (patch: Partial<LocalTtsConfig>): void => {
    void saveSettings({ localTts: { ...settings.localTts, ...patch } })
  }



  /* ---------------- Inworld ---------------- */

  const clonedVoices = useMemo(() => inworldVoices.filter((x) => x.owned), [inworldVoices])
  const systemVoices = useMemo(() => inworldVoices.filter((x) => !x.owned && x.langCode.startsWith('zh')), [inworldVoices])
  const currentInworld = inworldVoices.find((x) => x.voiceId === cv.voiceId)

  const saveKey = async (): Promise<void> => {
    await saveSettings({ inworld: { ...settings.inworld, apiKey: apiKey.trim() } })
  }

  const doTest = async (): Promise<void> => {
    setTesting(null)
    setBusy(true)
    try {
      await saveKey()
      const r = await testInworld(apiKey.trim())
      setTesting(r)
      if (r.ok) setPreview('Inworld 已连通')
    } finally {
      setBusy(false)
    }
  }

  const refreshVoices = async (): Promise<void> => {
    setBusy(true)
    try {
      await saveKey()
      const n = await refreshInworldVoices(apiKey.trim())
      setPreview(`已拉取 ${n} 个音色（其中克隆 ${clonedVoices.length} 个）`)
    } finally {
      setBusy(false)
    }
  }


  const envReady = !!(ttsEnv && ttsEnv.venvReady && ttsEnv.depsReady)

  const doSetup = async (): Promise<void> => {
    setSettingUp(true)
    setLogs([])
    setProgress({ stage: 'detect', message: '准备开始…', percent: 0 })
    try {
      const r = await setupTtsEnv({ pythonPath: chosenPython || undefined, useMirror: true })
      setPreview(r.message)
    } finally {
      setSettingUp(false)
    }
  }

  const doRemoveEnv = async (): Promise<void> => {
    setSettingUp(true)
    try {
      const r = await removeTtsEnv()
      setPreview(r.message)
    } finally {
      setSettingUp(false)
    }
  }

  const installIndexTts = async (): Promise<void> => {
    setIndexInstalling(true)
    setIndexInstallError('')
    setIndexInstallProgress({ message: '正在准备安装…', percent: 0 })
    try {
      const result = await window.aimis.indexTts.install()
      if (!result.ok) {
        const message = result.error ?? '未知错误'
        setIndexInstallError(message)
        setPreview('IndexTTS 安装失败：' + message)
        return
      }
      setPreview(result.data?.message ?? 'IndexTTS 安装完成')
      const status = await window.aimis.indexTts.status()
      setIndexStatus(status.ok && status.data ? status.data : { ok: false, message: status.error ?? '检测失败' })
    } finally {
      setIndexInstalling(false)
    }
  }


  return (
    <>
      <SectionHeader
        title="语音"
        desc={
          <>
            当前角色：<b style={{ color: 'var(--accent)' }}>{character.name}</b> · 引擎{' '}
            <b style={{ color: 'var(--accent)' }}>
              {mode === 'inworld'
                  ? 'Inworld 云合成'
                  : mode === 'indextts'
                    ? 'IndexTTS 本地克隆'
                    : mode === 'gpt-sovits'
                      ? 'GPT-SoVITS 本地 API'
                  : mode === 'openai-local'
                    ? 'OpenAI 兼容本地接口'
                  : mode === 'http-local'
                    ? '通用 HTTP 语音接口'
                  : mode === 'synth'
                    ? '系统合成'
                    : '已关闭'}
            </b>
          </>
        }
      />

      {/* 试听 */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-title">试听</div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="btn primary" data-testid="voice-preview" onClick={() => speak(`你好呀，我是${character.name}。`)}>
            ▶ 按当前设置朗读
          </button>
          <button className="btn" onClick={() => speak('今天天气不错，要不要一起做点什么？')}>
            ▶ 试听长句
          </button>
          <button
            className="btn"
            onClick={() => {
              stop()
              setPreview('已停止')
            }}
          >
            ■ 停止
          </button>
        </div>
        {preview && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 10 }}>{preview}</div>}
        {lastError && <div style={{ fontSize: 12, color: 'var(--err)', marginTop: 10 }}>{lastError}</div>}
      </div>

      {/* 朗读行为 */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-title">朗读行为</div>
        <SwitchRow
          title="角色回复后自动播放语音"
          desc="关闭后仍可点气泡上的按钮手动播放"
          on={cv.autoSpeak}
          onChange={(v) => void patchVoice({ autoSpeak: v })}
        />
        <SwitchRow
          title="启用语音朗读（TTS）"
          desc="总开关，关闭后所有朗读行为停用"
          on={v.ttsEnabled}
          onChange={(val) => void saveSettings({ voice: { ...v, ttsEnabled: val } })}
        />
      </div>

      {/* 引擎选择 */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-title">语音引擎</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
          {(
            [
              { k: 'inworld', label: '云合成（推荐）', desc: '克隆音色朗读任意文本，需联网' },
              { k: 'indextts', label: 'IndexTTS 本地', desc: '本地零样本音色克隆，已针对低显存设备适配' },
              { k: 'gpt-sovits', label: 'GPT-SoVITS 本地 API', desc: '连接已启动的 GPT-SoVITS API 服务，使用参考音频克隆音色' },
              { k: 'openai-local', label: 'OpenAI 兼容本地 API', desc: '连接支持 /v1/audio/speech 的本地语音服务' },
              { k: 'http-local', label: '通用 HTTP 本地 API', desc: '自定义请求地址、JSON 参数和音频响应' },
              { k: 'system', label: '系统合成', desc: '走 Windows 语音，离线可用' },
              { k: 'none', label: '不发声', desc: '只显示文字' }
            ] as Array<{ k: VoiceEngine; label: string; desc: string }>
          ).map((e) => (
            <button
              key={e.k}
              data-engine={e.k}
              className={`pick-card ${cv.engine === e.k ? 'on' : ''}`}
              onClick={() => void patchVoice({ engine: e.k })}
            >
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>{e.label}</div>
              <div className="pick-desc">{e.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Inworld 面板 */}
      {cv.engine === 'inworld' && <CloudTtsPanel />}

      {cv.engine === 'gpt-sovits' && (
        <div className="card card-pad" style={{ marginBottom: 18 }} data-testid="gpt-sovits-panel">
          <div className="card-title">GPT-SoVITS 本地 API</div>
          <div className="field-hint" style={{ marginBottom: 12 }}>
            请先启动 GPT-SoVITS 的 api_v2.py 服务。默认连接本机 http://127.0.0.1:9880；若改用远程地址，合成文本和参考音频路径会发送到该服务端。
          </div>
          <Field label="服务地址与端口" hint="例如：http://127.0.0.1:9880；端口直接写在地址冒号后。">
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input grow"
                value={settings.localTts.gptSovitsEndpoint}
                onChange={(event) => void saveSettings({ localTts: { ...settings.localTts, gptSovitsEndpoint: event.target.value } })}
                placeholder="http://127.0.0.1:9880"
              />
              <button className="btn sm" disabled={busy} onClick={async () => {
                setBusy(true)
                setGptSovitsStatus(null)
                try {
                  const result = await window.aimis.gptSovits.probe(settings.localTts.gptSovitsEndpoint)
                  setGptSovitsStatus(result.ok && result.data ? result.data : { ok: false, message: result.error ?? '连接失败' })
                } finally {
                  setBusy(false)
                }
              }}>测试连接</button>
            </div>
          </Field>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <Field label="合成接口路径" hint="api_v2.py 默认 /tts" style={{ flex: 1, minWidth: 180 }}>
              <input className="input" value={settings.localTts.gptSovitsTtsPath} onChange={(event) => patchLocalTts({ gptSovitsTtsPath: event.target.value })} placeholder="/tts" />
            </Field>
            <Field label="连接检测路径" hint="默认 /docs" style={{ flex: 1, minWidth: 180 }}>
              <input className="input" value={settings.localTts.gptSovitsProbePath} onChange={(event) => patchLocalTts({ gptSovitsProbePath: event.target.value })} placeholder="/docs" />
            </Field>
          </div>
          {gptSovitsStatus && <div style={{ color: gptSovitsStatus.ok ? 'var(--ok)' : 'var(--err)', fontSize: 12, margin: '6px 0 10px' }}>{gptSovitsStatus.message}</div>}
          <Field label="本角色参考音频" hint="留空时使用下方默认音频。每个角色可单独绑定音色，切换角色后自动切换。">
            <div className="row" style={{ gap: 8 }}>
              <input className="input grow" readOnly value={cv.localRefAudioPath || settings.localTts.refAudioPath} placeholder="请选择参考音频" />
              <button className="btn sm" onClick={async () => {
                const picked = await window.aimis.voice.pickFile()
                if (picked.ok && picked.data) await patchVoice({ localRefAudioPath: picked.data })
              }}>选择</button>
              {cv.localRefAudioPath && <button className="btn sm" onClick={() => void patchVoice({ localRefAudioPath: '' })}>使用默认</button>}
            </div>
          </Field>
          <Field label="本角色音频对应文本" hint="留空时使用默认文本。">
            <textarea className="input" rows={3} value={cv.localRefText ?? ''} onChange={(event) => void patchVoice({ localRefText: event.target.value })} placeholder={settings.localTts.refText || '例如：你好呀，听得见我吗？'} />
          </Field>
          <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <Field label="参考音频语言" style={{ flex: 1 }}>
              <select className="input" value={settings.localTts.gptSovitsPromptLang} onChange={(event) => void saveSettings({ localTts: { ...settings.localTts, gptSovitsPromptLang: event.target.value } })}>
                <option value="zh">中文</option><option value="ja">日语</option><option value="en">英语</option><option value="ko">韩语</option><option value="yue">粤语</option>
              </select>
            </Field>
            <Field label="合成文本语言" style={{ flex: 1 }}>
              <select className="input" value={settings.localTts.gptSovitsTextLang} onChange={(event) => void saveSettings({ localTts: { ...settings.localTts, gptSovitsTextLang: event.target.value } })}>
                <option value="zh">中文</option><option value="ja">日语</option><option value="en">英语</option><option value="ko">韩语</option><option value="yue">粤语</option>
              </select>
            </Field>
          </div>
        </div>
      )}

      {cv.engine === 'openai-local' && <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-title">OpenAI 兼容本地语音接口</div>
        <div className="field-hint" style={{ marginBottom: 12 }}>连接实现 /v1/audio/speech 的本地服务。地址中可修改主机、端口和完整接口路径；将发送 model、input、voice，并接收 MP3 音频。</div>
        <Field label="完整接口地址（含端口和路径）" hint="例如：http://127.0.0.1:8000/v1/audio/speech">
          <input className="input" value={settings.localTts.openAiTtsEndpoint} onChange={(event) => patchLocalTts({ openAiTtsEndpoint: event.target.value })} />
        </Field>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <Field label="模型标识" style={{ flex: 1, minWidth: 180 }}><input className="input" value={settings.localTts.openAiTtsModel} onChange={(event) => patchLocalTts({ openAiTtsModel: event.target.value })} placeholder="tts-1" /></Field>
          <Field label="默认音色" style={{ flex: 1, minWidth: 180 }}><input className="input" value={settings.localTts.openAiTtsVoice} onChange={(event) => patchLocalTts({ openAiTtsVoice: event.target.value })} placeholder="alloy" /></Field>
        </div>
        <Field label={`${character.name} 的音色覆盖`} hint="留空使用默认音色，切换角色时自动切换该角色设置。"><input className="input" value={cv.openAiTtsVoiceId || ''} onChange={(event) => void patchVoice({ openAiTtsVoiceId: event.target.value })} placeholder={settings.localTts.openAiTtsVoice} /></Field>
        <Field label="Bearer 密钥（可选）" hint="仅在本地服务要求鉴权时填写。"><input className="input" type="password" value={settings.localTts.openAiTtsApiKey} onChange={(event) => patchLocalTts({ openAiTtsApiKey: event.target.value })} /></Field>
        <button className="btn primary" onClick={() => void speak(`你好呀，我是${character.name}。`)}>▶ 试听接口</button>
        {lastError && <div className="field-hint" style={{ color: 'var(--err)' }}>{lastError}</div>}
      </div>}

      {cv.engine === 'http-local' && <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-title">通用 HTTP 本地语音接口</div>
        <div className="field-hint" style={{ marginBottom: 12 }}>适配接收 GET 查询或 POST JSON、返回音频文件或 Base64 JSON 的本地服务。请求体内可使用 {'{{text}}'} 和 {'{{voice}}'} 占位符。</div>
        <Field label="完整接口地址（含端口和路径）"><input className="input" value={settings.localTts.genericTtsEndpoint} onChange={(event) => patchLocalTts({ genericTtsEndpoint: event.target.value })} placeholder="http://127.0.0.1:5000/tts" /></Field>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <Field label="请求方式" style={{ flex: 1, minWidth: 150 }}><select className="input" value={settings.localTts.genericTtsMethod} onChange={(event) => patchLocalTts({ genericTtsMethod: event.target.value as 'GET' | 'POST' })}><option value="POST">POST JSON</option><option value="GET">GET 查询参数</option></select></Field>
          <Field label="响应格式" style={{ flex: 1, minWidth: 150 }}><select className="input" value={settings.localTts.genericTtsResponse} onChange={(event) => patchLocalTts({ genericTtsResponse: event.target.value as 'audio' | 'base64' })}><option value="audio">直接返回音频</option><option value="base64">JSON 内含 Base64</option></select></Field>
        </div>
        {settings.localTts.genericTtsMethod === 'POST' && <Field label="JSON 请求体" hint={'示例：{"text":"{{text}}","voice":"{{voice}}"}'}><textarea className="input" rows={4} value={settings.localTts.genericTtsBody} onChange={(event) => patchLocalTts({ genericTtsBody: event.target.value })} /></Field>}
        {settings.localTts.genericTtsResponse === 'base64' && <Field label="Base64 字段路径" hint="例如 audio 或 data.audio"><input className="input" value={settings.localTts.genericTtsBase64Field} onChange={(event) => patchLocalTts({ genericTtsBase64Field: event.target.value })} /></Field>}
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <Field label="默认音色标识" style={{ flex: 1, minWidth: 180 }}><input className="input" value={settings.localTts.genericTtsVoice} onChange={(event) => patchLocalTts({ genericTtsVoice: event.target.value })} /></Field>
          <Field label={`${character.name} 的音色覆盖`} style={{ flex: 1, minWidth: 180 }}><input className="input" value={cv.genericTtsVoiceId || ''} onChange={(event) => void patchVoice({ genericTtsVoiceId: event.target.value })} placeholder="留空使用默认" /></Field>
        </div>
        <Field label="Bearer 密钥（可选）"><input className="input" type="password" value={settings.localTts.genericTtsApiKey} onChange={(event) => patchLocalTts({ genericTtsApiKey: event.target.value })} /></Field>
        <button className="btn primary" onClick={() => void speak(`你好呀，我是${character.name}。`)}>▶ 试听接口</button>
        {lastError && <div className="field-hint" style={{ color: 'var(--err)' }}>{lastError}</div>}
      </div>}

      {cv.engine === 'indextts' && (
        <div className="card card-pad" style={{ marginBottom: 18 }} data-testid="indextts-panel">
          <div className="card-title">IndexTTS 本地引擎</div>
          <div style={{ fontSize: 12, color: indexStatus?.ok ? 'var(--ok)' : 'var(--warn)', marginBottom: 12 }}>
            {indexStatus?.message ?? '正在检测环境…'}
          </div>
          {!indexStatus?.ok && (
            <div style={{ marginBottom: 14 }}>
              <button className="btn primary" disabled={indexInstalling} onClick={() => void installIndexTts()}>
                {indexInstalling ? `正在安装 ${indexInstallProgress?.percent ?? 0}%` : '一键安装到软件目录'}
              </button>
              <div className="field-hint" style={{ marginTop: 7 }}>
                {indexInstallProgress?.message ?? `安装包将从 GitHub Release 下载，自动校验并安装到：${indexStatus?.paths?.installDir ?? '当前软件目录下的 IndexTTSRuntime'}`}
              </div>
              <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--warn)', color: 'var(--warn)', fontSize: 12 }}>
                ⚠ 下载文件约 4.36 GiB。建议开启 VPN 或网络代理，以提高 GitHub 下载速度和稳定性。
              </div>
              {indexInstallError && (
                <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--err) 12%, transparent)', color: 'var(--err)', fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  下载失败：{indexInstallError}<br />已下载的分片会保留，再次点击可从断点继续。
                </div>
              )}
              {indexInstalling && (
                <div style={{ height: 5, marginTop: 7, borderRadius: 3, background: 'var(--surface-3)', overflow: 'hidden' }}>
                  <div style={{ width: `${indexInstallProgress?.percent ?? 0}%`, height: '100%', background: 'var(--accent)', transition: 'width .2s' }} />
                </div>
              )}
            </div>
          )}
          <Field label="参考音色" hint="选择文件夹后，文件夹内的 WAV/MP3 等音频会以音色卡片展示；点击卡片即可切换。建议使用 5–15 秒、单人且无背景音乐的音频。">
            <div className="row" style={{ gap: 8, marginBottom: 10 }}>
              <input className="input grow" readOnly value={referenceDirectory} placeholder="使用软件自带参考音色目录" title={referenceDirectory} />
              <button className="btn sm" onClick={async () => {
                const picked = await window.aimis.indexTts.pickVoiceFolder()
                if (!picked.ok || !picked.data) return
                const refreshed = await window.aimis.indexTts.voices(picked.data)
                const firstVoice = refreshed.data?.voices?.[0]?.path ?? ''
                await saveSettings({ localTts: { ...settings.localTts, refAudioDirectory: picked.data, refAudioPath: firstVoice } })
                if (firstVoice) await patchVoice({ localRefAudioPath: firstVoice })
                if (refreshed.ok && refreshed.data) {
                  setReferenceVoices(refreshed.data.voices)
                  setReferenceDirectory(refreshed.data.directory)
                }
              }}>选择文件夹</button>
            </div>
            {referenceVoices.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 9 }}>
                {referenceVoices.map((voice) => {
                  const selected = (cv.localRefAudioPath || settings.localTts.refAudioPath) === voice.path
                  return <button key={voice.path} className={`pick-card ${selected ? 'on' : ''}`} onClick={() => void patchVoice({ localRefAudioPath: voice.path })} aria-label={voice.path} style={{ minHeight: 76, textAlign: 'left' }}>
                    <span style={{ display: 'block', fontSize: 20, marginBottom: 5 }}>🎙</span>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{voice.name}</span>
                    <span style={{ display: 'block', fontSize: 10, color: 'var(--text-4)', marginTop: 3 }}>{(voice.bytes / 1024 / 1024).toFixed(1)} MB{selected ? ' · 已选' : ''}</span>
                  </button>
                })}
              </div>
            ) : <div className="field-hint">该文件夹内没有找到 WAV、MP3、FLAC 等音频文件。</div>}
          </Field>
          <div className="field" style={{ marginTop: 12 }}>
            <span className="field-label">运行设备</span>
            <select className="input" value={settings.localTts.qwen3Device} onChange={(e) => void saveSettings({ localTts: { ...settings.localTts, qwen3Device: e.target.value as 'cpu' | 'cuda' } })}>
              <option value="cuda">NVIDIA GPU（推荐）</option>
              <option value="cpu">CPU（速度很慢）</option>
            </select>
          </div>
          <div className="field-hint">第一次朗读会加载模型，耗时较长；后续朗读复用常驻进程。</div>
        </div>
      )}

      {/* 系统合成音色 */}
      {cv.engine === 'system' && (
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <div className="card-title">系统音色</div>
          <Field label="音色标识" hint="按关键词匹配本机可用语音；留空则用第一个中文语音。">
            <input
              className="input"
              data-testid="voice-id"
              value={cv.voiceId}
              onChange={(e) => void patchVoice({ voiceId: e.target.value })}
              placeholder="zh-CN-XiaoxiaoNeural"
            />
          </Field>
        </div>
      )}

      {/* 音色预设卡片已删除 —— 与「语音引擎」卡片重复 */}

      {/* 细节 */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-title">细节调整 · {character.name}</div>
        <SliderField
          label={`语速 · ${cv.rate.toFixed(2)}×`}
          value={cv.rate}
          min={0.5}
          max={2}
          step={0.02}
          onChange={(val) => void patchVoice({ rate: val })}
        />
        <SliderField
          label={
            <>
              音调 · {cv.pitch > 0 ? '+' : ''}
              {cv.pitch}
            </>
          }
          value={cv.pitch}
          min={-50}
          max={50}
          step={1}
          onChange={(val) => void patchVoice({ pitch: val })}
        />
        <SliderField
          label={`音量 · ${cv.volume}`}
          value={cv.volume}
          min={0}
          max={100}
          step={1}
          onChange={(val) => void patchVoice({ volume: val })}
        />
      </div>

      {/* STT */}
      <div className="card card-pad">
        <div className="card-title">语音识别（STT）</div>
        <SwitchRow
          title="启用麦克风输入"
          desc="用户语音在本机由 Whisper Tiny 识别，与角色的 IndexTTS 合成环境独立；识别模型已随安装包提供"
          on={v.sttEnabled}
          onChange={(val) => void saveSettings({ voice: { ...v, sttEnabled: val } })}
        />
        <div className="muted" style={{ marginTop: 12 }}>无需下载识别模型，也不需要安装 IndexTTS 或 Python。</div>
      </div>
    </>
  )
}
