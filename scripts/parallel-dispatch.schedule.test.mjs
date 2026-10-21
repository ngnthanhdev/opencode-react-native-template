// Test lập lịch theo dependency của parallel-dispatch.mjs (ready / merge --task / cleanup --task).
// Chạy: node --test scripts/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'parallel-dispatch.mjs')

function taskFile({ deps, files }) {
  const depLines = deps === undefined ? '' : `## Dependencies\n${deps.length ? deps.map(d => `- ${d} (lý do)`).join('\n') : '- none'}\n\n`
  return `# Task\n\n${depLines}## Files to Create/Modify\n${files.map(f => `- \`${f}\``).join('\n')}\n`
}

// tasks: { 'layer-0-task-01': { deps, files } }
function makeRepo(tasks) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-schedule-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts', 'parallel-dispatch.mjs'))
  fs.mkdirSync(path.join(root, 'tasks', 'build-app'), { recursive: true })
  for (const [name, spec] of Object.entries(tasks)) {
    fs.writeFileSync(path.join(root, 'tasks', 'build-app', `${name}.md`), taskFile(spec))
  }
  fs.writeFileSync(path.join(root, '.gitignore'), '.worktrees/\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return { root, git }
}

function dispatch(root, ...args) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'parallel-dispatch.mjs'), ...args], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

const ids = list => list.map(t => t.id)

test('task layer sau được chọn ngay khi đúng dependency của nó đã merge', () => {
  const { root, git } = makeRepo({
    'layer-0-task-01': { deps: [], files: ['src/a.ts'] },
    'layer-0-task-02': { deps: [], files: ['src/b.ts'] },
    'layer-1-task-01': { deps: ['layer-0/task-01'], files: ['src/c.ts'] },
    'layer-1-task-02': { deps: ['layer-0/task-02'], files: ['src/d.ts'] },
  })
  assert.deepEqual(ids(dispatch(root, 'ready').ready), ['layer-0/task-01', 'layer-0/task-02'])

  for (const t of ['layer-0/task-01', 'layer-0/task-02']) {
    dispatch(root, 'setup', '--task', t, '--integration', 'build-integration')
  }
  const running = dispatch(root, 'ready')
  assert.deepEqual(running.ready, [])
  assert.deepEqual(running.running.sort(), ['layer-0/task-01', 'layer-0/task-02'])

  // task-01 xong trước: commit trong worktree → merge --task → cleanup --task
  const wt = path.join(root, '.worktrees', 'layer-0__task-01')
  fs.mkdirSync(path.join(wt, 'src'), { recursive: true })
  fs.writeFileSync(path.join(wt, 'src', 'a.ts'), 'export const a = 1\n')
  execFileSync('git', ['add', '.'], { cwd: wt })
  execFileSync('git', ['commit', '-q', '-m', 'feat: a'], { cwd: wt })
  git('checkout', '-q', 'main')
  dispatch(root, 'merge', '--task', 'layer-0/task-01', '--integration', 'build-integration')
  dispatch(root, 'cleanup', '--task', 'layer-0/task-01')

  const next = dispatch(root, 'ready')
  assert.deepEqual(ids(next.ready), ['layer-1/task-01'])
  assert.deepEqual(next.running, ['layer-0/task-02'])
  assert.deepEqual(next.waiting.find(w => w.id === 'layer-1/task-02').waitingOn, ['layer-0/task-02'])
  assert.ok(fs.existsSync(path.join(root, '.worktrees', 'layer-0__task-02')), 'cleanup --task chỉ xoá đúng 1 worktree')
})

test('không khai Dependencies ở layer > 0 → phụ thuộc mọi task layer trước', () => {
  const { root } = makeRepo({
    'layer-0-task-01': { deps: [], files: ['src/a.ts'] },
    'layer-1-task-01': { files: ['src/b.ts'] },
  })
  fs.mkdirSync(path.join(root, '.context'))
  fs.writeFileSync(path.join(root, '.context', 'progress.json'), JSON.stringify({ completedTasks: [] }))
  const r = dispatch(root, 'ready')
  assert.deepEqual(ids(r.ready), ['layer-0/task-01'])
  assert.deepEqual(r.waiting[0].waitingOn, ['layer-0/task-01'])

  fs.writeFileSync(path.join(root, '.context', 'progress.json'), JSON.stringify({ completedTasks: [{ task: 'layer-0/task-01' }] }))
  const after = dispatch(root, 'ready')
  assert.deepEqual(ids(after.ready), ['layer-1/task-01'])
  assert.equal(after.ready[0].implicitDeps, true)
})

test('branch vừa setup chưa có commit không được tính là đã merge', () => {
  const { root, git } = makeRepo({
    'layer-0-task-01': { deps: [], files: ['src/a.ts'] },
    'layer-1-task-01': { deps: ['layer-0/task-01'], files: ['src/b.ts'] },
  })
  dispatch(root, 'setup', '--task', 'layer-0/task-01', '--integration', 'build-integration')
  git('worktree', 'remove', '--force', path.join(root, '.worktrees', 'layer-0__task-01'))
  const r = dispatch(root, 'ready')
  assert.deepEqual(ids(r.ready), ['layer-0/task-01'])
  assert.deepEqual(r.waiting[0].waitingOn, ['layer-0/task-01'])
})

test('trùng file, --until-layer và dependency không tồn tại', () => {
  const { root } = makeRepo({
    'layer-0-task-01': { deps: [], files: ['src/shared.ts'] },
    'layer-0-task-02': { deps: [], files: ['src/shared.ts'] },
    'layer-1-task-01': { deps: [], files: ['src/x.ts'] },
    'layer-1-task-02': { deps: ['layer-0/task-09'], files: ['src/y.ts'] },
  })
  const r = dispatch(root, 'ready', '--until-layer', '0')
  assert.deepEqual(ids(r.ready), ['layer-0/task-01'])
  assert.match(r.waiting.find(w => w.id === 'layer-0/task-02').reason, /trùng file/)
  assert.match(r.waiting.find(w => w.id === 'layer-1/task-01').reason, /milestone/)

  const all = dispatch(root, 'ready')
  assert.deepEqual(all.waiting.find(w => w.id === 'layer-1/task-02').unknownDeps, ['layer-0/task-09'])
})
