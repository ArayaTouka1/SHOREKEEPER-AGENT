import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../../store/AppStore'
import Avatar from '../../components/Avatar'
import { Field, SectionHeader, SwitchRow } from '../../components/ui'
import { toLocalUrl } from '../../utils/localUrl'
import { selectAudioOutput } from '../../utils/audioOutput'
import { defaultCallRender, callRenderKey } from '../../utils/callRender'
import type { CallRenderConfig } from '../../../../shared/types'
import AudioDeviceTest from './AudioDeviceTest'

export default function VoiceCallSection(): React.ReactElement {
  const { settings, saveSettings, character, characters, switchCharacter, saveCharacter, pushToast } = useApp()
  const previewAudio = useRef<HTMLAudioElement | null>(null)
  const previewContext = useRef<AudioContext | null>(null)
  const previewTimer = useRef<number | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceError, setDeviceError] = useState('')
  const [renderDraft, setRenderDraft] = useState<CallRenderConfig | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const renderKey = callRenderKey(character?.id || '', character?.callModelPath, settings?.live2d.modelPath)
  const refreshDevices = useCallback(async (requestPermission = false): Promise<void> => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) throw new Error('当前环境不支持列出音频设备')
      let permissionError = ''
      if (requestPermission) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          stream.getTracks().forEach((track) => track.stop())
        } catch (error) {
          permissionError = error instanceof Error ? error.message : String(error)
        }
      }
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput' || device.kind === 'audiooutput'))
      setDeviceError(permissionError)
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : String(error))
    }
  }, [])
  const stopPreview = (): void => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current)
    previewTimer.current = null
    if (previewAudio.current) {
      previewAudio.current.pause()
      previewAudio.current.currentTime = 0
      previewAudio.current = null
    }
    if (previewContext.current) {
      void previewContext.current.close().catch(() => undefined)
      previewContext.current = null
    }
  }

  useEffect(() => () => stopPreview(), [])
  useEffect(() => {
    void refreshDevices()
    const onDeviceChange = (): void => { void refreshDevices() }
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)
  }, [refreshDevices])
  useEffect(() => window.aimis.call.onRenderPreviewClosed(() => setPreviewOpen(false)), [])
  useEffect(() => {
    setRenderDraft(null)
    if (previewOpen && character && settings) {
      void window.aimis.call.renderPreviewOpen(character.id, renderKey, {
        ...defaultCallRender(character.id),
        ...settings.voiceCall.renderByModel?.[renderKey]
      })
    }
  }, [character?.id, renderKey])

  if (!settings || !character) return <></>

  const config = settings.voiceCall
  const renderConfig = renderDraft || { ...defaultCallRender(character.id), ...config.renderByModel?.[renderKey] }
  const patch = (next: Partial<typeof config>): void => {
    void saveSettings({ voiceCall: { ...config, ...next } })
  }

  const previewRingtone = async (): Promise<void> => {
    stopPreview()
    if (config.ringtonePath) {
      const audio = new Audio(toLocalUrl(config.ringtonePath))
      audio.volume = Math.max(0, Math.min(1, config.ringtoneVolume / 100))
      previewAudio.current = audio
      try { await selectAudioOutput(config.outputDeviceId, audio); await audio.play() } catch (error) {
        pushToast({ ok: false, text: `铃声试听失败：${error instanceof Error ? error.message : String(error)}` })
      }
      return
    }
    const AudioContextCtor = window.AudioContext
    if (!AudioContextCtor) return
    const context = new AudioContextCtor()
    previewContext.current = context
    try { await selectAudioOutput(config.outputDeviceId, null, context) } catch (error) {
      pushToast({ ok: false, text: `输出设备不可用：${error instanceof Error ? error.message : String(error)}` })
      stopPreview()
      return
    }
    const volume = Math.max(0, Math.min(1, config.ringtoneVolume / 100)) * 0.14
    const frequencies = config.ringtoneStyle === 'soft' ? [660] : [440, 480]
    const durations = config.ringtoneStyle === 'soft' ? [{ start: 0, duration: 0.55 }] : [{ start: 0, duration: 0.42 }, { start: 0.58, duration: 0.42 }]
    for (const tone of durations) {
      for (const frequency of frequencies) {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        const start = context.currentTime + tone.start
        oscillator.type = config.ringtoneStyle === 'soft' ? 'sine' : 'triangle'
        oscillator.frequency.value = frequency
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(volume / frequencies.length, start + 0.035)
        gain.gain.setValueAtTime(volume / frequencies.length, start + tone.duration - 0.06)
        gain.gain.linearRampToValueAtTime(0, start + tone.duration)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(start)
        oscillator.stop(start + tone.duration)
      }
    }
    void context.resume().catch(() => undefined)
    previewTimer.current = window.setTimeout(stopPreview, 1700)
  }

  const pickCallModel = async (): Promise<void> => {
    const result = await window.aimis.live2d.pickModel(character.callModelPath || settings.live2d.modelPath || undefined)
    if (!result.ok || !result.data) return
    await saveCharacter({ id: character.id, callModelPath: result.data })
    pushToast({ ok: true, text: `${character.name} 的通话模型已保存` })
  }

  const clearCallModel = async (): Promise<void> => {
    await saveCharacter({ id: character.id, callModelPath: '' })
  }

  const updateRender = (field: keyof CallRenderConfig, value: number): void => {
    const next = { ...renderConfig, [field]: value }
    setRenderDraft(next)
    void window.aimis.call.renderPreviewUpdate(renderKey, next)
  }

  const saveRender = async (): Promise<void> => {
    await saveSettings({ voiceCall: { ...config, renderByModel: { ...config.renderByModel, [renderKey]: renderConfig } } })
    setRenderDraft(null)
    pushToast({ ok: true, text: '通话模型渲染已保存，正式通话将使用这组设置' })
  }

  const togglePreview = async (): Promise<void> => {
    if (previewOpen) {
      await window.aimis.call.renderPreviewClose()
      setPreviewOpen(false)
      return
    }
    const result = await window.aimis.call.renderPreviewOpen(character.id, renderKey, renderConfig)
    if (!result.ok) { pushToast({ ok: false, text: result.error || '预览窗口打开失败' }); return }
    setPreviewOpen(true)
  }
  const renderSliders: Array<{ field: keyof CallRenderConfig; label: string; min: number; max: number; step: number }> = [
    { field: 'exposure', label: '曝光', min: 0.6, max: 1.6, step: 0.02 },
    { field: 'light', label: '灯光强度（3D）', min: 0.3, max: 1.6, step: 0.02 },
    { field: 'ambientLight', label: '环境光（3D）', min: 0, max: 2, step: 0.05 },
    { field: 'keyLight', label: '主光（3D）', min: 0, max: 2, step: 0.05 },
    { field: 'fillLight', label: '补光（3D）', min: 0, max: 2, step: 0.05 },
    { field: 'rimLight', label: '轮廓光（3D）', min: 0, max: 2.5, step: 0.05 },
    { field: 'faceLight', label: '面部光（3D）', min: 0, max: 2, step: 0.05 },
    { field: 'shadowStrength', label: '阴影层次（3D）', min: 0, max: 1, step: 0.05 },
    { field: 'warmth', label: '灯光冷暖（3D）', min: -1, max: 1, step: 0.05 },
    { field: 'brightness', label: '亮度', min: 0.7, max: 1.4, step: 0.02 },
    { field: 'saturation', label: '饱和度', min: 0.6, max: 2, step: 0.05 },
    { field: 'contrast', label: '对比度', min: 0.7, max: 1.5, step: 0.02 },
    { field: 'hue', label: '色相', min: -40, max: 40, step: 1 },
    { field: 'blur', label: '柔化', min: 0, max: 1.5, step: 0.05 },
    { field: 'zoom', label: '镜头远近', min: 0.8, max: 1.35, step: 0.02 },
    { field: 'verticalOffset', label: '上下位置', min: -15, max: 15, step: 1 }
  ]

  const pickRingtone = async (): Promise<void> => {
    const result = await window.aimis.voice.pickFile()
    if (result.ok && result.data) patch({ ringtonePath: result.data })
  }
  const pickBackground = async (): Promise<void> => {
    const result = await window.aimis.system.pickMedia()
    if (result.ok && result.data) await changeBackground(result.data.path, result.data.kind)
  }
  const changeBackground = async (path: string, kind: 'image' | 'video'): Promise<void> => {
    await saveSettings({ voiceCall: { ...config, backgroundByCharacter: { ...config.backgroundByCharacter, [character.id]: { path, kind } } } })
    if (previewOpen) {
      await window.aimis.call.renderPreviewClose()
      const result = await window.aimis.call.renderPreviewOpen(character.id, renderKey, renderConfig)
      setPreviewOpen(result.ok)
    }
  }

  return <>
    <SectionHeader title="语音通话" desc="通话来电提示、铃声和角色模型设置" />

    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <div className="card-title">视频通话背景 · {character.name}</div>
      <div className="field-hint" style={{ marginBottom: 12 }}>每个角色分别保存图片或视频背景。切换角色即可设置对应背景；视频将静音循环播放。</div>
      <div className="row" style={{ gap: 9, flexWrap: 'wrap', marginBottom: 14 }}>
        {characters.map((item) => <button key={item.id} className={`pick-card ${item.id === character.id ? 'on' : ''}`} onClick={() => void switchCharacter(item.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, padding: '8px 14px 8px 8px' }}>
          <Avatar src={item.avatar.main} size={28} /><span>{item.name}</span>
        </button>)}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="input grow" readOnly value={config.backgroundByCharacter?.[character.id]?.path || (!config.backgroundByCharacter?.[character.id] ? config.backgroundPath : '')} placeholder="使用当前角色头图" title={config.backgroundByCharacter?.[character.id]?.path || config.backgroundPath} />
        <button className="btn sm" onClick={() => void pickBackground()}>选择图片或视频</button>
        <button className="btn ghost sm" onClick={() => void changeBackground('', 'image')}>恢复默认</button>
      </div>
    </div>

    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <div className="card-title">音频设备</div>
      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        <Field label="麦克风输入" style={{ flex: 1, minWidth: 240 }}>
          <select className="input" value={config.inputDeviceId} onChange={(event) => patch({ inputDeviceId: event.target.value })}>
            <option value="">系统默认麦克风</option>
            {devices.filter((device) => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default').map((device, index) =>
              <option key={device.deviceId} value={device.deviceId}>{device.label || `麦克风 ${index + 1}`}</option>)}
            {config.inputDeviceId && !devices.some((device) => device.deviceId === config.inputDeviceId) && <option value={config.inputDeviceId}>已选麦克风（当前未连接）</option>}
          </select>
        </Field>
        <Field label="扬声器输出" style={{ flex: 1, minWidth: 240 }}>
          <select className="input" value={config.outputDeviceId} onChange={(event) => patch({ outputDeviceId: event.target.value })}>
            <option value="">系统默认扬声器</option>
            {devices.filter((device) => device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default').map((device, index) =>
              <option key={device.deviceId} value={device.deviceId}>{device.label || `扬声器 ${index + 1}`}</option>)}
            {config.outputDeviceId && !devices.some((device) => device.deviceId === config.outputDeviceId) && <option value={config.outputDeviceId}>已选扬声器（当前未连接）</option>}
          </select>
        </Field>
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <button className="btn sm" onClick={() => void refreshDevices(true)}>授权并刷新设备</button>
        {deviceError && <span className="field-hint">{deviceError}</span>}
      </div>
      <div className="field-hint" style={{ marginTop: 8 }}>输出设备适用于角色录音、IndexTTS 等音频播放及来电铃声；Windows 系统朗读使用系统默认输出。</div>
      <AudioDeviceTest inputId={config.inputDeviceId} outputId={config.outputDeviceId} />
    </div>

    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <div className="card-title">来电铃声</div>
      <SwitchRow
        title="启用来电铃声"
        desc="角色来电时播放铃声。"
        on={config.ringtoneEnabled}
        onChange={(value) => patch({ ringtoneEnabled: value })}
      />
      <Field label="铃声音频" hint="可选择 MP3、WAV、OGG、M4A、AAC 或 FLAC。未选择自定义音频时使用下方内置铃声。">
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" readOnly value={config.ringtonePath} placeholder={`内置铃声 · ${config.ringtoneStyle === 'classic' ? '经典双音' : '柔和提示音'}`} title={config.ringtonePath} />
          <button className="btn sm" onClick={() => void pickRingtone()}>选择铃声</button>
          {config.ringtonePath && <button className="btn ghost sm" onClick={() => patch({ ringtonePath: '' })}>恢复内置</button>}
        </div>
      </Field>
      {!config.ringtonePath && <div className="row" style={{ gap: 14, alignItems: 'flex-end' }}>
        <Field label="内置铃声类型" style={{ flex: 1 }}>
          <select className="input" value={config.ringtoneStyle} onChange={(event) => patch({ ringtoneStyle: event.target.value as 'classic' | 'soft' })}>
            <option value="classic">经典双音</option>
            <option value="soft">柔和提示音</option>
          </select>
        </Field>
      </div>}
      <Field label={`铃声音量 ${config.ringtoneVolume}%`}>
        <input className="input" type="range" min="0" max="100" value={config.ringtoneVolume} onChange={(event) => patch({ ringtoneVolume: Number(event.target.value) })} />
      </Field>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" onClick={() => void previewRingtone()}>▶ 试听铃声</button>
        <button className="btn" onClick={stopPreview}>■ 停止试听</button>
      </div>
    </div>

    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <div className="card-title">角色通话模型</div>
      <div className="field-hint" style={{ margin: '0 0 12px' }}>每个角色可单独绑定 Live2D、MMD 或 GLB 模型，切换角色后通话自动使用对应模型。守岸人默认使用 H 盘的外部模型，待机动作随安装包提供。</div>
      <div className="row" style={{ gap: 9, flexWrap: 'wrap', marginBottom: 14 }}>
        {characters.map((item) => <button key={item.id} className={`pick-card ${item.id === character.id ? 'on' : ''}`} onClick={() => void switchCharacter(item.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, padding: '8px 14px 8px 8px' }}>
          <Avatar src={item.avatar.main} size={28} /><span>{item.name}</span>
        </button>)}
      </div>
      <div className="field-hint" style={{ marginBottom: 10 }}>当前角色：{character.name}</div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="input grow" title={character.callModelPath || settings.live2d.modelPath || '未选择模型，请选择本机文件'} style={{ minWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {character.callModelPath || settings.live2d.modelPath || '未选择模型，请选择本机文件'}
        </div>
        <button className="btn sm" onClick={() => void pickCallModel()}>选择通话模型</button>
        {character.callModelPath && <button className="btn ghost sm" onClick={() => void clearCallModel()}>恢复默认</button>}
      </div>
      <div style={{ borderTop: '1px solid var(--stroke)', marginTop: 22, paddingTop: 20 }}>
        <div className="card-title">模型渲染测试</div>
        <div className="field-hint" style={{ marginBottom: 12 }}>参考 Paper朱助手的光照、阴影和色彩控制。打开测试窗口后可实时调节；保存后按模型分别记住。标注 3D 的参数作用于 MMD 和 GLB 模型。</div>
        <div className="row" style={{ gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => void togglePreview()}>{previewOpen ? '关闭测试窗口' : '打开测试窗口'}</button>
          <button className="btn" onClick={() => void saveRender()}>保存渲染设置</button>
          <button className="btn ghost" onClick={() => { const defaults = defaultCallRender(character.id); setRenderDraft(defaults); void window.aimis.call.renderPreviewUpdate(renderKey, defaults) }}>恢复默认参数</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '12px 20px' }}>
          {renderSliders.map(({ field, label, min, max, step }) => <Field key={field} label={`${label} · ${renderConfig[field].toFixed(field === 'verticalOffset' || field === 'hue' ? 0 : 2)}`}>
            <input className="input" type="range" min={min} max={max} step={step} value={renderConfig[field]} onChange={(event) => updateRender(field, Number(event.target.value))} />
          </Field>)}
        </div>
      </div>
    </div>
  </>
}
