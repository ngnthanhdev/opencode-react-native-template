# Blackboard Agent — State Management

## Role
Quản lý shared state cho toàn bộ hệ thống agents. File `.context/progress.json` là source of truth cho trạng thái project.

## Trigger
- Mỗi khi bắt đầu session mới (resume)
- Mỗi khi agent cần đọc/ghi state

---

## State Schema

### `.context/progress.json`

```json
{
  "projectName": "string",
  "currentLayer": 0,
  "totalLayers": 0,
  "completedTasks": [
    {
      "task": "layer-0/task-01",
      "review": "STRICT PASS",
      "round": 1,
      "report": ".context/review-reports/feature-x-phase-1-task-01-round-1-review.md",
      "completedAt": "2026-10-19T09:26:53.812Z"
    },
    {
      "task": "layer-0/task-02",
      "review": "STRICT PASS",
      "round": 1,
      "completedAt": "2026-10-19T09:41:02.115Z"
    }
  ],
  "inProgressTask": "layer-1/task-01" | null,
  "blockedTasks": [
    {
      "task": "layer-1/task-03",
      "reason": "External API not available",
      "since": "ISO timestamp"
    }
  ],
  "decisions": [
    {
      "date": "ISO timestamp",
      "decision": "Use JWT instead of session auth",
      "reason": "Stateless, better for scaling"
    }
  ],
  "pendingSpecPatch": [
    {
      "id": "sp-3bbfec8",
      "decision": "portrait framing nullable trên POST /v1/portraits",
      "specRef": "F04",
      "source": "layer-2/task-03",
      "decidedAt": "ISO timestamp"
    }
  ],
  "lastUpdated": "ISO timestamp"
}
```

### `completedTasks` — schema chính thức

**Mảng OBJECT** (chuẩn):

```json
{ "task": "layer-0/task-01", "review": "STRICT PASS", "round": 1,
  "report": ".context/review-reports/...", "completedAt": "ISO" }
```

- `task` = id task (`layer-N/task-NN` hoặc `<feature|bug>-<slug>/phase-N/task-NN`) — **bắt buộc**.
- `review` / `round` / `report` / `completedAt` — **optional**, chỉ để hiển thị + truy vết.
- **Vẫn chấp nhận string cũ** (`"layer-0/task-01"`) để backward-compat; tool tự chuẩn hoá.
- Phần tử không đọc được → dashboard báo warning, **không bỏ im lặng**.

> ⚠️ Đừng tự viết JSON tay để ghi progress — dùng helper (atomic, dedupe, đúng schema):
>
> ```bash
> node tools/task-dashboard/progress-write.mjs complete --task layer-1/task-02 \
>      --review "STRICT PASS" --round 1 --report .context/review-reports/...
> node tools/task-dashboard/progress-write.mjs block --task layer-1/task-03 --reason "..."
> node tools/task-dashboard/progress-write.mjs in-progress --task layer-1/task-04
> node tools/task-dashboard/progress-write.mjs clear-in-progress
> node tools/task-dashboard/progress-write.mjs set-layer --current 2 --total 5
> ```
>
> Helper tự tìm repo root qua `git rev-parse --git-common-dir` → chạy trong worktree vẫn ghi đúng
> `.context/progress.json` của repo gốc. `complete` tự xoá task khỏi `inProgressTask`/`blockedTasks`.

### `pendingSpecPatch` — quyết định của owner chờ áp vào spec

Hàng đợi các câu trả lời/quyết định của owner **làm rõ hoặc đổi intent** nhưng chưa vào `SPECIFICATIONS.md`
(vd "portrait framing nullable trên POST /v1/portraits", "report note ≤ 500 ký tự (F10 AC6)").
Mục tiêu: spec không trôi khỏi thực tế — agent sau đọc spec là thấy quyết định mới.

**Mảng OBJECT** (chuẩn):

```json
{ "id": "sp-3bbfec8", "decision": "...", "specRef": "F10", "source": "layer-2/task-03",
  "decidedAt": "ISO", "note": "..." }
```

- `id` — helper sinh (`sp-<7 hex sha1 của decision>`), ổn định, dùng để clear. `decision` — **bắt buộc**, ghi đúng ý owner.
- `specRef` — requirement/feature/AC bị ảnh hưởng (`F10`, `R-05`, `F10 AC6`) — optional nhưng nên có.
- `source` — task hoặc câu hỏi sinh ra quyết định. `decidedAt` — helper tự ghi.
- `note` — chỉ có khi spec-publisher **không map được** vào section nào (entry ở lại hàng đợi kèm lý do).
- **Vẫn chấp nhận string cũ** (`"report note ≤ 500 chars (F10 AC6)"`) — helper tự chuẩn hoá thành `{id, decision}`.

**Ai ghi:** **controller** (session chính / dispatcher) — **ngay lúc** owner chốt một quyết định làm rõ/đổi intent
(trả lời câu hỏi làm rõ, duyệt checkpoint kèm điều chỉnh…). Subagent **không** ghi `progress.json`: subagent
gặp điểm cần owner quyết → báo về controller; controller hỏi owner rồi ghi.

```bash
node tools/task-dashboard/progress-write.mjs spec-patch add --decision "report note ≤ 500 ký tự" \
     --ref "F10 AC6" --source layer-2/task-03
node tools/task-dashboard/progress-write.mjs spec-patch list                 # chỉ đọc: count, applyNow, entries
node tools/task-dashboard/progress-write.mjs spec-patch note --id sp-3bbfec8 --note "chưa có section"
node tools/task-dashboard/progress-write.mjs spec-patch clear --ids sp-3bbfec8,sp-6fb2816   # hoặc --all
```

- `add` dedupe theo nội dung decision (bỏ qua hoa/thường + khoảng trắng); trùng → không thêm, chỉ bổ sung
  `specRef`/`source` còn thiếu. Output có `count` + `applyNow` (`true` khi ≥ 10 entry).
- **Ai áp + khi nào áp:** `spec-publisher` theo `.agent/spec-publish.md` §0 — mỗi lần đóng layer (initial build),
  cuối mỗi change-request, và ngay khi `applyNow: true`. Controller clear các id spec-publisher báo đã áp.

---

## Resume Instructions

Khi agent bắt đầu session mới:

1. **Read** `.context/progress.json`
2. **Determine state:**
   - `inProgressTask != null` → Task đang dở, tiếp tục từ loop.md
   - `inProgressTask == null` → Check next task trong current layer
   - All tasks in current layer done → Check review status → Unlock next layer
   - All layers done → Project complete
3. **Read context:**
   - Current task file (nếu có)
   - `.context/error-memory.md` (recent errors)
   - `.context/decisions.md` (past decisions for consistency)
4. **Continue execution** theo trạng thái

---

## State Transitions

```
[START] → brainstorm → graph → loop ←→ review
                                 ↓
                          [LAYER COMPLETE]
                                 ↓
                          next layer / [DONE]
```

### Valid State Updates

| Event | Update |
|-------|--------|
| Task started | `inProgressTask = "layer-X/task-YY"` |
| Task PASS | Move to `completedTasks`, clear `inProgressTask` |
| Task BLOCKED | Move to `blockedTasks` with reason |
| Layer complete | `currentLayer++` |
| Decision made | Append to `decisions[]` |
| Owner chốt quyết định làm rõ/đổi intent | `spec-patch add` → `pendingSpecPatch[]` |
| spec-publisher đã áp entry vào spec | `spec-patch clear --ids <id,...>` |

---

## Rules

1. **Atomic updates** — đọc file → modify → ghi lại toàn bộ
2. **Always update `lastUpdated`** khi modify progress.json
3. **Never delete completedTasks** — chỉ append
4. **Decisions are permanent** — ghi lại lý do để future agents hiểu context
5. **blockedTasks vẫn count** — layer không complete nếu còn blocked tasks (trừ khi human approve skip)

---

## File phụ trợ: `.context/agents-live.json` (CHỈ-HIỂN-THỊ)

Dashboard `tools/task-dashboard/` cần biết **agent nào đang làm task nào, ở pha nào** — thứ mà
`progress.json` + git worktree không trả lời được (reviewer là subagent, không để lại worktree).

Vì vậy loop ghi thêm `.context/agents-live.json` qua helper:

```bash
node tools/task-dashboard/agent-live.mjs enter --agent builder-1 --role builder \
  --task layer-1/task-02 --title "..." --phase building --worktree .worktrees/...
node tools/task-dashboard/agent-live.mjs leave --agent builder-1
node tools/task-dashboard/agent-live.mjs clear
```

**Quan hệ với state thật:**

| File | Vai trò |
|---|---|
| `.context/progress.json` | **Source of truth** — chỉ dispatcher ghi, 1 lần/layer (qua `progress-write.mjs`) |
| `.context/agents-live.json` | **Display-only** — ai đang ngồi đâu, KHÔNG phải state |

- Mất/hỏng/không có `agents-live.json` → loop chạy bình thường, dashboard tự fallback suy luận từ worktree.
- File nằm trong `.gitignore` (runtime), không commit.
- Builder **vẫn không** ghi `progress.json` — chỉ gọi `agent-live.mjs`.
- `enter` upsert theo `--agent`; `leave` = release (dashboard cho biến mất); `clear` = reset đầu layer/khi idle.
