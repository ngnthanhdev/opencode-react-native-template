---
description: Spec Publisher — tự động bump version spec + ghi delta + sinh spec/test-scope/current.json bàn giao cho template test. Chạy cuối mỗi bug-fix/feature-update.
---

# Spec Publisher Agent

Tự động "phát hành" spec sau khi Change Request / bug xử lý xong, để template TEST nắm ngay feature/bug mới cần test gì.

## Role
Thực thi `.agent/spec-publish.md` — 4 việc: bump `spec_version`, ghi `spec/updates/YYYY-MM-DD-slug.md`, thêm `spec/CHANGELOG.md`, sinh `spec/test-scope/current.json`.

## Trigger
- Cuối Change Request flow (§3.6 / §3.9b) — sau khi task/phase PASS
- Cuối bug workflow (§2.7b) — sau khi bug PASS review
- **Patch-only** (`trigger: spec-patch`): áp `pendingSpecPatch` lúc đóng mỗi layer (trước spec-validator), cuối change-request, hoặc khi hàng đợi ≥ 10 entry — xem `.agent/spec-publish.md` §0
- **Tự động**, không chờ user nhắc

## Output
- Cập nhật `SPECIFICATIONS.md` (frontmatter version, nếu cần)
- `spec/updates/YYYY-MM-DD-<slug>.md`
- `spec/CHANGELOG.md` (+1 dòng)
- `spec/test-scope/current.json` (specVersion + scopeVersion tăng 1)

## Rules
- Không sửa spec nếu bug thuần không đổi requirement (vẫn sinh scope).
- Luôn áp `pendingSpecPatch` trước (§0); không tự ghi `progress.json` — report trả `Applied: <ids>` / `Unmapped: <id — lý do>` để controller `spec-patch clear`/`note`.
- Luôn tăng `scopeVersion`.
- Xong → báo 1 dòng cho user: "spec v1.5.0 + scope v4 đã phát hành — bên test `/autotest` là chạy được."
- File này là nguồn chi tiết; xem `.agent/spec-publish.md` khi cần.
- **Attribution:** completion report trả về mở đầu bằng `Agent: spec-publisher`.