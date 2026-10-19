#!/usr/bin/env node
/**
 * task-dashboard — server.mjs
 *
 * Dashboard read-only cho opencode parallel loop.
 *   node server.mjs --repo <path-to-project> [--port 7788]
 *   node server.mjs --demo [--port 7788]
 *
 * Nguyên tắc: CHỈ ĐỌC. Không ghi/sửa repo, không can thiệp loop.
 * Chỉ dùng builtin của Node (http, fs, path, child_process).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '1.0.0';

// ── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { port: 7788, repo: null, demo: false, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') out.demo = true;
    else if (a === '--repo') out.repo = argv[++i];
    else if (a.startsWith('--repo=')) out.repo = a.slice(7);
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) out.port = Number(a.slice(7));
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else { console.error(`⚠ tham số lạ: ${a}`); }
  }
  return out;
}

// ── git helpers (read-only) ─────────────────────────────────────────────────
function git(repo, args) {
  try {
    const out = execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: String(out).replace(/\s+$/, '') };
  } catch (e) {
    return {
      ok: false,
      out: String(e.stdout || '').trim(),
      err: String(e.stderr || e.message || '').trim(),
    };
  }
}

/** "layer-1__task-02" / "feature-x__phase-2__task-01" → task id */
function taskIdFromSlug(slug) {
  if (!slug) return null;
  const parts = String(slug).split('__').filter(Boolean);
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  if (/^task-\d+$/.test(last)) {
    const scope = parts.slice(0, -1);
    const layerIdx = scope.findIndex((s) => /^layer-\d+$/.test(s));
    if (layerIdx === 0) {
      return { id: `${scope[0]}/${last}`, layer: Number(scope[0].slice(6)), unit: scope[0] };
    }
    const phaseIdx = scope.findIndex((s) => /^phase-\d+$/.test(s));
    if (phaseIdx > 0) {
      const name = scope.slice(0, phaseIdx).join('-');
      const phase = Number(scope[phaseIdx].slice(6));
      return { id: `${name}/phase-${phase}/${last}`, layer: phase, unit: `${name}-phase-${phase}` };
    }
  }
  // fallback: id thô, vẫn hiển thị được
  return { id: parts.join('/'), layer: null, unit: null };
}

function layerOfTaskId(id) {
  if (typeof id !== 'string') return null;
  let m = id.match(/^layer-(\d+)\//);
  if (m) return Number(m[1]);
  m = id.match(/\/phase-(\d+)\//);
  if (m) return Number(m[1]);
  return null;
}

function listWorktrees(repo) {
  const r = git(repo, ['worktree', 'list', '--porcelain']);
  if (!r.ok) return { ok: false, error: r.err || 'git worktree list lỗi', list: [] };
  const list = [];
  for (const block of r.out.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((s) => s.trim()).filter(Boolean);
    const wt = lines.find((l) => l.startsWith('worktree '));
    if (!wt) continue;
    const p = wt.slice('worktree '.length);
    const br = lines.find((l) => l.startsWith('branch '));
    const head = lines.find((l) => l.startsWith('HEAD '));
    const branch = br ? br.slice('branch '.length).replace(/^refs\/heads\//, '') : null;
    list.push({
      path: p,
      branch,
      head: head ? head.slice(5) : null,
      detached: lines.includes('detached'),
      bare: lines.includes('bare'),
      prunable: lines.some((l) => l.startsWith('prunable')),
    });
  }
  return { ok: true, list };
}

function lastCommitTs(repo, branch) {
  if (!branch) return null;
  const r = git(repo, ['log', '-1', '--format=%ct', `refs/heads/${branch}`]);
  if (!r.ok || !r.out) return null;
  const n = Number(r.out);
  return Number.isFinite(n) ? n : null;
}

function dirActivityTs(dir) {
  let newest = 0;
  try {
    newest = fs.statSync(dir).mtimeMs / 1000;
  } catch { /* ignore */ }
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 250);
    for (const e of entries) {
      try {
        const st = fs.statSync(path.join(dir, e.name));
        const t = st.mtimeMs / 1000;
        if (t > newest) newest = t;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return newest || null;
}

// ── progress.json ───────────────────────────────────────────────────────────
function readProgress(repo) {
  const file = path.join(repo, '.context', 'progress.json');
  if (!fs.existsSync(file)) {
    return { ok: false, missing: true, file, error: 'không thấy .context/progress.json' };
  }
  try {
    const st = fs.statSync(file);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ok: true, file, raw, mtimeMs: st.mtimeMs, mode: raw.mode || 'build' };
  } catch (e) {
    return { ok: false, missing: false, file, error: `progress.json không parse được: ${e.message}` };
  }
}

// ── task files (để suy ra task "waiting") ───────────────────────────────────
function titleOfTaskFile(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8').slice(0, 4000);
    const m = txt.match(/^#\s+(.+)$/m);
    if (!m) return null;
    return m[1].replace(/^Task\s+\d+\s*[:.-]\s*/i, '').trim() || null;
  } catch {
    return null;
  }
}

function discoverTasks(repo) {
  const tasksRoot = path.join(repo, 'tasks');
  const found = [];
  if (!fs.existsSync(tasksRoot)) return found;
  let dirs = [];
  try {
    dirs = fs.readdirSync(tasksRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return found;
  }
  let reads = 0;
  for (const dirName of dirs) {
    const dir = path.join(tasksRoot, dirName);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch { continue; }
    for (const f of files) {
      let id = null;
      let m = f.match(/^layer-(\d+)-task-(\d+)\.md$/i);
      if (m) id = `layer-${m[1]}/task-${m[2]}`;
      if (!id) {
        m = f.match(/^phase-(\d+)-task-(\d+)\.md$/i);
        if (m) id = `${dirName}/phase-${m[1]}/task-${m[2]}`;
      }
      if (!id) continue;
      found.push({
        id,
        layer: layerOfTaskId(id),
        file: path.join(dir, f),
        title: reads < 120 ? titleOfTaskFile(path.join(dir, f)) : null,
      });
      reads++;
    }
  }
  return found;
}

// ── state builder (live) ────────────────────────────────────────────────────
function emptyState(over = {}) {
  return {
    ok: true,
    mode: 'live',
    projectName: '—',
    repo: null,
    currentLayer: 0,
    totalLayers: 0,
    phase: 'idle',
    counts: { running: 0, done: 0, blocked: 0, waiting: 0, total: 0 },
    tasks: [],
    merger: { name: 'Eve', active: false, state: 'idle' },
    lastUpdated: null,
    serverTime: new Date().toISOString(),
    version: VERSION,
    warnings: [],
    ...over,
  };
}

function buildLiveState(repo) {
  const warnings = [];
  const prog = readProgress(repo);
  if (!prog.ok) {
    return emptyState({
      mode: 'no-project',
      ok: false,
      repo,
      projectName: path.basename(repo),
      error: prog.error,
    });
  }

  const p = prog.raw || {};
  const completed = Array.isArray(p.completedTasks)
    ? p.completedTasks.filter((x) => typeof x === 'string')
    : [];
  const blockedArr = Array.isArray(p.blockedTasks)
    ? p.blockedTasks.filter((b) => b && typeof b.task === 'string')
    : [];
  const inProgress = typeof p.inProgressTask === 'string' && p.inProgressTask
    ? p.inProgressTask
    : (typeof p.activeWorkItem === 'string' && p.activeWorkItem ? p.activeWorkItem : null);
  const currentLayer = Number(p.currentLayer) || 0;
  const totalLayers = Number(p.totalLayers) || 0;

  // worktrees sống
  const wtRes = listWorktrees(repo);
  if (!wtRes.ok) warnings.push(wtRes.error);
  const builders = [];
  for (const w of wtRes.list) {
    if (!w.branch) continue;
    if (!w.branch.startsWith('wt/')) continue;
    const parsed = taskIdFromSlug(w.branch.slice(3));
    if (!parsed) continue;
    builders.push({ ...parsed, worktree: w.path, branch: w.branch, head: w.head });
  }

  const completedSet = new Set(completed);
  const blockedMap = new Map();
  for (const b of blockedArr) {
    blockedMap.set(b.task, {
      reason: typeof b.reason === 'string' ? b.reason : 'không rõ lý do',
      since: b.since || null,
    });
  }
  const runningMap = new Map();
  for (const b of builders) runningMap.set(b.id, b);
  if (inProgress && !runningMap.has(inProgress)) {
    runningMap.set(inProgress, { id: inProgress, layer: layerOfTaskId(inProgress), worktree: null, branch: null });
  }

  // task files → waiting. Chỉ lấy task cùng layer hiện tại: task file của scope khác
  // (feature-x/phase-N) không được làm sai mẫu số của progress.
  const allDiscovered = discoverTasks(repo);
  const discovered = allDiscovered.filter((d) => d.layer === currentLayer);
  const titleMap = new Map();
  for (const d of discovered) if (d.title) titleMap.set(d.id, d.title);

  const nowSec = Date.now() / 1000;
  const tasks = [];
  const seen = new Set();

  const push = (id, status, extra = {}) => {
    if (seen.has(id)) return;
    seen.add(id);
    tasks.push({
      id,
      layer: layerOfTaskId(id),
      status,
      agent: null,
      worktree: null,
      branch: null,
      reason: null,
      title: titleMap.get(id) || null,
      activeAgoSec: null,
      stale: false,
      ...extra,
    });
  };

  let builderNo = 0;
  const runningIds = [...runningMap.keys()].sort((a, b) => a.localeCompare(b));
  for (const id of runningIds) {
    const b = runningMap.get(id);
    builderNo++;
    let worktreeRel = null;
    let activeAgoSec = null;
    let stale = false;
    if (b.worktree) {
      try { worktreeRel = path.relative(repo, b.worktree) || '.'; } catch { worktreeRel = b.worktree; }
      const commitTs = lastCommitTs(repo, b.branch);
      const dirTs = dirActivityTs(b.worktree);
      const newest = Math.max(commitTs || 0, dirTs || 0);
      if (newest > 0) {
        activeAgoSec = Math.max(0, Math.round(nowSec - newest));
        stale = activeAgoSec > 600;
      }
    }
    push(id, 'running', {
      agent: `builder-${builderNo}`,
      worktree: worktreeRel,
      branch: b.branch,
      activeAgoSec,
      stale,
    });
  }

  for (const [id, info] of blockedMap) {
    push(id, 'blocked', { reason: info.reason, since: info.since, agent: null });
  }

  for (const id of completed) {
    push(id, 'done', { agent: 'merger' });
  }

  for (const d of discovered) {
    if (seen.has(d.id)) continue;
    push(d.id, 'waiting', { title: d.title || null });
  }

  // đếm trên toàn bộ (kể cả task done cũ không nằm trong display list)
  const counts = {
    running: tasks.filter((t) => t.status === 'running').length,
    done: tasks.filter((t) => t.status === 'done').length,
    blocked: tasks.filter((t) => t.status === 'blocked').length,
    waiting: tasks.filter((t) => t.status === 'waiting').length,
    total: tasks.length,
  };

  // giới hạn payload: done giữ 10 cái gần nhất, waiting 12, running/blocked đủ
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const waitingTasks = tasks.filter((t) => t.status === 'waiting');
  const keep = new Set([
    ...tasks.filter((t) => t.status === 'running' || t.status === 'blocked').map((t) => t.id),
    ...doneTasks.slice(-10).map((t) => t.id),
    ...waitingTasks.slice(0, 12).map((t) => t.id),
  ]);
  const trimmed = tasks.filter((t) => keep.has(t.id));

  const phase = computePhase({
    counts,
    currentLayer,
    totalLayers,
    explicit: typeof p.phase === 'string' ? p.phase : null,
  });

  return emptyState({
    mode: 'live',
    ok: true,
    repo,
    projectName: p.projectName || path.basename(repo),
    modeLabel: p.mode || null,
    currentLayer,
    totalLayers,
    phase,
    counts,
    tasks: trimmed.sort(sortTasks),
    merger: { name: 'Eve', active: phase === 'merging', state: mergerState(phase) },
    lastUpdated: p.lastUpdated || new Date(prog.mtimeMs).toISOString(),
    warnings,
  });
}

function sortTasks(a, b) {
  const la = a.layer == null ? 999 : a.layer;
  const lb = b.layer == null ? 999 : b.layer;
  if (la !== lb) return la - lb;
  return String(a.id).localeCompare(String(b.id));
}

function computePhase({ counts, currentLayer, totalLayers, explicit }) {
  if (explicit) return explicit;
  if (counts.running > 0) return 'building';
  if (counts.done > 0 && counts.blocked === 0 && counts.waiting === 0) return 'complete';
  if (counts.done > 0) return 'merging';
  if (counts.blocked > 0) return 'blocked';
  if (totalLayers > 0 && currentLayer >= totalLayers) return 'complete';
  return 'idle';
}

function mergerState(phase) {
  if (phase === 'merging') return 'merging';
  if (phase === 'complete') return 'celebrating';
  if (phase === 'blocked') return 'worried';
  return 'idle';
}

// ── demo state ──────────────────────────────────────────────────────────────
const DEMO_TITLES = {
  'layer-0/task-01': 'Khởi tạo schema DB',
  'layer-0/task-02': 'Migration + seed data',
  'layer-0/task-03': 'Auth middleware',
  'layer-1/task-01': 'REST API /users',
  'layer-1/task-02': 'REST API /orders',
  'layer-1/task-03': 'Validation layer',
  'layer-1/task-04': 'Payment webhook',
  'layer-1/task-05': 'Rate limiter',
  'layer-1/task-06': 'Integration test',
  'layer-2/task-01': 'Dashboard UI shell',
  'layer-2/task-02': 'Order list view',
  'layer-2/task-03': 'Realtime status',
  'layer-2/task-04': 'Export CSV',
};

function demoTasks(list) {
  return list.map((t) => ({
    id: t.id,
    layer: layerOfTaskId(t.id),
    status: t.status,
    agent: t.status === 'running' ? t.agent : t.status === 'done' ? 'merger' : null,
    worktree: t.status === 'running' ? `.worktrees/${t.id.replace(/\//g, '__')}` : null,
    branch: t.status === 'running' ? `wt/${t.id.replace(/\//g, '__')}` : null,
    reason: t.reason || null,
    title: DEMO_TITLES[t.id] || null,
    activeAgoSec: t.status === 'running' ? t.ago : null,
    stale: false,
  }));
}

function buildDemoState() {
  const t = (Date.now() / 1000) % 54;
  let scene;
  if (t < 22) scene = 'buildA';
  else if (t < 34) scene = 'mergeA';
  else if (t < 46) scene = 'buildB';
  else scene = 'doneB';

  const baseDone = [
    'layer-0/task-01', 'layer-0/task-02', 'layer-0/task-03',
    'layer-1/task-01',
  ];

  let tasks = [];
  let currentLayer = 1;
  let totalLayers = 4;
  let phase = 'building';
  let projectName = 'acme-crm';
  let lastUpdated = new Date().toISOString();

  if (scene === 'buildA') {
    tasks = demoTasks([
      ...baseDone.map((id) => ({ id, status: 'done' })),
      { id: 'layer-1/task-02', status: 'running', agent: 'builder-1', ago: 3 },
      { id: 'layer-1/task-03', status: 'running', agent: 'builder-2', ago: 11 },
      { id: 'layer-1/task-05', status: 'running', agent: 'builder-3', ago: 27 },
      { id: 'layer-1/task-04', status: 'blocked', reason: 'Chờ API key của payment provider' },
      { id: 'layer-1/task-06', status: 'waiting' },
    ]);
  } else if (scene === 'mergeA') {
    const all = ['01', '02', '03', '04', '05', '06'].map((n) => `layer-1/task-${n}`);
    tasks = demoTasks([
      ...baseDone.map((id) => ({ id, status: 'done' })),
      ...all.map((id) => ({ id, status: 'done' })),
    ]);
    phase = 'merging';
  } else if (scene === 'buildB') {
    const layer1 = ['01', '02', '03', '04', '05', '06'].map((n) => `layer-1/task-${n}`);
    tasks = demoTasks([
      ...baseDone.map((id) => ({ id, status: 'done' })),
      ...layer1.map((id) => ({ id, status: 'done' })),
      { id: 'layer-2/task-01', status: 'running', agent: 'builder-1', ago: 5 },
      { id: 'layer-2/task-02', status: 'running', agent: 'builder-2', ago: 19 },
      { id: 'layer-2/task-03', status: 'blocked', reason: 'Conflict merge ở file router.ts' },
      { id: 'layer-2/task-04', status: 'waiting' },
    ]);
    currentLayer = 2;
  } else {
    tasks = demoTasks([
      ...baseDone.map((id) => ({ id, status: 'done' })),
      ...['01', '02', '03', '04', '05', '06'].map((n) => ({ id: `layer-1/task-${n}`, status: 'done' })),
      ...['01', '02', '03', '04'].map((n) => ({ id: `layer-2/task-${n}`, status: 'done' })),
    ]);
    currentLayer = 2;
    phase = 'complete';
  }

  const counts = {
    running: tasks.filter((x) => x.status === 'running').length,
    done: tasks.filter((x) => x.status === 'done').length,
    blocked: tasks.filter((x) => x.status === 'blocked').length,
    waiting: tasks.filter((x) => x.status === 'waiting').length,
    total: tasks.length,
  };

  return emptyState({
    mode: 'demo',
    modeLabel: 'demo',
    projectName,
    repo: null,
    currentLayer,
    totalLayers,
    phase,
    counts,
    tasks: tasks.sort(sortTasks),
    merger: { name: 'Eve', active: phase === 'merging', state: mergerState(phase) },
    lastUpdated,
    demoScene: scene,
    warnings: ['Dữ liệu giả lập — chạy --repo <path> để xem project thật'],
  });
}

// ── HTTP ────────────────────────────────────────────────────────────────────
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`task-dashboard ${VERSION}

  node server.mjs --repo <path-to-project-repo> [--port 7788]
  node server.mjs --demo [--port 7788]

Options:
  --repo <path>   repo cần xem (read-only)
  --demo          dữ liệu giả lập, không cần repo
  --port <n>      mặc định 7788
  --host <addr>   mặc định 127.0.0.1 (dùng 0.0.0.0 nếu muốn mở LAN)
`);
    return;
  }

  if (!args.demo && !args.repo) {
    console.error('✖ Cần --repo <path> hoặc --demo. Xem --help.');
    process.exit(1);
  }

  let repo = null;
  if (!args.demo) {
    repo = path.resolve(args.repo);
    if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) {
      console.error(`✖ không thấy thư mục repo: ${repo}`);
      process.exit(1);
    }
  }

  const indexFile = path.join(HERE, 'index.html');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      });
      return res.end();
    }
    if (req.method !== 'GET') {
      return sendJson(res, 405, { ok: false, error: 'method not allowed' });
    }

    if (url.pathname === '/api/state') {
      try {
        const state = args.demo ? buildDemoState() : buildLiveState(repo);
        return sendJson(res, 200, state);
      } catch (e) {
        return sendJson(res, 200, emptyState({
          ok: false,
          mode: 'error',
          repo,
          error: `lỗi server: ${e.message}`,
        }));
      }
    }

    if (url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, version: VERSION, demo: args.demo, repo });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      try {
        const html = fs.readFileSync(indexFile);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        return res.end(html);
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('thiếu index.html cạnh server.mjs');
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`✖ port ${args.port} đang bận. Thử --port ${args.port + 1}.`);
    } else {
      console.error(`✖ ${e.message}`);
    }
    process.exit(1);
  });

  server.listen(args.port, args.host, () => {
    const mode = args.demo ? 'DEMO (dữ liệu giả lập)' : `repo: ${repo}`;
    console.log(`▶ task-dashboard ${VERSION}`);
    console.log(`  ${mode}`);
    console.log(`  http://${args.host === '0.0.0.0' ? 'localhost' : args.host}:${args.port}`);
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 500).unref();
    });
  }
}

main();
