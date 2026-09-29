import { shell } from 'electron'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ToolSpec } from '../shared/types'
import type { CloseAppResult, RunningApp } from '../shared/types'
import {
  scanStartMenu as scanStartMenuScored,
  looksLikeUninstaller,
  readLnkTarget
} from './appMatch'

const execFileAsync = promisify(execFile)

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

interface AppAlias {
  keys: string[]
  display: string
  paths: string[]
  uri?: string
}

const PROGRAM_FILES = [process.env['ProgramFiles'] ?? 'C:\\Program Files', process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', process.env['LOCALAPPDATA'] ?? '']

function expand(p: string): string {
  return p.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? '')
}

export const APP_ALIASES: AppAlias[] = [
  {
    keys: ['网易云音乐', '网易云', 'cloudmusic', 'neteasemusic', 'netease music'],
    display: '网易云音乐',
    paths: [
      '%ProgramFiles%\\Netease\\CloudMusic\\cloudmusic.exe',
      '%ProgramFiles(x86)%\\Netease\\CloudMusic\\cloudmusic.exe',
      '%LOCALAPPDATA%\\Netease\\CloudMusic\\cloudmusic.exe',
      'D:\\Program Files\\Netease\\CloudMusic\\cloudmusic.exe'
    ],
    uri: 'orpheus://'
  },
  {
    keys: ['qq音乐', 'qqmusic'],
    display: 'QQ音乐',
    paths: ['%ProgramFiles(x86)%\\Tencent\\QQMusic\\QQMusic.exe', '%ProgramFiles%\\Tencent\\QQMusic\\QQMusic.exe']
  },
  {
    keys: ['微信', 'wechat'],
    display: '微信',
    paths: ['%ProgramFiles%\\Tencent\\WeChat\\WeChat.exe', '%ProgramFiles(x86)%\\Tencent\\WeChat\\WeChat.exe']
  },
  {
    keys: ['qq'],
    display: 'QQ',
    paths: ['%ProgramFiles%\\Tencent\\QQNT\\QQ.exe']
  },
  {
    keys: ['浏览器', 'chrome', '谷歌浏览器'],
    display: 'Chrome',
    paths: ['%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe', '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe']
  },
  {
    keys: ['edge', '微软浏览器'],
    display: 'Microsoft Edge',
    paths: ['%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe']
  },
  {
    keys: ['记事本', 'notepad'],
    display: '记事本',
    paths: ['C:\\Windows\\System32\\notepad.exe']
  },
  {
    keys: ['计算器', 'calculator', 'calc'],
    display: '计算器',
    paths: ['C:\\Windows\\System32\\calc.exe']
  },
  {
    keys: ['任务管理器', 'taskmgr'],
    display: '任务管理器',
    paths: ['C:\\Windows\\System32\\Taskmgr.exe']
  },
  {
    keys: ['资源管理器', 'explorer', '文件管理器'],
    display: '文件资源管理器',
    paths: ['C:\\Windows\\explorer.exe']
  },
  {
    keys: ['终端', 'cmd', '命令行', 'powershell'],
    display: 'Windows 终端',
    paths: ['C:\\Windows\\System32\\cmd.exe']
  },
  {
    keys: ['设置', 'settings'],
    display: 'Windows 设置',
    paths: [],
    uri: 'ms-settings:'
  },
  {
    keys: ['vscode', 'vs code', '代码编辑器'],
    display: 'Visual Studio Code',
    paths: ['%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe', '%ProgramFiles%\\Microsoft VS Code\\Code.exe']
  },
  {
    keys: ['steam'],
    display: 'Steam',
    paths: ['%ProgramFiles(x86)%\\Steam\\steam.exe', '%ProgramFiles%\\Steam\\steam.exe']
  }
]

export function resolveApp(appName: string): AppAlias | null {
  const key = appName.trim().toLowerCase().replace(/\s+/g, '')
  if (!key) return null
  return (
    APP_ALIASES.find((a) => a.keys.some((k) => k.toLowerCase().replace(/\s+/g, '') === key)) ??
    APP_ALIASES.find((a) => a.keys.some((k) => key.includes(k.toLowerCase()) || k.toLowerCase().includes(key))) ??
    null
  )
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    const full = expand(p)
    if (full && existsSync(full)) return full
  }
  return null
}

/**
 *
 */
function scanStartMenu(name: string): string | null {
  const { best } = scanStartMenuScored(name)
  return best ? best.path : null
}

export interface LaunchOutcome {
  launched: boolean
  appName: string
  resolvedPath: string | null
  message: string
  launchedAt: string
}

export async function launchApp(appName: string, exePath?: string): Promise<LaunchOutcome> {
  const launchedAt = new Date().toISOString()

  if (exePath && existsSync(exePath)) {
    const err = await shell.openPath(exePath)
    return {
      launched: !err,
      appName,
      resolvedPath: exePath,
      message: err ? `启动失败：${err}` : `已启动「${appName}」`,
      launchedAt
    }
  }

  const alias = resolveApp(appName)
  if (alias) {
    const found = firstExisting(alias.paths)
    if (found) {
      const err = await shell.openPath(found)
      return {
        launched: !err,
        appName: alias.display,
        resolvedPath: found,
        message: err ? `启动失败：${err}` : `已启动「${alias.display}」`,
        launchedAt
      }
    }
    if (alias.uri) {
      await shell.openExternal(alias.uri)
      return {
        launched: true,
        appName: alias.display,
        resolvedPath: alias.uri,
        message: `已通过协议唤起「${alias.display}」`,
        launchedAt
      }
    }
  }

  const lnk = scanStartMenu(appName)
  if (lnk) {
    const err = await shell.openPath(lnk)
    return {
      launched: !err,
      appName,
      resolvedPath: lnk,
      message: err ? `启动失败：${err}` : `已启动「${appName}」`,
      launchedAt
    }
  }

  return {
    launched: false,
    appName,
    resolvedPath: null,
    message: `没找到「${appName}」的安装位置。可以在设置 → 工具与权限 里手动登记可执行文件路径。`,
    launchedAt
  }
}

export type CloseAppOutcome = CloseAppResult

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/**
 *
 */
export const PROTECTED_PROCESSES: string[] = [
  'explorer.exe',
  'winlogon.exe',
  'csrss.exe',
  'services.exe',
  'lsass.exe',
  'svchost.exe',
  'system',
  'system.exe',
  'smss.exe',
  'dwm.exe',
  'wininit.exe',
  'fontdrvhost.exe',
  'registry',
  'memory compression'
]

const SELF_PROCESS_NAMES = ['electron.exe', 'shorekeeper-agent.exe']

export function isProtectedProcess(exeName: string): boolean {
  const n = exeName.trim().toLowerCase().replace(/^.*[\\/]/, '')
  if (!n) return false
  if (PROTECTED_PROCESSES.includes(n)) return true
  if (SELF_PROCESS_NAMES.includes(n)) return true
  if (n === 'electron' || n.startsWith('electron.') || n === 'electron.exe') return true
  return false
}

export function aliasExeNames(): string[] {
  const out = new Set<string>()
  for (const a of APP_ALIASES) {
    for (const p of a.paths) {
      const base = p.replace(/^.*[\\/]/, '').trim().toLowerCase()
      if (base) out.add(base)
    }
  }
  return Array.from(out)
}

export interface ProcessRow {
  pid: number
  name: string
}

/**
 */
async function queryProcesses(): Promise<ProcessRow[]> {
  let stdout = ''
  try {
    const r = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], {
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8'
    })
    stdout = r.stdout ?? ''
  } catch {
    return []
  }

  const rows: ProcessRow[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    // CSV： "IMAGE","PID","SESSION","SESSION#","MEM"
    const cells = line.match(/"([^"]*)"/g)
    if (!cells || cells.length < 2) continue
    const name = cells[0].replace(/"/g, '').trim()
    const pid = Number(cells[1].replace(/"/g, '').trim())
    if (!name || !Number.isFinite(pid)) continue
    rows.push({ pid, name })
  }
  return rows
}

export async function listRunningApps(): Promise<RunningApp[]> {
  const rows = await queryProcesses()
  if (!rows.length) return []

  const byName = new Map<string, number[]>()
  for (const r of rows) {
    const key = r.name.toLowerCase()
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key)!.push(r.pid)
  }

  const out: RunningApp[] = []
  for (const alias of APP_ALIASES) {
    const pids: number[] = []
    let exeName = ''
    for (const p of alias.paths) {
      const base = p.replace(/^.*[\\/]/, '').trim()
      const hits = byName.get(base.toLowerCase())
      if (hits && hits.length) {
        pids.push(...hits)
        if (!exeName) exeName = base
      }
    }
    if (!pids.length) continue
    out.push({
      appName: alias.display,
      key: alias.keys[0],
      exeName,
      pids: Array.from(new Set(pids)),
      protected: isProtectedProcess(exeName)
    })
  }
  return out
}

export async function closeAppByPid(pid: number): Promise<{ closed: boolean; message: string }> {
  const ok = await terminatePid(pid)
  return { closed: ok, message: ok ? `已终止进程 ${pid}` : `没能终止进程 ${pid}` }
}

async function terminatePid(pid: number, gracefulMs = 2500): Promise<boolean> {
  let gracefulOk = false
  try {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T'], {
      timeout: 8000,
      windowsHide: true,
      encoding: 'utf8'
    })
    gracefulOk = true
  } catch {
    gracefulOk = false
  }

  if (gracefulOk) {
    const gone = await waitForExit(pid, gracefulMs)
    if (gone) return true
  }

  try {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      timeout: 8000,
      windowsHide: true,
      encoding: 'utf8'
    })
    return true
  } catch {
    return gracefulOk
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync(
        'tasklist',
        ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        { timeout: 6000, windowsHide: true, encoding: 'utf8' }
      )
      const text = (stdout ?? '').trim()
      if (!text || /no tasks|没有运行|信息:/.test(text) || !text.includes(String(pid))) return true
    } catch {
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

/**
 *
 */
export async function closeApp(appName: string): Promise<CloseAppOutcome> {
  const raw = String(appName ?? '').trim()
  if (!raw) {
    return { closed: false, appName: raw, message: '没说要关哪个应用。', killedPids: [] }
  }

  const alias = resolveApp(raw)
  if (!alias) {
    return {
      closed: false,
      appName: raw,
      message: `「${raw}」不在可管理的应用清单里，我不敢乱关。只能关闭清单里登记过的应用。`,
      killedPids: []
    }
  }

  const exeNames: string[] = []
  for (const p of alias.paths) {
    const base = p.replace(/^.*[\\/]/, '').trim()
    if (base) exeNames.push(base)
  }
  if (!exeNames.length) {
    return {
      closed: false,
      appName: alias.display,
      message: `「${alias.display}」没有登记可执行文件，无法定位它的进程。`,
      killedPids: []
    }
  }

  for (const exe of exeNames) {
    if (isProtectedProcess(exe)) {
      return {
        closed: false,
        appName: alias.display,
        message: `「${alias.display}」对应的是系统关键进程 ${exe}，关掉它会让 Windows 出问题，所以我不动。请用系统自己的方式操作。`,
        killedPids: []
      }
    }
  }

  const rows = await queryProcesses()
  const wanted = new Set(exeNames.map((n) => n.toLowerCase()))
  const targets = rows.filter((r) => wanted.has(r.name.toLowerCase()))

  if (!targets.length) {
    return {
      closed: false,
      appName: alias.display,
      message: `「${alias.display}」现在没在运行，不用关。`,
      killedPids: []
    }
  }

  const safeTargets = targets.filter((t) => !isProtectedProcess(t.name))
  const refused = targets.filter((t) => isProtectedProcess(t.name))
  if (!safeTargets.length) {
    return {
      closed: false,
      appName: alias.display,
      message: `匹配到的进程（${refused.map((r) => r.name).join('、')}）属于系统关键进程，已拒绝关闭。`,
      killedPids: []
    }
  }

  const killed: number[] = []
  const failed: number[] = []
  for (const t of safeTargets) {
    const ok = await terminatePid(t.pid)
    if (ok) killed.push(t.pid)
    else failed.push(t.pid)
  }

  if (!killed.length) {
    return {
      closed: false,
      appName: alias.display,
      message: `试着关「${alias.display}」但没成功（可能权限不够，或者它自己拉起来了新进程）。`,
      killedPids: []
    }
  }

  const pidText = killed.join('、')
  return {
    closed: true,
    appName: alias.display,
    message: `已关闭「${alias.display}」，结束进程 PID ${pidText}${failed.length ? `（另有 ${failed.length} 个没关掉）` : ''}。`,
    killedPids: killed
  }
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'get_hardware_status',
    displayName: '读取硬件状态',
    actionLabel: '读取电脑状态',
    description: 'Reads CPU, memory, GPU and disk status from this machine.',
    defaultPermission: 'always',
    params: []
  },
  {
    name: 'launch_app',
    displayName: '启动本机应用',
    actionLabel: '启动本机应用',
    description: 'Launches an approved local application.',
    defaultPermission: 'once',
    params: [{ key: 'appName', label: '应用名称', required: true, example: '网易云音乐' }]
  },
  {
    name: 'launch_close',
    displayName: '关闭本机应用',
    actionLabel: '关闭本机应用',
    description: 'Closes an approved local application that was launched from the alias table.',
    defaultPermission: 'once',
    params: [{ key: 'appName', label: '应用名称', required: true, example: '网易云音乐' }]
  },
  {
    name: 'open_path',
    displayName: '打开文件或文件夹',
    actionLabel: '打开路径',
    description: 'Opens a file or folder with the system default handler.',
    defaultPermission: 'once',
    params: [{ key: 'path', label: '路径', required: true, example: 'C:\\Users\\Public' }]
  },
  {
    name: 'list_processes',
    displayName: '查看运行中的进程',
    actionLabel: '查看进程',
    description: 'Lists the top processes sorted by memory usage.',
    defaultPermission: 'always',
    params: []
  },
  {
    name: 'get_disk_usage',
    displayName: '查看磁盘占用',
    actionLabel: '查看磁盘',
    description: 'Reports free and used space for every fixed drive.',
    defaultPermission: 'always',
    params: []
  },
  {
    name: 'search_files',
    displayName: '搜索文件',
    actionLabel: '搜索文件',
    description: 'Searches for files by name under a folder.',
    defaultPermission: 'always',
    params: [
      { key: 'keyword', label: '关键词', required: true, example: '报告' },
      { key: 'root', label: '起始目录', required: false, example: 'C:\\Users' }
    ]
  },
  {
    name: 'read_clipboard',
    displayName: '读取剪贴板',
    actionLabel: '读取剪贴板',
    description: 'Reads the current clipboard text content.',
    defaultPermission: 'always',
    params: []
  },
  {
    name: 'write_clipboard',
    displayName: '写入剪贴板',
    actionLabel: '写入剪贴板',
    description: 'Writes text into the system clipboard.',
    defaultPermission: 'once',
    params: [{ key: 'text', label: '内容', required: true, example: '要复制的内容' }]
  },
  {
    name: 'set_volume',
    displayName: '调节系统音量',
    actionLabel: '调节音量',
    description: 'Sets the system output volume to a percentage.',
    defaultPermission: 'once',
    params: [{ key: 'level', label: '音量 0-100', required: true, example: '40' }]
  },
  {
    name: 'take_screenshot',
    displayName: '截取屏幕',
    actionLabel: '屏幕截图',
    description: 'Captures the primary screen and saves it to Pictures.',
    defaultPermission: 'once',
    params: []
  },
  {
    name: 'system_power',
    displayName: '电源操作',
    actionLabel: '电源操作',
    description: 'Lock, sleep, or shut down this machine. Always requires approval.',
    defaultPermission: 'once',
    params: [{ key: 'action', label: '动作', required: true, example: 'lock | sleep | shutdown' }]
  }
]
