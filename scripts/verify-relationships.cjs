const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')

async function main() {
  const root = path.resolve(__dirname, '..')
  const temp = fs.mkdtempSync(path.join(root, '.verification', 'relationships-'))
  fs.mkdirSync(path.join(temp, 'data'))
  const file = path.join(temp, 'api.cjs')
  await esbuild.build({
    stdin: { contents: "export * from './src/main/characterRuntime'; export * from './src/main/personaPack'; export * from './src/main/character'; export * from './src/main/llm'; export * from './src/main/settings';", resolveDir: root },
    outfile: file, bundle: true, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'electron-stub', setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }))
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const app = {getPath: () => ' + JSON.stringify(temp) + ', getAppPath: () => ' + JSON.stringify(root) + '};' }))
    } }]
  })
  const api = require(file)
  let checks = 0
  const test = async (name, run) => { await run(); checks++; console.log('PASS ' + name) }
  const characters = api.characterRepo.list().filter(c => c.builtin)
  for (const character of characters) {
    await test(character.name + ' binds its own directory and excludes runtime templates', () => {
      const pack = api.loadPersonaPack(character.id.replace('char_', ''), character.name)
      assert.equal(pack.source, 'pack')
      assert.equal(path.basename(pack.directory), character.name)
      assert.ok(pack.files.length >= 13)
      assert.ok(pack.content.includes('核心身份'))
      assert.ok(!pack.content.includes('好感度分层 Opus'))
      assert.ok(!pack.content.includes('预录 Opus'))
      assert.ok(!pack.content.includes('最近事件／待解决事项'))
      for (const hour of [1, 6, 9, 12, 15, 20]) {
        const now = new Date(2026, 8, 28, hour)
        const value = api.relationshipSnapshot(character, now)
        assert.ok(value.greeting && value.source)
        assert.ok(api.relationshipPrompt(character, now, true).includes(value.period))
      }
    })
    await test(character.name + ' selects only the current affinity tier', () => {
      api.resetRelationship(character.id)
      const record = api.relationshipStore.read()[character.id]
      for (const [score, stage] of [[0,'陌生'],[20,'熟悉'],[40,'信任'],[60,'亲密'],[80,'至交'],[100,'至交']]) {
        api.relationshipStore.update(state => { state[character.id] = { ...record, score } })
        const prompt = api.relationshipPrompt(character)
        assert.match(prompt, new RegExp('当前关系阶段：' + stage))
        const snapshot = api.relationshipSnapshot(character)
        assert.equal(snapshot.stage, stage)
        assert.ok(snapshot.progress >= 0 && snapshot.progress <= 100)
      }
      api.resetRelationship(character.id)
    })
  }
  await test('all local time boundaries are correct including midnight', () => {
    const cases = [[0,'Midnight'],[4,'Midnight'],[5,'Dawn'],[7,'Dawn'],[8,'Morning'],[10,'Morning'],[11,'Noon'],[13,'Noon'],[14,'Afternoon'],[17,'Afternoon'],[18,'Evening'],[22,'Evening'],[23,'Midnight']]
    for (const [hour, expected] of cases) assert.equal(api.timePeriod(new Date(2026, 8, 28, hour)).key, expected)
  })
  const character = characters[0]
  const date = new Date(2026, 8, 28, 9)
  await test('repeated messages, duplicate events and quick sending cannot farm affinity', () => {
    api.resetRelationship(character.id)
    const text = '今天想和你一起认真讨论一下我的计划'
    assert.equal(api.recordInteraction(character.id, 'event-1', text, date), true)
    assert.equal(api.recordInteraction(character.id, 'event-1', text, date), false)
    api.recordInteraction(character.id, 'event-2', text, new Date(+date + 600000))
    api.recordInteraction(character.id, 'event-3', text + '新的内容', new Date(+date + 1000))
    assert.equal(api.relationshipSnapshot(character).score, 11)
  })
  await test('daily growth cap, new day, no absence penalty and per-character isolation', () => {
    for (let i = 1; i <= 12; i++) api.recordInteraction(character.id, 'unique-' + i, '不同的有效日常交流记录内容编号' + i, new Date(+date + i * 600000))
    assert.equal(api.relationshipSnapshot(character).score, 16)
    assert.equal(api.relationshipSnapshot(characters[1]).score, 10)
    const later = new Date(2026, 10, 1, 9)
    assert.equal(api.relationshipSnapshot(character, later).score, 16)
    api.recordInteraction(character.id, 'new-day', '今天继续交流新的真实日常内容', later)
    assert.equal(api.relationshipSnapshot(character).score, 17)
    const persisted = JSON.parse(fs.readFileSync(api.relationshipStore.path))
    assert.equal(persisted[character.id].score, 17)
  })
  await test('old overrides and cross-character binding cannot replace the fixed profile', () => {
    api.characterStore.update(state => { state.personaOverrides.persona_shorekeeper = 'OLD OVERRIDE'; state.characters[0].personaId = 'persona_firefly' })
    const current = api.characterRepo.list().find(c => c.id === 'char_shorekeeper')
    assert.equal(current.personaId, 'persona_shorekeeper')
    assert.ok(!api.characterRepo.personaOf(current).content.includes('OLD OVERRIDE'))
    assert.throws(() => api.characterRepo.savePersona({ id: 'persona_shorekeeper', content: 'other' }), /角色文件夹/)
  })
  await test('actual prompt uses character files and only the current affinity tier', async () => {
    const persona = api.characterRepo.personaOf(character)
    const prompt = await api.buildSystemPrompt({ character, persona, settings: api.settingsRepo.get(), memories: [], opening: true, now: date, internalPrompt: 'OLD_INTERNAL_OVERRIDE' })
    assert.match(prompt, /核心身份/)
    assert.match(prompt, /当前关系阶段：陌生/)
    assert.match(prompt, /本时段首次交流/)
    assert.ok(!prompt.includes('好感度分层 Opus（40 条）'))
  })
  console.log(checks + ' relationship checks passed. ' + temp)
}
main().catch(e => { console.error(e); process.exitCode = 1 })
