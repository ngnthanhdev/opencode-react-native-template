#!/usr/bin/env node
/**
 * review-snapshot.mjs — Chụp working tree hiện tại thành 1 git tree object cho reviewer.
 *
 * Vì sao cần: builder chỉ commit SAU khi Reviewer PASS → lúc review, working tree thường dirty,
 * `git rev-parse HEAD` không đại diện được code đã review. Snapshot cho mỗi round 1 tree SHA chính xác,
 * nên round ≥ 2 review đúng delta của fix: `git diff <tree round trước> <tree round này>`.
 *
 * Cách làm (KHÔNG đụng index thật, HEAD hay branch; không commit, không stash):
 *   1. Tạo index tạm trong thư mục temp, trỏ `GIT_INDEX_FILE=<tmp>`.
 *   2. Seed bằng `git read-tree HEAD` (repo chưa có commit → index rỗng).
 *   3. `git add -A` — tracked + untracked, tôn trọng .gitignore.
 *   4. `git write-tree` → tree SHA; xoá index tạm.
 * Chỉ ghi thêm blob/tree object vào object DB (git gc tự dọn object mồ côi sau `gc.pruneExpire`).
 *
 * Usage (chạy trong repo/worktree cần review):
 *   node scripts/review-snapshot.mjs
 *   → in JSON: { "tree": "<sha>", "head": "<sha>" | null }
 * Exit code ≠ 0 khi không phải git repo hoặc lệnh git lỗi (stderr ghi lý do).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function git(args, env) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    env: env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function currentHead() {
  try {
    return git(['rev-parse', '--verify', '--quiet', 'HEAD']);
  } catch {
    return null; // repo chưa có commit nào
  }
}

function snapshotWorkingTree() {
  const root = git(['rev-parse', '--show-toplevel']);
  const head = currentHead();
  const tmpDir = mkdtempSync(join(tmpdir(), 'review-snapshot-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(tmpDir, 'index') };
  try {
    if (head) git(['-C', root, 'read-tree', head], env);
    git(['-C', root, 'add', '-A'], env);
    const tree = git(['-C', root, 'write-tree'], env);
    return { tree, head };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

try {
  console.log(JSON.stringify(snapshotWorkingTree()));
} catch (error) {
  const detail = error.stderr?.toString().trim() || error.message;
  console.error(`review-snapshot: ${detail}`);
  process.exit(1);
}
