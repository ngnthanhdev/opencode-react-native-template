---
description: Điều tra và sửa bug đã biết; list bug phải qua checkpoint trước khi gọi Builder.
---

> ⭐ **Sau initial build, mọi fix bug đi qua agent `change-request` (class BUG).** `/bug` là cửa vào → nạp loop này vào agent `change-request` (xem `.agent/change-request.md`). `/change` là cửa vào tương đương cho change có sẵn trong `spec/changes/`.

Chạy Bug workflow trong `AGENTS.md` và `.agent/workflows/bug.md` (§2) cho bug:

`$ARGUMENTS`

Nếu đầu vào là khu vực mơ hồ / nhiều nghi vấn (chưa rõ bug nào) → **dừng**, yêu cầu chạy
`/bug-check` trước. `/bug` xử lý một bug đã biết, hoặc list bug đã được user xác nhận.

## Nếu input là list bug hoặc kết quả `/bug-check`

Áp dụng cả khi user nói "fix tất cả defect":
1. **KHÔNG gọi Builder ngay.**
2. Tách từng bug thành task riêng (`tasks/bug-<slug>/...`).
3. Tóm tắt số lượng defect, severity, root cause nghi ngờ và file cần sửa.
4. Đề xuất thứ tự xử lý; nêu rõ bug nào được gộp vì **cùng root cause**.
5. **DỪNG hỏi user xác nhận** trước khi xử lý/gọi Builder.

Chỉ bỏ checkpoint nếu prompt có đúng một trong các cụm: `auto proceed`, `khỏi hỏi lại`,
`tự xử lý hết không cần hỏi`.

Sau khi user xác nhận thứ tự xử lý, `/bug` phải xử lý **từng bug theo vòng fix-loop** bên dưới.
Không được chuyển sang Bug discovery/read-only trừ khi input thực sự chỉ là khu vực mơ hồ chưa có bug cụ thể.

## Fix-loop bắt buộc cho từng bug

Một bug chỉ được coi là xong khi **original repro không còn tái hiện** và Reviewer PASS.

1. Ghi rõ repro gốc trước khi sửa:
   - màn/route/role/dữ liệu liên quan
   - bước tái hiện
   - expected
   - actual before fix
2. Diagnose root cause bằng code evidence (`file:line`) trước khi sửa.
3. Builder sửa đúng scope + thêm/sửa test hoặc verification phù hợp.
4. Verify lại **đúng original repro** sau fix:
   - actual after fix
   - evidence: test/check/manual reasoning kèm file/line nếu không chạy được app
   - status: `PASS` | `FAIL` | `BLOCKED`
   - với bug race/intermittent/timing: evidence hợp lệ là test deterministic (concurrency/timing) chứng minh FAIL trước fix và PASS sau fix; không bắt buộc tái hiện y hệt bằng tay. Nếu không thể làm deterministic → status `BLOCKED` + residual risk, không tự đóng.
5. Nếu status là `FAIL` hoặc bug vẫn tái hiện → task **chưa hoàn thành**; quay lại bước diagnose/fix trong cùng task.
6. Nếu status là `BLOCKED` → không báo đã fix; ghi blocker + residual risk + info cần user cung cấp.
7. Reviewer phải kiểm tra lại repro evidence. Reviewer FAIL → quay lại Builder, không update `done`, không commit/push.

## Retry / Escalation Policy

- Attempt 1 fail: áp dụng quy trình trong `.agent/error-analyzer.md` (phần không bị maintenance override), xác định lại root cause, fix tối thiểu.
- Attempt 2 fail: dừng patch triệu chứng; so với pattern code đang hoạt động và kiểm tra lại assumption.
- Attempt 3 fail: **KHÔNG thử fix #4**. Set trạng thái `architecture_review_needed`.
  Tạo Structural Review trong task/report, gồm:
  - data flow
  - ownership/scope boundary
  - API contract
  - permission/tenant/school filters
  - state/cache layer
  - mock/real data boundary
  - schema/domain mismatch
- Sau Structural Review: hỏi human hoặc tạo task refactor/design riêng trước khi sửa tiếp.

Template bắt buộc trong task/report bug:

```markdown
## Repro Verification
- Original repro:
- Expected:
- Actual before fix:
- Actual after fix:
- Evidence:
- Status: PASS | FAIL | BLOCKED
```

Quy tắc bắt buộc:
1. Không sửa code trước khi có root cause.
2. Thiếu info (màn hình / bước tái hiện / expected-actual / role) → hỏi ngắn trước.
3. Tạo/cập nhật task nếu không phải fix 1 dòng (`tasks/bug-<slug>/...`). Nếu là fix 1 dòng không tạo task,
   commit body bắt buộc có trailer `Repro-Verification: <short evidence of root cause + expected/actual>`.
   Task phải có `Classification / Risk`: severity, scope, root cause category, expected review level,
   blast radius, doc impact, decision impact.
4. Builder code + test; Reviewer kiểm tra độc lập (không sửa source; chỉ ghi report scoped).
5. **Bắt buộc update `.context/progress.json`** (schema maintenance tối thiểu) khi bug đổi trạng thái
   (`bugs[]`, `activeWorkItem`). `done` chỉ khi repro status `PASS` **và** reviewer PASS.
6. **Bắt buộc Run Journal** (bug có task, `tasks/bug-<slug>/...` — xem `.agent/session-handoff.md`):
   tạo `.context/runs/bug-<slug>-<phaseTask>.md` từ `_TEMPLATE.md`. Write-ahead checkpoint: TRƯỚC khi gọi
   Builder/Reviewer ghi `step`/`status: running` + in `▶ START`; SAU khi subagent trả về ghi `evidence`/`next`
   + in `✅ DONE`. `interrupted ≠ failed` (bị cắt ngang → redo step, KHÔNG tăng `attempt`).
   Primary ghi journal, subagent **KHÔNG** ghi.
7. **Close-out gate:** chỉ đóng bug (progress `done` + commit) khi journal đã có trail `▶ START`/`✅ DONE`,
   `step: done`, và `evidence.reportPath` + `verdict` khớp report thật trong `.context/review-reports/`.
   Thiếu trail → **chưa đóng**, không commit.
8. Sau Reviewer PASS + close-out + progress cập nhật, commit lên branch hiện tại theo commit-first rules
   trong `.agent/workflows/state-commit.md` §2.8.
9. Branch model mặc định là **staging-direct**: current branch phải là `target_branch`, commit ở đó và push
   `git push origin <target_branch>` chỉ khi user yêu cầu rõ hoặc `auto_push_after_pass: true`. Nếu user yêu cầu
   feature branch thì push chính current branch (`git push origin <current-branch>`) và chỉ mở PR khi user yêu cầu rõ.
   Cấm push `forbidden_branch`, cấm `--force`/`-f`.
   Reviewer FAIL hoặc progress chưa xong → **không** commit/push.
10. Nếu có code/config/docs/schema change → update progress nếu trạng thái bug đổi; nếu chỉ triage/checkpoint chưa sửa gì
   hoặc repro status `FAIL/BLOCKED/unknown` thì không ghi done.
11. Mỗi failed attempt phải append `.context/error-memory.md` hoặc ghi rõ vì sao không có entry.
12. Nếu fix làm đổi kiến trúc/ownership/scope boundary/API contract/mock-real boundary → append `.context/decisions.md`.
13. Verify commands lấy từ `.context/project-config.md`; nếu command chưa cấu hình hoặc chưa có app code → ghi `skip, no app configured`, không tự hardcode package manager/test command.
14. Trước khi báo xong/đóng bug phải chạy **Doc Impact & Reconcile** trong `.agent/doc-reconcile.md` + `.agent/FEATURE_WORKFLOW.md`:
    reconcile as-built docs nếu code đổi hoặc ghi rõ `no doc impact`. **Không** sửa intent docs để khớp code;
    code ≠ intent thì ghi gap register nếu có.
