// Test review-snapshot.mjs trên git repo tạm: snapshot đúng delta, không đụng index thật/HEAD.
// Chạy: node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./review-snapshot.mjs', import.meta.url));

// Bỏ GIT_* kế thừa (vd chạy trong git hook) để repo tạm không trỏ nhầm repo thật.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

function run(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, env: cleanEnv, encoding: 'utf8' }).trim();
}

function makeRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'review-snapshot-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'git', ['init', '-q']);
  run(dir, 'git', ['config', 'user.email', 'test@example.com']);
  run(dir, 'git', ['config', 'user.name', 'test']);
  return dir;
}

function snapshot(dir) {
  return JSON.parse(run(dir, process.execPath, [SCRIPT]));
}

function realState(dir) {
  return {
    status: run(dir, 'git', ['status', '--porcelain']),
    index: run(dir, 'git', ['ls-files', '--stage']),
    head: run(dir, 'git', ['rev-parse', 'HEAD']),
    branches: run(dir, 'git', ['branch', '--list']),
    stash: run(dir, 'git', ['stash', 'list']),
  };
}

test('git diff giữa 2 snapshot chỉ chứa thay đổi thứ hai; index/HEAD thật không đổi', (t) => {
  const dir = makeRepo(t);
  writeFileSync(join(dir, 'a.txt'), 'v1\n');
  writeFileSync(join(dir, '.gitignore'), 'ignored.log\n');
  run(dir, 'git', ['add', '-A']);
  run(dir, 'git', ['commit', '-q', '-m', 'init']);
  const head = run(dir, 'git', ['rev-parse', 'HEAD']);

  writeFileSync(join(dir, 'a.txt'), 'v2\n');
  writeFileSync(join(dir, 'staged.txt'), 'staged\n');
  run(dir, 'git', ['add', 'staged.txt']);
  const beforeA = realState(dir);
  const snapA = snapshot(dir);
  assert.deepEqual(realState(dir), beforeA);
  assert.equal(snapA.head, head);
  assert.equal(run(dir, 'git', ['show', `${snapA.tree}:a.txt`]), 'v2');

  writeFileSync(join(dir, 'b.txt'), 'new untracked\n');
  writeFileSync(join(dir, 'ignored.log'), 'noise\n');
  const beforeB = realState(dir);
  const snapB = snapshot(dir);
  assert.deepEqual(realState(dir), beforeB);

  assert.equal(run(dir, 'git', ['diff', '--name-status', snapA.tree, snapB.tree]), 'A\tb.txt');
  assert.equal(run(dir, 'git', ['diff', '--name-status', head, snapA.tree]), 'M\ta.txt\nA\tstaged.txt');
});

test('working tree không đổi → cùng tree SHA', (t) => {
  const dir = makeRepo(t);
  writeFileSync(join(dir, 'a.txt'), 'v1\n');
  run(dir, 'git', ['add', '-A']);
  run(dir, 'git', ['commit', '-q', '-m', 'init']);
  writeFileSync(join(dir, 'a.txt'), 'dirty\n');
  assert.equal(snapshot(dir).tree, snapshot(dir).tree);
});

test('repo chưa có commit → head null, tree vẫn chứa file', (t) => {
  const dir = makeRepo(t);
  writeFileSync(join(dir, 'a.txt'), 'v1\n');
  const snap = snapshot(dir);
  assert.equal(snap.head, null);
  assert.equal(run(dir, 'git', ['show', `${snap.tree}:a.txt`]), 'v1');
  assert.equal(run(dir, 'git', ['status', '--porcelain']), '?? a.txt');
});
