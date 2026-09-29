import React, { useEffect, useMemo, useRef } from 'react'
import { useApp } from '../store/AppStore'
import { hexToRgba } from '../hooks/useTheme'
import { toLocalUrl } from '../utils/localUrl'

/**
 *
 */
export default function BackgroundLayer(): React.ReactElement | null {
  const { theme } = useApp()
  const videoRef = useRef<HTMLVideoElement>(null)

  const bg = theme ? theme.background : null

  const url = useMemo(() => {
    if (!bg || !bg.mediaPath) return ''
    return toLocalUrl(bg.mediaPath)
  }, [bg?.mediaPath])

  useEffect(() => {
    const el = videoRef.current
    if (!el || !bg || bg.mediaKind !== 'video') return
    el.playbackRate = Math.min(4, Math.max(0.1, bg.playbackRate))
    el.loop = bg.loop
    void el.play().catch(() => {
    })
  }, [bg?.playbackRate, bg?.loop, bg?.mediaKind, url])

  if (!bg || !bg.enabled || !url || !bg.mediaKind) return null

  const filter = bg.blur > 0 ? `blur(${bg.blur}px)` : undefined
  const mediaOpacity = Math.min(1, Math.max(0, (bg.opacity ?? 100) / 100))

  return (
    <div className="bg-layer" data-bg-layer aria-hidden>
      {bg.mediaKind === 'image' ? (
        <img className="bg-media" data-bg-media src={url} alt="" style={{ objectFit: bg.fit, filter, opacity: mediaOpacity }} draggable={false} />
      ) : (
        <video
          ref={videoRef}
          className="bg-media"
          data-bg-media
          src={url}
          style={{ objectFit: bg.fit, filter, opacity: mediaOpacity }}
          autoPlay
          loop={bg.loop}
          muted
          playsInline
        />
      )}

      <div
        className="bg-overlay"
        data-bg-overlay
        style={{ background: hexToRgba(bg.overlayColor, Math.min(100, Math.max(0, bg.overlay)) / 100) }}
      />

      <style>{`
        .bg-layer {
          position: absolute;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          pointer-events: none;
        }
        .bg-media {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
        }
        .bg-overlay {
          position: absolute;
          inset: 0;
        }
      `}</style>
    </div>
  )
}
