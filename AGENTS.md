# AGENTS.md — AI Workflow Router (entry point)

> This is the **always-loaded entry point**. Read it before acting on any request.
> 🚀 **Start dự án = `/start`** — chuỗi **chạy LIÊN TỤC, tự chuyển bước**: **đọc spec** (`/spec-init` nếu chưa có) → **brainstorm** (clear yêu cầu + design doc + config) → **design** (design spec + tokens) → **graph** (chia layer/task) → **loop** (DevOps lo git/CI-CD/deploy).
> **Không cần gõ lại lệnh mỗi bước** — agent tự chạy tiếp; chỉ **DỪNG ở human checkpoint** (duyệt/confirm/duyệt plan) rồi chờ anh reply "ok".
> ⭐ **Sau khi build xong, MỌI thay đổi đi qua MỘT agent: `change-request`** (feature mới + fix bug). Cửa vào: **`/change`** (đọc hết `spec/changes/*.md`), hoặc `/bug` / `/feature`. `/bug-check` chỉ soi read-only.
> Workflow chi tiết: `.agent/FEATURE_WORKFLOW.md`. Giá trị project → `.context/project-config.md` (do brainstorm ghi, không điền tay).
> Lệnh con `/brainstorm`, `/design`, `/graph` là **manual override** (chạy tay khi muốn chạy lại/update 1 bước); trong `/start` chúng không bắt user gọi.

## Precedence

`AGENTS.md` **always wins** over every file in `.agent/`. Nếu `.agent/FEATURE_WORKFLOW.md` hoặc
`.context/project-config.md` mâu thuẫn với file này → theo **file này**.

## Router — classify intent BEFORE coding

| Intent (user says…) | Route (mandatory) |
|---|---|
| "fix bug", "lỗi", "broken", regression, crash (đã biết rõ bug nào) | **Change Request (BUG)** → agent `change-request` · `/change` (hoặc `/bug`) |
| "soi/kiểm tra màn", "cảm giác nhiều lỗi nhưng không rõ" | **Bug discovery / sweep** → `/bug-check` — READ-ONLY, KHÔNG fix |
| "thêm/sửa/bỏ/xóa tính năng", "change/update feature" | **Change Request (ADDITIVE/MODIFY/REMOVE)** → agent `change-request` · `/change` (hoặc `/feature`) |
| thay đổi đã ghi sẵn trong `spec/changes/` (hoặc trong `spec/changes/BACKLOG.md`) | **`/change`** — đọc hết file pending → agent `change-request` |
| yêu cầu/bug hậu-build user chat bình thường (mode `maintenance`, KHÔNG gõ lệnh) | **Auto-intake → backlog**: tạo dòng `spec/changes/BACKLOG.md` + change doc `spec/changes/YYYY-MM-DD-<slug>.md` (pending) → báo user "✅ Đã ghi vào backlog — gõ `/change` để xử lý". KHÔNG code ngay |
| "bắt đầu project", "start", "đưa repo vào pipeline", "khởi tạo dự án" | **Start** → `/start` — chuỗi chạy LIÊN TỤC: đọc spec → brainstorm → design → graph → loop (tự chuyển bước, chỉ dừng ở checkpoint) |
| "project cũ chưa có spec", "dựng spec từ code", thừa kế codebase | **Spec Init (reverse-engineer)** → `/spec-init` — đọc code → dựng spec + scope (chạy 1 lần đầu) |
| "config dự án", "setup thông tin", "brainstorm", "clear yêu cầu", sửa branch/package/verify commands/DB/models/deploy | **Brainstorm** → `/brainstorm` — đọc spec/code → clear yêu cầu + design doc + ghi `.context/project-config.md` |
| "chia task", "chia layer", "lập kế hoạch triển khai", "breakdown" | **Graph** → `/graph` — chia spec/design thành layer/task theo dependency + layer-plan diagram |
| "deploy", "CI/CD", "EAS build", "store submit", "git init" | **DevOps** → `.agent/devops.md` — git init + EAS build/submit + store deploy |
| "rollback", "revert", "checkpoint" | **Rollback** → `.agent/rollback.md` — tag `layer-N-done` + revert strategy |
| "design", "thiết kế UI", "design tokens", "screen spec", "làm đẹp" | **Design** → `/design` — sinh design tokens + screen specs (`design-spec.md`) trước khi chia layer |
| "implement feature" (spec/task đã có sẵn) | **Builder theo task** → `.opencode/agent/builder` |
| "review", "check", "soát" (một diff/task cụ thể) | **Reviewer** → `.opencode/agent/reviewer` — KHÔNG tự sửa code |
| "thêm skill", "add skill", "tạo skill", "register skill" | **Customize opencode** — tạo/cập nhật runtime skill đúng format (§Local skills) |
| hỏi / điều tra / "tại sao", "how does X work" | **Research-only** — KHÔNG edit nếu user chưa yêu cầu fix |

Không rõ intent → hỏi 1 câu ngắn để phân loại, đừng đoán.

> **Auto-intake backlog (bắt buộc trong maintenance mode):** mọi yêu cầu/bug rõ ràng user gửi qua chat — kể cả dạng nói tự nhiên không gõ lệnh — agent **tự động** ghi vào `spec/changes/BACKLOG.md` + tạo change doc pending rồi báo user gõ `/change` để xử lý tiếp. **Không** gọi builder/code ngay khi chỉ là yêu cầu mới chưa xử lý.

### Phân biệt command

| Command | Dùng khi | Tính chất |
|---|---|---|
| `/start` | **Khởi tạo dự án (lần đầu)** | Chuỗi chạy **LIÊN TỤC, tự chuyển bước**: đọc spec (`/spec-init` nếu chưa có) → brainstorm → design → graph → loop. Chỉ **DỪNG ở human checkpoint** (không bắt user gõ lại lệnh). Sau khi build xong → dùng `/change` |
| `/graph` | **Chia layer/task** cho initial build (manual override — tự chạy trong `/start`) | Đọc spec + design → sinh `tasks/<slug>/layer-{N}-task-{NN}.md` + layer-plan diagram + update `progress.json`. Chạy tay khi chạy lại/điều chỉnh kế hoạch |
| `/design` | **Design spec + tokens** cho project có UI (manual override — tự chạy trong `/start`) | Đọc spec + brainstorm → hỏi design reference → sinh design tokens + `.context/design-spec.md`. Confirm tokens với user trước khi chia layer |
| `/change` | **Cửa vào chính cho thay đổi hậu-build** | Đọc hết `spec/changes/*.md` pending → gọi agent `change-request`. Không có file → báo "không có change chờ". |
| `/bug-check` | Khu vực/màn mơ hồ, "cảm giác nhiều lỗi" | **READ-ONLY** — soi, liệt kê defect vào `tasks/bug-<slug>/scan.md`, **dừng chờ user chọn**. Không sửa, không commit. |
| `/bug` | **Một bug đã biết** hoặc list bug đã xác nhận | Cửa vào → agent `change-request` (class BUG): root cause → task → builder → reviewer → **★ Spec Publisher (sinh test-scope/current.json)** → progress → commit-first |
| `/feature` | Thêm/sửa/bỏ tính năng | Cửa vào → agent `change-request` (class ADDITIVE/MODIFY/REMOVE): spec delta → **★ Spec Publisher (bump version + spec/updates/ + test-scope/current.json)** → phase/task → builder/reviewer/spec-validator |
| `/spec-init` | Project CŨ đã có code nhưng **chưa có spec** (legacy/thừa kế) | Reverse-engineer: scan code → dựng `SPECIFICATIONS.md` + `spec/` + `spec/test-scope/current.json` (risk `high`). Read-only, chạy 1 lần |
| `/brainstorm` | **Chốt/sửa config dự án** sau `/spec-init` (vd branch, package manager, verify commands, DB, models, deploy). Chạy lại để update | Đọc spec/code + config hiện có → hỏi user theo nhóm → ghi `.context/project-config.md` + sync quyền verify command. `/brainstorm <nhóm>` chỉ sửa 1 nhóm. KHÔNG commit/push |
| `/resume` | Mở session mới **làm tiếp** việc đang dở | Đọc Run Journal → reconcile đĩa → thực hiện `next`. **KHÔNG** classify/phase-plan lại (§ Session Handoff) |

---

## Workflow từng bước (initial build — `/start`)

> `/start` chạy **liên tục, tự chuyển bước**; chỉ **DỪNG ở ⏸ checkpoint**. User reply "ok" để đi tiếp.
> **Subagent** = `.opencode/agent/*.md` (gọi qua `task` tool). **Prompt-level** = `.agent/*.md` (đọc + thực thi trong session chính).

| Bước | Việc | Ai xử lý (subagent) | Prompt-level | Skill | Output | Gate |
|---|---|---|---|---|---|---|
| **0** | Session start / resume | — | `AGENTS.md`, `.agent/blackboard.md` | — | đọc `progress.json` (`activeWorkItem`); đang dở → `/resume` | — |
| **1a** | Dựng spec từ code (nếu chưa có) | **`spec-init`** | `.agent/spec-init.md` | — | `SPECIFICATIONS.md` + `spec/` + `spec/test-scope/current.json` | read-only, chạy 1 lần |
| **1b** | Validate spec vs code/docs | **`spec-validator`** | `.agent/spec-validator.md` | — | report `.context/review-reports/spec-validation.md` | PASS → bước 2 · FAIL → làm rõ, validate lại (max 2 vòng) |
| **2** | Clear yêu cầu + chốt config | — | `.agent/brainstorm.md` | `brainstorming` | design doc `docs/specs/*.md` + `.context/project-config.md` (+ secret → `.env.local`) | ⏸ **approve design** — HARD-GATE: chưa approve không code |
| **3** | Design tokens + screen specs (nếu có UI) | **`design`** | `.agent/design.md` | `impeccable`, `taste-skill-v2` (RN) | `skills/react-native/design-tokens.md` + `.context/design-spec.md` (+ archify diagram) | ⏸ **confirm tokens** |
| **4** | Chia layer + task (dependency order) | **`graph`** | `.agent/graph.md` | `archify` | `tasks/<slug>/layer-{N}-task-{NN}.md` + `docs/layer-plan.html` + `progress.json` (totalLayers/currentLayer) | ⏸ **duyệt plan** |
| **5a** | Implement các task độc lập (+ test, TDD) **SONG SONG** — mỗi task 1 **git worktree riêng**, mỗi `builder` chạy full loop | **`builder`** ×N (task khó: `builder-strong`, opt-in) | `.agent/loop.md` (Parallel Execution Model) + `scripts/parallel-dispatch.mjs` | `superpowers`, `ponytail`, `karpathy-guidelines`, `security`, `monitoring` | code + test (commit trong worktree) | — |
| **5b** | Observe: tsc / lint / jest / expo build | — | `.agent/loop.md` | — | kết quả verify (cmd từ `project-config`) | FAIL → 5c |
| **5c** | Root cause + fix | (`error-analyzer`) | `.agent/error-analyzer.md` | `superpowers/systematic-debugging` | `.context/error-memory.md` | retry max 3 → `BLOCKED` |
| **5d** | Review độc lập | **`reviewer`** | `.agent/reviewer.md` | `aislop`, `anti-slop`, `open-code-review`, `impeccable`, `react-native/e2e-maestro` | `.context/review-reports/<feature\|bug>-<slug>-phase-<N>-task-<NN>-round-<R>-review.md` | PASS → 5e · FAIL → về 5a (max 2 vòng) |
| **5e** | Close-out task | — | `.agent/loop.md`, `.agent/FEATURE_WORKFLOW.md` §6 + `.agent/workflows/state-commit.md` §2.8/§5 | — | Doc Impact/Reconcile → `progress.json` → **commit** (1 task = 1 commit) | — |
| **5e-merge** | Gom các task song song → merge về integration branch + verify tổng thể + ghi `progress.json` 1 lần + cleanup worktree | **`merger`** (1 con) | `.agent/loop.md` (Merger steps) + `scripts/parallel-dispatch.mjs merge/cleanup` | — | integration branch layer-N + `progress.json` cập nhật | conflict → task đó chạy lại tuần tự |
| **5f** | Compact context | — | `.agent/context-manager.md` | — | `.context/compressed-summary.md` | mỗi 3 task + hết layer |
| **5g** | Hết layer → review phase | **`spec-validator`** | `.agent/spec-validator.md` | — | phase report | ⏸ **checkpoint sau mỗi layer** — Layer N+1 chỉ unlock khi Layer N PASS + user duyệt |
| **5h** | Hết layer cuối (initial build) → bàn giao test-scope | **`spec-publisher`** | `.agent/spec-publish.md` | — | `spec/test-scope/current.json` (trigger: initial-build, scopeVersion +1) + `spec/CHANGELOG.md` | commit kèm close-out |
| **6** | Git init / EAS build / store deploy | — | `.agent/devops.md` (+ `.devops/templates/*`) | — | git repo, EAS profiles, build preview → store submit | ⏸ **approve production submit** |
| **7** | Rollback khi fail | — | `.agent/rollback.md` | — | tag `layer-N-done`, revert về checkpoint | notify human |

**Bàn giao runtime:** mỗi lần gọi subagent → ghi Run Journal **write-ahead** (`.context/runs/<type>-<slug>-<phaseTask>.md`), in `▶ START` trước / `✅ DONE` sau (§ Session Handoff). **Agent attribution:** banner + mọi kết quả trả ra phải ghi rõ agent đang thực thi — `▶ START [agent: builder]`, `✅ DONE [agent: reviewer]`.

### Sau khi build xong — MỌI thay đổi qua 1 agent

| Cửa vào | Agent | Các bước |
|---|---|---|
| `/change` · `/bug` · `/feature` | **`change-request`** (+ `.agent/change-request.md`) | classify BUG / ADDITIVE / MODIFY / REMOVE → spec delta → **`spec-publisher`** (bump `spec_version` + `spec/updates/` + `spec/test-scope/current.json`) → `spec-validator` → phase/task → `loop`(builder→reviewer) → `spec-validator` (hết phase) → doc reconcile → progress → commit → archive change file |
| `/bug-check` | — (read-only) | soi khu vực, liệt kê defect vào `tasks/bug-<slug>/scan.md`, **DỪNG chờ user chọn** — KHÔNG gọi builder |
| `/spec-publish` | **`spec-publisher`** | phát hành spec + test-scope (thường tự động trong change-request; dùng tay khi cần) |

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

## Commit-First Tracking

- Sau khi task/bug/phase PASS review + close-out + cập nhật `.context/progress.json`, phải commit lên branch hiện tại.
- Branch model mặc định là **staging-direct**: current branch phải là `target_branch`, commit ở đó; **push không tự động** — chỉ `git push origin <target_branch>` khi user yêu cầu rõ hoặc `auto_push_after_pass: true` (xem § Non-negotiables). Nếu user yêu cầu feature branch thì push chính current branch (`git push origin <current-branch>`) và chỉ mở PR khi user yêu cầu rõ.
- **1 task = 1 commit**, trừ khi có lý do rõ ràng.
- Commit là source of truth cho changed files, timestamp, SHA, rollback point.
- Task file là source of truth cho root cause, repro/evidence, residual risk, doc impact/reconcile, verification summary.
- `.context/progress.json` là source of truth cho current status, active/completed phase/task, reviewer result/report path.
- Commit message convention và body trailer: xem `.agent/workflows/state-commit.md` §2.8.
- Commit-first tracking là source of truth; không còn `docs/history/YYYY-MM.md` (đã xoá).

### Doc Impact & Reconcile Rules

Sau khi task/bug/phase PASS, xác định doc impact và reconcile **TRƯỚC** khi đóng việc:

| Thay đổi | Doc cập nhật |
|---|---|
| API contract/endpoint/response shape | `docs/API_SPEC.md` |
| Schema/model/enum | `docs/ERD.md` + regen `docs/generated/*` nếu có |
| Kiến trúc/flow/current behavior | `docs/DESIGN.md` (current-state) |
| Giải quyết gap đã ghi | đổi status gap register |
| Không đổi contract/schema/behavior tài liệu hoá | ghi rõ `no doc impact` |

Phân biệt 2 loại doc — **CẤM tự sửa intent docs cho khớp code**:
- **As-built** (`docs/API_SPEC.md`, `docs/ERD.md`, `docs/DESIGN.md` current-state, generated inventory,
  gap register status): reconcile khi code đổi, kèm evidence code.
- **Intent** (`docs/BRD.md`, `docs/PRD.md`, `docs/USER_FLOW.md` target, business rules trong
  `SPECIFICATIONS.md` — nếu file tồn tại): chỉ đổi qua Change Request + user duyệt.

Code ≠ intent → ghi gap vào gap register (nếu có, vd `docs/changes/TECHNICAL_REQUIREMENT_GAPS.md`),
**KHÔNG** hạ cấp intent cho khớp code. Fix code sai rồi sửa doc cho khớp = hợp pháp hoá bug, coi là vi phạm.

---

## Non-negotiables (mọi route)

- **Commit** sau PASS theo Commit-First Tracking. `auto_push_after_pass: true` chỉ cho phép auto-push
  `target_branch` sau PASS; **deploy / mở PR luôn cần user yêu cầu rõ**.
- **Default staging-direct**: chỉ auto-push `target_branch` khi current branch = `target_branch`; nếu user yêu cầu feature branch thì push current branch và PR chỉ khi user yêu cầu rõ. **Cấm push `forbidden_branch`**,
  cấm `--force` / `-f`. Gate cứng ở `opencode.jsonc` (`permission.bash`).
- **KHÔNG commit/push khi Reviewer FAIL** hoặc khi progress chưa cập nhật.
- **KHÔNG tự sửa source khi đang review** — reviewer/spec-validator chỉ được ghi report scoped.
- **Check commands lấy từ `.context/project-config.md`** — không hardcode `npm`.
- Nếu repo chưa có app code/API/web/test hoặc command chưa cấu hình → verify ghi `skip, no app configured`,
  không hardcode package manager/test command và không fail workflow vì thiếu app.
- **Migration safety** chỉ áp dụng khi `db_tool != none` / `migration_required: true`
  (`.context/project-config.md`); `db_tool: none` → bỏ qua gate migration.
- Khi migration gate áp dụng: migration phải versioned + committed; không sửa migration đã apply.
  Trước commit inspect migration artifact; destructive/high-risk ops (`DROP`, đổi type, `SET NOT NULL`,
  `UNIQUE/FK` trên data cũ, enum phá hoại, bulk transform/backfill) → gắn `HIGH_RISK_MIGRATION`,
  không promote production, báo rõ destructive op/table/column/data/backfill/rollback/verify staging.
- Cấm `db push`, `migrate reset`, seed/reset, clone data giữa môi trường cho staging/prod.
  Flow: dev → migration versioned → staging deploy → verify → promote đúng migration đã test lên prod.
  `staging_db` phải khác `prod_db`; không sync data staging→prod.
- **Model mạnh (`builder-strong`) chỉ dùng khi user yêu cầu rõ** — không tự chọn theo độ khó.
- Xong việc → không tự chạy phase/task tiếp theo khi chưa qua **human checkpoint**.
- **Session handoff**: dừng ở ranh giới step → ghi Run Journal (write-ahead); session mới resume qua
  `/resume` (xem § Session Handoff) — **đĩa là sự thật**, pointer là hint.

## Tool Loop Guard

- Không chạy lặp cùng 1 shell/search/read command y hệt quá 1 lần.
- Không thử cùng 1 giả thuyết quá 2 lần bằng biến thể gần giống.
- Command/search trả empty hoặc non-zero → ghi nhận và chuyển hướng, không retry vô hạn.
- Bash bị permission deny → **DỪNG NGAY**: không retry, không đổi biến thể, không vòng qua pipeline;
  chuyển Grep/Read hoặc ghi `Blocked`.
- Không xác minh được → ghi `Residual risk`/`Blocked`, không lặp tool.
- **Chi phí subagent `explore`:** chỉ spawn `explore` khi root cause **chưa xác định**. Đã có
  `file:line`/root cause chứng minh (từ `/bug-check`, journal, repro, hoặc check đơn giản) → **cấm spawn
  `explore`**; tự `Read` đúng vị trí và truyền thẳng `file:line` cho Builder. Chưa chắc root cause → tối đa
  **1 lần** cho mỗi điều tra. Lý do: mỗi subagent là session riêng, tự đọc lại context từ đầu, không share cache.

## Session Handoff (Run Journal)

Mục tiêu: **dừng ở bất kỳ ranh giới step, mở session mới làm tiếp** — không mất code, không lạc step,
worst case **redo đúng 1 step**. Resume là **tái dựng** từ artifact, **không** phải nối tiếp lossless.

**Artifact:** `.context/runs/<type>-<slug>-<phaseTask>.md` (template: `.context/runs/_TEMPLATE.md`).
Primary ghi journal; **subagent không ghi**.

**Write-ahead checkpoint (bắt buộc):**
1. TRƯỚC khi gọi subagent: ghi `step=<bước>, status=running`, snapshot `filesTouched`/`filesNew`
   từ `git status --short`, in `▶ START <bước> <phaseTask>`.
2. SAU khi subagent trả về: ghi `status=awaiting`, `evidence`, `next`, cập nhật manifest,
   **rồi mới** in `✅ DONE <bước> <phaseTask>`. Ghi journal **TRƯỚC** khi in `✅ DONE`.
3. `✅ DONE` là **điểm dừng an toàn**. `▶ START ... running` mà cancel → session sau **redo bước đó**.
4. **Gộp lần ghi thừa:** khi cần ghi journal/progress mà lần ghi trước **liền kề và không kèm mốc bắt buộc** (không phải "trước/sau khi gọi subagent", không phải close-out task/phase, không phải ngay trước commit) → **gộp vào lần ghi kế tiếp**, KHÔNG tạo thêm lượt model riêng. Vẫn bắt buộc giữ nguyên: ghi `status=running` TRƯỚC mỗi subagent và `status=awaiting` + evidence SAU mỗi subagent; `progress.json` phải cập nhật TRƯỚC mỗi commit.

**Banner:** mỗi checkpoint in `▶ START` / `✅ DONE` kèm `[agent: <tên>]` + `phaseTask` + `next`; khi `status=running`
ghi rõ "cancel sẽ redo bước này". Completion report của subagent **bắt buộc mở đầu bằng `Agent: <tên>`**
(`builder`, `builder-strong`, `reviewer`, `design`, `graph`, `spec-init`, `spec-publisher`, `spec-validator`, `change-request`).

**Session Start Protocol (đầu mỗi session):**
1. Đọc journal của `activeWorkItem` trong `.context/progress.json` (không có journal → coi pointer là hint).
2. Reconcile với đĩa: `git status --short` (so manifest → file lạ = nhiễm chéo), `git log --oneline`
   (task đã commit chưa), `evidence.reportPath` (reviewer đã chạy chưa, round mấy).
3. In **Resume Briefing**: workItem, step, dirty files vs manifest, evidence, `next` → rồi mới làm.
4. **Đĩa là sự thật, pointer là hint.** Lệch → theo đĩa; bước mơ hồ → redo bước đó.

**Redo policy:** cắt ngang `builder`/`reviewer` → **redo nguyên bước**. Redo là chạy lại **trên đĩa**
(đọc file + `git diff` trước khi sửa), **không revert** (`git checkout --` / `reset --hard` bị deny).
Dọn report dở trước khi rerun reviewer.
**`interrupted ≠ failed attempt`** — redo do cancel **KHÔNG** tăng `attempt`.

**Loop signal:** thấy cùng lỗi lặp ≥ 2 lần → ghi `loopSignal` vào journal + escalate
`architecture_review_needed`, không tự redo vô hạn.

**Sau auto-compact:** phải **re-read journal** từ đĩa, không tin trí nhớ tóm tắt.

**Usage gate (safe-point theo ngưỡng):** policy ở `.context/session-policy.json`
(`usageGate: {enabled, threshold, minStepsLeft, hardThreshold}`). Ở mỗi checkpoint, gọi tool `usage()`
(plugin `loop-guard`); nếu `percent ≥ threshold` **và** còn ≥ `minStepsLeft` bước (hoặc `percent ≥ hardThreshold`)
→ hỏi user bằng `question` tool: `[End — mở session mới] / [Làm tiếp] / [Tiếp, đừng hỏi tới hardThreshold]`.
Chọn End → in Resume Briefing + dòng `/resume <type>/<slug>` để copy sang session mới, rồi dừng turn.

## Local skills

- Runtime skills của template nằm trong `skills/<skill-name>/SKILL.md` và được đăng ký qua `opencode.jsonc` → `skills.paths: ["./skills"]`.
- Khi user yêu cầu **thêm skill**, phải tạo folder `skills/<lowercase-hyphen-name>/SKILL.md` với frontmatter `name` + `description`; `description` phải nêu rõ khi nào auto-trigger bằng keyword cụ thể.
- Nếu skill có nhiều tài liệu chi tiết, giữ chúng trong cùng folder và để `SKILL.md` làm wrapper trỏ tới các file đó.
- Sau mọi thay đổi skill/config/agent/command, nhắc user **restart opencode** vì config không hot-reload.

## Reviewer rules (risk-based)

- Reviewer tự chọn `FAST` / `NORMAL` / `STRICT`; mặc định `NORMAL`.
- `FAST` chỉ khi scope rất hẹp, không shared/API/auth/tenant/schema, Builder đã test PASS.
- `STRICT` bắt buộc khi có risk đỏ: auth/RBAC/permission; tenant/school/org isolation; DB/schema/migration;
  data loss/bulk update; API contract/DTO/response shape dùng nhiều client; shared service/hook/component/API client/cache key/navigation;
  payment/subscription; import/export/report; cron/webhook; security/token/session/password/upload/file access;
  root cause chưa rõ; logic quan trọng thiếu test.
- Report phải có `Review level`, `Reason`, `Blast radius`, `Verify commands + result`, `Findings`, `Verdict PASS/FAIL`.
