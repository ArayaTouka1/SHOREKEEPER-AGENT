import React, { useEffect, useState } from 'react'
import { useApp } from '../store/AppStore'
import { useRelationship } from '../hooks/useRelationship'
import Affinity from '../components/Affinity'
import Avatar from '../components/Avatar'
import { Collapsible } from '../components/ui'
import type { Route } from '../App'
import { useSpeech } from '../hooks/useSpeech'

function greetingOf(hour: number): string {
  if (hour < 5) return '凌晨好'
  if (hour < 11) return '早上好'
  if (hour < 13) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export default function HomePage({ onNavigate }: { onNavigate: (r: Route) => void }): React.ReactElement {
  const { character, conversations, sendMessage, hardware, refreshHardware, busy, memories } = useApp()
  const { relationship } = useRelationship()
  const [input, setInput] = useState('')
  const [now, setNow] = useState(() => new Date())
  const { speak } = useSpeech()

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    void refreshHardware()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const name = character?.name ?? '守岸人'
  const greeting = greetingOf(now.getHours())
  const lastConv = conversations[0]

  const submit = async (): Promise<void> => {
    const text = input.trim()
    if (!text) return
    setInput('')
    await sendMessage(text)
    onNavigate('chat')
  }

  const quick = [`${name}，你是怎么诞生的？`, '看下我的电脑状态', '打开网易云音乐']

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-crumb">首页</div>
          <div className="page-title">
            {greeting}，{name}在线
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <ClockWidget busy={busy} />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '28px 40px 36px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* 角色主卡 —— 首页的门面，默认展开 */}
          <Collapsible
            title="角色状态"
            subtitle={character?.name ?? name}
            defaultOpen
            testId="home-hero"
          >
            <div
              style={{
                position: 'relative',
                overflow: 'hidden',
                borderRadius: 'var(--r-card)',
                margin: '0 -20px -18px',
                padding: '36px 30px 30px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                minHeight: 320
              }}
            >
              {character?.avatar.banner && (
                character.avatar.bannerKind === 'video' ? (
                  <video
                    src={character.avatar.banner}
                    muted
                    loop
                    autoPlay
                    playsInline
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      opacity: (character.avatar.bannerOpacity ?? 55) / 100
                    }}
                  />
                ) : (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      backgroundImage: `url(${character.avatar.banner})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center 22%',
                      opacity: (character.avatar.bannerOpacity ?? 55) / 100
                    }}
                  />
                )
              )}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(180deg, transparent 0%, var(--glass) 58%, var(--bg-base) 100%)'
                }}
              />
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => speak(`你好呀，我是${name}。`)}
                  title="点我打个招呼"
                  style={{ borderRadius: '50%', lineHeight: 0 }}
                >
                  <Avatar src={character?.avatar.main} size={96} online ring />
                </button>
                <div style={{ fontSize: 14, letterSpacing: '0.12em', color: 'var(--text-2)', marginTop: 6 }}>
                  {character?.latinName ?? 'SHOREKEEPER'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-3)' }}>
                  <span style={{ color: 'var(--ok)' }}>●</span> 在线
                </div>
                <div style={{ fontSize: 30, fontWeight: 500, marginTop: 10, color: 'var(--text-1)' }}>{greeting}</div><Affinity compact />
                <div style={{ fontSize: 14, color: 'var(--text-2)' }}>{relationship?.greeting ?? character?.greeting ?? '今天想一起做点什么?'}</div>
              </div>
            </div>
          </Collapsible>

          {/* 输入框 */}
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px 12px 18px' }}>
            <button className="btn ghost" style={{ padding: 4, fontSize: 18, lineHeight: 1 }} title="附件">
              +
            </button>
            <input
              className="grow"
              placeholder={`和${name}说点什么...`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
            />
            <button
              className="btn ghost"
              style={{ padding: 6 }}
              title="语音输入（需在设置中开启）"
              onClick={() => onNavigate('settings')}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <rect x="6" y="2" width="4" height="8" rx="2" stroke="currentColor" strokeWidth="1.2" />
                <path d="M3.5 7.5a4.5 4.5 0 009 0M8 12v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
            <button className="btn primary" style={{ width: 36, height: 36, padding: 0, borderRadius: 12 }} onClick={() => void submit()}>
              ↑
            </button>
          </div>

          {/* 当前任务 + 本机状态 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 16 }}>
            <Collapsible
              title="当前任务"
              subtitle={lastConv ? lastConv.title : `${name}陪伴系统初始化`}
              count={conversations.length}
              defaultOpen
              testId="home-current-task"
            >
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
                <button className="btn ghost sm" data-testid="home-task-all" onClick={() => onNavigate('task')}>
                  全部
                </button>
              </div>
              <div style={{ fontSize: 15, marginBottom: 6 }}>
                {lastConv ? lastConv.title : `${name}陪伴系统初始化`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-4)' }}>
                下一步：{lastConv ? `继续「${lastConv.summary || '对话'}」` : '确认首页与对话结构'}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <span className="status-pill" style={{ fontSize: 11 }}>
                  <span className="status-dot" style={{ background: 'var(--accent-2)' }} />
                  记忆 {memories.length} 条
                </span>
                <span className="status-pill" style={{ fontSize: 11 }}>
                  <span className="status-dot" style={{ background: 'var(--accent)' }} />
                  会话 {conversations.length} 个
                </span>
              </div>
            </Collapsible>

            <Collapsible title="本机状态" count={hardware ? '已连接' : '读取中'} defaultOpen testId="home-hardware">
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
                <button className="btn ghost sm" data-testid="home-hardware-refresh" onClick={() => void refreshHardware()}>
                  刷新
                </button>
              </div>
              {hardware ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Meter label="CPU" value={hardware.snapshot.cpu.loadPercent} suffix="%" />
                  <Meter label="内存" value={hardware.snapshot.memory.usedPercent} suffix="%" />
                  {hardware.snapshot.gpu ? (
                    <Meter
                      label="显卡"
                      value={hardware.snapshot.gpu.loadPercent ?? 0}
                      suffix="%"
                      hint={hardware.snapshot.gpu.name}
                    />
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-4)' }}>无独显读数</div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-4)' }}>正在读取……</div>
              )}
            </Collapsible>
          </div>

          {/* 快捷指令卡片已按需求删除 */}
        </div>
      </div>
    </>
  )
}

function Meter({
  label,
  value,
  suffix,
  hint
}: {
  label: string
  value: number
  suffix?: string
  hint?: string
}): React.ReactElement {
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)', marginBottom: 5 }}>
        <span className="truncate" title={hint}>
          {label}
          {hint ? ` · ${hint}` : ''}
        </span>
        <span style={{ color: 'var(--text-1)' }}>
          {value}
          {suffix}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--stroke)', overflow: 'hidden' }}>
        <div
          style={{
            width: `${Math.min(100, Math.max(0, value))}%`,
            height: '100%',
            borderRadius: 3,
            background: 'var(--accent-grad)',
            transition: 'width 600ms var(--ease)'
          }}
        />
      </div>
    </div>
  )
}

function ClockWidget({ busy }: { busy: boolean }): React.ReactElement {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setT(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const pad = (n: number): string => String(n).padStart(2, '0')
  const hh = pad(t.getHours())
  const mm = pad(t.getMinutes())
  const ss = pad(t.getSeconds())
  const date = `${t.getFullYear()}.${pad(t.getMonth() + 1)}.${pad(t.getDate())}`
  const week = ['日', '一', '二', '三', '四', '五', '六'][t.getDay()]

  return (
    <div className="clock-widget" data-testid="clock-widget">
      <div className="clock-time">
        <span className="clock-hh">{hh}</span>
        <span className="clock-colon">:</span>
        <span className="clock-mm">{mm}</span>
        <span className="clock-colon clock-colon-dim">:</span>
        <span className="clock-ss">{ss}</span>
      </div>
      <div className="clock-meta">
        <span>{date}</span>
        <span className="clock-week">周{week}</span>
        <span className={`clock-status ${busy ? 'busy' : ''}`}>
          <span className="status-dot" />
          {busy ? '处理中' : '在线'}
        </span>
      </div>
      <style>{`
        .clock-widget {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 3px;
          padding: 8px 14px;
          border-radius: 14px;
          border: 1px solid var(--stroke);
          background: color-mix(in srgb, var(--glass) 70%, transparent);
          backdrop-filter: blur(10px);
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.02em;
        }
        .clock-time {
          display: flex;
          align-items: baseline;
          font-family: 'Segoe UI', 'Consolas', monospace;
          color: var(--text-1);
          line-height: 1;
        }
        .clock-hh, .clock-mm { font-size: 22px; font-weight: 600; }
        .clock-ss { font-size: 15px; color: var(--text-3); font-weight: 500; }
        .clock-colon {
          font-size: 18px;
          color: var(--accent);
          margin: 0 2px;
          animation: clock-blink 2s var(--ease) infinite;
        }
        .clock-colon-dim { color: var(--text-4); animation-delay: 1s; }
        @keyframes clock-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.25; }
        }
        .clock-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          color: var(--text-4);
        }
        .clock-week { color: var(--accent); }
        .clock-status {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 1px 8px;
          border-radius: 999px;
          border: 1px solid var(--stroke);
          color: var(--ok);
        }
        .clock-status.busy { color: var(--warn); }
      `}</style>
    </div>
  )
}
