# State, commit & model mapping (chi tiết) — đọc khi close-out/commit hoặc cấu hình model

> Tách từ `.agent/FEATURE_WORKFLOW.md` §2.8 (commit) + §5 (State & paths) + §7 (Model mapping).
> Precedence: `AGENTS.md` > `FEATURE_WORKFLOW.md` > file này. Gates cốt lõi vẫn ở `FEATURE_WORKFLOW.md` §6.

## 2.8 Commit / push (commit-first) — dùng chung cho bug + feature
- Sau khi task/bug/phase PASS review + close-out + cập nhật `.context/progress.json`, phải commit lên branch hiện tại theo convention bên dưới.
- **1 task = 1 commit**, trừ khi có lý do rõ ràng như shared file interleave nhiều scope; ghi lý do trong commit body hoặc report.
- Commit là source of truth cho: changed files, timestamp, SHA, rollback point.
- Task file là source of truth cho: root cause, repro/evidence, residual risk, doc impact/reconcile, verification summary.
- `.context/progress.json` là source of truth cho: current status, active/completed phase/task, reviewer result/report path.
- Trước commit: chạy `git status` + `git diff` để chắc không lẫn file ngoài scope task.
- Chỉ stage file thuộc task hiện tại; không stage dirty cũ ngoài scope.
- Working tree còn việc khác đang dở → không gộp vào commit task hiện tại.
- Nếu file shared bị interleave nhiều scope (schema/service/docs) khiến tách commit không an toàn
  → cho phép 1 combined batch commit cho đúng epic đó, ghi rõ lý do; không cố partial-staging gây hỏng build.
- Commit subject convention:
  - `feat(feature-<slug>): phase-<N>-task-<NN> <summary>`
  - `fix(bug-<slug>): phase-<N>-task-<NN> <summary>`
  - Workflow/template/config: `chore(workflow): <summary>` hoặc `docs(workflow): <summary>`
  - Doc reconcile sau merge layer song song (dispatcher, 1 commit/layer, ngoài luật 1 task = 1 commit):
    `docs(layer-<N>): reconcile as-built docs`
- Commit body nên có trailer:
  ```
  Task: tasks/<feature-or-bug-slug>/phase-<N>-task-<NN>.md
  Review: <FAST|NORMAL|STRICT> PASS
  Review-Report: .context/review-reports/<report>.md
  Tests: <command> = PASS
  Migration: <none|migration-name SAFE_ADDITIVE|migration-name HIGH_RISK>
  Doc-Impact: <none|API_SPEC|ERD|DESIGN|GAPS>
  ```
  (Commit của builder trong worktree song song: `Doc-Impact` = doc delta đã ghi ở task file, chưa sửa doc dùng chung.)
- Với one-line obvious bug không tạo task file, commit body phải có:
  ```
  Repro-Verification: <short evidence of root cause + expected/actual>
  ```
- Branch model: default **staging-direct** nghĩa là commit trên current branch khi current branch = `target_branch` và push bằng `git push origin <target_branch>`; nếu user yêu cầu feature branch thì commit/push chính current feature branch bằng `git push origin <current-branch>` và chỉ mở PR khi user yêu cầu rõ.
- Tuyệt đối không push `forbidden_branch`; không `--force`/`-f` (đã chặn ở `opencode.jsonc`).
- Push chỉ khi user yêu cầu rõ hoặc `auto_push_after_pass: true` trong `.context/project-config.md`; Reviewer FAIL / progress chưa xong → **không** commit/push.
- Không hardcode tên branch — luôn đọc từ profile.

## 5. State & paths

### State — `.context/progress.json` (schema maintenance)
Tối thiểu file phải là:

```json
{
  "mode": "maintenance",
  "activeWorkItem": null,
  "features": [],
  "bugs": []
}
```

Khi có work item, có thể mở rộng trong `features[]` / `bugs[]`:

```json
{
  "mode": "maintenance",
  "activeWorkItem": null,
  "features": [
    { "slug": "", "title": "", "type": "ADDITIVE|MODIFY|REMOVE",
      "status": "planned|in_progress|blocked|architecture_review_needed|done", "currentPhase": 0, "tasks": [] }
  ],
  "bugs": [
    { "slug": "", "title": "", "severity": "blocker|high|medium|low",
      "status": "triaged|reproducing|root_caused|fixing|review|done|blocked|architecture_review_needed",
      "task": "tasks/bug-<slug>/..." }
  ]
}
```
- Tối thiểu: `mode`, `activeWorkItem`, `features`, `bugs`. Có thể thêm `lastUpdated` nếu muốn.
- Status semantics: `blocked` = chặn chung như thiếu info/môi trường; `architecture_review_needed` = đã fail ≥3 attempt, cần review kiến trúc/refactor trước khi sửa tiếp.
- State dùng `features[]`/`bugs[]` + `activeWorkItem`; không dùng field layer cũ (`currentLayer`, `totalLayers`, …)
  trong maintenance mode.
- `activeWorkItem` = `{ type, slug }` của bug/feature đang làm, hoặc `null`.
- Cập nhật progress.json là bước **bắt buộc** (`.agent/workflows/bug.md` §2.7, `.agent/workflows/change.md` §3.9).

### Task
- Feature: `tasks/feature-<slug>/phase-<N>-task-<NN>.md`
- Bug: `tasks/bug-<slug>/phase-<N>-task-<NN>.md`
- Trước khi Builder chạy, task phải có các block: `Classification / Risk`, `Acceptance Criteria`,
  `Verification Plan`, `Retry / Error Memory`, `Doc / Decision Impact`.
- Bug task phải có `Repro Verification`; feature/update task phải có `Feature Verification`.

### Review report
- Task reviewer report phải đúng tên: `.context/review-reports/<feature|bug>-<slug>-phase-<N>-task-<NN>-round-<R>-review.md`.
- Phase-level/spec-validator report khi hết phase: `.context/review-reports/<feature|bug>-<slug>-phase-<N>-round-<R>-review.md` (kèm hậu tố `-spec` nếu là spec-validator).
- Pre-plan spec validation (trước khi chia phase/task): `.context/review-reports/feature-<slug>-spec-validation.md`.
- Quy tắc `round-<R>`: luôn ghi rõ vòng (1, 2, …); không gộp nhiều vòng vào một file; rerun cùng round sau khi bị cancel → **ghi đè** (không tạo file trùng).
- Trước khi set status `done`: kiểm tra report tồn tại bằng slug/path. Không có report → **KHÔNG đóng việc**.

### Check commands
Lấy từ `.context/project-config.md` → các field `lint_command`, `typecheck_command`,
`test_command`, `build_command` (mobile dùng alias generic; field `web_*`/`api_*` để null). `check_commands` chỉ là alias tổng hợp
từ các field trên nếu project đã điền.
Ví dụ placeholder (thay bằng lệnh thật khi repo có app code):
```
lint       → <configured command or skip, no app configured>
typecheck  → <configured command or skip, no app configured>
test       → <configured command or skip, no app configured>
build      → <configured command or skip, no app configured>
```
Nếu chưa cấu hình package manager/test command hoặc chưa có app code → **skip, no app configured**,
không fail workflow và không tự hardcode lệnh.

### Reviewer level (risk-based)
- Reviewer tự chọn `FAST` / `NORMAL` / `STRICT`; mặc định `NORMAL`.
- `FAST` chỉ dùng khi scope rất hẹp, không shared/API/auth/tenant/schema, Builder đã test PASS.
- Bắt buộc `STRICT` nếu có risk đỏ: auth/RBAC/permission; tenant/school/org isolation;
  schema/migration/database; data loss/destructive/bulk update; API contract/DTO/response shape dùng nhiều màn/client;
  shared service/hook/component/API client/cache key/navigation; payment/subscription/entitlement;
  import/export/report; cron/background job/webhook; security/token/session/password/upload/file access;
  root cause chưa rõ; logic quan trọng thiếu test.
- Report bắt buộc có: `Review level`, `Reason`, `Blast radius`, `Verify commands + result`,
  `Findings`, `Verdict PASS/FAIL`.

## 7. Model mapping + luật opt-in

### Cách bật model mapping (bắt buộc khi clone template)
1. Khai model từng vai ở `.context/project-config.md` → block `models:`
   (`builder`, `builder_strong`, `reviewer`, `spec_validator`).
2. **Bỏ comment** dòng `model:` trong frontmatter `.opencode/agent/*.md` (hiện đang comment
   `<provider>/<...>` để kế thừa).
3. **Restart opencode** — agent/config **không hot-reload**; chưa restart thì model mới chưa có hiệu lực.
4. Kiểm: `builder ≠ reviewer` (khác họ provider) để lộ blind spot khác nhau; `spec-validator` họ thứ 3 nếu có.

- Nếu **chưa** cấu hình, frontmatter để comment → subagent **kế thừa model chính**
  (builder == reviewer, mất tác dụng tránh bias). Khi cần, chạy lại `0.5.C` rồi restart.
- `reviewer` / `spec-validator` không được sửa source; chỉ được ghi report scoped khi đang review.
- Chạy dạng **subagent** → context sạch, không thừa hưởng completion report của builder.
- **`explore` (built-in)**: subagent kế thừa model/variant của session cha. Nếu cha chạy variant `high`,
  `explore` cũng tốn variant `high` → set override `agent.explore` trong `opencode.jsonc`
  (`model` rẻ hơn + `variant: low`) để tránh đốt reasoning token. Đi kèm rule chống spawn `explore`
  thừa ở `AGENTS.md` § Tool Loop Guard.

### Luật opt-in `builder-strong`
- **CHỈ dùng khi user yêu cầu rõ.** Không tự chọn theo phán đoán "bài này khó".
- Bị chặn cứng ở `opencode.jsonc` → `permission.task."builder-strong": "ask"`.
- ⚠️ Auto-mode (`--auto` / auto-approve) sẽ tự duyệt `ask` → mất gate. Muốn giữ gate, không bật auto.
