# Loop Agent — Task Execution (ReAct Pattern, Parallel per-worktree) (React Native)

> Engine thực thi từng task theo ReAct: Read → Plan → Act → Observe → Repeat.
> Điều phối: `AGENTS.md` + `.agent/FEATURE_WORKFLOW.md`. State: `.context/progress.json` (`features[]`/`bugs[]`).

## Role
Execute từng task theo ReAct cycle: Read → Plan → Act → Observe → Repeat.

## Trigger
- **`/start`** (project start): sau khi `graph` sinh layer plan + user duyệt plan → loop chạy layer 0 → …. (Đây là đường vào chính của initial build.)
- `change-request` hoặc `/change` chia xong phase/task (feature/bug)
- Hoặc resume từ `.context/progress.json`

---

## Parallel Execution Model (worktree-per-task)

> Đọc trước khi chạy 1 layer. Khi layer chỉ có 1 task → bỏ qua fan-out, chạy trực tiếp như cũ.
> Trong 1 layer, các task độc lập chạy **SONG SONG** — mỗi task 1 **git worktree riêng**, mỗi builder agent chạy loop đầy đủ trong worktree của mình. 1 agent **merger** gom lại.

```
  DISPATCHER (loop chính): plan --layer N → các wave
        │  với mỗi wave: spawn SONG SONG
   ┌────┼────┐
 BUILDER BUILDER BUILDER   mỗi con 1 worktree riêng, chạy FULL loop
 (.wt/)  (.wt/)  (.wt/)    (Read→Plan→Act→Observe→Review→Commit)
   └────┼────┘
        ▼  (tất cả PASS + committed)
  MERGER (1 con): merge --layer N → verify tổng thể → update progress.json 1 lần → cleanup
        ▼
  HUMAN CHECKPOINT → layer N+1
```

### Đảm bảo độc lập — không giẫm chân nhau
1. **Nguồn gốc**: graph đã đảm bảo *task trong cùng layer không phụ thuộc nhau*.
2. **Check file trùng**: `plan --layer N` đọc **Files to Create/Modify** của mỗi task; 2 task khai trùng file → **không xếp cùng wave** (đẩy task sau sang wave kế).
3. **Cô lập vật lý**: mỗi task 1 **git worktree + branch riêng** (`.worktrees/<...>`, branch `wt/<...>`) → builder không thể ghi đè file của builder khác.
4. **State không tranh chấp**: builder con **KHÔNG** tự ghi `.context/progress.json`. Chỉ **merger** ghi tập trung 1 lần (chống race condition).

### Dispatcher steps (mỗi layer)
```
1. node scripts/parallel-dispatch.mjs plan --layer N   → { waves: [[task...], ...] }
2. Với MỖI wave (tuần tự giữa wave, song song TRONG wave):
   a. mỗi task: node scripts/parallel-dispatch.mjs setup --task <layer-N/task-NN>  → { worktree, branch }
   b. spawn SONG SONG 1 builder/task (sessions_spawn, context="isolated"):
      "cd <worktree>; chạy FULL loop cho <task file>; chỉ touch file trong scope;
       commit trong worktree; KHÔNG ghi progress.json; báo PASS/BLOCKED về."
   c. đợi TẤT CẢ builder trong wave xong.
3. Hết wave → gọi MERGER.
```

### Merger steps (1 con, sau khi layer xong)
```
1. node scripts/parallel-dispatch.mjs merge --layer N
   → gom mọi branch wt/layer-N__* về integration branch layer-N-integration.
   → CONFLICT → DỪNG: cho task đó chạy LẠI TUẦN TỰ trên integration branch, ghi error-memory.md.
2. Verify TỔNG THỂ trên integration branch (typecheck/lint/test theo project-config) — từng task pass riêng KHÔNG đảm bảo ghép lại pass. FAIL → error-analyzer → fix → verify lại.
3. Update `.context/progress.json` 1 LẦN (atomic): completedTasks/blockedTasks/currentLayer/lastUpdated.
4. Merge integration branch về nhánh chính (theo DevOps/git policy).
5. node scripts/parallel-dispatch.mjs cleanup --layer N
6. → context-manager compact → HUMAN CHECKPOINT → layer N+1.
```

> Một task tại một thời điểm **chỉ trong 1 builder** (1 worktree). Song song xảy ra **giữa các builder** — không phải trong 1 builder. Builder commit trong worktree + review riêng, **không** tự ghi state/merge; merger lo gom.

---

## Pattern

```
┌─────────────────────────────────────┐
│           READ                       │
│  • Task file                         │
│  • .context/error-memory.md          │
│  • Related existing code             │
│  • skills/react-native/patterns.md   │
│  • 🔒 skills/security/* (nếu task    │
│      auth/storage/input/API)         │
│  • 📊 skills/monitoring/* (nếu task  │
│      API/network/performance/logging)│
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│           PLAN                       │
│  • List files to create/modify       │
│  • Identify potential issues         │
│  • Check error-memory for pitfalls   │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│           ACT                        │
│  • Write code                        │
│  • Write tests                       │
│  • Install dependencies if needed    │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│          OBSERVE                     │
│  • Run typecheck (`npx tsc --noEmit`)│
│  • Run tests (`npx jest`)            │
│  • Run lint (`npx expo lint`)        │
│  • Check app builds                  │
└──────────────┬──────────────────────┘
               ▼
        ┌──────┴──────┐
        ▼             ▼
      PASS          FAIL
        │             │
        ▼             ▼
   git commit    Error Analyzer
        │             │
        └─────────────┘
             (retry, max 3)
```

## Task Execution Rules

- **Task file**: initial build → `tasks/<slug>/layer-{N}-task-{NN}.md`; change hậu-build → `tasks/<feature|bug>-<slug>/phase-<N>-task-<NN>.md`.

0. **Mọi task code (implement/bugfix/refactor):**
   - Đọc `skills/superpowers/SKILL.md` — Iron Law debug + TDD gate
   - Trước khi fix bug → đọc `skills/superpowers/systematic-debugging.md` (4 phases)
   - Trước khi thêm tính năng → đọc `skills/superpowers/test-driven-development.md` (test-first)
   - Đọc `skills/ponytail/SKILL.md` — lazy senior dev ladder, chống over-engineering

0b. **MANDATORY TDD (theo `skills/superpowers/test-driven-development.md`):**
```
Write the test first. Watch it fail. Write minimal code to pass.
```
- **Critical paths (auth, payment, data mutation, secure storage): viết test TRƯỚC khi viết code** (RED → GREEN)
- Các task khác: viết code và test cùng lượt
- Không viết code implement trước khi có failing test (trừ exception đã hỏi human)
- Nghĩ "skip test lần này" → DỪNG, đó là rationalization
- **Ponytail ladder:** 1) cần tồn tại không (YAGNI) → 2) đã có trong codebase? → 3) stdlib? → 4) native platform? → 5) dependency đã cài? → 6) 1 dòng được? → 7) mới code tối thiểu

1. **Read task file hoàn toàn** trước khi code

   > ⚙️ **Nếu task EDIT code có sẵn (nâng cấp/refactor/sửa bug)** → ĐỌC `skills/karpathy-guidelines/references/surgical-changes.md` — chỉ chạm đúng phần cần, không drive-by refactor, match style có sẵn, chỉ dọn orphan do mình tạo.
   > Nếu task mơ hồ (nhiều cách hiểu / giả định lớn) → đọc `skills/karpathy-guidelines/references/think-before-coding.md` — nêu giả định rõ, present interpretations, dừng hỏi khi không rõ, push back khi có cách đơn giản hơn.
2. **Check dependencies** — chỉ chạy khi tất cả deps đã PASS
3. **Dependency check:**
   ```bash
   python3 -c "
   import json
   with open('.context/progress.json') as f:
       p = json.load(f)
   print('Active:', p.get('activeWorkItem'))
   print('Features:', [x.get('slug') for x in p.get('features', [])])
   print('Bugs:', [x.get('slug') for x in p.get('bugs', [])])
   "
   ```

4. **Update progress** sau mỗi task:
   ```bash
   python3 -c "
   import json
   with open('.context/progress.json') as f:
       p = json.load(f)
   # schema: features[] / bugs[], activeWorkItem
   p['activeWorkItem'] = None
   with open('.context/progress.json','w') as f:
       json.dump(p, f, indent=2)
   "
   ```

5. **Max 3 retries per task** — nếu vẫn FAIL → mark BLOCKED → notify human
6. **Sau khi PASS (tests/typecheck/lint pass):** gọi subagent `reviewer` (`.opencode/agent/reviewer.md`) review độc lập → PASS mới commit/đóng task; FAIL → quay lại builder (max 2 vòng), gọi `error-analyzer` khi fail lặp.

## Context Compact Check (`.agent/context-manager.md`)

Sau mỗi task PASS (đọc `completedTasks`/`tasks` done từ `.context/progress.json`):
```
Nếu số task đã done % 3 == 0:
  → INVOKE .agent/context-manager.md (compact)
  → Đọc .context/compressed-summary.md thay cho full history
```
Sau khi **layer/phase hoàn thành** (mọi task PASS) → **MANDATORY** invoke `.agent/context-manager.md`, compact cả layer/phase vừa xong rồi mới sang layer/phase tiếp.

## Spec Publish — hết layer cuối (initial build) (`.agent/spec-publish.md`)
Sau khi **layer CUỐI hoàn thành — initial build xong** (mọi task của mọi layer PASS):
```
- INVOKE `.agent/spec-publish.md` (spec-publisher):
  - Cập nhật `spec/test-scope/current.json` theo phạm vi THẬT đã build:
    `trigger: initial-build`, `scopeVersion` +1 (spec-init đã tạo bản nháp lúc khởi đầu),
    `risk` hạ theo kết quả verify thật, `specRefs` = req đã implement.
  - Thêm dòng `spec/CHANGELOG.md` nếu spec đổi trong lúc build.
- Bàn giao cho template TEST trước commit close-out (commit chung với code).
```

> 📋 **State (`.agent/blackboard.md`)**: `.context/progress.json` là source of truth — đọc trước khi làm (resume), atomic update sau mỗi bước đổi trạng thái.

## Verification Commands (React Native)

```bash
# TypeScript check
npx tsc --noEmit

# Lint
npx expo lint

# Unit tests
npx jest

# Run app (manual testing)
npx expo start        # Expo Go
npx expo run:ios      # iOS simulator
npx expo run:android  # Android emulator
```

## Success Criteria
- TypeScript compile pass
- Tests pass
- Lint pass
- App runs (`expo start` không lỗi)
