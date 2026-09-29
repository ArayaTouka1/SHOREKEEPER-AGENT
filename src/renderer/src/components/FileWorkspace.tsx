import React, { useEffect, useRef, useState } from 'react'
import { ArrowUp, File, FilePlus, Folder, FolderOpen, RefreshCw, Search } from 'lucide-react'
import { useApp } from '../store/AppStore'
import { previewDocument } from './DocumentPreview'
import './workspace.css'

type Entry = { name: string; path: string; type: 'dir' | 'file'; size: number }
type Listing = { path: string; parent: string; entries: Entry[] }

export default function FileWorkspace(): React.ReactElement {
  const { workspace, pickWorkspace, settings } = useApp()
  const [address, setAddress] = useState(workspace)
  const [listing, setListing] = useState<Listing | null>(null)
  const [roots, setRoots] = useState<Array<{ name: string; path: string }>>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Entry[] | null>(null)
  const [newFile, setNewFile] = useState<string | null>(null)
  const sequence = useRef(0)
  const perform = async (action: () => Promise<void>): Promise<void> => {
    setError(''); setBusy(true)
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const browse = async (path: string): Promise<void> => {
    const current = ++sequence.current
    const result = await window.aimis.agent.run({ name: 'fs_list', params: { path: path || '.' } })
    if (current !== sequence.current) return
    if (!result.ok) throw new Error(result.error)
    const data = (result.data as { result: Listing }).result
    setListing(data); setAddress(data.path); setSearchResults(null)
  }
  useEffect(() => {
    void perform(async () => {
      await browse(workspace || '.')
      const result = await window.aimis.agent.roots()
      if (result.ok && result.data) setRoots(result.data)
    })
    return () => { sequence.current++ }
  }, [workspace])
  const entries = (searchResults ?? listing?.entries ?? []).slice().sort((a, b) => a.type !== b.type ? a.type === 'dir' ? -1 : 1 : a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
  return <section className="file-workspace">
    <div className="file-toolbar"><span className="workspace-label" title={workspace}>{workspace}</span><span>{settings?.agent.machinePermission === 'full' ? '完全权限' : settings?.agent.machinePermission === 'workspace' ? '工作区可写' : '只读'}</span>
      <button title="选择工作区" disabled={busy} onClick={() => void pickWorkspace()}><FolderOpen size={18} /></button>
    </div>
    {error && <div role="alert" className="file-error">{error}</div>}
    <>
      <form className="file-toolbar" onSubmit={e => { e.preventDefault(); void perform(() => browse(address)) }}>
        <button type="button" title="上一级目录" disabled={busy || !listing || listing.path === listing.parent} onClick={() => void perform(() => browse(listing!.parent))}><ArrowUp size={18} /></button>
        <input className="file-address" aria-label="目录路径" value={address} onChange={e => setAddress(e.target.value)} />
        <button title="打开目录" disabled={busy}><FolderOpen size={18} /></button>
        <button type="button" title="刷新目录" disabled={busy} onClick={() => void perform(() => browse(listing?.path || address))}><RefreshCw size={18} /></button>
        <button type="button" title="新建文本文件" disabled={busy} onClick={() => setNewFile('')}><FilePlus size={18} /></button>
        <button type="button" className="btn" disabled={busy} onClick={() => void perform(async () => { const r = await window.aimis.agent.pickDocument(); if (r.ok && r.data) previewDocument(r.data) })}>打开文件</button>
      </form>
      <div className="file-toolbar file-locations">{roots.map(root => <button key={root.path} disabled={busy} onClick={() => void perform(() => browse(root.path))}><Folder size={15} />{root.name}</button>)}</div>
      <form className="file-toolbar" onSubmit={e => {
        e.preventDefault(); void perform(async () => {
          if (!query.trim()) { setSearchResults(null); return }
          const result = await window.aimis.agent.run({ name: 'fs_glob', params: { path: listing?.path || address, pattern: /[*?]/.test(query) ? query : `*${query}*` } })
          if (!result.ok) throw new Error(result.error)
          const files = (result.data as { result: { files: Array<{ path: string; size: number }> } }).result.files
          setSearchResults(files.map(f => ({ ...f, type: 'file', name: f.path })))
        })
      }}><input aria-label="搜索文件名" placeholder="搜索文件名或 *.pdf" value={query} onChange={e => setQuery(e.target.value)} /><button title="搜索" disabled={busy}><Search size={18} /></button>{searchResults && <button type="button" onClick={() => setSearchResults(null)}>返回目录</button>}<span>{busy ? '正在读取...' : `${entries.length} 项`}</span></form>
      {newFile !== null && <form className="file-toolbar" onSubmit={e => {
        e.preventDefault(); void perform(async () => {
          if (!newFile.trim()) return
          const path = `${listing?.path || address}/${newFile}`
          const result = await window.aimis.agent.run({ name: 'fs_write', params: { path, content: '', createOnly: true } })
          if (!result.ok) throw new Error(result.error)
          setNewFile(null); await browse(listing?.path || address); previewDocument(path)
        })
      }}><input aria-label="新文件名" placeholder="文件名.txt" value={newFile} onChange={e => setNewFile(e.target.value)} autoFocus /><button disabled={busy}>创建</button><button type="button" onClick={() => setNewFile(null)}>取消</button></form>}
      <div className="file-list" aria-busy={busy}><table><thead><tr><th>名称</th><th>类型</th><th>大小</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.path}><td><button className="file-entry" disabled={busy} title={entry.path} onClick={() => entry.type === 'dir' ? void perform(() => browse(entry.path)) : previewDocument(entry.path)}>{entry.type === 'dir' ? <Folder size={17} /> : <File size={17} />}<span>{entry.name}</span></button></td><td>{entry.type === 'dir' ? '目录' : '文件'}</td><td>{entry.type === 'dir' ? '-' : `${(entry.size / 1024).toFixed(1)} KB`}</td></tr>)}</tbody></table>{!entries.length && <p className="file-notice">{searchResults ? '没有匹配的文件' : '目录为空'}</p>}</div>
    </>
  </section>
}
