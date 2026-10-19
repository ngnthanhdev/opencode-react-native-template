#!/usr/bin/env node
/**
 * task-dashboard — server.mjs v2
 *
 * Dashboard read-only cho opencode parallel loop.
 *   node server.mjs --repo <path-to-project> [--port 7788]
 *   node server.mjs --demo [--port 7788]
 *
 * Nguyên tắc: CHỈ ĐỌC. Không ghi/sửa repo, không can thiệp loop.
 * Chỉ dùng builtin của Node (http, fs, path, child_process).
 *
 * Nguồn dữ liệu (theo thứ tự ưu tiên):
 *   1. `<repo>/.context/agents-live.json` — do `agent-live.mjs` ghi (display-only).
 *      Có file → biết chính xác agent/role/phase/task.
 *   2. Fallback: git worktree + progress.json (suy luận gần đúng, kèm warning).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '2.0.0';

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

// ── agents-live.json (display-only, do agent-live.mjs ghi) ──────────────────
function readAgentsLive(repo) {
  const file = path.join(repo, '.context', 'agents-live.json');
  if (!fs.existsSync(file)) {
    return { ok: false, missing: true, file, agents: [], updatedAt: null };
  }
  try {
    const st = fs.statSync(file);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const agents = Array.isArray(raw.agents)
      ? raw.agents.filter((a) => a && typeof a.agent === 'string' && a.agent)
      : [];
    return {
      ok: true,
      missing: false,
      file,
      agents,
      updatedAt: raw.updatedAt || new Date(st.mtimeMs).toISOString(),
      mtimeMs: st.mtimeMs,
    };
  } catch (e) {
    return {
      ok: false,
      missing: false,
      file,
      agents: [],
      updatedAt: null,
      error: `agents-live.json không parse được: ${e.message}`,
    };
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

// ── state builder ───────────────────────────────────────────────────────────
function emptyState(over = {}) {
  return {
    ok: true,
    mode: 'live',
    projectName: '—',
    repo: null,
    currentLayer: 0,
    totalLayers: 0,
    phase: 'idle',
    counts: { building: 0, review: 0, done: 0, blocked: 0, todo: 0, running: 0, waiting: 0, total: 0 },
    tasks: [],
    agents: [],
    benchAgents: [],
    columns: { todo: [], review: [], done: [] },
    merger: { name: 'Eve', active: false, state: 'idle' },
    agentsLive: { present: false, updatedAt: null, count: 0 },
    fallback: false,
    lastUpdated: null,
    serverTime: new Date().toISOString(),
    version: VERSION,
    warnings: [],
    ...over,
  };
}

function normAgent(a, nowSec) {
  let sinceSec = null;
  if (a.since) {
    const t = Date.parse(a.since);
    if (Number.isFinite(t)) sinceSec = Math.max(0, Math.round(nowSec - t / 1000));
  }
  return {
    agent: a.agent,
    role: a.role || 'builder',
    task: a.task || null,
    title: a.title || null,
    phase: a.phase || 'building',
    worktree: a.worktree || null,
    since: a.since || null,
    sinceSec,
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
  const nowSec = Date.now() / 1000;

  // ── nguồn 1: agents-live.json ────────────────────────────────────────────
  const live = readAgentsLive(repo);
  const useLive = live.ok;
  let fallback = false;
  if (!live.ok) {
    fallback = true;
    warnings.push(live.missing
      ? 'agents-live.json chưa có, đang suy luận gần đúng từ progress.json + git worktree'
      : (live.error || 'agents-live.json lỗi, đang suy luận gần đúng'));
  } else if (!live.agents.length) {
    warnings.push('agents-live.json rỗng (loop đang idle hoặc chưa enter agent nào)');
  }

  // worktrees sống (dùng cho cả fallback lẫn bổ sung worktree path)
  const wtRes = listWorktrees(repo);
  if (!wtRes.ok) warnings.push(wtRes.error);
  const wtByTask = new Map();
  for (const w of wtRes.list) {
    if (!w.branch || !w.branch.startsWith('wt/')) continue;
    const parsed = taskIdFromSlug(w.branch.slice(3));
    if (!parsed) continue;
    wtByTask.set(parsed.id, { ...parsed, worktree: w.path, branch: w.branch, head: w.head });
  }

  const completedSet = new Set(completed);
  const blockedMap = new Map();
  for (const b of blockedArr) {
    blockedMap.set(b.task, {
      reason: typeof b.reason === 'string' ? b.reason : 'không rõ lý do',
      since: b.since || null,
    });
  }

  // task file → title + danh sách waiting (chỉ layer hiện tại)
  const allDiscovered = discoverTasks(repo);
  const discovered = allDiscovered.filter((d) => d.layer === currentLayer);
  const titleMap = new Map();
  for (const d of allDiscovered) if (d.title) titleMap.set(d.id, d.title);

  // ── agents active ────────────────────────────────────────────────────────
  let agents = [];
  let benchAgents = [];
  if (useLive) {
    const normed = live.agents.map((a) => normAgent(a, nowSec));
    for (const a of normed) {
      if (a.phase === 'idle') benchAgents.push(a);
      else agents.push(a);
    }
    // bổ sung worktree từ git nếu agent-live không khai
    for (const a of agents) {
      if (!a.worktree && a.task && wtByTask.has(a.task)) {
        try { a.worktree = path.relative(repo, wtByTask.get(a.task).worktree) || '.'; } catch { /* ignore */ }
      }
      if (!a.title && a.task && titleMap.has(a.task)) a.title = titleMap.get(a.task);
    }
    for (const a of benchAgents) {
      if (!a.title && a.task && titleMap.has(a.task)) a.title = titleMap.get(a.task);
    }
  } else {
    // fallback: mỗi worktree sống = 1 builder
    const ids = [...wtByTask.keys()].sort((a, b) => a.localeCompare(b));
    let n = 0;
    for (const id of ids) {
      if (completedSet.has(id)) continue; // đã done thì không còn là builder
      const w = wtByTask.get(id);
      n++;
      const commitTs = lastCommitTs(repo, w.branch);
      const dirTs = dirActivityTs(w.worktree);
      const newest = Math.max(commitTs || 0, dirTs || 0);
      const activeAgoSec = newest > 0 ? Math.max(0, Math.round(nowSec - newest)) : null;
      let rel = w.worktree;
      try { rel = path.relative(repo, w.worktree) || '.'; } catch { /* ignore */ }
      agents.push({
        agent: `builder-${n}`,
        role: 'builder',
        task: id,
        title: titleMap.get(id) || null,
        phase: 'building',
        worktree: rel,
        since: newest ? new Date(newest * 1000).toISOString() : null,
        sinceSec: null,
        activeAgoSec,
        stale: activeAgoSec != null && activeAgoSec > 600,
        guessed: true,
      });
    }
    // inProgress không có worktree → đoán đang review (kém tin cậy)
    if (inProgress && !completedSet.has(inProgress) && !wtByTask.has(inProgress)) {
      agents.push({
        agent: 'builder-active',
        role: 'builder',
        task: inProgress,
        title: titleMap.get(inProgress) || null,
        phase: 'building',
        worktree: null,
        since: null,
        sinceSec: null,
        activeAgoSec: null,
        stale: false,
        guessed: true,
      });
    }
  }

  // map task → agent
  const agentByTask = new Map();
  const reviewerByTask = new Map();
  for (const a of agents) {
    if (!a.task) continue;
    if (a.role === 'reviewer') reviewerByTask.set(a.task, a);
    else if (a.role === 'builder') agentByTask.set(a.task, a);
  }
  const mergerAgent = agents.find((a) => a.role === 'merger') || null;

  // ── phân loại task ──────────────────────────────────────────────────────
  const tasks = [];
  const seen = new Set();
  const pushTask = (id, status, extra = {}) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const b = agentByTask.get(id) || null;
    const r = reviewerByTask.get(id) || null;
    tasks.push({
      id,
      layer: layerOfTaskId(id),
      title: titleMap.get(id) || (b && b.title) || (r && r.title) || null,
      status,
      agent: r ? r.agent : (b ? b.agent : null),
      role: r ? 'reviewer' : (b ? 'builder' : null),
      phase: r ? 'review' : (b ? 'building' : null),
      worktree: (b && b.worktree) || (wtByTask.has(id) ? relative(repo, wtByTask.get(id).worktree) : null),
      reason: null,
      since: r ? r.since : (b ? b.since : null),
      activeAgoSec: b && b.activeAgoSec != null ? b.activeAgoSec : null,
      stale: !!((b && b.stale) || (r && r.stale)),
      guessed: !!((b && b.guessed) || (r && r.guessed)),
      ...extra,
    });
  };

  // mọi id biết được
  const ids = new Set();
  for (const id of completed) ids.add(id);
  for (const id of blockedMap.keys()) ids.add(id);
  if (inProgress) ids.add(inProgress);
  for (const a of agents) if (a.task) ids.add(a.task);
  for (const id of wtByTask.keys()) ids.add(id);
  for (const d of discovered) ids.add(d.id);

  for (const id of [...ids].sort((a, b) => cmpTaskId(a, b))) {
    const reviewer = reviewerByTask.get(id) || null;
    const builder = agentByTask.get(id) || null;

    if (completedSet.has(id)) {
      pushTask(id, 'done', { agent: 'merger' });
      continue;
    }
    if (reviewer) {
      pushTask(id, 'review', { agent: reviewer.agent, role: 'reviewer', phase: 'review' });
      continue;
    }
    if (builder) {
      pushTask(id, 'running');
      continue;
    }
    if (blockedMap.has(id)) {
      const info = blockedMap.get(id);
      pushTask(id, 'blocked', { reason: info.reason, since: info.since || null });
      continue;
    }
    // fallback: không còn worktree, không có agent, chưa done → có thể vừa rời worktree
    if (!useLive && inProgress === id && !wtByTask.has(id)) {
      pushTask(id, 'review', { guessed: true, agent: null, role: null, phase: 'review' });
      continue;
    }
    pushTask(id, 'waiting');
  }

  const todo = tasks.filter((t) => t.status === 'waiting' || t.status === 'blocked');
  const review = tasks.filter((t) => t.status === 'review');
  const done = tasks.filter((t) => t.status === 'done');

  const counts = {
    building: tasks.filter((t) => t.status === 'running').length,
    review: review.length,
    done: done.length,
    blocked: tasks.filter((t) => t.status === 'blocked').length,
    todo: todo.length,
    // legacy
    running: tasks.filter((t) => t.status === 'running').length,
    waiting: tasks.filter((t) => t.status === 'waiting').length,
    total: tasks.length,
  };

  const phase = computePhase({
    counts,
    currentLayer,
    totalLayers,
    mergerActive: !!mergerAgent,
    explicit: typeof p.phase === 'string' ? p.phase : null,
  });

  // giới hạn payload: done 12 gần nhất, todo 20, review đủ
  const trim = (arr, n) => (arr.length > n ? arr.slice(-n) : arr);
  const columns = {
    todo: trim(todo, 20),
    review: review.slice(0, 12),
    done: trim(done, 12),
  };

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
    tasks: [...tasks].sort(sortTasks),
    agents,
    benchAgents,
    columns,
    merger: {
      name: 'Eve',
      active: !!mergerAgent || phase === 'merging',
      state: mergerState(phase),
      agent: mergerAgent ? mergerAgent.agent : null,
    },
    agentsLive: {
      present: live.ok && !live.missing,
      updatedAt: live.updatedAt || null,
      count: live.ok ? live.agents.length : 0,
    },
    fallback,
    lastUpdated: p.lastUpdated || new Date(prog.mtimeMs).toISOString(),
    warnings,
  });
}

function relative(repo, p) {
  try { return path.relative(repo, p) || '.'; } catch { return p; }
}

function cmpTaskId(a, b) {
  const la = layerOfTaskId(a);
  const lb = layerOfTaskId(b);
  const na = la == null ? 999 : la;
  const nb = lb == null ? 999 : lb;
  if (na !== nb) return na - nb;
  return String(a).localeCompare(String(b));
}

function sortTasks(a, b) {
  return cmpTaskId(a.id, b.id);
}

function computePhase({ counts, currentLayer, totalLayers, mergerActive, explicit }) {
  if (explicit) return explicit;
  if (mergerActive) return 'merging';
  if (counts.building > 0) return 'building';
  if (counts.review > 0) return 'review';
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

const DEMO_CYCLE = 52;

/**
 * Demo kể đúng luồng mới:
 *   build (0-14) → review (14-26) → review xong/done (26-38) → merge (38-52)
 */
function buildDemoState() {
  const t = (Date.now() / 1000) % DEMO_CYCLE;
  const now = Date.now() / 1000;
  const iso = (agoSec) => new Date((now - agoSec) * 1000).toISOString();
  const baseDone = ['layer-0/task-01', 'layer-0/task-02', 'layer-0/task-03', 'layer-1/task-01'];

  let scene;
  if (t < 14) scene = 'build';
  else if (t < 26) scene = 'review';
  else if (t < 38) scene = 'review-done';
  else scene = 'merge';

  const agents = [];
  const benchAgents = [];
  const columns = { todo: [], review: [], done: [] };
  let currentLayer = 1;
  const totalLayers = 4;

  const card = (id, status, extra = {}) => ({
    id,
    layer: layerOfTaskId(id),
    title: DEMO_TITLES[id] || null,
    status,
    agent: null,
    role: null,
    phase: null,
    worktree: null,
    reason: null,
    since: null,
    activeAgoSec: null,
    stale: false,
    guessed: false,
    ...extra,
  });

  const doneIds = [...baseDone];

  if (scene === 'build') {
    agents.push(
      { agent: 'builder-1', role: 'builder', task: 'layer-1/task-02', title: DEMO_TITLES['layer-1/task-02'], phase: 'building', worktree: '.worktrees/wt/layer-1__task-02', since: iso(42), sinceSec: 42 },
      { agent: 'builder-2', role: 'builder', task: 'layer-1/task-03', title: DEMO_TITLES['layer-1/task-03'], phase: 'building', worktree: '.worktrees/wt/layer-1__task-03', since: iso(96), sinceSec: 96 },
      { agent: 'builder-3', role: 'builder', task: 'layer-1/task-05', title: DEMO_TITLES['layer-1/task-05'], phase: 'building', worktree: '.worktrees/wt/layer-1__task-05', since: iso(184), sinceSec: 184 }
    );
    benchAgents.push(
      { agent: 'builder-4', role: 'builder', task: null, title: null, phase: 'idle', worktree: null, since: iso(300), sinceSec: 300 }
    );
    columns.todo = [
      card('layer-1/task-06', 'waiting'),
      card('layer-1/task-04', 'blocked', { reason: 'Chờ API key của payment provider' }),
    ];
  } else if (scene === 'review') {
    // builder-1 xong → release; task-02 sang REVIEW với reviewer-1
    agents.push(
      { agent: 'builder-2', role: 'builder', task: 'layer-1/task-03', title: DEMO_TITLES['layer-1/task-03'], phase: 'building', worktree: '.worktrees/wt/layer-1__task-03', since: iso(108), sinceSec: 108 },
      { agent: 'builder-3', role: 'builder', task: 'layer-1/task-05', title: DEMO_TITLES['layer-1/task-05'], phase: 'building', worktree: '.worktrees/wt/layer-1__task-05', since: iso(196), sinceSec: 196 },
      { agent: 'reviewer-1', role: 'reviewer', task: 'layer-1/task-02', title: DEMO_TITLES['layer-1/task-02'], phase: 'review', worktree: null, since: iso(9), sinceSec: 9 }
    );
    benchAgents.push(
      { agent: 'builder-4', role: 'builder', task: null, title: null, phase: 'idle', worktree: null, since: iso(300), sinceSec: 300 }
    );
    columns.review = [
      card('layer-1/task-02', 'review', { agent: 'reviewer-1', role: 'reviewer', phase: 'review', since: iso(9), activeAgoSec: 9 }),
    ];
    columns.todo = [
      card('layer-1/task-06', 'waiting'),
      card('layer-1/task-04', 'blocked', { reason: 'Chờ API key của payment provider' }),
    ];
  } else if (scene === 'review-done') {
    // reviewer PASS → task vào DONE, reviewer biến mất
    doneIds.push('layer-1/task-02');
    agents.push(
      { agent: 'builder-2', role: 'builder', task: 'layer-1/task-03', title: DEMO_TITLES['layer-1/task-03'], phase: 'building', worktree: '.worktrees/wt/layer-1__task-03', since: iso(120), sinceSec: 120 },
      { agent: 'builder-3', role: 'builder', task: 'layer-1/task-05', title: DEMO_TITLES['layer-1/task-05'], phase: 'building', worktree: '.worktrees/wt/layer-1__task-05', since: iso(208), sinceSec: 208 }
    );
    columns.todo = [
      card('layer-1/task-06', 'waiting'),
      card('layer-1/task-04', 'blocked', { reason: 'Chờ API key của payment provider' }),
    ];
  } else {
    // merger active, layer 1 xong
    const layer1 = ['01', '02', '03', '04', '05', '06'].map((n) => `layer-1/task-${n}`);
    for (const id of layer1) if (!doneIds.includes(id)) doneIds.push(id);
    agents.push(
      { agent: 'merger', role: 'merger', task: null, title: null, phase: 'merging', worktree: null, since: iso(6), sinceSec: 6 }
    );
  }

  const doneCards = doneIds.map((id) => card(id, 'done', { agent: 'merger' }));
  columns.done = doneCards.slice(-12);

  const allCards = [
    ...columns.todo, ...columns.review, ...columns.done,
    ...agents.filter((a) => a.role === 'builder' && a.task).map((a) => card(a.task, 'running', {
      agent: a.agent, role: 'builder', phase: 'building', worktree: a.worktree, since: a.since, activeAgoSec: a.sinceSec,
    })),
  ];

  const counts = {
    building: allCards.filter((c) => c.status === 'running').length,
    review: columns.review.length,
    done: columns.done.length,
    blocked: columns.todo.filter((c) => c.status === 'blocked').length,
    todo: columns.todo.length,
    running: allCards.filter((c) => c.status === 'running').length,
    waiting: columns.todo.filter((c) => c.status === 'waiting').length,
    total: allCards.length,
  };

  const mergerAgent = agents.find((a) => a.role === 'merger') || null;
  const phase = computePhase({
    counts,
    currentLayer,
    totalLayers,
    mergerActive: !!mergerAgent,
    explicit: null,
  });

  return emptyState({
    mode: 'demo',
    modeLabel: 'demo',
    projectName: 'acme-crm',
    repo: null,
    currentLayer,
    totalLayers,
    phase,
    counts,
    tasks: [...allCards].sort(sortTasks),
    agents,
    benchAgents,
    columns: {
      todo: columns.todo,
      review: columns.review,
      done: columns.done,
    },
    merger: { name: 'Eve', active: !!mergerAgent, state: mergerState(phase), agent: mergerAgent ? 'merger' : null },
    agentsLive: { present: true, updatedAt: new Date().toISOString(), count: agents.length },
    fallback: false,
    lastUpdated: new Date().toISOString(),
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
