import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../../../../shared/types'
import Avatar from '../../components/Avatar'
import { previewDocument } from '../../components/DocumentPreview'
import { toLocalUrl } from '../../utils/localUrl'

function iconForAttachment(att: { kind: string; ext: string }): string {
  const ext = (att.ext || '').toLowerCase()
  if (att.kind === 'pdf' || ext === '.pdf') return '📄'
  if (att.kind === 'audio' || ['.mp3', '.wav', '.ogg', '.m4a', '.opus'].includes(ext)) return '🎵'
  if (att.kind === 'video' || ['.mp4', '.webm', '.mkv', '.mov'].includes(ext)) return '🎬'
  if (att.kind === 'image' || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return '🖼️'
  if (['.md', '.txt', '.json', '.log'].includes(ext)) return '📝'
  if (['.zip', '.7z', '.rar', '.tar', '.gz'].includes(ext)) return '🗜️'
  if (['.doc', '.docx'].includes(ext)) return '📘'
  if (['.xls', '.xlsx', '.csv'].includes(ext)) return '📊'
  if (['.ppt', '.pptx'].includes(ext)) return '📙'
  if (['.exe', '.msi', '.cmd', '.bat', '.ps1'].includes(ext)) return '⚙️'
  if (['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.html', '.css'].includes(ext)) return '💻'
  return '📎'
}

interface ChatBubbleProps {
  msg: ChatMessage
  characterName: string
  avatar?: string
  onSpeak: (text: string) => void
  showCharacterAvatar: boolean
  showUserAvatar: boolean
  userAvatar?: string
  bubbleStyle: 'resonance' | 'soft' | 'minimal'
}

export default function ChatBubble({ msg, characterName, avatar, onSpeak, showCharacterAvatar, showUserAvatar, userAvatar, bubbleStyle }: ChatBubbleProps): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const long = msg.text.length > 1600
  const displayed = long && !expanded ? `${msg.text.slice(0, 1200)}\n\n...` : msg.text
  const isUser = msg.role === 'user'

  if (msg.role === 'system') return <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0' }}><div style={{ fontSize: 11, color: 'var(--text-4)', padding: '2px 12px' }}>{msg.text}</div></div>

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(msg.text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch { /* clipboard access can be unavailable */ }
  }

  if (!msg.text && msg.images?.length) {
    return <div className={`fade-in chat-message ${isUser ? 'is-user' : 'is-character'} is-sticker style-${bubbleStyle}`} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', gap: 12, marginBottom: 20, alignItems: 'flex-start' }}>
      {!isUser && showCharacterAvatar && <Avatar src={avatar} size={54} />}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: 'min(680px, 74%)' }}>
        {msg.images.map((item, index) => { const src = toLocalUrl(item.path); return src ? <img key={index} src={src} alt="" loading="lazy" draggable={false} style={{ maxWidth: 200, maxHeight: 200, borderRadius: 14, objectFit: 'contain' }} /> : null })}
      </div>
      {isUser && showUserAvatar && <Avatar src={userAvatar} size={54} />}
    </div>
  }

  return <div className={`fade-in chat-message ${isUser ? 'is-user' : 'is-character'} style-${bubbleStyle}`} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', gap: 12, marginBottom: 20, alignItems: 'flex-start' }}>
    {!isUser && showCharacterAvatar && <Avatar src={avatar} size={54} />}
    <div style={{ maxWidth: 'min(680px, 74%)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {!isUser && <div className="chat-speaker-name">{characterName}</div>}
      <div className="chat-message-bubble" style={{ padding: msg.images?.length && !msg.text ? '6px' : '13px 17px', borderRadius: 18, borderTopLeftRadius: isUser ? 18 : 6, borderTopRightRadius: isUser ? 6 : 18, background: isUser ? 'var(--bubble-user)' : 'var(--bubble-char)', color: isUser ? '#fff' : 'var(--text-1)', border: `1px solid ${isUser ? 'transparent' : 'var(--stroke)'}`, boxShadow: isUser ? '0 6px 18px rgba(244,163,200,0.3)' : '0 4px 16px rgba(190,150,190,0.12)', fontSize: 14, lineHeight: 1.78, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' }}>
        <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>{alt || '[图片]'}</span>, a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (href && /^https?:\/\//.test(href)) void window.aimis.system.openExternal(href) }}>{children}</a> }}>{displayed}</ReactMarkdown></div>
        {long && <button className="btn sm ghost" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? '收起' : '展开全文'}</button>}
        {!!msg.images?.length && <div className="msg-images" data-testid="msg-images">{msg.images.map((item, index) => { const src = toLocalUrl(item.path); return src ? <img key={index} src={src} alt={item.alt ?? ''} className={item.sticker ? 'msg-sticker' : ''} loading="lazy" /> : null })}</div>}
        {!!msg.attachments?.length && <div className="msg-attachments" data-testid="msg-attachments">{msg.attachments.map((att, index) => att.kind === 'image'
          ? <img key={index} src={toLocalUrl(att.path)} alt={att.name} className="msg-attach-image" loading="lazy" />
          : <button key={index} className="msg-attach-file" aria-label={att.path} onClick={() => previewDocument(att.path)}><span className="msg-attach-icon">{iconForAttachment(att)}</span><div className="msg-attach-meta"><span className="msg-attach-name truncate">{att.name}</span><span className="msg-attach-ext">{att.ext || att.kind} · {(att.size / 1024).toFixed(1)} KB</span></div></button>)}</div>}
      </div>
      {!isUser && msg.text && <div style={{ display: 'flex', gap: 4, paddingLeft: 2 }}>
        <button className="msg-action" onClick={() => onSpeak(msg.text)} aria-label="朗读"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 6v4h2.5L9 13V3L5.5 6H3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><path d="M11.2 5.6a3 3 0 010 4.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg></button>
        <button className="msg-action" onClick={copy} aria-label="复制">{copied ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg> : <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.2" /><path d="M10.5 3.5h-6a1 1 0 00-1 1v6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>}</button>
      </div>}
    </div>
    {isUser && showUserAvatar && (userAvatar
      ? <Avatar src={userAvatar} size={54} />
      : <div className="chat-user-avatar" style={{ width: 54, height: 54, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--glass-hover)', border: '1px solid var(--stroke)', fontSize: 13, color: 'var(--text-2)', flexShrink: 0, marginTop: 2 }}>你</div>)}
  </div>
}
