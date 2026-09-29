import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

let dataDir = ''

export function ensureDataDir(): string {
  if (!dataDir) {
    dataDir = join(app.getPath('userData'), 'data')
  }
  if (!existsSync(dataDir)) {
    // A new profile must not silently import data from another application.
    mkdirSync(dataDir, { recursive: true })
  }
  return dataDir
}

export function assetDir(): string {
  const d = join(ensureDataDir(), 'assets')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/**
 */
export class JsonStore<T> {
  private readonly file: string
  private cache: T | null = null

  /**
   */
  constructor(
    name: string,
    private readonly fallback: () => T,
    dir?: string
  ) {
    this.file = join(dir ?? ensureDataDir(), `${name}.json`)
  }

  get path(): string {
    return this.file
  }

  read(): T {
    if (this.cache) return this.cache
    try {
      if (existsSync(this.file)) {
        const raw = readFileSync(this.file, 'utf-8')
        this.cache = JSON.parse(raw) as T
        return this.cache
      }
    } catch (err) {
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        /* ignore */
      }
      console.error(`[store] ${this.file} 读取失败，已回退默认值`, err)
    }
    this.cache = this.fallback()
    this.write(this.cache)
    return this.cache
  }

  write(value: T): void {
    ensureDataDir()
    this.cache = value
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8')
    renameSync(tmp, this.file)
  }

  /**
   */
  update(mutator: (draft: T) => T | void): T {
    const draft = structuredClone(this.read())
    const returned = mutator(draft)
    const next = (returned ?? draft) as T
    this.write(next)
    return next
  }

  backupTo(target: string): void {
    ensureDataDir()
    copyFileSync(this.file, target)
  }
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
