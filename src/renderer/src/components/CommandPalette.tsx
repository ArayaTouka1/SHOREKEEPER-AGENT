import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/AppStore'
import type { Route } from '../App'

interface Command {
  id: string
  title: string
  hint: string
  group: string
  run: () => void
}

/**
 */
export default function CommandPalette({
  open,
  onClose,
  onNavigate
}: {
  open: boolean
  onClose: () => void
  onNavigate: (r: Route) => void
}): React.ReactElement | null {
  const { character, characters, switchCharacter, sendMessage, refreshHardware, runTool, memories } = useApp()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      window.setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const nav: Array<{ r: Route; label: string }> = [
      { r: 'home', label: '首页' },
      { r: 'chat', label: '对话' },
      { r: 'memory', label: '记忆' },
      { r: 'task', label: '任务' },
      { r: 'agent', label: '智能体' },
      { r: 'settings', label: '设置' }
    ]

    const list: Command[] = [
      ...nav.map((n) => ({
        id: 'nav_' + n.r,
        title: '前往 ' + n.label,
        hint: '页面导航',
        group: '导航',
        run: () => onNavigate(n.r)
      })),
      {
        id: 'act_hardware',
        title: '读取本机硬件状态',
        hint: 'CPU / 内存 / 显卡 / 硬盘',
        group: '动作',
        run: () => void refreshHardware()
      },
      {
        id: 'act_newchat',
        title: '开一段新对话',
        hint: '清空当前上下文',
        group: '动作',
        run: () => {
          onNavigate('chat')
          window.setTimeout(() => void sendMessage(''), 100)
        }
      },
      {
        id: 'act_memory',
        title: `查看${character?.name ?? '角色'}的记忆库`,
        hint: `${memories.length} 条长期记忆`,
        group: '动作',
        run: () => onNavigate('memory')
      },
      {
        id: 'act_voice',
        title: '调整音色与朗读',
        hint: '音色预设 / 语速 / 自动朗读',
        group: '设置',
        run: () => onNavigate('settings')
      },
      ...characters
        .filter((c) => c.id !== character?.id)
        .map((c) => ({
          id: 'char_' + c.id,
          title: '切换到 ' + c.name,
          hint: c.latinName,
          group: '角色',
          run: () => void switchCharacter(c.id)
        })),
      {
        id: 'act_process',
        title: '看看什么进程在占内存',
        hint: '工具：list_processes',
        group: '动作',
        run: () => void runTool('list_processes', {})
      },
      {
        id: 'act_notepad',
        title: '打开记事本',
        hint: '工具：launch_app',
        group: '动作',
        run: () => void runTool('launch_app', { appName: '记事本' })
      }
    ]
    return list
  }, [characters, character, memories.length, onNavigate, refreshHardware, runTool, switchCharacter, sendMessage])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => (c.title + ' ' + c.hint + ' ' + c.group).toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => {
    setCursor(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => Math.min(filtered.length - 1, c + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(0, c - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = filtered[cursor]
        if (cmd) {
          cmd.run()
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, filtered, cursor, onClose])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="1"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  let lastGroup = ''

  return (
    <div className="cmdk-mask" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-head">
          <span style={{ color: 'var(--accent)', fontSize: 14 }}>⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入命令、角色名或页面…"
            style={{ flex: 1, background: 'none', border: 'none', fontSize: 15 }}
          />
          <span className="cmdk-esc">ESC</span>
        </div>

        <div className="cmdk-list" ref={listRef}>
          {filtered.map((c, i) => {
            const showGroup = c.group !== lastGroup
            lastGroup = c.group
            return (
              <React.Fragment key={c.id}>
                {showGroup && <div className="cmdk-group">{c.group}</div>}
                <button
                  data-active={i === cursor ? '1' : '0'}
                  className={`cmdk-item ${i === cursor ? 'on' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => {
                    c.run()
                    onClose()
                  }}
                >
                  <span className="cmdk-title">{c.title}</span>
                  <span className="cmdk-hint">{c.hint}</span>
                </button>
              </React.Fragment>
            )
          })}
          {filtered.length === 0 && <div className="cmdk-empty">没有匹配的命令</div>}
        </div>
      </div>

      <style>{`
        .cmdk-mask {
          position: absolute; inset: 0; z-index: 200;
          background: var(--shadow-pop);
          backdrop-filter: blur(6px);
          display: flex; justify-content: center;
          padding-top: 12vh;
          animation: cmdkFade 160ms var(--ease);
        }
        @keyframes cmdkFade { from { opacity: 0 } to { opacity: 1 } }
        .cmdk {
          width: min(620px, 88vw);
          max-height: 62vh;
          display: flex; flex-direction: column;
          border-radius: 20px;
          background: var(--glass-strong);
          border: 1px solid var(--accent);
          box-shadow: 0 24px 70px var(--shadow-pop);
          overflow: hidden;
          animation: cmdkPop 200ms var(--ease);
        }
        @keyframes cmdkPop { from { transform: translateY(-12px) scale(0.98); opacity: 0 } to { transform: none; opacity: 1 } }
        .cmdk-head {
          display: flex; align-items: center; gap: 10px;
          padding: 14px 18px;
          border-bottom: 1px solid var(--stroke);
        }
        .cmdk-head input::placeholder { color: var(--text-4); }
        .cmdk-esc {
          font-size: 10px; letter-spacing: 0.08em;
          padding: 3px 7px; border-radius: 6px;
          background: var(--stroke);
          color: var(--text-4);
        }
        .cmdk-list { flex: 1; overflow-y: auto; padding: 8px; }
        .cmdk-group {
          font-size: 10.5px; letter-spacing: 0.1em;
          color: var(--text-4);
          padding: 10px 12px 5px;
        }
        .cmdk-item {
          display: flex; align-items: center; justify-content: space-between;
          gap: 14px; width: 100%;
          padding: 9px 12px; border-radius: 11px;
          text-align: left;
          transition: background 130ms var(--ease);
        }
        .cmdk-item.on {
          background: linear-gradient(135deg, rgba(249,182,212,0.4), rgba(201,168,245,0.32));
        }
        .cmdk-title { font-size: 13.5px; color: var(--text-1); }
        .cmdk-hint { font-size: 11px; color: var(--text-4); flex-shrink: 0; }
        .cmdk-empty { padding: 26px; text-align: center; font-size: 12.5px; color: var(--text-4); }
      `}</style>
    </div>
  )
}
