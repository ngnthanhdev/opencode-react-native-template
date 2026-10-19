#!/usr/bin/env node
/**
 * progress-write.mjs — ghi `.context/progress.json` bằng lệnh con (atomic, dedupe).
 *
 *   node tools/task-dashboard/progress-write.mjs complete --task layer-1/task-02 \
 *        [--review "STRICT PASS"] [--round 1] [--report .context/review-reports/...]
 *   node tools/task-dashboard/progress-write.mjs block --task layer-1/task-03 --reason "..."
 *   node tools/task-dashboard/progress-write.mjs in-progress --task layer-1/task-04
 *   node tools/task-dashboard/progress-write.mjs clear-in-progress
 *   node tools/task-dashboard/progress-write.mjs set-layer --current 2 --total 5
 *
 * Mục đích: agent gọi helper thay vì tự viết JSON tay (nguồn gây lỗi schema).
 *  - completedTasks là mảng OBJECT: { task, review?, round?, report?, completedAt? }
 *    (vẫn đọc được string cũ để backward-compat).
 *  - Atomic write (tmp + rename) + lock thư mục → chịu được nhiều process.
 *  - Không crash khi file chưa có.
 *  - Tự tìm repo root qua `git rev-parse --git-common-dir` (đúng cả trong worktree).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 2) out[a.slice(2, eq)] = a.slice(eq + 1);
      else {
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) out[a.slice(2)] = true;
        else { out[a.slice(2)] = v; i++; }
      }
    } else out._.push(a);
  }
  return out;
}

function warn(msg) { process.stderr.write(`⚠ progress-write: ${msg}\n`); }

// ── tìm repo root (worktree → repo gốc) ─────────────────────────────────────
function rootFromGit(dir) {
  try {
    const common = execFileSync(
      'git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (common && path.basename(common) === '.git') return path.dirname(common);
    if (common) return path.dirname(common);
  } catch { /* không phải git repo */ }
  try {
    const top = execFileSync(
      'git', ['-C', dir, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (top) return top;
  } catch { /* ignore */ }
  return null;
}

function findRepo(explicit) {
  if (explicit && explicit !== true) {
    const p = path.resolve(String(explicit));
    return rootFromGit(p) || p;
  }
  const fromCwd = rootFromGit(process.cwd());
  if (fromCwd) return fromCwd;
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

// ── lock + atomic write ─────────────────────────────────────────────────────
const sleep = (ms) => {
  try {
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  }
};

function withLock(file, fn) {
  const lock = `${file}.lock`;
  let held = false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; i < 80; i++) {
    try {
      fs.mkdirSync(lock);
      held = true;
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const st = fs.statSync(lock);
        if (Date.now() - st.mtimeMs > 3000) { fs.rmdirSync(lock); continue; }
      } catch { /* lock vừa biến mất */ }
      sleep(20);
    }
  }
  try {
    return fn();
  } finally {
    if (held) { try { fs.rmdirSync(lock); } catch { /* ignore */ } }
  }
}

function readProgress(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw;
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    warn(`${path.basename(file)} không parse được (${e.message}) — giữ nguyên file, KHÔNG ghi đè`);
    return null;
  }
}

function writeProgress(file, data) {
  data.lastUpdated = new Date().toISOString();
  const body = `${JSON.stringify(data, null, 2)}\n`;
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, body, 'utf8');
  for (let i = 0; i < 10; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (i === 9) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw e;
      }
      sleep(30);
    }
  }
}

// ── chuẩn hoá ───────────────────────────────────────────────────────────────
function taskIdOf(v) {
  if (typeof v === 'string') return v.trim() || null;
  if (v && typeof v === 'object') {
    for (const k of ['task', 'id', 'slug']) {
      if (typeof v[k] === 'string' && v[k].trim()) return v[k].trim();
    }
  }
  return null;
}

/** completedTasks → mảng object {task,...}; string cũ → {task}. */
function normalizeCompleted(list) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const id = taskIdOf(x);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (typeof x === 'string') { out.push({ task: id }); continue; }
    const e = { task: id };
    if (typeof x.review === 'string') e.review = x.review;
    if (x.round != null && Number.isFinite(Number(x.round))) e.round = Number(x.round);
    if (typeof x.report === 'string') e.report = x.report;
    if (typeof x.completedAt === 'string') e.completedAt = x.completedAt;
    out.push(e);
  }
  return out;
}

function normalizeBlocked(list) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const id = taskIdOf(x);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      task: id,
      reason: (x && typeof x === 'object' && typeof x.reason === 'string') ? x.reason : 'không rõ lý do',
      since: (x && typeof x === 'object' && x.since) ? x.since : new Date().toISOString(),
    });
  }
  return out;
}

// ── commands ────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || args.help || args.h) {
    console.log(`progress-write — ghi .context/progress.json an toàn

  node progress-write.mjs complete --task <id> [--review <str>] [--round <n>] [--report <path>]
  node progress-write.mjs block --task <id> --reason <str>
  node progress-write.mjs in-progress --task <id>
  node progress-write.mjs clear-in-progress
  node progress-write.mjs set-layer --current <n> --total <m>

  [--repo <path>]  mặc định tự tìm repo root (git-common-dir → đúng cả trong worktree)
`);
    return cmd ? 0 : 1;
  }

  const repo = findRepo(args.repo);
  const file = path.join(repo, '.context', 'progress.json');
  const task = taskIdOf(args.task);

  const mutators = {
    complete(p) {
      if (!task) return { code: 1, msg: 'complete cần --task <id>' };
      p.completedTasks = normalizeCompleted(p.completedTasks);
      const entry = { task };
      if (typeof args.review === 'string') entry.review = args.review;
      if (args.round != null && args.round !== true && Number.isFinite(Number(args.round))) entry.round = Number(args.round);
      if (typeof args.report === 'string') entry.report = args.report;
      entry.completedAt = new Date().toISOString();
      const idx = p.completedTasks.findIndex((e) => e.task === task);
      if (idx >= 0) p.completedTasks[idx] = { ...p.completedTasks[idx], ...entry };
      else p.completedTasks.push(entry);
      // dọn trùng ở inProgress / blocked
      const ip = taskIdOf(p.inProgressTask);
      if (ip === task) p.inProgressTask = null;
      if (taskIdOf(p.activeWorkItem) === task) p.activeWorkItem = null;
      p.blockedTasks = normalizeBlocked(p.blockedTasks).filter((b) => b.task !== task);
      return { ok: true, action: 'complete', entry };
    },
    block(p) {
      if (!task) return { code: 1, msg: 'block cần --task <id>' };
      if (typeof args.reason !== 'string' || !args.reason.trim()) return { code: 1, msg: 'block cần --reason "<lý do>"' };
      p.blockedTasks = normalizeBlocked(p.blockedTasks).filter((b) => b.task !== task);
      const entry = { task, reason: args.reason.trim(), since: new Date().toISOString() };
      p.blockedTasks.push(entry);
      const ip = taskIdOf(p.inProgressTask);
      if (ip === task) p.inProgressTask = null;
      return { ok: true, action: 'block', entry };
    },
    'in-progress'(p) {
      if (!task) return { code: 1, msg: 'in-progress cần --task <id>' };
      p.inProgressTask = task;
      return { ok: true, action: 'in-progress', task };
    },
    'clear-in-progress'(p) {
      p.inProgressTask = null;
      return { ok: true, action: 'clear-in-progress' };
    },
    'set-layer'(p) {
      const cur = Number(args.current);
      const total = Number(args.total);
      if (!Number.isFinite(cur) || !Number.isFinite(total)) {
        return { code: 1, msg: 'set-layer cần --current <n> --total <m>' };
      }
      p.currentLayer = cur;
      p.totalLayers = total;
      return { ok: true, action: 'set-layer', currentLayer: cur, totalLayers: total };
    },
  };

  const fn = mutators[cmd];
  if (!fn) {
    warn(`lệnh lạ: ${cmd} (chỉ complete|block|in-progress|clear-in-progress|set-layer)`);
    return 1;
  }

  let result;
  try {
    result = withLock(file, () => {
      const p = readProgress(file);
      if (p === null) return { code: 2, msg: 'progress.json hỏng — không ghi đè (sửa tay trước)' };
      const r = fn(p);
      if (r.code) return r;
      // giữ mảng chuẩn hoá kể cả khi lệnh không đụng tới
      if (p.completedTasks) p.completedTasks = normalizeCompleted(p.completedTasks);
      if (p.blockedTasks) p.blockedTasks = normalizeBlocked(p.blockedTasks);
      writeProgress(file, p);
      return r;
    });
  } catch (e) {
    warn(`lỗi ghi: ${e.message}`);
    return 1;
  }

  if (result.code) {
    warn(result.msg || `lỗi (code ${result.code})`);
    return result.code === 2 ? 2 : 1;
  }
  console.log(JSON.stringify({ ...result, file, repo }, null, 2));
  return 0;
}

let code = 0;
try { code = main(); } catch (e) { warn(`lỗi: ${e.message}`); code = 1; }
process.exit(code);
