import React, { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../store/AppStore'
import { useSpeech } from '../../hooks/useSpeech'
import { EmptyHint, Field, SectionHeader, SliderField, SwitchRow } from '../../components/ui'
import CloudTtsPanel from './CloudTtsPanel'
import type { CharacterVoice, TtsSetupProgress, VoiceEngine, VoicePreset } from '../../../../shared/types'

/* ==================================================================
   语音 —— 四种引擎：Inworld 云合成 / 语音包 / 本地合成 / 系统合成
   ================================================================== */

export default function VoiceSection(): React.ReactElement {
  const {
    settings,
    saveSettings,
    character,
    saveCharacter,
    voicePresets,
    voiceAssets,
    refreshVoicePresets,
    refreshVoiceAssets,
    inworldVoices,
    refreshInworldVoices,
    testInworld,
    ttsEnv,
    refreshTtsEnv,
    setupTtsEnv,
    removeTtsEnv
  } = useApp()

  const { speak, playPack, stop, mode, lastError } = useSpeech()
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  // Inworld
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState<null | { ok: boolean; message: string }>(null)
  const [progress, setProgress] = useState<TtsSetupProgress | null>(null)
  const [settingUp, setSettingUp] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [chosenPython, setChosenPython] = useState('')

  useEffect(() => {
    void refreshVoicePresets()
    void refreshVoiceAssets()
    void refreshTtsEnv()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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


  const myAssets = voiceAssets.filter((a) => a.builtin && a.characterId === character.id)
  const userAssets = voiceAssets.filter((a) => !a.builtin)
  const currentFileName = cv.customPackPath ? cv.customPackPath.split(/[\\/]/).pop() : cv.voicePackFile

  const importVoice = async (): Promise<void> => {
    setBusy(true)
    setPreview('')
    try {
      const res = await window.aimis.voice.importFile()
      if (!res.ok) {
        setPreview('导入失败：' + res.error)
        return
      }
      if (!res.data) return
      await refreshVoiceAssets()
      await patchVoice({ customPackPath: null, voicePackFile: res.data.fileName, engine: 'voice-pack' })
      setPreview('已导入并设为当前音色：' + res.data.fileName)
    } finally {
      setBusy(false)
    }
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


  const applyPreset = async (p: VoicePreset): Promise<void> => {
    const patch: Partial<CharacterVoice> = {
      engine: p.engine,
      rate: p.rate,
      pitch: p.pitch,
      voicePackFile: p.voicePackFile ?? cv.voicePackFile
    }
    if (p.engine === 'system') patch.voiceId = p.voiceId
    await patchVoice(patch)
    setPreview('已应用「' + p.name + '」')
  }

  return (
    <>
      <SectionHeader
        title="语音"
        desc={
          <>
            当前角色：<b style={{ color: 'var(--accent)' }}>{character.name}</b> · 引擎{' '}
            <b style={{ color: 'var(--accent)' }}>
              {mode === 'pack'
                ? '语音包'
                : mode === 'inworld'
                  ? 'Inworld 云合成'
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

      {/* 本地语音生成引擎已全部移除 —— 云合成 / 语音包 / 系统合成 / 不发声 */}

      {/* 语音包面板 */}
      {cv.engine === 'voice-pack' && (
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <div className="card-title">语音包</div>

          <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 6 }}>{character.name} 自带</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {myAssets.map((a) => {
              const fileName = a.path.split(/[\\/]/).pop() ?? ''
              const on = !cv.customPackPath && cv.voicePackFile === fileName
              return (
                <button
                  key={a.key}
                  data-asset={a.key}
                  className={`pick-card ${on ? 'on' : ''}`}
                  style={{ minWidth: 160 }}
                  onClick={() => void patchVoice({ voicePackFile: fileName, customPackPath: null })}
                >
                  <div style={{ fontSize: 13 }}>{a.label}</div>
                  <div className="pick-desc">内置语音包</div>
                </button>
              )
            })}
            {myAssets.length === 0 && <EmptyHint>没有找到自带语音包</EmptyHint>}
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 6 }}>已导入（{userAssets.length}）</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {userAssets.map((a) => {
              const fileName = a.path.split(/[\\/]/).pop() ?? ''
              const on = !cv.customPackPath && cv.voicePackFile === fileName
              return (
                <div key={a.key} className="row" style={{ gap: 4 }}>
                  <button
                    className={`pick-card ${on ? 'on' : ''}`}
                    style={{ minWidth: 140 }}
                    onClick={() => void patchVoice({ voicePackFile: fileName, customPackPath: null })}
                  >
                    <div style={{ fontSize: 13 }}>{a.label}</div>
                    <div className="pick-desc">用户导入</div>
                  </button>
                  <button
                    className="btn ghost sm danger"
                    title="从语音库删除"
                    onClick={async () => {
                      await window.aimis.voice.remove(fileName)
                      await refreshVoiceAssets()
                    }}
                  >
                    ×
                  </button>
                </div>
              )
            })}
            {userAssets.length === 0 && <EmptyHint>还没有导入过</EmptyHint>}
          </div>

          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={busy} onClick={() => void importVoice()}>
              ＋ 导入语音到语音库
            </button>
          </div>
          {cv.customPackPath && (
            <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 8 }}>当前使用外部文件：{cv.customPackPath}</div>
          )}
          {currentFileName && (
            <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 8 }}>当前语音包：{currentFileName}</div>
          )}
        </div>
      )}

      {/* 本地合成引擎已删除 —— 云合成 / 系统合成 / 语音包 / 不发声 */}

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
          desc="需要本机 faster-whisper 模型"
          on={v.sttEnabled}
          onChange={(val) => void saveSettings({ voice: { ...v, sttEnabled: val } })}
        />
        <Field style={{ marginTop: 14 }} label="本地模型目录">
          <input
            className="input"
            value={v.sttModelDir}
            onChange={(e) => void saveSettings({ voice: { ...v, sttModelDir: e.target.value } })}
          />
        </Field>
      </div>
    </>
  )
}
