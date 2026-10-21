# Change Request workflow (chi tiết) — đọc khi xử lý `/feature` hoặc `/change` class ADDITIVE/MODIFY/REMOVE

> Tách từ `.agent/FEATURE_WORKFLOW.md` §3. Luật tối thiểu/Router vẫn ở `FEATURE_WORKFLOW.md`.
> Precedence: `AGENTS.md` > `FEATURE_WORKFLOW.md` > file này. Commit convention chung ở `.agent/workflows/state-commit.md` §2.8.

## 3. Change Request workflow (feature / update)

> ⭐ Agent thực thi: **`change-request`** (class ADDITIVE/MODIFY/REMOVE) — cửa vào `/feature` hoặc `/change` (đọc `spec/changes/`).

```
Classify → Spec delta → Spec Validator → Phase/Task → Human duyệt plan
   → Loop(builder/reviewer) → Phase Review → Doc Impact/Reconcile → Progress
   → commit current branch (= target_branch mặc định) → (push current branch nếu được phép)
```

### 3.1 Classify
- **ADDITIVE** (thêm mới) / **MODIFY** (đổi behavior) / **REMOVE** (bỏ).
- Requirement mơ hồ → hỏi lại. Không tự chọn giả định lớn.

### 3.2 Spec delta
- Ghi rõ thay đổi so với `SPECIFICATIONS.md` (thêm/sửa/xóa mục nào, API/DB/UI bị ảnh hưởng).
- Nếu thay đổi behavior/scope → **cập nhật spec** hoặc ghi rõ lý do không cần.
- Liệt kê ảnh hưởng tới phase/task đã có (regression risk).

### 3.2b Cập nhật spec + version (khi spec delta)
- Nếu thay đổi behavior/scope: sửa `SPECIFICATIONS.md` → **bump `spec_version`** (semver: MAJOR breaking / MINOR thêm req / PATCH làm rõ) → thêm dòng vào `spec/CHANGELOG.md` → ghi delta vào `spec/updates/YYYY-MM-DD-<slug>.md`. Mốc release → copy vào `spec/archive/SPECIFICATIONS-<version>.md`. Chi tiết: `docs/SPEC_VERSIONING.md`.

### 3.3 Spec Validator
- Gọi subagent `spec-validator` (không sửa source; chỉ được ghi report scoped) cross-check delta vs spec & docs.
- Ghi report pre-plan: `.context/review-reports/feature-<slug>-spec-validation.md`.
- FAIL → quay lại làm rõ. PASS → chia phase/task.

### 3.4 Phase / Task
- Chia theo **Phase model** (`FEATURE_WORKFLOW.md` §4), mỗi task: scope, inputs, outputs, acceptance criteria, deps.
- File: `tasks/feature-<slug>/phase-<N>-task-<NN>.md`.
- Task feature/update bắt buộc ghi `Classification / Risk`: change type, scope, expected review level,
  blast radius, doc impact, decision impact.

### 3.5 Human duyệt plan
- Trình danh sách phase + task + thứ tự. **Chờ user duyệt** mới code.

### 3.6 Loop
- Mỗi task: builder implement+test → reviewer độc lập. FAIL → trả lại builder kèm path report (max 2 vòng); vòng sau reviewer chỉ delta review (`.agent/loop.md` mục 6).
- Test/check fail, acceptance criteria chưa đạt, hoặc behavior sau update chưa khớp spec delta → **chưa xong**;
  quay lại builder cập nhật trong cùng task. Không được báo done chỉ vì đã edit code.
- Retry / Escalation Policy:
  - Attempt 1 fail: áp dụng quy trình trong `.agent/error-analyzer.md` (phần không bị maintenance override), xác định lại root cause, fix tối thiểu.
  - Attempt 2 fail: dừng patch triệu chứng; so với pattern code đang hoạt động và kiểm tra lại assumption.
  - Attempt 3 fail: **KHÔNG thử fix #4**. Set status `architecture_review_needed`, ghi rõ
    blocker/residual risk/verify evidence, hỏi human thay vì tự đóng.
  - Structural Review bắt buộc gồm: data flow, ownership/scope boundary, API contract,
    permission/tenant/school filters, state/cache layer, mock/real data boundary, schema/domain mismatch.
- Mỗi failed attempt phải append `.context/error-memory.md` hoặc ghi rõ vì sao không có entry.
- Nếu fix/update đổi kiến trúc, ownership/scope boundary, API contract, hoặc mock/real data boundary
  → append `.context/decisions.md`.
- Task report bắt buộc có verification summary:
  `Acceptance criteria: PASS|FAIL|BLOCKED`, `Verify commands + result`, `Reviewer verdict`.
- **Không tự chạy task/phase tiếp theo** khi chưa qua checkpoint (`FEATURE_WORKFLOW.md` §8).

### 3.7 Phase Review
- Sau khi cả phase PASS: `spec-validator` cross-check "đã build đúng & đủ so với spec delta".
- PASS → xác định Doc Impact & Reconcile (`FEATURE_WORKFLOW.md` §6) trước khi phase done/checkpoint; không impact → ghi `no doc impact`.
  GAP/FAIL → quay lại bổ sung trong task/phase liên quan; không set phase `done`.

### 3.8 Nhánh "đầu vào là danh sách feature"
- Tách **mỗi feature thành task/feature riêng**, chốt ưu tiên, xử lý **tuần tự**.
- Gộp chỉ khi cùng mục tiêu/scope (1 feature nhiều phase).

### 3.9 Progress (bắt buộc)
- Update `.context/progress.json`: thêm/cập nhật entry trong `features[]`, set `activeWorkItem`.
- Trước khi set feature/phase/task `done`, phải có acceptance PASS, verify commands PASS/skip có lý do,
  Reviewer PASS, Spec Validator PASS khi hết phase, và hoàn tất Doc Impact & Reconcile (`FEATURE_WORKFLOW.md` §6) hoặc ghi `no doc impact`.
  Trạng thái `done`/progress/doc-impact này phải nằm trong close-out commit; progress/task file không cần biết SHA của commit đang được tạo.
- Nếu test/check/review/spec status là `FAIL`, `BLOCKED`, hoặc unknown → không set `done`.
- Commit/push: xem `.agent/workflows/state-commit.md` §2.8 (commit-first sau PASS; default staging-direct push `target_branch`, feature branch chỉ khi user yêu cầu).

### 3.9b Test scope (handoff sang template test) — bắt buộc khi update feature
- Sau khi task/phase PASS, sinh/cập nhật **`spec/test-scope/current.json`** (hợp đồng bàn giao cho template AUTOTEST):
  - `trigger: feature-update`, `workItem`, `specRefs` (spec delta), `changed.files/modules`
  - `impact.direct` / `impact.dependents` / `impact.regression`, `acceptance`, `risk`
  - **`specVersion`** (= version hiện tại của `SPECIFICATIONS.md` sau bump ở §3.2b) + **`scopeVersion`** (tăng 1 mỗi lần sinh)
- Mục đích: template test chạy `/autotest` (tạo test case theo spec/scope mới → user chốt → chạy ngầm + browser) và `/retest` (chạy lại đã test). **Độ phủ do template test tự lưu** — DEV chỉ cung cấp spec + scope.
