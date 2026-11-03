import React, { useEffect, useRef, useState } from 'react'
import { selectAudioOutput } from '../../utils/audioOutput'

export default function AudioDeviceTest({ inputId, outputId }: { inputId: string; outputId: string }): React.ReactElement {
  const [recording, setRecording] = useState(false)
  const [recorded, setRecorded] = useState(false)
  const [status, setStatus] = useState('')
  const generation = useRef(0)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const blobUrl = useRef('')
  const timer = useRef<number | null>(null)
  const context = useRef<AudioContext | null>(null)
  const acquiring = useRef(false)
  const cleanup = (): void => {
    generation.current++
    acquiring.current = false
    if (timer.current !== null) window.clearTimeout(timer.current)
    if (recorder.current) {
      recorder.current.onstop = null
      if (recorder.current.state !== 'inactive') recorder.current.stop()
      recorder.current = null
    }
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
    audio.current?.pause()
    audio.current = null
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
    blobUrl.current = ''
    void context.current?.close().catch(() => undefined)
    context.current = null
  }
  useEffect(() => {
    setRecording(false); setRecorded(false); setStatus('')
    return cleanup
  }, [inputId, outputId])
  const record = async (): Promise<void> => {
    if (acquiring.current || recording) return
    cleanup()
    const current = generation.current
    acquiring.current = true
    setRecorded(false); setStatus('正在打开麦克风…')
    try {
      const source = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: inputId ? { exact: inputId } : undefined } })
      if (current !== generation.current) { source.getTracks().forEach(track => track.stop()); return }
      stream.current = source
      const next = new MediaRecorder(source)
      recorder.current = next
      const chunks: BlobPart[] = []
      next.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      next.onstop = () => {
        source.getTracks().forEach(track => track.stop())
        if (current !== generation.current) return
        blobUrl.current = URL.createObjectURL(new Blob(chunks, { type: next.mimeType }))
        setRecorded(true); setRecording(false); setStatus('试录完成，可以回放检查声音')
      }
      next.start()
      setRecording(true); setStatus('请说一句话，3 秒后自动结束')
      timer.current = window.setTimeout(() => { if (next.state !== 'inactive') next.stop() }, 3000)
    } catch (error) {
      if (current === generation.current) { cleanup(); setRecording(false); setStatus(`试录失败：${error instanceof Error ? error.message : String(error)}`) }
    } finally { if (current === generation.current) acquiring.current = false }
  }
  const replay = async (): Promise<void> => {
    const current = generation.current
    audio.current?.pause()
    const next = new Audio(blobUrl.current)
    audio.current = next
    try {
      await selectAudioOutput(outputId, next)
      if (current !== generation.current) return
      await next.play()
      setStatus('正在从所选扬声器回放试录')
    } catch (error) { if (current === generation.current) setStatus(`回放失败：${error instanceof Error ? error.message : String(error)}`) }
  }
  const testSpeaker = async (): Promise<void> => {
    const current = generation.current
    void context.current?.close().catch(() => undefined)
    const next = new AudioContext()
    context.current = next
    try {
      await selectAudioOutput(outputId, null, next)
      if (current !== generation.current) { void next.close(); return }
      await next.resume()
      const tone = next.createOscillator()
      const gain = next.createGain()
      tone.frequency.value = 660
      gain.gain.setValueAtTime(0.08, next.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, next.currentTime + 0.6)
      tone.connect(gain); gain.connect(next.destination)
      tone.onended = () => { void next.close().catch(() => undefined); if (context.current === next) context.current = null }
      tone.start(); tone.stop(next.currentTime + 0.65)
      setStatus('已播放测试音，请确认所选扬声器有声音')
    } catch (error) {
      void next.close().catch(() => undefined)
      if (current === generation.current) setStatus(`试听失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return <div style={{ marginTop: 12 }}>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <button className="btn sm" disabled={recording} onClick={() => void record()}>{recording ? '正在试录…' : '麦克风试录 3 秒'}</button>
      <button className="btn sm" disabled={!recorded || recording} onClick={() => void replay()}>回放试录</button>
      <button className="btn sm" disabled={recording} onClick={() => void testSpeaker()}>扬声器试听</button>
    </div>
    {status && <div className="field-hint" role="status" style={{ marginTop: 8 }}>{status}</div>}
  </div>
}
