import React from 'react'
import Avatar from '../../components/Avatar'
import { Field, SectionHeader, SliderField, SwitchRow } from '../../components/ui'
import { useApp } from '../../store/AppStore'
import BackgroundSection from './BackgroundSection'

const BUBBLE_STYLES = [
  { key: 'resonance', label: '共鸣终端', desc: '切角、描边与技术纹理' },
  { key: 'soft', label: '柔和圆角', desc: '保留圆润气泡' },
  { key: 'minimal', label: '简洁平面', desc: '轻阴影、低装饰' }
] as const

export default function ChatSection(): React.ReactElement {
  const { settings, saveSettings, pushToast } = useApp()
  if (!settings) return <></>
  const chat = settings.chat
  const appearance = chat.appearance
  const saveAppearance = (patch: Partial<typeof appearance>): Promise<void> => saveSettings({ chat: { ...chat, appearance: { ...appearance, ...patch } } })
  const pickUserAvatar = async (): Promise<void> => {
    const result = await window.aimis.system.pickImage()
    if (!result.ok || !result.data) return
    await saveAppearance({ userAvatar: String(result.data), showUserAvatar: true })
    pushToast({ ok: true, text: '用户头像已更新' })
  }

  return <>
    <SectionHeader title="对话界面" desc="单独调整聊天背景、气泡和双方头像；修改后立即生效。" />
    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <div className="card-title">界面样式</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        {BUBBLE_STYLES.map((style) => <button key={style.key} data-bubble-style={style.key} className={`pick-card ${appearance.bubbleStyle === style.key ? 'on' : ''}`} onClick={() => void saveAppearance({ bubbleStyle: style.key })}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{style.label}</div>
          <div className="pick-desc" style={{ color: 'var(--text-3)' }}>{style.desc}</div>
          <div className={`bubble-style-preview preview-${style.key}`} aria-hidden="true"><span /><span /></div>
        </button>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 16 }}>
        <Field label="用户气泡起始色"><input type="color" value={appearance.userBubbleFrom} onChange={(event) => void saveAppearance({ userBubbleFrom: event.target.value })} /></Field>
        <Field label="用户气泡结束色"><input type="color" value={appearance.userBubbleTo} onChange={(event) => void saveAppearance({ userBubbleTo: event.target.value })} /></Field>
        <Field label="角色气泡颜色"><input type="color" value={appearance.characterBubble} onChange={(event) => void saveAppearance({ characterBubble: event.target.value })} /></Field>
      </div>
      <div className="field-hint">气泡颜色独立保存，只作用于对话界面。</div>
    </div>
    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <div className="card-title">头像显示</div>
      <SwitchRow title="显示角色头像" desc="关闭后角色消息只显示名字和气泡" on={appearance.showCharacterAvatar} onChange={(showCharacterAvatar) => void saveAppearance({ showCharacterAvatar })} />
      <SwitchRow title="显示我的头像" desc="关闭后用户消息右侧不显示头像" on={appearance.showUserAvatar} onChange={(showUserAvatar) => void saveAppearance({ showUserAvatar })} />
      <div className="row" style={{ gap: 14, paddingTop: 14 }}><Avatar src={appearance.userAvatar} size={58} /><div className="grow"><div style={{ fontSize: 13, fontWeight: 600 }}>我的头像</div><div className="field-hint">仅用于对话界面。</div></div><button className="btn primary sm" onClick={() => void pickUserAvatar()}>选择图片</button>{!!appearance.userAvatar && <button className="btn sm" onClick={() => void saveAppearance({ userAvatar: '' })}>清除头像</button>}</div>
    </div>
    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <div className="card-title">回复行为</div>
      <SwitchRow title="流式输出" desc="逐字显示回复" on={chat.stream} onChange={(stream) => void saveSettings({ chat: { ...chat, stream } })} />
      <SliderField style={{ marginTop: 16 }} label={`打字速度 · ${chat.typeSpeedMs} ms / 字`} value={chat.typeSpeedMs} min={0} max={60} step={1} onChange={(typeSpeedMs) => void saveSettings({ chat: { ...chat, typeSpeedMs } })} />
      <SliderField label={`注入长期记忆条数 · ${chat.memoryTopK}`} value={chat.memoryTopK} min={0} max={10} step={1} onChange={(memoryTopK) => void saveSettings({ chat: { ...chat, memoryTopK } })} />
    </div>
    <BackgroundSection includeSplash={false} title="对话背景" description="选择图片或视频作为对话背景，并调整遮罩、透明度、模糊和填充方式。" />
  </>
}
