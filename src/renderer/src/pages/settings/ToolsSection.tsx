import React, { useState } from 'react'
import { Collapsible, Field, SectionHeader } from '../../components/ui'

export default function ToolsSection(): React.ReactElement {
  const [appName, setAppName] = useState('')
  const [exePath, setExePath] = useState('')
  const [result, setResult] = useState('')
  const launch = async (): Promise<void> => {
    const response = await window.aimis.system.launchApp({ appName: appName.trim(), exePath: exePath.trim() || undefined })
    setResult(response.ok ? JSON.stringify(response.data, null, 2) : `失败：${response.error}`)
  }
  return (
    <>
      <SectionHeader title="工具与权限" desc="登记本机应用路径，让角色能准确找到并启动它们" />
      <Collapsible title="手动启动 / 登记" defaultOpen testId="settings-tools-launch">
        <Field label="应用名称"><input className="input" value={appName} onChange={(event) => setAppName(event.target.value)} placeholder="例如：网易云音乐" /></Field>
        <Field label="可执行文件路径（可留空，自动查找）"><input className="input" value={exePath} onChange={(event) => setExePath(event.target.value)} placeholder="D:\Program Files\Netease\CloudMusic\cloudmusic.exe" /></Field>
        <button className="btn primary" onClick={() => void launch()} disabled={!appName.trim()}>启动</button>
        {result && <pre className="mono" style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'var(--glass)', border: '1px solid var(--stroke)', color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{result}</pre>}
      </Collapsible>
      <Collapsible title="内置别名表" testId="settings-tools-alias">
        <div className="field-hint" style={{ lineHeight: 1.9 }}>网易云音乐 · QQ音乐 · 微信 · QQ · Chrome · Edge · 记事本 · 计算器 · 任务管理器 · 文件资源管理器 · Windows 终端 · Windows 设置 · VS Code · Steam<br />别名表未命中时会扫描开始菜单快捷方式；仍未命中则提示你手动登记路径。</div>
      </Collapsible>
    </>
  )
}
