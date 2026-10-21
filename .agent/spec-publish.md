# Spec Publisher — quy trình TỰ ĐỘNG phát hành spec cho template test

> **Mục đích:** sau khi Change Request (bug/feature) xử lý xong → **tự động** bump version spec + ghi delta + sinh `spec/test-scope/current.json` để template TEST nắm được ngay feature/bug mới cần test gì.
> **Bắt buộc:** chạy ở cuối MỌI bug-fix / feature-update **và initial build** (trước commit close-out). Không cần user nhắc.

## Khi nào chạy
- **Sau** Change Request Agent xử lý ADDITIVE/MODIFY/REMOVE (feature) — cuối §3.6/§3.9b
- **Sau** bug PASS review (bug workflow §2.7b)
- **Lần đầu initial build xong** (sau layer cuối, mọi task PASS): spec-init đã tạo bản nháp `trigger: initial-build` → spec-publisher CẬP NHẬT theo phạm vi thật đã build (`scopeVersion` +1, `risk` theo kết quả verify).
- Trigger tự động; đây là bước cuối trước commit close-out.

### Lịch áp `pendingSpecPatch` (`.context/progress.json`, schema: `.agent/blackboard.md`)
Mọi lần chạy spec-publisher đều làm §0 trước. Ngoài các trigger trên, controller gọi thêm spec-publisher
ở chế độ **patch-only** (`trigger: spec-patch` — chỉ §0–§3, **bỏ §4** test-scope) khi:
- **(a) Đóng mỗi layer** (initial build) — sau merge + verify tổng thể, **TRƯỚC** `spec-validator` của layer đó
  (validator check theo spec đã vá). Layer cuối → chạy luôn bản publish `initial-build` đầy đủ (gồm §0).
- **(b) Cuối mỗi change-request** — trước commit close-out, nếu còn entry phát sinh trong lúc build.
- **(c) Hàng đợi đạt 10 entry** — helper `spec-patch add` trả `applyNow: true` → chạy ở checkpoint kế tiếp
  (không chen ngang lúc subagent đang chạy).
- Hàng đợi rỗng (`spec-patch list` → `count: 0`) → bỏ qua §0; patch-only không có gì để làm thì không bump, không commit.

## 0. Áp `pendingSpecPatch` (nếu còn entry)
1. `node tools/task-dashboard/progress-write.mjs spec-patch list` (chỉ đọc) → lấy `entries` kèm `id`.
2. Mỗi entry: tìm section trong `SPECIFICATIONS.md` theo `specRef` (không có → theo nội dung `decision`) → **sửa
   section đó** cho đúng quyết định. Đây là đổi intent **owner đã duyệt** → hợp lệ (không phải hạ intent cho khớp code).
3. Phân loại từng entry theo `docs/SPEC_VERSIONING.md` (làm rõ = PATCH · thêm requirement/ràng buộc = MINOR ·
   đổi ngữ nghĩa/xoá = MAJOR) → bump `spec_version` **1 lần** theo mức cao nhất (§1).
4. Ghi các entry đã áp vào `spec/updates/YYYY-MM-DD-<slug>.md` (§2, mục **Owner decisions** kèm `id` + `specRef`)
   và dòng `spec/CHANGELOG.md` (§3).
5. Entry **không map được** section nào (hoặc mâu thuẫn spec hiện tại) → **không** đoán; để lại hàng đợi kèm lý do:
   `spec-patch note --id <id> --note "<lý do>"`.
6. Clear id đã áp: `spec-patch clear --ids <id,id,...>`. **Chỉ controller ghi `progress.json`** — chạy dưới dạng
   subagent thì spec-publisher **không** tự gọi `clear`/`note`, mà trả `Applied: <ids>` + `Unmapped: <id — lý do>`
   trong report để controller chạy helper. Chạy prompt-level (session chính, `/spec-publish`) thì tự chạy.

## 4 việc phải làm (theo thứ tự)

### 1. Bump `spec_version` (nếu spec đổi)
Sửa frontmatter `SPECIFICATIONS.md`:
```yaml
---
spec_version: 1.5.0   # MAJOR breaking / MINOR thêm req,feature / PATCH làm rõ
updated_at: 2026-10-05
---
```
- Chỉ bump khi requirement đổi (thêm/sửa/xoá/đổi ngữ nghĩa). Bug fix thuần không đổi requirement → giữ nguyên version, chỉ sinh scope.

### 2. Ghi delta `spec/updates/YYYY-MM-DD-<slug>.md`
```markdown
# Spec Update — 2026-10-05 <slug>
**spec_version:** 1.4.0 → 1.5.0 (MINOR)
**Trigger:** feature-update | bug-fix | initial-build | spec-patch
**Requirements:** THÊM R-12 ... / SỬA R-05 ... / XOÁ R-08 ...
**Owner decisions:** sp-3bbfec8 (F10 AC6) report note ≤ 500 ký tự → sửa F10 AC6 / ...
**Ảnh hưởng:** module X, test luồng Y
```

### 3. Thêm dòng `spec/CHANGELOG.md`
```
| 1.5.0 | 2026-10-05 | MINOR | Thêm R-12 <mô tả> | scope v4 |
```

### 4. Sinh/cập nhật `spec/test-scope/current.json` (bàn giao cho TEST)
```jsonc
{
  "specVersion": "1.5.0",
  "scopeVersion": 4,                 // tăng 1 mỗi lần sinh
  "generatedAt": "2026-10-05T14:12:00+07:00",
  "trigger": "feature-update | bug-fix | initial-build",
  "workItem": "feature-stripe-selfserve",
  "specRefs": ["R-12"],              // requirement mới/đổi
  "changed": { "files": [...], "modules": [...] },
  "impact": {
    "direct": [...],                  // test mới/sửa
    "dependents": [...],              // test lại
    "regression": [...]               // luồng cũ cần retest
  },
  "acceptance": [...],
  "risk": "low | medium | high"
}
```

## Bàn giao cho test (tự động, không cần kể lại)
- Commit spec + scope cùng close-out commit.
- Template TEST sync spec tự động khi chạy `/autotest` → thấy `scopeVersion` mới + `specVersion` mới → tạo test case cho phần mới, test đúng phạm vi.
- **Không cần** thông báo thủ công — test đọc `spec/test-scope/current.json`.

## Rules
1. **Tự động** — không chờ user nhắc mới làm.
2. Bug fix thuần (không đổi requirement) → không bump version, vẫn sinh scope (test cần biết vùng vừa sửa).
3. Feature/thay đổi requirement → bump version + delta + changelog + scope.
4. `specRefs` phải trỏ requirement thật trong `SPECIFICATIONS.md`.
5. Luôn tăng `scopeVersion` (không ghi đè cùng số).
6. Close-out commit gồm: code + `spec/updates/*` + `spec/CHANGELOG.md` + `spec/test-scope/current.json`.
7. **Luôn áp `pendingSpecPatch` trước** (§0) — không để quyết định của owner nằm mãi trong `progress.json`.
   Patch-only (`trigger: spec-patch`) không sinh test-scope; commit cùng close-out layer/change, hoặc commit riêng
   theo `.agent/workflows/state-commit.md` khi chạy do ngưỡng 10 (c).
