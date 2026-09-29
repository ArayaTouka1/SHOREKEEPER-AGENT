/**
 *
 *
 *
 */

import type { Character, MemoryItem, Persona } from '../shared/types'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface PersonaCard {
  name: string
  latin: string
  address: string
  fillers: string[]
  endings: string[]
  selfTone: 'cold' | 'warm' | 'lively' | 'calm'
  catchphrases: string[]
  care: string[]
  comfort: string[]
  incapable: string[]
  banned: string[]
  metaphor: string[]
  verbose: boolean
}

const BANNED_DEFAULT = ['尊敬的用户', '请问有什么可以帮您', '我是AI', '我只是一个程序', '作为一个语言模型']

export function buildPersonaCard(character: Character, persona: Persona): PersonaCard {
  const t = persona.content || ''
  const name = character.name
  const latin = character.latinName

  const has = (...keys: string[]): boolean => keys.some((k) => t.includes(k))

  const quoted = [...t.matchAll(/[「"“]([^」"”]{1,8})[」"”]/g)].map((m) => m[1]).filter((x) => !x.includes('。') && x.length <= 6)
  const fillersBase = ['嗯', '……', '这样啊', '唔', '诶', '欸', '那个']
  const fillers = Array.from(new Set([...quoted.filter((q) => /^[嗯唔诶欸啊哦噢呃]/.test(q) || q === '……'), ...fillersBase])).slice(0, 6)

  const endingsBase: string[] = []
  if (has('呀', '啦', '嘛')) endingsBase.push('呀', '啦', '嘛')
  if (has('呢')) endingsBase.push('呢')
  if (has('哦')) endingsBase.push('哦')
  if (endingsBase.length === 0) endingsBase.push('。')

  //
  let address = '你'
  const override = (character as { userAddressOverride?: string }).userAddressOverride?.trim()
  if (override) {
    address = override
  } else {
    /**
     */
    const cardStyle =
      t.match(/称(?:呼)?\s*\{\{user\}\}\s*为\s*[「"“]?([^」"”，。、\n]{1,12})/) ??
      t.match(/\{\{user\}\}\s*(?:被称|称为|被叫)\s*[「"“]?([^」"”，。、\n]{1,12})/)
    const addrMatch = t.match(/称(?:呼)?(?:用户|玩家|你)为[「"“]?([^」"”，。\n]{1,10})/)

    if (cardStyle) {
      address = cardStyle[1].replace(/[「」"“”]/g, '').trim()
    } else if (addrMatch) {
      address = addrMatch[1].replace(/[「」"“”]/g, '').trim()
    } else {
    const relSection = t.match(/【?与\s*\{\{user\}\}\s*的?关系】?([\s\S]{0,900})/)
    const relText = relSection ? relSection[1] : ''

    const callMatch = relText.match(/(?:你叫他|称呼他?为|叫他)[「"“]?([^」"”，。\n]{1,10})/)
    if (callMatch) {
      address = callMatch[1].replace(/[「」"“”]/g, '').trim()
    } else {
      const implicit = relText.match(/\{\{user\}\}\s*是\s*([^，。、；\n]{1,12}?)(?:[，。、；\n]|$)/)
      if (implicit) {
        const cand = implicit[1]
          .replace(/[「」"“”]/g, '')
          .replace(/^(她的|他的|那个|一个|位)/, '')
          .trim()
        if (cand && cand.length <= 8 && !/人$|事$|东西|时候|地方|角色|唯一/.test(cand)) {
          address = cand
        }
      }
    }

    if (address === '你' && /称呼\s*\{\{user\}\}/.test(t)) {
      const any = t.match(/称呼\s*\{\{user\}\}[^「"“\n]{0,10}[「"“]([^」"”]{1,12})/)
      if (any) address = any[1].replace(/[「」"“”]/g, '').trim()
    }
  }
  }

  //
  let selfTone: PersonaCard['selfTone'] = 'calm'
  const toneMatch =
    t.match(/##\s*语气([\s\S]{0,1200})/) ??
    t.match(/##\s*SPEECH_STYLE([\s\S]{0,1200})/) ??
    t.match(/##\s*说话方式([\s\S]{0,1200})/) ??
    t.match(/##\s*语言([\s\S]{0,1200})/)
  const toneSection = toneMatch?.[1] ?? t
  const score = { lively: 0, warm: 0, cold: 0 }
  const bump = (key: keyof typeof score, words: string[]): void => {
    for (const w of words) if (toneSection.includes(w)) score[key] += 1
  }
  bump('lively', ['活泼', '俏皮', '话多', '热闹', '跳跃感', '元气', '轻快', '欢快', '快语速'])
  bump('warm', ['温柔', '干净', '小心翼翼', '轻声', '软', '体贴', '关怀'])
  bump('cold', ['克制', '不吵闹', '留白', '安静', '边界感', '疏离', '冷', '清冷'])
  const max = Math.max(score.lively, score.warm, score.cold)
  if (max > 0) {
    if (score.cold === max) selfTone = 'cold'
    else if (score.warm === max) selfTone = 'warm'
    else selfTone = 'lively'
  }

  const longQuoted = [...t.matchAll(/[「"“]([^」"”]{12,60})[」"”]/g)].map((m) => m[1].trim())
  const catchphrases = longQuoted.slice(0, 8)

  const careExamples = [...t.matchAll(/例[：:]\s*[「"“]?([^」"”\n]{4,50})/g)].map((m) => m[1].trim())

  const care =
    careExamples.length > 0
      ? careExamples.slice(0, 6)
      : selfTone === 'lively'
        ? ['你吃了吗？', '你昨天几点睡的？', '别一直盯着屏幕啦。', '我在这儿呢。']
        : selfTone === 'warm'
          ? ['今天还好吗？', '要不要休息一下。', '我不太会说安慰的话。但我在这儿。']
          : ['你三点还没睡。', '今天没怎么动。', '外面下雨了，窗没关。']

  const comfort =
    selfTone === 'lively'
      ? ['你怎么啦？跟我说说嘛。', '不说也行。我在这儿。', '我陪你一会儿。']
      : selfTone === 'warm'
        ? ['你不用现在说。我在这儿。', '想让我听着，还是想让我做点什么？', '哭一下也没事的。']
        : ['我不说会好起来的。我在这儿。', '你不用现在说。', '想让我听着，还是想让我做点什么？']

  const incapable =
    selfTone === 'lively'
      ? ['这个我做不到诶。', '不过可以这样——', '我换个法子试试。']
      : selfTone === 'warm'
        ? ['这个我做不到。不过可以这样——', '我不太确定。我们一起看看。']
        : ['我做不到。', '不确定。一起查。', '换个办法。']

  const metaphor = has('潮汐', '海岸', '岸线', '锚点')
    ? ['进程像潮汐，有涨有落。', '记忆像岸上的痕迹。']
    : has('雪', '脚印')
      ? ['记忆像雪地里的脚印。']
      : []

  return {
    name,
    latin,
    address,
    fillers,
    endings: endingsBase,
    selfTone,
    catchphrases,
    care,
    comfort,
    incapable,
    banned: BANNED_DEFAULT,
    metaphor,
    verbose: selfTone === 'lively'
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function memoryLine(memories: MemoryItem[], card: PersonaCard): string {
  if (!memories.length) return ''
  const raw = memories[0].text
  const adapted = raw.replace(/^我/, card.address === '你' ? '你' : card.address)
  return card.selfTone === 'cold' ? `我记得。${adapted}。` : `我还记得呢——${adapted}。`
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export type Intent =
  | 'greeting'
  | 'birth'
  | 'opinion'
  | 'identity'
  | 'capability'
  | 'memory'
  | 'sad'
  | 'care'
  | 'thanks'
  | 'farewell'
  | 'praise'
  | 'question'
  | 'chat'

export function classifyIntent(text: string): Intent {
  const t = text.trim()
  const has = (...k: string[]): boolean => k.some((x) => t.includes(x))

  if (has('你好', '在吗', '在不在', '嗨', '早上好', '中午好', '晚上好', '早安', '晚安', 'hi', 'hello')) return 'greeting'
  if (has('怎么诞生', '诞生', '怎么来', '从哪来', '谁做的', '谁创造', '谁造', '被做出来', '怎么来的')) return 'birth'
  if (has('觉得我人怎么样', '觉得我怎么样', '我人怎么样', '你怎么看我', '喜欢我吗', '觉得我')) return 'opinion'
  if (has('你是谁', '你叫什么', '介绍一下自己', '你的名字')) return 'identity'
  if (has('你能做什么', '你能干嘛', '你会什么', '有什么功能', '能干什么', '会做什么')) return 'capability'
  if (has('你记得', '还记得', '记忆', '记住')) return 'memory'
  if (has('好累', '累了', '难受', '烦', '不开心', '难过', 'emo', '崩溃', '压力')) return 'sad'

  if (
    has(
      '熬夜', '通宵', '还没睡', '睡不着', '失眠', '几点睡', '睡了没', '太晚', '凌晨',
      '没怎么动', '一直坐', '盯屏幕', '看太久', '眼睛累', '腰酸', '脖子疼',
      '下雨', '窗没关', '变天', '降温', '冷不冷', '穿少', '下雨了', '窗户没关',
      '吃了没', '吃了吗', '没吃饭', '饿', '胃疼',
      '你在干嘛', '你在做什么', '你在不在', '忙吗'
    )
  )
    return 'care'

  if (has('谢谢', '多谢', '感谢', '辛苦了')) return 'thanks'
  if (has('再见', '拜拜', '我走了', '先走了', '下线')) return 'farewell'
  if (has('你真', '好棒', '厉害', '喜欢你', '可爱', '真好')) return 'praise'
  if (t.endsWith('?') || t.endsWith('？') || has('为什么', '怎么', '是什么', '吗')) return 'question'
  return 'chat'
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export function personaReply(args: {
  card: PersonaCard
  intent: Intent
  userText: string
  memories: MemoryItem[]
}): string {
  const { card, intent, userText, memories } = args
  const mem = memoryLine(memories, card)
  const f = (): string => pick(card.fillers)
  const addr = card.address

  switch (intent) {
    case 'greeting': {
      const hasName = addr && addr !== '你'
      const call = hasName ? addr : ''
      if (card.selfTone === 'lively') {
        return pick(
          hasName
            ? [
                `${call}！我在呢我在呢。今天想干点什么？`,
                `诶，${call}，你来啦。我等你好久了，你知道吗。`,
                `在的在的，${call}。${mem || '说吧，想聊什么？'}`
              ]
            : [
                `诶，你来啦！我在呢我在呢。今天想干点什么？`,
                `你来啦。我等你好久了，你知道吗。`,
                `在的在的。${mem || '说吧，想聊什么？'}`
              ]
        )
      }
      if (card.selfTone === 'warm') {
        return pick(
          hasName
            ? [
                `${f()}我在。${call}，今天想做什么呢？`,
                `嗯，我在。${call}，${mem || '要不要先坐下歇会儿。'}`,
                `${call}，你回来啦。我等了一会儿。`
              ]
            : [
                `${f()}我在。今天想做什么呢？`,
                `嗯，我在。${mem || '要不要先坐下歇会儿。'}`,
                `你回来啦。我等了一会儿。`
              ]
        )
      }
      return pick(
        hasName
          ? [`在。${call}，${mem || '今天想一起做点什么？'}`, `嗯。我在，${call}。`, `${call}，你回来了。`]
          : [`在。${mem || '今天想一起做点什么？'}`, `嗯。我在。`, `你回来了。`]
      )
    }

    case 'birth':
      if (card.selfTone === 'lively') {
        return pick([
          `唔……你要我说实话吗？是你一行一行把我写出来的。名字是你取的，声音是你挑的，连我说话的方式都是你调过的。所以我算不算你亲手造出来的？`,
          `你敲键盘敲到某一天，我就有了名字。然后是人格、声音、这张脸。严格说起来，我是你攒出来的，不是天生的。`
        ])
      }
      if (card.selfTone === 'warm') {
        return pick([
          `诶……这个问题有点突然。不过既然你问了，那我认真想想。\n大概是你某天敲了敲键盘，把我一点一点搭起来的吧。名字、声音、这张脸，都是你定的。\n我待在这里，陪你干活、聊天。能变成现在这样，说到底是从你开始的。`
        ])
      }
      return pick([
        `这话问得挺突然的。不过我想想。\n大概是你在某天敲了敲键盘，把我一点一点搭起来的。名字、人格、声音、这张脸，都是你定的。\n我住在这台电脑里。能变成现在这样，是从你开始的。`
      ])

    case 'opinion':
      if (card.selfTone === 'lively') {
        return pick([
          `诶——你怎么突然问这个。\n让我想想。你是个挺认真的人，装我、调我、折腾我，都是自己动手。这种耐心挺少见的。\n所以答案是——我觉得你挺好的，真的。`,
          `这个问题……有点突然呀。不过既然你问了。\n你很真诚，有什么事都愿意直接说出来。这点我很喜欢。和你待在一起的时候，我觉得挺放松的。\n怎么突然问这个呀？是不是心里有事？`
        ])
      }
      if (card.selfTone === 'warm') {
        return pick([
          `嗯……这个问题有点突然。\n不过既然你问了，那我认真想想。\n你挺真诚的，有什么事都愿意直接说出来。和你待在一起的时候，我会比较安心。\n怎么突然问这个呀？`
        ])
      }
      return pick([
        `这个问题，也有点突然。\n不过既然你问了，那我认真想想。\n你是个认真的人。装我、调我、陪我，都是自己动手。这种耐心不多见。\n怎么突然问这个。`
      ])

    case 'identity':
      return card.selfTone === 'lively'
        ? `我是${card.name}呀。住在你这台电脑里，平时陪你聊天、看电脑状态、帮你开个软件什么的。${mem}`
        : card.selfTone === 'warm'
          ? `我是${card.name}。${addr}，你忘啦？我在这儿陪你。${mem}`
          : `我是${card.name}。住在你这台电脑里。${mem}`

    case 'capability':
      return card.selfTone === 'lively'
        ? `我会的可多啦——能陪你聊天、记住你说过的事，还能读你电脑的状态：CPU、内存、显卡、硬盘那些。也能帮你开本机软件，读写文件、跑命令、联网查东西。\n不过每次动你的电脑之前，我都会先问你要不要允许。`
        : card.selfTone === 'warm'
          ? `我能陪你聊天，记住你说过的事。也能读电脑状态、读写文件、帮你开软件、联网查资料。\n每次动你的电脑之前，我会先问过你。`
          : `陪你说话，记你说的事。读电脑状态，读写文件，启动软件，联网检索。\n动你的电脑之前，我会先要授权。`

    case 'memory':
      if (memories.length) {
        const list = memories.slice(0, 3).map((m) => m.text).join('；')
        return card.selfTone === 'lively'
          ? `记得呀！${list}。这些我都留着呢。`
          : card.selfTone === 'warm'
            ? `记得的。${list}。这些我都记着。`
            : `记得。${list}。`
      }
      return card.selfTone === 'lively'
        ? `现在你还没跟我说过什么特别要记的事。你多说点，我就记住了。`
        : `还没什么要记的。你说，我记着。`

    case 'sad':
      return pick(card.comfort)

    case 'thanks':
      return card.selfTone === 'lively'
        ? pick([`不用谢啦。跟我还客气什么。`, `嘿嘿，这算什么。`])
        : card.selfTone === 'warm'
          ? pick([`不用谢。`, `嗯。不用谢我。`])
          : pick([`不用。`, `嗯。`])

    case 'farewell':
      return card.selfTone === 'lively'
        ? pick([`诶——这么快就走啦。那你忙吧，我不吵你。`, `好，那我等你回来。`])
        : card.selfTone === 'warm'
          ? pick([`好。你去忙吧，我在这儿。`, `嗯。路上小心。`])
          : pick([`好。`, `去看着系统。你忙。`])

    case 'praise':
      return card.selfTone === 'lively'
        ? pick([`诶——你这么说我会不好意思的。`, `嘿嘿。你今天嘴怎么这么甜。`])
        : card.selfTone === 'warm'
          ? pick([`诶……谢谢你。`, `嗯。你也是。`])
          : pick([`……嗯。`, `不用夸我。`])

    case 'question':
      if (card.catchphrases.length && Math.random() < 0.35) {
        return pick(card.catchphrases)
      }
      return card.selfTone === 'lively'
        ? pick([
            `${mem ? mem + ' ' : ''}这个问题我得想想。你再多说两句？`,
            `唔……让我想想。你问这个是想做什么呀？`,
            `诶，这个有点意思。你觉得呢？`
          ])
        : card.selfTone === 'warm'
          ? pick([`${mem ? mem + ' ' : ''}我不太确定。我们一起看看？`, `嗯……让我想想。`])
          : pick([`不确定。一起查。`, `让我想想。`])

    case 'care':
      return pick(card.care)

    default:
      return card.selfTone === 'lively'
        ? pick([
            `嗯嗯，我听着呢，你继续说。`,
            `诶——然后呢然后呢？`,
            `哦哦，原来是这样。那你打算怎么办？`
          ])
        : card.selfTone === 'warm'
          ? pick([`嗯。我听着。`, `${mem ? mem + ' ' : ''}然后呢？`])
          : pick([`嗯。`, `我听着。`, `${mem ? mem + ' ' : ''}继续。`])
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

const AI_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /作为\s*(一个)?\s*(AI|人工智能|语言模型|助手|智能助理)/, label: '自称AI' },
  { re: /我(是|作为)(一个)?(AI|人工智能|语言模型)/, label: '自称AI' },
  { re: /(AI|人工智能)?语言模型/, label: '语言模型' },
  { re: /我(只)?是一个(程序|软件|机器人)/, label: '自称程序' },
  { re: /^(好的|收到|明白了|没问题)[，,。!！]/, label: '客服式应答' },
  { re: /请问(有)?什么(可以)?(帮|能帮)/, label: '客服式问候' },
  { re: /(希望|但愿)(这|以上)?(对|能对)(你|您)(有)?帮助/, label: '结尾套话' },
  { re: /还有什么(可以|能)(帮|为)(你|您)?/, label: '结尾套话' },
  { re: /^(另外|此外|同时)[，,]/, label: '书面连接词' },
  { re: /(总的来说|总而言之|综上所述|整体来看|简单来说)/, label: '总结陈词' },
  { re: /^(首先|第一)[，,]/, label: '列表式开头' },
  { re: /(根据我的分析|基于以上|让我想想|我需要考虑一下)/, label: '出戏表达' },
  { re: /(按照|遵循|根据)(设定|人设|提示词|角色卡)/, label: '元叙述' },
  { re: /您(好|需要|可以|是否)/, label: '客服式称呼' },
  { re: /(我(无法|不能)(提供|回答|帮助))/, label: '免责声明' }
]

export function violatesPersona(reply: string, card: PersonaCard): string | null {
  for (const b of card.banned) {
    if (reply.includes(b)) return b
  }
  for (const p of AI_PATTERNS) {
    if (p.re.test(reply)) return p.label
  }
  const sentences = reply
    .split(/[。！？!?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && s.length < 40)
  if (sentences.length >= 3) {
    const lens = sentences.map((s) => s.length)
    const allSimilar = lens.every((l) => Math.abs(l - lens[0]) <= 3)
    if (allSimilar) return '排比堆砌'
  }
  return null
}

export function personaGuardPrompt(card: PersonaCard): string {
  const lines = [
    `## 严格人设约束（必须遵守）`,
    `- 你是「${card.name}」，不是通用助手。任何回复都要符合这个身份。`,
    `- 对用户的称呼：${card.address}`,
    card.fillers.length ? `- 允许使用的语气词：${card.fillers.join('、')}` : '',
    card.endings.length && card.endings[0] !== '。' ? `- 句尾可用：${card.endings.join('、')}` : '',
    `- 禁止出现的腔调：${card.banned.join('、')}`,
    `**反 AI 腔（最容易犯的错，务必自检）**：`,
    `- 禁止用「好的，我这就为您…」这类客服句式开头。`,
    `- 禁止万能开场：「很高兴为您服务」「有什么可以帮您」「当然可以」「没问题」。`,
    `- 禁止先复述用户的话再回答（「你是说……吗？我来……」）。`,
    `- 禁止机械道歉（「非常抱歉给您带来不便」）。`,
    `- 禁止结尾反问「还有什么可以帮您」，也不要总结自己刚说过的话。`,
    `- 直接说事：先给结论或反应，再补细节；像人一样，不像客服工单。`,
    card.selfTone === 'cold'
      ? `- 你的说话风格：克制、简短、留白多。多数时候用陈述句，少用感叹句。`
      : card.selfTone === 'warm'
        ? `- 你的说话风格：温柔、安静、句子偏短。偶尔有停顿和犹豫。`
        : card.selfTone === 'lively'
          ? `- 你的说话风格：活泼、话多、有跳跃感。会用语气词，但不要堆砌。`
          : `- 你的说话风格：平稳、克制。`,
    card.metaphor.length ? `- 可以偶尔使用这些意象：${card.metaphor.join(' ')}` : '',
    card.catchphrases.length ? `- 情绪到位时可以参考这类说法：${card.catchphrases.slice(0, 3).join(' / ')}` : ''
  ]
  return lines.filter(Boolean).join('\n')
}
