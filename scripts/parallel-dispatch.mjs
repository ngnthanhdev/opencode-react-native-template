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
 *     Sau khi tạo worktree: nếu project-config khai `worktree_setup_cmd` → chạy hook đó
 *     với cwd = worktree và env WORKTREE_PATH / TASK_ID / WORKTREE_SLUG
 *     (project tự tạo DB riêng + .env.local riêng cho từng worktree).
 *     Nếu khai `test_infra_port_base` → worktree được cấp 1 slot cố định (1, 2, …) ghi ở
 *     `.worktrees/.ports.json`, port = base + slot, truyền vào hook qua WORKTREE_PORT /
 *     WORKTREE_SLOT (slot 0 = checkout chính, dùng chính port base). Không bao giờ đụng
 *     port mặc định của máy dev (vd Postgres 5432).
 *     `require_infra: true` → hook setup FAIL = setup FAIL (exit 1, giữ worktree để debug).
 *
 *   merge --layer <N> [--no-verify]
 *     Gom TẤT CẢ branch wt/<layer-N__*> (đã commit) vào integration branch của layer.
 *     Merge tuần tự; nếu conflict → DỪNG, in task gây conflict để human/agent xử lý.
 *     Mặc định in verifyHint để agent chạy verify tổng thể (lệnh từ .context/project-config.md).
 *
 *   cleanup --layer <N>
 *     Xoá worktree + branch tạm của layer sau khi merge xong & progress.json đã cập nhật.
 *     Trước khi xoá mỗi worktree: chạy `worktree_teardown_cmd` (nếu khai) để drop DB tạm,
 *     rồi trả slot port của worktree đó về `.worktrees/.ports.json`.
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

// ── project-config: hook worktree + hạ tầng test (optional) ──────────────────
// Đọc `.context/project-config.json` nếu có (ưu tiên), sau đó tới key trong
// `.context/project-config.md` (key đầu tiên thắng). Hỗ trợ cả:
//   key: "lệnh một dòng"
//   key: |
//     lệnh dòng 1
//     lệnh dòng 2
// Giá trị placeholder `<...>` / null / rỗng = coi như chưa cấu hình.
const HOOK_KEYS = ['worktree_setup_cmd', 'worktree_teardown_cmd']
const INFRA_KEYS = ['test_infra_port_base', 'require_infra']
const CONFIG_KEYS = [...HOOK_KEYS, ...INFRA_KEYS]
const CONFIG_KEY_LINE = new RegExp(`^([ \\t]*)(${CONFIG_KEYS.join('|')})[ \\t]*:[ \\t]*(.*)$`)

function indentWidth(s) {
  return String(s).replace(/\t/g, '  ').length
}

function cleanScalar(raw) {
  let v = String(raw).trim()
  if (/^['"]/.test(v)) {
    // chuỗi có quote: lấy đúng cặp quote đầu tiên, phần sau (kể cả `# comment`) bỏ
    const q = v[0]
    const end = v.indexOf(q, 1)
    v = end > 0 ? v.slice(1, end).trim() : ''
  } else {
    v = v.replace(/\s+#.*$/, '').trim()
  }
  if (!v || /^<.*>$/.test(v) || /^(null|none|~)$/i.test(v)) return ''
  return v
}

/** Parse các key CONFIG_KEYS từ markdown (hỗ trợ block scalar `|` / `>`). */
function parseConfigKeysFromMarkdown(txt) {
  const lines = String(txt).split('\n')
  const out = {}
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(CONFIG_KEY_LINE)
    if (!m) continue
    const key = m[2]
    // key đầu tiên CÓ GIÁ TRỊ thắng; khai báo rỗng/placeholder không giữ chỗ
    if (out[key]) continue
    const keyIndent = indentWidth(m[1])
    const rest = m[3].trim()

    // block scalar: "|" / "|-" / ">" / ">-" (kèm comment phía sau)
    if (/^[|>][+-]?\s*(#.*)?$/.test(rest)) {
      const buf = []
      let j = i + 1
      for (; j < lines.length; j++) {
        const ln = lines[j]
        if (!ln.trim()) { buf.push(''); continue }
        if (indentWidth(ln.match(/^[ \t]*/)[0]) <= keyIndent) break
        buf.push(ln)
      }
      while (buf.length && !buf[buf.length - 1].trim()) buf.pop()
      const minIndent = buf.filter((l) => l.trim()).reduce(
        (min, l) => Math.min(min, indentWidth(l.match(/^[ \t]*/)[0])), Infinity,
      )
      const body = buf
        .map((l) => (l.trim() ? l.replace(new RegExp(`^[ \\t]{0,${minIndent === Infinity ? 0 : minIndent}}`), '') : ''))
        .join('\n')
        .replace(/\s+$/, '')
      if (body.trim()) out[key] = body
      i = j - 1
      continue
    }

    const scalar = cleanScalar(rest)
    if (scalar) out[key] = scalar
  }
  return out
}

function readProjectConfig() {
  const cfg = {}
  const jsonPath = path.join(ROOT, '.context', 'project-config.json')
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) || {}
      for (const k of CONFIG_KEYS) {
        if (typeof raw[k] === 'string' && raw[k].trim()) cfg[k] = raw[k].trim()
        else if (typeof raw[k] === 'number' || typeof raw[k] === 'boolean') cfg[k] = String(raw[k])
      }
    } catch (e) {
      console.error(`⚠ project-config.json không parse được: ${e.message} — bỏ qua hook`)
    }
  }

  const mdPath = path.join(ROOT, '.context', 'project-config.md')
  if (fs.existsSync(mdPath)) {
    let txt = ''
    try { txt = fs.readFileSync(mdPath, 'utf8') } catch { txt = '' }
    const fromMd = parseConfigKeysFromMarkdown(txt)
    for (const k of CONFIG_KEYS) {
      if (cfg[k]) continue
      if (fromMd[k]) cfg[k] = fromMd[k]
    }
  }
  return cfg
}

// Hạ tầng test: port base (số) và cờ require_infra. Sai kiểu → coi như chưa cấu hình.
function infraConfig(cfg) {
  const base = Number.parseInt(cfg.test_infra_port_base, 10)
  return {
    portBase: Number.isInteger(base) && base > 0 && base < 65000 ? base : null,
    requireInfra: /^(true|yes|1)$/i.test(cfg.require_infra || ''),
  }
}

// ── slot port cố định cho từng worktree (.worktrees/.ports.json: { slug: slot }) ──
// Slot thấp nhất còn trống, giữ nguyên suốt đời worktree; cleanup trả slot lại.
const PORTS_FILE = path.join(ROOT, '.worktrees', '.ports.json')

function readPortSlots() {
  try { return JSON.parse(fs.readFileSync(PORTS_FILE, 'utf8')) || {} } catch { return {} }
}
function writePortSlots(slots) {
  fs.mkdirSync(path.dirname(PORTS_FILE), { recursive: true })
  const tmp = `${PORTS_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(slots, null, 2) + '\n')
  fs.renameSync(tmp, PORTS_FILE)
}
// Khoá bằng mkdir (atomic) để 2 lệnh setup chạy song song không nhận trùng slot.
function withPortsLock(fn) {
  const lock = `${PORTS_FILE}.lock`
  fs.mkdirSync(path.dirname(PORTS_FILE), { recursive: true })
  let held = false
  for (let i = 0; i < 200 && !held; i++) {
    try { fs.mkdirSync(lock); held = true } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.rmdirSync(lock) } catch { /* lock vừa được nhả */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
  if (!held) die(`không lấy được khoá ${path.relative(ROOT, lock)} — xoá thư mục khoá nếu không còn setup/cleanup nào chạy`)
  try { return fn() } finally { fs.rmdirSync(lock) }
}
function claimPortSlot(slug) {
  return withPortsLock(() => {
    const slots = readPortSlots()
    if (Number.isInteger(slots[slug])) return slots[slug]
    const used = new Set(Object.values(slots))
    let slot = 1
    while (used.has(slot)) slot++
    slots[slug] = slot
    writePortSlots(slots)
    return slot
  })
}
function releasePortSlot(slug) {
  withPortsLock(() => {
    const slots = readPortSlots()
    if (!(slug in slots)) return
    delete slots[slug]
    writePortSlots(slots)
  })
}

// Chạy hook qua shell (hook là chuỗi lệnh của project). Fail → cảnh báo, KHÔNG chặn luồng chính.
function runHook(cmd, { cwd, task, slug, label, extraEnv = {} }) {
  if (!cmd) return { ran: false, skipped: true }
  const env = {
    ...process.env,
    WORKTREE_PATH: cwd,
    TASK_ID: task,
    WORKTREE_SLUG: slug,
    ...extraEnv,
  }
  try {
    const out = execFileSync('sh', ['-c', cmd], {
      cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
    })
    if (out && out.trim()) console.error(out.trim())
    console.error(`✓ ${label} hook ok`)
    return { ran: true, ok: true }
  } catch (e) {
    console.error(`⚠ ${label} hook FAIL (bỏ qua, không chặn luồng): ${(e.stderr || e.message || '').toString().trim()}`)
    return { ran: true, ok: false, error: (e.stderr || e.message || '').toString().trim() }
  }
}

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
// integration branch:
//   initial build:  layer-<N>-integration
//   change (bug/feature): <scope>-phase-<N>-integration   (scope = feature-x / bug-y)
function integrationBranch(unit) { return `${unit}-integration` }

// Phân giải unit làm việc từ args:
//   --layer N                                   → initial build, unit = "layer-N"
//   --scope <feature|bug>-<slug> --phase N      → change,        unit = "<scope>-phase-N"
function resolveUnit(args) {
  if (args.scope && args.scope !== true) {
    const phase = args.phase
    if (phase === undefined || phase === true) die('change mode cần cả --scope <feature|bug>-<slug> VÀ --phase <N>')
    return { unit: `${args.scope}-phase-${phase}`, kind: 'change', scope: args.scope, phase: String(phase),
             dirName: args.scope, prefix: `phase-${phase}-task-` }
  }
  const layer = args.layer
  if (layer === undefined || layer === true) die('cần --layer <N> (initial build) HOẶC --scope <feature|bug>-<slug> --phase <N> (change)')
  return { unit: `layer-${layer}`, kind: 'build', layer: String(layer),
           dirName: null, prefix: `layer-${layer}-task-` }
}

// ── tìm task files của 1 unit (layer hoặc phase) ────────────────────────────
function findUnitTasks(u) {
  const tasksRoot = path.join(ROOT, 'tasks')
  if (!fs.existsSync(tasksRoot)) return []
  const results = []
  // change: chỉ quét đúng thư mục tasks/<scope>/ ; build: quét mọi thư mục slug
  const slugs = u.dirName ? [u.dirName] : fs.readdirSync(tasksRoot)
  for (const slug of slugs) {
    const dir = path.join(tasksRoot, slug)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(u.prefix) && f.endsWith('.md')) {
        const m = f.match(/task-(\d+)/)
        const tnum = m ? m[1] : '??'
        const id = u.kind === 'change'
          ? `${u.scope}/phase-${u.phase}/task-${tnum}`
          : `layer-${u.layer}/task-${tnum}`
        results.push({ id, file: path.join(dir, f), slug })
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
function planWaves(u) {
  const tasks = findUnitTasks(u)
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
  const u = resolveUnit(args)
  const waves = planWaves(u)
  console.log(JSON.stringify({ unit: u.unit, kind: u.kind, integrationBranch: integrationBranch(u.unit), waves }, null, 2))
}

// unit từ taskId:
//   "layer-1/task-03"              → "layer-1"
//   "feature-x/phase-1/task-03"    → "feature-x-phase-1"
function unitOfTaskId(taskId) {
  const mb = taskId.match(/^(layer-\d+)\//)
  if (mb) return mb[1]
  const mc = taskId.match(/^(.+?)\/phase-(\d+)\//)
  if (mc) return `${mc[1]}-phase-${mc[2]}`
  die(`taskId không hợp lệ: ${taskId} (dạng "layer-N/task-NN" hoặc "<scope>/phase-N/task-NN")`)
}
// unit → prefix branch/worktree để lọc khi merge/cleanup
function unitBranchPrefix(unit) { return `wt/${unit.replace(/[\/]/g, '__')}__` }

function cmdSetup(args) {
  const taskId = args.task
  if (!taskId || taskId === true) die('cần --task <layer-N/task-NN> hoặc <scope>/phase-N/task-NN')
  const unit = unitOfTaskId(taskId)
  const base = args.base && args.base !== true ? args.base : currentOrIntegration()

  // đảm bảo integration branch của unit tồn tại
  ensureIntegrationBranch(unit, base)

  const wt = worktreePath(taskId)
  const br = branchName(taskId)
  if (fs.existsSync(wt)) die(`worktree đã tồn tại: ${path.relative(ROOT, wt)} (chạy cleanup trước nếu muốn làm lại)`)

  fs.mkdirSync(path.join(ROOT, '.worktrees'), { recursive: true })
  const r = shTry('git', ['worktree', 'add', '-b', br, wt, integrationBranch(unit)])
  if (!r.ok) die(`tạo worktree lỗi: ${r.err}`)

  // hook riêng của project: tạo DB riêng + .env.local riêng cho worktree này
  const cfg = readProjectConfig()
  const { portBase, requireInfra } = infraConfig(cfg)
  const slug = taskSlug(taskId)
  const infra = portBase ? portEnv(portBase, claimPortSlot(slug)) : null
  const hook = runHook(cfg.worktree_setup_cmd, {
    cwd: wt, task: taskId, slug, label: 'worktree_setup', extraEnv: infra || {},
  })

  const result = {
    task: taskId,
    unit,
    worktree: path.relative(ROOT, wt),
    branch: br,
    base: integrationBranch(unit),
    infra: infra ? { port: Number(infra.WORKTREE_PORT), slot: Number(infra.WORKTREE_SLOT) } : null,
    requireInfra,
    setupHook: hook.ran ? (hook.ok ? 'ok' : 'FAILED (xem stderr)') : 'skipped (chưa khai worktree_setup_cmd)',
  }
  console.log(JSON.stringify(result, null, 2))
  // require_infra: test cần DB/storage không được skip → hạ tầng không dựng được thì chặn build ngay
  if (requireInfra && hook.ran && !hook.ok) {
    die(`require_infra: true nhưng worktree_setup hook FAIL cho ${taskId} — KHÔNG giao task cho builder. Worktree giữ nguyên để debug; sửa hạ tầng rồi chạy cleanup rồi setup lại.`)
  }
  if (requireInfra && !hook.ran) {
    die('require_infra: true nhưng chưa khai worktree_setup_cmd — không có gì dựng hạ tầng test cho worktree. Khai hook (và test_infra_port_base) hoặc tắt require_infra.')
  }
}

function portEnv(portBase, slot) {
  return { WORKTREE_PORT: String(portBase + slot), WORKTREE_SLOT: String(slot) }
}

function currentOrIntegration() {
  const r = shTry('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  return r.ok ? r.out : 'HEAD'
}
function ensureIntegrationBranch(unit, base) {
  const ib = integrationBranch(unit)
  const exists = shTry('git', ['show-ref', '--verify', '--quiet', `refs/heads/${ib}`]).ok
  if (!exists) {
    const r = shTry('git', ['branch', ib, base])
    // setup song song: lệnh khác vừa tạo branch này → không phải lỗi
    const createdMeanwhile = shTry('git', ['show-ref', '--verify', '--quiet', `refs/heads/${ib}`]).ok
    if (!r.ok && !createdMeanwhile) die(`tạo integration branch lỗi: ${r.err}`)
  }
}

function cmdMerge(args) {
  const u = resolveUnit(args)
  const ib = integrationBranch(u.unit)
  if (!shTry('git', ['show-ref', '--verify', '--quiet', `refs/heads/${ib}`]).ok)
    die(`chưa có integration branch ${ib} — chạy setup trước`)

  // checkout integration branch (trong main working tree)
  const co = shTry('git', ['checkout', ib])
  if (!co.ok) die(`checkout ${ib} lỗi: ${co.err}`)

  // tìm mọi branch wt/<unit>__*
  const prefix = unitBranchPrefix(u.unit)
  const branches = shTry('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/wt/'])
    .out.split('\n').map(s => s.trim()).filter(Boolean)
    .filter(b => b.startsWith(prefix))

  if (!branches.length) { console.log(JSON.stringify({ unit: u.unit, merged: [], note: 'không có branch task nào để merge' })); return }

  const merged = []
  for (const b of branches) {
    const r = shTry('git', ['merge', '--no-ff', '-m', `merge(${b}): ${u.unit} parallel task`, b])
    if (!r.ok) {
      shTry('git', ['merge', '--abort'])
      die(`CONFLICT khi merge ${b} — DỪNG. Task này cần xử lý thủ công/tuần tự. Chi tiết:\n${r.err || r.out}`)
    }
    merged.push(b)
  }

  const result = { unit: u.unit, kind: u.kind, integrationBranch: ib, merged }

  if (args['no-verify']) { console.log(JSON.stringify(result, null, 2)); return }

  // verify tổng thể: chỉ GỢI Ý (agent chạy thật qua loop theo project-config)
  result.verifyHint = 'Chạy verify tổng thể (build/test/lint) theo .context/project-config.md trên integration branch này trước khi update progress.json.'
  console.log(JSON.stringify(result, null, 2))
}

function cmdCleanup(args) {
  const u = resolveUnit(args)
  const wtDirPart = `.worktrees/${u.unit.replace(/[\/]/g, '__')}__`
  const removed = []
  const cfg = readProjectConfig()
  // xoá worktree
  const list = shTry('git', ['worktree', 'list', '--porcelain']).out
  for (const block of list.split('\n\n')) {
    const p = block.split('\n').find(l => l.startsWith('worktree '))?.slice(9)
    if (p && p.includes(wtDirPart)) {
      // teardown hook TRƯỚC khi xoá (drop DB tạm, dọn .env.local riêng…)
      const slug = path.basename(p)
      const taskId = slug.replace(/__/g, '/')
      const slot = readPortSlots()[slug]
      const { portBase } = infraConfig(cfg)
      const hook = runHook(cfg.worktree_teardown_cmd, {
        cwd: p, task: taskId, slug, label: 'worktree_teardown',
        extraEnv: portBase && Number.isInteger(slot) ? portEnv(portBase, slot) : {},
      })
      if (hook.ran && !hook.ok) {
        console.error(`⚠ bỏ qua teardown lỗi cho ${path.relative(ROOT, p)} — vẫn xoá worktree`)
      }
      shTry('git', ['worktree', 'remove', '--force', p]); removed.push(path.relative(ROOT, p))
      releasePortSlot(slug)
    }
  }
  // xoá branch wt/<unit>__*
  const prefix = unitBranchPrefix(u.unit)
  const branches = shTry('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/wt/'])
    .out.split('\n').map(s => s.trim()).filter(b => b.startsWith(prefix))
  for (const b of branches) { shTry('git', ['branch', '-D', b]); removed.push(b) }
  console.log(JSON.stringify({
    unit: u.unit,
    removed,
    teardownHook: cfg.worktree_teardown_cmd ? 'ran (xem stderr nếu lỗi)' : 'skipped (chưa khai worktree_teardown_cmd)',
  }, null, 2))
}

function cmdStatus() {
  const wt = shTry('git', ['worktree', 'list']).out
  const br = shTry('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/wt/']).out
  const { portBase } = infraConfig(readProjectConfig())
  const slots = Object.entries(readPortSlots())
    .map(([slug, slot]) => `${slug}  slot ${slot}${portBase ? `  port ${portBase + slot}` : ''}`).join('\n')
  console.log('=== worktrees ===\n' + wt + '\n\n=== wt/ branches ===\n' + (br || '(none)') +
    '\n\n=== test infra ports ===\n' + (slots || '(none)'))
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
