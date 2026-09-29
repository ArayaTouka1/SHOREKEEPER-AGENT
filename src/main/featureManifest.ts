/**
 *
 *
 */

import type { Feature } from './featureBoot'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export const FEATURE_MANIFEST: Array<Omit<Feature, 'register'>> = [
  {
    id: 'stickers',
    label: '表情包',
    description: '角色可以用表情包回话，支持本地库与联网抓取',
    defaultEnabled: true
  },
  {
    id: 'stickerAutoFetch',
    label: '表情包自动抓取',
    description: '角色在对话中按需上网抓取新表情包（需要「表情包」能力）',
    requires: ['stickers'],
    defaultEnabled: false
  },
  {
    id: 'plugins',
    label: '插件系统',
    description: '允许安装第三方插件扩展能力',
    defaultEnabled: true
  },
  {
    id: 'voice',
    label: '语音合成',
    description: '云合成与系统合成的朗读能力',
    defaultEnabled: true
  },
  {
    id: 'attachment',
    label: '附件与文档',
    description: '上传文件、解析文档内容并展示在对话里',
    defaultEnabled: true
  },
  {
    id: 'background',
    label: '动态背景',
    description: '自定义图片/视频背景',
    defaultEnabled: true
  },
  {
    id: 'memory',
    label: '记忆系统',
    description: '长期记忆的写入与召回',
    defaultEnabled: true
  },
  {
    id: 'jobs',
    label: '后台任务',
    description: '长命令后台运行与输出查看',
    defaultEnabled: true
  },
  {
    id: 'web',
    label: '联网能力',
    description: '搜索与抓取网页',
    defaultEnabled: true
  },
  {
    id: 'office',
    label: 'Office 文档',
    description: '生成与编辑 docx / xlsx',
    defaultEnabled: true
  }
]

export const CORE_FEATURES = [
  'chat',
  'settings',
  'conversation',
  'character',
  'persona',
  'model',
  'permission',
  'window',
  'theme',
  'system'
] as const

export function resolveFeatureToggles(
  saved: Record<string, boolean> | undefined
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const f of FEATURE_MANIFEST) {
    out[f.id] = saved?.[f.id] ?? f.defaultEnabled !== false
  }
  return out
}

export function featureListForUi(
  saved: Record<string, boolean> | undefined
): Array<{ id: string; label: string; description: string; enabled: boolean; requires: string[]; locked: boolean }> {
  return FEATURE_MANIFEST.map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    enabled: saved?.[f.id] ?? f.defaultEnabled !== false,
    requires: f.requires ?? [],
    locked: (f.requires ?? []).some((r) => (saved?.[r] ?? true) === false)
  }))
}
