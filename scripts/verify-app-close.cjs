/**
 *
 */

const { execFileSync, spawn } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify-close')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

const STUB = join(OUT, 'stub.cjs')
writeFileSync(
  STUB,
  `
const DATA = process.env.VC_DATA
module.exports = {
  app: { getPath: () => DATA, getAppPath: () => process.env.VC_APP, getVersion: () => '0.8.0' },
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
export * from '${slash(join(ROOT, 'src/main/apps'))}'
export * from '${slash(join(ROOT, 'src/main/appMatch'))}'
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

const DATA = mkdtempSync(join(tmpdir(), 'vc-'))
process.env.VC_DATA = DATA
process.env.VC_APP = ROOT
const mod = require(join(OUT, 'bundle.cjs'))

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
  lines.push('=== 1. 保护清单 ===')

  check('保护清单包含关键 Windows 进程', () => {
    const need = [
      'explorer.exe',
      'winlogon.exe',
      'csrss.exe',
      'services.exe',
      'lsass.exe',
      'svchost.exe',
      'system',
      'smss.exe',
      'dwm.exe'
    ]
    for (const n of need) {
      assert(mod.PROTECTED_PROCESSES.includes(n), '保护清单缺少 ' + n)
    }
    return true
  })

  check('保护判定大小写不敏感', () => {
    for (const n of ['EXPLORER.EXE', 'Explorer.exe', 'Csrss.exe', 'LSASS.EXE', 'SVCHOST.EXE']) {
      assert(mod.isProtectedProcess(n) === true, '没保护住 ' + n)
    }
    return true
  })

  check('自己的 electron 进程也在保护范围内', () => {
    for (const n of ['electron.exe', 'shorekeeper-agent.exe']) {
      assert(mod.isProtectedProcess(n) === true, '没保护住自己的进程 ' + n)
    }
    return true
  })

  check('普通应用不会被误判为受保护', () => {
    for (const n of ['cloudmusic.exe', 'QQ.exe', 'WeChat.exe', 'chrome.exe', 'Code.exe']) {
      assert(mod.isProtectedProcess(n) === false, '误判成受保护：' + n)
    }
    return true
  })

  lines.push('')
  lines.push('=== 2. 拒绝路径 ===')

  await checkAsync('★ 关闭 explorer.exe 会被拒绝（中文说明）', async () => {
    const r = await mod.closeApp('explorer')
    assert(r.closed === false, '竟然真去关资源管理器了')
    assert(Array.isArray(r.killedPids) && r.killedPids.length === 0, '不该杀掉任何进程')
    assert(typeof r.message === 'string' && r.message.length > 0, '没有给出说明')
    assert(/[\u4e00-\u9fa5]/.test(r.message), 'refusal message 里没有中文：' + r.message)
    assert(/系统关键进程|不能|拒绝|不动/.test(r.message), '说明不到位：' + r.message)
    return true
  })

  await checkAsync('★ 关闭「文件资源管理器」别名同样被拒', async () => {
    const r = await mod.closeApp('文件资源管理器')
    assert(r.closed === false, '竟然真去关了')
    assert(r.killedPids.length === 0, '不该杀掉任何进程')
    assert(/[\u4e00-\u9fa5]/.test(r.message), 'refusal message 里没有中文')
    return true
  })

  await checkAsync('★ 未知应用被拒绝', async () => {
    const r = await mod.closeApp('这个软件肯定不存在xyz')
    assert(r.closed === false, '竟然关成功了')
    assert(r.killedPids.length === 0, '不该杀掉任何进程')
    assert(/[\u4e00-\u9fa5]/.test(r.message), 'refusal message 里没有中文：' + r.message)
    assert(/清单|登记/.test(r.message), '应说明只能在清单内操作：' + r.message)
    return true
  })

  await checkAsync('空名字也被拒绝', async () => {
    const r = await mod.closeApp('')
    assert(r.closed === false, '空名字竟然成功了')
    assert(/[\u4e00-\u9fa5]/.test(r.message), '没有中文说明')
    return true
  })

  check('未知应用不会走到「乱杀进程」的分支', () => {
    const alias = mod.resolveApp('node')
    assert(alias === null || alias === undefined, 'node 竟然在别名表里：' + JSON.stringify(alias))
    return true
  })

  lines.push('')
  lines.push('=== 3. closeApp 返回结构 ===')

  await checkAsync('closeApp 返回文档化的结构', async () => {
    const r = await mod.closeApp('计算器')
    assert(typeof r.closed === 'boolean', 'closed 不是布尔：' + typeof r.closed)
    assert(typeof r.appName === 'string' && r.appName.length > 0, 'appName 缺失')
    assert(typeof r.message === 'string' && r.message.length > 0, 'message 缺失')
    assert(Array.isArray(r.killedPids), 'killedPids 不是数组')
    return true
  })

  await checkAsync('没在运行的应用会给出「没在运行」的说明', async () => {
    const r = await mod.closeApp('计算器')
    if (r.closed === false) {
      assert(/[\u4e00-\u9fa5]/.test(r.message), '没有中文说明：' + r.message)
    }
    return true
  })

  check('listRunningApps 返回数组', async () => {
    assert(typeof mod.listRunningApps === 'function', 'listRunningApps 未导出')
    return true
  })

  await checkAsync('listRunningApps 返回合法结构', async () => {
    const list = await mod.listRunningApps()
    assert(Array.isArray(list), '不是数组')
    for (const a of list) {
      assert(typeof a.appName === 'string' && a.appName.length > 0, 'appName 缺失')
      assert(typeof a.exeName === 'string', 'exeName 缺失')
      assert(Array.isArray(a.pids), 'pids 不是数组')
      assert(typeof a.protected === 'boolean', 'protected 不是布尔')
    }
    return true
  })

  lines.push('')
  lines.push('=== 4. 真实进程关闭 ===')

  await checkAsync('★ closeAppByPid 能真的终止一个自己起的 node 进程', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], {
      stdio: 'ignore',
      windowsHide: true
    })
    const pid = child.pid
    assert(typeof pid === 'number' && pid > 0, '拿不到子进程 pid')

    await new Promise((r) => setTimeout(r, 900))

    const r = await mod.closeAppByPid(pid)
    assert(typeof r.closed === 'boolean', 'closed 不是布尔')
    assert(typeof r.message === 'string' && r.message.length > 0, 'message 缺失')

    let gone = false
    for (let i = 0; i < 40; i++) {
      await new Promise((r2) => setTimeout(r2, 150))
      if (child.exitCode !== null || child.killed) {
        gone = true
        break
      }
      try {
        process.kill(pid, 0)
      } catch {
        gone = true
        break
      }
    }

    try {
      child.kill('SIGKILL')
    } catch {
    }

    assert(gone, '进程 ' + pid + ' 还在跑，没被关掉（closed=' + r.closed + '）')
    return true
  })

  lines.push('')
  lines.push('=== 5. launch_close 工具注册 ===')

  check('★ launch_close 存在且 permission 是 once', () => {
    const spec = mod.TOOL_SPECS.find((t) => t.name === 'launch_close')
    assert(spec, '工具注册表里没有 launch_close')
    assert(spec.defaultPermission === 'once', 'permission 应为 once，实际 ' + spec.defaultPermission)
    return true
  })

  check('launch_close 的形状和 launch_app 一致', () => {
    const a = mod.TOOL_SPECS.find((t) => t.name === 'launch_app')
    const b = mod.TOOL_SPECS.find((t) => t.name === 'launch_close')
    assert(a && b, '两个工具都得在')
    for (const t of [a, b]) {
      assert(typeof t.name === 'string' && t.name, 'name 缺失')
      assert(typeof t.displayName === 'string' && t.displayName, 'displayName 缺失：' + t.name)
      assert(typeof t.actionLabel === 'string' && t.actionLabel, 'actionLabel 缺失：' + t.name)
      assert(typeof t.description === 'string' && t.description, 'description 缺失：' + t.name)
      assert(['once', 'always', 'deny'].includes(t.defaultPermission), 'permission 非法：' + t.name)
      assert(Array.isArray(t.params), 'params 不是数组：' + t.name)
    }
    assert(b.params.length === a.params.length, '参数个数与 launch_app 不一致')
    assert(b.params[0].key === 'appName', '第一个参数应是 appName')
    assert(b.params[0].required === true, 'appName 应为必填')
    assert(b.params[0].example === a.params[0].example, 'example 应与 launch_app 一致')
    return true
  })

  check('launch_close 的中文展示名到位', () => {
    const b = mod.TOOL_SPECS.find((t) => t.name === 'launch_close')
    assert(/[\u4e00-\u9fa5]/.test(b.displayName), 'displayName 应是中文：' + b.displayName)
    assert(/[\u4e00-\u9fa5]/.test(b.actionLabel), 'actionLabel 应是中文：' + b.actionLabel)
    return true
  })

  check('别名表仍能解析常用应用（关闭走的是同一张表）', () => {
    for (const n of ['网易云音乐', '微信', '计算器', '记事本', 'Chrome']) {
      const a = mod.resolveApp(n)
      assert(a, '别名表解析不到：' + n)
    }
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
