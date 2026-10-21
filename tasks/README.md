# Tasks Directory

> Task file format + rules. Workflow: `.agent/FEATURE_WORKFLOW.md` (qua agent `change-request`).

## Đường dẫn

| Loại | Đường dẫn | Dùng khi |
|------|-----------|----------|
| **Feature** | `tasks/feature-<slug>/phase-<N>-task-<NN>.md` | Thêm/sửa/xoá tính năng |
| **Bug** | `tasks/bug-<slug>/phase-<N>-task-<NN>.md` | Fix bug (scan.md cho `/bug-check`) |

> Phase model: 1 Schema/domain · 2 Backend/API · 3 UI · 4 Integration · 5 Test/UAT.

## Cấu trúc (maintenance)

```
tasks/
├── README.md
├── feature-<slug>/
│   ├── phase-1-task-01.md
│   ├── phase-2-task-01.md
│   └── phase-2-task-02.md
└── bug-<slug>/
    ├── scan.md            ← output của /bug-check (READ-ONLY, danh sách defect)
    └── phase-1-task-01.md
```

## Task file format

```markdown
# Task <NN>: <Title>

## Type
feature (<ADDITIVE|MODIFY|REMOVE>) | bug

## Classification / Risk
- Work item type: BUG | FEATURE | UPDATE
- Bug severity: blocker | high | medium | low | n/a
- Feature change type: ADDITIVE | MODIFY | REMOVE | n/a
- Scope: SINGLE_SURFACE | CROSS_CUTTING | SHARED_FOUNDATION
- Root cause category: PERMISSION_SCOPE | TENANT_SCHOOL_BOUNDARY | API_CONTRACT | MOCK_REAL_DATA_BOUNDARY | STATE_CACHE | SCHEMA_DOMAIN | UI_LOGIC | CONFIG_ENV | RACE_TIMING | UNKNOWN | n/a
- Review level expected: FAST | NORMAL | STRICT
- Blast radius: <files/modules/API/client/data affected>
- Doc impact: API_SPEC | ERD | DESIGN | GAPS | NO_DOC_IMPACT
- Decision impact: YES | NO — if YES, append `.context/decisions.md`

## Phase
<N>   # 1 Schema/domain · 2 Backend/API · 3 UI · 4 Integration · 5 Test/UAT

## Description
{Mục tiêu rõ ràng, ngắn gọn}

## Root cause (bug only)
{Triệu chứng → nguyên nhân gốc + evidence; KHÔNG fix khi chưa có}

## Dependencies
- task-<XX> (lý do)

## Spec refs
- `<ID trong heading spec, vd F10 | REQ-AUTH-02 | §3.2>`
- `<path#heading text, vd .context/design-spec.md#Login screen>`

## Acceptance Criteria
- [ ] Tiêu chí đo được, testable
- [ ] ...

## Verification Plan
- Commands: <from `.context/project-config.md` or `skip, no app configured`>
- Manual/UAT evidence: <if needed>
- Reviewer report path: `.context/review-reports/<feature|bug>-<slug>-phase-<N>-task-<NN>-round-<R>-review.md`

## Retry / Error Memory
- Attempt: 0 | 1 | 2 | 3
- Last failure type: test_failure | lint_error | build_error | review_fail | runtime_error | n/a
- Error memory entry: `.context/error-memory.md#entry-...` | none
- Escalation: none | error_analyzer | architecture_review_needed | blocked

## Repro Verification (bug only)
- Original repro:
- Expected:
- Actual before fix:
- Actual after fix:
- Evidence:
- Status: PASS | FAIL | BLOCKED

## Feature Verification (feature/update only)
- Acceptance criteria: PASS | FAIL | BLOCKED
- Verify commands + result:
- Reviewer verdict: PASS | FAIL
- Spec Validator verdict (phase close): PASS | FAIL | n/a

## Doc / Decision Impact
- Doc impact result: <updated docs or `no doc impact`; worktree song song → doc delta (endpoint/shape/schema/flow + `file:line`), dispatcher reconcile khi merge layer>
- Decision log: `.context/decisions.md#...` | none

## Commit / Tracking
- Commit: pending until close-out commit (SHA lives in git history; do not amend/backfill just to fill this)
- Commit source of truth: changed files, timestamp, SHA, rollback point
- Task source of truth: root cause, repro/evidence, residual risk, doc impact/reconcile, verification summary
- Progress source of truth: `.context/progress.json` current status, active/completed phase/task, reviewer result/report path

## DoD (Definition of Done)
- [ ] Code written (chỉ trong scope)
- [ ] Tests added + pass (bug: test tái hiện fail trước fix)
- [ ] Check commands pass (theo `.context/project-config.md`)
- [ ] Reviewer độc lập PASS (`.opencode/agent/reviewer.md`)
- [ ] `.context/progress.json` updated
- [ ] Error Memory updated for every failed attempt, or `n/a` recorded
- [ ] Doc Impact reconciled (worktree song song: doc delta recorded here, dispatcher reconciles shared docs at layer merge), or `no doc impact` recorded
- [ ] Decision log updated if `Decision impact: YES`
- [ ] Commit created after PASS close-out (1 task = 1 commit, unless reason recorded; SHA tracked by git)

## Files to Create/Modify
- `<path>`

## Notes
{Edge cases, gotchas, giả định đã nêu}
```

> **`## Spec refs` (bắt buộc điền):** requirement/section spec mà task cần — mỗi bullet 1 ref, bọc backtick
> (ghi chú thêm đặt sau backtick):
> - ID/token có trong **heading** của `SPECIFICATIONS.md` / `.context/design-spec.md` (vd `F10`, `REQ-AUTH-02`, `§3.2`), hoặc
> - `path#heading text` khi cần chỉ đúng 1 file (vd `.context/design-spec.md#Login screen`).
>
> Dispatcher chạy `node scripts/spec-extract.mjs --task <task file>` → trích đúng các section đó ra
> `.context/task-context/<task-slug>.md`; builder/reviewer đọc file trích **thay vì** cả spec. Ref phải khớp heading
> thật (không phân biệt hoa thường, theo token: `F1` ≠ `F10`) — không khớp sẽ vào mục "Không tìm thấy". Chọn heading
> **hẹp nhất** đủ cho task (section con, không phải cả chương). Task không cần spec (vd chore/config thuần) → `- n/a`.

## Rules

1. Task sinh bởi **Change Request workflow** hoặc **Bug workflow** (`.agent/FEATURE_WORKFLOW.md`).
2. **Mỗi bug / mỗi feature tách task riêng** — không gộp nhiều bug/feature vào 1 task/diff
   (trừ khi cùng root cause / cùng scope — ghi rõ lý do).
3. Chốt **thứ tự ưu tiên với user**, xử lý **tuần tự**.
4. Task nhỏ, focused (1–3 files). Acceptance criteria **testable**, không mơ hồ.
5. Không nhảy phase: schema → API → UI → integration → UAT.
6. Không sửa tay task sau khi đã chạy — tạo task mới nếu cần. **WIP/checkpoint ghi ở
   `.context/runs/<type>-<slug>-<phaseTask>.md`** (xem `AGENTS.md` § Session Handoff), không nhét vào task file.
7. `tasks/bug-<slug>/scan.md` sinh bởi `/bug-check` là **read-only report** — không sửa code,
   không phải task; user chọn defect xong mới tạo task `/bug` cho từng defect.
8. Mọi task bug/feature/update phải có `Classification / Risk`, `Retry / Error Memory`,
   `Verification`, và `Doc / Decision Impact` trước khi Builder bắt đầu.
9. Bug 1 dòng được `/bug` cho phép sửa không tạo task thì commit body bắt buộc có trailer
   `Repro-Verification: <short evidence of root cause + expected/actual>`.
