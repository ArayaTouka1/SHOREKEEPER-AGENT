/**
 *
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCardObject, type CharacterCard } from './characterCard'
import { builtinPersonaDir, PERSONA_PACKS } from './personaPack'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export {
  builtinPersonaDir,
  userPersonaDir,
  PERSONA_PACKS,
  PERSONA_FILES,
  loadPersonaPack,
  loadBuiltinPersonas,
  readUserPersonas,
  exportPersona,
  importPersonaFile
} from './personaPack'

export type { ImportedPersona, PersonaPack, PersonaPackFile } from './personaPack'

let cachedCardDir: string | null = null

export function builtinCardDir(): string {
  if (cachedCardDir) return cachedCardDir
  const candidates = [
    join(process.resourcesPath ?? '', 'cards'),
    join(join(process.cwd(), 'resources'), 'cards'),
    join(join(__dirname, '..', '..'), 'resources', 'cards')
  ]
  for (const dir of candidates) {
    if (dir && existsSync(dir)) {
      cachedCardDir = dir
      return dir
    }
  }
  cachedCardDir = join(process.resourcesPath ?? '', 'cards')
  return cachedCardDir
}

export function readCharacterCard(characterId: string): CharacterCard | null {
  const meta = PERSONA_PACKS.find((p) => p.characterId === characterId)
  if (!meta) return null
  const full = join(builtinCardDir(), `${meta.pack}.json`)
  if (!existsSync(full)) return null
  try {
    return parseCardObject(JSON.parse(readFileSync(full, 'utf-8')))
  } catch {
    return null
  }
}

export function readInternalPrompt(characterId: string): string {
  const meta = PERSONA_PACKS.find((p) => p.characterId === characterId)
  if (!meta) return ''
  const dir = join(builtinPersonaDir(), meta.pack)
  const file = join(dir, '90-越狱.md')
  if (!existsSync(file)) return ''
  try {
    return readFileSync(file, 'utf-8').trim()
  } catch {
    return ''
  }
}
