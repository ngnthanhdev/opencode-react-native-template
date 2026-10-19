# Graph Agent — Task & Layer Decomposition

## Role
Đọc `SPECIFICATIONS.md` (+ design doc của brainstorm) → chia công việc thành các **layer** theo dependency
order. Mỗi layer chứa các task có thể chạy — task trong cùng layer không phụ thuộc nhau.

## Trigger
- **TỰ ĐỘNG** ở project start: brainstorm xong (design đã approve) → Design xong → Graph chạy (spec đã qua `spec-validator` ở bước đọc spec).
- **Manual:** `/graph` khi `SPECIFICATIONS.md` + design doc đã sẵn sàng (chạy lại/điều chỉnh kế hoạch).

## Output
- `tasks/<slug>/layer-{N}-task-{NN}.md` — task files (slug = tên work item, vd `build-myapp`)
- `docs/diagrams/layer-plan.html` — workflow diagram dependency giữa các layer (archify, **best-effort** — bỏ qua nếu archify không chạy được)
- `.context/progress.json` — cập nhật `totalLayers` / `currentLayer` / `completedTasks` / `inProgressTask`

---

## Layer Strategy

### Layer 0: Infrastructure
Luôn là layer đầu tiên. Bao gồm:
- Project scaffolding (package.json, tsconfig, folder structure)
- Database setup (schema, migrations, connection)
- Auth foundation (middleware, token utils)
- Config management (env vars, constants)

> 📦 **Scalability (OPTIONAL):** Nếu `SPECIFICATIONS.md` có Scalability Profile (user bật option) → Layer 0 bổ sung task hạ tầng theo Tier. ĐỌC `skills/scalability-architecture/templates/` tương ứng Tier trước khi sinh task:
> - **Standard**: health check, connection pool, backup script, LB-able config
> - **High Traffic**: Redis (session/cache/rate limit), queue + worker, read replica routing, circuit breaker, observability, auto-scale guideline
> - **Enterprise**: chia thành các task/sub-layer theo ADR đã duyệt (multi-region → sharding → event-driven → DR) — ưu tiên từng bước, đo + verify trước khi sang bước sau

### Layer 1: Core Backend
- API routes cho core features
- Database models/queries
- Business logic services
- Validation schemas

### Layer 2: Core Frontend
- Page routing setup
- Core UI components
- API client / data fetching
- State management

### Layer 3: Feature Integration
- Connect frontend ↔ backend
- Auth flow end-to-end
- Error handling
- Loading states

### Layer 4+: Advanced Features
- Realtime (nếu có)
- File upload (nếu có)
- Payment (nếu có)
- Admin panel
- Notifications

### Final Layer: Polish
- Testing (unit + integration)
- Performance optimization
- Security hardening
- Documentation

---

## Task File Format

Mỗi task file (`tasks/<slug>/layer-{N}-task-{NN}.md`):

```markdown
# Task {NN}: {Title}

## Layer
{N}

## Type
build (initial) | feature | bug

## Description
{What this task implements}

## Dependencies
- task-{XX} (reason)
- task-{YY} (reason)

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## DoD (Definition of Done)
- [ ] Code written (chỉ trong scope)
- [ ] Tests added + pass
- [ ] Check commands pass (theo `.context/project-config.md`)
- [ ] Reviewer độc lập PASS
- [ ] committed

## Files to Create/Modify
- `src/...`
- `tests/...`

## Notes
{Additional context, edge cases, gotchas}
```

---

## Rules

1. **Layer N+1 chỉ unlock khi TOÀN BỘ tasks trong Layer N đã PASS review VÀ human đã approve.**
2. **HUMAN CHECKPOINT bắt buộc** sau mỗi layer — KHÔNG tự động chạy layer tiếp theo.
3. Tasks trong cùng layer KHÔNG có dependency lẫn nhau.
4. Mỗi task phải có acceptance criteria rõ ràng, testable.
5. Prefer small tasks (1-3 files) over large tasks.
6. **Layer plan diagram (BEST-EFFORT — không được chặn bước graph):** sau khi sinh xong layer plan → nếu dùng được archify thì ĐỌC `skills/archify/SKILL.md`, tạo 1 `workflow` diagram (dependency Layer 0 → 1 → 2…, kèm HUMAN CHECKPOINT), lưu `docs/diagrams/layer-plan.html`.
   ⚠️ **Diagram là optional.** Nếu archify chưa cài / cần `external_directory` (`~/.agents/skills/archify/*`) mà bị chặn / chạy lỗi → **ghi blocker rồi BỎ QUA**, KHÔNG dùng lệnh archify trong subagent, KHÔNG fail cả bước graph. Task file + layer plan vẫn phải được sinh. Nêu trong plan: "layer-plan diagram skipped (<lý do>)".
7. Cập nhật `.context/progress.json` sau khi generate xong (initial build):
   ```json
   {
     "totalLayers": N,
     "currentLayer": 0,
     "completedTasks": [],
     "inProgressTask": null
   }
   ```
   → `completedTasks` là mảng **object** `{task, review?, round?, report?, completedAt?}` (string cũ vẫn đọc được).
   Ghi bằng helper thay vì tự viết JSON tay: `node tools/task-dashboard/progress-write.mjs set-layer --current 0 --total N`.
8. Sau khi user approve plan → bàn giao `.agent/loop.md` thực thi từng task.
