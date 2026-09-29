import React, { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../store/AppStore'
import PersonaSection from './PersonaSection'
import Avatar from '../../components/Avatar'
import { SliderField } from '../../components/ui'

/* ==================================================================
   角色
   ================================================================== */

export default function CharacterSection(): React.ReactElement {
  const { character, characters, personas, switchCharacter, saveCharacter, createCharacter, deleteCharacter, pushToast } =
    useApp()
  const [name, setName] = useState(character ? character.name : '')
  const [latin, setLatin] = useState(character ? character.latinName : '')
  const [greeting, setGreeting] = useState(character ? character.greeting : '')
  const [address, setAddress] = useState(character?.userAddressOverride ?? '')
  const [savedFlash, setSavedFlash] = useState(false)
  const [creating, setCreating] = useState(false)

  const charId = character ? character.id : null
  useEffect(() => {
    if (!character) return
    setName(character.name)
    setLatin(character.latinName)
    setGreeting(character.greeting)
    setAddress(character.userAddressOverride ?? '')
  }, [charId, character])

  const defaultAddress = useMemo(() => {
    if (!character) return ''
    const p = personas.find((x) => x.id === character.personaId)
    if (!p) return ''
    const m = p.content.match(/称呼\s*\{\{user\}\}\s*为\s*[「"“]?([^」"”，。、\n]{1,12})/)
    return m ? m[1].replace(/[「」"“”]/g, '').trim() : ''
  }, [character, personas])

  const save = async (): Promise<void> => {
    await saveCharacter({
      name: name.trim() || '未命名',
      latinName: latin.trim() || name.trim(),
      greeting,
      userAddressOverride: address.trim()
    })
    pushToast({ ok: true, text: '角色设置已保存' })
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), 1600)
  }

  const pickImage = async (slot: 'main' | 'banner'): Promise<void> => {
    if (!character) return
    if (slot === 'banner') {
      const res = await window.aimis.system.pickMedia()
      if (!res.ok || !res.data) return
      const url = 'file:///' + String(res.data.path).replace(/\\/g, '/')
      await saveCharacter({ avatar: { ...character.avatar, banner: url, bannerKind: res.data.kind } })
      return
    }
    const res = await window.aimis.system.pickImage()
    if (!res.ok || !res.data || !character) return
    const url = 'file:///' + String(res.data).replace(/\\/g, '/')
    await saveCharacter({ avatar: { ...character.avatar, main: url } })
  }

  return (
    <>
      <div className="sec-title">角色</div>
      <div className="sec-desc">切换角色后，头像、人格、音色会一起切换。</div>

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-title">选择角色</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {characters.map((c) => (
            <button
              key={c.id}
              data-char-id={c.id}
              data-char-name={c.name}
              onClick={() => void switchCharacter(c.id)}
              className="row"
              style={{
                padding: '8px 16px 8px 8px',
                borderRadius: 999,
                gap: 9,
                background: c.id === charId ? 'var(--accent-grad)' : 'var(--glass)',
                border: '1px solid ' + (c.id === charId ? 'transparent' : 'var(--stroke)'),
                color: c.id === charId ? '#fff' : 'var(--text-2)',
                boxShadow: c.id === charId ? 'var(--glow)' : 'none'
              }}
            >
              <Avatar src={c.avatar.main} size={28} />
              <span style={{ fontSize: 13 }}>{c.name}</span>
            </button>
          ))}
          <button
            className="btn sm"
            disabled={creating}
            onClick={async () => {
              if (creating) return
              setCreating(true)
              try {
                await createCharacter()
              } finally {
                setCreating(false)
              }
            }}
          >
            ＋ 新建角色
          </button>
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>当前角色 · {character?.name}</div>
      </div>

      <PersonaSection />
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="card-title">角色名称</div>
        <div className="field">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：守岸人" />
          <div className="field-hint">保存后同步更新首页、顶部和对话中的角色名称。</div>
        </div>
        <div className="field">
          <span className="field-label">大写英文名（启动页与角色卡副标题）</span>
          <input className="input" value={latin} onChange={(e) => setLatin(e.target.value)} placeholder="例如：SHOREKEEPER" />
        </div>
        <div className="field">
          <span className="field-label">问候语（首页引导语）</span>
          <input className="input" value={greeting} onChange={(e) => setGreeting(e.target.value)} />
        </div>

        {/* 自定义称呼 —— 覆盖人格文件里解析出来的默认称呼 */}
        <div className="field">
          <span className="field-label">她怎么称呼你</span>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input grow"
              data-testid="user-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={defaultAddress ? `留空则用人设里的「${defaultAddress}」` : '留空则用「你」'}
            />
            <button
              className="btn sm"
              data-testid="user-address-save"
              onClick={() => void save()}
              disabled={!character || address === (character.userAddressOverride ?? '')}
            >
              保存
            </button>
            {!!address && (
              <button
                className="btn ghost sm"
                onClick={async () => {
                  setAddress('')
                  if (character) await saveCharacter({ id: character.id, userAddressOverride: '' })
                }}
              >
                清除
              </button>
            )}
          </div>
          <div className="field-hint">
            改这里会覆盖人格设定里的称呼。当前生效：
            <span className="mono" style={{ color: 'var(--accent)' }}>
              {address || defaultAddress || '你'}
            </span>
          </div>
        </div>

        <div className="row">
          <button className="btn primary" onClick={() => void save()}>
            {savedFlash ? '已保存 ✓' : '保存'}
          </button>
          {character && !character.builtin && (
            <button className="btn danger" onClick={() => void deleteCharacter(character.id)}>
              删除此角色
            </button>
          )}
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-title">角色图片</div>
        <AvatarSlot label="头像" desc="对话、首页、系统状态统一使用" src={character?.avatar.main} onPick={() => void pickImage('main')} />
        <AvatarSlot
          label="头图"
          desc="首页与设置页背景（支持图片或视频）"
          src={character?.avatar.banner}
          kind={character?.avatar.bannerKind ?? 'image'}
          onPick={() => void pickImage('banner')}
          wide
        />
        {character?.avatar.banner && (
          <SliderField
            label={`头图透明度 · ${character.avatar.bannerOpacity ?? 100}%（100=完全显示，0=看不见）`}
            value={character.avatar.bannerOpacity ?? 100}
            min={0}
            max={100}
            step={1}
            onChange={(v) => void saveCharacter({ avatar: { ...character.avatar, bannerOpacity: v } })}
          />
        )}
      </div>
    </>
  )
}

function AvatarSlot({
  label,
  desc,
  src,
  onPick,
  wide,
  kind
}: {
  label: string
  desc: string
  src?: string
  onPick: () => void
  wide?: boolean
  kind?: 'image' | 'video'
}): React.ReactElement {
  return (
    <div className="row" style={{ padding: '12px 0', gap: 14, borderBottom: '1px solid var(--stroke)' }}>
      <div
        style={{
          width: wide ? 150 : 54,
          height: 54,
          borderRadius: wide ? 12 : 14,
          overflow: 'hidden',
          flexShrink: 0,
          background: 'var(--glass)',
          border: '1px solid var(--stroke)'
        }}
      >
        {src && kind === 'video' ? (
          <video src={src} muted loop style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : src ? (
          <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : null}
      </div>
      <div className="grow">
        <div style={{ fontSize: 13 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{desc}</div>
      </div>
      <button className="btn sm" onClick={onPick}>
        更换
      </button>
    </div>
  )
}
