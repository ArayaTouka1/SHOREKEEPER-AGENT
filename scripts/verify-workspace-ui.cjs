const { _electron: electron, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const http = require('node:http')

async function main() {
  const appRoot = path.resolve(__dirname, '..')
  const fixtures = JSON.parse(fs.readFileSync(path.join(appRoot, '.verification/latest.json'), 'utf8'))
  await require('./workspace-fixtures.cjs')(fixtures.root)
  const profile = fs.mkdtempSync(path.join(fixtures.temp, 'ui-profile-'))
  fs.mkdirSync(path.join(profile, 'data'), { recursive: true })
  const env = { ...process.env, WORKSPACE_TEST_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['--no-sandbox', '--in-process-gpu', path.join(__dirname, 'workspace-test-host.cjs')], cwd: appRoot, env, timeout: 45000 })
  const requests = []
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk
    const body = JSON.parse(text); requests.push(body)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '文档已读取。\n\n' + '这是一段用于检查长回复折叠的实际模型测试结果。'.repeat(100) } }] }))
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  let checks = 0
  const check = async (name, work) => { await work(); checks++; console.log(`PASS ${name}`) }
  try {
    const page = await app.firstWindow()
    const screenshot = async file => {
      const window = await app.browserWindow(page)
      const base64 = await window.evaluate(async bw => (await bw.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'))
      fs.writeFileSync(file, Buffer.from(base64, 'base64'))
    }
    page.on('pageerror', e => console.error('RENDERER', e.message))
    await page.waitForFunction(() => !!window.aimis, { timeout: 30000 })
    await app.evaluate(({ dialog }) => { globalThis.__approvals = 0; dialog.showMessageBox = async () => { globalThis.__approvals++; return { response: 1, checkboxChecked: false } } })
    await page.evaluate(async root => {
      const current = await window.aimis.settings.get()
      await window.aimis.settings.save({ general: { ...current.data.general, skipSplash: true }, agent: { ...current.data.agent, enabled: true, machinePermission: 'workspace', workspace: root } })
      await window.aimis.agent.setWorkspace(root)
    }, fixtures.root)
    await page.reload()
    await page.waitForFunction(() => !!document.querySelector('.main-area'), { timeout: 30000 })
    await page.keyboard.press('Control+5')
    await expect(page.locator('.file-workspace')).toBeVisible()
    await check('directory browser lists actual Chinese filename', async () => expect(page.getByRole('button', { name: '说明 文档.md', exact: true })).toBeVisible())
    await check('workspace trust is changeable through UI', async () => {
      await page.getByRole('button', { name: '权限', exact: true }).click()
      await page.getByRole('checkbox', { name: '信任此工作区' }).check()
      await expect(page.getByRole('checkbox', { name: '信任此工作区' })).toBeChecked()
      assert.equal((await page.evaluate(() => window.aimis.agent.security())).data.trusted, true)
    })
    await check('command rule can be added and revoked', async () => {
      await page.getByRole('textbox', { name: '完整命令', exact: true }).fill('Write-Output gui-rule')
      await page.getByRole('button', { name: '添加规则', exact: true }).click()
      await expect(page.getByText('Write-Output gui-rule', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '删除规则', exact: true }).click()
      await expect(page.getByText('暂无命令规则', { exact: true })).toBeVisible()
    })
    await page.locator('.file-workspace').getByRole('button', { name: '文件', exact: true }).click()
    await check('Markdown preview renders a real table', async () => {
      await page.getByRole('button', { name: '说明 文档.md', exact: true }).click()
      await expect(page.locator('.markdown-preview h1')).toHaveText('Workspace Preview')
      await expect(page.locator('.markdown-preview table')).toBeVisible()
      await screenshot(path.join(fixtures.temp, 'preview-markdown.png'))
    })
    await check('text editing writes through preload, approval, and main process', async () => {
      await page.getByRole('button', { name: '编辑', exact: true }).click()
      await page.getByRole('textbox', { name: '文件内容', exact: true }).fill('# Saved from UI\n\n真实保存成功。')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
      assert.match(fs.readFileSync(path.join(fixtures.root, '说明 文档.md'), 'utf8'), /真实保存成功/)
      assert.equal(await app.evaluate(() => globalThis.__approvals), 1)
      await page.locator('.document-window').getByRole('button', { name: '关闭', exact: true }).click()
    })
    async function open(file) { await page.evaluate(filePath => window.dispatchEvent(new CustomEvent('document-preview', { detail: filePath })), path.join(fixtures.root, file)) }
    async function close() { await page.locator('.document-window').getByRole('button', { name: '关闭', exact: true }).click() }
    await check('PDF paints canvas and paginates', async () => {
      await open('sample.pdf')
      await page.waitForFunction(() => { const c = document.querySelector('.pdf-canvas canvas'); if (!c || c.width < 500) return false; const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && pixels[i] < 100) ink++; return ink > 100 })
      await page.getByRole('button', { name: '下一页', exact: true }).click()
      await expect(page.getByText('2 / 2', { exact: true })).toBeVisible()
      await screenshot(path.join(fixtures.temp, 'preview-pdf.png')); await close()
    })
    await check('DOCX renders Word body in isolated frame', async () => {
      await open('sample.docx')
      await expect(page.frameLocator('.office-frame').getByText('Workspace DOCX Preview', { exact: true })).toBeVisible({ timeout: 20000 })
      await screenshot(path.join(fixtures.temp, 'preview-docx.png')); await close()
    })
    await check('PPTX renders actual slide text', async () => {
      await open('slides.pptx')
      await expect(page.frameLocator('.office-frame').getByText('Workspace Slide 1', { exact: true })).toBeVisible({ timeout: 20000 })
      await screenshot(path.join(fixtures.temp, 'preview-slides.png')); await close()
    })
    await check('XLSX sheets can be switched', async () => {
      await open('workbook.xlsx')
      await expect(page.locator('.sheet-table')).toContainText('产品')
      await page.getByRole('combobox', { name: '工作表', exact: true }).selectOption('1')
      await expect(page.locator('.sheet-table')).toContainText('Total')
      await screenshot(path.join(fixtures.temp, 'preview-sheet.png')); await close()
    })
    await check('CSV preview retains quoted commas', async () => {
      await open('data.csv')
      await expect(page.locator('.sheet-table')).toContainText('hello, world')
      await close()
    })
    await check('directory search returns real files', async () => {
      await page.getByRole('textbox', { name: '搜索文件名', exact: true }).fill('*.pdf')
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      await expect(page.locator('.file-entry')).toHaveCount(1)
    })
    await screenshot(path.join(fixtures.temp, 'workspace-desktop.png'))
    await check('preview layout remains usable at narrow viewport', async () => {
      await page.setViewportSize({ width: 390, height: 844 })
      await open('说明 文档.md')
      await expect(page.locator('.markdown-preview h1')).toHaveText('Saved from UI')
      assert.equal(await page.locator('.document-window').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
      await screenshot(path.join(fixtures.temp, 'preview-mobile.png'))
    })
    await close()
    await page.setViewportSize({ width: 1280, height: 900 })
    await check('attachment and input text reach the model together', async () => {
      const endpoint = 'http://127.0.0.1:' + server.address().port + '/v1'
      await page.evaluate(async ({ endpoint, file }) => {
        const config = (await window.aimis.settings.get()).data
        await window.aimis.settings.save({ voice: { ...config.voice, ttsEnabled: false } })
        const model = await window.aimis.model.add({ name: 'Actual test A', kind: 'api', baseUrl: endpoint, model: 'real-a', apiKey: 'test-only' })
        await window.aimis.model.setActive(model.data.model.id)
        await window.aimis.attachment.importFile(file)
      }, { endpoint, file: path.join(fixtures.root, 'sample.docx') })
      await page.reload()
      await page.waitForFunction(() => !!document.querySelector('.main-area'))
      await page.keyboard.press('Control+2')
      await page.getByTestId('attach-btn').click()
      await page.locator('.att-row-main').filter({ hasText: 'sample.docx' }).click()
      await expect(page.getByTestId('attachment-chips')).toContainText('KB')
      await page.getByTestId('attachment-chips').getByRole('button', { name: /sample.docx/ }).click()
      await expect(page.frameLocator('.office-frame').getByText('Workspace DOCX Preview', { exact: true })).toBeVisible()
      await close()
      await page.locator('textarea').fill('概括附件正文，并保留此条文字。')
      await page.getByTestId('chat-send').click()
      await expect.poll(() => requests.length, { timeout: 20000 }).toBe(1)
      assert.equal(requests[0].model, 'real-a')
      assert.match(requests[0].messages.at(-1).content, /概括附件正文/)
      assert.match(requests[0].messages[0].content, /Workspace DOCX Preview/)
      await expect(page.getByRole('button', { name: '展开全文', exact: true })).toBeVisible()
      await expect(page.getByTestId('msg-attachments')).toContainText('sample.docx')
      await screenshot(path.join(fixtures.temp, 'chat-attachment.png'))
    })
    await check('model switching affects next request; attachment-only sending works', async () => {
      const next = await page.evaluate(async endpoint => {
        const added = await window.aimis.model.add({ name: 'Actual test B', kind: 'api', baseUrl: endpoint, model: 'real-b', apiKey: 'test-only' })
        return added.data.model.id
      }, 'http://127.0.0.1:' + server.address().port + '/v1')
      await page.evaluate(id => window.aimis.model.setActive(id), next)
      await page.reload()
      await page.waitForFunction(() => !!document.querySelector('.main-area'))
      await page.keyboard.press('Control+2')
      await expect(page.getByTestId('msg-attachments')).toContainText('sample.docx')
      await page.getByTestId('attach-btn').click()
      await page.locator('.att-row-main').filter({ hasText: 'sample.docx' }).click()
      await expect(page.getByTestId('chat-send')).toBeEnabled()
      await page.getByTestId('chat-send').click()
      await expect.poll(() => requests.length, { timeout: 20000 }).toBe(2)
      assert.equal(requests[1].model, 'real-b')
      assert.match(requests[1].messages[0].content, /Workspace DOCX Preview/)
      await expect(page.getByTestId('msg-attachments')).toHaveCount(2)
    })
    console.log(`\n${checks} GUI checks passed. Screenshots: ${fixtures.temp}`)
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); await new Promise(done => server.close(done)) }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
