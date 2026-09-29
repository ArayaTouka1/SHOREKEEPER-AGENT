import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/AppStore'

/**
 *
 */

type Tab = 'local' | 'upload' | 'web'

interface WebItem {
  url: string
  thumbnail?: string
  title?: string
}

export default function StickerPicker({
  characterId,
  onPick,
  onClose
}: {
  characterId: string
  onPick: (sticker: {
    path: string
    dataUrl: string
    fileUrl?: string
    name: string
    mood: string
  }) => void
  onClose: () => void
}): React.ReactElement {
  const { pushToast } = useApp()
  const [tab, setTab] = useState<Tab>('local')
  const [list, setList] = useState<
    Array<{
      id: string
      dataUrl: string
      fileUrl?: string
      path: string
      file: string
      mood: string
      source: string
    }>
  >([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [moodFilter, setMoodFilter] = useState('')
  const [webItems, setWebItems] = useState<WebItem[]>([])
  const [webBusy, setWebBusy] = useState(false)
  const [webUrl, setWebUrl] = useState('')
  const webFirstRef = useRef(1)
  const [webHasMore, setWebHasMore] = useState(true)
  const seenRef = useRef<Set<string>>(new Set())
  const webLoadingRef = useRef(false)
  const webGridRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const r = await window.aimis.sticker.list(characterId)
      if (r.ok && r.data) setList(r.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId])

  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose()
    }
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDoc), 100)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('mousedown', onDoc)
    }
  }, [onClose])

  const moods = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of list) m.set(s.mood, (m.get(s.mood) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [list])

  const shown = useMemo(() => {
    let out = list
    if (moodFilter) out = out.filter((s) => s.mood === moodFilter)
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase()
      out = out.filter((s) => s.file.toLowerCase().includes(k) || s.mood.toLowerCase().includes(k))
    }
    return out
  }, [list, moodFilter, keyword])

  const doUpload = async (): Promise<void> => {
    const files = await window.aimis.sticker.pickFile()
    if (!files.ok || !files.data?.length) return
    setLoading(true)
    let ok = 0
    try {
      for (const f of files.data) {
        const r = await window.aimis.sticker.add({ characterId, sourcePath: f })
        if (r.ok) ok++
      }
      pushToast({ ok: true, text: `已添加 ${ok} 张表情包` })
      await load()
    } finally {
      setLoading(false)
    }
  }

  const doSearch = async (): Promise<void> => {
    const q = keyword.trim()
    if (!q) {
      pushToast({ ok: false, text: '先输入搜索关键词' })
      return
    }
    setWebBusy(true)
    try {
      const r = await window.aimis.sticker.search({ query: q, limit: 120 })
      if (r.ok && r.data) {
        setWebItems(r.data)
        seenRef.current = new Set(r.data.map((x) => x.url))
        setWebHasMore(false)
        pushToast({ ok: r.data.length > 0, text: `找到 ${r.data.length} 张（来自多个图库）` })
      } else {
        pushToast({ ok: false, text: r.error ?? '搜索失败' })
      }
    } finally {
      setWebBusy(false)
    }
  }

  /**
   */
  const loadMore = async (): Promise<void> => {
    const q = keyword.trim()
    if (!q || webLoadingRef.current || !webHasMore || webBusy) return
    webLoadingRef.current = true
    try {
      const r = await window.aimis.sticker.search({ query: q, limit: 200 })
      if (r.ok && r.data) {
        const fresh = (r.data ?? []).filter((x) => !seenRef.current.has(x.url))
        for (const x of fresh) seenRef.current.add(x.url)
        if (fresh.length === 0) {
          setWebHasMore(false)
        } else {
          setWebItems((prev) => [...prev, ...fresh])
        }
      } else {
        setWebHasMore(false)
      }
    } finally {
      webLoadingRef.current = false
    }
  }

  const doScrape = async (): Promise<void> => {
    if (!webUrl.trim()) {
      pushToast({ ok: false, text: '先填网页地址' })
      return
    }
    setWebBusy(true)
    try {
      const r = await window.aimis.sticker.scrape({ url: webUrl.trim(), limit: 30 })
      if (r.ok && r.data) {
        setWebItems(r.data)
        pushToast({ ok: r.data.length > 0, text: `抓到 ${r.data.length} 张` })
      } else {
        pushToast({ ok: false, text: r.error ?? '抓取失败' })
      }
    } finally {
      setWebBusy(false)
    }
  }

  /**
   */
  const downloadOne = async (item: WebItem): Promise<void> => {
    const r = await window.aimis.sticker.download({
      characterId,
      url: item.url,
      mood: 'custom',
      tags: ['网络搜集']
    })
    if (r.ok && r.data) {
      const s = r.data
      onPick({
        path: s.path,
        dataUrl: s.dataUrl,
        name: s.file ?? s.path,
        mood: s.mood ?? 'custom'
      })
      onClose()
    } else {
      pushToast({ ok: false, text: r.error ?? '发送失败' })
    }
  }

  return (
    <div className="sticker-picker" ref={boxRef} data-testid="sticker-picker">
      {/* 顶部标签 */}
      <div className="sticker-tabs">
        {(
          [
            ['local', '本地'],
            ['upload', '上传'],
            ['web', '网络']
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={`sticker-tab ${tab === k ? 'on' : ''}`}
            data-sticker-tab={k}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
        <button className="sticker-close" onClick={onClose} title="关闭">
          ×
        </button>
      </div>

      {/* 本地 */}
      {tab === 'local' && (
        <>
          <div className="sticker-grid" data-testid="sticker-grid">
            {loading && <div className="sticker-empty">加载中…</div>}
            {!loading && shown.length === 0 && (
              <div className="sticker-empty">
                没有表情包。
                <br />
                切到「上传」加几张，或「网络」搜一点。
              </div>
            )}
            {!loading &&
              shown.map((s) => (
                <button
                  key={s.id}
                  className="sticker-cell"
                  data-sticker-id={s.id}
                  title={s.mood}
                  onClick={() =>
                    onPick({
                      path: s.path,
                      dataUrl: s.dataUrl,
                      fileUrl: s.fileUrl,
                      name: s.file,
                      mood: s.mood
                    })
                  }
                >
                  <img src={s.fileUrl || s.dataUrl} alt={s.mood} loading="lazy" />
                </button>
              ))}
          </div>

          <div className="sticker-foot">
            <span className="field-hint">{list.length} 张 · 点一下直接发出去</span>
            <button className="btn ghost sm" onClick={() => void window.aimis.sticker.openDir()}>
              打开目录
            </button>
          </div>
        </>
      )}

      {/* 上传 */}
      {tab === 'upload' && (
        <div className="sticker-upload">
          <div className="field-hint" style={{ marginBottom: 12 }}>
            从电脑选图加进这个角色的表情包库。支持 jpg / png / webp / gif，可多选。
            <br />
            加进来的图会存到软件目录，随安装包一起保留。
          </div>
          <button className="btn primary" disabled={loading} onClick={() => void doUpload()} data-testid="sticker-upload">
            {loading ? '添加中…' : '选择图片'}
          </button>
          <div className="field-hint" style={{ marginTop: 12 }}>
            也可以直接把图片拖进聊天窗口。
          </div>
        </div>
      )}

      {/* 网络 */}
      {tab === 'web' && (
        <div
          className="sticker-web"
          ref={webGridRef}
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) {
              void loadMore()
            }
          }}
        >
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            <input
              className="input grow"
              placeholder="搜索关键词，比如「守岸人 表情包」"
              value={keyword}
              data-testid="sticker-web-query"
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doSearch()
              }}
            />
            <button className="btn sm" disabled={webBusy} onClick={() => void doSearch()} data-testid="sticker-web-search">
              {webBusy ? '…' : '搜索'}
            </button>
          </div>

          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            <input
              className="input grow"
              placeholder="或粘贴网页地址，抓取页面里的图片"
              value={webUrl}
              onChange={(e) => setWebUrl(e.target.value)}
            />
            <button className="btn sm" disabled={webBusy} onClick={() => void doScrape()}>
              扒图
            </button>
          </div>

          {webItems.length === 0 ? (
            <div className="sticker-empty">
              还没结果。搜一个关键词，或粘贴网页地址。
              <br />
              <span className="field-hint">找到的图点一下就会下载并保存到本地。</span>
            </div>
          ) : (
            <div className="sticker-grid">
              {webItems.map((w) => (
                <button
                  key={w.url}
                  className="sticker-cell"
                  title={w.title ?? w.url}
                  onClick={() => void downloadOne(w)}
                >
                  <img src={w.thumbnail ?? w.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                </button>
              ))}
              {webLoadingRef.current && <div className="sticker-empty">加载更多…</div>}
            </div>
          )}

          <div className="sticker-foot">
            <span className="field-hint">
              {webItems.length > 0
                ? webHasMore
                  ? `已加载 ${webItems.length} 张 · 继续下拉加载更多`
                  : `共 ${webItems.length} 张`
                : '下载后自动存进本地库'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
