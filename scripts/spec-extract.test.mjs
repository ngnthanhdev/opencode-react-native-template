// Test cho scripts/spec-extract.mjs — chạy: node --test scripts/*.test.mjs
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'spec-extract.mjs')

const SPEC = `# SPECIFICATIONS.md

## Features

### F1 — Onboarding
Màn chào.

### F10 — Đăng nhập
Email + mật khẩu.

#### F10.1 Quên mật khẩu
Gửi link reset.

\`\`\`markdown
## F2 — heading giả trong code fence
\`\`\`

### F11 — Đăng xuất
Xoá token.

## API Endpoints
POST /login
`

const DESIGN = `# Design spec

## Login screen
Nút primary full width.

## Settings screen
Toggle dark mode.
`

const tmpDirs = []
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }) })

// Dựng repo tạm: spec + design + task file với nội dung `## Spec refs` cho trước.
function makeRepo(specRefs) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-extract-'))
  tmpDirs.push(tmp)
  fs.writeFileSync(path.join(tmp, 'SPECIFICATIONS.md'), SPEC)
  fs.mkdirSync(path.join(tmp, '.context'), { recursive: true })
  fs.writeFileSync(path.join(tmp, '.context', 'design-spec.md'), DESIGN)
  fs.mkdirSync(path.join(tmp, 'tasks', 'mvp'), { recursive: true })
  const refsBlock = specRefs === null ? '' : `## Spec refs\n${specRefs}\n\n`
  fs.writeFileSync(path.join(tmp, 'tasks', 'mvp', 'layer-1-task-03.md'),
    `# Task 03: Login\n\n## Layer\n1\n\n${refsBlock}## Files to Create/Modify\n- \`src/login.ts\`\n`)
  return tmp
}

function run(tmp, extra = []) {
  const stdout = execFileSync(process.execPath, [SCRIPT, '--task', 'tasks/mvp/layer-1-task-03.md', '--root', tmp, ...extra],
    { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return JSON.parse(stdout)
}

const OUT = '.context/task-context/mvp-layer-1-task-03.md'
const readOut = tmp => fs.readFileSync(path.join(tmp, OUT), 'utf8')

test('section dừng ở heading cùng cấp, giữ heading con; F1 không khớp F10', () => {
  const tmp = makeRepo('- `F10` — luồng đăng nhập')
  const res = run(tmp)
  assert.equal(res.out, OUT)
  assert.deepEqual(res.found, ['F10'])
  assert.deepEqual(res.missing, [])
  assert.ok(res.words > 0)
  const out = readOut(tmp)
  assert.match(out, /nguồn: `SPECIFICATIONS\.md` dòng 8/)
  assert.match(out, /### F10 — Đăng nhập/)
  assert.match(out, /#### F10\.1 Quên mật khẩu/)
  assert.match(out, /heading giả trong code fence/)
  assert.doesNotMatch(out, /F11 — Đăng xuất/)
  assert.doesNotMatch(out, /F1 — Onboarding/)
  assert.doesNotMatch(out, /POST \/login/)
})

test('heading cấp cao chứa cả section con tới heading cùng cấp kế tiếp', () => {
  const tmp = makeRepo('- Features')
  const res = run(tmp)
  assert.deepEqual(res.found, ['Features'])
  const out = readOut(tmp)
  assert.match(out, /F11 — Đăng xuất/)
  assert.doesNotMatch(out, /POST \/login/)
})

test('path#heading chỉ dò trong file chỉ định', () => {
  const tmp = makeRepo('- `.context/design-spec.md#login screen`\n- `SPECIFICATIONS.md#Login screen`')
  const res = run(tmp)
  assert.deepEqual(res.found, ['.context/design-spec.md#login screen'])
  assert.deepEqual(res.missing, ['SPECIFICATIONS.md#Login screen'])
  const out = readOut(tmp)
  assert.match(out, /nguồn: `\.context\/design-spec\.md` dòng 3/)
  assert.match(out, /Nút primary full width\./)
  assert.doesNotMatch(out, /Settings screen/)
})

test('ref không khớp → mục "Không tìm thấy", exit 0; source thiếu bị bỏ qua', () => {
  const tmp = makeRepo('- `F10.1`\n- `REQ-AUTH-02`')
  const res = run(tmp, ['--sources', 'SPECIFICATIONS.md,docs/missing.md'])
  assert.deepEqual(res.found, ['F10.1'])
  assert.deepEqual(res.missing, ['REQ-AUTH-02'])
  const out = readOut(tmp)
  assert.match(out, /## Không tìm thấy\n\n- `REQ-AUTH-02`/)
  assert.match(out, /thiếu: docs\/missing\.md/)
  assert.doesNotMatch(out, /Email \+ mật khẩu/)
})

test('task không có ## Spec refs → không ghi file, out null', () => {
  const tmp = makeRepo(null)
  const res = run(tmp)
  assert.equal(res.out, null)
  assert.deepEqual(res.found, [])
  assert.deepEqual(res.missing, [])
  assert.ok(res.note)
  assert.equal(fs.existsSync(path.join(tmp, '.context', 'task-context')), false)
})

test('Spec refs chỉ có n/a → coi như không có ref', () => {
  const tmp = makeRepo('- n/a')
  const res = run(tmp)
  assert.equal(res.out, null)
  assert.equal(fs.existsSync(path.join(tmp, OUT)), false)
})
