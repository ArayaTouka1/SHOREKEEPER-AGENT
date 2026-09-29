/**
 *
 *
 */

const fs = require('node:fs')
const path = require('node:path')

const STICKER_ROOT = path.resolve(__dirname, '..', 'resources', 'stickers')

/**
 */
const SHOREKEEPER_TAGS = [
  { m: 'shy', t: ['害羞', '脸红', '不好意思'] },
  { m: 'think', t: ['思考', '托腮', '想一想'] },
  { m: 'calm', t: ['平静', '闭眼', '安静'] },
  { m: 'shy', t: ['害羞', '捂脸', '被夸'] },
  { m: 'shock', t: ['惊讶', '震惊', '没想到'] },
  { m: 'shy', t: ['害羞', '捂脸'] },

  { m: 'shy', t: ['害羞', '低头'] },
  { m: 'eat', t: ['喝东西', '喝茶', '吃饭'] },
  { m: 'heart', t: ['比心', '爱心', '喜欢你'] },
  { m: 'sleep', t: ['困', '睡觉', '趴着'] },
  { m: 'happy', t: ['开心', '笑', '高兴'] },
  { m: 'cheer', t: ['加油', '欢呼', '打气'] },

  { m: 'confuse', t: ['疑惑', '摊手', '不解'] },
  { m: 'sad', t: ['难过', '失落', '委屈'] },
  { m: 'heart', t: ['比心', '爱心'] },
  { m: 'thumbsup', t: ['点赞', '赞同', '好厉害', '干得好'] },
  { m: 'confuse', t: ['疑惑', '问号', '不懂'] },
  { m: 'shy', t: ['害羞', '脸红'] },

  { m: 'run', t: ['跑', '冲', '兴奋', '来啦'] },
  { m: 'bored', t: ['无聊', '没事做', '发呆'] },
  { m: 'calm', t: ['平静', '坐着', '陪伴'] },
  { m: 'shock', t: ['惊讶', '张嘴', '啊'] },
  { m: 'wave', t: ['打招呼', '挥手', '你好', '来了'] },
  { m: 'shy', t: ['害羞', '捂脸'] },

  { m: 'cry', t: ['大哭', '崩溃', '受不了'] },
  { m: 'calm', t: ['温柔', '微笑', '安静'] },
  { m: 'think', t: ['思考', '托腮', '想想'] },
  { m: 'shock', t: ['惊讶', '意外', '真的吗'] },
  { m: 'shy', t: ['害羞', '捂嘴'] },
  { m: 'star', t: ['星星', '闪亮', '眼睛发光', '期待'] },

  { m: 'heart', t: ['比心', '爱你'] },
  { m: 'music', t: ['音乐', '演奏', '琴'] },
  { m: 'book', t: ['看书', '读书', '学习'] },
  { m: 'calm', t: ['平静', '坐着'] },
  { m: 'hug', t: ['抱', '玩偶', '拥抱'] },
  { m: 'wave', t: ['挥手', '打招呼'] },

  { m: 'sleep', t: ['困', '睡着', '疲惫'] },
  { m: 'gift', t: ['礼物', '送你', '惊喜'] },
  { m: 'cheer', t: ['加油', '鼓劲', '你可以的'] },
  { m: 'happy', t: ['开心', '坐着笑'] },
  { m: 'shy', t: ['害羞', '捂脸'] },
  { m: 'angry', t: ['生气', '不满', '无语', '汗'] },

  { m: 'cry', t: ['大哭', '崩溃', '呜'] },
  { m: 'sad', t: ['难过', '低落', '不开心'] },
  { m: 'shy', t: ['害羞', '脸红'] },
  { m: 'shock', t: ['惊讶', '张嘴', '惊'] },
  { m: 'sad', t: ['委屈', '难受'] },
  { m: 'cake', t: ['蛋糕', '生日', '庆祝'] },

  { m: 'gift', t: ['礼物', '送给你'] },
  { m: 'flower', t: ['花', '送你花', '浪漫'] },
  { m: 'heart', t: ['比心', '喜欢'] },
  { m: 'sleep', t: ['困', '睡'] },
  { m: 'calm', t: ['坐着', '平静'] },
  { m: 'think', t: ['托腮', '思考'] },

  { m: 'akimbo', t: ['叉腰', '得意', '我可是'] },
  { m: 'heart', t: ['比心', '爱你'] },
  { m: 'piano', t: ['弹琴', '钢琴', '演奏'] }
]

console.log('\n================ 表情包语义标注 ================\n')

const dirs = fs.readdirSync(STICKER_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory())
let grand = 0

for (const d of dirs) {
  const dir = path.join(STICKER_ROOT, d.name)
  const idxFile = path.join(dir, 'index.json')
  if (!fs.existsSync(idxFile)) continue

  const idx = JSON.parse(fs.readFileSync(idxFile, 'utf-8'))
  const tags = d.name === 'shorekeeper' ? SHOREKEEPER_TAGS : null

  let tagged = 0
  idx.stickers.forEach((s, i) => {
    if (tags && tags[i]) {
      s.mood = tags[i].m
      s.tags = tags[i].t
      tagged++
    } else if (!s.tags || !s.tags.length) {
      s.mood = s.mood || 'neutral'
      s.tags = s.tags && s.tags.length ? s.tags : ['通用']
    }
  })

  idx.taggedAt = new Date().toISOString()
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2), 'utf-8')

  const moods = {}
  idx.stickers.forEach((s) => {
    moods[s.mood] = (moods[s.mood] || 0) + 1
  })

  console.log(`  ${d.name}/  ${idx.stickers.length} 张，标注 ${tagged} 张`)
  console.log(
    '    情绪分布: ' +
      Object.entries(moods)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}×${v}`)
        .join('  ')
  )
  grand += tagged
}

console.log(`\n  合计标注 ${grand} 张\n`)
