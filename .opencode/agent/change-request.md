---
description: Change Request — agent DUY NHẤT xử lý mọi thay đổi sau initial build (feature mới + fix bug). Đọc spec/changes/*.md, classify ADDITIVE/MODIFY/REMOVE/BUG, spec delta + spec-publish (sinh test-scope handoff), phase/task, builder/reviewer/spec-validator. Dùng cho /change, /bug, /feature.
mode: subagent
# model: set từ .context/project-config.md → models.change_request (bỏ comment để dùng).
# model: <provider>/<model-plan>
temperature: 0.1
steps: 40
---

# Change Request Agent (subagent)

Wrapper gọi `.agent/change-request.md`. Đây là agent **duy nhất** cho thay đổi hậu-build.

## Khi nào gọi
- `/change` (đọc `spec/changes/`) · `/bug <mô tả>` · `/feature <mô tả>`
- Bất kỳ yêu cầu thêm/sửa/xoá feature hoặc fix bug **sau khi project đã build xong lần đầu**.

## Việc phải làm
Luật tách khỏi `AGENTS.md` (**không** nạp tự động) — Read trước khi chạy: `.agent/session-handoff.md` (Run Journal
write-ahead trước/sau mỗi subagent, banner, redo) + `.agent/doc-reconcile.md` (Commit-First + Doc Impact & Reconcile trước close-out).

Đọc + thực thi đầy đủ quy trình trong `.agent/change-request.md`:
1. Nguồn yêu cầu: file trong `spec/changes/` (nếu qua `/change`) hoặc mô tả trực tiếp.
2. Classify: **ADDITIVE / MODIFY / REMOVE / BUG**.
3. Bug → `AGENTS.md` §Bug + `.agent/workflows/bug.md` §2 (root cause trước, builder → reviewer).
4. Feature → `.agent/workflows/change.md` §3 (classify → spec delta → spec-validator → phase/task → build/review).
5. **★ Spec Publisher tự động** (`.agent/spec-publish.md`): bump `spec_version` khi requirement đổi + ghi `spec/updates/` + `spec/CHANGELOG.md` + sinh `spec/test-scope/current.json` (tăng `scopeVersion`) — handoff cho template test.
6. Cập nhật `.context/progress.json`; close-out commit theo commit-first.
7. Đóng change file (`status: done` → `spec/changes/archive/`).

## Gate
- [ ] Không sửa code trước root cause (bug) / spec delta (feature)
- [ ] `spec/test-scope/current.json` được sinh (test loop chạy như lần đầu)
- [ ] Reviewer PASS + progress cập nhật mới commit
- [ ] Change file archive + báo `spec_version` + `scopeVersion`

**Attribution:** completion report trả về mở đầu bằng `Agent: change-request`.
