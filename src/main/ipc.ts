import { BrowserWindow, ipcMain, shell, dialog, app } from 'electron'
import { CH } from '../shared/channels'
import type { IpcResult } from '../shared/types'

export function handle<T>(channel: string, fn: (...args: any[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_evt, ...args): Promise<IpcResult<T>> => {
    try {
      const data = await fn(...args)
      const changes = [CH.settingsSave, CH.settingsReset, CH.characterSave, CH.characterActivate, CH.characterDelete, CH.modelSetActive, CH.modelUpdate, CH.modelAdd, CH.modelRemove, CH.modelDisconnect, CH.machinePermissionSet, CH.workspaceTrust, CH.agentPickWorkspace]
      if ((changes as string[]).includes(channel)) for (const window of BrowserWindow.getAllWindows()) window.webContents.send('app:stateChanged')
      return { ok: true, data }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc] ${channel} 失败:`, message)
      return { ok: false, error: message }
    }
  })
}

export function registerSystemIpc(): void {
  handle(CH.openExternal, async (url: string) => {
    await shell.openExternal(url)
    return true
  })

  handle(CH.pickImage, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择角色图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  handle(CH.pickMedia, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择头图（图片或视频）',
      properties: ['openFile'],
      filters: [
        { name: '图片与视频', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov', 'mkv', 'm4v'] },
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
        { name: '视频', extensions: ['mp4', 'webm', 'mov', 'mkv', 'm4v'] }
      ]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const p = res.filePaths[0]
    const kind: 'image' | 'video' = /\.(mp4|webm|mov|mkv|m4v)$/i.test(p) ? 'video' : 'image'
    return { path: p, kind }
  })

  handle(CH.pickAudio, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择参考音频',
      properties: ['openFile'],
      filters: [
        { name: '音频', extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'aac'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  handle(CH.exportData, async (json: string) => {
    const res = await dialog.showSaveDialog({
      title: '导出陪伴数据',
      defaultPath: `aimis-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return null
    const { writeFileSync } = await import('node:fs')
    writeFileSync(res.filePath, json, 'utf-8')
    return res.filePath
  })

  handle(CH.importData, async () => {
    const res = await dialog.showOpenDialog({
      title: '导入陪伴数据',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const { readFileSync } = await import('node:fs')
    return readFileSync(res.filePaths[0], 'utf-8')
  })

  handle('app:version', () => app.getVersion())
}
