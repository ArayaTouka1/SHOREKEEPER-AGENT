/**
 *
 */

import { spawn } from 'node:child_process'
import type { JobInfo } from '../shared/types'

interface RunningJob {
  info: JobInfo
  child: ReturnType<typeof spawn>
  lines: string[]
}

const jobs = new Map<string, RunningJob>()
let jobSeq = 0

let workspaceGetter: () => string = () => process.cwd()

export function setJobsWorkspace(getter: () => string): void {
  workspaceGetter = getter
}

export function listJobs(): JobInfo[] {
  return Array.from(jobs.values())
    .map((j) => j.info)
    .sort((a, b) => b.startedAt - a.startedAt)
}

export function jobOutput(jobId: string, tail = 200): { info: JobInfo; output: string } | null {
  const j = jobs.get(jobId)
  if (!j) return null
  return { info: j.info, output: j.lines.slice(-tail).join('\n') }
}

export function killJob(jobId: string): boolean {
  const j = jobs.get(jobId)
  if (!j) return false
  try {
    j.child.kill()
    j.info.status = 'killed'
    j.info.endedAt = Date.now()
    return true
  } catch {
    return false
  }
}

export function startJob(command: string, label?: string): JobInfo {
  const id = `job_${Date.now().toString(36)}_${++jobSeq}`
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: workspaceGetter(),
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  })

  const info: JobInfo = {
    id,
    label: label?.trim() || command.slice(0, 40),
    command,
    status: 'running',
    exitCode: null,
    startedAt: Date.now(),
    endedAt: null,
    outputLines: 0,
    tail: ''
  }

  const rec: RunningJob = { info, child, lines: [] }
  jobs.set(id, rec)

  const onData = (buf: Buffer): void => {
    const text = buf.toString('utf-8')
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) rec.lines.push(line)
    }
    if (rec.lines.length > 2000) rec.lines = rec.lines.slice(-2000)
    info.outputLines = rec.lines.length
    info.tail = rec.lines.slice(-20).join('\n')
  }

  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('error', (err) => {
    rec.lines.push('[错误] ' + err.message)
    info.status = 'failed'
    info.endedAt = Date.now()
    info.exitCode = -1
  })
  child.on('close', (code) => {
    info.exitCode = code
    info.endedAt = Date.now()
    if (info.status === 'running') {
      info.status = code === 0 ? 'completed' : 'failed'
    }
  })

  return info
}

export function killAllJobs(): void {
  for (const id of jobs.keys()) killJob(id)
}
