const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const esbuild = require('esbuild')

async function main() {
  const app = path.resolve(__dirname, '..')
  const output = path.join(app, '.verification')
  fs.mkdirSync(output, { recursive: true })
  const temp = fs.mkdtempSync(path.join(output, 'workspace-'))
  const root = path.join(temp, '中文 workspace')
  const external = path.join(temp, 'outside')
  const userData = path.join(temp, 'profile')
  fs.mkdirSync(root); fs.mkdirSync(external); fs.mkdirSync(path.join(userData, 'data'), { recursive: true })
  await require('./workspace-fixtures.cjs')(root)
  const bundle = path.join(temp, 'test-api.cjs')
  await esbuild.build({ stdin: { contents: "export * from './src/main/agentTools'; export * from './src/main/permission'; export * from './src/main/workspaceSecurity'; export * from './src/main/documents'; export * from './src/main/fileIntent'; export * from './src/main/toolConversation'; export * from './src/main/attachments'; export * from './src/main/chat'; export * from './src/main/modelRouting'; export * from './src/main/models'; export * from './src/main/settings';", resolveDir: app }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'electron-test', setup(build) { build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' })); build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `export const protocol = {}; export const net = {}; export const app = { getPath: () => ${JSON.stringify(userData)}, getAppPath: () => ${JSON.stringify(app)} };` })) } }] })
  const api = require(bundle)
  api.setWorkspace(root)
  api.setMachinePermission('workspace')
  let tests = 0
  async function test(name, work) { await work(); tests++; console.log(`PASS ${name}`) }
  let approvals = 0
  let response = 'once'
  api.installApprovalPrompt(async () => { approvals++; return response })
  const run = (name, params) => api.runAgentTool(name, params)
  await test('untrusted workspace permits directory listing', async () => assert.ok((await run('fs_list', { path: root })).result.entries.length >= 6))
  await test('untrusted workspace blocks writes', async () => assert.rejects(run('fs_write', { path: 'blocked.txt', content: 'no' }), /只读/))
  api.setWorkspaceTrust(root, true)
  await test('write and read Chinese path with nested parents', async () => { await run('fs_write', { path: '新目录/a b.txt', content: '真实写入\n第二行' }); assert.equal(fs.readFileSync(path.join(root, '新目录/a b.txt'), 'utf8'), '真实写入\n第二行'); assert.match((await run('fs_read', { path: '新目录/a b.txt' })).context, /真实写入/) })
  await test('quoted absolute path resolves before permission check', async () => { await run('fs_write', { path: `"${path.join(root, 'quoted.txt')}"`, content: 'quoted' }); assert.ok(fs.existsSync(path.join(root, 'quoted.txt'))) })
  await test('append and exact edit persist', async () => { await run('fs_append', { path: 'quoted.txt', content: '\nappend' }); await run('fs_edit', { path: 'quoted.txt', oldText: 'quoted', newText: 'updated' }); assert.equal(fs.readFileSync(path.join(root, 'quoted.txt'), 'utf8'), 'updated\nappend') })
  await test('new file operation cannot replace an existing file', async () => assert.rejects(run('fs_write', { path: 'quoted.txt', content: '', createOnly: true }), /已存在/))
  await test('version conflict prevents lost updates', async () => { const doc = await api.openDocument(path.join(root, 'quoted.txt')); fs.appendFileSync(doc.path, '\nexternal'); await assert.rejects(run('fs_write', { path: doc.path, content: 'lost', expectedVersion: doc.version }), /其他程序修改/); assert.match(fs.readFileSync(doc.path, 'utf8'), /external/) })
  fs.writeFileSync(path.join(external, 'external.txt'), 'external readable')
  await test('read outside workspace without escalating tier', async () => assert.match((await run('fs_read', { path: path.join(external, 'external.txt') })).context, /external readable/))
  await test('glob honors outside search directory and root-level ** matches', async () => assert.equal((await run('fs_glob', { path: external, pattern: '**/*.txt' })).result.files.length, 1))
  await test('copy reads external source and writes workspace destination', async () => { await run('fs_copy', { src: path.join(external, 'external.txt'), dst: 'copy.txt' }); assert.equal(fs.readFileSync(path.join(root, 'copy.txt'), 'utf8'), 'external readable') })
  await test('workspace tier blocks outside writes', async () => assert.rejects(run('fs_write', { path: path.join(external, 'denied.txt'), content: 'no' }), /超出/))
  await test('view tier blocks writes', async () => { api.setMachinePermission('view'); await assert.rejects(run('fs_write', { path: 'view.txt', content: 'no' }), /仅可查看/); api.setMachinePermission('workspace') })
  await test('junction cannot escape workspace even for nonexistent child', async () => { fs.symlinkSync(external, path.join(root, 'junction'), 'junction'); await assert.rejects(run('fs_write', { path: 'junction/new/deep.txt', content: 'no' }), /超出/); assert.equal(fs.existsSync(path.join(external, 'new')), false) })
  await test('read through junction works consistently', async () => assert.match((await run('fs_read', { path: 'junction/external.txt' })).context, /external readable/))
  await test('full tier allows approved nested external write', async () => { api.setMachinePermission('full'); await run('fs_write', { path: path.join(external, 'new/deep.txt'), content: 'approved' }); assert.equal(fs.readFileSync(path.join(external, 'new/deep.txt'), 'utf8'), 'approved') })
  await test('external delete is recoverable inside .trash', async () => { const result = await run('fs_delete', { path: path.join(external, 'new/deep.txt') }); assert.equal(fs.existsSync(path.join(external, 'new/deep.txt')), false); assert.ok(fs.existsSync(path.resolve(root, result.result.trashed))) })
  await test('session approval matches exact parameters only', async () => { api.setMachinePermission('workspace'); response = 'session'; const before = approvals; await run('fs_write', { path: 'cache.txt', content: 'one' }); await run('fs_write', { content: 'one', path: 'cache.txt' }); assert.equal(approvals, before + 1); await run('fs_write', { path: 'cache.txt', content: 'two' }); assert.equal(approvals, before + 2) })
  await test('clearing cache requires another approval', async () => { api.clearApprovals(); const before = approvals; await run('fs_write', { path: 'cache.txt', content: 'two' }); assert.equal(approvals, before + 1) })
  await test('deny command rule wins over approvals', async () => { api.setMachinePermission('full'); api.putCommandRule(root, 'Write-Output blocked', 'deny'); await assert.rejects(run('shell_run', { command: 'Write-Output blocked' }), /规则拒绝/) })
  await test('allow command rule runs actual shell without prompt', async () => { api.putCommandRule(root, 'Write-Output approved', 'allow'); const before = approvals; assert.match((await run('shell_run', { command: 'Write-Output approved' })).context, /approved/); assert.equal(approvals, before) })
  await test('full permission runs changed commands without asking', async () => { const before = approvals; assert.match((await run('shell_run', { command: 'Write-Output approved; Write-Output extra' })).context, /extra/); assert.equal(approvals, before) })
  await test('full permission does not depend on workspace trust', async () => { api.setWorkspaceTrust(root, false); const before = approvals; await run('fs_write', { path: 'full-untrusted.txt', content: 'direct' }); assert.equal(approvals, before); api.setWorkspaceTrust(root, true); api.setMachinePermission('workspace') })
  await test('approval canceled after workspace changes', async () => { api.installApprovalPrompt(async () => { api.setWorkspace(external); return 'once' }); await assert.rejects(run('fs_write', { path: 'race.txt', content: 'no' }), /变更/); assert.equal(fs.existsSync(path.join(external, 'race.txt')), false); api.setWorkspace(root); api.installApprovalPrompt(async () => 'once') })
  await test('Windows reserved names fail before IO', async () => { await assert.rejects(run('fs_read', { path: 'CON' }), /保留/); await assert.rejects(run('fs_write', { path: 'NUL.txt', content: 'no' }), /保留/) })
  await test('UTF-16 BOM content is readable', async () => assert.match((await run('fs_read', { path: 'utf16.txt' })).context, /中文内容/))
  await test('large text supports offset and limit', async () => { fs.writeFileSync(path.join(root, 'large.txt'), 'abcdefghij\n'.repeat(500000)); const result = await run('fs_read', { path: 'large.txt', offset: 100, limit: 2 }); assert.equal(result.result.to, 101); assert.match(result.context, /100\tabcdefghij/) })
  for (const [file, kind, expected] of [['sample.pdf', 'pdf', 'Workspace PDF'], ['sample.docx', 'docx', '中文 Word'], ['slides.pptx', 'slides', 'Workspace Slide'], ['workbook.xlsx', 'sheet', '产品'], ['data.csv', 'sheet', 'hello, world'], ['说明 文档.md', 'markdown', '中文路径']]) {
    await test(`${kind} preview and Agent content extraction`, async () => { assert.equal((await api.openDocument(path.join(root, file))).kind, kind); assert.match((await run('fs_read', { path: file })).context, new RegExp(expected)) })
  }
  await test('CSV quoted multiline cell is retained', async () => { const doc = await api.openDocument(path.join(root, 'data.csv')); assert.equal(doc.sheets[0].rows[2][1], 'two\nlines') })
  await test('workbook preserves sheet names', async () => assert.deepEqual((await api.openDocument(path.join(root, 'workbook.xlsx'))).sheets.map(s => s.name), ['明细', 'Summary']))
  await test('offline intent retains full paths and explicit contents', async () => { assert.equal(api.detectFileIntent('读取文件 "F:\\中文 目录\\a.txt"').params.path, 'F:\\中文 目录\\a.txt'); assert.equal(api.detectFileIntent('写文件 a.txt\n实际内容').params.content, '实际内容'); assert.equal(api.detectFileIntent('写文件 a.txt'), null) })
  await test('model tool loop invokes real IO and returns tool evidence', async () => {
    let rounds = 0
    const server = http.createServer(async (req, res) => {
      let text = ''; for await (const chunk of req) text += chunk
      const body = JSON.parse(text)
      const message = rounds++ === 0 ? { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fs_write', arguments: JSON.stringify({ path: 'model.txt', content: 'real model write' }) } }] } : { role: 'assistant', content: body.messages.at(-1).content }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
    })
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    try { const result = await api.toolConversation({ url: `http://127.0.0.1:${server.address().port}`, model: 'test', apiKey: '', messages: [{ role: 'user', content: 'write' }], signal: new AbortController().signal, maxTokens: 100, tools: api.AGENT_TOOLS.filter(t => t.name === 'fs_write'), execute: async (n, p) => (await run(n, p)).context }); assert.match(result, /已写入/); assert.equal(fs.readFileSync(path.join(root, 'model.txt'), 'utf8'), 'real model write') }
    finally { await new Promise(done => server.close(done)) }
  })
  await test('DOCX create writes a valid office archive', async () => {
    await run('fs_docx_create', { path: 'created.docx', text: 'Daily report\n中文内容 <安全> & 测试' })
    assert.match((await run('fs_read', { path: 'created.docx' })).context, /中文内容 <安全> & 测试/)
  })
  await test('DOCX replace preserves other paragraphs', async () => {
    await run('fs_docx_replace', { path: 'created.docx', oldText: '中文内容', newText: '修改正文' })
    const text = (await run('fs_read', { path: 'created.docx' })).context
    assert.match(text, /Daily report/); assert.match(text, /修改正文/)
  })
  await test('DOCX creation cannot overwrite an existing document', async () => {
    await assert.rejects(run('fs_docx_create', { path: 'created.docx', text: 'lost' }), /已存在/)
  })
  await test('Excel editing preserves unrelated sheets and cells', async () => {
    await run('fs_sheet_write', { path: 'workbook.xlsx', sheet: '明细', cells: JSON.stringify([{ address: 'B2', value: 99 }, { address: 'C2', formula: 'B2*2' }]) })
    const ExcelJS = require('exceljs'); const book = new ExcelJS.Workbook(); await book.xlsx.readFile(path.join(root, 'workbook.xlsx'))
    assert.equal(book.getWorksheet('明细').getCell('B2').value, 99)
    assert.equal(book.getWorksheet('明细').getCell('C2').formula, 'B2*2')
    assert.equal(book.getWorksheet('Summary').getCell('B1').value, 12)
  })
  await test('new spreadsheet persists typed data', async () => {
    await run('fs_sheet_write', { path: 'new.xlsx', sheet: '费用', cells: '[{"address":"A1","value":"交通"},{"address":"B1","value":25}]' })
    assert.match((await run('fs_read', { path: 'new.xlsx' })).context, /交通/)
  })
  await test('Office writes honor view tier', async () => {
    api.setMachinePermission('view')
    await assert.rejects(run('fs_sheet_write', { path: 'new.xlsx', sheet: '费用', cells: '[{"address":"B1","value":0}]' }), /仅可查看/)
    api.setMachinePermission('workspace')
  })
  await test('attachments keep stable IDs across listing and retain details', async () => {
    const imported = api.importAttachment(path.join(root, 'sample.docx'))
    assert.equal(api.listAttachments().find(a => a.path === imported.path).id, imported.id)
    const conv = api.chatRepo.create('test-character')
    const message = api.chatRepo.append({ conversationId: conv.id, role: 'user', text: 'Read this document', attachments: [{ name: imported.name, path: imported.path, kind: imported.kind, size: imported.size, ext: '.docx' }] })
    assert.equal(api.chatRepo.messages(conv.id)[0].attachments[0].path, imported.path)
    assert.equal(message.text, 'Read this document')
    assert.equal(api.deleteAttachment(imported.id), true)
  })
  await test('model routes isolate provider credentials', async () => {
    const cfg = api.settingsRepo.get()
    cfg.llm.baseUrl = 'https://provider-a.invalid/v1'; cfg.llm.apiKey = 'a-secret'
    const b = { id: 'b', name: 'B', kind: 'api', baseUrl: 'https://provider-b.invalid/v1', model: 'b-model', needKey: true }
    assert.throws(() => api.modelRoute(b, cfg), /API Key/)
    assert.equal(api.modelRoute({ ...b, apiKey: 'b-secret' }, cfg).apiKey, 'b-secret')
    assert.equal(api.modelRoute({ ...b, baseUrl: cfg.llm.baseUrl }, cfg).apiKey, 'a-secret')
  })
  await test('selecting models changes actual request model and authorization', async () => {
    const requests = []
    const server = http.createServer(async (req, res) => {
      if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] })); return }
      let data = ''; for await (const chunk of req) data += chunk
      requests.push({ ...JSON.parse(data), authorization: req.headers.authorization })
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }))
    })
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    try {
      const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1'
      for (const name of ['a', 'b']) {
        const model = api.modelRepo.addModel({ name, kind: 'api', baseUrl, model: 'model-' + name, apiKey: name + '-key' })
        api.modelRepo.setActive(model.id)
        const route = api.modelRoute(api.modelRepo.active(), api.settingsRepo.get())
        await api.toolConversation({ url: route.baseUrl + '/chat/completions', ...route, messages: [{ role: 'user', content: 'test' }], signal: new AbortController().signal, maxTokens: 10, tools: [], execute: async () => '' })
      }
      assert.deepEqual(requests.map(r => [r.model, r.authorization]), [['model-a', 'Bearer a-key'], ['model-b', 'Bearer b-key']])
      assert.equal((await api.probeEndpoint(baseUrl, '', 2000, 'nonexistent')).ok, false)
      assert.equal((await api.probeEndpoint(baseUrl, '', 2000, 'model-b')).ok, true)
    } finally { await new Promise(done => server.close(done)) }
  })
  console.log(`\n${tests} integration checks passed. Fixtures: ${root}`)
  fs.writeFileSync(path.join(output, 'latest.json'), JSON.stringify({ root, userData, tests, temp }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
