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
 *   setup --task <layer-N/task-NN> [--base <ref>] [--integration <branch>]
 *     Tạo worktree + branch cho 1 task. In ra đường dẫn worktree (builder cd vào đó chạy).
 *       worktree: .worktrees/<layer-N__task-NN>
 *       branch:   wt/<layer-N__task-NN>
 *     --base mặc định = HEAD của integration branch của layer (hoặc nhánh hiện tại).
 *     --integration: dùng integration branch chỉ định thay cho branch theo layer
 *     (schedule_mode: dependency dùng chung 1 branch, mặc định `build-integration`).
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
 *   ready [--until-layer <N>] [--max <K>] [--integration <branch>]
 *     (schedule_mode: dependency) Liệt kê task initial build SẴN SÀNG chạy ngay: mọi task trong
 *     "## Dependencies" (dạng `layer-N/task-NN`, hoặc `none`) đã xong, không trùng file với task
 *     đang chạy/đã chọn. Task không khai dependency ở layer > 0 → coi như phụ thuộc mọi task của
 *     layer trước (an toàn như barrier cũ). "Xong" = có trong progress.json completedTasks hoặc
 *     có commit merge(wt/<slug>) trên integration branch (không còn worktree). Output JSON:
 *       { integrationBranch, ready: [...], running: [...], waiting: [...], done, total, stuck }
 *     --until-layer N: không chọn task ở layer > N (dừng ở milestone cần human duyệt).
 *
 *   merge --task <id> [--integration <branch>]
 *     Merge NGAY 1 branch task (đã PASS + commit) vào integration branch — dùng cho lập lịch
 *     theo dependency, để task phụ thuộc được dispatch mà không chờ cả layer.
 *
 *   cleanup --layer <N>   |   cleanup --task <id>
 *     Xoá worktree + branch tạm của layer (hoặc của đúng 1 task) sau khi merge xong & progress.json đã cập nhật.
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
//   schedule_mode: dependency: 1 branch chung DEP_INTEGRATION (truyền qua --integration)
function integrationBranch(unit) { return `${unit}-integration` }
const DEP_INTEGRATION = 'build-integration'
function integrationOverride(args) {
  return args.integration && args.integration !== true ? String(args.integration) : null
}

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
  const ib = integrationOverride(args) || integrationBranch(unit)

  // đảm bảo integration branch tồn tại
  ensureIntegrationBranch(ib, base)

  const wt = worktreePath(taskId)
  const br = branchName(taskId)
  if (fs.existsSync(wt)) die(`worktree đã tồn tại: ${path.relative(ROOT, wt)} (chạy cleanup trước nếu muốn làm lại)`)

  fs.mkdirSync(path.join(ROOT, '.worktrees'), { recursive: true })
  const r = shTry('git', ['worktree', 'add', '-b', br, wt, ib])
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
    base: ib,
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
function ensureIntegrationBranch(ib, base) {
  const exists = shTry('git', ['show-ref', '--verify', '--quiet', `refs/heads/${ib}`]).ok
  if (!exists) {
    const r = shTry('git', ['branch', ib, base])
    // setup song song: lệnh khác vừa tạo branch này → không phải lỗi
    const createdMeanwhile = shTry('git', ['show-ref', '--verify', '--quiet', `refs/heads/${ib}`]).ok
    if (!r.ok && !createdMeanwhile) die(`tạo integration branch lỗi: ${r.err}`)
  }
}

function cmdMerge(args) {
  if (args.task && args.task !== true) return cmdMergeTask(args)
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

// Merge đúng 1 branch task vào integration branch (lập lịch theo dependency).
function cmdMergeTask(args) {
  const taskId = String(args.task)
  const ib = integrationOverride(args) || integrationBranch(unitOfTaskId(taskId))
  const br = branchName(taskId)
  if (!shTry('git', ['show-ref', '--verify', '--quiet', `refs/heads/${ib}`]).ok)
    die(`chưa có integration branch ${ib} — chạy setup trước`)
  if (!shTry('git', ['show-ref', '--verify', '--quiet', `refs/heads/${br}`]).ok)
    die(`không có branch ${br}`)
  const co = shTry('git', ['checkout', ib])
  if (!co.ok) die(`checkout ${ib} lỗi: ${co.err}`)
  const r = shTry('git', ['merge', '--no-ff', '-m', `merge(${br}): ${taskId}`, br])
  if (!r.ok) {
    shTry('git', ['merge', '--abort'])
    die(`CONFLICT khi merge ${br} — DỪNG. Chạy lại task này tuần tự trên ${ib}. Chi tiết:\n${r.err || r.out}`)
  }
  console.log(JSON.stringify({
    task: taskId, integrationBranch: ib, merged: [br],
    verifyHint: 'Chạy verify tổng thể theo .context/project-config.md trên integration branch trước khi ghi progress.json + cleanup --task.',
  }, null, 2))
}

// cleanup theo layer/phase (prefix) hoặc theo đúng 1 task (--task)
function cleanupTarget(args) {
  if (args.task && args.task !== true) {
    const slug = taskSlug(String(args.task))
    return {
      label: String(args.task),
      matchWorktree: (p) => path.basename(p) === slug && p.includes('.worktrees'),
      matchBranch: (b) => b === branchName(String(args.task)),
    }
  }
  const u = resolveUnit(args)
  const wtDirPart = `.worktrees/${u.unit.replace(/[\/]/g, '__')}__`
  const prefix = unitBranchPrefix(u.unit)
  return { label: u.unit, matchWorktree: (p) => p.includes(wtDirPart), matchBranch: (b) => b.startsWith(prefix) }
}

function cmdCleanup(args) {
  const target = cleanupTarget(args)
  const removed = []
  const cfg = readProjectConfig()
  // xoá worktree
  const list = shTry('git', ['worktree', 'list', '--porcelain']).out
  for (const block of list.split('\n\n')) {
    const p = block.split('\n').find(l => l.startsWith('worktree '))?.slice(9)
    if (p && target.matchWorktree(p)) {
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
  // xoá branch wt/<unit>__* (hoặc đúng branch của task)
  const branches = shTry('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/wt/'])
    .out.split('\n').map(s => s.trim()).filter(target.matchBranch)
  for (const b of branches) { shTry('git', ['branch', '-D', b]); removed.push(b) }
  console.log(JSON.stringify({
    unit: target.label,
    removed,
    teardownHook: cfg.worktree_teardown_cmd ? 'ran (xem stderr nếu lỗi)' : 'skipped (chưa khai worktree_teardown_cmd)',
  }, null, 2))
}

// ── lập lịch theo dependency ────────────────────────────────────────────────
// id chuẩn hoá: "layer-4/task-01" (bỏ số 0 thừa ở layer, task đệm 2 chữ số)
function normTaskId(layer, task) { return `layer-${Number(layer)}/task-${String(Number(task)).padStart(2, '0')}` }

function findAllBuildTasks() {
  const tasksRoot = path.join(ROOT, 'tasks')
  if (!fs.existsSync(tasksRoot)) return []
  const out = []
  for (const slug of fs.readdirSync(tasksRoot)) {
    const dir = path.join(tasksRoot, slug)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^layer-(\d+)-task-(\d+)\.md$/)
      if (m) out.push({ id: normTaskId(m[1], m[2]), layer: Number(m[1]), file: path.join(dir, f) })
    }
  }
  return out.sort((a, b) => a.layer - b.layer || a.id.localeCompare(b.id))
}

// "## Dependencies": `layer-N/task-NN` (chấp nhận layer-N-task-NN); `none`/`n/a`/`không` = không phụ thuộc.
// null = không khai gì → caller áp dependency ngầm (mọi task layer trước).
function depsOfTask(file) {
  const txt = fs.readFileSync(file, 'utf8')
  const m = txt.match(/##\s*Dependencies([\s\S]*?)(?:\n##\s|\n#\s|$)/i)
  if (!m) return null
  const deps = [...m[1].matchAll(/layer-(\d+)[\/_-]+task-(\d+)/gi)].map(g => normTaskId(g[1], g[2]))
  if (deps.length) return [...new Set(deps)]
  return /^\s*[-*]\s*(none|n\/a|không)\b/im.test(m[1]) ? [] : null
}

function taskIdsOf(list) {
  return (Array.isArray(list) ? list : []).map(e => (typeof e === 'string' ? e : e?.task)).filter(Boolean)
}
function readProgress() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, '.context', 'progress.json'), 'utf8')) || {} }
  catch { return {} }
}
function idFromSlug(slug) {
  const m = slug.match(/^layer-(\d+)__task-(\d+)$/)
  return m ? normTaskId(m[1], m[2]) : null
}
function activeWorktreeIds() {
  const ids = new Set()
  for (const block of shTry('git', ['worktree', 'list', '--porcelain']).out.split('\n\n')) {
    const p = block.split('\n').find(l => l.startsWith('worktree '))?.slice(9)
    const id = p && p.includes('.worktrees') ? idFromSlug(path.basename(p)) : null
    if (id) ids.add(id)
  }
  return ids
}
// Task đã merge vào integration branch = có commit "merge(wt/<slug>): ..." do lệnh merge tạo ra
// (vẫn đúng sau khi cleanup xoá branch). KHÔNG dùng `git branch --merged`: branch vừa setup chưa có
// commit nào cũng "merged" → task chưa chạy bị tính là xong.
function mergedTaskIds(ib) {
  const ids = new Set()
  const log = shTry('git', ['log', '--merges', '--format=%s', ib])
  if (log.ok) {
    for (const m of log.out.matchAll(/^merge\(wt\/([^)]+)\):/gm)) {
      const id = idFromSlug(m[1])
      if (id) ids.add(id)
    }
  }
  return ids
}

function computeReady({ ib, untilLayer = null, max = Infinity }) {
  const tasks = findAllBuildTasks()
  const byId = new Map(tasks.map(t => [t.id, t]))
  const progress = readProgress()
  const running = activeWorktreeIds()
  const done = new Set(taskIdsOf(progress.completedTasks).map(id => idFromSlug(taskSlug(id)) || id))
  for (const id of mergedTaskIds(ib)) if (!running.has(id)) done.add(id)
  const blocked = new Set(taskIdsOf(progress.blockedTasks))

  const claimed = new Set()
  for (const id of running) if (byId.has(id)) filesOfTask(byId.get(id).file).forEach(f => claimed.add(f))

  const ready = [], waiting = []
  for (const t of tasks) {
    if (done.has(t.id) || running.has(t.id) || blocked.has(t.id)) continue
    if (untilLayer !== null && t.layer > untilLayer) { waiting.push({ id: t.id, reason: `sau milestone layer ${untilLayer}` }); continue }
    const declared = depsOfTask(t.file)
    const deps = declared ?? tasks.filter(o => o.layer < t.layer).map(o => o.id)
    const unknown = deps.filter(d => !byId.has(d))
    const pending = deps.filter(d => !done.has(d))
    if (pending.length) { waiting.push({ id: t.id, waitingOn: pending, ...(unknown.length ? { unknownDeps: unknown } : {}) }); continue }
    const files = filesOfTask(t.file)
    const clash = files.filter(f => claimed.has(f))
    if (clash.length || ready.length >= max) { waiting.push({ id: t.id, reason: clash.length ? `trùng file: ${clash.join(', ')}` : 'đủ --max' }); continue }
    files.forEach(f => claimed.add(f))
    ready.push({ id: t.id, file: path.relative(ROOT, t.file), files, deps, implicitDeps: declared === null })
  }
  const stuck = !ready.length && !running.size && waiting.some(w => w.waitingOn)
  return { integrationBranch: ib, ready, running: [...running], waiting, done: done.size, blocked: [...blocked], total: tasks.length, stuck }
}

function cmdReady(args) {
  const untilLayer = args['until-layer'] !== undefined && args['until-layer'] !== true ? Number(args['until-layer']) : null
  const max = args.max !== undefined && args.max !== true ? Number(args.max) : Infinity
  console.log(JSON.stringify(computeReady({ ib: integrationOverride(args) || DEP_INTEGRATION, untilLayer, max }), null, 2))
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
  case 'ready': cmdReady(args); break
  case 'merge': cmdMerge(args); break
  case 'cleanup': cmdCleanup(args); break
  case 'status': cmdStatus(); break
  default:
    console.log('parallel-dispatch.mjs — lệnh: plan | ready | setup | merge | cleanup | status')
    console.log('  node scripts/parallel-dispatch.mjs plan --layer 1')
    console.log('  node scripts/parallel-dispatch.mjs setup --task layer-1/task-03')
    console.log('  node scripts/parallel-dispatch.mjs merge --layer 1')
    console.log('  node scripts/parallel-dispatch.mjs cleanup --layer 1')
    console.log('  node scripts/parallel-dispatch.mjs ready --until-layer 3          # schedule_mode: dependency')
    console.log('  node scripts/parallel-dispatch.mjs merge --task layer-2/task-04 --integration build-integration')
    process.exit(sub ? 1 : 0)
}
