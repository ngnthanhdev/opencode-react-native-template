# /spec-publish — Phát hành spec cho template test (thủ công / chạy lại)

Chạy quy trình `.agent/spec-publish.md` để bump version + sinh scope bàn giao cho test.

## Cách dùng
```
/spec-publish                 → chạy theo thay đổi gần nhất (đọc diff/context)
/spec-publish --feature <slug> → phát hành cho feature <slug>
/spec-publish --bug <slug>     → phát hành cho bug <slug>
/spec-publish --patch          → chỉ áp pendingSpecPatch (§0–§3, không sinh test-scope)
```

## Flow
0. Áp `pendingSpecPatch` (`spec-patch list` → sửa section spec → `spec-patch clear --ids ...`; không map được → `spec-patch note`) — `.agent/spec-publish.md` §0
1. Xác định requirement mới/đổi (specRefs) + vùng ảnh hưởng (direct/dependents/regression)
2. Bump `spec_version` nếu requirement đổi; ghi `spec/updates/YYYY-MM-DD-<slug>.md`
3. Thêm dòng `spec/CHANGELOG.md`
4. Sinh `spec/test-scope/current.json` (tăng `scopeVersion`)
5. Báo: "spec vX.Y.Z + scope vN đã phát hành"

> Command này thường được **gọi tự động** ở cuối bug/feature workflow — dùng thủ công khi cần chạy lại hoặc phát hành tay.