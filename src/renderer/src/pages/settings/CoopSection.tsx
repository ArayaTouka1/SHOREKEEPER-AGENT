import React from 'react'
import RunningAppsPanel from '../../components/RunningAppsPanel'
import { SectionHeader, SliderField, SwitchRow } from '../../components/ui'
import { useApp } from '../../store/AppStore'

export default function CoopSection(): React.ReactElement {
  const { settings, saveSettings } = useApp()
  if (!settings) return <></>
  const coop = settings.coop
  return (
    <>
      <SectionHeader title="协作" desc="本机操作与授权策略" />
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <SwitchRow title="启用本机工具" desc="关闭后所有工具调用都会被拒绝" on={coop.enabled} onChange={(enabled) => void saveSettings({ coop: { ...coop, enabled } })} />
        <SwitchRow title="每次操作都需授权" desc="关闭后读取类工具静默执行，写操作仍会询问" on={coop.requireApproval} onChange={(requireApproval) => void saveSettings({ coop: { ...coop, requireApproval } })} />
        <SliderField style={{ marginTop: 16 }} label={`单轮最大工具调用次数 · ${coop.maxToolCallsPerTurn}`} value={coop.maxToolCallsPerTurn} min={1} max={10} step={1} onChange={(maxToolCallsPerTurn) => void saveSettings({ coop: { ...coop, maxToolCallsPerTurn } })} />
      </div>
      <div className="card card-pad" style={{ marginBottom: 18 }}><RunningAppsPanel /></div>
    </>
  )
}
