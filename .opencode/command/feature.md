---
description: Thêm/sửa/bỏ tính năng theo Change Request workflow (classify → spec delta → phase/task → build/review/validate).
---

> ⭐ **Sau initial build, mọi thay đổi feature đi qua agent `change-request` (class ADDITIVE/MODIFY/REMOVE).** `/feature` là cửa vào → nạp workflow này vào agent `change-request` (xem `.agent/change-request.md`). `/change` là cửa vào tương đương cho change có sẵn trong `spec/changes/`.

Chạy Change Request workflow trong `AGENTS.md` và `.agent/workflows/change.md` (§3) cho:

`$ARGUMENTS`

Nếu `$ARGUMENTS` là **làm tiếp phase N của feature đang có** (vd "tiếp phase 3", "continue phase 3 feature-x"):
→ **KHÔNG** classify lại / tạo phase plan mới. Đọc `.context/progress.json` + Run Journal
`.context/runs/feature-<slug>-phase-<N>-*.md`, rồi chạy Session Start Protocol
(`.agent/session-handoff.md`) — tương đương `/resume feature/<slug>`.
Khi ở nhánh continue: **bỏ qua rule 1 (classify), 5 (chia phase/task), 6 (trình phase plan)** — chỉ áp dụng
các rule còn lại cho phase đang dở.

Quy tắc bắt buộc:
1. Classify ADDITIVE / MODIFY / REMOVE trước khi code.
2. Requirement mơ hồ → hỏi lại, không tự chọn giả định lớn.
3. Cập nhật spec delta (hoặc ghi rõ lý do không cần).
4. Chạy `spec-validator` sau spec delta và trước khi chia phase/task; FAIL → dừng làm rõ, không code.
   Ghi report `.context/review-reports/feature-<slug>-spec-validation.md` làm bằng chứng PASS trước khi lập plan.
5. Chia phase/task (`tasks/feature-<slug>/phase-<N>-task-<NN>.md`) khi nhiều bước hoặc có risk.
   Task phải có `Classification / Risk`: change type, scope, expected review level, blast radius,
   doc impact, decision impact.
6. Trình phase plan → chờ user duyệt mới code.
7. Mỗi task: Builder code + test → Reviewer độc lập; hết phase → Spec Validator cross-check gap.
   Nếu test/check fail, acceptance criteria chưa đạt, hoặc Reviewer/Spec Validator FAIL → **chưa xong**;
   quay lại Builder cập nhật trong cùng task cho tới khi PASS hoặc ghi `BLOCKED` với lý do thật.
8. Mỗi task/phase bắt buộc có verification summary:
   - Acceptance criteria: PASS | FAIL | BLOCKED
   - Verify commands: `<configured command>` hoặc `skip, no app configured`
   - Reviewer verdict: PASS | FAIL
   - Spec Validator verdict (khi hết phase): PASS | FAIL
9. **Không set task/feature/phase `done`** nếu verify/test/review/spec status là `FAIL`, `BLOCKED`, hoặc unknown.
10. Retry / Escalation Policy:
   - Attempt 1 fail: áp dụng quy trình trong `.agent/error-analyzer.md` (phần không bị maintenance override), xác định lại root cause, fix tối thiểu.
   - Attempt 2 fail: dừng patch triệu chứng; so với pattern code đang hoạt động và kiểm tra lại assumption.
   - Attempt 3 fail: **KHÔNG thử fix #4**. Set status `architecture_review_needed`.
     Tạo Structural Review: data flow, ownership/scope boundary, API contract, permission/tenant/school filters,
     state/cache layer, mock/real data boundary, schema/domain mismatch.
   - Sau Structural Review: hỏi human hoặc tạo task refactor/design riêng trước khi sửa tiếp.
11. **Bắt buộc update `.context/progress.json`** (schema maintenance: `features[]`, `activeWorkItem`).
12. Sau Reviewer PASS + close-out + progress cập nhật, commit lên branch hiện tại theo commit-first rules
   trong `.agent/workflows/state-commit.md` §2.8. Branch model mặc định là **staging-direct**: current branch phải là
   `target_branch`, commit ở đó và push `git push origin <target_branch>` chỉ khi user yêu cầu rõ hoặc
   `auto_push_after_pass: true`. Nếu user yêu cầu feature branch thì push chính current branch
   (`git push origin <current-branch>`) và chỉ mở PR khi user yêu cầu rõ. Cấm push `forbidden_branch`, cấm `--force`/`-f`.
13. Mỗi failed attempt phải append `.context/error-memory.md` hoặc ghi rõ vì sao không có entry.
14. Nếu update làm đổi kiến trúc/ownership/scope boundary/API contract/mock-real boundary → append `.context/decisions.md`.
15. Verify commands lấy từ `.context/project-config.md`; nếu command chưa cấu hình hoặc chưa có app code → ghi `skip, no app configured`, không tự hardcode package manager/test command.
16. Trước khi báo xong/đóng task/phase phải chạy **Doc Impact & Reconcile** trong `.agent/doc-reconcile.md` + `.agent/FEATURE_WORKFLOW.md`:
    reconcile as-built docs nếu code đổi hoặc ghi rõ `no doc impact`. **Không** sửa intent docs để khớp code;
    code ≠ intent thì ghi gap register nếu có.
17. Nếu đầu vào là danh sách feature → tách mỗi feature thành task riêng, chốt ưu tiên, xử lý tuần tự.
