import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../store/AppStore'
import { Live2DStage, MmdStage, type Live2DInfo } from './CallWindow'
import ShorekeeperStage from './ShorekeeperStage'
import { defaultCallRender, callRenderKey, callRenderStyle } from '../utils/callRender'
import { toLocalUrl } from '../utils/localUrl'
import CallBackground from '../components/CallBackground'
import type { CallRenderConfig } from '../../../shared/types'

export default function CallRenderPreview(): React.ReactElement {
  const { settings, characters } = useApp()
  const characterId = new URLSearchParams(window.location.search).get('characterId') || ''
  const character = characters.find((item) => item.id === characterId)
  const renderKey = callRenderKey(characterId, character?.callModelPath, settings?.live2d.modelPath)
  const saved = settings?.voiceCall.renderByModel?.[renderKey]
  const [draft, setDraft] = useState<CallRenderConfig | null>(null)
  const [info, setInfo] = useState<Live2DInfo | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const amplitude = useRef(0)
  const boundary = useRef(0)
  const markLoaded = useCallback(() => setLoaded(true), [])
  const reportError = useCallback((message: string) => { setLoaded(false); setError(message) }, [])

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setError('')
    setInfo(null)
    setDraft(null)
    void window.aimis.live2d.prepare(characterId).then((result) => {
      if (cancelled) return
      if (!result.ok || !result.data) throw new Error(result.error || '模型读取失败')
      if (result.data.missingCore) throw new Error('缺少 Cubism Core 运行时')
      setInfo(result.data)
      setError('')
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { cancelled = true }
  }, [characterId, character?.callModelPath, settings?.live2d.modelPath])

  useEffect(() => window.aimis.call.onRenderPreviewUpdate((key, config) => {
    if (key === renderKey) setDraft({ ...defaultCallRender(characterId), ...config })
  }), [renderKey])

  const render = { ...defaultCallRender(characterId), ...saved, ...draft }
  return <main className="live-call-window">
    <div className="live-call-scene">
      <CallBackground config={settings?.voiceCall} characterId={character?.id} fallback={character?.avatar.banner} />
      <div className="live-call-topbar"><div className="live-call-contact"><strong>{character?.name || '模型预览'}</strong><span>语音通话渲染测试</span></div></div>
      {info && !info.missingCore
        ? <div className={`live-call-model-shell${loaded ? ' is-loaded' : ' is-loading'}`} style={callRenderStyle(render)}>
            {info.format === 'mmd-pmx'
              ? <MmdStage info={info} speaking={false} lipSyncProgress={0} lipSyncAmplitude={amplitude} speechBoundary={boundary} renderConfig={render} onReady={markLoaded} onError={reportError} />
              : info.format === 'gltf'
                ? <ShorekeeperStage info={info} speaking={false} lipSyncProgress={0} lipSyncAmplitude={amplitude} renderConfig={render} onReady={markLoaded} onError={reportError} />
              : <Live2DStage info={info} speaking={false} lipSyncProgress={0} lipSyncAmplitude={amplitude} onReady={markLoaded} onError={reportError} />}
          </div>
        : null}
      {!loaded && !error && <div className="live-call-loading-overlay" role="status"><span>正在加载{character?.name || '角色'}模型…</span></div>}
      {error && <div className="live-call-loading-overlay" role="alert"><span>模型加载失败：{error}</span></div>}
    </div>
    <div className="live-call-controls" style={{ minHeight: 64, padding: '16px 20px' }}>
      <span>在设置窗口调节参数；这里会实时更新。保存后正式通话使用同一套渲染。</span>
    </div>
  </main>
}
