import React, { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Minus, Plus, Save, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DocumentData } from '../../../shared/workspace'
import './workspace.css'

export function previewDocument(path: string): void {
  window.dispatchEvent(new CustomEvent('document-preview', { detail: path }))
}

function PdfView({ data }: { data: Uint8Array }): React.ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [pdf, setPdf] = useState<any>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    let task: any
    void (async () => {
      const library = await import('pdfjs-dist')
      library.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      task = library.getDocument({ data: new Uint8Array(data), useSystemFonts: true, isEvalSupported: false })
      const document = await task.promise
      if (!disposed) setPdf(document)
    })().catch(e => { if (!disposed) setError(String(e.message ?? e)) })
    return () => { disposed = true; void task?.destroy() }
  }, [data])
  useEffect(() => {
    if (!pdf) return
    let disposed = false
    let render: any
    void (async () => {
      const p = await pdf.getPage(page)
      if (disposed || !canvas.current) return
      const viewport = p.getViewport({ scale: zoom * 1.3 })
      const target = canvas.current
      target.width = viewport.width
      target.height = viewport.height
      render = p.render({ canvasContext: target.getContext('2d')!, viewport })
      await render.promise
    })().catch(e => { if (!disposed) setError(e.message) })
    return () => { disposed = true; render?.cancel() }
  }, [pdf, page, zoom])
  return <>
    <div className="file-toolbar">
      <button title="上一页" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={18} /></button>
      <span>{page} / {pdf?.numPages ?? '...'}</span>
      <button title="下一页" disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={18} /></button>
      <button title="缩小" disabled={zoom <= .5} onClick={() => setZoom(z => z - .25)}><Minus size={18} /></button>
      <span>{Math.round(zoom * 100)}%</span>
      <button title="放大" disabled={zoom >= 2} onClick={() => setZoom(z => z + .25)}><Plus size={18} /></button>
    </div>
    {error && <div role="alert" className="file-error">{error}</div>}
    <div className="pdf-canvas"><canvas ref={canvas} /></div>
  </>
}

function OfficeView({ doc }: { doc: DocumentData }): React.ReactElement {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!ready || !frame.current?.contentDocument) return
    let disposed = false
    let preview: { destroy(): void } | undefined
    const container = frame.current.contentDocument.body
    void (async () => {
      let bytes = new Uint8Array(doc.bytes!).buffer
      if (doc.kind === 'docx') {
        const { renderAsync } = await import('docx-preview')
        if (!disposed) await renderAsync(bytes, container, undefined, { inWrapper: true, breakPages: true, useBase64URL: true })
      } else {
        // Some exporters leave dangling part declarations; normalize only the in-memory copy.
        const JSZip = (await import('jszip')).default
        const zip = await JSZip.loadAsync(bytes)
        const types = zip.file('[Content_Types].xml')
        if (types) {
          const xml = new DOMParser().parseFromString(await types.async('text'), 'application/xml')
          let changed = false
          for (const node of Array.from(xml.getElementsByTagName('Override'))) {
            const part = node.getAttribute('PartName')?.replace(/^\//, '')
            if (part && !zip.file(part)) { node.remove(); changed = true }
          }
          if (changed) { zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(xml)); bytes = await zip.generateAsync({ type: 'arraybuffer' }) }
        }
        const { init } = await import('pptx-preview')
        if (disposed) return
        const renderer = init(container, { width: Math.max(320, frame.current!.clientWidth - 32), mode: 'list' })
        preview = renderer
        await renderer.preview(bytes)
        if (!renderer.slideCount) throw new Error('未能渲染幻灯片，请使用外部应用打开此文件')
      }
    })().catch(e => { if (!disposed) setError(String(e.message ?? e)) })
    return () => { disposed = true; preview?.destroy(); container.replaceChildren() }
  }, [ready, doc])
  return <>{error && <div className="file-error" role="alert">{error}</div>}
    <iframe className="office-frame" ref={frame} title={doc.name} sandbox="allow-same-origin" onLoad={() => setReady(true)} srcDoc={'<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; font-src data: blob:; style-src \'unsafe-inline\'"><style>body{margin:0;background:#eceef0;font-family:Arial,sans-serif}*{box-sizing:border-box}a{pointer-events:none}</style></head><body></body></html>'} />
  </>
}

function SheetView({ doc }: { doc: DocumentData }): React.ReactElement {
  const [index, setIndex] = useState(0)
  const sheet = doc.sheets?.[index]
  const [query, setQuery] = useState('')
  const rows = sheet?.rows.map((row, i) => ({ row, i })).filter(({ row }) => !query || row.some(c => c.toLowerCase().includes(query.toLowerCase()))) ?? []
  return <>
    <div className="file-toolbar"><select aria-label="工作表" value={index} onChange={e => setIndex(Number(e.target.value))}>{doc.sheets?.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select><input placeholder="筛选单元格" value={query} onChange={e => setQuery(e.target.value)} /><span>{sheet?.rows.length ?? 0} 行</span></div>
    {sheet?.truncated && <div className="file-notice">当前显示前 2000 行、100 列</div>}
    <div className="sheet-scroll"><table className="sheet-table"><tbody>{rows.map(({ row, i }) => <tr key={i}><th>{i + 1}</th>{row.map((cell, col) => <td key={col}>{cell}</td>)}</tr>)}</tbody></table>{!rows.length && <p>没有数据</p>}</div>
  </>
}

export default function DocumentPreview(): React.ReactElement | null {
  const [path, setPath] = useState('')
  const [doc, setDoc] = useState<DocumentData | null>(null)
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const dirty = !!doc && draft !== (doc.text ?? '')
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  useEffect(() => {
    const onOpen = (event: Event): void => {
      if (dirtyRef.current && !window.confirm('放弃未保存的修改？')) return
      setPath((event as CustomEvent<string>).detail)
    }
    window.addEventListener('document-preview', onOpen)
    return () => window.removeEventListener('document-preview', onOpen)
  }, [])
  useEffect(() => {
    if (!path) return
    let active = true
    setDoc(null); setError(''); setMode('preview')
    void window.aimis.agent.openDocument(path).then(result => {
      if (!active) return
      if (!result.ok || !result.data) setError(result.error || '无法读取文档')
      else { setDoc(result.data); setDraft(result.data.text ?? '') }
    }).catch(e => { if (active) setError(String(e)) })
    return () => { active = false }
  }, [path])
  if (!path) return null
  const close = (): void => { if (!busy && (!dirty || window.confirm('放弃未保存的修改？'))) { setPath(''); setDoc(null) } }
  const save = async (): Promise<void> => {
    if (!doc) return
    setBusy(true); setError('')
    try {
      const result = await window.aimis.agent.run({ name: 'fs_write', params: { path: doc.path, content: draft, expectedVersion: doc.version } })
      if (!result.ok) throw new Error(result.error)
      const next = await window.aimis.agent.openDocument(doc.path)
      if (!next.ok || !next.data) throw new Error(next.error)
      setDoc(next.data); setDraft(next.data.text ?? '')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <div className="document-backdrop" onKeyDown={e => { if (e.key === 'Escape') close() }}>
    <section role="dialog" aria-modal="true" aria-label="文档预览" className="document-window">
      <header className="file-toolbar"><strong title={path}>{doc?.name ?? path}</strong>
        {doc?.text !== undefined && <div className="file-segments"><button aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>预览</button><button aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>编辑</button></div>}
        {mode === 'edit' && <button title="保存" disabled={busy || !dirty} onClick={() => void save()}><Save size={18} /></button>}
        <button title="使用外部应用打开" onClick={() => void window.aimis.attachment.open(path)}><ExternalLink size={18} /></button>
        <button title="关闭" disabled={busy} autoFocus onClick={close}><X size={20} /></button>
      </header>
      <div className="document-path">{doc?.path ?? path}{dirty ? ' · 未保存' : ''}</div>
      {error && <div role="alert" className="file-error">{error}</div>}
      <div className="document-body">
        {!doc && !error && <p>正在读取文档...</p>}
        {doc && mode === 'edit' && <textarea aria-label="文件内容" className="document-editor" value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} spellCheck={false} />}
        {doc && mode === 'preview' && <>
          {doc.kind === 'pdf' && <PdfView data={doc.bytes!} />}
          {(doc.kind === 'docx' || doc.kind === 'slides') && <OfficeView key={doc.path} doc={doc} />}
          {doc.kind === 'sheet' && <SheetView key={doc.path} doc={doc} />}
          {doc.kind === 'markdown' && <article className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>[图片：{alt}]</span>, a: ({ children, href }) => <a href={href} onClick={e => { e.preventDefault(); if (href && /^https?:\/\//.test(href)) void window.aimis.system.openExternal(href) }}>{children}</a> }}>{doc.text}</ReactMarkdown></article>}
          {doc.kind === 'text' && <pre className="text-preview">{doc.text}</pre>}
          {doc.kind === 'unsupported' && <p className="file-notice">此格式暂不支持内嵌预览，请使用外部应用打开。旧版 Office 文件可另存为 DOCX、PPTX 或 XLSX。</p>}
        </>}
      </div>
    </section>
  </div>
}
