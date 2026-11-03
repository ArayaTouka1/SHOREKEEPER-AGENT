import type { CallRenderConfig } from '../../../shared/types'
import type { CSSProperties } from 'react'
import { SHOREKEEPER_CALL_MODEL } from '../../../shared/callModels'

export const DEFAULT_CALL_RENDER: CallRenderConfig = {
  exposure: 1.08,
  light: 1,
  ambientLight: 1,
  keyLight: 1,
  fillLight: 1,
  rimLight: 1,
  faceLight: 1,
  shadowStrength: 0.5,
  warmth: 0,
  hue: 0,
  blur: 0,
  brightness: 1,
  saturation: 1.4,
  contrast: 1.06,
  zoom: 1,
  verticalOffset: 0
}

export function callRenderKey(characterId: string, characterModelPath?: string, fallbackModelPath?: string): string {
  return characterModelPath?.trim() || fallbackModelPath?.trim() || (characterId === 'char_shorekeeper' ? SHOREKEEPER_CALL_MODEL : '') || `default:${characterId}`
}

export function defaultCallRender(characterId: string): CallRenderConfig {
  return characterId === 'char_shorekeeper'
    ? { ...DEFAULT_CALL_RENDER, exposure: 1, saturation: 1, contrast: 1, brightness: 1 }
    : { ...DEFAULT_CALL_RENDER }
}

export function callRenderStyle(render: CallRenderConfig): CSSProperties {
  return {
    filter: `brightness(${render.brightness}) saturate(${render.saturation}) contrast(${render.contrast}) hue-rotate(${render.hue}deg) blur(${render.blur}px)`,
    transform: `translateY(${render.verticalOffset}%) scale(${render.zoom})`
  }
}
