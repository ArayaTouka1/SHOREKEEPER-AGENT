import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/AppStore'
import { previewDocument } from './DocumentPreview'
import { FileText } from 'lucide-react'
import type { Attachment } from '../../../shared/types'

/**
 */
export default function AttachmentPicker({
  pending,
  onChange
}: {
  pending: Attachment[]
  onChange: (next: Attachment[]) => void
}): React.ReactElement {
  const { attachments, pickAttachments, removeAttachment } = useApp()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const doPick = async (): Promise<void> => {
    const picked = await pickAttachments()
    if (picked.length) {
      const ids = new Set(pending.map((a) => a.id))
      onChange([...pending, ...picked.filter((a) => !ids.has(a.id))])
    }
    setOpen(false)
  }

  const addExisting = (a: Attachment): void => {
    if (pending.some((x) => x.id === a.id)) return
    onChange([...pending, a])
    setOpen(false)
  }

  const iconOf = (k: Attachment['kind']): string =>
    k === 'image' ? '▣' : k === 'text' ? '▤' : k === 'pdf' ? '▥' : k === 'audio' ? '♪' : k === 'video' ? '▷' : '◇'

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        className="btn ghost"
        data-testid="attach-btn"
        style={{ padding: 6, fontSize: 18, lineHeight: 1 }}
        title="上传附件"
        onClick={() => setOpen((v) => !v)}
      >
        +
      </button>

      {open && (
        <div className="att-pop" data-testid="attach-popover">
          <button className="att-action" data-testid="attach-pick" onClick={() => void doPick()}>
            <span style={{ fontSize: 15 }}>＋</span>
            <div>
              <div style={{ fontSize: 13 }}>选择文件…</div>
              <div style={{ fontSize: 11, color: 'var(--text-4)' }}>图片 / 文本 / PDF / 音频 / 视频</div>
            </div>
          </button>

          {attachments.length > 0 && (
            <>
              <div className="att-group">最近上传（{attachments.length}）</div>
              <div className="att-list">
                {attachments.slice(0, 12).map((a) => (
                  <div key={a.id} className="att-row">
                    <button className="att-row-main" onClick={() => addExisting(a)} title="添加到本轮对话">
                      <span style={{ fontSize: 13, color: 'var(--accent)' }}><FileText size={16} /></span>
                      <span className="truncate" style={{ fontSize: 12, flex: 1, textAlign: 'left' }}>
                        {a.name}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{(a.size / 1024).toFixed(0)}KB</span>
                    </button>
                    <button
                      className="btn ghost sm danger"
                      style={{ padding: '2px 7px' }}
                      title="从列表删除"
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeAttachment(a.id)
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <style>{`
        .att-pop {
          position: absolute;
          bottom: calc(100% + 8px);
          left: 0;
          width: 320px;
          max-height: 50vh;
          overflow-y: auto;
          z-index: 90;
          padding: 8px;
          border-radius: 16px;
          background: var(--glass-strong);
          border: 1px solid var(--stroke-strong);
          backdrop-filter: blur(26px) saturate(1.2);
          box-shadow: var(--shadow-pop);
          animation: fadeIn 160ms var(--ease);
        }
        .att-action {
          display: flex; align-items: center; gap: 10px;
          width: 100%; padding: 10px; border-radius: 11px;
          transition: background 140ms var(--ease);
          text-align: left;
        }
        .att-action:hover { background: var(--glass-hover); }
        .att-group {
          font-size: 10.5px; letter-spacing: 0.1em; color: var(--text-4);
          padding: 10px 10px 5px;
        }
        .att-list { display: flex; flex-direction: column; gap: 2px; }
        .att-row { display: flex; align-items: center; gap: 2px; }
        .att-row-main {
          display: flex; align-items: center; gap: 8px;
          flex: 1; min-width: 0;
          padding: 7px 9px; border-radius: 9px;
          transition: background 140ms var(--ease);
        }
        .att-row-main:hover { background: var(--glass-hover); }
      `}</style>
    </div>
  )
}

export function AttachmentChips({
  items,
  onRemove
}: {
  items: Attachment[]
  onRemove: (id: string) => void
}): React.ReactElement | null {
  if (!items.length) return null

  const iconOf = (k: Attachment['kind']): string =>
    k === 'image' ? '▣' : k === 'text' ? '▤' : k === 'pdf' ? '▥' : k === 'audio' ? '♪' : k === 'video' ? '▷' : '◇'

  return (
    <div className="chips-row" data-testid="attachment-chips">
      {items.map((a) => (
        <div key={a.id} className="chip">
          {a.kind === 'image' ? (
            <img src={a.url} alt="" className="chip-thumb" />
          ) : (
            <span style={{ fontSize: 12, color: 'var(--accent)' }}>{iconOf(a.kind)}</span>
          )}
          <button onClick={() => previewDocument(a.path)} title={a.path} style={{ minWidth: 0, textAlign: 'left' }}>
            <span className="truncate" style={{ display: 'block', fontSize: 12, maxWidth: 200 }}>{a.name}</span>
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{a.name.split('.').pop() || a.kind} · {(a.size / 1024).toFixed(1)} KB</span>
          </button>
          <button className="chip-x" onClick={() => onRemove(a.id)} title="移除">
            ×
          </button>
        </div>
      ))}

      <style>{`
        .chips-row {
          display: flex; flex-wrap: wrap; gap: 6px;
          padding: 0 4px 8px;
        }
        .chip {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 8px 4px 6px;
          border-radius: 8px;
          background: var(--glass);
          border: 1px solid var(--stroke);
          max-width: 280px;
        }
        .chip-thumb {
          width: 20px; height: 20px; border-radius: 6px; object-fit: cover;
        }
        .chip-x {
          width: 16px; height: 16px; border-radius: 50%;
          display: grid; place-items: center;
          font-size: 12px; line-height: 1;
          color: var(--text-3);
        }
        .chip-x:hover { background: var(--accent-soft); color: var(--err); }
      `}</style>
    </div>
  )
}
