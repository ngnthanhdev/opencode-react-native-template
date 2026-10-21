// Test hạ tầng test theo worktree của parallel-dispatch.mjs (port slot cố định + require_infra).
// Chạy: node --test scripts/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'parallel-dispatch.mjs')

function makeRepo(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-infra-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts', 'parallel-dispatch.mjs'))
  fs.mkdirSync(path.join(root, '.context'))
  fs.writeFileSync(path.join(root, '.context', 'project-config.md'), '```yaml\n' + config + '\n```\n')
  fs.writeFileSync(path.join(root, '.gitignore'), '.worktrees/\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return root
}

function dispatch(root, ...args) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'parallel-dispatch.mjs'), ...args], {
    cwd: root, encoding: 'utf8',
  })
}

test('mỗi worktree nhận 1 port cố định, cleanup trả slot lại', () => {
  const root = makeRepo([
    'test_infra_port_base: 56000',
    'require_infra: true',
    'worktree_setup_cmd: \'echo "PORT=$WORKTREE_PORT SLOT=$WORKTREE_SLOT" > .env.local\'',
  ].join('\n'))

  const a = dispatch(root, 'setup', '--task', 'layer-1/task-01')
  const b = dispatch(root, 'setup', '--task', 'layer-1/task-02')
  assert.equal(a.status, 0, a.stderr)
  assert.equal(b.status, 0, b.stderr)
  assert.deepEqual(JSON.parse(a.stdout).infra, { port: 56001, slot: 1 })
  assert.deepEqual(JSON.parse(b.stdout).infra, { port: 56002, slot: 2 })
  const envFile = path.join(root, '.worktrees', 'layer-1__task-02', '.env.local')
  assert.equal(fs.readFileSync(envFile, 'utf8').trim(), 'PORT=56002 SLOT=2')

  assert.equal(dispatch(root, 'cleanup', '--layer', '1').status, 0)
  const ports = JSON.parse(fs.readFileSync(path.join(root, '.worktrees', '.ports.json'), 'utf8'))
  assert.deepEqual(ports, {})

  const again = dispatch(root, 'setup', '--task', 'layer-2/task-01')
  assert.deepEqual(JSON.parse(again.stdout).infra, { port: 56001, slot: 1 })
})

test('require_infra: hook setup fail → setup exit khác 0', () => {
  const root = makeRepo([
    'test_infra_port_base: 56100',
    'require_infra: true',
    'worktree_setup_cmd: "exit 3"',
  ].join('\n'))
  const r = dispatch(root, 'setup', '--task', 'layer-1/task-01')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /require_infra/)
})

test('không require_infra: hook fail chỉ cảnh báo, không có port base thì không cấp port', () => {
  const root = makeRepo('worktree_setup_cmd: "exit 3"')
  const r = dispatch(root, 'setup', '--task', 'layer-1/task-01')
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.infra, null)
  assert.equal(out.requireInfra, false)
  assert.match(out.setupHook, /FAILED/)
})

test('require_infra mà không khai hook → setup exit khác 0', () => {
  const root = makeRepo('test_infra_port_base: 56200\nrequire_infra: true')
  const r = dispatch(root, 'setup', '--task', 'layer-1/task-01')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /worktree_setup_cmd/)
})

test('nhiều setup chạy song song không nhận trùng slot', async () => {
  const root = makeRepo('test_infra_port_base: 56300')
  const run = (task) => new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(root, 'scripts', 'parallel-dispatch.mjs'), 'setup', '--task', task], { cwd: root })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => resolve({ code, out, err }))
  })
  const outs = await Promise.all(['layer-1/task-01', 'layer-1/task-02', 'layer-1/task-03'].map(run))
  for (const o of outs) assert.equal(o.code, 0, o.err)
  const ports = outs.map((o) => JSON.parse(o.out).infra.port).sort()
  assert.deepEqual(ports, [56301, 56302, 56303])
})
