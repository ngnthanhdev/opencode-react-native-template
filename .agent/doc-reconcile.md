# Commit-First Tracking + Doc Impact & Reconcile — đọc khi close-out task/bug/phase

> Tách nguyên văn từ section "Commit-First Tracking" + "Doc Impact & Reconcile Rules" cũ của `AGENTS.md` (không nạp tự động mọi lượt).
> Hiệu lực ngang `AGENTS.md` (xem `AGENTS.md` § Precedence). Commit convention + trailer: `.agent/workflows/state-commit.md` §2.8;
> gates close-out: `.agent/FEATURE_WORKFLOW.md` §6.

## Commit-First Tracking

- Sau khi task/bug/phase PASS review + close-out + cập nhật `.context/progress.json`, phải commit lên branch hiện tại.
- Branch model mặc định là **staging-direct**: current branch phải là `target_branch`, commit ở đó; **push không tự động** — chỉ `git push origin <target_branch>` khi user yêu cầu rõ hoặc `auto_push_after_pass: true` (xem `AGENTS.md` § Non-negotiables). Nếu user yêu cầu feature branch thì push chính current branch (`git push origin <current-branch>`) và chỉ mở PR khi user yêu cầu rõ.
- **1 task = 1 commit**, trừ khi có lý do rõ ràng.
- Commit là source of truth cho changed files, timestamp, SHA, rollback point.
- Task file là source of truth cho root cause, repro/evidence, residual risk, doc impact/reconcile, verification summary.
- `.context/progress.json` là source of truth cho current status, active/completed phase/task, reviewer result/report path.
- Commit message convention và body trailer: xem `.agent/workflows/state-commit.md` §2.8.
- Commit-first tracking là source of truth; không còn `docs/history/YYYY-MM.md` (đã xoá).

## Doc Impact & Reconcile Rules

Sau khi task/bug/phase PASS, xác định doc impact và reconcile **TRƯỚC** khi đóng việc:

| Thay đổi | Doc cập nhật |
|---|---|
| API contract/endpoint/response shape | `docs/API_SPEC.md` |
| Schema/model/enum | `docs/ERD.md` + regen `docs/generated/*` nếu có |
| Kiến trúc/flow/current behavior | `docs/DESIGN.md` (current-state) |
| Giải quyết gap đã ghi | đổi status gap register |
| Không đổi contract/schema/behavior tài liệu hoá | ghi rõ `no doc impact` |

**Parallel mode** (builder chạy trong worktree riêng — `.agent/loop.md` § Parallel Execution Model):
- Builder **KHÔNG** sửa doc dùng chung: `docs/API_SPEC.md`, `docs/ERD.md`, `docs/DESIGN.md`, `docs/generated/*`,
  gap register, `README.md`/`ARCHITECTURE.md` ở root, `.context/decisions.md`. Thay vào đó ghi **doc delta**
  vào `## Doc / Decision Impact` của task file (đổi gì: endpoint/shape/schema/flow/decision + evidence `file:line`)
  và vào completion report. Doc mới do chính task tạo (chỉ task đó sở hữu) → sửa bình thường.
- **Dispatcher reconcile 1 lần/layer** (hoặc 1 lần/milestone khi `schedule_mode: dependency`, 1 lần/phase khi merge phase song song) trên integration branch (Merge steps): đọc Doc Impact của mọi task đã merge
  → cập nhật as-built docs + regen `docs/generated/*` nếu có → 1 commit `docs(layer-<N>): reconcile as-built docs`,
  trước khi ghi `progress.json`. Lý do: nhiều builder cùng sửa 1 doc dùng chung → conflict khi merge layer.
- Đơn luồng (không worktree) → giữ nguyên: reconcile trong close-out của từng task.

Phân biệt 2 loại doc — **CẤM tự sửa intent docs cho khớp code**:
- **As-built** (`docs/API_SPEC.md`, `docs/ERD.md`, `docs/DESIGN.md` current-state, generated inventory,
  gap register status): reconcile khi code đổi, kèm evidence code.
- **Intent** (`docs/BRD.md`, `docs/PRD.md`, `docs/USER_FLOW.md` target, business rules trong
  `SPECIFICATIONS.md` — nếu file tồn tại): chỉ đổi qua Change Request + user duyệt.

Code ≠ intent → ghi gap vào gap register (nếu có, vd `docs/changes/TECHNICAL_REQUIREMENT_GAPS.md`),
**KHÔNG** hạ cấp intent cho khớp code. Fix code sai rồi sửa doc cho khớp = hợp pháp hoá bug, coi là vi phạm.
