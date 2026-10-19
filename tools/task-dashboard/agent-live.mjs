#!/usr/bin/env node
/**
 * agent-live.mjs — ghi file trạng thái CHỈ-HIỂN-THỊ `.context/agents-live.json`
 * cho task-dashboard vẽ agent nào đang làm gì.
 *
 *   node tools/task-dashboard/agent-live.mjs enter --agent builder-1 --role builder \
 *        --task layer-1/task-02 --title "REST API /users" --phase building \
 *        [--worktree .worktrees/wt/layer-1__task-02] [--repo <path>]
 *   node tools/task-dashboard/agent-live.mjs leave --agent builder-1
 *   node tools/task-dashboard/agent-live.mjs clear
 *
 * Nguyên tắc:
 *  - File này KHÔNG phải source of truth. `progress.json` vẫn là chính.
 *  - Mất/hỏng file này KHÔNG ảnh hưởng loop build.
 *  - Ghi atomic (tmp + rename) và chịu được nhiều process ghi song song
 *    (lock thư mục + đọc-merge-ghi + retry). Không bao giờ crash khi file chưa có.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROLES = new Set(['builder', 'reviewer', 'merger']);
const PHASES = new Set(['building', 'review', 'merging', 'idle']);

// ── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 2) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) out[a.slice(2)] = true;
        else { out[a.slice(2)] = v; i++; }
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function warn(msg) {
  process.stderr.write(`⚠ agent-live: ${msg}\n`);
}

// ── tìm repo root ───────────────────────────────────────────────────────────
function findRepo(explicit) {
  if (explicit && explicit !== true) return path.resolve(String(explicit));

  // trong git worktree, --show-toplevel trả về worktree; ưu tiên repo chính
  try {
    const common = execFileSync(
      'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (common && path.basename(common) === '.git') return path.dirname(common);
  } catch { /* không phải git repo / git cũ */ }

  try {
    const top = execFileSync(
      'git', ['rev-parse', '--show-toplevel'],
      { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (top) return top;
  } catch { /* ignore */ }

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

function readState(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const agents = Array.isArray(raw.agents)
      ? raw.agents.filter((a) => a && typeof a.agent === 'string' && a.agent)
      : [];
    return { updatedAt: raw.updatedAt || null, agents };
  } catch (e) {
    if (e.code === 'ENOENT') return { updatedAt: null, agents: [] };
    warn(`${path.basename(file)} không parse được (${e.message}) — reset về rỗng`);
    return { updatedAt: null, agents: [] };
  }
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    agents: state.agents,
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, body, 'utf8');
  for (let i = 0; i < 10; i++) {
    try {
      fs.renameSync(tmp, file);
      return payload;
    } catch (e) {
      if (i === 9) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw e;
      }
      sleep(30);
    }
  }
  return payload;
}

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const help = args.help || args.h || !cmd;

  if (help || cmd === 'help') {
    console.log(`agent-live — ghi .context/agents-live.json (file hiển thị cho task-dashboard)

  node agent-live.mjs enter --agent <id> --role <builder|reviewer|merger> \\
      [--task <layer-N/task-NN>] [--title "<...>"] --phase <building|review|merging> \\
      [--worktree <path>] [--repo <path>]
  node agent-live.mjs leave --agent <id> [--repo <path>]
  node agent-live.mjs clear [--repo <path>]

  --repo   mặc định tự tìm repo root (git rev-parse / đi ngược thư mục)
  File luôn ghi ở <repo>/.context/agents-live.json
`);
    return 0;
  }

  const repo = findRepo(args.repo);
  const file = path.join(repo, '.context', 'agents-live.json');

  if (cmd === 'enter') {
    const agent = typeof args.agent === 'string' ? args.agent.trim() : '';
    if (!agent) {
      warn('enter cần --agent <id>');
      return 1;
    }
    const role = typeof args.role === 'string' ? args.role : 'builder';
    if (!ROLES.has(role)) {
      warn(`--role không hợp lệ: ${role} (chỉ builder|reviewer|merger)`);
      return 1;
    }
    let phase = typeof args.phase === 'string' ? args.phase : null;
    if (!phase) phase = role === 'merger' ? 'merging' : role === 'reviewer' ? 'review' : 'building';
    if (!PHASES.has(phase)) {
      warn(`--phase không hợp lệ: ${phase} (chỉ building|review|merging|idle)`);
      return 1;
    }
    const task = typeof args.task === 'string' ? args.task : null;
    const title = typeof args.title === 'string' ? args.title : null;
    const worktree = typeof args.worktree === 'string' ? args.worktree : null;

    const payload = withLock(file, () => {
      const st = readState(file);
      const prev = st.agents.find((a) => a.agent === agent) || null;
      // giữ `since` nếu vẫn cùng task + phase (tránh reset đồng hồ mỗi lần gọi lại)
      const since = prev && prev.task === task && prev.phase === phase && prev.since
        ? prev.since
        : new Date().toISOString();
      const entry = { agent, role, phase };
      if (task) entry.task = task;
      if (title) entry.title = title;
      if (worktree) entry.worktree = worktree;
      entry.since = since;
      const agents = st.agents.filter((a) => a.agent !== agent);
      agents.push(entry);
      agents.sort((a, b) => String(a.agent).localeCompare(String(b.agent)));
      return writeState(file, { agents });
    });

    console.log(JSON.stringify({ ok: true, file, action: 'enter', agent, count: payload.agents.length }));
    return 0;
  }

  if (cmd === 'leave') {
    const agent = typeof args.agent === 'string' ? args.agent.trim() : '';
    if (!agent) {
      warn('leave cần --agent <id>');
      return 1;
    }
    const payload = withLock(file, () => {
      const st = readState(file);
      const before = st.agents.length;
      const agents = st.agents.filter((a) => a.agent !== agent);
      if (agents.length === before) {
        // không có trong file → vẫn ghi lại cho đồng bộ updatedAt (nhưng không tạo rác)
        if (before === 0 && !fs.existsSync(file)) return { agents, noop: true };
      }
      return writeState(file, { agents });
    });
    console.log(JSON.stringify({ ok: true, file, action: 'leave', agent, count: payload.agents.length, noop: !!payload.noop }));
    return 0;
  }

  if (cmd === 'clear') {
    const payload = withLock(file, () => writeState(file, { agents: [] }));
    console.log(JSON.stringify({ ok: true, file, action: 'clear', count: payload.agents.length }));
    return 0;
  }

  warn(`lệnh lạ: ${cmd} (chỉ enter|leave|clear)`);
  return 1;
}

let code = 0;
try {
  code = main();
} catch (e) {
  warn(`lỗi: ${e.message}`);
  code = 1;
}
process.exit(code);
