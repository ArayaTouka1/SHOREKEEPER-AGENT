import React, { useEffect, useMemo, useState } from 'react'
import SplashSection from './SplashSection'
import { useApp } from '../../store/AppStore'
import { EmptyHint, Field, SectionHeader, SliderField, SwitchRow } from '../../components/ui'

/* ==================================================================
   背景媒体 —— 图片 / 视频作为界面背景
   ================================================================== */

export default function BackgroundSection(): React.ReactElement {
  const { theme, backgrounds, refreshBackgrounds, patchBackground, resetBackground } = useApp()
  const [flash, setFlash] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void refreshBackgrounds()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const bg = theme ? theme.background : null
  const current = useMemo(() => {
    if (!bg || !bg.mediaId) return null
    return backgrounds.find((m) => m.id === bg.mediaId) ?? null
  }, [bg, backgrounds])

  if (!bg) return <></>

  const useMedia = async (m: { id: string; path: string; kind: 'image' | 'video' }): Promise<void> => {
    await patchBackground({ mediaId: m.id, mediaPath: m.path, mediaKind: m.kind, enabled: true })
  }

  const doImport = async (mode: 'copy' | 'external'): Promise<void> => {
    setBusy(true)
    setFlash('')
    try {
      const res = await window.aimis.background.importFile(mode)
      if (!res.ok) {
        setFlash('导入失败：' + res.error)
        return
      }
      if (!res.data) return
      await refreshBackgrounds()
      await useMedia(res.data.media)
      setFlash(`已设为背景：${res.data.media.name}`)
      window.setTimeout(() => setFlash(''), 2500)
    } finally {
      setBusy(false)
    }
  }

  const pickOne = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.aimis.background.pickFile()
      if (!res.ok || !res.data) return
      const ext = await window.aimis.background.external(String(res.data))
      if (!ext.ok || !ext.data) {
        setFlash('不支持的文件格式')
        return
      }
      await useMedia(ext.data)
      await refreshBackgrounds()
      setFlash('已设为背景（未复制到素材库）')
      window.setTimeout(() => setFlash(''), 2500)
    } finally {
      setBusy(false)
    }
  }

  const sizeText = (n: number): string => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB')

  return (
    <>
      <SplashSection />
      <SectionHeader
        title="背景媒体"
        desc="用图片或视频作为界面背景，属于主题的一部分。上面会自动叠一层遮罩保证文字可读，遮罩浓度可以调。"
      />

      {/* 开关与参数 */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <SwitchRow
          title="启用背景媒体"
          desc="关闭后回到纯色主题背景"
          on={bg.enabled}
          onChange={(v) => void patchBackground({ enabled: v })}
        />

        {current && (
          <div className="row" style={{ gap: 12, padding: '14px 0', borderBottom: '1px solid var(--stroke)' }}>
            <div
              style={{
                width: 96,
                height: 56,
                borderRadius: 10,
                overflow: 'hidden',
                flexShrink: 0,
                border: '1px solid var(--stroke)',
                background: 'var(--glass)'
              }}
            >
              {current.kind === 'image' ? (
                <img src={current.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <video src={current.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
            </div>
            <div className="grow">
              <div style={{ fontSize: 13 }}>{current.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
                {current.kind === 'image' ? '图片' : '视频'} · {sizeText(current.size)}
              </div>
            </div>
            <button className="btn sm" onClick={() => void resetBackground()}>
              清除
            </button>
          </div>
        )}

        <SliderField
          style={{ marginTop: 16 }}
          label={`遮罩浓度 · ${bg.overlay}%（越高文字越清楚）`}
          value={bg.overlay}
          min={0}
          max={95}
          step={1}
          onChange={(v) => void patchBackground({ overlay: v })}
        />

        <SliderField
          label={`媒体透明度 · ${bg.opacity ?? 100}%（100=完全显示，0=看不见）`}
          value={bg.opacity ?? 100}
          min={0}
          max={100}
          step={1}
          onChange={(v) => void patchBackground({ opacity: v })}
        />

        <SliderField
          label={`模糊 · ${bg.blur}px`}
          value={bg.blur}
          min={0}
          max={30}
          step={1}
          onChange={(v) => void patchBackground({ blur: v })}
        />

        <Field label="遮罩颜色">
          <div className="row" style={{ gap: 10 }}>
            <input
              type="color"
              data-bg-overlay-color
              value={bg.overlayColor}
              onChange={(e) => void patchBackground({ overlayColor: e.target.value })}
            />
            <input
              className="input"
              style={{ maxWidth: 140 }}
              value={bg.overlayColor}
              onChange={(e) => void patchBackground({ overlayColor: e.target.value })}
            />
          </div>
        </Field>

        <Field label="填充方式">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {(
              [
                { k: 'cover', label: '铺满（裁剪）' },
                { k: 'contain', label: '完整显示' },
                { k: 'fill', label: '拉伸' }
              ] as const
            ).map((f) => (
              <button
                key={f.k}
                data-bg-fit={f.k}
                className="btn sm"
                style={
                  bg.fit === f.k
                    ? { background: 'var(--accent-grad)', color: '#fff', borderColor: 'transparent' }
                    : undefined
                }
                onClick={() => void patchBackground({ fit: f.k })}
              >
                {f.label}
              </button>
            ))}
          </div>
        </Field>

        {current && current.kind === 'video' && (
          <>
            <SliderField
              label={`视频速率 · ${bg.playbackRate.toFixed(2)}×`}
              value={bg.playbackRate}
              min={0.25}
              max={2}
              step={0.05}
              onChange={(v) => void patchBackground({ playbackRate: v })}
            />
            <SwitchRow
              title="循环播放"
              desc="视频静音循环，不干扰语音"
              on={bg.loop}
              onChange={(v) => void patchBackground({ loop: v })}
            />
          </>
        )}

        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          <button className="btn primary" disabled={busy} onClick={() => void doImport('copy')}>
            ＋ 导入背景到素材库
          </button>
          <button className="btn" disabled={busy} onClick={() => void pickOne()}>
            选择文件（不复制）
          </button>
          {flash && <span style={{ fontSize: 12, color: 'var(--ok)' }}>{flash}</span>}
        </div>
      </div>

      {/* 素材库 */}
      <div className="card card-pad">
        <div className="card-title">背景素材库（{backgrounds.length}）</div>
        {backgrounds.length === 0 ? (
          <EmptyHint>还没有素材。支持 png / jpg / webp / gif 图片，以及 mp4 / webm / mov 视频。</EmptyHint>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {backgrounds.map((m) => {
              const on = bg.mediaId === m.id
              return (
                <div key={m.id} style={{ position: 'relative' }}>
                  <button
                    data-bg-id={m.id}
                    className={`pick-card ${on ? 'on' : ''}`}
                    style={{ width: '100%', padding: 8 }}
                    onClick={() => void useMedia(m)}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: 72,
                        borderRadius: 8,
                        overflow: 'hidden',
                        marginBottom: 6,
                        background: 'var(--glass)'
                      }}
                    >
                      {m.kind === 'image' ? (
                        <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <video src={m.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )}
                    </div>
                    <div className="truncate" style={{ fontSize: 12, textAlign: 'left' }}>
                      {m.name}
                    </div>
                    <div className="pick-desc" style={{ textAlign: 'left' }}>
                      {m.kind === 'image' ? '图片' : '视频'} · {sizeText(m.size)}
                    </div>
                  </button>
                  <button
                    className="btn ghost sm danger"
                    style={{ position: 'absolute', top: 2, right: 2 }}
                    title="删除"
                    onClick={async () => {
                      await window.aimis.background.remove(m.id)
                      await refreshBackgrounds()
                      if (bg.mediaId === m.id) await patchBackground({ mediaId: '', mediaPath: '', mediaKind: '' })
                    }}
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
