# Start pipeline + bảng lệnh (chi tiết) — đọc khi chạy `/start` hoặc cần tra lệnh/bước đầy đủ

> Tách nguyên văn từ section "Phân biệt command" + "Workflow từng bước" + "Sau khi build xong" cũ của `AGENTS.md` (không nạp tự động mọi lượt).
> Hiệu lực ngang `AGENTS.md` (xem `AGENTS.md` § Precedence). Run Journal / banner: `.agent/session-handoff.md`.

## Phân biệt command

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
| `/resume` | Mở session mới **làm tiếp** việc đang dở | Đọc Run Journal → reconcile đĩa → thực hiện `next`. **KHÔNG** classify/phase-plan lại (`.agent/session-handoff.md`) |

## Workflow từng bước (initial build — `/start`)

> `/start` chạy **liên tục, tự chuyển bước**; chỉ **DỪNG ở ⏸ checkpoint**. User reply "ok" để đi tiếp.
> **Subagent** = `.opencode/agent/*.md` (gọi qua `task` tool). **Prompt-level** = `.agent/*.md` (đọc + thực thi trong session chính).

| Bước | Việc | Ai xử lý (subagent) | Prompt-level | Skill | Output | Gate |
|---|---|---|---|---|---|---|
| **0** | Session start / resume | — | `AGENTS.md`, `.agent/session-handoff.md`, `.agent/blackboard.md` | — | đọc `progress.json` (`activeWorkItem`); đang dở → `/resume` | — |
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
| **5e-merge** | Gom các task song song → merge về integration branch + verify tổng thể + ghi `progress.json` 1 lần + cleanup worktree | **Dispatcher tự làm** (không spawn agent con) | `.agent/loop.md` (Merge steps) + `scripts/parallel-dispatch.mjs merge/cleanup` + `tools/task-dashboard/progress-write.mjs` | — | integration branch layer-N + `progress.json` cập nhật | conflict → task đó chạy lại tuần tự |
| **5f** | Compact context | — | `.agent/context-manager.md` | — | `.context/compressed-summary.md` | mỗi 3 task + hết layer |
| **5g** | Hết layer → review phase | **`spec-validator`** | `.agent/spec-validator.md` | — | phase report | ⏸ **checkpoint sau mỗi layer** — Layer N+1 chỉ unlock khi Layer N PASS + user duyệt (`schedule_mode: dependency`: task unlock theo dependency, checkpoint theo milestone ⏸ — `.agent/loop.md`) |
| **5h** | Hết layer cuối (initial build) → bàn giao test-scope | **`spec-publisher`** | `.agent/spec-publish.md` | — | `spec/test-scope/current.json` (trigger: initial-build, scopeVersion +1) + `spec/CHANGELOG.md` | commit kèm close-out |
| **6** | Git init / EAS build / store deploy | — | `.agent/devops.md` (+ `.devops/templates/*`) | — | git repo, EAS profiles, build preview → store submit | ⏸ **approve production submit** |
| **7** | Rollback khi fail | — | `.agent/rollback.md` | — | tag `layer-N-done`, revert về checkpoint | notify human |

**Bàn giao runtime:** mỗi lần gọi subagent → ghi Run Journal **write-ahead** (`.context/runs/<type>-<slug>-<phaseTask>.md`), in `▶ START` trước / `✅ DONE` sau (`.agent/session-handoff.md`). **Agent attribution:** banner + mọi kết quả trả ra phải ghi rõ agent đang thực thi — `▶ START [agent: builder]`, `✅ DONE [agent: reviewer]`.

## Sau khi build xong — MỌI thay đổi qua 1 agent

| Cửa vào | Agent | Các bước |
|---|---|---|
| `/change` · `/bug` · `/feature` | **`change-request`** (+ `.agent/change-request.md`) | classify BUG / ADDITIVE / MODIFY / REMOVE → spec delta → **`spec-publisher`** (bump `spec_version` + `spec/updates/` + `spec/test-scope/current.json`) → `spec-validator` → phase/task → `loop`(builder→reviewer) → `spec-validator` (hết phase) → doc reconcile → progress → commit → archive change file |
| `/bug-check` | — (read-only) | soi khu vực, liệt kê defect vào `tasks/bug-<slug>/scan.md`, **DỪNG chờ user chọn** — KHÔNG gọi builder |
| `/spec-publish` | **`spec-publisher`** | phát hành spec + test-scope (thường tự động trong change-request; dùng tay khi cần) |
