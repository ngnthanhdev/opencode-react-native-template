# /change — Xử lý change request sau initial build (agent `change-request`)

> **MỌI thay đổi — feature mới (thêm/sửa/xoá) + fix bug — đi qua MỘT agent duy nhất: `change-request`.**
> `/change` là cửa vào: đọc hết file trong `spec/changes/` rồi gọi agent.

## Cách dùng
```
/change                 → đọc TẤT CẢ file pending trong spec/changes/ → gọi agent change-request
/change <slug|file>     → xử lý 1 change request
/change --list          → liệt kê change request đang chờ (đọc từ spec/changes/BACKLOG.md)
/change --init          → tạo spec/changes/ + _TEMPLATE.md nếu chưa có
```

## Auto-intake (backlog)
- **Yêu cầu/bug user chat trong maintenance mode** (không gõ lệnh) → **KHÔNG code ngay**: tạo dòng trong `spec/changes/BACKLOG.md` (status `pending`) + copy `_TEMPLATE.md` thành `spec/changes/YYYY-MM-DD-<slug>.md` (điền yêu cầu + acceptance từ lời user; thiếu → hỏi ngắn 1 lần, không bịa). Báo user: "✅ Đã ghi backlog: <tiêu đề> — gõ `/change` để xử lý".
- `/change --list` → đọc `BACKLOG.md`, liệt kê cột Trạng thái (cái nào `done`/chưa).
- Xử lý xong 1 change (status `done` + chuyển `archive/`) → **cập nhật dòng tương ứng** trong `BACKLOG.md`: `in_progress` (khi bắt đầu) → `done` + ngày xong. Không xoá dòng done.

## Flow
1. **Đọc hết** `spec/changes/*.md` (bỏ `_TEMPLATE.md`, bỏ `BACKLOG.md` — file tracking, không phải change, bỏ file `status != pending`, bỏ `archive/`).
   - Không có file pending → báo "không có change nào chờ" và dừng.
2. **Validate** từng file: có yêu cầu + acceptance. Thiếu → hỏi user, KHÔNG tự bịa requirement.
3. **Gọi subagent `change-request`** cho từng change (gộp nếu cùng mục tiêu/scope — ghi rõ lý do). Agent:
   - **Classify**: ADDITIVE / MODIFY / REMOVE / BUG
   - **Bug** → bug workflow (`AGENTS.md` §Bug + `.agent/workflows/bug.md` §2): root cause → task → builder → reviewer
   - **Feature** → change request workflow (`.agent/workflows/change.md` §3): spec delta → phase/task → builder/reviewer/spec-validator
   - **★ Spec Publisher (tự động)**: bump `spec_version` (nếu requirement đổi) + `spec/updates/` + `spec/CHANGELOG.md` + sinh `spec/test-scope/current.json` (handoff cho template test)
   - Progress (`.context/progress.json`) + close-out commit theo commit-first (`.agent/doc-reconcile.md`)
4. **Đóng change file**: set `status: done` → chuyển sang `spec/changes/archive/`.
5. **Báo cáo**: change nào xong / đang chờ / blocked, kèm `spec_version` + `scopeVersion`.

## Rule
- Là **cửa vào DUY NHẤT cho thay đổi hậu-build** (ngoài `/bug-check` — chỉ soi read-only, không sửa).
- **Không** tự bịa requirement; file thiếu acceptance → hỏi.
- **Test loop không đổi**: vẫn sinh `spec/test-scope/current.json` để bên test chạy `/autotest` (tạo test case mới) / `/retest` (chạy lại).
- Human checkpoint: duyệt phase plan trước khi code (trừ khi user ghi `auto proceed` / `khỏi hỏi lại` / `tự xử lý hết`).
- `/bug` và `/feature` là cửa vào tương đương — cùng gọi agent `change-request`.
