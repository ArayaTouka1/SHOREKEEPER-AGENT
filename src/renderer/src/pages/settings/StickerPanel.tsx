import React, { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../store/AppStore'
import { SwitchRow, SliderField } from '../../components/ui'

/**
 *
 */

interface StickerItem {
  id: string
  file: string
  dataUrl: string
  mood: string
  source: string
  size?: number
}

export default function StickerPanel(): React.ReactElement {
  const { characters, pushToast, settings, saveSettings } = useApp()
  const [activeId, setActiveId] = useState('')
  const [list, setList] = useState<StickerItem[]>([])
  const [stats, setStats] = useState<Array<{ characterId: string; count: number; local: number; user: number }>>([])
  const [busy, setBusy] = useState(false)
  const [webOpen, setWebOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pageUrl, setPageUrl] = useState('')
  const [webItems, setWebItems] = useState<Array<{ url: string; thumbnail?: string }>>([])
  const [filter, setFilter] = useState('')

  const char = useMemo(() => characters.find((c) => c.id === activeId) ?? characters[0], [characters, activeId])

  useEffect(() => {
    if (!activeId && characters.length) setActiveId(characters[0].id)
  }, [characters, activeId])

  const load = async (): Promise<void> => {
    if (!char) return
    setBusy(true)
    try {
      const [l, s] = await Promise.all([window.aimis.sticker.list(char.id), window.aimis.sticker.stats()])
      if (l.ok && l.data) setList(l.data)
      if (s.ok && s.data) setStats(s.data)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char?.id])

  const moods = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of list) m.set(s.mood, (m.get(s.mood) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [list])

  const shown = useMemo(() => (filter ? list.filter((s) => s.mood === filter) : list), [list, filter])

  const upload = async (): Promise<void> => {
    if (!char) return
    const files = await window.aimis.sticker.pickFile()
    if (!files.ok || !files.data?.length) return
    setBusy(true)
    let ok = 0
    try {
      for (const f of files.data) {
        const r = await window.aimis.sticker.add({ characterId: char.id, sourcePath: f })
        if (r.ok) ok++
      }
      pushToast({ ok: true, text: `已添加 ${ok} 张` })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!char) return
    const r = await window.aimis.sticker.remove({ characterId: char.id, stickerId: id })
    if (r.ok && r.data) {
      pushToast({ ok: true, text: '已删除' })
      await load()
    } else {
      pushToast({ ok: false, text: '内置表情包不可删除' })
    }
  }

  const doSearch = async (): Promise<void> => {
    if (!query.trim()) {
      pushToast({ ok: false, text: '先输入关键词' })
      return
    }
    setBusy(true)
    try {
      const r = await window.aimis.sticker.search({ query: query.trim(), limit: 24 })
      if (r.ok && r.data) {
        setWebItems(r.data)
        pushToast({ ok: r.data.length > 0, text: `找到 ${r.data.length} 张` })
      } else pushToast({ ok: false, text: r.error ?? '搜索失败' })
    } finally {
      setBusy(false)
    }
  }

  const doScrape = async (): Promise<void> => {
    if (!pageUrl.trim()) {
      pushToast({ ok: false, text: '先填网页地址' })
      return
    }
    setBusy(true)
    try {
      const r = await window.aimis.sticker.scrape({ url: pageUrl.trim(), limit: 30 })
      if (r.ok && r.data) {
        setWebItems(r.data)
        pushToast({ ok: r.data.length > 0, text: `抓到 ${r.data.length} 张` })
      } else pushToast({ ok: false, text: r.error ?? '抓取失败' })
    } finally {
      setBusy(false)
    }
  }

  const downloadOne = async (url: string): Promise<void> => {
    if (!char) return
    const r = await window.aimis.sticker.download({ characterId: char.id, url, tags: ['网络搜集'] })
    if (r.ok) {
      pushToast({ ok: true, text: '已保存到本地' })
      await load()
    } else pushToast({ ok: false, text: r.error ?? '下载失败' })
  }

  const countOf = (id: string): number => stats.find((s) => s.characterId === id)?.count ?? 0

  const sc = settings?.sticker
  const patchSticker = async (p: Partial<typeof sc>): Promise<void> => {
    if (!sc) return
    await saveSettings({ sticker: { ...sc, ...p } as never })
  }

  return (
    <>
      {/* 角色选择 + 概览 */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-title">表情包库</div>
        <div className="field-hint" style={{ marginBottom: 14 }}>
          角色会在聊天里主动发表情包，也会对用户发的图做出反应。
          <br />
          内置表情包随安装包分发；用户添加的和网络搜集的会存到软件目录。
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {characters.map((c) => (
            <button
              key={c.id}
              className={`pick-card ${char?.id === c.id ? 'on' : ''}`}
              style={{ minWidth: 150 }}
              data-sticker-char={c.id}
              onClick={() => setActiveId(c.id)}
            >
              <div style={{ fontSize: 12.5 }}>{c.name}</div>
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={busy} onClick={() => void upload()} data-testid="sticker-upload-btn">
            {busy ? '处理中…' : '添加表情包'}
          </button>
          <button className="btn" disabled={busy} onClick={() => void window.aimis.sticker.openDir()}>
            打开目录
          </button>
          {sc?.searchEnabled && (
            <button className="btn" onClick={() => setWebOpen((v) => !v)} data-testid="sticker-web-toggle">
              {webOpen ? '收起网络搜集' : '从网络搜集'}
            </button>
          )}
          <span className="field-hint" style={{ alignSelf: 'center' }}>
            {char?.name}
          </span>
        </div>

        {/* ---- 表情包来源与开关 ---- */}
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--stroke)' }}>
          <div className="card-title" style={{ fontSize: 13 }}>
            来源设置
          </div>

          <SwitchRow
            title="启用表情包搜索"
            desc="关闭后隐藏所有搜索入口，只保留本地已有的表情包"
            on={!!sc?.searchEnabled}
            onChange={(v) => void patchSticker({ searchEnabled: v })}
          />

          <SwitchRow
            title="让角色自己上网抓表情包"
            desc="开启后角色会在需要时自动从下面的来源站抓图，你不用手动搜索和保存"
            on={!!sc?.autoFetch}
            onChange={(v) => void patchSticker({ autoFetch: v })}
          />

          {sc?.searchEnabled && (
            <>
              <div className="field" style={{ marginTop: 12 }}>
                <span className="field-label">来源网站</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {sc.sources.map((s) => {
                    const on = sc.activeSourceId === s.id
                    return (
                      <button
                        key={s.id}
                        data-sticker-source={s.id}
                        className="btn sm"
                        style={
                          on ? { background: 'var(--accent-grad)', color: '#fff', borderColor: 'transparent' } : undefined
                        }
                        onClick={() => void patchSticker({ activeSourceId: s.id })}
                      >
                        {s.label}
                        {on ? ' · 使用中' : ''}
                      </button>
                    )
                  })}
                  <button
                    className="btn sm"
                    data-testid="sticker-source-add"
                    onClick={async () => {
                      const url = window.prompt(
                        '填一个图片搜索地址，用 {q} 代表关键词。\n例如：https://example.com/search?q={q}'
                      )
                      if (!url) return
                      const label = window.prompt('给它起个名字') || '自定义来源'
                      await patchSticker({
                        sources: [
                          ...sc.sources,
                          { id: 'src_' + Date.now(), label, searchUrl: url, enabled: true, builtin: false }
                        ],
                        activeSourceId: 'src_' + Date.now()
                      })
                    }}
                  >
                    ＋ 自定义来源
                  </button>
                </div>
                <div className="field-hint">
                  角色会从这个站抓图。自定义来源用 {'{q}'} 占位关键词。
                </div>
              </div>

              {sc.autoFetch && (
                <SliderField
                  label={`每次最多抓 ${sc.maxPerFetch} 张`}
                  value={sc.maxPerFetch}
                  min={1}
                  max={10}
                  step={1}
                  onChange={(v) => void patchSticker({ maxPerFetch: v })}
                />
              )}
            </>
          )}
        </div>

        {/* 网络搜集 */}
        {webOpen && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--stroke)' }}>
            <div className="row" style={{ gap: 8, marginBottom: 10 }}>
              <input
                className="input grow"
                placeholder="搜索关键词"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doSearch()
                }}
              />
              <button className="btn sm" disabled={busy} onClick={() => void doSearch()}>
                搜索
              </button>
            </div>
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <input
                className="input grow"
                placeholder="或粘贴网页地址，抓取页面里的图片"
                value={pageUrl}
                onChange={(e) => setPageUrl(e.target.value)}
              />
              <button className="btn sm" disabled={busy} onClick={() => void doScrape()}>
                扒图
              </button>
            </div>

            {webItems.length > 0 && (
              <>
                <div className="field-hint" style={{ marginBottom: 8 }}>
                  点图下载并保存到 {char?.name} 的表情包库
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
                    gap: 8,
                    maxHeight: 260,
                    overflowY: 'auto'
                  }}
                >
                  {webItems.map((w) => (
                    <button
                      key={w.url}
                      className="sticker-cell"
                      title={w.url}
                      onClick={() => void downloadOne(w.url)}
                    >
                      <img src={w.thumbnail ?? w.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 表情包列表 */}
      <div className="card card-pad">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            {char?.name} 的表情包
          </div>
          <select className="input" style={{ width: 150, height: 30 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">全部情绪（{list.length}）</option>
            {moods.map(([m, n]) => (
              <option key={m} value={m}>
                {m}（{n}）
              </option>
            ))}
          </select>
        </div>

        {shown.length === 0 ? (
          <div className="field-hint">还没有表情包。点上面「添加表情包」或从网络搜集。</div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
              gap: 10,
              maxHeight: 420,
              overflowY: 'auto',
              paddingRight: 4
            }}
          >
            {shown.map((s) => (
              <div key={s.id} className="sticker-cell" style={{ position: 'relative' }} title={`${s.mood} · ${s.source}`}>
                <img src={s.dataUrl} alt={s.mood} loading="lazy" />
                {s.source !== 'local' && (
                  <button
                    title="删除"
                    onClick={() => void remove(s.id)}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 20,
                      height: 20,
                      borderRadius: 7,
                      border: 'none',
                      background: 'rgba(0,0,0,0.55)',
                      color: '#fff',
                      fontSize: 13,
                      lineHeight: 1,
                      cursor: 'pointer'
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
