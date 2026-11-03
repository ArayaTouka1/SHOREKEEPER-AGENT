import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import type { LocalTtsConfig } from '../shared/types'
import { appFetch } from './network'

const PREFIX = '@@INDEXTTS@@'
let child: ChildProcessWithoutNullStreams | null = null
let signature = ''
let ready: Promise<void> | null = null
let sequence = 0
const pending = new Map<string, { resolve(path: string): void; reject(error: Error): void }>()

export interface IndexTtsInstallProgress {
  stage: 'prepare' | 'download' | 'verify' | 'extract' | 'done'
  message: string
  percent: number
  receivedBytes?: number
  totalBytes?: number
}

export interface ReferenceVoice {
  name: string
  path: string
  bytes: number
}

const REFERENCE_AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.m4a', '.aac', '.flac'])

export function listReferenceVoices(directory: string): ReferenceVoice[] {
  if (!directory || !existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && REFERENCE_AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => {
      const path = join(directory, entry.name)
      return { name: entry.name.replace(/\.[^.]+$/, ''), path, bytes: statSync(path).size }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

interface RuntimeManifest {
  version: string
  archiveSha256: string
  archiveBytes: number
  installedBytes?: number
  parts: Array<{ name: string; url: string; bytes: number; sha256: string }>
}

const DEFAULT_MANIFEST_URL = 'https://github.com/ArayaTouka1/SHOREKEEPER-AGENT/releases/download/indextts-runtime-v1.5/indextts-runtime-manifest.json'

async function requestBuffer(url: string): Promise<Buffer> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await appFetch(url, { headers: { 'User-Agent': `Shorekeeper-Agent/${app.getVersion()}` } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((done) => setTimeout(done, attempt * 1500))
    }
  }
  throw new Error(`读取安装清单失败（已重试 3 次）：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function downloadFile(url: string, output: string, expectedBytes: number, onBytes: (bytes: number) => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const existing = existsSync(output) ? statSync(output).size : 0
    if (existing > expectedBytes) rmSync(output, { force: true })
    const offset = existsSync(output) ? statSync(output).size : 0
    const controller = new AbortController()
    let idleTimer: NodeJS.Timeout | undefined
    const resetIdleTimer = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => controller.abort(new Error('下载连接 60 秒无数据')), 60_000)
    }
    try {
      resetIdleTimer()
      const res = await appFetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': `Shorekeeper-Agent/${app.getVersion()}`,
          ...(offset > 0 ? { Range: `bytes=${offset}-` } : {})
        }
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const append = offset > 0 && res.status === 206
      if (offset > 0 && !append) rmSync(output, { force: true })
      const file = createWriteStream(output, { flags: append ? 'a' : 'w' })
      const reader = res.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          resetIdleTimer()
          const chunk = Buffer.from(value)
          if (!file.write(chunk)) await once(file, 'drain')
          onBytes(chunk.length)
        }
        await new Promise<void>((resolveClose, reject) => file.end((error?: Error | null) => error ? reject(error) : resolveClose()))
      } catch (error) {
        file.destroy()
        throw error
      }
      if (statSync(output).size !== expectedBytes) throw new Error(`文件大小不完整：${statSync(output).size}/${expectedBytes}`)
      return
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((done) => setTimeout(done, attempt * 2000))
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
    }
  }
  throw new Error(`分片下载失败（已重试 3 次，可再次点击继续）：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function sha256(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveHash(hash.digest('hex')))
    stream.on('error', reject)
  })
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const proc = spawn(command, args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000) })
    proc.on('error', reject)
    proc.on('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} 执行失败（${code}）：${stderr}`)))
  })
}

export async function installIndexTts(report: (progress: IndexTtsInstallProgress) => void): Promise<{ installDir: string; repo: string; python: string; modelDir: string; message: string }> {
  const manifestUrl = process.env.INDEXTTS_MANIFEST_URL?.trim() || DEFAULT_MANIFEST_URL
  const installRoot = runtimeInstallRoot()
  const workDir = join(installRoot, '.installer')
  const archive = join(workDir, 'indextts-runtime.tar.gz')
  mkdirSync(workDir, { recursive: true })
  report({ stage: 'prepare', message: '正在读取 IndexTTS 安装清单…', percent: 1 })
  const manifest = JSON.parse((await requestBuffer(manifestUrl)).toString('utf8')) as RuntimeManifest
  if (!manifest.parts?.length || !manifest.archiveSha256) throw new Error('IndexTTS 安装清单格式无效')
  const totalBytes = manifest.parts.reduce((sum, part) => sum + part.bytes, 0)
  let receivedBytes = 0
  for (let i = 0; i < manifest.parts.length; i += 1) {
    const part = manifest.parts[i]
    const partPath = join(workDir, part.name)
    if (!existsSync(partPath) || statSync(partPath).size !== part.bytes || await sha256(partPath) !== part.sha256.toLowerCase()) {
      if (existsSync(partPath) && statSync(partPath).size === part.bytes) rmSync(partPath, { force: true })
      const resumedBytes = existsSync(partPath) ? statSync(partPath).size : 0
      receivedBytes += resumedBytes
      await downloadFile(part.url, partPath, part.bytes, (bytes) => {
        receivedBytes += bytes
        report({ stage: 'download', message: `正在下载语音引擎（${i + 1}/${manifest.parts.length}）${resumedBytes ? '，已从断点续传' : ''}…`, percent: Math.min(88, Math.round(receivedBytes / totalBytes * 88)), receivedBytes, totalBytes })
      })
      if (await sha256(partPath) !== part.sha256.toLowerCase()) throw new Error(`下载校验失败：${part.name}`)
    } else {
      receivedBytes += part.bytes
    }
  }
  report({ stage: 'verify', message: '正在合并并校验安装包…', percent: 90, receivedBytes, totalBytes })
  rmSync(archive, { force: true })
  await run('cmd.exe', ['/d', '/c', 'copy', '/b', manifest.parts.map((p) => join(workDir, p.name)).join('+'), archive])
  if (statSync(archive).size !== manifest.archiveBytes || await sha256(archive) !== manifest.archiveSha256.toLowerCase()) throw new Error('IndexTTS 完整安装包校验失败')
  report({ stage: 'extract', message: '正在解压到软件安装目录，请稍候…', percent: 94, receivedBytes, totalBytes })
  mkdirSync(installRoot, { recursive: true })
  await run('tar.exe', ['-xzf', archive, '-C', installRoot])
  const repo = join(installRoot, 'index-tts')
  const python = join(installRoot, 'python313', 'python.exe')
  if (!existsSync(python) || !existsSync(join(repo, 'checkpoints_1_5', 'gpt.pth'))) throw new Error('解压完成，但运行时文件不完整')
  process.env.INDEXTTS_HOME = repo
  process.env.INDEXTTS_PYTHON = python
  rmSync(workDir, { recursive: true, force: true })
  report({ stage: 'done', message: `IndexTTS 已安装到 ${installRoot}`, percent: 100, receivedBytes, totalBytes })
  return { installDir: installRoot, repo, python, modelDir: join(repo, 'checkpoints_1_5'), message: `IndexTTS 已安装到 ${installRoot}` }
}

function devRuntime(): string {
  // In development, keep the large local engine under the project root so it
  // remains available without being copied into packaged application files.
  return resolve(app.getAppPath(), '..', '.runtime')
}

function runtimeInstallRoot(): string {
  return app.isPackaged
    ? join(dirname(process.execPath), 'IndexTTSRuntime')
    : devRuntime()
}

function defaults(cfg: LocalTtsConfig): { python: string; repo: string; modelDir: string; runner: string; installDir: string } {
  const installDir = runtimeInstallRoot()
  const runtime = installDir
  const defaultRepo = join(runtime, 'index-tts')
  const configuredRepo = cfg.serviceCommand.trim()
  const envRepo = process.env.INDEXTTS_HOME?.trim() || ''
  const repo = resolve(
    (configuredRepo && existsSync(configuredRepo) ? configuredRepo : '')
      || (envRepo && existsSync(envRepo) ? envRepo : '')
      || defaultRepo
  )
  const runtimePython = join(repo, '.venv', 'Scripts', 'python.exe')
  const packagedPython = join(runtime, 'python313', 'python.exe')
  const systemPython = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python313', 'python.exe')
    : ''
  const bundledPython = join(repo, '.venv', 'Scripts', 'python.exe')
  const configuredPython = cfg.qwen3Runner.trim()
  const envPython = process.env.INDEXTTS_PYTHON?.trim() || ''
  const python = resolve(
    (configuredPython && existsSync(configuredPython) ? configuredPython : '')
      || (envPython && existsSync(envPython) ? envPython : '')
      || (existsSync(runtimePython) ? runtimePython : '')
      || (existsSync(packagedPython) ? packagedPython : '')
      || (systemPython && existsSync(systemPython) ? systemPython : bundledPython)
  )
  const configuredModelDir = cfg.modelPath.trim()
  const defaultModelDir = join(repo, 'checkpoints_1_5')
  const modelDir = resolve(configuredModelDir && existsSync(configuredModelDir) ? configuredModelDir : defaultModelDir)
  const runner = app.isPackaged
    ? join(process.resourcesPath, 'indextts', 'runner.py')
    : join(app.getAppPath(), 'resources', 'indextts', 'runner.py')
  return { python, repo, modelDir, runner, installDir }
}

export function indexTtsStatus(cfg: LocalTtsConfig): { ok: boolean; message: string; paths: ReturnType<typeof defaults> } {
  const paths = defaults(cfg)
  const missing = [
    paths.python,
    paths.repo,
    paths.runner,
    join(paths.modelDir, 'config.yaml'),
    join(paths.modelDir, 'gpt.pth'),
    ...(existsSync(join(paths.modelDir, 'bigvgan_generator.pth'))
      ? [join(paths.modelDir, 'bigvgan_generator.pth'), join(paths.modelDir, 'bpe.model')]
      : [join(paths.modelDir, 's2mel.pth'), join(paths.modelDir, 'codec.pth')])
  ].filter((p) => !existsSync(p))
  return {
    ok: missing.length === 0,
    message: missing.length
      ? `IndexTTS 尚未安装完整，缺少：${missing.join('；')}`
      : `IndexTTS 1.5 低显存版已就绪（${paths.repo}）`,
    paths
  }
}

function stopWorker(): void {
  const proc = child
  child = null
  ready = null
  if (proc && !proc.killed) proc.kill()
  for (const item of pending.values()) item.reject(new Error('IndexTTS 进程已停止'))
  pending.clear()
}

function ensureWorker(cfg: LocalTtsConfig): Promise<void> {
  const status = indexTtsStatus(cfg)
  if (!status.ok) throw new Error(status.message)
  const nextSignature = JSON.stringify([status.paths.python, status.paths.modelDir, cfg.qwen3Device])
  if (child && signature === nextSignature && ready) return ready
  stopWorker()
  signature = nextSignature
  const tempDir = join(status.paths.repo, '.tmp')
  mkdirSync(tempDir, { recursive: true })
  ready = new Promise<void>((resolveReady, rejectReady) => {
    const proc = spawn(status.paths.python, [status.paths.runner], {
      cwd: status.paths.repo,
      windowsHide: true,
      env: {
        ...process.env,
        INDEXTTS_MODEL_DIR: status.paths.modelDir,
        INDEXTTS_DEVICE: cfg.qwen3Device === 'cpu' ? 'cpu' : 'cuda:0',
        PYTHONPATH: [
          join(status.paths.repo, '.venv', 'Lib', 'site-packages'),
          status.paths.repo,
          process.env.PYTHONPATH
        ].filter(Boolean).join(';'),
        TEMP: tempDir,
        TMP: tempDir,
        PYTHONUTF8: '1'
      }
    })
    child = proc
    let buffer = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const at = line.indexOf(PREFIX)
        if (at < 0) continue
        try {
          const msg = JSON.parse(line.slice(at + PREFIX.length))
          if (msg.type === 'ready') resolveReady()
          else if (msg.type === 'fatal') rejectReady(new Error(msg.error))
          else if (msg.id && pending.has(msg.id)) {
            const item = pending.get(msg.id)!
            pending.delete(msg.id)
            msg.type === 'result' ? item.resolve(msg.path) : item.reject(new Error(msg.error || 'IndexTTS 合成失败'))
          }
        } catch { /* Ignore third-party logging. */ }
      }
    })
    let stderr = ''
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-5000) })
    proc.on('exit', (code) => {
      const error = new Error(`IndexTTS 进程退出（${code ?? 'unknown'}）${stderr ? `：${stderr.slice(-1000)}` : ''}`)
      rejectReady(error)
      if (child === proc) {
        child = null
        ready = null
        for (const item of pending.values()) item.reject(error)
        pending.clear()
      }
    })
  })
  const startup = ready
  const timeout = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error('IndexTTS 模型加载超时（5 分钟）')), 5 * 60 * 1000)
  })
  return Promise.race([startup, timeout])
}

export async function synthesizeIndexTts(cfg: LocalTtsConfig, text: string): Promise<{ path: string; bytes: number }> {
  if (!cfg.refAudioPath || !existsSync(cfg.refAudioPath)) throw new Error('请先选择有效的参考音频（建议 5–15 秒、无背景音乐）')
  const clean = text.replace(/```[\s\S]*?```/g, '').replace(/[*#`>]/g, '').replace(/\s+/g, ' ').trim()
  if (!clean) throw new Error('没有可合成的文本')
  await ensureWorker(cfg)
  const id = `tts_${Date.now().toString(36)}_${++sequence}`
  const cacheDir = join(app.getPath('userData'), 'tts-cache', 'indextts')
  mkdirSync(cacheDir, { recursive: true })
  const hash = createHash('sha1').update(cfg.refAudioPath + '\0' + clean).digest('hex').slice(0, 20)
  const output = join(cacheDir, hash + '.wav')
  if (existsSync(output)) return { path: output, bytes: 0 }
  const result = new Promise<string>((resolveResult, reject) => pending.set(id, { resolve: resolveResult, reject }))
  child!.stdin.write(JSON.stringify({ id, text: clean, voice: cfg.refAudioPath, output, lang: cfg.qwen3Language || 'ZH' }) + '\n')
  const timeout = new Promise<string>((_, reject) => {
    setTimeout(() => {
      pending.delete(id)
      reject(new Error('IndexTTS 语音合成超时（10 分钟）'))
    }, 10 * 60 * 1000)
  })
  const path = await Promise.race([result, timeout])
  return { path, bytes: existsSync(path) ? statSync(path).size : 0 }
}

app.on('before-quit', stopWorker)
