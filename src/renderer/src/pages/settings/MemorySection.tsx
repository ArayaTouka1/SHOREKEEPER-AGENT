import React, { useState } from 'react'
import { Collapsible, EmptyHint, SectionHeader } from '../../components/ui'
import { useApp } from '../../store/AppStore'

export default function MemorySection(): React.ReactElement {
  const { memories, character, addMemory } = useApp()
  const [text, setText] = useState('')
  return (
    <>
      <SectionHeader title="记忆" desc={`长期记忆会按相关度注入对话，共 ${memories.length} 条`} />
      <Collapsible title="快速写入" defaultOpen testId="settings-memory-compose">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <textarea className="input grow" data-testid="settings-memory-draft" style={{ minHeight: 70 }} value={text} onChange={(event) => setText(event.target.value)} placeholder="比如：我住在杭州 / 我习惯晚上工作" />
          <button className="btn primary" data-testid="settings-memory-add" disabled={!text.trim()} onClick={async () => { await addMemory(text, 0.8); setText('') }}>记住</button>
        </div>
      </Collapsible>
      <Collapsible title={`${character?.name ?? '角色'} 的记忆库`} count={memories.length} testId="settings-memory-library">
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {memories.slice(0, 60).map((memory) => <div key={memory.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--stroke)', fontSize: 12.5 }}><span style={{ color: 'var(--text-4)', marginRight: 8 }}>{new Date(memory.createdAt).toLocaleDateString('zh-CN')}</span>{memory.text}</div>)}
          {memories.length === 0 && <EmptyHint testId="settings-memory-empty">还没有记忆</EmptyHint>}
        </div>
      </Collapsible>
    </>
  )
}
