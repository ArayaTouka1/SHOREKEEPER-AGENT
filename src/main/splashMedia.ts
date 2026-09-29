import { app, dialog } from 'electron'
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { JsonStore } from './store'
import { allowFile } from './localFile'

function store(): JsonStore<{ file: string; name: string }> {
  return new JsonStore('splash-media', () => ({ file: '', name: '' }))
}
function url(file: string): string {
  allowFile(file)
  return pathToFileURL(file).href.replace(/^file:/, 'appfile:')
}
export function splashMediaStatus(): { custom: boolean; name: string; url: string } {
  const saved = store().read()
  if (saved.file && existsSync(saved.file)) return { custom: true, name: saved.name, url: url(saved.file) }
  const candidates = [join(process.resourcesPath, 'splash', 'opening.mp4'), join(app.getAppPath(), 'resources', 'splash', 'opening.mp4'), join(__dirname, '../../resources/splash/opening.mp4')]
  const file = candidates.find(existsSync)
  return { custom: false, name: '默认开屏动画', url: file ? url(file) : '' }
}
export async function pickSplashMedia(): Promise<ReturnType<typeof splashMediaStatus> | null> {
  const selected = await dialog.showOpenDialog({ title: '选择开屏动画', properties: ['openFile'], filters: [{ name: '视频', extensions: ['mp4', 'webm'] }] })
  if (selected.canceled || !selected.filePaths[0]) return null
  const source = selected.filePaths[0]
  const ext = extname(source).toLowerCase()
  const info = statSync(source)
  if (!['.mp4', '.webm'].includes(ext) || !info.isFile() || info.size === 0 || info.size > 100 * 1024 * 1024) throw new Error('请选择 100 MB 以内的 MP4 或 WebM 视频。')
  const root = join(app.getPath('userData'), 'splash-media')
  mkdirSync(root, { recursive: true })
  const file = join(root, randomUUID() + ext)
  copyFileSync(source, file)
  try { store().write({ file, name: basename(source) }) }
  catch (err) { unlinkSync(file); throw err }
  return splashMediaStatus()
}
export function resetSplashMedia(): ReturnType<typeof splashMediaStatus> {
  store().write({ file: '', name: '' })
  return splashMediaStatus()
}
