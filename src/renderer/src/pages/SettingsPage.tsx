import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/AppStore'
import Avatar from '../components/Avatar'
import { Collapsible, EmptyHint, Field, SectionHeader, SliderField, SwitchRow } from '../components/ui'
import CharacterSection from './settings/CharacterSection'
import VoiceSection from './settings/VoiceSection'
import BackgroundSection from './settings/BackgroundSection'
import ModelSection from './settings/ModelSection'
import PluginSection from './settings/PluginSection'
import StickerPanel from './settings/StickerPanel'
import RunningAppsPanel from '../components/RunningAppsPanel'
import type { ThemeTokens } from '../../../shared/types'

type Section =
  | 'character'
  | 'voice'
  | 'theme'
  | 'model'
  | 'general'
  | 'ai'
  | 'chat'
  | 'coop'
  | 'memory'
  | 'tools'
  | 'sticker'
  | 'plugin'

const SECTIONS: Array<{ key: Section; label: string; icon: string }> = [
  { key: 'character', label: '角色与羁绊', icon: '◍' },
  { key: 'voice', label: '语音', icon: '♪' },
  { key: 'sticker', label: '表情包', icon: '☺' },
  { key: 'theme', label: '主题', icon: '◐' },
  { key: 'general', label: '常规', icon: '⚙' },
  { key: 'model', label: '模型与 API', icon: '◈' },
  { key: 'chat', label: '对话', icon: '◈' },
  { key: 'coop', label: '协作', icon: '⚡' },
  { key: 'memory', label: '记忆', icon: '❀' },
  { key: 'tools', label: '工具与权限', icon: '⚒' },
  { key: 'plugin', label: '插件', icon: '❐' },
]

type LlmDraft = {
  provider: 'openai-compatible' | 'offline'
  baseUrl: string
  apiKey: string
  model: string
  visionModel: string
  temperature: number
  maxTokens: number
  systemExtra: string
}

export default function SettingsPage(): React.ReactElement {
  const [section, setSection] = useState<Section>('character')

  return (
    <div className="page-body" style={{ minHeight: 0 }}>
      <aside
        style={{
          width: 218,
          flexShrink: 0,
          borderRight: '1px solid var(--stroke)',
          padding: '20px 12px',
          overflowY: 'auto',
          background: 'var(--glass)'
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-4)', padding: '0 10px 12px' }}>
          COMPANION OS
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            data-section={s.key}
            data-label={s.label}
            className={`set-item ${section === s.key ? 'active' : ''}`}
            onClick={() => setSection(s.key)}
          >
            <span className="set-icon">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </aside>

      {/* 外层纵向 flex：滚动内容 + 底部固定版权条（不随内容滚走） */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '26px 36px 20px' }}>
          <div style={{ maxWidth: 820 }}>
            {/* 角色与人格整合在一页：上面选角色/人格，下面编辑人格正文 */}
            {section === 'character' && (
              <>
                <CharacterSection />
              </>
            )}
            {section === 'voice' && <VoiceSection />}
            {section === 'sticker' && <StickerPanel />}
            {section === 'theme' && <ThemeSection />}
            {section === 'general' && <GeneralSection />}
            {/* 「模型」与「AI 与 API」已整合为一页：AI 与 API 卡片在上，模型清单在下 */}
            {section === 'model' && (
              <>
                <AiSection />
                <ModelSection />
              </>
            )}
            {section === 'chat' && <ChatSection />}
            {section === 'coop' && <CoopSection />}
            {section === 'memory' && <MemorySection />}
            {section === 'tools' && <ToolsSection />}
            {section === 'plugin' && <PluginSection />}
          </div>
        </div>

        {/* 版权声明 —— 固定在设置页正下方，永远可见，不用下滑 */}
        <div className="settings-notice" data-testid="settings-notice">
          守岸人是《鸣潮》的角色，版权归库洛游戏所有。本项目为非官方同人作品，与库洛游戏无关，
          亦未获其认可，不产生任何盈利，禁止任何倒卖行为。
        </div>
      </div>

      <style>{`
        .settings-notice {
          margin: 0 36px 14px;
          padding: 10px 16px;
          border-radius: 12px;
          border: 1px solid var(--stroke);
          background: var(--glass);
          color: var(--text-4);
          font-size: 11.5px;
          line-height: 1.8;
          text-align: center;
          flex-shrink: 0;
        }
        .set-item {
          display: flex; align-items: center; gap: 9px;
          width: 100%; text-align: left;
          padding: 9px 12px; border-radius: 12px;
          font-size: 13px; color: var(--text-2);
          transition: all 180ms var(--ease);
          margin-bottom: 2px;
        }
        .set-item:hover { background: var(--glass-hover); color: var(--text-1); }
        .set-item.active {
          background: var(--accent-grad);
          color: #fff;
          box-shadow: var(--glow);
        }
        .set-icon { font-size: 12px; opacity: 0.9; width: 15px; text-align: center; }
        .sec-title { font-size: 22px; font-weight: 600; margin-bottom: 6px; }
        .sec-desc { font-size: 12.5px; color: var(--text-3); margin-bottom: 22px; }
        .pick-card {
          text-align: left; padding: 12px 14px; border-radius: 14px;
          border: 1px solid var(--stroke);
          background: var(--glass);
          transition: all 200ms var(--ease);
        }
        .pick-card:hover { border-color: var(--accent); transform: translateY(-1px); }
        .pick-card.on {
          background: var(--accent-grad); color: #fff; border-color: transparent;
          box-shadow: var(--glow);
        }
        .pick-card.on .pick-desc { color: rgba(255,255,255,0.82); }
        .pick-desc { font-size: 11px; color: var(--text-4); line-height: 1.5; }
      `}</style>
    </div>
  )
}

/* ==================================================================
   主题 —— 多主题 + 自定义
   ================================================================== */

const TOKEN_FIELDS: Array<{ key: keyof ThemeTokens; label: string }> = [
  { key: 'bgBase', label: '背景主色' },
  { key: 'bgGradA', label: '背景渐变 A' },
  { key: 'bgGradB', label: '背景渐变 B' },
  { key: 'bgGradC', label: '背景渐变 C' },
  { key: 'accent', label: '主色' },
  { key: 'accent2', label: '副色' },
  { key: 'accentGradFrom', label: '主渐变 起' },
  { key: 'accentGradMid', label: '主渐变 中' },
  { key: 'accentGradTo', label: '主渐变 止' },
  { key: 'text1', label: '文字 主' },
  { key: 'text2', label: '文字 次' },
  { key: 'text3', label: '文字 弱' },
  { key: 'text4', label: '文字 最弱' },
  { key: 'bubbleUserFrom', label: '用户气泡 起' },
  { key: 'bubbleUserTo', label: '用户气泡 止' },
  { key: 'bubbleChar', label: '角色气泡底色' }
]

function ThemeSection(): React.ReactElement {
  const {
    theme,
    themePresets,
    activeTokens,
    setTheme,
    patchCustomTheme,
    saveCustomTheme,
    deleteSavedTheme,
    forkThemePreset,
    resetCustomTheme
  } = useApp()
  const [saveName, setSaveName] = useState('')
  const [flash, setFlash] = useState('')

  if (!theme) return <></>

  const isCustomActive = theme.activeId === 'custom'
  const editingTokens = isCustomActive ? theme.customTokens : activeTokens

  const applyPatch = async (key: keyof ThemeTokens, value: string): Promise<void> => {
    const coerced = key === 'uiOpacity' ? (Number(value) as unknown as string) : value
    if (!isCustomActive) {
      await forkThemePreset(theme.activeId)
      window.setTimeout(() => void patchCustomTheme({ [key]: coerced } as Partial<ThemeTokens>), 80)
      return
    }
    await patchCustomTheme({ [key]: coerced } as Partial<ThemeTokens>)
  }

  const activeName = isCustomActive
    ? '自定义（编辑中）'
    : ((themePresets.find((p) => p.id === theme.activeId) || theme.saved.find((p) => p.id === theme.activeId))?.name ??
      '未知')

  return (
    <>
      <SectionHeader
        title="主题"
        desc={
          <>
            共 {themePresets.length} 个内置主题。当前：<b style={{ color: 'var(--accent)' }}>{activeName}</b>
          </>
        }
      />

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-title">内置主题</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {themePresets.map((p) => {
            const on = theme.activeId === p.id
            return (
              <button
                key={p.id}
                data-theme-id={p.id}
                className={`pick-card ${on ? 'on' : ''}`}
                onClick={() => void setTheme(p.id)}
              >
                <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      flexShrink: 0,
                      background: `linear-gradient(135deg, ${p.tokens.accentGradFrom}, ${p.tokens.accentGradMid}, ${p.tokens.accentGradTo})`,
                      border: '1px solid rgba(255,255,255,0.4)'
                    }}
                  />
                  <div className="grow">
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                    <div className="pick-desc">{p.desc}</div>
                  </div>
                  {on && <span style={{ fontSize: 11 }}>✓</span>}
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {[p.tokens.bgBase, p.tokens.bgGradB, p.tokens.accent, p.tokens.text1].map((c, i) => (
                    <span
                      key={i}
                      style={{ width: 16, height: 16, borderRadius: 5, background: c, border: '1px solid rgba(0,0,0,0.08)' }}
                    />
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            自定义主题{isCustomActive ? ' · 正在生效' : ''}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {!isCustomActive && (
              <button className="btn sm" onClick={() => void forkThemePreset(theme.activeId)}>
                以当前主题为起点
              </button>
            )}
            <button className="btn sm" onClick={() => void resetCustomTheme()}>
              重置为默认
            </button>
          </div>
        </div>

        {!isCustomActive && (
          <div className="field-hint" style={{ marginBottom: 14 }}>
            改任意一个颜色都会自动切到自定义模式，并从当前主题复制一份作为起点。
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))', gap: 12 }}>
          {TOKEN_FIELDS.map((f) => {
            const raw = editingTokens ? String(editingTokens[f.key] ?? '') : ''
            const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)
            return (
              <div key={f.key} className="row" style={{ gap: 10 }}>
                {isHex ? (
                  <input
                    type="color"
                    data-token={f.key}
                    value={raw}
                    onChange={(e) => void applyPatch(f.key, e.target.value)}
                  />
                ) : (
                  <span
                    style={{
                      width: 46,
                      height: 30,
                      borderRadius: 8,
                      flexShrink: 0,
                      background: raw || 'transparent',
                      border: '1px solid var(--stroke)'
                    }}
                  />
                )}
                <div className="grow">
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{f.label}</div>
                  <input
                    className="input"
                    style={{ padding: '5px 9px', fontSize: 11 }}
                    value={raw}
                    onChange={(e) => void applyPatch(f.key, e.target.value)}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {/* 全局界面透明度：作用到所有玻璃/卡片底色的 alpha */}
        <div style={{ marginTop: 16, borderTop: '1px solid var(--stroke)', paddingTop: 14 }}>
          <SliderField
            label={`界面透明度 · ${editingTokens?.uiOpacity ?? 100}%（100=默认，越低越透明）`}
            value={editingTokens?.uiOpacity ?? 100}
            min={20}
            max={100}
            step={1}
            onChange={(v) => void applyPatch('uiOpacity', String(v))}
          />
          <div className="field-hint">统一调节所有 UI（卡片、侧边栏、弹窗、气泡底色）的透明度，立即生效。</div>
        </div>

        <div className="row" style={{ marginTop: 16, gap: 10, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ maxWidth: 220 }}
            placeholder="给这套主题起个名字"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
          />
          <button
            className="btn primary"
            disabled={!saveName.trim()}
            onClick={async () => {
              const n = saveName.trim()
              await saveCustomTheme(n, '自定义主题')
              setFlash('已保存：' + n)
              setSaveName('')
              window.setTimeout(() => setFlash(''), 2000)
            }}
          >
            保存为主题
          </button>
          <button
            className="btn"
            onClick={() => {
              const css = Object.entries(theme.customTokens)
                .map(([k, val]) => '  --' + k + ': ' + String(val) + ';')
                .join('\n')
              void navigator.clipboard.writeText(':root {\n' + css + '\n}')
              setFlash('CSS 变量已复制')
              window.setTimeout(() => setFlash(''), 2000)
            }}
          >
            复制为 CSS
          </button>
          {flash && <span style={{ fontSize: 12, color: 'var(--ok)' }}>{flash}</span>}
        </div>
      </div>

      {theme.saved.length > 0 && (
        <div className="card card-pad">
          <div className="card-title">我保存的主题（{theme.saved.length}）</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {theme.saved.map((p) => (
              <div key={p.id} className="row" style={{ gap: 6 }}>
                <button
                  data-saved-theme={p.id}
                  className={`pick-card ${theme.activeId === p.id ? 'on' : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => void setTheme(p.id)}
                >
                  <div className="row" style={{ gap: 8 }}>
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        background: `linear-gradient(135deg, ${p.tokens.accentGradFrom}, ${p.tokens.accentGradTo})`
                      }}
                    />
                    <span style={{ fontSize: 13 }}>{p.name}</span>
                  </div>
                </button>
                <button className="btn ghost sm danger" onClick={() => void deleteSavedTheme(p.id)} title="删除">
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 背景媒体 —— 已整合进主题页 */}
      <div style={{ height: 8 }} />
      <BackgroundSection />
    </>
  )
}

/* ==================================================================
   常规
   ================================================================== */

function GeneralSection(): React.ReactElement {
  const { settings, saveSettings, character, workspace, pickWorkspace, refreshWorkspace } = useApp()
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    void refreshWorkspace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!settings) return <></>
  const g = settings.general
  const a = settings.agent

  return (
    <>
      <SectionHeader title="常规" desc="启动行为、窗口行为与 Agent 工作区" />

      {/* 关闭行为 */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-title">点关闭按钮时</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {(
            [
              { k: 'ask', label: '每次询问', desc: '弹框让你选最小化还是退出' },
              { k: 'minimize', label: '最小化到托盘', desc: '留在右下角角标' },
              { k: 'quit', label: '直接退出', desc: '关掉进程' }
            ] as const
          ).map((o) => (
            <button
              key={o.k}
              data-close-action={o.k}
              className="btn sm"
              style={
                g.closeAction === o.k
                  ? { background: 'var(--accent-grad)', color: '#fff', borderColor: 'transparent' }
                  : undefined
              }
              onClick={() => void saveSettings({ general: { ...g, closeAction: o.k } })}
            >
              {o.label}
            </button>
          ))}
        </div>
        <SwitchRow
          title="不再显示关闭确认"
          desc="勾选后直接按上面的选择执行，不再弹框"
          on={g.closeAskDisabled}
          onChange={(v) => void saveSettings({ general: { ...g, closeAskDisabled: v } })}
        />
        <div className="field-hint" style={{ marginTop: 8 }}>
          最小化后可以从右下角托盘图标（角标）右键唤出菜单，随时切页面或退出。
        </div>
      </div>

      {/* 启动行为 */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-title">启动</div>
        <SwitchRow
          title="启动时跳过开场动画"
          desc="下次打开直接进入首页"
          on={g.skipSplash}
          onChange={(v) => void saveSettings({ general: { ...g, skipSplash: v } })}
        />
        <SwitchRow
          title="最小化到系统托盘"
          desc="关闭窗口时保留后台进程"
          on={g.minimizeToTray}
          onChange={(v) => void saveSettings({ general: { ...g, minimizeToTray: v } })}
        />
        <SwitchRow
          title="开机自启"
          desc="登录 Windows 后自动运行（打包版本生效）"
          on={g.launchOnStartup}
          onChange={(v) => void saveSettings({ general: { ...g, launchOnStartup: v } })}
        />
      </div>

      {/* Agent 能力 */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-title">Agent 能力</div>
        <SwitchRow
          title="启用 Agent 工具集"
          desc="文件读写、执行命令、联网搜索、后台任务等（对齐 DSH 工具面）"
          on={a.enabled}
          onChange={(v) => void saveSettings({ agent: { ...a, enabled: v } })}
        />
        <SwitchRow
          title="允许执行命令"
          desc="shell_run / shell_job，每次执行仍需授权"
          on={a.allowShell}
          onChange={(v) => void saveSettings({ agent: { ...a, allowShell: v } })}
        />
        <SwitchRow
          title="允许联网"
          desc="web_search / web_fetch"
          on={a.allowWeb}
          onChange={(v) => void saveSettings({ agent: { ...a, allowWeb: v } })}
        />
        <SwitchRow
          title="允许写文件"
          desc="fs_write / fs_append / fs_edit / fs_delete / fs_move / fs_copy，每次操作仍需授权"
          on={a.allowWrite}
          onChange={(v) => void saveSettings({ agent: { ...a, allowWrite: v } })}
        />

        <div className="field" style={{ marginTop: 16 }}>
          <span className="field-label">工作区目录</span>
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow" value={workspace} readOnly title={workspace} />
            <button
              className="btn sm"
              disabled={picking}
              onClick={async () => {
                setPicking(true)
                try {
                  await pickWorkspace()
                } finally {
                  setPicking(false)
                }
              }}
            >
              选择
            </button>
          </div>
          <div className="field-hint">
            Agent 的文件读写、命令执行都限制在这个目录内，越界会被拒绝。
          </div>
        </div>

        <SliderField
          label={`单轮最大工具调用次数 · ${a.maxToolCalls}`}
          value={a.maxToolCalls}
          min={1}
          max={20}
          step={1}
          onChange={(v) => void saveSettings({ agent: { ...a, maxToolCalls: v } })}
        />
      </div>

      <div className="card card-pad">
        <div className="field-hint">
          外观请在「主题」分页调整。当前角色：{character?.name ?? '-'}
        </div>
      </div>
    </>
  )
}

/* ==================================================================
   AI 与 API —— 引擎切换真正生效
   ================================================================== */

function AiSection(): React.ReactElement {
  const { settings, saveSettings } = useApp()
  const [testing, setTesting] = useState<null | { ok: boolean; msg: string }>(null)
  const [draft, setDraft] = useState<LlmDraft | null>(null)
  const [keyMsg, setKeyMsg] = useState('')
  const lastSavedKey = useRef('')

  const llm = settings ? settings.llm : null
  useEffect(() => {
    if (llm && !draft) {
      setDraft(llm)
      lastSavedKey.current = llm.apiKey
    }
  }, [llm, draft])

  useEffect(() => {
    if (!llm) return
    if (llm.apiKey === lastSavedKey.current) return
    lastSavedKey.current = llm.apiKey
    setDraft((prev) => (prev ? { ...prev, apiKey: llm.apiKey } : prev))
  }, [llm])

  if (!settings || !llm) return <></>
  const d = draft ?? llm

  const patch = (p: Partial<LlmDraft>): void => setDraft({ ...d, ...p })

  const commit = async (next?: LlmDraft): Promise<void> => {
    const target = next ?? d
    await saveSettings({ llm: target })
    lastSavedKey.current = target.apiKey
  }

  const saveKey = async (): Promise<void> => {
    const next: LlmDraft = { ...d, apiKey: d.apiKey.trim() }
    setDraft(next)
    await commit(next)
    setKeyMsg('已保存 ✓')
    window.setTimeout(() => setKeyMsg(''), 2000)
  }

  const clearKey = async (): Promise<void> => {
    const next: LlmDraft = { ...d, apiKey: '' }
    setDraft(next)
    await commit(next)
    setKeyMsg('已清空密钥')
    window.setTimeout(() => setKeyMsg(''), 2000)
  }

  const switchEngine = async (provider: 'offline' | 'openai-compatible'): Promise<void> => {
    const next: LlmDraft = { ...d, provider }
    setDraft(next)
    await commit(next)
    setTesting(
      provider === 'offline'
        ? { ok: true, msg: '已切换到网络接口，填好 API Key 后生效' }
        : { ok: true, msg: '已切换到本地引擎，立即生效' }
    )
  }

  const test = async (): Promise<void> => {
    setTesting(null)
    await commit()
    if (!d.apiKey.trim()) {
      setTesting({ ok: false, msg: '还没填 API Key —— 当前会继续使用离线引擎' })
      return
    }
    try {
      const res = await fetch(d.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + d.apiKey },
        body: JSON.stringify({ model: d.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8 })
      })
      if (res.ok) setTesting({ ok: true, msg: '连通正常，已接入真实模型' })
      else setTesting({ ok: false, msg: '返回 ' + res.status + '：' + (await res.text()).slice(0, 160) })
    } catch (err) {
      setTesting({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    }
  }

  const effective =
    llm.provider === 'offline'
      ? '网络接口'
      : llm.apiKey.trim()
        ? '本地引擎 · ' + llm.model
        : '本地引擎（未填 Key，实际走离线引擎）'

  return (
    <>
      <SectionHeader title="AI 与 API" desc={<>当前实际生效：<b style={{ color: 'var(--accent)' }}>{effective}</b></>} />

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-title">引擎</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
          <button
            data-provider="openai-compatible"
            className={`pick-card ${llm.provider === 'openai-compatible' ? 'on' : ''}`}
            onClick={() => void switchEngine('openai-compatible')}
          >
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>网络接口</div>
            <div className="pick-desc">填 Base URL + API Key 接入真实模型，支持流式输出。</div>
          </button>
          <button
            data-provider="offline"
            className={`pick-card ${llm.provider === 'offline' ? 'on' : ''}`}
            onClick={() => void switchEngine('offline')}
          >
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>本地</div>
            <div className="pick-desc">零配置、零联网。内置意图分类与角色口吻模板，工具调用完全可用。</div>
          </button>
        </div>

        {/* 「网络接口」才填 API 字段；「本地」引擎零配置，不显示这些 */}
        {llm.provider === 'openai-compatible' && (
          <>
            <div className="field">
              <span className="field-label">Base URL</span>
              <input
                className="input"
                value={d.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                onBlur={() => void commit()}
              />
            </div>
            <div className="field">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="field-label" style={{ marginBottom: 0 }}>
                  API Key
                </span>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 9px',
                    borderRadius: 999,
                    border: '1px solid var(--stroke)',
                    color: d.apiKey.trim() ? 'var(--ok)' : 'var(--warn)'
                  }}
                >
                  {d.apiKey.trim() ? '已填写' : '未填写'}
                </span>
              </div>
              <input
                className="input"
                data-testid="api-key"
                type="password"
                placeholder="sk-...（新用户需自行填写）"
                value={d.apiKey}
                onChange={(e) => patch({ apiKey: e.target.value })}
                onBlur={() => void commit()}
              />
              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn sm" data-testid="save-api-key" onClick={() => void saveKey()}>
                  保存密钥
                </button>
                {d.apiKey.trim() !== '' && (
                  <button
                    className="btn sm danger"
                    data-testid="clear-api-key"
                    onClick={() => void clearKey()}
                    title="清空密钥，断开与 API 模型的连接"
                  >
                    清空密钥
                  </button>
                )}
                {keyMsg && <span style={{ fontSize: 12, color: 'var(--ok)' }}>{keyMsg}</span>}
              </div>
              <div className="field-hint">API 联网模型共用这个密钥。</div>
            </div>
            <div className="field">
              <span className="field-label">模型</span>
              <input
                className="input"
                value={d.model}
                onChange={(e) => patch({ model: e.target.value })}
                onBlur={() => void commit()}
              />
            </div>
            <div className="field">
              <span className="field-label">识图模型（多模态，用于识别图片内容）</span>
              <input
                className="input"
                value={d.visionModel}
                placeholder="留空则用上面的模型（需支持视觉，如 gpt-4o）"
                onChange={(e) => patch({ visionModel: e.target.value })}
                onBlur={() => void commit()}
              />
            </div>
          </>
        )}
        <div className="row" style={{ gap: 16, alignItems: 'flex-end' }}>
          <SliderField
            className="grow"
            label={`Temperature · ${d.temperature.toFixed(2)}`}
            value={d.temperature}
            min={0}
            max={1.5}
            step={0.05}
            onChange={(v) => patch({ temperature: v })}
          />
          <Field className="grow" label="Max Tokens">
            <input
              className="input"
              type="number"
              value={d.maxTokens}
              onChange={(e) => patch({ maxTokens: Number(e.target.value) || 1024 })}
              onBlur={() => void commit()}
            />
          </Field>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => void test()}>
            保存并测试连通
          </button>
          {testing && <span style={{ fontSize: 12, color: testing.ok ? 'var(--ok)' : 'var(--err)' }}>{testing.msg}</span>}
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-title">追加设定</div>
        <textarea
          className="input"
          style={{ minHeight: 100 }}
          placeholder="会拼接到人格之后，用于临时微调"
          value={d.systemExtra}
          onChange={(e) => patch({ systemExtra: e.target.value })}
          onBlur={() => void commit()}
        />
      </div>
    </>
  )
}

/* ==================================================================
   对话 / 协作 / 记忆 / 工具
   ================================================================== */

function ChatSection(): React.ReactElement {
  const { settings, saveSettings } = useApp()
  if (!settings) return <></>
  const c = settings.chat
  return (
    <>
      <SectionHeader title="对话" desc="回复节奏与上下文" />
      <div className="card card-pad">
        <SwitchRow
          title="流式输出"
          desc="逐字显示回复"
          on={c.stream}
          onChange={(v) => void saveSettings({ chat: { ...c, stream: v } })}
        />
        <SliderField
          style={{ marginTop: 16 }}
          label={`打字速度 · ${c.typeSpeedMs} ms / 字`}
          value={c.typeSpeedMs}
          min={0}
          max={60}
          step={1}
          onChange={(v) => void saveSettings({ chat: { ...c, typeSpeedMs: v } })}
        />
        <SliderField
          label={`注入长期记忆条数 · ${c.memoryTopK}`}
          value={c.memoryTopK}
          min={0}
          max={10}
          step={1}
          onChange={(v) => void saveSettings({ chat: { ...c, memoryTopK: v } })}
        />
      </div>
    </>
  )
}

function CoopSection(): React.ReactElement {
  const { settings, saveSettings } = useApp()
  if (!settings) return <></>
  const c = settings.coop
  return (
    <>
      <SectionHeader title="协作" desc="本机操作与授权策略" />
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <SwitchRow
          title="启用本机工具"
          desc="关闭后所有工具调用都会被拒绝"
          on={c.enabled}
          onChange={(v) => void saveSettings({ coop: { ...c, enabled: v } })}
        />
        <SwitchRow
          title="每次操作都需授权"
          desc="关闭后读取类工具静默执行，写操作仍会询问"
          on={c.requireApproval}
          onChange={(v) => void saveSettings({ coop: { ...c, requireApproval: v } })}
        />
        <SliderField
          style={{ marginTop: 16 }}
          label={`单轮最大工具调用次数 · ${c.maxToolCallsPerTurn}`}
          value={c.maxToolCallsPerTurn}
          min={1}
          max={10}
          step={1}
          onChange={(v) => void saveSettings({ coop: { ...c, maxToolCallsPerTurn: v } })}
        />
      </div>
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <RunningAppsPanel />
      </div>
      {/* 已注册工具卡片已按需求删除 —— 工具列表不再在设置里展示 */}
    </>
  )
}

function MemorySection(): React.ReactElement {
  const { memories, character, addMemory } = useApp()
  const [text, setText] = useState('')
  return (
    <>
      <SectionHeader title="记忆" desc={`长期记忆会按相关度注入对话，共 ${memories.length} 条`} />
      <Collapsible title="快速写入" defaultOpen testId="settings-memory-compose">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <textarea
            className="input grow"
            data-testid="settings-memory-draft"
            style={{ minHeight: 70 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="比如：我住在杭州 / 我习惯晚上工作"
          />
          <button
            className="btn primary"
            data-testid="settings-memory-add"
            disabled={!text.trim()}
            onClick={async () => {
              await addMemory(text, 0.8)
              setText('')
            }}
          >
            记住
          </button>
        </div>
      </Collapsible>
      <Collapsible
        title={`${character?.name ?? '角色'} 的记忆库`}
        count={memories.length}
        testId="settings-memory-library"
      >
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {memories.slice(0, 60).map((m) => (
            <div key={m.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--stroke)', fontSize: 12.5 }}>
              <span style={{ color: 'var(--text-4)', marginRight: 8 }}>
                {new Date(m.createdAt).toLocaleDateString('zh-CN')}
              </span>
              {m.text}
            </div>
          ))}
          {memories.length === 0 && <EmptyHint testId="settings-memory-empty">还没有记忆</EmptyHint>}
        </div>
      </Collapsible>
    </>
  )
}

function ToolsSection(): React.ReactElement {
  const [appName, setAppName] = useState('')
  const [exePath, setExePath] = useState('')
  const [result, setResult] = useState('')

  const launch = async (): Promise<void> => {
    const res = await window.aimis.system.launchApp({ appName: appName.trim(), exePath: exePath.trim() || undefined })
    setResult(res.ok ? JSON.stringify(res.data, null, 2) : '失败：' + res.error)
  }

  return (
    <>
      <SectionHeader title="工具与权限" desc="登记本机应用路径，让角色能准确找到并启动它们" />

      <Collapsible title="手动启动 / 登记" defaultOpen testId="settings-tools-launch">
        <Field label="应用名称">
          <input className="input" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="例如：网易云音乐" />
        </Field>
        <Field label="可执行文件路径（可留空，自动查找）">
          <input
            className="input"
            value={exePath}
            onChange={(e) => setExePath(e.target.value)}
            placeholder="D:\Program Files\Netease\CloudMusic\cloudmusic.exe"
          />
        </Field>
        <button className="btn primary" onClick={() => void launch()} disabled={!appName.trim()}>
          启动
        </button>
        {result && (
          <pre
            className="mono"
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              background: 'var(--glass)',
              border: '1px solid var(--stroke)',
              color: 'var(--text-2)',
              whiteSpace: 'pre-wrap'
            }}
          >
            {result}
          </pre>
        )}
      </Collapsible>

      <Collapsible title="内置别名表" testId="settings-tools-alias">
        <div className="field-hint" style={{ lineHeight: 1.9 }}>
          网易云音乐 · QQ音乐 · 微信 · QQ · Chrome · Edge · 记事本 · 计算器 · 任务管理器 · 文件资源管理器 · Windows 终端 ·
          Windows 设置 · VS Code · Steam
          <br />
          别名表未命中时会扫描开始菜单快捷方式；仍未命中则提示你手动登记路径。
        </div>
      </Collapsible>
    </>
  )
}

/* ==================================================================
   诊断与日志 / 关于
   ================================================================== */



function Stat({ k, v }: { k: string; v: string }): React.ReactElement {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--stroke)' }}>
      <span style={{ color: 'var(--text-4)' }}>{k}</span>
      <span className="truncate" style={{ maxWidth: 260, textAlign: 'right' }} title={v}>
        {v}
      </span>
    </div>
  )
}

