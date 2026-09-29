/**
 *
 *
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify-plugins')
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
export * from '${slash(join(ROOT, 'src/main/plugins'))}'
export * from '${slash(join(ROOT, 'src/main/store'))}'
export * from '${slash(join(ROOT, 'src/main/settings'))}'
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

let pass = 0
let fail = 0
const lines = []

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((r) => {
      if (r === false) throw new Error('断言返回 false')
      pass++
      lines.push('  PASS  ' + name)
    })
    .catch((err) => {
      fail++
      lines.push('  FAIL  ' + name + '  -> ' + (err && err.message ? err.message : String(err)))
    })
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败')
}

const USER_PLUGINS = join(DATA, 'plugins')
const BUILTIN_DIR = join(ROOT, 'resources', 'plugins')

/**
 */
const FIXTURE_ENTRY = `/*
 */

log('fixture-hello 正在加载，宿主版本：' + host.appVersion)

registerCommand('greet', function (args) {
  var who = args && typeof args.name === 'string' && args.name ? args.name : '陌生人'
  log('greet 被调用，name=' + who)
  return [
    '你好，' + who + '。这句话由插件「' + host.pluginName + '」生成。',
    '当前时间戳：' + host.now()
  ].join('\\n')
})

registerCommand('echo', function (args) {
  return {
    收到: args,
    类型: Object.prototype.toString.call(args),
    插件: host.id + '@' + host.version
  }
})

registerCommand('env', function () {
  var evalResult
  try {
    evalResult = typeof eval('1 + 1')
  } catch (e) {
    evalResult = '被拦截：' + e.name
  }

  var newFunction
  try {
    newFunction = typeof Function('return 1')()
  } catch (e) {
    newFunction = '被拦截：' + e.name
  }

  return {
    可见: {
      registerCommand: typeof registerCommand,
      log: typeof log,
      host: typeof host,
      host_id: host.id,
      host_dir: host.dir
    },
    不可见: {
      require: typeof require,
      process: typeof process,
      module: typeof module,
      exports: typeof exports,
      __dirname: typeof __dirname,
      Buffer: typeof Buffer,
      setTimeout: typeof setTimeout,
      console: typeof console
    },
    字符串代码生成: { eval: evalResult, newFunction: newFunction }
  }
})

registerCommand('stats', function (args) {
  var text = args && typeof args.text === 'string' ? args.text : ''
  return {
    字数: text.length,
    行数: text ? text.split('\\n').length : 0,
    词数: text.trim() ? text.trim().split(/\\s+/).length : 0
  }
})

log('fixture-hello 加载完成，已注册 4 条命令')`

function writeUserPlugin(id, manifest, code) {
  const dir = join(USER_PLUGINS, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  if (typeof code === 'string') writeFileSync(join(dir, manifest.main || 'index.js'), code, 'utf-8')
  return dir
}

async function withTempBuiltinPlugin(id, manifest, code, fn) {
  mkdirSync(BUILTIN_DIR, { recursive: true })
  const dir = join(BUILTIN_DIR, id)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf-8')
    if (typeof code === 'string') writeFileSync(join(dir, manifest.main || 'index.js'), code, 'utf-8')
    mod.refreshPlugins()
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    mod.refreshPlugins()
  }
}

function findPlugin(id) {
  return mod.listPlugins().plugins.find((p) => p.manifest.id === id) || null
}

;(async () => {
  lines.push('=== 0. 插件目录 ===')

  await check('内置插件目录为空 / 缺省时不崩，list 返回数组', () => {
    const dir = mod.builtinPluginDir()
    assert(typeof dir === 'string', 'builtinPluginDir() 应返回字符串，实际 ' + typeof dir)
    if (dir) {
      assert(existsSync(dir), '返回了不存在的目录：' + dir)
      assert(Array.isArray(readdirSync(dir)), '目录不可读：' + dir)
    }

    mod.refreshPlugins()
    const list = mod.listPlugins()
    assert(Array.isArray(list.plugins), 'plugins 应为数组')
    assert(Array.isArray(list.broken), 'broken 应为数组')
    assert(typeof list.dir === 'string', 'dir 应为字符串')
    return true
  })

  await check('空的 resources/plugins 不产生内置插件，也不进坏插件报告', () => {
    assert(existsSync(BUILTIN_DIR), 'resources/plugins 目录应仍然存在（只是空的）')
    const entries = readdirSync(BUILTIN_DIR).filter((n) => !n.startsWith('.'))
    assert(entries.length === 0, '内置插件目录应为空，实际还有：' + entries.join(', '))

    mod.refreshPlugins()
    const list = mod.listPlugins()
    assert(
      list.plugins.filter((p) => p.builtin).length === 0,
      '空的内置目录不该产出任何内置插件：' + list.plugins.map((p) => p.manifest.id).join(',')
    )
    assert(
      !list.broken.some((b) => resolve(b.dir) === resolve(BUILTIN_DIR)),
      '空的内置目录被误报成坏插件：' + JSON.stringify(list.broken)
    )
    return true
  })

  await check('用户插件目录被自动创建', () => {
    const dir = mod.userPluginDir()
    assert(dir.startsWith(DATA), '用户插件目录应在 userData 下，实际：' + dir)
    assert(existsSync(dir), '用户插件目录没有被创建')
    return true
  })

  lines.push('=== 1. 发现夹具插件（用户目录） ===')

  writeUserPlugin(
    'fixture-hello',
    {
      id: 'fixture-hello',
      name: '夹具插件 · 你好世界',
      version: '1.0.0',
      author: '验证脚本',
      description: '沙箱断言用的夹具插件（原内置示例已删除，这里等价复刻它的行为）。',
      main: 'index.js',
      enabled: true,
      commands: [
        { name: 'greet', label: '打个招呼', description: '根据传入的名字返回一句话' },
        { name: 'echo', label: '原样返回参数', description: '把宿主传进来的 args 原样回显' },
        { name: 'env', label: '查看沙箱环境', description: '列出沙箱里可见与不可见的宿主能力' },
        { name: 'stats', label: '文字统计', description: '统计 text 参数的字数与行数' }
      ]
    },
    FIXTURE_ENTRY
  )

  await check('能发现夹具插件（用户插件，非内置）', () => {
    mod.refreshPlugins()
    const p = findPlugin('fixture-hello')
    assert(p, '没发现 fixture-hello 插件')
    assert(p.builtin === false, '用户插件 builtin 应为 false')
    assert(p.manifest.id === 'fixture-hello', 'id 不对：' + p.manifest.id)
    assert(!!p.manifest.name, 'name 为空')
    assert(p.manifest.main === 'index.js', 'main 不对：' + p.manifest.main)
    return true
  })

  await check('入口脚本被沙箱执行且注册了命令', () => {
    const p = findPlugin('fixture-hello')
    assert(p.loaded === true, '没有加载成功：' + p.error)
    assert(p.error === null, '不该有错误：' + p.error)
    const names = p.commands.map((c) => c.name)
    for (const n of ['greet', 'echo', 'env', 'stats']) {
      assert(names.includes(n), '缺命令 ' + n + '，实际：' + names.join(','))
    }
    assert(p.commands.every((c) => c.registered === true), '启用状态下所有命令都应已注册')
    assert(p.missing.length === 0, '有清单声明但未注册的命令：' + p.missing.join(','))
    return true
  })

  await check('夹具清单格式符合约定（必填字段齐备）', () => {
    const raw = JSON.parse(readFileSync(join(USER_PLUGINS, 'fixture-hello', 'plugin.json'), 'utf-8'))
    for (const k of ['id', 'name', 'version', 'main', 'commands']) {
      assert(raw[k] !== undefined, '夹具清单缺字段 ' + k)
    }
    assert(Array.isArray(raw.commands) && raw.commands.length > 0, 'commands 应为非空数组')
    for (const c of raw.commands) {
      assert(typeof c.name === 'string' && c.name, 'commands[].name 缺失')
      assert(typeof c.label === 'string' && c.label, 'commands[].label 缺失')
    }
    assert(typeof raw.enabled === 'boolean', 'enabled 应为布尔')
    return true
  })

  lines.push('=== 2. 清单校验 ===')

  await check('validateManifest 接受合法清单', () => {
    const r = mod.validateManifest({
      id: 'ok-plugin',
      name: '合法插件',
      version: '2.1.0',
      author: 'tester',
      description: 'desc',
      main: 'main.js',
      enabled: false,
      commands: [{ name: 'run', label: '跑一下', description: 'x' }]
    })
    assert(r.ok === true, '应通过校验：' + (r.ok ? '' : r.error))
    assert(r.manifest.version === '2.1.0', 'version 被改坏了')
    assert(r.manifest.enabled === false, 'enabled 被改坏了')
    assert(r.manifest.commands.length === 1, 'commands 数量不对')
    assert(r.manifest.icon === null, '没写 icon 时应规范化为 null')
    return true
  })

  await check('缺字段 / 字段非法的清单被拒绝', () => {
    const cases = [
      [{ name: 'x', main: 'a.js' }, '缺 id'],
      [{ id: 'x', main: 'a.js' }, '缺 name'],
      [{ id: 'x', name: 'y' }, '缺 main'],
      [{ id: './evil', name: 'y', main: 'a.js' }, 'id 含非法字符'],
      [{ id: 'x', name: 'y', main: 'C:\\abs\\a.js' }, 'main 是绝对路径'],
      [{ id: 'x', name: 'y', main: '../../escape.js' }, 'main 跳出目录'],
      [{ id: 'x', name: 'y', main: 'a.exe' }, 'main 不是 js'],
      [{ id: 'x', name: 'y', main: 'a.js', commands: 'nope' }, 'commands 不是数组'],
      [{ id: 'x', name: 'y', main: 'a.js', commands: [{ label: '无名字' }] }, 'commands[].name 非法'],
      [{ id: 'x', name: 'y', main: 'a.js', commands: [{ name: 'a' }, { name: 'a' }] }, '命令重名'],
      [{ id: 'x', name: 'y', main: 'a.js', icon: 42 }, 'icon 不是字符串'],
      [{ id: 'x', name: 'y', main: 'a.js', icon: 'C:\\abs\\icon.png' }, 'icon 是绝对路径'],
      [{ id: 'x', name: 'y', main: 'a.js', icon: '../icon.png' }, 'icon 跳出目录'],
      [{ id: 'x', name: 'y', main: 'a.js', icon: 'icon.exe' }, 'icon 不是图片'],
      [{ id: 'x', name: 'y', main: 'a.js', icon: 'icon.js' }, 'icon 是脚本']
    ]
    for (const [raw, why] of cases) {
      const r = mod.validateManifest(raw)
      assert(r.ok === false, why + ' —— 竟然通过了校验')
      assert(typeof r.error === 'string' && r.error.length > 2, why + ' —— 没有给出原因')
    }
    for (const bad of [null, undefined, 42, 'str', []]) {
      assert(mod.validateManifest(bad).ok === false, '非对象清单应被拒绝：' + String(bad))
    }
    return true
  })

  await check('icon 合法时被规范化保留（相对路径 + 图片扩展名）', () => {
    for (const [icon, expect] of [
      ['icon.png', 'icon.png'],
      ['assets/cover.jpg', 'assets/cover.jpg'],
      ['assets\\cover.WEBP', 'assets\\cover.WEBP'],
      ['logo.svg', 'logo.svg']
    ]) {
      const r = mod.validateManifest({ id: 'x', name: 'y', main: 'a.js', icon })
      assert(r.ok === true, `icon=${icon} 应通过：` + (r.ok ? '' : r.error))
      assert(r.manifest.icon === expect, `icon=${icon} 被改坏了：` + String(r.manifest.icon))
    }
    for (const empty of ['', null, undefined]) {
      const r = mod.validateManifest({ id: 'x', name: 'y', main: 'a.js', icon: empty })
      assert(r.ok === true, 'icon=' + String(empty) + ' 应通过：' + (r.ok ? '' : r.error))
      assert(r.manifest.icon === null, 'icon=' + String(empty) + ' 应为 null')
    }
    return true
  })

  await check('坏插件目录被报告，且不影响其他插件', () => {
    writeUserPlugin('broken-json', { id: 'broken-json', name: 'x', main: 'i.js' }, 'x')
    writeFileSync(join(USER_PLUGINS, 'broken-json', 'plugin.json'), '{ not json', 'utf-8')

    const dirMissingMain = writeUserPlugin('broken-nomain', { id: 'broken-nomain', name: 'x', main: 'i.js' })
    assert(existsSync(dirMissingMain), '目录没建出来')

    mkdirSync(join(USER_PLUGINS, 'no-manifest'), { recursive: true })

    mod.refreshPlugins()
    const list = mod.listPlugins()
    const brokenDirs = list.broken.map((b) => b.dir)
    assert(brokenDirs.some((d) => d.endsWith('broken-json')), 'broken-json 没被报告：' + brokenDirs.join('|'))
    assert(brokenDirs.some((d) => d.endsWith('no-manifest')), 'no-manifest 没被报告：' + brokenDirs.join('|'))
    for (const b of list.broken) assert(typeof b.error === 'string' && b.error.length > 3, '坏插件没给出原因')
    assert(!!findPlugin('fixture-hello'), '坏插件把正常插件也带崩了')
    rmSync(join(USER_PLUGINS, 'broken-json'), { recursive: true, force: true })
    rmSync(join(USER_PLUGINS, 'broken-nomain'), { recursive: true, force: true })
    rmSync(join(USER_PLUGINS, 'no-manifest'), { recursive: true, force: true })
    mod.refreshPlugins()
    return true
  })

  lines.push('=== 3. 调用插件命令 ===')

  await check('greet 返回结果', async () => {
    const r = await mod.invokePluginCommand('fixture-hello', 'greet', { name: '测试员' })
    assert(r.ok === true, '调用失败：' + r.error)
    assert(typeof r.result === 'string', '结果应是字符串，实际 ' + typeof r.result)
    assert(r.result.includes('测试员'), '结果里没有传入的名字：' + r.result)
    assert(typeof r.ms === 'number' && r.ms >= 0, 'ms 字段异常')
    return true
  })

  await check('echo 的对象返回值可跨 realm 序列化', async () => {
    const r = await mod.invokePluginCommand('fixture-hello', 'echo', { a: 1, b: ['x', 'y'] })
    assert(r.ok === true, '调用失败：' + r.error)
    const v = r.result
    assert(v && typeof v === 'object', '结果应是对象')
    assert(v.收到 && v.收到.a === 1, '参数没回显：' + JSON.stringify(v))
    assert(Array.isArray(v.收到.b) && v.收到.b[1] === 'y', '数组没回显')
    assert(v instanceof Object, '结果不是主进程 realm 的对象')
    assert(JSON.stringify(v).length > 0, '结果无法 JSON 序列化')
    return true
  })

  await check('不存在的命令返回 ok:false 而不是抛异常', async () => {
    const r = await mod.invokePluginCommand('fixture-hello', 'no-such-cmd', {})
    assert(r.ok === false, '应该失败')
    assert(typeof r.error === 'string' && r.error.length > 3, '没有给出错误原因')
    return true
  })

  await check('不存在的插件返回 ok:false', async () => {
    const r = await mod.invokePluginCommand('ghost-plugin', 'x', {})
    assert(r.ok === false, '应该失败')
    assert(/不存在/.test(r.error), '错误信息不对：' + r.error)
    return true
  })

  await check('插件抛出的异常被兜住', async () => {
    writeUserPlugin(
      'thrower',
      { id: 'thrower', name: '会抛错的插件', main: 'index.js', commands: [{ name: 'boom', label: '炸' }] },
      "registerCommand('boom', function () { throw new Error('故意炸的') })"
    )
    mod.refreshPlugins()
    const r = await mod.invokePluginCommand('thrower', 'boom', {})
    assert(r.ok === false, '应该失败')
    assert(r.error.includes('故意炸的'), '没带上原始错误：' + r.error)
    return true
  })

  lines.push('=== 4. 沙箱边界（require / process 不可见）===')

  await check('沙箱里没有 require / process / module / 文件系统', async () => {
    const r = await mod.invokePluginCommand('fixture-hello', 'env', {})
    assert(r.ok === true, 'env 调用失败：' + r.error)
    const v = r.result
    assert(v && v.不可见, '结果结构不对：' + JSON.stringify(v))
    assert(v.不可见.require === 'undefined', 'require 被暴露了：' + v.不可见.require)
    assert(v.不可见.process === 'undefined', 'process 被暴露了：' + v.不可见.process)
    assert(v.不可见.module === 'undefined', 'module 被暴露了：' + v.不可见.module)
    assert(v.不可见.exports === 'undefined', 'exports 被暴露了：' + v.不可见.exports)
    assert(v.不可见.__dirname === 'undefined', '__dirname 被暴露了')
    assert(v.不可见.Buffer === 'undefined', 'Buffer 被暴露了')
    assert(v.不可见.setTimeout === 'undefined', 'setTimeout 被暴露了')
    assert(v.可见.registerCommand === 'function', 'registerCommand 应可见')
    assert(v.可见.log === 'function', 'log 应可见')
    assert(v.可见.host === 'object', 'host 应可见')
    return true
  })

  await check('插件里 require() 会失败（那就是它拿不到 fs 的证据）', async () => {
    writeUserPlugin(
      'sneaky',
      {
        id: 'sneaky',
        name: '想偷文件的插件',
        main: 'index.js',
        commands: [{ name: 'steal', label: '偷看' }]
      },
      `registerCommand('steal', function () {
  var fs = require('node:fs')
  return fs.readFileSync('C:/Windows/win.ini', 'utf-8')
})`
    )
    mod.refreshPlugins()
    const p = findPlugin('sneaky')
    assert(p, '插件没被发现')
    assert(p.loaded === true, '加载就失败也算通过，但这里应该是加载成功的：' + p.error)

    const r = await mod.invokePluginCommand('sneaky', 'steal', {})
    assert(r.ok === false, '插件竟然拿到了 require！')
    assert(/require is not defined|is not a function/.test(r.error), '错误信息不符合预期：' + r.error)
    return true
  })

  await check('拿到进程信息会被拦（process 不存在）', async () => {
    writeUserPlugin(
      'peeker',
      { id: 'peeker', name: '想读进程的插件', main: 'index.js', commands: [{ name: 'probe', label: '探测' }] },
      "registerCommand('probe', function () { return process.env.PATH })"
    )
    mod.refreshPlugins()
    const r = await mod.invokePluginCommand('peeker', 'probe', {})
    assert(r.ok === false, 'process 竟然可用！')
    assert(/process is not defined/.test(r.error), '错误信息不符合预期：' + r.error)
    return true
  })

  await check('eval / new Function 被沙箱禁用', async () => {
    writeUserPlugin(
      'eviler',
      { id: 'eviler', name: '想 eval 的插件', main: 'index.js', commands: [{ name: 'e', label: 'e' }] },
      "registerCommand('e', function () { return eval('1+1') })"
    )
    mod.refreshPlugins()
    const r = await mod.invokePluginCommand('eviler', 'e', {})
    assert(r.ok === false, 'eval 竟然可用了！')
    assert(/EvalError|disallowed/i.test(r.error), '错误信息不符合预期：' + r.error)
    return true
  })

  await check('入口脚本里的顶层报错被报告成 broken/error，不炸主进程', () => {
    writeUserPlugin(
      'crazy-load',
      { id: 'crazy-load', name: '加载就炸的插件', main: 'index.js', commands: [{ name: 'x', label: 'x' }] },
      "throw new Error('加载阶段就炸了')"
    )
    mod.refreshPlugins()
    const p = findPlugin('crazy-load')
    assert(p, '插件未被发现（应当被发现但标记错误）')
    assert(p.loaded === false, 'loaded 应为 false')
    assert(p.error && p.error.includes('加载阶段就炸了'), '没有报告加载错误：' + p.error)
    assert(!!findPlugin('fixture-hello'), '主进程被带崩了')
    return true
  })

  lines.push('=== 5. 启用 / 停用 持久化 ===')

  await check('停用后不再注册命令，且状态落盘', () => {
    const before = findPlugin('fixture-hello')
    assert(before.enabled === true, '初始应为启用')

    const after = mod.setPluginEnabled('fixture-hello', false)
    assert(after && after.enabled === false, '停用没生效')
    assert(after.loaded === false, '停用后不应加载入口脚本')
    assert(after.commands.length > 0, '清单里的命令仍应列出来（只是不可运行）')
    assert(after.commands.every((c) => c.registered === false), '停用后命令不该是 registered')
    assert(after.missing.length === after.commands.length, '停用后所有清单命令都应标记为未注册')
    for (const c of after.commands) {
      assert(after.missing.includes(c.name), c.name + ' 应被标记为未注册')
    }

    const file = join(DATA, 'data', 'plugins.json')
    assert(existsSync(file), 'plugins.json 没写出来：' + file)
    const saved = JSON.parse(readFileSync(file, 'utf-8'))
    assert(saved.enabled['fixture-hello'] === false, '开关没持久化：' + JSON.stringify(saved))

    mod.refreshPlugins()
    assert(findPlugin('fixture-hello').enabled === false, '重新扫描后开关丢了')
    return true
  })

  await check('停用状态下调用命令会明确报错', async () => {
    const r = await mod.invokePluginCommand('fixture-hello', 'greet', {})
    assert(r.ok === false, '停用的插件还能跑？')
    assert(/停用/.test(r.error), '错误信息不对：' + r.error)
    return true
  })

  await check('重新启用后命令恢复可用', async () => {
    const back = mod.setPluginEnabled('fixture-hello', true)
    assert(back && back.enabled === true, '启用没生效')
    assert(back.loaded === true, '启用后应重新加载：' + back.error)
    const r = await mod.invokePluginCommand('fixture-hello', 'greet', { name: '回来了' })
    assert(r.ok === true, '命令不可用：' + r.error)
    assert(r.result.includes('回来了'), '结果不对')
    const saved = JSON.parse(readFileSync(join(DATA, 'data', 'plugins.json'), 'utf-8'))
    assert(saved.enabled['fixture-hello'] === true, '启用状态没持久化')
    return true
  })

  await check('清单里的 enabled:false 会被尊重（用户没手动切过时）', () => {
    writeUserPlugin(
      'disabled-by-default',
      { id: 'disabled-by-default', name: '默认停用', main: 'index.js', enabled: false, commands: [{ name: 'x', label: 'x' }] },
      "registerCommand('x', function () { return 'ok' })"
    )
    mod.refreshPlugins()
    const p = findPlugin('disabled-by-default')
    assert(p, '插件没被发现')
    assert(p.enabled === false, '应尊重清单里的 enabled:false')
    assert(p.loaded === false, '停用的插件不该执行入口脚本')
    return true
  })

  lines.push('=== 6. 导入插件文件夹 ===')

  await check('导入把外部文件夹复制进用户插件目录', () => {
    const source = join(DATA, 'incoming', 'imported-demo')
    mkdirSync(source, { recursive: true })
    writeFileSync(
      join(source, 'plugin.json'),
      JSON.stringify(
        {
          id: 'imported-demo',
          name: '导入来的插件',
          version: '0.0.9',
          author: 'someone',
          description: '从外部目录导入',
          main: 'main.js',
          commands: [{ name: 'hi', label: '打个招呼' }]
        },
        null,
        2
      ),
      'utf-8'
    )
    writeFileSync(join(source, 'main.js'), "registerCommand('hi', function () { return 'imported ok' })", 'utf-8')

    const res = mod.importPluginFolder(source)
    assert(res.plugin, '导入后拿不到插件')
    assert(res.plugin.manifest.id === 'imported-demo', 'id 不对')
    assert(res.replaced === false, '第一次导入不该是覆盖')

    const dest = join(USER_PLUGINS, 'imported-demo')
    assert(existsSync(dest), '没有复制到用户插件目录：' + dest)
    assert(existsSync(join(dest, 'plugin.json')), 'plugin.json 没复制过去')
    assert(existsSync(join(dest, 'main.js')), 'main.js 没复制过去')
    assert(existsSync(source), '源目录不该被删除')
    const p = findPlugin('imported-demo')
    assert(p && p.builtin === false, '导入的插件应标记为用户插件')
    assert(p.loaded === true, '导入的插件应能加载：' + p.error)
    return true
  })

  await check('导入的插件命令可以调用', async () => {
    const r = await mod.invokePluginCommand('imported-demo', 'hi', {})
    assert(r.ok === true, '调用失败：' + r.error)
    assert(r.result === 'imported ok', '结果不对：' + String(r.result))
    return true
  })

  await check('重复导入同一 id 会覆盖（replaced = true）', () => {
    const source = join(DATA, 'incoming', 'imported-demo')
    writeFileSync(join(source, 'main.js'), "registerCommand('hi', function () { return 'v2' })", 'utf-8')
    const res = mod.importPluginFolder(source)
    assert(res.replaced === true, '应报告为覆盖导入')
    const r = mod.invokePluginCommand // 仅取引用，调用在下一个断言里
    assert(typeof r === 'function', 'invoke 应可调用')
    return true
  })

  await check('覆盖导入后跑的是新代码', async () => {
    const r = await mod.invokePluginCommand('imported-demo', 'hi', {})
    assert(r.ok === true, '调用失败：' + r.error)
    assert(r.result === 'v2', '跑的还是旧代码：' + String(r.result))
    return true
  })

  await check('导入非法目录会给出明确错误', () => {
    const empty = join(DATA, 'incoming', 'not-a-plugin')
    mkdirSync(empty, { recursive: true })
    let threw = ''
    try {
      mod.importPluginFolder(empty)
    } catch (err) {
      threw = err.message
    }
    assert(/plugin\.json/.test(threw), '错误信息不含 plugin.json 提示：' + threw)

    let threw2 = ''
    try {
      mod.importPluginFolder(join(DATA, 'no-such-folder-xyz'))
    } catch (err) {
      threw2 = err.message
    }
    assert(threw2.length > 3, '不存在的目录应报错')
    return true
  })

  lines.push('=== 7. 删除插件 ===')

  await check('删除用户插件会移除目录并清掉开关', () => {
    const target = join(USER_PLUGINS, 'imported-demo')
    assert(existsSync(target), '前置条件不满足：目录不存在')
    mod.setPluginEnabled('imported-demo', false)
    assert(JSON.parse(readFileSync(join(DATA, 'data', 'plugins.json'), 'utf-8')).enabled['imported-demo'] === false, '开关没写上')

    const list = mod.removePlugin('imported-demo')
    assert(!existsSync(target), '目录没被删除：' + target)
    assert(!list.plugins.some((p) => p.manifest.id === 'imported-demo'), '列表里还能看到被删的插件')
    const saved = JSON.parse(readFileSync(join(DATA, 'data', 'plugins.json'), 'utf-8'))
    assert(saved.enabled['imported-demo'] === undefined, '开关残留没清理')

    return true
  })

  await check('删除后的插件调用返回不存在', async () => {
    const r = await mod.invokePluginCommand('imported-demo', 'hi', {})
    assert(r.ok === false, '删都删了还能跑？')
    assert(/不存在/.test(r.error), '错误信息不对：' + r.error)
    return true
  })

  await check('内置插件不能删除（只能停用）', async () => {
    await withTempBuiltinPlugin(
      'builtin-demo',
      { id: 'builtin-demo', name: '临时内置插件', main: 'index.js', commands: [{ name: 'x', label: 'x' }] },
      "registerCommand('x', function () { return 'builtin ok' })",
      async (dir) => {
        const p = findPlugin('builtin-demo')
        assert(p && p.builtin === true, '临时内置插件应被识别为 builtin')

        let threw = ''
        try {
          mod.removePlugin('builtin-demo')
        } catch (err) {
          threw = err.message
        }
        assert(/内置插件不能删除/.test(threw), '错误信息不对：' + threw)
        assert(existsSync(dir), '内置插件目录被判删了！')
        assert(!!findPlugin('builtin-demo'), '内置插件从列表消失了')
      }
    )
    assert(!findPlugin('builtin-demo'), '临时内置插件没清理干净')
    assert(mod.listPlugins().plugins.filter((p) => p.builtin).length === 0, '内置目录应重新为空')
    return true
  })

  await check('删除不存在的插件会报错', () => {
    let threw = ''
    try {
      mod.removePlugin('ghost')
    } catch (err) {
      threw = err.message
    }
    assert(/不存在/.test(threw), '错误信息不对：' + threw)
    return true
  })

  lines.push('=== 8. 列表数据可 IPC 序列化 ===')

  await check('listPlugins() 是纯数据（structuredClone 能过）', () => {
    const list = mod.listPlugins()
    assert(Array.isArray(list.plugins), 'plugins 应为数组')
    assert(Array.isArray(list.broken), 'broken 应为数组')
    assert(typeof list.dir === 'string', 'dir 应为字符串')
    const cloned = structuredClone(list)
    assert(cloned.plugins.length === list.plugins.length, '克隆后长度变了')
    for (const p of list.plugins) {
      assert(typeof p.manifest.id === 'string', 'manifest.id 不是字符串')
      assert(Array.isArray(p.commands), 'commands 不是数组')
      assert(Array.isArray(p.logs), 'logs 不是数组')
      assert(typeof p.enabled === 'boolean', 'enabled 不是布尔')
      assert(p.error === null || typeof p.error === 'string', 'error 类型不对')
      assert(p.iconUrl === null || typeof p.iconUrl === 'string', 'iconUrl 类型不对')
      assert(p.manifest.icon === null || typeof p.manifest.icon === 'string', 'manifest.icon 类型不对')
    }
    return true
  })

  await check('插件日志被收集（log() 有输出）', () => {
    const p = findPlugin('fixture-hello')
    assert(p.logs.length >= 2, '日志条数太少：' + p.logs.length)
    assert(p.logs.some((l) => l.includes('加载')), '没有加载日志：' + p.logs.join(' | '))
    return true
  })

  await check('用户插件可以覆盖同名内置插件', async () => {
    await withTempBuiltinPlugin(
      'overlap-demo',
      { id: 'overlap-demo', name: '内置版', main: 'index.js', commands: [{ name: 'greet', label: '内置' }] },
      "registerCommand('greet', function () { return '内置版' })",
      async () => {
        assert(findPlugin('overlap-demo').builtin === true, '前置条件：应先是内置版')

        writeUserPlugin(
          'overlap-demo',
          { id: 'overlap-demo', name: '我的 overlap-demo 覆盖版', main: 'index.js', commands: [{ name: 'greet', label: '替换版' }] },
          "registerCommand('greet', function () { return '被用户覆盖了' })"
        )
        mod.refreshPlugins()
        const p = findPlugin('overlap-demo')
        assert(p, '覆盖后插件不见了')
        assert(p.builtin === false, '应为用户插件（用户目录优先）')
        assert(p.manifest.name.includes('覆盖版'), '拿到的不是用户版本：' + p.manifest.name)

        rmSync(join(USER_PLUGINS, 'overlap-demo'), { recursive: true, force: true })
        mod.refreshPlugins()
        assert(findPlugin('overlap-demo').builtin === true, '删掉用户版本后应回落到内置版本')
      }
    )
    assert(!findPlugin('overlap-demo'), '临时插件没清理干净')
    return true
  })

  lines.push('=== 9. 插件图标（manifest.icon → data URL）===')

  await check('声明了 icon 且文件存在时返回 data URL', () => {
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    )
    const dir = writeUserPlugin(
      'icon-demo',
      {
        id: 'icon-demo',
        name: '带图标的插件',
        version: '1.0.0',
        author: 'tester',
        description: '有图标',
        main: 'index.js',
        icon: 'icon.png',
        commands: [{ name: 'x', label: 'x' }]
      },
      "registerCommand('x', function () { return 'ok' })"
    )
    writeFileSync(join(dir, 'icon.png'), PNG)

    mod.refreshPlugins()
    const p = findPlugin('icon-demo')
    assert(p, '插件没被发现')
    assert(p.manifest.icon === 'icon.png', 'manifest.icon 不对：' + String(p.manifest.icon))
    assert(typeof p.iconUrl === 'string' && p.iconUrl.length > 0, 'iconUrl 应为非空字符串：' + String(p.iconUrl))
    assert(p.iconUrl.startsWith('data:image/png;base64,'), 'iconUrl 不是 PNG data URL：' + p.iconUrl.slice(0, 40))
    assert(p.iconUrl.includes(PNG.toString('base64')), 'data URL 内容和原文件对不上')
    assert(typeof structuredClone(p).iconUrl === 'string', 'iconUrl 不能结构化克隆')
    return true
  })

  await check('没声明 icon / 文件缺失时 iconUrl 为 null（界面回落占位块）', () => {
    const plain = findPlugin('fixture-hello')
    assert(plain.manifest.icon === null, 'fixture-hello 不该有 icon')
    assert(plain.iconUrl === null, 'fixture-hello 的 iconUrl 应为 null')

    writeUserPlugin(
      'icon-missing',
      { id: 'icon-missing', name: '图标丢了的插件', main: 'index.js', icon: 'nope.png', commands: [{ name: 'x', label: 'x' }] },
      "registerCommand('x', function () { return 'ok' })"
    )
    mod.refreshPlugins()
    const p = findPlugin('icon-missing')
    assert(p, '插件没被发现')
    assert(p.manifest.icon === 'nope.png', 'manifest.icon 应保留声明值')
    assert(p.iconUrl === null, '文件不存在时 iconUrl 应为 null，实际：' + String(p.iconUrl))

    assert(mod.pluginIconDataUrl({ ...p.manifest, icon: '../escape.png' }, p.dir) === null, '越界路径应返回 null')
    assert(mod.pluginIconDataUrl({ ...p.manifest, icon: 'icon.txt' }, p.dir) === null, '非图片扩展名应返回 null')
    return true
  })

  lines.push('=== 10. IPC 三处接线一致性（静态检查）===')

  const CHANNELS_SRC = readFileSync(join(ROOT, 'src', 'shared', 'channels.ts'), 'utf-8')
  const MAIN_SRC = readFileSync(join(ROOT, 'src', 'main', 'index.ts'), 'utf-8')
  const PRELOAD_SRC = readFileSync(join(ROOT, 'src', 'preload', 'index.ts'), 'utf-8')
  const GLOBALS_SRC = readFileSync(join(ROOT, 'src', 'renderer', 'src', 'types', 'global.d.ts'), 'utf-8')

  const pluginChannelKeys = [...CHANNELS_SRC.matchAll(/^\s*(plugin[A-Za-z]+):/gm)].map((m) => m[1])

  await check('channels.ts 定义了全部 7 个插件通道', () => {
    const expect = ['pluginList', 'pluginDir', 'pluginImport', 'pluginRemove', 'pluginToggle', 'pluginInvoke', 'pluginReveal']
    for (const k of expect) {
      assert(pluginChannelKeys.includes(k), 'channels.ts 缺通道 ' + k + '，实际：' + pluginChannelKeys.join(','))
    }
    return true
  })

  await check('主进程为每个插件通道都注册了 handle()', () => {
    for (const k of pluginChannelKeys) {
      assert(
        new RegExp('handle\\(CH\\.' + k + '\\b').test(MAIN_SRC),
        'src/main/index.ts 没有 handle(CH.' + k + ') —— 渲染层调用会报 is not a function'
      )
    }
    return true
  })

  await check('preload 暴露了 plugin 命名空间与全部方法', () => {
    assert(/\bplugin:\s*\{/.test(PRELOAD_SRC), 'preload 没有 expose plugin 命名空间')
    for (const m of ['list', 'dir', 'importFolder', 'remove', 'toggle', 'invoke', 'reveal']) {
      assert(
        new RegExp('\\b' + m + ':\\s*\\(').test(PRELOAD_SRC.slice(PRELOAD_SRC.indexOf('plugin: {'))),
        'preload.plugin 缺方法 ' + m
      )
    }
    const used = [...PRELOAD_SRC.matchAll(/CH\.(plugin[A-Za-z]+)/g)].map((m) => m[1])
    for (const u of used) {
      assert(pluginChannelKeys.includes(u), 'preload 引用了未定义的通道 CH.' + u)
    }
    assert(used.length >= 7, 'preload 只引用了 ' + used.length + ' 个插件通道，应为 7')
    return true
  })

  await check('global.d.ts 声明了 window.aimis.plugin', () => {
    const at = GLOBALS_SRC.indexOf('plugin: {')
    assert(at > 0, 'global.d.ts 里没有 plugin 段')
    const seg = GLOBALS_SRC.slice(at, GLOBALS_SRC.indexOf('window: {', at))
    for (const sig of ['list()', 'dir()', 'importFolder()', 'remove(', 'toggle(', 'invoke(', 'reveal(']) {
      assert(seg.includes(sig), 'global.d.ts 的 plugin 段缺声明：' + sig)
    }
    for (const t of ['PluginListResult', 'PluginImportResult', 'PluginInvokeResult']) {
      assert(new RegExp('^\\s*' + t + ',?$', 'm').test(GLOBALS_SRC.slice(0, at)), 'global.d.ts 没有 import 类型 ' + t)
    }
    return true
  })

  await check('设置页把插件分区接了进去', () => {
    const sett = readFileSync(join(ROOT, 'src', 'renderer', 'src', 'pages', 'SettingsPage.tsx'), 'utf-8')
    assert(/import PluginSection from '\.[./]*settings\/PluginSection'/.test(sett), 'SettingsPage 没有 import PluginSection')
    assert(sett.includes("'plugin'"), 'SettingsPage 的 Section 联合类型里没有 plugin')
    assert(/\{\s*key:\s*'plugin'/.test(sett), 'SECTIONS 里没有 plugin 条目')
    assert(/\bsection === 'plugin' && <PluginSection \/>/.test(sett), '没有渲染 <PluginSection />')
    assert(sett.includes('useState<Section>'), '找不到 Section 状态定义')
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
