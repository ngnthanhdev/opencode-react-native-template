#!/usr/bin/env node
/**
 * spec-extract.mjs — Trích ĐÚNG các đoạn spec mà 1 task cần (theo `## Spec refs` của task file).
 *
 * Vì sao: builder/reviewer mỗi lượt đọc cả `SPECIFICATIONS.md` + `.context/design-spec.md`
 * (hàng chục nghìn từ) dù task chỉ cần vài requirement. Dispatcher chạy script này TRƯỚC khi
 * spawn builder/reviewer → subagent chỉ đọc file trích `.context/task-context/<task-slug>.md`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CÁCH DÙNG
 *
 *   node scripts/spec-extract.mjs --task tasks/<slug>/layer-1-task-03.md
 *        [--out <path>] [--sources SPECIFICATIONS.md,.context/design-spec.md] [--root <dir>]
 *
 *   --task     task file (tương đối so với root, hoặc tuyệt đối). Bắt buộc.
 *   --out      file output. Mặc định `.context/task-context/<task-slug>.md`
 *              (task-slug = `<thư mục task>-<tên file>`, vd `feature-x-phase-1-task-01`).
 *   --sources  danh sách file spec (phân cách dấu phẩy) để dò ref không kèm path.
 *              Mặc định `SPECIFICATIONS.md,.context/design-spec.md`.
 *   --root     thư mục gốc để phân giải mọi path tương đối. Mặc định = repo root
 *              (thư mục cha của `scripts/`), KHÔNG phải cwd.
 *
 * FORMAT `## Spec refs` (trong task file)
 *   - `F10`                                   ← token có trong heading spec (ID, §3.2, REQ-AUTH-02…)
 *   - `.context/design-spec.md#Login screen`  ← path#heading text: chỉ dò trong file đó
 *   Mỗi bullet 1 ref; ref bọc backtick thì phần sau backtick là ghi chú (bỏ qua).
 *   `n/a` / `none` = task không cần spec.
 *
 * SO KHỚP
 *   • Chỉ dò heading ATX (`#`…`######`), bỏ qua heading nằm trong code fence.
 *   • Không phân biệt hoa thường, theo token: `F1` KHÔNG khớp `F10`, `3.2` KHÔNG khớp `3.2.1`.
 *     Dấu `§` đầu ref được bỏ qua (`§3.2` khớp heading `3.2 Auth` lẫn `§3.2 Auth`).
 *   • Section = từ heading khớp tới trước heading kế tiếp cùng cấp hoặc cao hơn.
 *     Section nằm gọn trong section đã trích (của ref trước) → không chép lại.
 *
 * KẾT QUẢ
 *   • stdout: JSON `{ out, found: [...], missing: [...], words }`.
 *   • Ref không khớp → mục "Không tìm thấy" trong file + cảnh báo stderr, exit 0
 *     (agent tự đọc đúng section đó trong spec đầy đủ).
 *   • Source không tồn tại → cảnh báo stderr, bỏ qua.
 *   • Task không có `## Spec refs` (hoặc chỉ `n/a`) → KHÔNG ghi file, in JSON note, exit 0.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(__dirname, '..')
const DEFAULT_SOURCES = ['SPECIFICATIONS.md', '.context/design-spec.md']
const NO_REF_VALUES = new Set(['n/a', 'na', 'none', '-'])

function die(msg) { console.error(`✖ ${msg}`); process.exit(1) }
function warn(msg) { console.error(`⚠ ${msg}`) }

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]; out[k] = v }
    else out._.push(a)
  }
  return out
}

function toPosix(p) { return p.split(path.sep).join('/') }
function relToRoot(root, abs) { return toPosix(path.relative(root, abs)) }

// "tasks/feature-x/phase-1-task-01.md" → "feature-x-phase-1-task-01"
function taskSlugOf(taskAbs) {
  const base = path.basename(taskAbs, '.md')
  const dir = path.basename(path.dirname(taskAbs))
  return dir && dir !== 'tasks' ? `${dir}-${base}` : base
}

// Nội dung section `## Spec refs` (tới heading `#`/`##` kế tiếp) → null nếu không có.
function specRefsBlock(taskText) {
  const m = taskText.match(/^##\s+Spec refs[ \t]*\n([\s\S]*?)(?=^#{1,2}\s|(?![\s\S]))/im)
  return m ? m[1] : null
}

// Mỗi bullet → 1 ref. Có backtick → lấy phần trong backtick đầu tiên, còn lại là ghi chú.
function parseRefs(block) {
  const refs = []
  for (const line of block.split('\n')) {
    const b = line.match(/^\s*[-*]\s+(.+?)\s*$/)
    if (!b) continue
    const tick = b[1].match(/`([^`]+)`/)
    const ref = (tick ? tick[1] : b[1]).trim()
    if (ref && !NO_REF_VALUES.has(ref.toLowerCase())) refs.push(ref)
  }
  return refs
}

// "path/x.md#Heading text" → { file, text }; ref không có path → { file: null, text }.
function splitRef(ref) {
  const i = ref.indexOf('#')
  if (i <= 0 || i === ref.length - 1) return { file: null, text: ref }
  return { file: ref.slice(0, i).trim(), text: ref.slice(i + 1).trim() }
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// Token match: 2 đầu không dính chữ/số (kể cả qua 1 dấu . - _ nối tiếp, để `3.2` ≠ `3.2.1`).
function tokenMatcher(text) {
  const token = text.replace(/^§\s*/, '').trim()
  const W = '[\\p{L}\\p{N}]'
  return new RegExp(`(?<!${W})(?<!${W}[._-])${escapeRegExp(token)}(?!${W})(?![._-]${W})`, 'iu')
}

// Liệt kê heading ATX ngoài code fence: { index (0-based line), level, text }.
function listHeadings(lines) {
  const out = []
  let fence = null
  lines.forEach((line, index) => {
    const f = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (f) {
      if (!fence) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
      return
    }
    if (fence) return
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (h) out.push({ index, level: h[1].length, text: h[2] })
  })
  return out
}

// Section của heading thứ k: tới trước heading kế tiếp có level ≤ level của nó.
function sectionRange(headings, k, totalLines) {
  const { index, level } = headings[k]
  const next = headings.slice(k + 1).find(h => h.level <= level)
  return { start: index, end: next ? next.index : totalLines }
}

function loadSource(root, rel, cache) {
  if (cache.has(rel)) return cache.get(rel)
  const abs = path.resolve(root, rel)
  let doc = null
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/)
    doc = { rel: relToRoot(root, abs), lines, headings: listHeadings(lines) }
  }
  cache.set(rel, doc)
  return doc
}

function findSections(doc, text) {
  const re = tokenMatcher(text)
  const hits = []
  doc.headings.forEach((h, k) => {
    if (re.test(h.text)) hits.push({ heading: h.text, ...sectionRange(doc.headings, k, doc.lines.length) })
  })
  return hits
}

function sectionBody(doc, { start, end }) {
  const body = doc.lines.slice(start, end)
  while (body.length && !body[body.length - 1].trim()) body.pop()
  return body.join('\n')
}

// Đã trích section bao trùm (cùng file) chưa → trả ref đã trích để ghi chú thay vì chép lại.
function coveredBy(emitted, rel, { start, end }) {
  return emitted.find(e => e.rel === rel && e.start <= start && end <= e.end)
}

function extractRef(ref, ctx) {
  const { file, text } = splitRef(ref)
  const docs = file
    ? [loadSource(ctx.root, file, ctx.cache)].filter(Boolean)
    : ctx.sources.map(s => loadSource(ctx.root, s, ctx.cache)).filter(Boolean)
  if (file && !docs.length) warn(`ref "${ref}": không có file ${file}`)
  const parts = []
  for (const doc of docs) {
    for (const hit of findSections(doc, text)) {
      const prev = coveredBy(ctx.emitted, doc.rel, hit)
      if (prev) { parts.push(`> \`${doc.rel}\` dòng ${hit.start + 1} (${hit.heading}) đã nằm trong section của ref \`${prev.ref}\` ở trên.`); continue }
      ctx.emitted.push({ ref, rel: doc.rel, start: hit.start, end: hit.end })
      parts.push(`> nguồn: \`${doc.rel}\` dòng ${hit.start + 1}\n\n${sectionBody(doc, hit)}`)
    }
  }
  return parts
}

function renderOutput({ taskRel, refs, sourceNote, sections, missing }) {
  const out = [
    `# Task context: ${taskRel}`,
    '',
    '> Sinh bởi `scripts/spec-extract.mjs` từ `## Spec refs` của task — KHÔNG sửa tay, chạy lại để cập nhật.',
    '> Đọc file này THAY VÌ cả spec; chỉ mở spec đầy đủ cho ref ở mục "Không tìm thấy".',
    '',
    `- Task: \`${taskRel}\``,
    `- Spec refs: ${refs.map(r => `\`${r}\``).join(', ')}`,
    `- Sources: ${sourceNote}`,
  ]
  for (const { ref, parts } of sections) out.push('', '---', '', `## Ref \`${ref}\``, '', parts.join('\n\n'))
  if (missing.length) {
    out.push('', '---', '', '## Không tìm thấy', '')
    for (const ref of missing) out.push(`- \`${ref}\` — không khớp heading nào → đọc thủ công section tương ứng trong spec đầy đủ.`)
  }
  return out.join('\n') + '\n'
}

function countWords(text) { return (text.match(/\S+/g) || []).length }

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.task || args.task === true) die('thiếu --task <tasks/<slug>/<task>.md>')
  const root = path.resolve(args.root && args.root !== true ? args.root : DEFAULT_ROOT)
  const taskAbs = path.resolve(root, args.task)
  if (!fs.existsSync(taskAbs)) die(`không thấy task file: ${args.task}`)
  const taskRel = relToRoot(root, taskAbs)

  const block = specRefsBlock(fs.readFileSync(taskAbs, 'utf8'))
  const refs = block === null ? [] : parseRefs(block)
  if (!refs.length) {
    const note = block === null ? 'task không có section ## Spec refs' : '## Spec refs trống hoặc n/a'
    console.log(JSON.stringify({ out: null, note: `${note} → không ghi file, agent đọc spec như cũ`, found: [], missing: [], words: 0 }, null, 2))
    return
  }

  const sources = args.sources && args.sources !== true ? args.sources.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_SOURCES
  const ctx = { root, sources, cache: new Map(), emitted: [] }
  const absent = sources.filter(s => !loadSource(root, s, ctx.cache))
  for (const s of absent) warn(`source không tồn tại, bỏ qua: ${s}`)
  const present = sources.filter(s => !absent.includes(s))
  const sourceNote = [present.map(s => `\`${s}\``).join(', ') || '(không có)', absent.length ? `(thiếu: ${absent.join(', ')})` : ''].filter(Boolean).join(' ')

  const sections = []
  const found = []
  const missing = []
  for (const ref of refs) {
    const parts = extractRef(ref, ctx)
    if (parts.length) { found.push(ref); sections.push({ ref, parts }) } else missing.push(ref)
  }
  if (missing.length) warn(`không tìm thấy ${missing.length} ref: ${missing.join(', ')} → agent đọc thủ công section đó trong spec đầy đủ`)

  const outAbs = path.resolve(root, args.out && args.out !== true ? args.out : path.join('.context', 'task-context', `${taskSlugOf(taskAbs)}.md`))
  const text = renderOutput({ taskRel, refs, sourceNote, sections, missing })
  fs.mkdirSync(path.dirname(outAbs), { recursive: true })
  fs.writeFileSync(outAbs, text)
  console.log(JSON.stringify({ out: relToRoot(root, outAbs), found, missing, words: countWords(text) }, null, 2))
}

main()
