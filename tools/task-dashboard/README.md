# Task Dashboard v2 — văn phòng isometric cho opencode parallel loop

Xem trạng thái build loop dưới dạng **văn phòng isometric 2.5D** kiểu *Game Dev Story*.

- Mỗi **builder** đang chạy = 1 nhân vật ngồi bàn gõ phím (áo cyan). Trên đầu hiện **tên agent + task**.
- **Reviewer** ngồi bàn riêng, áo tím / tóc vàng → phân biệt bằng mắt.
- **Eve (bước merge)** đứng giữa phòng, sáng aura khi tới pha merge — **hình ảnh trực quan của bước merge**, không phải một agent con (không có `merger.md`; merge do dispatcher chạy `scripts/parallel-dispatch.mjs merge` + `cleanup`).
- Agent **idle** ngồi khu nghỉ (sofa ☕ góc phòng).
- Agent **release** → fade out, biến mất khỏi scene.
- **3 bảng TODO / REVIEW / DONE** hai bên: card tự trượt sang cột mới khi task đổi trạng thái.

**Chỉ đọc. Không ghi, không sửa, không can thiệp loop.**

## Chạy demo (không cần project)

```bash
cd tools/task-dashboard
node server.mjs --demo --port 7788
```

Mở http://localhost:7788

Demo chạy vòng ~52s mô phỏng đúng luồng mới:

| Pha | Thời gian | Diễn biến |
|---|---|---|
| `build` | 0–14s | builder-1/2/3 ngồi máy building, builder-4 ngồi khu nghỉ, TODO có task chờ + 1 blocked 🔴 |
| `review` | 14–26s | builder-1 **biến mất** (released), task-02 nhảy sang **REVIEW**, reviewer-1 xuất hiện ngồi máy |
| `review-done` | 26–38s | reviewer-1 **biến mất**, task-02 nhảy sang **DONE** |
| `merge` | 38–52s | tất cả builder/reviewer release, **merger** active, Eve sáng aura |

Muốn xem lại từ đầu: Ctrl+C rồi chạy lại.

## Chạy với project thật

```bash
node server.mjs --repo /path/to/project --port 7789
```

## Nguồn dữ liệu (theo thứ tự ưu tiên)

| # | Nguồn | Cho biết gì |
|---|---|---|
| 1 | `<repo>/.context/agents-live.json` | **Chính xác** agent nào đang làm: `agent`, `role` (builder/reviewer/merger), `phase` (building/review/merging/idle), `task`, `title`, `worktree`, `since`. Do loop ghi qua `agent-live.mjs` |
| 2 | `<repo>/.context/progress.json` | `completedTasks` (→ DONE), `blockedTasks` (→ TODO + 🔴 + lý do), `currentLayer`/`totalLayers` |
| 3 | `git worktree list --porcelain` | **Fallback**: worktree chỉ được coi là builder đang chạy khi có **tín hiệu rõ** — Run Journal `status=running` hoặc commit cuối mới hơn `--stale-sec` (mặc định 600s). Worktree không tín hiệu → liệt kê riêng ở `idleWorktrees`, **không** vẽ thành agent |
| 4 | `<repo>/tasks/**/*.md` | tên task + danh sách task chờ (nếu có task file) |
| 5 | `<repo>/.context/progress.json` → `features[]` / `bugs[]` | task của change-request (`phase-N-task-NN`) — chưa done vẫn hiện ở TODO/REVIEW/DONE theo `status` |
| 6 | `<worktree>/.context/{progress,agents-live}.json` + `<worktree>/.context/runs/*.md` | change-request chạy trong worktree riêng → gộp vào state tổng (Run Journal `status=running` = đang chạy) |

### B2 — change-request đang chạy

- Dashboard quét **mọi** worktree trong `git worktree list` (không chỉ `wt/*`): nhận `wt/layer-N__task-NN`,
  `claude/<slug>`, branch chứa `phase-N-task-NN`/`layer-N-task-NN`. Worktree không map được task vẫn hiện
  là **builder/worktree vô danh** (kèm warning) thay vì bỏ im.
- `agent-live.mjs` luôn ghi `.context/agents-live.json` của **repo gốc** (resolve `git rev-parse --git-common-dir`),
  kể cả khi gọi từ trong worktree → dashboard chỉ đọc 1 chỗ.

### Fallback — khi chưa có agents-live.json

Nếu loop chưa ghi `agents-live.json` (hoặc file hỏng), dashboard **không crash**: nó suy luận từ
`progress.json` + git worktree như v1, set `fallback: true` và trả `warnings`.
Trên HUD hiện badge nhỏ **"⚠ chế độ suy luận"** (hover xem lý do) để không gây hiểu nhầm.

Trong chế độ này **không phân biệt được builder vs reviewer** — task đang chạy đều vẽ là builder.

**Không đoán bừa (C1/C2/C3):**

- Worktree còn trên đĩa nhưng session đã dừng (commit cũ hơn `--stale-sec`, không có Run Journal `status=running`)
  → vào `idleWorktrees`, hiện chip **"💤 N worktree nghỉ"** (hover xem danh sách), **không** thành nhân vật đang làm.
  Không dùng mtime thư mục (git cập nhật liên tục → luôn "mới" giả).
- Agent trong `agents-live.json` có `stale: true` → vẽ mờ/xám, không glow, không gõ phím, nhãn `idle Xm` + `(đã dừng?)`.
- Phase `merging` **chỉ** khi có merger agent thật hoặc branch/worktree `*-integration`. Có task done mà còn blocked
  → `blocked`; còn waiting/todo mà không ai chạy → `idle`. Không còn báo merge ảo.

Ngưỡng stale đổi bằng `--stale-sec <giây>` (mặc định 600).

## Phân loại 3 cột

| Cột | Điều kiện |
|---|---|
| **TODO** | task `waiting` (chưa có agent, chưa done, chưa blocked) + task `blocked` (hiện 🔴, hover xem lý do) |
| **REVIEW** | task có agent `role=reviewer, phase=review` trong `agents-live.json`. Fallback: task đã rời worktree nhưng chưa vào `completedTasks` (đoán — kém tin cậy) |
| **DONE** | task trong `completedTasks` |

### B1 — `completedTasks` schema

Chuẩn là **mảng object**:

```json
{ "task": "layer-0/task-01", "review": "STRICT PASS", "round": 1,
  "report": ".context/review-reports/...", "completedAt": "ISO" }
```

`task` = id (bắt buộc), các field khác optional. String cũ (`"layer-0/task-01"`) vẫn đọc được
(backward-compat). Phần tử không đọc được → **warning** trên HUD, không bỏ im lặng.

`blockedTasks` nhận cả `{task, reason, since}` lẫn string.

Khuyến nghị ghi bằng helper thay vì viết JSON tay:

```bash
node tools/task-dashboard/progress-write.mjs complete --task layer-1/task-02 \
     --review "STRICT PASS" --round 1 --report .context/review-reports/...
node tools/task-dashboard/progress-write.mjs block --task layer-1/task-03 --reason "..."
node tools/task-dashboard/progress-write.mjs in-progress --task layer-1/task-04
node tools/task-dashboard/progress-write.mjs clear-in-progress
node tools/task-dashboard/progress-write.mjs set-layer --current 2 --total 5
```

Helper atomic (tmp+rename) + lock, dedupe theo task, tự xoá task khỏi `inProgressTask`/`blockedTasks`
khi `complete`, không crash khi file chưa có, và tự tìm repo gốc nên chạy được từ trong worktree.

## Ghi `agents-live.json` — `agent-live.mjs`

File `.context/agents-live.json` là **file phụ trợ CHỈ-HIỂN-THỊ**. Không phải source of truth
(`progress.json` vẫn là chính). Mất file không ảnh hưởng loop build.

```bash
# agent nhận task → xuất hiện trong scene
node tools/task-dashboard/agent-live.mjs enter \
  --agent builder-1 --role builder \
  --task layer-1/task-02 --title "REST API /users" \
  --phase building --worktree .worktrees/wt/layer-1__task-02

# builder PASS → release builder, reviewer nhận task
node tools/task-dashboard/agent-live.mjs leave --agent builder-1
node tools/task-dashboard/agent-live.mjs enter \
  --agent reviewer-1 --role reviewer \
  --task layer-1/task-02 --title "REST API /users" --phase review

# reviewer PASS → release reviewer (task vào DONE khi dispatcher ghi progress.json lúc merge)
node tools/task-dashboard/agent-live.mjs leave --agent reviewer-1

# bước merge bắt đầu / xong layer (dispatcher tự chạy, đây chỉ là nhãn hiển thị)
node tools/task-dashboard/agent-live.mjs enter --agent merger --role merger --phase merging
node tools/task-dashboard/agent-live.mjs clear
```

- `enter` = upsert (gọi lại nhiều lần không tạo trùng). Giữ `since` nếu cùng task+phase.
- `leave` = xoá agent khỏi mảng → dashboard fade out.
- `clear` = reset mảng rỗng (đầu layer / khi idle).
- Ghi **atomic** (tmp + rename) + **lock thư mục** `.lock` → chịu được nhiều process ghi song song.
- Tự tìm repo root: `git rev-parse --git-common-dir` (đúng cả trong worktree) → `--show-toplevel` → đi ngược thư mục. Override bằng `--repo <path>`.

Schema:

```json
{
  "updatedAt": "2026-10-19T09:26:53.963Z",
  "agents": [
    { "agent": "builder-1", "role": "builder", "phase": "building",
      "task": "layer-1/task-02", "title": "REST API /users",
      "worktree": ".worktrees/wt/layer-1__task-02", "since": "2026-10-19T09:26:53.812Z" },
    { "agent": "reviewer-1", "role": "reviewer", "phase": "review",
      "task": "layer-1/task-01", "title": "Auth middleware", "since": "..." },
    { "agent": "merger", "role": "merger", "phase": "merging", "since": "..." }
  ]
}
```

`phase` hợp lệ: `building` | `review` | `merging` | `idle`. Agent `phase: "idle"` → vẽ ở khu nghỉ.

> `.context/agents-live.json` nằm trong `.gitignore` — file runtime, không commit.

## API

`GET /api/state` trả:

| Field | Nội dung |
|---|---|
| `agents` | agent **đang active** (`building`/`review`/`merging`): `{agent, role, task, title, phase, worktree, since, sinceSec}`. Agent không còn trong `agents-live.json` = đã release = không trả về |
| `benchAgents` | agent `phase: "idle"` → vẽ ở khu nghỉ |
| `columns` | `{todo: [...], review: [...], done: [...]}` — card của 3 bảng |
| `counts` | `{building, review, done, blocked, todo, running, waiting, total}` (`running`/`waiting` giữ cho tương thích v1) |
| `fallback` | `true` khi đang suy luận (không có `agents-live.json`) |
| `agentsLive` | `{present, updatedAt, count}` |
| `warnings` | mảng cảnh báo (hiện trên badge HUD) |
| `version` | version server (khớp `PAGE_VERSION` trong `index.html`) |
| `worktrees` | danh sách worktree đang mở: `{path, rel, branch, task, mapped}` |
| `idleWorktrees` | worktree còn trên đĩa nhưng **không hoạt động**: `{worktree, branch, task, activeAgoSec, reason}` — không tính là agent |
| `staleSec` | ngưỡng stale đang dùng (giây), đặt qua `--stale-sec` |

`GET /api/health` → `{ok, version, demo, repo}`

### B3 — server cũ (Node không hot-reload)

`index.html` hard-code `PAGE_VERSION`. Mỗi lần fetch `/api/state`, trang so `state.version` với
`PAGE_VERSION`; lệch (hoặc thiếu `columns` / `counts.todo`) → hiện badge đỏ nổi bật
**"⚠ server cũ (vX) — restart dashboard"** và giữ nguyên cho tới khi restart.

> ⚠️ **Sau khi `git pull` / sync template → PHẢI restart server** (Ctrl+C rồi chạy lại).

## Tham số

| Flag | Mặc định | Ý nghĩa |
|---|---|---|
| `--repo <path>` | — | repo cần xem (bắt buộc nếu không `--demo`) |
| `--demo` | off | dữ liệu giả lập |
| `--port <n>` | 7788 | |
| `--host <addr>` | 127.0.0.1 | dùng `0.0.0.0` nếu muốn xem từ máy khác |

## An toàn

- Chỉ gọi `git worktree list`, `git log -1`, `git -C` với lệnh read-only. Không `add`/`commit`/`merge`/`checkout`.
- Server chỉ `fs.readFileSync` / `readdirSync` / `statSync`. Không ghi file nào vào repo.
- Repo không phải git, thiếu `progress.json`, JSON hỏng → trả state gọn với `ok:false`, server không crash.
- `agent-live.mjs` chỉ ghi đúng 1 file `.context/agents-live.json` (+ lock tạm). Không đụng `progress.json`.

## UI

- Isometric 2.5D thuần DOM/CSS/SVG inline — không lib ngoài, không CDN.
- Auto-refresh 3s, overlay khi mất kết nối.
- Card đổi cột → animation **FLIP** trượt từ vị trí cũ sang vị trí mới.
- Tôn trọng `prefers-reduced-motion`.

## Cấu trúc

```
tools/task-dashboard/
├── server.mjs            # HTTP server + đọc agents-live/progress + git worktree
├── agent-live.mjs        # ghi .context/agents-live.json (enter/leave/clear)
├── progress-write.mjs    # ghi .context/progress.json (complete/block/in-progress/set-layer)
├── index.html            # toàn bộ UI, inline CSS/JS, SVG isometric
├── sample-progress.json  # mẫu progress.json đúng schema
└── README.md
```
