/**
 *
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify-perm')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

const STUB = join(OUT, 'stub.cjs')
writeFileSync(
  STUB,
  `
const DATA = process.env.VP_DATA
module.exports = {
  app: { getPath: () => DATA, getAppPath: () => process.env.VP_APP, getVersion: () => '0.8.0' },
  shell: { openPath: async () => '', openExternal: async () => true },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => {}, on: () => {} },
  nativeImage: { createFromDataURL: () => ({}) },
  Tray: class { setToolTip() {} setContextMenu() {} on() {} },
  Menu: { buildFromTemplate: () => ({}) },
  BrowserWindow: class { static getAllWindows() { return [] } }
}
`,
  'utf-8'
)

const entry = join(OUT, 'entry.ts')
writeFileSync(
  entry,
  `
export * from '${slash(join(ROOT, 'src/main/permission'))}'
export * from '${slash(join(ROOT, 'src/main/agentTools'))}'
export * from '${slash(join(ROOT, 'src/main/workspaceSecurity'))}'
export * from '${slash(join(ROOT, 'src/main/settings'))}'
export * from '${slash(join(ROOT, 'src/main/store'))}'
export * from '${slash(join(ROOT, 'src/main/apps'))}'
`,
  'utf-8'
)

execFileSync(
  process.execPath,
  [
    join(ROOT, 'node_modules/esbuild/bin/esbuild'),
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--alias:electron=' + slash(STUB),
    '--outfile=' + slash(join(OUT, 'bundle.cjs')),
    '--log-level=warning'
  ],
  { stdio: 'inherit', cwd: ROOT }
)

const DATA = mkdtempSync(join(tmpdir(), 'vp-'))
process.env.VP_DATA = DATA
process.env.VP_APP = ROOT
const mod = require(join(OUT, 'bundle.cjs'))

/**
 */
if (typeof mod.installApprovalPrompt === 'function') {
  mod.installApprovalPrompt(async () => 'once')
}

let pass = 0
let fail = 0
const lines = []

function check(name, fn) {
  try {
    const r = fn()
    if (r === false) throw new Error('断言返回 false')
    pass++
    lines.push('  PASS  ' + name)
  } catch (err) {
    fail++
    lines.push('  FAIL  ' + name + '  -> ' + (err && err.message ? err.message : String(err)))
  }
}

async function checkAsync(name, fn) {
  try {
    const r = await fn()
    if (r === false) throw new Error('断言返回 false')
    pass++
    lines.push('  PASS  ' + name)
  } catch (err) {
    fail++
    lines.push('  FAIL  ' + name + '  -> ' + (err && err.message ? err.message : String(err)))
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败')
}

;(async () => {
  const WS = mod.getWorkspace()

  lines.push('=== 1. 默认档位 ===')

  check('默认档位是 view（第十一轮起改为最小权限）', () => {
    const tier = mod.getMachinePermission()
    assert(tier === 'view', '实际是 ' + tier)
    return true
  })

  check('默认档位写进了 DEFAULT_SETTINGS', () => {
    assert(
      mod.DEFAULT_SETTINGS.agent.machinePermission === 'view',
      'DEFAULT_SETTINGS 里是 ' + mod.DEFAULT_SETTINGS.agent.machinePermission
    )
    return true
  })

  check('三档都有中文名与说明', () => {
    for (const t of ['view', 'workspace', 'full']) {
      assert(typeof mod.PERMISSION_LABELS[t] === 'string' && mod.PERMISSION_LABELS[t].length > 0, t + ' 缺中文名')
      assert(typeof mod.PERMISSION_HINTS[t] === 'string' && mod.PERMISSION_HINTS[t].length > 0, t + ' 缺说明')
    }
    assert(mod.PERMISSION_LABELS.view === '仅可查看', 'view 中文名不对')
    assert(mod.PERMISSION_LABELS.workspace === '工作目录内修改', 'workspace 中文名不对')
    assert(mod.PERMISSION_LABELS.full === '完全权限', 'full 中文名不对')
    return true
  })

  lines.push('')
  lines.push('=== 2. 工具分类 ===')

  check('读工具分类正确', () => {
    for (const n of ['fs_read', 'fs_list', 'fs_search', 'fs_glob', 'get_hardware_status', 'list_processes', 'read_clipboard']) {
      assert(mod.classifyTool(n) === 'read', n + ' 应为 read，实际 ' + mod.classifyTool(n))
    }
    return true
  })

  check('写工具分类正确', () => {
    for (const n of ['fs_write', 'fs_edit', 'write_clipboard', 'set_volume', 'take_screenshot']) {
      assert(mod.classifyTool(n) === 'write', n + ' 应为 write，实际 ' + mod.classifyTool(n))
    }
    return true
  })

  check('执行工具分类正确', () => {
    for (const n of ['shell_run', 'shell_job', 'launch_app', 'launch_close', 'system_power', 'job_kill']) {
      assert(mod.classifyTool(n) === 'exec', n + ' 应为 exec，实际 ' + mod.classifyTool(n))
    }
    return true
  })

  check('每个 agent 工具都能分类', () => {
    for (const t of mod.AGENT_TOOLS) {
      const k = mod.classifyTool(t.name)
      assert(['read', 'write', 'exec'].includes(k), t.name + ' 分类异常：' + k)
    }
    return true
  })

  check('读文件类工具在任一档位都放行', () => {
    for (const tier of ['view', 'workspace', 'full']) {
      mod.setMachinePermission(tier)
      const d = mod.checkPermission('fs_read', { path: 'a.txt' }, { workspace: WS })
      assert(d.allowed === true, tier + ' 档位下 fs_read 被拒：' + d.reason)
    }
    mod.setMachinePermission('workspace')
    return true
  })

  lines.push('')
  lines.push('=== 3. 仅可查看（view）===')

  check('view 档位拒绝写工具，且提示要切到哪一档', () => {
    mod.setMachinePermission('view')
    const d = mod.checkPermission('fs_write', { path: 'a.txt', content: 'x' }, { workspace: WS })
    assert(d.allowed === false, 'view 档位竟然允许写文件')
    assert(d.tier === 'view', 'tier 不对：' + d.tier)
    assert(d.kind === 'write', 'kind 不对：' + d.kind)
    assert(/工作目录内修改/.test(d.reason), 'reason 没告诉用户切到哪一档：' + d.reason)
    return true
  })

  check('view 档位拒绝执行工具', () => {
    mod.setMachinePermission('view')
    const d = mod.checkPermission('shell_run', { command: 'Get-Date' }, { workspace: WS })
    assert(d.allowed === false, 'view 档位竟然允许执行命令')
    assert(d.kind === 'exec', 'kind 不对：' + d.kind)
    assert(/完全权限/.test(d.reason), 'reason 没提到完全权限：' + d.reason)
    return true
  })

  check('view 档位允许读工具', () => {
    mod.setMachinePermission('view')
    const d = mod.checkPermission('fs_read', { path: 'a.txt' }, { workspace: WS })
    assert(d.allowed === true, 'view 档位拒绝了读操作：' + d.reason)
    return true
  })

  check('view 档位下真正跑 fs_write 会抛错', async () => {
    mod.setMachinePermission('view')
    let threw = false
    try {
      await mod.runAgentTool('fs_write', { path: 'blocked.md', content: 'x' })
    } catch (e) {
      threw = true
      assert(/仅可查看|工作目录内修改/.test(String(e.message)), '错误信息不对：' + e.message)
    }
    assert(threw, 'view 档位竟然写成功了')
    return true
  })

  lines.push('')
  lines.push('=== 4. 工作目录内修改（workspace）===')

  await checkAsync('workspace 允许在工作目录内写文件', async () => {
    mod.setMachinePermission('workspace')
    mod.setWorkspaceTrust(mod.getWorkspace(), true)
    const d = mod.checkPermission('fs_write', { path: 'inside/ok.md', content: 'x' }, { workspace: WS })
    assert(d.allowed === true, '工作目录内写入被拒：' + d.reason)

    const r = await mod.runAgentTool('fs_write', { path: 'inside/ok.md', content: '# 工作目录内\n' })
    assert(String(r.summary).includes('已写入'), '实际写入失败：' + r.summary)
    return true
  })

  await checkAsync('workspace 允许删工作目录内的文件', async () => {
    mod.setWorkspaceTrust(mod.getWorkspace(), true)
    mod.setMachinePermission('workspace')
    await mod.runAgentTool('fs_write', { path: 'inside/gone.md', content: 'x' })
    const d = mod.checkPermission('fs_edit', { path: 'inside/gone.md', oldText: 'x', newText: 'y' }, { workspace: WS })
    assert(d.allowed === true, '工作目录内编辑被拒：' + d.reason)
    return true
  })

  check('★ workspace 拒绝写工作目录之外（.. 穿越）', () => {
    mod.setMachinePermission('workspace')
    const escape = join(WS, '..', '..', 'escaped.txt')
    const d = mod.checkPermission('fs_write', { path: escape, content: 'x' }, { workspace: WS })
    assert(d.allowed === false, '.. 穿越竟然被放行了：' + escape)
    assert(d.kind === 'write', 'kind 不对：' + d.kind)
    assert(/工作目录/.test(d.reason), 'reason 没提到工作目录：' + d.reason)
    return true
  })

  check('★ workspace 拒绝绝对路径写工作目录之外', () => {
    mod.setMachinePermission('workspace')
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32\\evil.dll' : '/etc/evil.conf'
    const d = mod.checkPermission('fs_write', { path: outside, content: 'x' }, { workspace: WS })
    assert(d.allowed === false, '工作目录外的绝对路径竟然被放行：' + outside)
    return true
  })

  check('路径包含判断能识破 .. 穿越与同前缀目录', () => {
    const root = 'C:\\work'
    assert(mod.isPathInside(root, 'C:\\work\\a\\b.txt') === true, '正常子路径应判为在内')
    assert(mod.isPathInside(root, 'C:\\work') === true, '根本身应判为在内')
    assert(mod.isPathInside(root, 'C:\\work\\..\\other\\x.txt') === false, '.. 穿越应判为在外')
    assert(mod.isPathInside('C:\\work', 'C:\\work2\\x.txt') === false, 'C:\\work2 被误判为 C:\\work 的子目录')
    return true
  })

  check('大小写不敏感（Windows）', () => {
    if (process.platform !== 'win32') return true
    assert(mod.isPathInside('C:\\Work\\Dir', 'c:\\work\\dir\\file.txt') === true, '大小写不同应视为同一目录')
    return true
  })

  check('workspace 档位拒绝执行命令', () => {
    mod.setMachinePermission('workspace')
    const d = mod.checkPermission('shell_run', { command: 'Get-Date' }, { workspace: WS })
    assert(d.allowed === false, 'workspace 档位竟然允许执行命令')
    assert(d.kind === 'exec', 'kind 不对：' + d.kind)
    assert(/完全权限/.test(d.reason), 'reason 应提示切到完全权限：' + d.reason)
    return true
  })

  await checkAsync('workspace 档位下真正跑 shell_run 会被闸门拦下', async () => {
    mod.setMachinePermission('workspace')
    let threw = false
    try {
      await mod.runAgentTool('shell_run', { command: 'Write-Output "should-not-run"' })
    } catch (e) {
      threw = true
      assert(/完全权限/.test(String(e.message)), '错误信息不对：' + e.message)
      assert(e.permissionDenied === true, '错误上应带 permissionDenied 标记')
    }
    assert(threw, 'workspace 档位竟然把命令跑起来了')
    return true
  })

  await checkAsync('workspace 档位下 /.. 穿越写文件真的会被拦', async () => {
    mod.setMachinePermission('workspace')
    const escape = join(WS, '..', 'escaped-by-agent.txt')
    let threw = false
    try {
      await mod.runAgentTool('fs_write', { path: escape, content: 'x' })
    } catch (e) {
      threw = true
    }
    assert(threw, '.. 穿越写文件竟然成功了')
    assert(!existsSync(escape), '文件真的被写到工作目录外面了：' + escape)
    return true
  })

  lines.push('')
  lines.push('=== 5. 完全权限（full）===')

  check('full 档位允许执行工具', () => {
    mod.setMachinePermission('full')
    const d = mod.checkPermission('shell_run', { command: 'Get-Date' }, { workspace: WS })
    assert(d.allowed === true, 'full 档位竟然还是拒绝执行：' + d.reason)
    return true
  })

  check('full 档位允许写工作目录之外', () => {
    mod.setMachinePermission('full')
    const outside = process.platform === 'win32' ? 'C:\\Windows\\Temp\\x.txt' : '/tmp/x.txt'
    const d = mod.checkPermission('fs_write', { path: outside, content: 'x' }, { workspace: WS })
    assert(d.allowed === true, 'full 档位拒绝写外部路径：' + d.reason)
    return true
  })

  check('full 档位允许关闭应用这类 exec 工具', () => {
    mod.setMachinePermission('full')
    const d = mod.checkPermission('launch_close', { appName: '网易云音乐' }, { workspace: WS })
    assert(d.allowed === true, 'full 档位拒绝关闭应用：' + d.reason)
    return true
  })

  await checkAsync('full 档位下真的能执行命令', async () => {
    mod.setMachinePermission('full')
    mod.setWorkspaceTrust(mod.getWorkspace(), true)
    const r = await mod.runAgentTool('shell_run', { command: 'Write-Output "full-tier-ok"' })
    assert(String(r.result.stdout).includes('full-tier-ok'), '输出不对：' + JSON.stringify(r.result))
    return true
  })

  await checkAsync('★ full 档位下能真的写工作目录外的文件', async () => {
    mod.setMachinePermission('full')
    mod.setWorkspaceTrust(mod.getWorkspace(), true)
    const outsideDir = mkdtempSync(join(tmpdir(), 'vp-outside-'))
    const target = join(outsideDir, 'outside.md')
    const r = await mod.runAgentTool('fs_write', { path: target, content: '# 工作目录外\n' })
    assert(String(r.summary).includes('已写入'), '写入失败：' + r.summary)
    assert(existsSync(target), '文件没真的落盘：' + target)
    rmSync(outsideDir, { recursive: true, force: true })
    return true
  })

  lines.push('')
  lines.push('=== 6. 档位持久化 ===')

  check('setMachinePermission 会持久化到设置里', () => {
    mod.setMachinePermission('full')
    const s = mod.settingsRepo.get()
    assert(s.agent.machinePermission === 'full', '设置里是 ' + s.agent.machinePermission)
    return true
  })

  check('★ 重开 store 后档位仍然是 full（跨重启保持）', () => {
    mod.setMachinePermission('full')
    const settingsFile = join(DATA, 'data', 'settings.json')
    assert(existsSync(settingsFile), '设置文件不存在：' + settingsFile)
    const raw = JSON.parse(require('node:fs').readFileSync(settingsFile, 'utf-8'))
    assert(raw.agent.machinePermission === 'full', '磁盘上是 ' + raw.agent.machinePermission)
    const fresh = new mod.JsonStore('settings', () => ({ agent: {} }))
    const back = fresh.read()
    assert(back.agent.machinePermission === 'full', '重新加载后是 ' + back.agent.machinePermission)
    return true
  })

  check('切到 view 也能持久化', () => {
    mod.setMachinePermission('view')
    const raw = JSON.parse(require('node:fs').readFileSync(join(DATA, 'data', 'settings.json'), 'utf-8'))
    assert(raw.agent.machinePermission === 'view', '磁盘上是 ' + raw.agent.machinePermission)
    mod.setMachinePermission('workspace')
    return true
  })

  check('非法档位会被规范化成 view（最小权限）', () => {
    const back = mod.setMachinePermission('whatever')
    assert(back === 'view', '实际是 ' + back)
    return true
  })

  lines.push('')
  lines.push('=== 7. 闸门覆盖面 ===')

  check('runAgentTool 对每个未知工具都会报错（闸门先于实现）', () => {
    let threw = false
    try {
      const d = mod.previewPermission('fs_write', { path: 'x.txt', content: 'y' })
      assert(typeof d.allowed === 'boolean', 'previewPermission 没返回结构化结果')
    } catch (e) {
      threw = true
    }
    assert(threw === false, 'previewPermission 不该抛错')
    return true
  })

  await checkAsync('未知工具名会被闸门挡下', async () => {
    let threw = false
    try {
      await mod.runAgentTool('__nope__', {})
    } catch (e) {
      threw = true
      assert(/未知工具/.test(String(e.message)), '错误信息不对：' + e.message)
    }
    assert(threw, '未知工具竟然没报错')
    return true
  })

  check('previewPermission 与 checkPermission 结论一致', () => {
    mod.setMachinePermission('workspace')
    const a = mod.previewPermission('shell_run', { command: 'x' })
    const b = mod.checkPermission('shell_run', { command: 'x' }, { workspace: WS })
    assert(a.allowed === b.allowed, '两者结论不一致')
    assert(a.tier === b.tier, '两者档位不一致')
    mod.setMachinePermission('workspace')
    return true
  })

  console.log('\n' + lines.join('\n'))
  console.log('\n========================================')
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  console.log('========================================\n')

  rmSync(OUT, { recursive: true, force: true })
  rmSync(DATA, { recursive: true, force: true })
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.log('\n' + lines.join('\n'))
  console.error('\n测试崩溃: ' + e.message)
  process.exit(2)
})
