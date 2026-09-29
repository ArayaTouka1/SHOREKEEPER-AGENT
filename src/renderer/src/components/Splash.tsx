import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/AppStore'

/**
 */
export default function Splash({ onDone }: { onDone: () => void }): React.ReactElement {
  const { character, splashVideo } = useApp()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [leaving, setLeaving] = useState(false)
  const [typed, setTyped] = useState('')
  const [videoDone, setVideoDone] = useState(!splashVideo)
  const [failed, setFailed] = useState(false)
  const finishTimer = useRef<number | null>(null)

  const title = character?.latinName || 'SHOREKEEPER'
  // Main process provides an authorized local media URL.
  const [videoUrl, setVideoUrl] = useState(splashVideo)
  useEffect(() => {
    let active = true
    if (splashVideo) setVideoUrl(splashVideo)
    else void window.aimis.splash.status().then(result => {
      if (active && result.ok && result.data) setVideoUrl(result.data.url)
    }).catch(() => { if (active) setVideoDone(true) })
    return () => { active = false }
  }, [splashVideo])

  useEffect(() => () => {
    if (finishTimer.current !== null) window.clearTimeout(finishTimer.current)
  }, [])

  useEffect(() => {
    const el = videoRef.current
    if (!el) { setVideoDone(true); return }
    setVideoDone(false)
    setFailed(false)
    let lastTime = -1
    let stalled = 0
    const fail = (): void => { setFailed(true); setVideoDone(true) }
    void el.play().catch(fail)
    const timer = window.setInterval(() => {
      if (el.ended) return
      stalled = el.currentTime === lastTime ? stalled + 1 : 0
      lastTime = el.currentTime
      if (stalled >= 8) { el.pause(); fail(); window.clearInterval(timer) }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [videoUrl])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const onEnded = (): void => {
      el.pause()
      setVideoDone(true)
    }
    el.addEventListener('ended', onEnded)
    return () => el.removeEventListener('ended', onEnded)
  }, [videoUrl])

  useEffect(() => {
    if (!videoDone) return
    let i = 0
    setTyped('')
    const timer = window.setInterval(() => {
      i += 1
      setTyped(title.slice(0, i))
      if (i >= title.length) window.clearInterval(timer)
    }, 90)
    const failSafe = window.setTimeout(() => {
      window.clearInterval(timer)
      setTyped(title)
    }, 3000)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(failSafe)
    }
  }, [videoDone, title])

  const finish = (): void => {
    if (finishTimer.current !== null) return
    videoRef.current?.pause()
    setLeaving(true)
    finishTimer.current = window.setTimeout(onDone, 420)
  }

  // Keyboard and pointer both dismiss in one step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        finish()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoDone])

  const handleClick = (): void => {
    finish()
  }

  return (
    <div className={`splash ${leaving ? 'leaving' : ''}`} onClick={handleClick}>
      {/* 开屏动画视频：铺满全屏，播完停在最后一帧作为背景 */}
      {videoUrl && (
        <video
          ref={videoRef}
          className="splash-video"
          src={videoUrl}
          autoPlay
          muted
          playsInline
          preload="auto"
          onError={() => { setFailed(true); setVideoDone(true) }}
          style={failed ? { display: 'none' } : undefined}
        />
      )}

      {/* 原进入动画（品牌大字）：视频到最后一帧后缓缓淡入，叠加在视频之上。
          不提供按钮 —— 点击屏幕任意位置即可跳过（见外层 onClick）。 */}
      <div className={`splash-brand ${videoDone ? 'shown' : ''}`}>
        <h1 className="splash-title">
          {typed}
          <span className="splash-caret" />
        </h1>
        <div className="splash-sub">{character?.name ?? '守岸人'}陪伴终端</div>
        <div className="splash-meta">
          {character?.latinName ?? 'SHOREKEEPER'} / {character?.tagline ?? 'COMPANION SYSTEM'}
        </div>
        <div className="splash-hint">点击任意位置进入</div>
      </div>

      <style>{`
        .splash {
          position: absolute;
          inset: 0;
          z-index: 100;
          display: grid;
          place-items: center;
          overflow: hidden;
          background: #000;
          transition: opacity 420ms cubic-bezier(0.22, 1, 0.36, 1), transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
          cursor: pointer;
        }
        .splash.leaving {
          opacity: 0;
          transform: scale(1.03);
          pointer-events: none;
        }
        .splash-video {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          pointer-events: none;
        }
        .splash-brand {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          opacity: 0;
          transform: translateY(10px);
          transition: opacity 900ms cubic-bezier(0.22, 1, 0.36, 1), transform 900ms cubic-bezier(0.22, 1, 0.36, 1);
          padding: 24px 40px;
          border-radius: 20px;
          background: linear-gradient(180deg, rgba(10, 8, 20, 0.35), rgba(10, 8, 20, 0.55));
          backdrop-filter: blur(2px);
        }
        .splash-brand.shown {
          opacity: 1;
          transform: translateY(0);
        }
        .splash-title {
          font-size: 52px;
          font-weight: 200;
          letter-spacing: 0;
          color: #fff;
          text-shadow: 0 2px 30px var(--accent-soft, rgba(244,163,200,0.5));
          min-height: 68px;
          display: flex;
          align-items: center;
          margin: 0;
        }
        .splash-caret {
          display: inline-block;
          width: 2px;
          height: 40px;
          margin-left: 6px;
          background: var(--accent, #f4a3c8);
          animation: blink 1s step-end infinite;
        }
        @keyframes blink {
          50% { opacity: 0; }
        }
        .splash-sub {
          font-size: 15px;
          letter-spacing: 0.24em;
          color: rgba(255,255,255,0.9);
        }
        .splash-meta {
          font-size: 11px;
          letter-spacing: 0.2em;
          color: rgba(255,255,255,0.6);
        }
        .splash-hint {
          margin-top: 26px;
          font-size: 12.5px;
          letter-spacing: 0.22em;
          color: rgba(255,255,255,0.58);
          animation: hint-breathe 2.4s ease-in-out infinite;
        }
        @keyframes hint-breathe {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 0.95; }
        }
      `}</style>
    </div>
  )
}
