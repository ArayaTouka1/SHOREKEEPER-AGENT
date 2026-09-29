export const RELATIONSHIP_STAGES = ['陌生', '熟悉', '信任', '亲密', '至交'] as const
export interface CharacterRelationship {
  characterId: string
  score: number
  stage: string
  progress: number
  nextStage: string | null
  period: string
  greeting: string
  greetingRaw: string
  summary: string
  identity: string
  traits: string[]
  source: string
  files: number
  lastInteractionAt: number | null
}
