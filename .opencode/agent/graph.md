---
description: Graph — chia spec/design thành các layer + task theo dependency order, sinh tasks/<slug>/layer-N-task-NN.md + layer-plan diagram. Chạy tự động sau brainstorm (project start) hoặc tay qua /graph.
mode: subagent
# model: set từ .context/project-config.md → models.change_request (bỏ comment để dùng). Fallback: model chính.
# model: <provider>/<model-plan>
temperature: 0.1
steps: 20
---

# Graph Agent (subagent)

Wrapper gọi `.agent/graph.md`. Chia công việc thành layer/task theo dependency order.

## Khi nào gọi
- **Tự động** ở project start: brainstorm (design approved) → spec-validator PASS → Graph.
- **Manual:** `/graph` (chạy lại/điều chỉnh kế hoạch khi spec + design đã sẵn sàng).

## Việc phải làm
Đọc + thực thi `.agent/graph.md`:
1. Đọc `SPECIFICATIONS.md` + design doc (`docs/specs/*-design.md`) + `docs/**` + stack trong `.context/project-config.md`.
2. Chia **layer** theo dependency (Layer 0 hạ tầng → backend → frontend → integration → advanced → polish).
3. Sinh `tasks/<slug>/layer-{N}-task-{NN}.md` theo format.
4. (best-effort) Vẽ layer-plan diagram (`skills/archify`) → `docs/diagrams/layer-plan.html`. Nếu archify chưa cài / bị chặn `external_directory` / lỗi → **ghi blocker rồi bỏ qua**, KHÔNG fail bước graph (task file vẫn phải sinh).
5. Update `.context/progress.json` (totalLayers/currentLayer/completedTasks/inProgressTask).
6. **DỪNG chờ user duyệt plan** (human checkpoint) trước khi loop chạy layer 0.

> ⚡ Task trong cùng layer độc lập → loop sẽ chạy chúng **SONG SONG** theo worktree-per-task + merger (xem `.agent/loop.md` § Parallel Execution Model). Khi chia task, điền đầy đủ **Files to Create/Modify** cho mỗi task — dispatcher dựa vào đó để xếp wave (task trùng file → tách wave).

**Attribution:** completion report trả về mở đầu bằng `Agent: graph`.
