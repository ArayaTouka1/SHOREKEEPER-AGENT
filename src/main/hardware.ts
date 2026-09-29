import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import { existsSync } from 'node:fs'
import type { HardwareStatus } from '../shared/types'

const execFileAsync = promisify(execFile)

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function cpuTimes(): { idle: number; total: number } {
  let idle = 0
  let total = 0
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v
    idle += c.times.idle
  }
  return { idle, total }
}

async function cpuLoadPercent(sampleMs = 220): Promise<number> {
  const a = cpuTimes()
  await new Promise((r) => setTimeout(r, sampleMs))
  const b = cpuTimes()
  const idleDelta = b.idle - a.idle
  const totalDelta = b.total - a.total
  if (totalDelta <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)))
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

async function gpuStatus(): Promise<HardwareStatus['snapshot']['gpu']> {
  const candidates = [
    'nvidia-smi',
    'C:\\Windows\\System32\\nvidia-smi.exe',
    'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe'
  ]
  const args = [
    '--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total',
    '--format=csv,noheader,nounits'
  ]
  for (const bin of candidates) {
    if (bin.includes('\\') && !existsSync(bin)) continue
    try {
      const { stdout } = await execFileAsync(bin, args, { timeout: 4000, windowsHide: true })
      const line = stdout.trim().split(/\r?\n/)[0]
      if (!line) continue
      const [name, temp, util, used, total] = line.split(',').map((s) => s.trim())
      return {
        name,
        temperatureC: Number.isFinite(Number(temp)) ? Number(temp) : null,
        loadPercent: Number.isFinite(Number(util)) ? Number(util) : null,
        vramUsedGB: Number.isFinite(Number(used)) ? +(Number(used) / 1024).toFixed(2) : null,
        vramTotalGB: Number.isFinite(Number(total)) ? +(Number(total) / 1024).toFixed(2) : null
      }
    } catch {
    }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

async function cpuTemperature(): Promise<number | null> {
  if (process.platform !== 'win32') return null
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'try { (Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Select-Object -First 1).CurrentTemperature } catch { "" }'
      ],
      { timeout: 6000, windowsHide: true }
    )
    const raw = Number(stdout.trim())
    if (!Number.isFinite(raw) || raw <= 0) return null
    return Math.round(raw / 10 - 273.15)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

async function disks(): Promise<HardwareStatus['snapshot']['disk']> {
  if (process.platform !== 'win32') return []
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { "$($_.DeviceID)|$([math]::Round($_.Size/1GB,1))|$([math]::Round(($_.Size-$_.FreeSpace)/1GB,1))" }'
      ],
      { timeout: 6000, windowsHide: true }
    )
    return stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [mount, total, used] = line.split('|')
        const t = Number(total)
        const u = Number(used)
        return {
          mount,
          totalGB: t,
          usedGB: u,
          usedPercent: t > 0 ? Math.round((u / t) * 100) : 0
        }
      })
  } catch {
    return []
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export async function collectHardware(): Promise<HardwareStatus> {
  const cpus = os.cpus()
  const [load, temp, gpu, disk] = await Promise.all([cpuLoadPercent(), cpuTemperature(), gpuStatus(), disks()])

  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem

  const snapshot: HardwareStatus['snapshot'] = {
    timestamp: new Date().toISOString(),
    status: 'ok',
    cpu: {
      name: cpus[0]?.model?.trim() ?? 'Unknown CPU',
      loadPercent: load,
      temperatureC: temp,
      maxCoreTemperatureC: temp,
      cores: cpus.length,
      threads: cpus.length,
      speedGHz: cpus[0] ? +(cpus[0].speed / 1000).toFixed(2) : 0
    },
    memory: {
      totalGB: +(totalMem / 1024 ** 3).toFixed(1),
      usedGB: +(usedMem / 1024 ** 3).toFixed(1),
      usedPercent: Math.round((usedMem / totalMem) * 100)
    },
    gpu,
    disk,
    os: {
      platform: `${os.type()} ${os.release()}`,
      release: os.version(),
      hostname: os.hostname(),
      uptimeHours: +(os.uptime() / 3600).toFixed(1)
    }
  }

  return { status: 'ok', snapshot }
}
