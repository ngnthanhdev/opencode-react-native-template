---
description: Mở dashboard trực quan 2.5D (văn phòng isometric kiểu Game Dev Story) xem agent nào đang build/review và task nào ở TODO/REVIEW/DONE. Chỉ ĐỌC, không đụng loop.
---

Chạy **Task Dashboard v2** — giao diện văn phòng isometric 2.5D xem trạng thái build loop.

`$ARGUMENTS`

## Dashboard là gì

Tool **độc lập, chỉ đọc** ở `tools/task-dashboard/`. Không ghi, không sửa, không can thiệp loop.

**Văn phòng sống động:**
- Mỗi agent đang active = 1 nhân vật **ngồi bàn gõ phím**, trên đầu hiện **tên agent + task** (`builder-1`, `reviewer-1`…).
- **Builder** áo cyan, **reviewer** áo tím/tóc vàng — phân biệt bằng mắt.
- **Eve (merger)** đứng giữa phòng, aura sáng khi tới pha merge.
- Agent **idle** ngồi khu nghỉ (sofa ☕ góc phòng).
- Agent **release** → fade out, biến mất khỏi scene.

**3 bảng trạng thái:**
| Bảng | Nội dung |
|---|---|
| **⏳ TODO** | task chờ + task **blocked** (🔴, hover xem lý do) |
| **🔎 REVIEW** | task đang được reviewer review, kèm tên reviewer cầm |
| **✅ DONE** | task đã vào `completedTasks` |

Card tự **trượt** sang cột mới khi task đổi trạng thái (animation FLIP) → thấy rõ luồng
builder → review → done.

## Nguồn data (read-only)

1. **`.context/agents-live.json`** (ưu tiên) → agent/role/phase/task/title chính xác. Do loop ghi qua `agent-live.mjs`.
2. `.context/progress.json` → `completedTasks` (DONE), `blockedTasks` (TODO + 🔴), `inProgressTask`, layer.
3. `git worktree list` → **fallback** khi chưa có `agents-live.json`: worktree `wt/layer-N__task-NN` = builder đang chạy.

Không có `agents-live.json` → dashboard **không crash**, tự suy luận và hiện badge **"⚠ chế độ suy luận"**
(hover để xem lý do). Trong chế độ đó không phân biệt được builder vs reviewer.

Trang tự `fetch /api/state` mỗi 3s.

## Ghi `agents-live.json` — loop làm, không phải anh

Helper có sẵn trong `tools/task-dashboard/agent-live.mjs` (atomic + chịu ghi song song):

```bash
# builder nhận task
node tools/task-dashboard/agent-live.mjs enter --agent builder-1 --role builder \
  --task layer-1/task-02 --title "REST API /users" --phase building \
  --worktree .worktrees/wt/layer-1__task-02

# builder PASS → release builder + reviewer nhận task
node tools/task-dashboard/agent-live.mjs leave --agent builder-1
node tools/task-dashboard/agent-live.mjs enter --agent reviewer-1 --role reviewer \
  --task layer-1/task-02 --title "REST API /users" --phase review

# reviewer PASS → release reviewer; merger bắt đầu / xong layer
node tools/task-dashboard/agent-live.mjs leave --agent reviewer-1
node tools/task-dashboard/agent-live.mjs enter --agent merger --role merger --phase merging
node tools/task-dashboard/agent-live.mjs clear
```

`agents-live.json` là **file DISPLAY**, không phải source of truth — `progress.json` vẫn là chính.
Mất file không ảnh hưởng loop. File nằm trong `.gitignore`.

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
Demo chạy vòng ~52s mô phỏng đúng luồng: build → builder-1 xong (biến mất) → task sang REVIEW →
reviewer-1 xuất hiện → reviewer xong (biến mất) → task sang DONE → merger active.

**Mở được từ máy khác (LAN):** thêm `--host 0.0.0.0`.

## Lưu ý

- Chỉ dùng `node` builtin — KHÔNG cần `npm install`.
- Port mặc định 7788, đổi bằng `--port <N>`.
- Lúc chạy song song builder không ghi `progress.json` (chống race). Nếu loop chưa gọi `agent-live.mjs`
  thì "running" suy từ `git worktree` — kém chính xác hơn.
- Đây là tool quan sát, hoàn toàn tách khỏi logic loop/build.
