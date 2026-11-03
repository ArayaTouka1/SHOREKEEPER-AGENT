import React, { useState } from 'react'
import { useApp } from '../../store/AppStore'
import { Field } from '../../components/ui'

export default function ModelConnectionGuide(): React.ReactElement {
  const { models, refreshModels, pushToast } = useApp()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'api' | 'local'>('api')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [choices, setChoices] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [tested, setTested] = useState(false)
  const [status, setStatus] = useState('')
  const invalidate = (): void => { setTested(false); setStatus('') }
  const chooseKind = (next: 'api' | 'local'): void => {
    setKind(next)
    setBaseUrl(models.find(item => item.kind === next)?.baseUrl || '')
    setApiKey(''); setModel(''); setChoices([]); invalidate()
  }
  const test = async (listOnly: boolean): Promise<void> => {
    setBusy(true); setTested(false); setStatus(listOnly ? '正在获取模型列表…' : '正在测试模型回复…')
    try {
      const result = await window.aimis.model.connectionTest({ baseUrl, apiKey, model: listOnly ? undefined : model })
      if (!result.ok || !result.data) throw new Error(result.error || '连接失败')
      setChoices(result.data.models || [])
      if (listOnly && result.data.models?.length) setModel(result.data.models[0])
      setTested(!listOnly && result.data.ok)
      setStatus(result.data.message + (listOnly && !result.data.models?.length ? '；也可以手动填写模型标识后测试' : ''))
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const save = async (): Promise<void> => {
    if (!tested || busy) return
    setBusy(true)
    try {
      const added = await window.aimis.model.add({ name: model, kind, baseUrl, model, apiKey })
      if (!added.ok || !added.data) throw new Error(added.error || '保存失败')
      if (kind === 'local') {
        const connected = await window.aimis.model.markConnected({ id: added.data.model.id, ok: true })
        if (!connected.ok) throw new Error(connected.error || '连接状态保存失败')
      }
      const selected = await window.aimis.model.setActive(added.data.model.id)
      if (!selected.ok) throw new Error(selected.error || '模型已保存，切换失败，请在列表中选择')
      await refreshModels()
      setStatus('已连接并切换到此模型，现在可以开始对话')
      setTested(false)
      pushToast({ ok: true, text: '模型连接已完成' })
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <div className="card card-pad" style={{ marginBottom: 18 }} data-testid="model-connection-guide">
    <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
      <div><div className="card-title">首次连接向导</div><div className="field-hint">填写地址 → 选择模型 → 测试并开始对话</div></div>
      <button className="btn sm" disabled={busy} onClick={() => { if (!baseUrl) chooseKind(kind); setOpen(!open) }}>{open ? '收起' : '开始配置'}</button>
    </div>
    {open && <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: '16px 0 0', minWidth: 0 }}>
      <Field label="1. 选择连接方式"><div className="row" style={{ gap: 8 }}>
        <button className="btn sm" aria-pressed={kind === 'api'} onClick={() => chooseKind('api')}>联网 API</button>
        <button className="btn sm" aria-pressed={kind === 'local'} onClick={() => chooseKind('local')}>本地模型</button>
      </div></Field>
      <div className="field-hint" style={{ marginBottom: 12 }}>{kind === 'local' ? '先在 Ollama、LM Studio 等软件中启动模型服务，再填写其 OpenAI 兼容地址。' : '从服务商获取 API 密钥，并填写服务商提供的 OpenAI 兼容地址。'}</div>
      <Field label="服务地址（Base URL）"><input className="input" value={baseUrl} onChange={event => { setBaseUrl(event.target.value); setChoices([]); invalidate() }} placeholder="http://127.0.0.1:11434/v1" /></Field>
      <Field label={kind === 'api' ? 'API 密钥' : 'API 密钥（服务未设置时可留空）'}><input className="input" type="password" autoComplete="off" value={apiKey} onChange={event => { setApiKey(event.target.value); invalidate() }} /></Field>
      <Field label="2. 选择或填写模型标识"><div className="row" style={{ gap: 8 }}>
        <input className="input grow" list="connection-guide-models" value={model} onChange={event => { setModel(event.target.value); invalidate() }} placeholder="与服务端显示的模型名称一致" />
        <datalist id="connection-guide-models">{choices.map(id => <option key={id} value={id} />)}</datalist>
        <button className="btn sm" disabled={!baseUrl.trim()} onClick={() => void test(true)}>获取模型列表</button>
      </div></Field>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn sm" disabled={!baseUrl.trim() || !model.trim()} onClick={() => void test(false)}>3. 测试回复</button>
        <button className="btn sm" disabled={!tested} onClick={() => void save()}>保存并使用</button>
      </div>
    </fieldset>}
    {status && <div role="status" style={{ marginTop: 12, color: tested ? 'var(--ok)' : 'var(--text-2)' }}>{status}</div>}
  </div>
}
