import { assertPermission, getMachinePermission } from './permission'
import { authorizeOperation } from './workspaceSecurity'
import type { ToolCallRecord, ToolSpec, HardwareStatus } from '../shared/types'
import { TOOL_SPECS, launchApp, closeApp, listRunningApps } from './apps'
import { collectHardware } from './hardware'
import { uid } from './store'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { shell, app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { getWorkspace, runAgentTool } from './agentTools'

const execFileAsync = promisify(execFile)

export function toolSpec(name: string): ToolSpec | undefined {
  return TOOL_SPECS.find((t) => t.name === name)
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface Intent {
  tool: string
  params: Record<string, unknown>
}

const LAUNCH_VERBS = ['打开', '启动', '开一下', '帮我开', '运行', '拉起', 'opеn', 'open', 'launch', 'start']

const APP_HINTS: Array<{ re: RegExp; name: string }> = [
  { re: /网易云|cloudmusic|网易音乐/i, name: '网易云音乐' },
  { re: /qq音乐|qqmusic/i, name: 'QQ音乐' },
  { re: /微信|wechat/i, name: '微信' },
  { re: /\bqq\b/i, name: 'QQ' },
  { re: /chrome|谷歌浏览器|浏览器/i, name: 'Chrome' },
  { re: /edge/i, name: 'Microsoft Edge' },
  { re: /记事本|notepad/i, name: '记事本' },
  { re: /计算器|calc/i, name: '计算器' },
  { re: /任务管理器|taskmgr/i, name: '任务管理器' },
  { re: /资源管理器|文件管理器|explorer/i, name: '文件资源管理器' },
  { re: /终端|命令行|cmd|powershell/i, name: 'Windows 终端' },
  { re: /系统设置|windows设置/i, name: 'Windows 设置' },
  { re: /vscode|vs code/i, name: 'Visual Studio Code' },
  { re: /steam/i, name: 'Steam' }
]

export function detectIntent(text: string): Intent | null {
  const t = text.trim()

  if (/进程|什么在跑|谁在占|后台程序|任务列表/i.test(t) && /看|查|列|多少|有哪/.test(t)) {
    return { tool: 'list_processes', params: {} }
  }

  if (/磁盘|硬盘|空间|c盘|d盘|盘满|剩余空间/i.test(t) && /看|查|剩|多少|够不够|占用/.test(t)) {
    return { tool: 'get_disk_usage', params: {} }
  }

  if (/剪贴板/.test(t)) {
    if (/写入|复制|放|设置|帮我存|存到/.test(t)) {
      const m = t.match(/(?:写入|复制|存|放)\s*[:：]?\s*([\s\S]+)$/)
      return { tool: 'write_clipboard', params: { text: m ? m[1].trim() : '' } }
    }
    return { tool: 'read_clipboard', params: {} }
  }

  if (/音量|声音大小|调音/i.test(t) && /调|设|改|到|多少/.test(t)) {
    const m = t.match(/(\d{1,3})\s*%?/)
    return { tool: 'set_volume', params: { level: m ? Number(m[1]) : 40 } }
  }

  if (/截图|截屏|抓屏|屏幕截/i.test(t)) {
    return { tool: 'take_screenshot', params: {} }
  }

  if (/找文件|搜文件|搜索文件|找一下|有没有.*文件|在哪.*文件/i.test(t)) {
    const m = t.match(/(?:找|搜|搜索)(?:一下)?\s*([^\s，。,.!?！？的]{1,24})/)
    if (m) return { tool: 'search_files', params: { keyword: m[1] } }
  }

  if (
    /电脑状态|硬件状态|系统状态|配置|cpu|内存|显卡|gpu|硬盘|温度|负载|占用/i.test(t) &&
    /看|查|读|多少|怎么样|状态|报一下|给我/.test(t)
  ) {
    return { tool: 'get_hardware_status', params: {} }
  }
  if (/看下我?的?电脑|电脑怎么样|机器怎么样/i.test(t)) {
    return { tool: 'get_hardware_status', params: {} }
  }

  const wantsLaunch = LAUNCH_VERBS.some((v) => t.toLowerCase().includes(v.toLowerCase()))
  if (wantsLaunch) {
    for (const hint of APP_HINTS) {
      if (hint.re.test(t)) {
        return { tool: 'launch_app', params: { appName: hint.name } }
      }
    }
    const m = t.match(/(?:打开|启动|运行|帮我开|开一下)\s*([^\s，。,.!?！？的]+)/)
    if (m && m[1] && m[1].length <= 20) {
      return { tool: 'launch_app', params: { appName: m[1] } }
    }
  }

  if (/关机|重启|睡眠|休眠|锁屏/i.test(t) && /帮我|给我|现在|一下/.test(t)) {
    const action = /关机/.test(t) ? 'shutdown' : /重启/.test(t) ? 'restart' : /睡眠|休眠/.test(t) ? 'sleep' : 'lock'
    return { tool: 'system_power', params: { action } }
  }

  return null
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export function makeToolCall(intent: Intent, requireApproval: boolean): ToolCallRecord {
  const spec = toolSpec(intent.tool)
  return {
    id: uid('tool'),
    name: intent.tool,
    displayName: spec?.displayName ?? intent.tool,
    actionLabel: spec?.actionLabel ?? intent.tool,
    description: spec?.description ?? '',
    params: intent.params,
    state: requireApproval && spec?.defaultPermission !== 'always' ? 'waiting' : 'running',
    result: null,
    summary: '',
    createdAt: Date.now(),
    finishedAt: null
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface ToolRunOutput {
  result: unknown
  summary: string
  context: string
}

export async function runTool(name: string, params: Record<string, unknown>): Promise<ToolRunOutput> {
  const workspace = getWorkspace()
  const decision = assertPermission(name, params, { workspace })
  await authorizeOperation(workspace, decision.tier, name, params, decision.kind === 'read')
  if (workspace !== getWorkspace() || decision.tier !== getMachinePermission()) throw new Error('操作期间权限已变更，请重试')
  assertPermission(name, params, { workspace })
  switch (name) {
    case 'get_hardware_status': {
      const hw = await collectHardware()
      const s = hw.snapshot
      return {
        result: hw,
        summary: `CPU ${s.cpu.loadPercent}% · 内存 ${s.memory.usedPercent}% · ${s.gpu ? `${s.gpu.name} ${s.gpu.temperatureC ?? '?'}℃` : '无独显读数'}`,
        context: JSON.stringify(hw.snapshot, null, 2)
      }
    }

    case 'launch_app': {
      const appName = String(params.appName ?? '')
      const out = await launchApp(appName, params.exePath as string | undefined)
      return {
        result: out,
        summary: out.launched ? `已启动 ${out.appName}` : `未找到 ${out.appName}`,
        context: JSON.stringify(out, null, 2)
      }
    }

    case 'launch_close': {
      const appName = String(params.appName ?? '')
      const out = await closeApp(appName)
      return {
        result: out,
        summary: out.closed ? `已关闭 ${out.appName}（PID ${out.killedPids.join('、')}）` : out.message,
        context: JSON.stringify(out, null, 2)
      }
    }

    case 'app_running_list': {
      const list = await listRunningApps()
      return {
        result: { count: list.length, apps: list },
        summary: list.length ? `当前有 ${list.length} 个应用在运行` : '没有别名表里的应用在运行',
        context: JSON.stringify({ count: list.length, apps: list }, null, 2)
      }
    }

    case 'open_path': {
      const p = String(params.path ?? '')
      const err = await shell.openPath(p)
      const out = { opened: !err, path: p, message: err || 'ok', openedAt: new Date().toISOString() }
      return {
        result: out,
        summary: err ? `打开失败：${err}` : `已打开 ${p}`,
        context: JSON.stringify(out, null, 2)
      }
    }

    case 'list_processes': {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-Process | Sort-Object -Property WS -Descending | Select-Object -First 15 Name, @{n="MemMB";e={[math]::Round($_.WS/1MB,1)}}, CPU | ConvertTo-Json -Compress'
        ],
        { timeout: 10000, windowsHide: true }
      )
      const parsed = JSON.parse(stdout || '[]')
      const list = Array.isArray(parsed) ? parsed : [parsed]
      return {
        result: { status: 'ok', processes: list },
        summary: `占用最高的进程：${list
          .slice(0, 3)
          .map((p: any) => `${p.Name} ${p.MemMB}MB`)
          .join(' / ')}`,
        context: JSON.stringify({ status: 'ok', processes: list.slice(0, 15) }, null, 2)
      }
    }

    case 'get_disk_usage': {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { "$($_.DeviceID)|$([math]::Round($_.Size/1GB,1))|$([math]::Round($_.FreeSpace/1GB,1))" }'
        ],
        { timeout: 8000, windowsHide: true }
      )
      const drives = stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [mount, total, free] = line.split('|')
          const t = Number(total)
          const f = Number(free)
          return { mount, totalGB: t, freeGB: f, usedPercent: t > 0 ? Math.round(((t - f) / t) * 100) : 0 }
        })
      const tight = drives.filter((d) => d.usedPercent >= 85)
      return {
        result: { status: 'ok', drives },
        summary: tight.length
          ? `这几个盘快满了：${tight.map((d) => `${d.mount} ${d.usedPercent}%`).join('、')}`
          : `磁盘空间都还宽裕，最紧的是 ${drives.slice().sort((a, b) => b.usedPercent - a.usedPercent)[0]?.mount ?? '-'}`,
        context: JSON.stringify({ status: 'ok', drives }, null, 2)
      }
    }

    case 'search_files': {
      const keyword = String(params.keyword ?? '').trim()
      if (!keyword) throw new Error('缺少搜索关键词')
      const explicit = String(params.root ?? '').trim()
      const roots = explicit ? [explicit] : [...new Set([getWorkspace(), dirname(app.getAppPath()), app.getPath('desktop'), app.getPath('documents'), app.getPath('downloads')])]
      const hits: Array<{ FullName: string; KB: number }> = []
      let truncated = false
      const errors: string[] = []
      for (const root of roots) {
        try {
          const output = await runAgentTool('fs_glob', { path: root, pattern: '*' + keyword.replace(/[*?\[\]{}!]/g, '') + '*' })
          const data = output.result as { files: Array<{ path: string; size: number }>; truncated: boolean }
          truncated ||= data.truncated
          for (const file of data.files) if (!hits.some(h => h.FullName === file.path)) hits.push({ FullName: file.path, KB: Math.round(file.size / 1024) })
          if (hits.length >= 30) break
        } catch (error) { errors.push(root + ': ' + (error instanceof Error ? error.message : String(error))) }
      }
      return {
        result: { status: 'ok', keyword, roots, count: hits.length, hits, truncated, errors },
        summary: `找到 ${hits.length} 个匹配文件${truncated ? '（部分目录达到搜索上限）' : ''}`,
        context: JSON.stringify({ keyword, roots, hits, truncated, errors }, null, 2)
      }
    }
    case 'read_clipboard': {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw'
        ],
        { timeout: 6000, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
      )
      const text = stdout.replace(/\r?\n$/, '')
      return {
        result: { status: 'ok', length: text.length, text: text.slice(0, 4000) },
        summary: text ? `剪贴板里有 ${text.length} 个字` : '剪贴板是空的',
        context: JSON.stringify({ status: 'ok', text: text.slice(0, 1500) }, null, 2)
      }
    }

    case 'write_clipboard': {
      const text = String(params.text ?? '')
      const b64 = Buffer.from(text, 'utf-8').toString('base64')
      await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`
        ],
        { timeout: 8000, windowsHide: true }
      )
      return {
        result: { status: 'ok', length: text.length, writtenAt: new Date().toISOString() },
        summary: `已把 ${text.length} 个字放进剪贴板`,
        context: JSON.stringify({ status: 'ok', length: text.length }, null, 2)
      }
    }

    case 'set_volume': {
      const level = Math.max(0, Math.min(100, Number(params.level ?? 50)))
      const script = `
        $wsh = New-Object -ComObject WScript.Shell
        for ($i = 0; $i -lt 50; $i++) { $wsh.SendKeys([char]174) }
        $steps = [math]::Round(${level} / 2)
        for ($i = 0; $i -lt $steps; $i++) { $wsh.SendKeys([char]175) }
      `
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        timeout: 15000,
        windowsHide: true
      })
      return {
        result: { status: 'ok', level, setAt: new Date().toISOString() },
        summary: `系统音量已调到约 ${level}%`,
        context: JSON.stringify({ status: 'ok', level }, null, 2)
      }
    }

    case 'take_screenshot': {
      const pictures = join(app.getPath('pictures'), 'ShorekeeperCaptures')
      if (!existsSync(pictures)) mkdirSync(pictures, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const target = join(pictures, `capture-${stamp}.png`)
      const script = `
        Add-Type -AssemblyName System.Windows.Forms,System.Drawing
        $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
        $bmp.Save('${target.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose()
      `
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        timeout: 20000,
        windowsHide: true
      })
      return {
        result: { status: 'ok', path: target, capturedAt: new Date().toISOString() },
        summary: `截图存到了 ${target}`,
        context: JSON.stringify({ status: 'ok', path: target }, null, 2)
      }
    }

    case 'system_power': {
      const action = String(params.action ?? 'lock')
      const cmd =
        action === 'shutdown'
          ? 'Stop-Computer -Force'
          : action === 'restart'
            ? 'Restart-Computer -Force'
            : action === 'sleep'
              ? 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'
              : 'rundll32.exe user32.dll,LockWorkStation'
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
        timeout: 10000,
        windowsHide: true
      })
      const out = { action, executedAt: new Date().toISOString() }
      return { result: out, summary: `已执行电源操作：${action}`, context: JSON.stringify(out, null, 2) }
    }

    default:
      throw new Error(`未知工具：${name}`)
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export function offlineNarrate(name: string, params: Record<string, unknown>, result: unknown): string {
  if (name === 'get_hardware_status') {
    const hw = result as HardwareStatus
    const s = hw.snapshot
    const lines: string[] = []
    const cpu = s.cpu
    const mem = s.memory
    const cpuMood = cpu.loadPercent <= 15 ? '基本在闲着' : cpu.loadPercent <= 50 ? '有点忙，但还好' : '挺吃力的'
    lines.push(`电脑整体挺健康的，没看出什么毛病。CPU 负载只有 ${cpu.loadPercent}% 左右，${cpuMood}；`)
    lines.push(
      `内存用了 ${mem.usedPercent}%，${mem.totalGB}G 里占 ${mem.usedGB}G，${mem.usedPercent > 85 ? '这个偏高了，建议关掉点东西' : '也正常'}。`
    )
    if (s.gpu) {
      const g = s.gpu
      const busy = (g.loadPercent ?? 0) > 10
      lines.push(
        `倒是显卡那边${busy ? '有点动静' : '很安静'}——${g.name}${g.temperatureC !== null ? ` 温度 ${g.temperatureC} 度` : ''}${g.loadPercent !== null ? `，负载 ${g.loadPercent}%` : ''}${g.vramUsedGB !== null && g.vramTotalGB !== null ? `，显存占了 ${g.vramUsedGB}G / ${g.vramTotalGB}G` : ''}，${busy ? '像是刚跑过点什么或者后台有活儿' : '没在干活'}。`
      )
    } else {
      lines.push(`显卡读数拿不到，这台机器没装 NVIDIA 驱动或者没暴露信息。`)
    }
    if (cpu.temperatureC === null) {
      lines.push(`唯一的小提醒：CPU 温度读不到，传感器没给数据，不是故障，就是这台机器没暴露这个读数而已。`)
    } else {
      lines.push(`CPU 温度 ${cpu.temperatureC} 度，${cpu.temperatureC > 85 ? '有点烫，注意散热' : '很正常'}。`)
    }
    lines.push(`要我干点别的，还是就看看？`)
    return lines.join('')
  }

  if (name === 'launch_app') {
    const out = result as { launched: boolean; appName: string; message: string }
    return out.launched
      ? `${out.appName}已经帮你点开了，稍等，它自己弹出来就行。`
      : `${out.appName}我这边没找到装在哪。要不你在「设置 → 工具与权限」里登记一下可执行文件路径，下次我直接开。`
  }

  if (name === 'launch_close') {
    const out = result as { closed: boolean; appName: string; message: string; killedPids: number[] }
    if (!out.closed) return out.message
    return `${out.appName}已经关掉了${out.killedPids.length ? `（结束进程 ${out.killedPids.join('、')}）` : ''}。`
  }

  if (name === 'app_running_list') {
    const out = result as { count: number; apps: Array<{ appName: string }> }
    if (!out.count) return '我登记过的那些应用现在都没开着。'
    return `现在开着的有：${out.apps.map((a) => a.appName).join('、')}。要关哪个跟我说。`
  }

  if (name === 'open_path') {
    const out = result as { opened: boolean; path: string; message: string }
    return out.opened ? `打开了：${out.path}` : `没打开成功：${out.message}`
  }

  if (name === 'list_processes') {
    const out = result as { processes: Array<{ Name: string; MemMB: number }> }
    const top = out.processes
      .slice(0, 3)
      .map((p) => `${p.Name}（${p.MemMB}MB）`)
      .join('、')
    return `目前占内存最多的是 ${top}。要我看点别的吗？`
  }

  if (name === 'get_disk_usage') {
    const out = result as { drives: Array<{ mount: string; totalGB: number; freeGB: number; usedPercent: number }> }
    const worst = out.drives.slice().sort((a, b) => b.usedPercent - a.usedPercent)[0]
    const tight = out.drives.filter((d) => d.usedPercent >= 85)
    if (tight.length) {
      return `${tight.map((d) => `${d.mount} 已经用了 ${d.usedPercent}%`).join('，')}，剩下的空间不多了，找个时间清一清。`
    }
    return worst
      ? `磁盘都还宽裕。最紧的是 ${worst.mount}，用了 ${worst.usedPercent}%，还剩 ${worst.freeGB}G。`
      : '没读到磁盘信息。'
  }

  if (name === 'search_files') {
    const out = result as { keyword: string; count: number; hits: Array<{ FullName: string }> }
    if (!out.count) return `没找到名字里带「${out.keyword}」的文件。换个词试试？`
    const first = out.hits[0]?.FullName ?? ''
    return `找到 ${out.count} 个。第一个是 ${first}${out.count > 1 ? `，还有 ${out.count - 1} 个` : ''}。`
  }

  if (name === 'read_clipboard') {
    const out = result as { length: number; text: string }
    if (!out.length) return '剪贴板现在是空的。'
    const preview = out.text.length > 60 ? out.text.slice(0, 60) + '…' : out.text
    return `剪贴板里是：「${preview}」`
  }

  if (name === 'write_clipboard') {
    const out = result as { length: number }
    return `好，${out.length} 个字已经放进剪贴板了。`
  }

  if (name === 'set_volume') {
    const out = result as { level: number }
    return `音量调到 ${out.level}% 了。`
  }

  if (name === 'take_screenshot') {
    const out = result as { path: string }
    return `截好了，存在 ${out.path}。`
  }

  if (name === 'system_power') {
    const out = result as { action: string }
    return `好，${out.action} 已经执行了。`
  }

  return '做完了。'
}
