---
description: Mở dashboard trực quan 2.5D (văn phòng isometric kiểu Game Dev Story) xem task nào đang chạy / xong / blocked và agent nào active. Chỉ ĐỌC, không đụng loop.
---

Chạy **Task Dashboard** — giao diện văn phòng isometric 2.5D xem trạng thái build loop.

`$ARGUMENTS`

## Dashboard là gì

Tool **độc lập, chỉ đọc** ở `tools/task-dashboard/`. Không ghi, không sửa, không can thiệp loop.
Mỗi builder đang chạy = 1 nhân vật ngồi bàn gõ phím; task xong = ✅; blocked = 🔴 (hover xem lý do);
Eve (merger) đứng giữa phòng, sáng khi tới pha merge.

Nguồn data (read-only):
- `.context/progress.json` → task xong (`completedTasks`), đang dở (`inProgressTask`), blocked (`blockedTasks`), layer.
- `git worktree list` → builder đang sống (mỗi worktree `wt/layer-N__task-NN` = 1 builder đang chạy task đó).

Trang tự `fetch /api/state` mỗi 3s.

## Cách chạy

**Gắn vào project này (mặc định — đọc chính repo đang build):**
```bash
node tools/task-dashboard/server.mjs --repo . --port 7788
```
Mở http://localhost:7788

**Xem thử demo (không cần project đang build):**
```bash
node tools/task-dashboard/server.mjs --demo --port 7788
```
Demo tự đổi cảnh build → merge → build layer mới → done theo vòng ~54s.

**Mở được từ máy khác (LAN):** thêm `--host 0.0.0.0`.

## Lưu ý

- Chỉ dùng `node` builtin — KHÔNG cần `npm install`.
- Port mặc định 7788, đổi bằng `--port <N>`.
- Lúc chạy song song builder không ghi `progress.json` (chống race), nên "running" suy từ `git worktree`.
  Đây là tool quan sát, hoàn toàn tách khỏi logic loop/build.
