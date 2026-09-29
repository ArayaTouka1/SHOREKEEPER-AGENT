import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/AppStore'
import Avatar from '../components/Avatar'
import type { Attachment, ChatMessage, ToolCallRecord, ToolPermissionState } from '../../../shared/types'
import { previewDocument } from '../components/DocumentPreview'
import { useSpeech } from '../hooks/useSpeech'
import ModelSelector from '../components/ModelSelector'
import PersonaSwitcher from '../components/PersonaSwitcher'
import AttachmentPicker, { AttachmentChips } from '../components/AttachmentPicker'
import StickerPicker from '../components/StickerPicker'
import { toLocalUrl } from '../utils/localUrl'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Affinity from '../components/Affinity'
import PermissionBadge from '../components/PermissionBadge'

const STATE_MAP: Record<ToolPermissionState, { label: string; cls: string }> = {
  idle: { label: '待命', cls: '' },
  waiting: { label: '等待授权', cls: 'waiting' },
  running: { label: '正在处理', cls: 'running' },
  done: { label: '已完成', cls: 'done' },
  failed: { label: '执行失败', cls: 'failed' },
  denied: { label: '已拒绝', cls: 'denied' }
}

/**
 *
 */
function sliceByRatio(text: string, ratio: number): string {
  if (!text) return ''
  const r = Math.min(1, Math.max(0, ratio))
  if (r >= 1) return text
  const chars = [...text]
  const n = Math.max(1, Math.round(chars.length * r))
  return chars.slice(0, n).join('')
}

function iconForAtt(att: { kind: string; ext: string }): string {
  const e = (att.ext || '').toLowerCase()
  if (att.kind === 'pdf' || e === '.pdf') return '📄'
  if (att.kind === 'audio' || ['.mp3', '.wav', '.ogg', '.m4a', '.opus'].includes(e)) return '🎵'
  if (att.kind === 'video' || ['.mp4', '.webm', '.mkv', '.mov'].includes(e)) return '🎬'
  if (att.kind === 'image' || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(e)) return '🖼️'
  if (['.md', '.txt', '.json', '.log'].includes(e)) return '📝'
  if (['.zip', '.7z', '.rar', '.tar', '.gz'].includes(e)) return '🗜️'
  if (['.doc', '.docx'].includes(e)) return '📘'
  if (['.xls', '.xlsx', '.csv'].includes(e)) return '📊'
  if (['.ppt', '.pptx'].includes(e)) return '📙'
  if (['.exe', '.msi', '.cmd', '.bat', '.ps1'].includes(e)) return '⚙️'
  if (['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.html', '.css'].includes(e)) return '💻'
  return '📎'
}

function StatusInline({ state }: { state: ToolPermissionState }): React.ReactElement {
  const m = STATE_MAP[state] ?? STATE_MAP.idle
  return (
    <span className={`status-pill ${m.cls}`} style={{ fontSize: 11, padding: '3px 10px' }}>
      <span className="status-dot" />
      {m.label}
    </span>
  )
}

/* ==================================================================
   消息气泡
   ================================================================== */

function Bubble({
  msg,
  characterName,
  avatar,
  onSpeak
}: {
  msg: ChatMessage
  characterName: string
  avatar?: string
  onSpeak: (text: string) => void
}): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const long = msg.text.length > 1600
  const displayed = long && !expanded ? msg.text.slice(0, 1200) + '\n\n...' : msg.text
  const isUser = msg.role === 'user'

  if (msg.role === 'system') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0' }}>
        <div style={{ fontSize: 11, color: 'var(--text-4)', padding: '2px 12px' }}>{msg.text}</div>
      </div>
    )
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(msg.text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
    }
  }

  const pureSticker = !msg.text && !!msg.images?.length
  if (pureSticker) {
    return (
      <div
        className="fade-in"
        style={{
          display: 'flex',
          justifyContent: isUser ? 'flex-end' : 'flex-start',
          gap: 12,
          marginBottom: 20,
          alignItems: 'flex-start'
        }}
      >
        {!isUser && <Avatar src={avatar} size={42} />}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: 'min(680px, 74%)' }}>
          {msg.images!.map((img, i) => {
            const src = toLocalUrl(img.path)
            if (!src) return null
            return (
              <img
                key={i}
                src={src}
                alt=""
                loading="lazy"
                draggable={false}
                style={{
                  maxWidth: 200,
                  maxHeight: 200,
                  borderRadius: 14,
                  objectFit: 'contain'
                }}
              />
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div
      className="fade-in"
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        gap: 12,
        marginBottom: 20,
        alignItems: 'flex-start'
      }}
    >
      {!isUser && <Avatar src={avatar} size={42} />}

      <div style={{ maxWidth: 'min(680px, 74%)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {!isUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
            <span style={{ color: 'var(--accent)', fontSize: 9 }}>◆</span>
            {characterName}
          </div>
        )}

        <div
          style={{
            padding: msg.images?.length && !msg.text ? '6px' : '13px 17px',
            borderRadius: 18,
            borderTopLeftRadius: isUser ? 18 : 6,
            borderTopRightRadius: isUser ? 6 : 18,
            background: isUser ? 'var(--bubble-user)' : 'var(--bubble-char)',
            color: isUser ? '#fff' : 'var(--text-1)',
            border: '1px solid ' + (isUser ? 'transparent' : 'var(--stroke)'),
            boxShadow: isUser ? '0 6px 18px rgba(244,163,200,0.3)' : '0 4px 16px rgba(190,150,190,0.12)',
            fontSize: 14,
            lineHeight: 1.78,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            userSelect: 'text'
          }}
        >
          <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>{alt || '[图片]'}</span>, a: ({ href, children }) => <a href={href} onClick={e => { e.preventDefault(); if (href && /^https?:\/\//.test(href)) void window.aimis.system.openExternal(href) }}>{children}</a> }}>{displayed}</ReactMarkdown></div>
          {long && <button className="btn sm ghost" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? '收起' : '展开全文'}</button>}

          {/* 附带的图片 / 表情包 —— 走 appfile:// 协议读本地文件 */}
          {!!msg.images?.length && (
            <div className="msg-images" data-testid="msg-images">
              {msg.images.map((img, i) => {
                const src = toLocalUrl(img.path)
                if (!src) return null
                return (
                  <img
                    key={i}
                    src={src}
                    alt={img.alt ?? ''}
                    className={img.sticker ? 'msg-sticker' : ''}
                    title={img.sticker ? `表情包 · ${img.mood ?? ''}` : (img.name ?? '')}
                    loading="lazy"
                  />
                )
              })}
            </div>
          )}

          {/* 上传的附件 —— 按类型展示：图片缩略图，其它文件图标+文件名+扩展名 */}
          {!!msg.attachments?.length && (
            <div className="msg-attachments" data-testid="msg-attachments">
              {msg.attachments.map((att, i) =>
                att.kind === 'image' ? (
                  <img
                    key={i}
                    src={toLocalUrl(att.path)}
                    alt={att.name}
                    className="msg-attach-image"
                    title={att.name}
                    loading="lazy"
                  />
                ) : (
                  <button key={i} className="msg-attach-file" title={att.path} onClick={() => previewDocument(att.path)}>
                    <span className="msg-attach-icon">{iconForAtt(att)}</span>
                    <div className="msg-attach-meta">
                      <span className="msg-attach-name truncate">{att.name}</span>
                      <span className="msg-attach-ext">{att.ext || att.kind} · {(att.size / 1024).toFixed(1)} KB</span>
                    </div>
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {!isUser && msg.text && (
          <div style={{ display: 'flex', gap: 4, paddingLeft: 2 }}>
            <button className="msg-action" onClick={() => onSpeak(msg.text)} title="朗读">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 6v4h2.5L9 13V3L5.5 6H3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M11.2 5.6a3 3 0 010 4.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
            <button className="msg-action" onClick={copy} title="复制">
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M10.5 3.5h-6a1 1 0 00-1 1v6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>

      {isUser && (
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 9,
            display: 'grid',
            placeItems: 'center',
            background: 'var(--glass-hover)',
            border: '1px solid var(--stroke)',
            fontSize: 11,
            color: 'var(--text-2)',
            flexShrink: 0,
            marginTop: 2
          }}
        >
          你
        </div>
      )}
    </div>
  )
}

/* ==================================================================
   工具操作卡
   ================================================================== */

function ToolCard({ tool }: { tool: ToolCallRecord }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const done = tool.state === 'done'

  return (
    <div className="card fade-in" style={{ padding: '14px 16px', marginBottom: 12, background: 'var(--bubble-tool)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.04em' }}>工具操作</div>
        <StatusInline state={tool.state} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        {done && <span style={{ color: 'var(--ok)', fontSize: 14 }}>✓</span>}
        <span style={{ fontSize: 15, fontWeight: 500 }}>{tool.actionLabel || tool.displayName}</span>
      </div>
      <div className="mono" style={{ color: 'var(--text-4)', marginTop: 2 }}>
        {tool.name}
      </div>

      {tool.summary && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>{tool.summary}</div>}
      {tool.error && <div style={{ fontSize: 12, color: 'var(--err)', marginTop: 8 }}>{tool.error}</div>}

      {tool.result != null && (
        <>
          <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => setOpen((v) => !v)}>
            {open ? '收起原始返回' : '查看原始返回'}
          </button>
          {open && (
            <pre
              className="mono"
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 12,
                background: 'var(--glass)',
                border: '1px solid var(--stroke)',
                color: 'var(--text-2)',
                maxHeight: 260,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                userSelect: 'text'
              }}
            >
              {JSON.stringify(tool.result, null, 2)}
            </pre>
          )}
        </>
      )}
    </div>
  )
}

/* ==================================================================
   授权卡
   ================================================================== */

function ApprovalCard({
  tool,
  onDecide
}: {
  tool: ToolCallRecord
  onDecide: (approved: boolean) => void
}): React.ReactElement {
  const target = String(tool.params.appName ?? tool.params.path ?? tool.displayName)
  return (
    <div
      className="card fade-in"
      style={{
        padding: '16px 18px',
        marginBottom: 14,
        background: 'var(--glass-strong)',
        border: '1px solid var(--warn)',
        boxShadow: 'var(--shadow-card)'
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--warn)', letterSpacing: '0.04em', marginBottom: 8 }}>需要你的允许</div>
      <div style={{ fontSize: 15, marginBottom: 4 }}>{tool.actionLabel}</div>
      <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 4 }}>
        准备调用：<span style={{ color: 'var(--text-1)' }}>{target}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 14 }}>{tool.description}</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn danger" style={{ flex: 1 }} onClick={() => onDecide(false)}>
          拒绝
        </button>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => onDecide(true)}>
          允许一次
        </button>
      </div>
    </div>
  )
}

/* ==================================================================
   对话页
   ================================================================== */

export default function ChatPage({ active = true }: { active?: boolean } = {}): React.ReactElement {
  const {
    character,
    conversations,
    activeConversationId,
    messages,
    streamingText,
    awaitingText,
    syncText,
    syncRatio,
    busy,
    sendMessage,
    approveTool,
    selectConversation,
    newConversation,
    deleteConversation,
    setAutoSpeak,
    models,
    activeModelId,
    workspace,
    pickWorkspace,
    setSyncRatio,
    greetOnEntry,
    pushToast
  } = useApp()

  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [muted, setMuted] = useState(false)
  const [pendingAtts, setPendingAtts] = useState<Attachment[]>([])
  const [stickerOpen, setStickerOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [goalOpen, setGoalOpen] = useState(true)
  const [goalVisible, setGoalVisible] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { speak, stop, supported, mode, lastError, onProgress } = useSpeech()

  useEffect(() => () => setSyncRatio(1), [setSyncRatio])

  /**
   *
   */
  const greetedRef = useRef(false)
  useEffect(() => {
    if (!active || greetedRef.current) return
    greetedRef.current = true
    let cancelled = false
    void greetOnEntry().then((res) => {
      if (cancelled || !res) return
      if (res.didGreet && res.openingOpus) {
        try {
          const audio = new Audio(res.openingOpus)
          void audio.play().catch(() => {
          })
        } catch {
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [active, greetOnEntry])

  const syncRatioRef = useRef(1)
  useEffect(() => {
    setAutoSpeak((text) => {
      if (muted || mode === 'off' || !autoSpeakOn) return
      speak(text)
    })
    return () => setAutoSpeak(null)
  }, [setAutoSpeak, speak, supported, muted, mode, character?.voice.autoSpeak])

  useEffect(() => {
    onProgress((p) => {
      syncRatioRef.current = p
      setSyncRatio(p)
    })
    return () => onProgress(null)
  }, [onProgress, setSyncRatio])

  /**
   *
   */
  const [showFallback, setShowFallback] = useState(false)
  useEffect(() => {
    if (!syncText) {
      setShowFallback(false)
      return
    }
    const t = window.setTimeout(() => setShowFallback(true), 3000)
    return () => window.clearTimeout(t)
  }, [syncText])

  /**
   *
   */
  const visible = useMemo(() => {
    if (!syncText) return messages
    const lastIdx = messages.map((m) => m.role).lastIndexOf('character')
    if (lastIdx < 0) return messages
    const last = messages[lastIdx]
    if (last.text && (last.text === syncText || syncText.startsWith(last.text) || last.text.startsWith(syncText.slice(0, 4)))) {
      return messages.filter((_, i) => i !== lastIdx)
    }
    return messages
  }, [messages, syncText])

  const pendingTool = useMemo(
    () => messages.find((m) => m.toolCall && m.toolCall.state === 'waiting')?.toolCall ?? null,
    [messages]
  )

  const currentTool = useMemo(() => {
    const tools = messages.filter((m) => m.toolCall).map((m) => m.toolCall as ToolCallRecord)
    return tools.length ? tools[tools.length - 1] : null
  }, [messages])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, streamingText, syncText, syncRatio, awaitingText])

  const submit = async (): Promise<void> => {
    const text = input.trim()
    if ((!text && pendingAtts.length === 0) || busy) return
    stop()
    const atts = pendingAtts
    try {
      await sendMessage(text, atts.map((a) => a.id))
      setInput('')
      setPendingAtts([])
    } catch (error) {
      pushToast({ ok: false, text: error instanceof Error ? error.message : String(error) })
    }
  }

  const sendSticker = async (s: { path: string; dataUrl: string; name: string; mood: string }): Promise<void> => {
    if (busy) return
    stop()
    pushToast({ ok: true, text: '表情包已发送' })
    await sendMessage('', [], {
      path: s.path,
      sticker: true,
      mood: s.mood,
      source: 'user',
      name: s.name,
      alt: s.mood
    })
  }

  const filteredConversations = useMemo(() => {
    if (!search.trim()) return conversations
    const q = search.toLowerCase()
    return conversations.filter((c) => c.title.toLowerCase().includes(q) || c.summary.toLowerCase().includes(q))
  }, [conversations, search])

  const name = character?.name ?? '守岸人'
  const activeTitle = activeConversationId
    ? (conversations.find((c) => c.id === activeConversationId)?.title ?? '新对话')
    : '新对话'

  const autoSpeakOn = character?.voice.autoSpeak ?? true

  return (
    <>
      <div className="page-head" data-speech-mode={mode}>
        <div>
          <div className="page-crumb">对话 / {activeTitle}</div>
          <div className="page-title">和{name}一起完成</div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Affinity compact />
          <PersonaSwitcher />
          <ModelSelector />
          {supported && (
            <button
              className="btn sm"
              title={muted ? '当前静音，点击恢复自动朗读' : autoSpeakOn ? '回复会自动朗读' : '自动朗读已关闭'}
              onClick={() => {
                if (muted) {
                  setMuted(false)
                } else {
                  setMuted(true)
                  stop()
                }
              }}
              style={muted ? { color: 'var(--text-4)' } : { color: 'var(--accent)' }}
            >
              {muted ? '🔇 已静音' : autoSpeakOn ? '🔊 自动朗读' : '🔈 手动朗读'}
            </button>
          )}

          {/* 工作目录 —— 协作生成的文件都存到这里 */}
          <button
            className="btn sm"
            data-testid="workspace-btn"
            title={workspace ? `工作目录：${workspace}` : '点这里选一个工作目录'}
            onClick={async () => {
              const p = await pickWorkspace()
              if (p) pushToast({ ok: true, text: '工作目录已设为 ' + p })
            }}
            style={workspace ? undefined : { color: 'var(--warn)' }}
          >
            📁 {workspace ? workspace.split(/[\\/]/).pop() : '选择工作目录'}
          </button>
        </div>
      </div>

      <div className="page-body">
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {/*
            收起后的圆形模块 —— 固定在对话页右上角。
            点「隐藏」后卡片不会消失，而是收成这个圆形小模块悬浮在右上角。
          */}
          {!goalVisible && (
            <button
              className="goal-fab"
              data-testid="goal-fab"
              title="展开「当前目标」卡片"
              onClick={() => setGoalVisible(true)}
            >
              ◈
            </button>
          )}

          {/* 目标条 —— 可完全隐藏（隐藏后收成右上角圆形模块） */}
          {goalVisible && (
            <div style={{ padding: '16px 32px 0' }}>
              <div className="card card-pad" style={{ padding: '12px 16px' }}>
                <div
                  className="row"
                  style={{ justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
                  data-testid="goal-toggle"
                  onClick={() => setGoalOpen((v) => !v)}
                >
                  <div className="row" style={{ gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-4)' }}>{goalOpen ? '▾' : '▸'}</span>
                    <span className="card-title" style={{ marginBottom: 0, fontSize: 13 }}>
                      当前目标
                    </span>
                    {!goalOpen && (
                      <span className="truncate" style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                        {currentTool ? `当前工具：${currentTool.actionLabel}` : '等待你提出一个请求'}
                      </span>
                    )}
                  </div>
                  <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                    {/* 完全权限按钮已按需求移除 —— 只在输入栏旁保留一个 */}
                    <StatusInline state={currentTool ? currentTool.state : 'idle'} />
                    <button
                      className="btn ghost sm"
                      data-testid="goal-hide"
                      title="收起成右上角圆形模块"
                      onClick={(e) => {
                        e.stopPropagation()
                        setGoalVisible(false)
                      }}
                      style={{ fontSize: 10.5, padding: '2px 8px' }}
                    >
                      隐藏
                    </button>
                  </div>
                </div>

                {goalOpen && (
                  <div style={{ marginTop: 10, fontSize: 15 }} data-testid="goal-body">
                    {currentTool ? `当前工具：${currentTool.actionLabel}` : '等待你提出一个请求'}
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '22px 32px 8px' }}>
            {visible.length === 0 && !streamingText && (
              <div className="empty">
                <div className="empty-glyph">◇</div>
                <div>跟{name}说点什么吧</div>
                <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 4 }}>
                  试试「打开网易云音乐」或「看下我的电脑状态」
                </div>
              </div>
            )}

            {visible.map((m) => {
              if (m.role === 'tool' && m.toolCall) {
                const silent = [
                  'fs_roots', 'fs_list', 'fs_glob', 'fs_read', 'fs_search', 'fs_stat',
                  'search_files', 'web_search', 'web_fetch',
                  'shell_run', 'shell_job', 'job_kill', 'job_output', 'launch_app', 'app_close'
                ]
                if (silent.includes(m.toolCall.name) && m.toolCall.state !== 'failed' && m.toolCall.state !== 'denied' && m.toolCall.state !== 'waiting') return null
                return <ToolCard key={m.id} tool={m.toolCall} />
              }
              return <Bubble key={m.id} msg={m} characterName={name} avatar={character?.avatar.main} onSpeak={speak} />
            })}

            {pendingTool && (
              <div style={{ maxWidth: 640 }}>
                <ApprovalCard tool={pendingTool} onDecide={(ok) => void approveTool(pendingTool.id, ok)} />
              </div>
            )}

            {streamingText && (
              <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'flex-start' }}>
                <Avatar src={character?.avatar.main} size={42} />
                <div style={{ maxWidth: 'min(680px, 74%)' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: 'var(--text-3)',
                      marginBottom: 6
                    }}
                  >
                    <span style={{ color: 'var(--accent)', fontSize: 9 }}>◆</span>
                    {name}
                  </div>
                  <div
                    style={{
                      padding: '13px 17px',
                      borderRadius: 18,
                      borderTopLeftRadius: 6,
                      background: 'var(--bubble-char)',
                      border: '1px solid var(--stroke)',
                      boxShadow: 'var(--shadow-card)',
                      fontSize: 14,
                      lineHeight: 1.78,
                      whiteSpace: 'pre-wrap'
                    }}
                  >
                    {streamingText}
                    <span className="typing-caret" />
                  </div>
                </div>
              </div>
            )}

            {/*
              语音同步显示的回复气泡：
              文字按语音播放进度逐步出现，而不是一次性弹出。
              这样「读到的字」和「听到的声音」是对齐的。
            */}
            {syncText && syncRatio > 0 && (
              <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'flex-start' }}>
                <Avatar src={character?.avatar.main} size={42} />
                <div style={{ maxWidth: 'min(680px, 74%)' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: 'var(--text-3)',
                      marginBottom: 6
                    }}
                  >
                    <span style={{ color: 'var(--accent)', fontSize: 9 }}>◆</span>
                    {name}
                  </div>
                  <div
                    data-testid="sync-bubble"
                    style={{
                      padding: '13px 17px',
                      borderRadius: 18,
                      borderTopLeftRadius: 6,
                      background: 'var(--bubble-char)',
                      border: '1px solid var(--stroke)',
                      boxShadow: 'var(--shadow-card)',
                      fontSize: 14,
                      lineHeight: 1.78,
                      whiteSpace: 'pre-wrap'
                    }}
                  >
                    {sliceByRatio(syncText, syncRatio)}
                    <span className="typing-caret" />
                  </div>
                </div>
              </div>
            )}

            {busy && !streamingText && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
                <Avatar src={character?.avatar.main} size={42} />
                <div
                  style={{
                    padding: '12px 18px',
                    borderRadius: 18,
                    borderTopLeftRadius: 6,
                    background: 'var(--bubble-char)',
                    border: '1px solid var(--stroke)',
                    display: 'flex',
                    gap: 5
                  }}
                >
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              </div>
            )}
          </div>

          {/* 泰提斯审核提示 —— 固定在输入框上方（下方），左右横线居中样式 */}
          {(awaitingText || (syncText && syncRatio === 0)) && (
            <div className="tethys-divider" data-testid="tethys-review">
              <span className="tethys-line" />
              <span className="tethys-icon">🛰️</span>
              <span className="tethys-text">信息由泰提斯系统审核中</span>
              <span className="tethys-dots">
                <span />
                <span />
                <span />
              </span>
              <span className="tethys-icon">🌐</span>
              <span className="tethys-line" />
              {syncText && showFallback && (
                <button
                  className="btn ghost sm"
                  data-testid="tethys-fallback"
                  style={{ marginLeft: 14 }}
                  onClick={() => {
                    stop()
                    setSyncRatio(1)
                  }}
                >
                  仅查看文字
                </button>
              )}
            </div>
          )}

          <div style={{ padding: '12px 32px 22px' }}>
            <AttachmentChips
              items={pendingAtts}
              onRemove={(id) => setPendingAtts((prev) => prev.filter((x) => x.id !== id))}
            />
            <div
              className="card"
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 10,
                padding: '10px 12px 10px 16px',
                background: 'var(--glass-hover)'
              }}
            >
              <AttachmentPicker pending={pendingAtts} onChange={setPendingAtts} />
              <div className="sticker-wrap">
                <button
                  className={`icon-btn ${stickerOpen ? 'on' : ''}`}
                  data-testid="sticker-btn"
                  title="表情包"
                  onClick={() => setStickerOpen((v) => !v)}
                >
                  ☺
                </button>
                {stickerOpen && character && (
                  <StickerPicker
                    characterId={character.id}
                    onClose={() => setStickerOpen(false)}
                    onPick={(s) => {
                      setStickerOpen(false)
                      void sendSticker(s)
                    }}
                  />
                )}
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void submit()
                  }
                }}
                placeholder={`继续和${name}一起处理...`}
                rows={1}
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  resize: 'none',
                  maxHeight: 140,
                  lineHeight: 1.7,
                  paddingTop: 6,
                  userSelect: 'text'
                }}
              />
              <button
                className="btn primary"
                data-testid="chat-send"
                style={{
                  height: 40,
                  padding: '0 18px',
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexShrink: 0
                }}
                onClick={() => void submit()}
                disabled={busy || (!input.trim() && !pendingAtts.length)}
                title={busy ? '正在回复…' : '发送'}
              >
                {busy ? '…' : (
                  <>
                    <span style={{ fontSize: 16, lineHeight: 1 }}>↑</span>发送
                  </>
                )}
              </button>
              <PermissionBadge />
            </div>
          </div>
        </div>

        {/* 会话侧边栏 —— 可收起，收起后只留一条窄条 */}
        {sidebarOpen ? (
          <aside
            style={{
              width: 272,
              flexShrink: 0,
              borderLeft: '1px solid var(--stroke)',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--glass)',
              transition: 'width 200ms var(--ease)'
            }}
          >
            <div style={{ padding: '16px 16px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>会话</span>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn ghost sm" onClick={() => void newConversation()} title="新建对话">
                    ＋
                  </button>
                  <button
                    className="btn ghost sm"
                    data-testid="sidebar-toggle"
                    onClick={() => setSidebarOpen(false)}
                    title="收起侧边栏"
                  >
                    ›
                  </button>
                </div>
              </div>
              <input
                className="input"
                style={{ padding: '7px 12px', fontSize: 12 }}
                placeholder="搜索对话..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-4)', padding: '8px 8px 6px' }}>今天</div>
            {filteredConversations.map((c) => (
              <div
                key={c.id}
                onClick={() => void selectConversation(c.id)}
                className={`conv-item ${c.id === activeConversationId ? 'active' : ''}`}
              >
                <div className="truncate" style={{ fontSize: 13 }}>
                  {c.title || '新对话'}
                </div>
                <div className="truncate" style={{ fontSize: 11, color: 'var(--text-4)' }}>
                  {c.summary || '还没有消息'}
                </div>
                <button
                  className="conv-del"
                  onClick={(e) => {
                    e.stopPropagation()
                    void deleteConversation(c.id)
                  }}
                  title="删除会话"
                >
                  ×
                </button>
              </div>
            ))}
            {filteredConversations.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-4)', padding: 12 }}>没有匹配的会话</div>
            )}
          </div>
        </aside>
        ) : (
          <div
            style={{
              width: 44,
              flexShrink: 0,
              borderLeft: '1px solid var(--stroke)',
              background: 'var(--glass)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              paddingTop: 16,
              gap: 10,
              transition: 'width 200ms var(--ease)'
            }}
          >
            <button
              className="btn ghost sm"
              data-testid="sidebar-toggle"
              onClick={() => setSidebarOpen(true)}
              title="展开会话列表"
            >
              ‹
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-4)', writingMode: 'vertical-rl' }}>会话</span>
          </div>
        )}
      </div>

      <style>{`
        .chat-markdown { white-space: normal; overflow-wrap: anywhere; }
        .chat-markdown > :first-child { margin-top: 0; }
        .chat-markdown > :last-child { margin-bottom: 0; }
        .chat-markdown pre { overflow-x: auto; max-width: 100%; padding: 10px; background: var(--glass); border-radius: 6px; white-space: pre; }
        .chat-markdown table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
        .chat-markdown td, .chat-markdown th { padding: 5px 8px; border: 1px solid var(--stroke); }
        .chat-markdown h1, .chat-markdown h2, .chat-markdown h3 { font-size: 16px; margin: 12px 0 6px; }

        .msg-action {
          width: 26px; height: 26px; border-radius: 8px;
          display: grid; place-items: center;
          color: var(--text-3);
          background: var(--glass);
          border: 1px solid var(--stroke);
          transition: all 200ms var(--ease);
        }
        .msg-action:hover { color: var(--accent); background: var(--glass-hover); }
        .typing-caret {
          display: inline-block; width: 7px; height: 15px; margin-left: 2px;
          background: var(--accent); vertical-align: text-bottom;
          animation: blink2 1s step-end infinite;
        }
        @keyframes blink2 { 50% { opacity: 0; } }
        .dot {
          width: 6px; height: 6px; border-radius: 50%; background: var(--accent);
          animation: bounce 1.3s ease-in-out infinite;
        }
        .dot:nth-child(2) { animation-delay: 0.16s; }
        .dot:nth-child(3) { animation-delay: 0.32s; }
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-5px); opacity: 1; }
        }
        .conv-item {
          position: relative;
          padding: 9px 10px;
          border-radius: 12px;
          cursor: pointer;
          margin-bottom: 2px;
          transition: background 180ms var(--ease);
        }
        .conv-item:hover { background: var(--glass-hover); }
        .conv-item.active {
          background: linear-gradient(135deg, var(--accent-soft), var(--accent-soft));
          box-shadow: inset 0 0 0 1px var(--accent);
        }
        .conv-del {
          position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
          width: 20px; height: 20px; border-radius: 6px;
          display: none; place-items: center;
          color: var(--text-3); font-size: 14px; line-height: 1;
        }
        .conv-item:hover .conv-del { display: grid; }
        .conv-del:hover { background: var(--accent-soft); color: var(--err); }
      `}</style>
    </>
  )
}
