# Task Dashboard — isometric office cho opencode parallel loop

Xem trạng thái task/agent của build loop dưới dạng văn phòng isometric kiểu *Game Dev Story*.
Mỗi builder đang chạy = 1 nhân vật ngồi bàn gõ phím. Eve (merger) đứng giữa phòng.

**Chỉ đọc. Không ghi, không sửa, không can thiệp loop.**

## Chạy demo (không cần project)

```bash
cd /home/openclaw/.openclaw/workspace/tools/task-dashboard
node server.mjs --demo --port 7788
```

Mở http://localhost:7788

Demo tự đổi cảnh theo chu kỳ ~54s: build → merge → build layer mới → hoàn tất.
Muốn xem lại từ đầu thì Ctrl+C rồi chạy lại.

## Chạy với project thật

```bash
node server.mjs --repo /home/openclaw/.openclaw/workspace/opencode-project-template --port 7789
```

Mở http://localhost:7789

## Nguồn dữ liệu

| Nguồn | Cho biết gì |
|---|---|
| `<repo>/.context/progress.json` | `completedTasks` (done), `inProgressTask` (đang dở chính thức), `blockedTasks` (kèm reason), `currentLayer`/`totalLayers`, `lastUpdated` |
| `git worktree list --porcelain` | **worktree đang sống** → builder nào đang chạy task nào. Branch `wt/layer-N__task-NN` (hoặc `wt/<scope>__phase-N__task-NN`) |
| `git log -1 --format=%ct <branch>` + mtime worktree | ước lượng "đang active" (quá 10 phút không đổi → đánh dấu `stale`, hiện mờ + chữ "im lặng") |
| `<repo>/tasks/**/*.md` | tên task + danh sách task `waiting` (nếu có task file) |

## Caveat quan trọng — vì sao "running" lấy từ git

Builder chạy song song **không tự ghi `progress.json`** (chống race, chỉ merger ghi 1 lần sau khi merge).
Nên lúc đang chạy parallel, `progress.json` thường trông như "đứng yên". Nguồn realtime thật là
**git worktree**: worktree `wt/layer-N__task-NN` còn tồn tại = builder đó còn sống.

Hệ quả:

- Task vừa merge xong nhưng worktree chưa cleanup có thể hiện `running` trong vài giây → vài phút.
  Dashboard ưu tiên `completedTasks` trước, nên task đã done sẽ hiện done dù worktree còn.
- Nếu builder chết giữa chừng, worktree vẫn còn → vẫn hiện `running` nhưng có cờ `stale`
  (mtime/commit cũ hơn 10 phút).
- `waiting` chỉ suy ra được khi repo có task file trong `tasks/`. Không có thì dashboard chỉ hiện
  running/done/blocked, không bịa task.

## Pha merge

`phase` được suy ra: còn builder chạy → `building`; hết builder mà có task done → `merging`
(Eve sáng, aura cyan); mọi task done → `complete`. Nếu `progress.json` có field `phase` thì dùng luôn.

## API

- `GET /api/state` — JSON tổng hợp (không cache)
- `GET /api/health` — `{ok, version, demo, repo}`

## Tham số

| Flag | Mặc định | Ý nghĩa |
|---|---|---|
| `--repo <path>` | — | repo cần xem (bắt buộc nếu không `--demo`) |
| `--demo` | off | dữ liệu giả lập |
| `--port <n>` | 7788 | |
| `--host <addr>` | 127.0.0.1 | dùng `0.0.0.0` nếu muốn xem từ máy khác |

## An toàn

- Chỉ gọi `git worktree list`, `git log -1`, `git -C` với lệnh read-only. Không `add`/`commit`/`merge`/`checkout`.
- Chỉ `fs.readFileSync` / `readdirSync` / `statSync`. Không ghi file nào vào repo.
- Repo không phải git, thiếu `progress.json`, JSON hỏng → trả state gọn với `ok:false`, server không crash.

## Cấu trúc

```
tools/task-dashboard/
├── server.mjs            # HTTP server + đọc progress.json + git worktree
├── index.html            # toàn bộ UI, inline CSS/JS, SVG isometric
├── sample-progress.json  # mẫu progress.json đúng schema thật
└── README.md
```

## Test nhanh bằng sample

Copy `sample-progress.json` vào một repo giả:

```bash
mkdir -p /tmp/demo-repo/.context && cp sample-progress.json /tmp/demo-repo/.context/progress.json
cd /tmp/demo-repo && git init -q && git add -A && git commit -qm init
node /home/openclaw/.openclaw/workspace/tools/task-dashboard/server.mjs --repo /tmp/demo-repo --port 7790
```
