#!/usr/bin/env node
/**
 * parallel-dispatch.mjs — Hỗ trợ chạy SONG SONG nhiều task độc lập trong 1 layer.
 *
 * Mô hình: worktree-per-task.
 *   • Mỗi task độc lập → 1 git worktree + branch riêng (hoàn toàn cô lập, không giẫm chân nhau).
 *   • Mỗi builder agent chạy loop ĐẦY ĐỦ (Read→Plan→Act→Observe→Review→Commit) TRONG worktree của mình.
 *   • Sau khi tất cả xong → merger gom các branch về nhánh tích hợp của layer, verify tổng thể,
 *     rồi update `.context/progress.json` 1 LẦN (tránh race condition ghi state).
 *
 * Script này KHÔNG tự spawn agent (việc đó do `.agent/loop.md` điều phối qua sessions_spawn).
 * Nó chỉ lo phần git/worktree + kiểm tra độc lập + merge an toàn, để agent gọi bằng lệnh con.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * LỆNH CON
 *
 *   plan --layer <N>
 *     In ra nhóm task CÓ THỂ chạy song song trong layer N, dựa trên trường
 *     "Files to Create/Modify" của từng task file. 2 task khai TRÙNG file → KHÔNG
 *     cho song song (đẩy task sau sang lượt kế tiếp). Output JSON:
 *       { "layer": N, "integrationBranch": "...", "waves": [ [task...], [task...] ] }
 *
 *   setup --task <layer-N/task-NN> [--base <ref>]
 *     Tạo worktree + branch cho 1 task. In ra đường dẫn worktree (builder cd vào đó chạy).
 *       worktree: .worktrees/<layer-N__task-NN>
 *       branch:   wt/<layer-N__task-NN>
 *     --base mặc định = HEAD của integration branch của layer (hoặc nhánh hiện tại).
 *
 *   merge --layer <N> [--no-verify]
 *     Gom TẤT CẢ branch wt/<layer-N__*> (đã commit) vào integration branch của layer.
 *     Merge tuần tự; nếu conflict → DỪNG, in task gây conflict để human/agent xử lý.
 *     Mặc định in verifyHint để agent chạy verify tổng thể (lệnh từ .context/project-config.md).
 *
 *   cleanup --layer <N>
 *     Xoá worktree + branch tạm của layer sau khi merge xong & progress.json đã cập nhật.
 *
 *   status
 *     Liệt kê worktree hiện có + branch wt/* + trạng thái commit.
 *
 * AN TOÀN
 *   • Không tự ghi .context/progress.json — chỉ merger agent ghi (qua loop.md), tránh race.
 *   • merge dừng ngay khi conflict, không ép -X theirs/ours.
 *   • cleanup chỉ xoá đúng worktree/branch mang prefix của layer.
 *
 * CÁCH DÙNG
 *   node scripts/parallel-dispatch.mjs plan --layer 1
 *   node scripts/parallel-dispatch.mjs setup --task layer-1/task-03
 *   node scripts/parallel-dispatch.mjs merge --layer 1
 *   node scripts/parallel-dispatch.mjs cleanup --layer 1
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
}
function shTry(cmd, args, opts = {}) {
  try { return { ok: true, out: sh(cmd, args, opts).trim() } }
  catch (e) { return { ok: false, out: (e.stdout || '').toString().trim(), err: (e.stderr || e.message || '').toString().trim() } }
}
function die(msg) { console.error(`✖ ${msg}`); process.exit(1) }

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]; out[k] = v }
    else out._.push(a)
  }
  return out
}

// task id "layer-1/task-03" → slug an toàn cho branch/worktree "layer-1__task-03"
function taskSlug(taskId) { return taskId.replace(/[\/]/g, '__') }
function branchName(taskId) { return `wt/${taskSlug(taskId)}` }
function worktreePath(taskId) { return path.join(ROOT, '.worktrees', taskSlug(taskId)) }
function integrationBranch(layer) { return `layer-${layer}-integration` }

// ── tìm task files của 1 layer ──────────────────────────────────────────────
function findLayerTasks(layer) {
  const tasksRoot = path.join(ROOT, 'tasks')
  if (!fs.existsSync(tasksRoot)) return []
  const results = []
  const prefix = `layer-${layer}-task-`
  for (const slug of fs.readdirSync(tasksRoot)) {
    const dir = path.join(tasksRoot, slug)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(prefix) && f.endsWith('.md')) {
        const m = f.match(/task-(\d+)/)
        results.push({ id: `layer-${layer}/task-${m ? m[1] : '??'}`, file: path.join(dir, f), slug })
      }
    }
  }
  return results.sort((a, b) => a.file.localeCompare(b.file))
}

// đọc "Files to Create/Modify" từ task file → danh sách path (để check độc lập)
function filesOfTask(taskFile) {
  const txt = fs.readFileSync(taskFile, 'utf8')
  const m = txt.match(/##\s*Files to Create\/Modify([\s\S]*?)(?:\n##\s|\n#\s|$)/i)
  if (!m) return []
  const files = []
  for (const line of m[1].split('\n')) {
    const g = line.match(/[-*]\s*`?([^`\s]+)`?/)
    if (g && g[1] && !g[1].startsWith('#')) files.push(g[1].replace(/`/g, '').trim())
  }
  return files
}

// Chia task thành các "wave" chạy song song: task trùng file KHÔNG cùng wave.
function planWaves(layer) {
  const tasks = findLayerTasks(layer)
  const waves = []
  const remaining = tasks.map(t => ({ ...t, files: filesOfTask(t.file) }))
  while (remaining.length) {
    const wave = []
    const claimed = new Set()
    for (let i = 0; i < remaining.length; i++) {
      const t = remaining[i]
      const conflict = t.files.some(f => claimed.has(f))
      if (!conflict) { t.files.forEach(f => claimed.add(f)); wave.push(t); remaining.splice(i, 1); i-- }
    }
    if (!wave.length) { // tất cả còn lại đều trùng nhau → mỗi cái 1 wave để khỏi kẹt
      wave.push(remaining.shift())
    }
    waves.push(wave.map(t => ({ id: t.id, file: path.relative(ROOT, t.file), files: t.files })))
  }
  return waves
}

// ── commands ────────────────────────────────────────────────────────────────
function cmdPlan(args) {
  const layer = args.layer
  if (layer === undefined || layer === true) die('cần --layer <N>')
  const waves = planWaves(layer)
  console.log(JSON.stringify({ layer: Number(layer), integrationBranch: integrationBranch(layer), waves }, null, 2))
}

function cmdSetup(args) {
  const taskId = args.task
  if (!taskId || taskId === true) die('cần --task <layer-N/task-NN>')
  const layer = taskId.match(/layer-(\d+)/)?.[1]
  const base = args.base && args.base !== true ? args.base : currentOrIntegration(layer)

  // đảm bảo integration branch tồn tại
  ensureIntegrationBranch(layer, base)

  const wt = worktreePath(taskId)
  const br = branchName(taskId)
  if (fs.existsSync(wt)) die(`worktree đã tồn tại: ${path.relative(ROOT, wt)} (chạy cleanup trước nếu muốn làm lại)`)

  fs.mkdirSync(path.join(ROOT, '.worktrees'), { recursive: true })
  const r = shTry('git', ['worktree', 'add', '-b', br, wt, integrationBranch(layer)])
  if (!r.ok) die(`tạo worktree lỗi: ${r.err}`)
  console.log(JSON.stringify({ task: taskId, worktree: path.relative(ROOT, wt), branch: br, base: integrationBranch(layer) }, null, 2))
}

function currentOrIntegration(layer) {
  const r = shTry('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  return r.ok ? r.out : 'HEAD'
}
function ensureIntegrationBranch(layer, base) {
  const ib = integrationBranch(layer)
  const exists = shTry('git', ['show-ref', '--verify', '--quiet', `refs/heads/${ib}`]).ok
  if (!exists) {
    const r = shTry('git', ['branch', ib, base])
    if (!r.ok) die(`tạo integration branch lỗi: ${r.err}`)
  }
}

function cmdMerge(args) {
  const layer = args.layer
  if (layer === undefined || layer === true) die('cần --layer <N>')
  const ib = integrationBranch(layer)
  if (!shTry('git', ['show-ref', '--verify', '--quiet', `refs/heads/${ib}`]).ok)
    die(`chưa có integration branch ${ib} — chạy setup trước`)

  // checkout integration branch (trong main working tree)
  const co = shTry('git', ['checkout', ib])
  if (!co.ok) die(`checkout ${ib} lỗi: ${co.err}`)

  // tìm mọi branch wt/layer-N__*
  const branches = shTry('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/wt/'])
    .out.split('\n').map(s => s.trim()).filter(Boolean)
    .filter(b => b.startsWith(`wt/layer-${layer}__`))

  if (!branches.length) { console.log(JSON.stringify({ layer: Number(layer), merged: [], note: 'không có branch task nào để merge' })); return }

  const merged = []
  for (const b of branches) {
    const r = shTry('git', ['merge', '--no-ff', '-m', `merge(${b}): layer-${layer} parallel task`, b])
    if (!r.ok) {
      shTry('git', ['merge', '--abort'])
      die(`CONFLICT khi merge ${b} — DỪNG. Task này cần xử lý thủ công/tuần tự. Chi tiết:\n${r.err || r.out}`)
    }
    merged.push(b)
  }

  const result = { layer: Number(layer), integrationBranch: ib, merged }

  if (args['no-verify']) { console.log(JSON.stringify(result, null, 2)); return }

  // verify tổng thể: chỉ GỢI Ý (agent chạy thật qua loop theo project-config)
  result.verifyHint = 'Chạy verify tổng thể (build/test/lint) theo .context/project-config.md trên integration branch này trước khi update progress.json.'
  console.log(JSON.stringify(result, null, 2))
}

function cmdCleanup(args) {
  const layer = args.layer
  if (layer === undefined || layer === true) die('cần --layer <N>')
  const removed = []
  // xoá worktree
  const list = shTry('git', ['worktree', 'list', '--porcelain']).out
  for (const block of list.split('\n\n')) {
    const p = block.split('\n').find(l => l.startsWith('worktree '))?.slice(9)
    if (p && p.includes(`.worktrees/layer-${layer}__`)) {
      shTry('git', ['worktree', 'remove', '--force', p]); removed.push(path.relative(ROOT, p))
    }
  }
  // xoá branch wt/layer-N__*
  const branches = shTry('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/wt/'])
    .out.split('\n').map(s => s.trim()).filter(b => b.startsWith(`wt/layer-${layer}__`))
  for (const b of branches) { shTry('git', ['branch', '-D', b]); removed.push(b) }
  console.log(JSON.stringify({ layer: Number(layer), removed }, null, 2))
}

function cmdStatus() {
  const wt = shTry('git', ['worktree', 'list']).out
  const br = shTry('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/wt/']).out
  console.log('=== worktrees ===\n' + wt + '\n\n=== wt/ branches ===\n' + (br || '(none)'))
}

// ── main ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const sub = argv[0]
const args = parseArgs(argv.slice(1))
switch (sub) {
  case 'plan': cmdPlan(args); break
  case 'setup': cmdSetup(args); break
  case 'merge': cmdMerge(args); break
  case 'cleanup': cmdCleanup(args); break
  case 'status': cmdStatus(); break
  default:
    console.log('parallel-dispatch.mjs — lệnh: plan | setup | merge | cleanup | status')
    console.log('  node scripts/parallel-dispatch.mjs plan --layer 1')
    console.log('  node scripts/parallel-dispatch.mjs setup --task layer-1/task-03')
    console.log('  node scripts/parallel-dispatch.mjs merge --layer 1')
    console.log('  node scripts/parallel-dispatch.mjs cleanup --layer 1')
    process.exit(sub ? 1 : 0)
}
