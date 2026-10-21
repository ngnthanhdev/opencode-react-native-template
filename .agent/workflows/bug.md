# Bug workflow (chi tiết) — đọc khi xử lý `/bug` hoặc `/change` class BUG

> Tách từ `.agent/FEATURE_WORKFLOW.md` §2 + §2b. Luật tối thiểu/Router vẫn ở `FEATURE_WORKFLOW.md`.
> Precedence: `AGENTS.md` > `FEATURE_WORKFLOW.md` > file này. Commit convention chung ở `.agent/workflows/state-commit.md` §2.8.

## 2. Bug workflow

> ⭐ Agent thực thi: **`change-request`** (class BUG) — cửa vào `/bug` hoặc `/change`.

```
Triage → Reproduce → Root cause → Task → Builder → Reviewer PASS
   → Doc Impact/Reconcile → progress.json → commit current branch (= target_branch mặc định)
   → (push current branch nếu được phép)
```

### 2.1 Triage (bắt buộc trước khi sửa)
- Xác định: **màn hình/module**, **bước tái hiện**, **expected vs actual**, **role/vai trò**, **môi trường**.
- Thiếu bất kỳ mục nào → **hỏi ngắn 1 lần** (gom câu hỏi), KHÔNG tự giả định.
- Phân loại mức độ: `blocker` / `high` / `medium` / `low`.

### 2.2 Reproduce
- Dựng lại đúng điều kiện. Nếu không reproduce được → ghi nhận, hỏi thêm, **không sửa mò**.
- Chạy verify command thật từ `.context/project-config.md` (`lint_command`, `typecheck_command`,
  `test_command`, `build_command` — mobile dùng alias generic, không có split web/api).

### 2.3 Root cause (Iron Law)
- **KHÔNG fix khi chưa có root cause.** Đọc `skills/superpowers/systematic-debugging.md`.
- Ghi root cause + evidence (log/stack/trace) vào bug task.
- ≥3 lần fix fail → set status `architecture_review_needed`, nghi ngờ **kiến trúc**, dừng lại, báo human. Không thử fix #4.

### 2.4 Task
- Bug **1 dòng, rõ ràng, không risk** → có thể sửa trực tiếp (vẫn phải update progress nếu đổi trạng thái bug và ghi `Repro-Verification` trong commit body).
- Còn lại → tạo `tasks/bug-<slug>/phase-<N>-task-<NN>.md` (format `.agent/workflows/state-commit.md` §5).
- Task bug bắt buộc ghi `Classification / Risk`: severity (`blocker|high|medium|low`), scope,
  root cause category, expected review level, blast radius, doc impact, decision impact.

### 2.5 Builder → Reviewer
- Gọi subagent `builder` (hoặc `builder-strong` — xem `.agent/workflows/state-commit.md` §7) implement + test.
- Gọi subagent `reviewer` kiểm tra **độc lập** (không sửa source; chỉ ghi report scoped). FAIL → trả lại builder (kèm path report), **không** đóng bug; vòng sau reviewer chỉ delta review (`.agent/loop.md` mục 6).
- Regression: **phải có test tái hiện bug fail trước fix**, pass sau fix (test-first).
- **Chỉ khi reviewer PASS** mới đi tiếp bước 2.7–2.9. FAIL → không update progress là "done", không commit/push.

### 2.6 Nhánh "đầu vào là danh sách bug"
Áp dụng cả khi input đến từ `/bug-check` hoặc user nói "fix tất cả defect".

1. **KHÔNG gọi Builder ngay**.
2. **Tách mỗi bug thành task riêng** `tasks/bug-<slug>/`.
3. Tóm tắt số lượng defect, severity, root cause nghi ngờ, file cần sửa.
4. Đề xuất thứ tự xử lý (blocker/high trước), xử lý **tuần tự**.
5. Nêu rõ bug nào gộp vì **cùng root cause**; ngoài trường hợp đó không gộp nhiều bug vào 1 diff.
6. **DỪNG hỏi user xác nhận** trước khi gọi Builder.

Chỉ bỏ checkpoint nếu prompt có đúng một trong các cụm: `auto proceed`, `khỏi hỏi lại`,
`tự xử lý hết không cần hỏi`.

### 2.7 Progress (bắt buộc)
- Cập nhật `.context/progress.json` ngay khi bug đổi trạng thái:
  thêm/cập nhật entry trong `bugs[]` (`status: triaged → reproducing → root_caused → fixing → review → done|blocked|architecture_review_needed`),
  set `activeWorkItem`.
- Sau Reviewer PASS, xác định Doc Impact & Reconcile (`FEATURE_WORKFLOW.md` §6) trước khi đóng bug; không impact → ghi `no doc impact`.
- Set `done` sau khi reviewer PASS, Doc Impact/Reconcile đã xong hoặc ghi `no doc impact`, và report đúng tên tồn tại trong `.context/review-reports/` (`.agent/workflows/state-commit.md` §5). Trạng thái `done`/progress/doc-impact này phải nằm trong close-out commit; progress/task file không cần biết SHA của commit đang được tạo.

### 2.7b Test scope (handoff sang template test) — bắt buộc khi fix bug
- Sau khi bug PASS review, sinh/cập nhật **`spec/test-scope/current.json`** (hợp đồng bàn giao cho template AUTOTEST — schema + version scheme trong `docs/SPEC_VERSIONING.md`):
  - `trigger: bug-fix`, `workItem`, `specRefs` (requirement liên quan), `changed.files/modules`
  - `impact.direct` (hành vi vừa sửa), `impact.dependents` (module phụ thuộc), `impact.regression` (luồng cũ cần retest)
  - `acceptance` (tiêu chí nghiệm thu), `risk` (low/medium/high)
  - **`specVersion`** (= version hiện tại của `SPECIFICATIONS.md`) + **`scopeVersion`** (tăng 1 mỗi lần sinh)
- Nếu bug đổi ngữ nghĩa requirement → bump spec version + ghi delta trước (xem `.agent/workflows/change.md` §3.2b).
- Mục đích: template test đọc scope này để biết cần test gì. **Trạng thái "đã test đến đâu" do template test tự lưu** (trong repo test) — DEV không giữ.

### 2.8 Commit / push (commit-first)
→ Xem `.agent/workflows/state-commit.md` §2.8 (commit convention, branch model, trailer, push gate) — dùng chung cho cả bug và feature.

### 2.9 Nhánh "bug đã biết" = 1 bug
- `/bug` chỉ xử lý **một bug đã biết**. Nếu input là khu vực mơ hồ / danh sách nghi vấn
  → chạy `/bug-check` (§2b) trước, dừng chờ user chọn.

## 2b. Bug discovery (sweep) — `/bug-check`

Chế độ **READ-ONLY** để soi một màn/khu vực mơ hồ, KHÔNG sửa gì.

```
Xác định phạm vi → Đọc code/docs → Liệt kê defect (file:line)
   → ghi tasks/bug-<slug>/scan.md → DỪNG chờ user chọn defect → (user chạy /bug)
```

Quy tắc bắt buộc:
- **KHÔNG** sửa code, **KHÔNG** gọi `builder`/`builder-strong`, **KHÔNG** update `progress.json`,
  **KHÔNG** commit/push.
- Chỉ được tạo/ghi **một file**: `tasks/bug-<slug>/scan.md`.
- Phân loại trước khi soi: **SINGLE-SURFACE** (1 màn/luồng) hoặc **CROSS-CUTTING** (theme/dark mode,
  permission, i18n, tenant/campus, responsive, format tiền/ngày, a11y, loading/empty state).
- CROSS-CUTTING: bắt buộc enumerate toàn bộ surface ứng viên theo `source_roots` trong
  `.context/project-config.md`; **CẤM sampling**. Surface RN gồm screen `**/screens/**/*.tsx`,
  component dùng chung `**/components/**/*.tsx`, navigation `**/navigation/**/*.tsx`,
  theme/constants `**/theme/**`, `**/constants/**`.
- CROSS-CUTTING dùng query count-based: đếm match theo từng file; `count=0` vẫn ghi coverage là đã soi;
  `count>0` đọc đúng vùng match để xác nhận và loại trừ variant hợp lệ như `dark:` hoặc token đúng.
- Chia batch 15–25 file/batch; append `scan.md` sau **mỗi batch**.
- Không kết luận khi coverage chưa đủ. Chỉ dừng khi 100% surface đã enumerate hoặc `scan.md` có
  `## Chưa soi` nêu lý do + `% đã soi`.
- `scan.md` bắt buộc có `## Coverage` với enumerate / đã soi / % / mỗi file `soi | count | kết luận`,
  và bắt buộc có `## Chưa soi`.
- CRUD/capability: không đánh giá cấp module. Mỗi API collection/mutation
  (`GET/POST/PATCH/DELETE /module/resource`) là một dòng capability riêng với cột:
  `Module | Sub-resource/API | FE section/table | List | Create UI | Edit UI | Delete UI | Empty CTA | Evidence`.
- `Create UI = Có` chỉ khi đúng resource đó có nút/form; không suy từ resource khác cùng module.
- API có POST nhưng FE chỉ list, không có nút/form/empty CTA → DEFECT hoặc `[cần xác nhận]`.
- Empty state không chỉ cách tạo data nguồn → DATA_SETUP/UX_DEFECT.
- Report là bảng defect: `# | Mô tả | Tái hiện | Expected | Actual | Root cause (file:line) | Severity | File cần sửa | Ước lượng`.
- Kết thúc: chạy `git status --short`; nếu có file nào khác `scan.md` biến động → cảnh báo vi phạm read-only.
- Output xong → **dừng**, chờ user chọn defect (mỗi defect xử lý bằng `/bug`).
