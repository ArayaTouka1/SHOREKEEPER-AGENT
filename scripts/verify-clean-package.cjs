const { _electron: electron, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '..')
  const parent = fs.mkdtempSync(path.join(root, '.verification/clean-package-'))
  const profile = path.join(parent, 'fresh-user')
  fs.mkdirSync(profile)
  // A legacy profile nearby must never be copied into a fresh installation.
  const legacy = path.join(parent, 'aimis-agent/data')
  fs.mkdirSync(legacy, { recursive: true })
  fs.writeFileSync(path.join(legacy, 'personal-marker.txt'), 'PRIVATE_TEST_SENTINEL')
  const env = { ...process.env, WORKSPACE_TEST_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  let app
  try {
    app = await electron.launch({ args: ['--no-sandbox', '--in-process-gpu', path.join(__dirname, 'package-test-host.cjs')], cwd: root, env, timeout: 45000 })
    const page = await app.firstWindow()
    await page.waitForFunction(() => !!window.aimis)
    const state = await page.evaluate(async () => ({
      settings: await window.aimis.settings.get(),
      conversations: await window.aimis.conversation.list(),
      memories: await window.aimis.memory.list(),
      attachments: await window.aimis.attachment.list(),
      characters: await window.aimis.character.list()
    }))
    for (const [key, result] of Object.entries(state)) assert.equal(result.ok, true, key + ' IPC failed')
    assert.deepEqual(state.conversations.data, [])
    assert.deepEqual(state.memories.data, [])
    assert.deepEqual(state.attachments.data, [])
    for (const group of ['llm', 'inworld', 'cloudTts']) assert.equal(state.settings.data[group].apiKey, '')
    assert.equal(state.settings.data.voice.sttModelDir, '')
    assert.equal(state.settings.data.agent.workspace, '')
    assert.equal(state.settings.data.agent.machinePermission, 'view')
    assert.equal(fs.existsSync(path.join(profile, 'data/personal-marker.txt')), false)
    const splash = await page.evaluate(() => window.aimis.splash.status())
    assert.equal(splash.ok, true)
    assert.equal(splash.data.custom, false)
    assert.ok(splash.data.url.endsWith('/splash/opening.mp4'))
    for (const id of ['char_shorekeeper', 'char_aemeath', 'char_firefly', 'char_chloe']) {
      const relation = await page.evaluate(id => window.aimis.relationship.get(id), id)
      assert.equal(relation.ok, true)
      assert.equal(relation.data.stage, '陌生')
      assert.equal(relation.data.score, 0)
      assert.ok(relation.data.source.includes('release\\win-unpacked\\resources\\persona-profiles'))
      assert.ok(relation.data.files >= 10)
    }
    await page.evaluate(async () => {
      const s = (await window.aimis.settings.get()).data
      await window.aimis.settings.save({ general: { ...s.general, skipSplash: true } })
    })
    await page.reload()
    await page.waitForFunction(() => !!document.querySelector('.main-area'))
    await page.keyboard.press('Control+6')
    await expect(page.getByTestId('affinity-panel').getByText('陌生', { exact: true })).toBeVisible()
    await expect(page.getByTestId('persona-editor')).toHaveCount(0)
    console.log('PASS packaged application opens with empty conversations, memory, attachments, API keys and workspace; four fresh relationships and packaged profiles; no legacy import; new settings UI.')
    fs.writeFileSync(path.join(root, 'release/clean-start-verification.json'), JSON.stringify({ result: 'PASS', testedAt: new Date().toISOString(), version: await app.evaluate(({ app }) => app.getVersion()) }, null, 2))
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}) }
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
