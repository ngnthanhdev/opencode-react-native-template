# AGENTS.md — AI Workflow Router (entry point)

> This is the **always-loaded entry point**. Read it before acting on any request.
> 🚀 **Start dự án = `/start`** — đọc spec → brainstorm → design → graph → loop, **tự chuyển bước** (không cần gõ lại lệnh); chỉ **DỪNG ở human checkpoint** chờ anh reply "ok".
> ⭐ **Sau khi build xong, MỌI thay đổi đi qua MỘT agent: `change-request`** (feature mới + fix bug) — `/change` · `/bug` · `/feature`; `/bug-check` chỉ soi read-only.
> Workflow chi tiết: `.agent/FEATURE_WORKFLOW.md`. Giá trị project → `.context/project-config.md` (do brainstorm ghi, không điền tay).

## Precedence

`AGENTS.md` **always wins** over every file in `.agent/`. Nếu `.agent/FEATURE_WORKFLOW.md` hoặc
`.context/project-config.md` mâu thuẫn với file này → theo **file này**.
File tách từ `AGENTS.md` (`.agent/session-handoff.md`, `.agent/doc-reconcile.md`, `.agent/start-pipeline.md`)
có **cùng hiệu lực**, chỉ không nạp tự động (§ Chi tiết nạp khi cần).

## Router — classify intent BEFORE coding

| Intent (user says…) | Route (mandatory) |
|---|---|
| "fix bug", "lỗi", "broken", regression, crash (đã biết rõ bug nào) | **Change Request (BUG)** → agent `change-request` · `/change` (hoặc `/bug`) |
| "soi/kiểm tra màn", "cảm giác nhiều lỗi nhưng không rõ" | **Bug discovery / sweep** → `/bug-check` — READ-ONLY, KHÔNG fix |
| "thêm/sửa/bỏ/xóa tính năng", "change/update feature" | **Change Request (ADDITIVE/MODIFY/REMOVE)** → agent `change-request` · `/change` (hoặc `/feature`) |
| thay đổi đã ghi sẵn trong `spec/changes/` (hoặc trong `spec/changes/BACKLOG.md`) | **`/change`** — đọc hết file pending → agent `change-request` |
| yêu cầu/bug hậu-build user chat bình thường (mode `maintenance`, KHÔNG gõ lệnh) | **Auto-intake → backlog (bắt buộc)**: ghi dòng `spec/changes/BACKLOG.md` + change doc `spec/changes/YYYY-MM-DD-<slug>.md` (pending) → báo user gõ `/change`. KHÔNG gọi builder/code ngay |
| "bắt đầu project", "start", "đưa repo vào pipeline", "khởi tạo dự án" | **Start** → `/start` |
| "project cũ chưa có spec", "dựng spec từ code", thừa kế codebase | **Spec Init (reverse-engineer)** → `/spec-init` — đọc code → dựng spec + scope (chạy 1 lần đầu) |
| "config dự án", "setup thông tin", "brainstorm", "clear yêu cầu", sửa branch/package/verify commands/DB/models/deploy | **Brainstorm** → `/brainstorm` — đọc spec/code → clear yêu cầu + design doc + ghi `.context/project-config.md` |
| "chia task", "chia layer", "lập kế hoạch triển khai", "breakdown" | **Graph** → `/graph` |
| "deploy", "CI/CD", "EAS build", "store submit", "git init" | **DevOps** → `.agent/devops.md` |
| "rollback", "revert", "checkpoint" | **Rollback** → `.agent/rollback.md` — tag `layer-N-done` + revert strategy |
| "design", "thiết kế UI", "design tokens", "screen spec", "làm đẹp" | **Design** → `/design` (trước khi chia layer) |
| "implement feature" (spec/task đã có sẵn) | **Builder theo task** → `.opencode/agent/builder` |
| "review", "check", "soát" (một diff/task cụ thể) | **Reviewer** → `.opencode/agent/reviewer` — KHÔNG tự sửa code |
| "thêm skill", "add skill", "tạo skill", "register skill" | **Customize opencode** — tạo/cập nhật runtime skill đúng format (§Local skills) |
| hỏi / điều tra / "tại sao", "how does X work" | **Research-only** — KHÔNG edit nếu user chưa yêu cầu fix |

Không rõ intent → hỏi 1 câu ngắn để phân loại, đừng đoán.

### Lệnh (tóm tắt — bảng đầy đủ + pipeline `/start` bước 0–7: `.agent/start-pipeline.md`)

| Command | Dùng khi |
|---|---|
| `/start` | Khởi tạo dự án lần đầu (chuỗi liên tục); build xong → `/change` |
| `/brainstorm` · `/design` · `/graph` | Manual override từng bước của `/start` |
| `/change` · `/bug` · `/feature` | Mọi thay đổi hậu-build → agent `change-request` |
| `/bug-check` | READ-ONLY soi → `tasks/bug-<slug>/scan.md`, dừng chờ user chọn |
| `/spec-init` · `/spec-publish` | Dựng spec từ code (1 lần) · phát hành spec + test-scope bằng tay |
| `/resume` | Làm tiếp từ Run Journal — **KHÔNG** classify/phase-plan lại |

---

## Bug rules (bắt buộc)

1. **Không sửa triệu chứng trước khi có root cause.** (Iron Law — `skills/superpowers/systematic-debugging.md`)
2. **Thiếu info** (màn hình / bước tái hiện / expected-actual / role/vai trò) → **hỏi ngắn trước**, không tự giả định.
3. Bug **không phải sửa 1 dòng** → tạo task: `tasks/bug-<slug>/phase-<N>-task-<NN>.md`.
4. Fix-loop + `Repro Verification` theo `.agent/workflows/bug.md` §2 và `/bug`: chỉ `done` khi repro PASS + Reviewer PASS.
5. Retry/Escalation: sau 3 attempt fail → status `architecture_review_needed`, dừng chờ review kiến trúc/refactor.
6. **Builder** code + test; **Reviewer** kiểm tra độc lập (không sửa source; chỉ ghi report scoped).
7. **Cập nhật `.context/progress.json`** (schema maintenance) sau mỗi bước đổi trạng thái bug.
8. Sau Reviewer PASS + close-out + progress cập nhật, **commit-first** theo `.agent/workflows/state-commit.md` §2.8.
   Reviewer FAIL → không commit/push.
9. **Danh sách bug** hoặc kết quả `/bug-check`, kể cả "fix tất cả defect" → tách từng bug/task,
   tóm tắt số lượng defect, đề xuất thứ tự, nêu bug nào gộp vì cùng root cause, rồi **DỪNG hỏi xác nhận**
   trước khi gọi Builder. Chỉ bỏ checkpoint nếu user ghi rõ `auto proceed`, `khỏi hỏi lại`,
   hoặc `tự xử lý hết không cần hỏi`.

## Feature rules (bắt buộc)

1. **Classify ADDITIVE / MODIFY / REMOVE** trước khi code.
2. Requirement mơ hồ → **hỏi lại**, không tự chọn giả định lớn.
3. Đổi behavior/scope → cập nhật **spec delta** hoặc ghi rõ lý do không cần.
3b. **★ TỰ ĐỘNG Spec Publisher** (`.agent/spec-publish.md`): sau spec delta → bump `spec_version` + ghi `spec/updates/` + `spec/CHANGELOG.md` + sinh `spec/test-scope/current.json` (tăng `scopeVersion`) cho template test. Không chờ user nhắc.
4. Tạo `tasks/feature-<slug>/phase-<N>-task-<NN>.md` khi nhiều bước hoặc có risk.
5. Task phải có `Classification / Risk`, verification summary, và Retry/Escalation theo `/feature` + `.agent/workflows/change.md` §3.
6. Sau 3 attempt fail → status `architecture_review_needed`, dừng chờ review kiến trúc/refactor.
7. **Builder** code + test; **Reviewer** độc lập; **Spec Validator** cross-check gap so với spec.
8. **Cập nhật `.context/progress.json`** (schema maintenance).
9. **Danh sách feature** → tách **mỗi feature thành task riêng**, chốt ưu tiên, xử lý **tuần tự**.
   Gộp chỉ khi cùng mục tiêu/scope (1 feature nhiều phase).

## Commit-First & Doc Reconcile (chi tiết: `.agent/doc-reconcile.md`)

- **1 task = 1 commit** sau PASS + close-out + progress (convention: `.agent/workflows/state-commit.md` §2.8).
- **TRƯỚC** khi đóng việc: reconcile as-built docs hoặc ghi `no doc impact`. **CẤM sửa intent docs cho khớp code** —
  code ≠ intent → ghi gap register.

---

## Non-negotiables (mọi route)

- **Commit** sau PASS theo Commit-First Tracking (`.agent/doc-reconcile.md`). `auto_push_after_pass: true` chỉ cho phép auto-push
  `target_branch` sau PASS; **deploy / mở PR luôn cần user yêu cầu rõ**.
- **Default staging-direct**: chỉ auto-push `target_branch` khi current branch = `target_branch`; nếu user yêu cầu feature branch thì push current branch và PR chỉ khi user yêu cầu rõ. **Cấm push `forbidden_branch`**,
  cấm `--force` / `-f`. Gate cứng ở `opencode.jsonc` (`permission.bash`).
- **KHÔNG commit/push khi Reviewer FAIL** hoặc khi progress chưa cập nhật.
- **KHÔNG tự sửa source khi đang review** — reviewer/spec-validator chỉ được ghi report scoped.
- **Check commands lấy từ `.context/project-config.md`** — không hardcode `npm`/package manager/test command;
  chưa có app code/API/web/test hoặc command chưa cấu hình → ghi `skip, no app configured`, không fail workflow.
- `require_infra: true` (`.context/project-config.md`) → test cần DB/storage **không được skip**: builder chạy
  `integration_test_command` trên port cố định của worktree, bước merge chạy lại trên checkout chính (port base); skip = FAIL.
- **Migration** (chỉ khi `db_tool != none` / `migration_required: true`; `db_tool: none` → bỏ qua): versioned + committed,
  không sửa migration đã apply; destructive ops → `HIGH_RISK_MIGRATION`, không promote production; cấm `db push`,
  `migrate reset`, seed/reset, clone data giữa môi trường; `staging_db` ≠ `prod_db`. Chi tiết: `.agent/FEATURE_WORKFLOW.md` §6.
- **Model mạnh (`builder-strong`) chỉ dùng khi user yêu cầu rõ** — không tự chọn theo độ khó.
- Xong việc → không tự chạy phase/task tiếp theo khi chưa qua **human checkpoint**.

## Tool Loop Guard

- Không lặp cùng 1 command y hệt quá 1 lần, cùng 1 giả thuyết quá 2 lần; empty/non-zero → chuyển hướng.
  Bash bị permission deny → **DỪNG NGAY** (không retry/đổi biến thể), chuyển Grep/Read hoặc ghi `Blocked`.
  Không xác minh được → `Residual risk`/`Blocked`. Chi tiết: `.agent/FEATURE_WORKFLOW.md` §6 Tool Loop Guard.
- **Chi phí subagent `explore`:** chỉ spawn khi root cause **chưa xác định**, tối đa **1 lần**/điều tra. Đã có
  `file:line`/root cause chứng minh (`/bug-check`, journal, repro, check đơn giản) → **cấm spawn**; tự `Read` đúng vị trí,
  truyền thẳng `file:line` cho Builder (mỗi subagent là session riêng, đọc lại context từ đầu, không share cache).

## Session Handoff (chi tiết: `.agent/session-handoff.md`)

- **Primary Read `.agent/session-handoff.md`** đầu mỗi session, trước subagent đầu tiên, khi `/resume`, sau auto-compact.
- **Write-ahead journal** `.context/runs/<type>-<slug>-<phaseTask>.md` trước/sau mỗi subagent: `status=running` +
  `▶ START [agent: X]` TRƯỚC; `status=awaiting` + `evidence` + `next` rồi mới `✅ DONE [agent: X]`.
  Primary ghi, **subagent không ghi**; report subagent mở đầu `Agent: <tên>`. `interrupted ≠ failed attempt`.
- Dừng ở ranh giới step → session mới resume qua `/resume` — **đĩa là sự thật**, pointer là hint.

## Local skills

- Skill mới: `skills/<lowercase-hyphen-name>/SKILL.md`, frontmatter `name` + `description` (nêu keyword auto-trigger cụ thể);
  tài liệu chi tiết để cùng folder, `SKILL.md` làm wrapper. Đăng ký qua `opencode.jsonc` → `skills.paths: ["./skills"]`.
- Sau mọi thay đổi skill/config/agent/command, nhắc user **restart opencode** (không hot-reload).

## Reviewer rules

- Tự chọn `FAST` / `NORMAL` / `STRICT` (mặc định `NORMAL`); risk đỏ → bắt buộc `STRICT`. Report bắt buộc: `Review level`,
  `Reason`, `Blast radius`, `Verify commands + result`, `Findings`, `Verdict PASS/FAIL`.
  Tiêu chí: `.opencode/agent/reviewer.md` § Review level, `.agent/workflows/state-commit.md` § Reviewer level.

## Chi tiết nạp khi cần

| File | Đọc khi |
|---|---|
| `.agent/session-handoff.md` | đầu session · trước/sau subagent · `/resume` · sau compact (journal, banner, redo, usage gate) |
| `.agent/doc-reconcile.md` | close-out task/bug/phase (Commit-First Tracking + Doc Impact & Reconcile) |
| `.agent/start-pipeline.md` | chạy `/start` · tra bảng lệnh/bước đầy đủ |
| `.agent/FEATURE_WORKFLOW.md` · `.agent/workflows/*.md` | workflow bug/feature, gates, resume matrix, commit convention |
