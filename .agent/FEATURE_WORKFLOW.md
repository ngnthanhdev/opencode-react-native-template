# FEATURE_WORKFLOW.md — Workflow entry point (bug · feature · update)

> Entry point cho **mọi request** trên project đã có code.
> 🚀 **Start dự án** = `/start` (tự động): đọc spec (`/spec-init` nếu chưa có) → `/brainstorm` (clear yêu cầu + design doc + config) → `/graph` (chia layer/task) → loop. Mỗi bước có human checkpoint. **Loop xong layer cuối → spec-publisher** (`.agent/spec-publish.md`): sinh `spec/test-scope/current.json` (`trigger: initial-build`) bàn giao template TEST.
> ⭐ **Sau khi build xong**, mọi thay đổi đi qua agent `change-request` (feature + bug).
> Luật cứng/route nhanh → `AGENTS.md`. Giá trị project → `.context/project-config.md`.

## 0. Precedence

1. `AGENTS.md` — luôn thắng.
2. `.agent/FEATURE_WORKFLOW.md` (file này).
3. `.context/project-config.md` — giá trị cụ thể (branch, package manager, lệnh check, model).
4. `.agent/loop.md` — engine thực thi task.

> ⚠️ Ở maintenance mode: cấm push thẳng `forbidden_branch`; state dùng `features[]`/`bugs[]`.

---

## 1. Router

| Intent | Route |
|---|---|
| "fix bug", "lỗi", "broken", regression, crash (bug đã biết) | **§2 Bug workflow** → `/bug` |
| "soi/kiểm tra màn", "cảm giác nhiều lỗi nhưng không rõ" | **§2b Bug discovery (sweep)** → `/bug-check` — read-only |
| "thêm/sửa/bỏ/xóa tính năng", đổi behavior | **§3 Change Request workflow** → `/feature` |
| "implement feature" (đã có spec/task) | gọi subagent `builder` theo task file |
| "review", "check", "soát" | gọi subagent `reviewer` — không tự sửa |
| yêu cầu/bug hậu-build user chat (mode `maintenance`, không gõ lệnh) | **Auto-intake**: ghi `spec/changes/BACKLOG.md` + tạo change doc pending → báo user gõ `/change` |
| hỏi / điều tra | research-only — không edit tới khi user yêu cầu fix |

Không rõ intent → hỏi 1 câu ngắn. **Không tự phân loại thành "chắc là bug nhỏ, sửa luôn".** Trong maintenance mode, yêu cầu/bug rõ ràng → auto-intake vào BACKLOG (xem `spec/changes/BACKLOG.md`), KHÔNG code ngay.

> 📂 **Chi tiết workflow tách ra file con — đọc KHI xử lý đúng loại việc (không nạp sẵn mọi lượt):**
> - **Bug** (`/bug`, `/bug-check`, `/change` class BUG) → đọc `.agent/workflows/bug.md` (§2 Triage→Reproduce→Root cause→Task→Builder/Reviewer→Progress→Test scope; §2b sweep read-only).
> - **Feature/Update** (`/feature`, `/change` class ADDITIVE/MODIFY/REMOVE) → đọc `.agent/workflows/change.md` (§3 Classify→Spec delta→Spec Validator→Phase/Task→Human duyệt→Loop→Phase Review→Progress→Test scope).
> - **Commit/close-out, schema `progress.json`, review report path, check commands, reviewer level, model mapping** → đọc `.agent/workflows/state-commit.md` (§2.8 + §5 + §7).

---

## 4. Phase model

| Phase | Nội dung | Reviewer tập trung |
|---|---|---|
| 1 | Schema / domain (migration, model, types) | migration versioned, không phá dữ liệu cũ |
| 2 | Backend / API (service, route, validation, auth) | contract, OWASP, BOLA/IDOR, lỗi |
| 3 | UI (component, screen, states, responsive) | a11y, responsive nhiều kích thước (mobile-first, tablet), craft-floor |
| 4 | Integration (FE↔BE, auth flow, error/loading) | contract thật, không hardcode shape |
| 5 | Test / UAT (unit, integration, e2e, edge) | coverage path xấu, không false-confidence |

> Không nhảy cóc: schema xong mới API, API xong mới UI, integration xong mới UAT.
> Task có thể gộp phase nếu thật nhỏ — nhưng phải ghi rõ.

### 4b. Skill gates (bổ trợ, risk-based)

Áp dụng khi diff/phase có code phù hợp; reviewer ghi kết quả từng gate vào report.
Repo chưa cài tool / không có app code / không áp dụng → ghi `N/A` hoặc `skip <lý do>`, **không** fail workflow oan.

| Skill | Ai chạy | Gate |
|---|---|---|
| `skills/anti-slop/SKILL.md` | Builder + Reviewer, task đụng TS/JS | `npx oxlint` (khi repo có oxlint config); error mới → FAIL. Bổ trợ `aislop` (mùi nội dung) bằng mùi kiểu dáng code |
| `skills/open-code-review/SKILL.md` | Reviewer, task code change | `ocr review`/`ocr delegate`; **CRITICAL** (XSS/SQLi/NPE/thread-safety) → FAIL, ≥3 MAJOR → FAIL. Chưa cài `ocr` → ghi chú, không chặn PASS |
| `skills/ai-readable-codebase/SKILL.md` | Reviewer mọi phase + Builder khi viết mới | AI-chaos indicators **≥3 → FAIL**; code mới đổi luồng chính phải cập nhật `README.md`/`ARCHITECTURE.md` (worktree song song → ghi Doc Impact note, dispatcher reconcile) |
| `skills/blitzstrike/SKILL.md` | Reviewer Phase 2 STRICT (optional) | pentest live trên môi trường được phép; chỉ finding **STRIKE-validated** mới tính FAIL; chưa cài/không môi trường → bỏ qua |
| `skills/security/codex-security.md` | Reviewer, task nhạy cảm (auth/API/secrets, optional) | `npx @openai/codex-security scan <dir>` — CRITICAL **verified** → FAIL, ≥3 MAJOR → FAIL; chưa login/không network/không cài được → ghi `N/A` + lý do, không chặn PASS |
| `skills/react-native/e2e-maestro.md` | Builder viết E2E + Reviewer task có flow UI | `maestro test .maestro/` trên emulator/simulator; flow fail → FAIL; không có device/môi trường → ghi `N/A`, không chặn PASS |

> Trong bảng trên, gate nào trỏ skill không tồn tại trong repo (vd `ai-friendly-web`, `m3e-canvas`
> — web-only, không port sang mobile) → ghi `N/A, skill không có trong template mobile`.
> Gate `ai-readable-codebase` áp dụng được nếu skill đã được thêm vào repo.

> Thứ tự ưu tiên khi mâu thuẫn: `impeccable` (craft-floor) > `taste-skill-v2`;
> `aislop` (nội dung) + `anti-slop` (kiểu dáng) + `ocr` (bug thật) là 3 lớp bổ trợ, không thay thế nhau.

---

## 5. State & paths

### State — `.context/progress.json` (schema maintenance)
Tối thiểu file phải là:

```json
{
  "mode": "maintenance",
  "activeWorkItem": null,
  "features": [],
  "bugs": []
}
```

Khi có work item, có thể mở rộng trong `features[]` / `bugs[]`:

```json
{
  "mode": "maintenance",
  "activeWorkItem": null,
  "features": [
    { "slug": "", "title": "", "type": "ADDITIVE|MODIFY|REMOVE",
      "status": "planned|in_progress|blocked|architecture_review_needed|done", "currentPhase": 0, "tasks": [] }
  ],
  "bugs": [
    { "slug": "", "title": "", "severity": "blocker|high|medium|low",
      "status": "triaged|reproducing|root_caused|fixing|review|done|blocked|architecture_review_needed",
      "task": "tasks/bug-<slug>/..." }
  ]
}
```
- Tối thiểu: `mode`, `activeWorkItem`, `features`, `bugs`. Có thể thêm `lastUpdated` nếu muốn.
- Status semantics: `blocked` = chặn chung như thiếu info/môi trường; `architecture_review_needed` = đã fail ≥3 attempt, cần review kiến trúc/refactor trước khi sửa tiếp.
- State dùng `features[]`/`bugs[]` + `activeWorkItem`; không dùng field layer cũ (`currentLayer`, `totalLayers`, …)
  trong maintenance mode.
- `activeWorkItem` = `{ type, slug }` của bug/feature đang làm, hoặc `null`.
- Cập nhật progress.json là bước **bắt buộc** (§2.7, §3.9).

### Task
- Feature: `tasks/feature-<slug>/phase-<N>-task-<NN>.md`
- Bug: `tasks/bug-<slug>/phase-<N>-task-<NN>.md`
- Trước khi Builder chạy, task phải có các block: `Classification / Risk`, `Acceptance Criteria`,
  `Verification Plan`, `Retry / Error Memory`, `Doc / Decision Impact`.
- Bug task phải có `Repro Verification`; feature/update task phải có `Feature Verification`.

### Review report
- Task reviewer report phải đúng tên: `.context/review-reports/<feature|bug>-<slug>-phase-<N>-task-<NN>-round-<R>-review.md`.
- Phase-level/spec-validator report khi hết phase: `.context/review-reports/<feature|bug>-<slug>-phase-<N>-round-<R>-review.md` (kèm hậu tố `-spec` nếu là spec-validator).
- Pre-plan spec validation (trước khi chia phase/task): `.context/review-reports/feature-<slug>-spec-validation.md`.
- Quy tắc `round-<R>`: luôn ghi rõ vòng (1, 2, …); không gộp nhiều vòng vào một file; rerun cùng round sau khi bị cancel → **ghi đè** (không tạo file trùng).
- Trước khi set status `done`: kiểm tra report tồn tại bằng slug/path. Không có report → **KHÔNG đóng việc**.

## 6. Cổng chặn (gates)

- **Branch**: default **staging-direct**: làm việc trực tiếp trên `target_branch`; current branch phải là `target_branch` trước khi commit/push. Nếu user yêu cầu feature branch, làm việc trên branch hiện tại (`feature/<slug>` hoặc `bug/<slug>`), push chính branch đó, và chỉ mở PR khi user yêu cầu rõ.
  **Cấm push `forbidden_branch`**, cấm `--force`/`-f` (gate ở `opencode.jsonc` → `permission.bash`).
- **Commit-first close-out**: sau task/bug/phase PASS review + Doc Impact/Reconcile + progress xong,
  commit lên branch hiện tại theo §2.8. FAIL → không commit/push.
- **Push**: mặc định không. Chỉ khi user yêu cầu rõ hoặc `auto_push_after_pass: true`
  (`.context/project-config.md`), theo branch model ở §2.8/§6.
- **Commit hygiene**: trước commit phải `git status` + `git diff`; chỉ stage file thuộc task;
  không stage dirty cũ ngoài scope. Nếu shared file interleave nhiều scope khiến tách commit không an toàn,
  chỉ combined batch commit cho đúng epic đó và ghi rõ lý do.
- **Migration**: chỉ áp dụng khi `db_tool != none` **và** `migration_required: true`;
  versioned + committed; không sửa migration đã apply, tạo migration mới. `db_tool: none` → bỏ qua gate này.
- **Migration high-risk**: trước commit phải inspect `migration.sql` hoặc migration artifact theo `db_tool`.
  Nếu có `DROP TABLE/COLUMN`, đổi type, `SET NOT NULL`, `UNIQUE/FK` trên data cũ, enum phá hoại,
  bulk transform/backfill → gắn `HIGH_RISK_MIGRATION`, **KHÔNG promote production**, báo destructive op,
  table/column ảnh hưởng, tương thích data, backfill, rollback, kết quả verify staging.
- **Migration forbidden ops**: cấm `db push`, `migrate reset`, seed/reset, clone data giữa môi trường cho staging/prod.
  Flow chuẩn: dev → migration versioned → staging deploy theo `migration_command`/`db_tool` đã cấu hình
  → verify → promote đúng migration đã test lên prod.
- **Migration env isolation**: `staging_db` phải khác `prod_db`; data độc lập; không sync data staging→prod.
- **Secrets**: chỉ từ env; không hardcode/commit; không log.
- **UI**: responsive mobile-first (điện thoại → tablet); a11y; đo contrast; không slop (skills UI).
- **Progress bắt buộc**: mọi thay đổi trạng thái bug/feature → update `.context/progress.json`.
- **Close-out report gate**: trước status `done`, grep/check `.context/review-reports/` theo slug và đúng tên
  `<feature|bug>-<slug>-phase-<N>-task-<NN>-round-<R>-review.md` cho task review; phase/spec-validator review dùng
  `<feature|bug>-<slug>-phase-<N>-round-<R>-review.md`. Với feature, kiểm tra thêm report pre-plan
  `feature-<slug>-spec-validation.md`. Không có report → status `blocked`, không commit/push.
- **Commit gate**: sau Reviewer PASS + Doc Impact/Reconcile + report gate, set progress/task status `done`
  như một phần của close-out commit. Trước final response, HEAD commit phải tồn tại và bao gồm trạng thái
  `done`/progress/doc-impact close-out đó. Progress/task file không cần biết SHA của commit đang được tạo.
  Nếu không tạo được commit sau PASS close-out, không báo complete; giữ/set status `blocked` và ghi residual risk/lý do.
- **Doc reconcile**: sau task/bug/phase PASS và trước status `done`, xác định doc impact và reconcile as-built docs:
  API contract/endpoint/response shape → `docs/API_SPEC.md`; schema/model/enum → `docs/ERD.md` + regen
  `docs/generated/*` nếu có; kiến trúc/flow/current behavior → `docs/DESIGN.md` current-state; gap đã giải quyết
  → đổi status gap register. Không đổi contract/schema/behavior tài liệu hoá → ghi rõ `no doc impact`.
  Builder chạy worktree song song → KHÔNG sửa doc dùng chung, chỉ ghi doc delta vào task file; dispatcher reconcile
  1 lần trên integration branch khi merge layer (`AGENTS.md` § Doc Impact & Reconcile Rules, `.agent/loop.md` Merge steps).
- **As-built vs intent**: as-built docs (`docs/API_SPEC.md`, `docs/ERD.md`, `docs/DESIGN.md` current-state,
  generated inventory, gap register status) được reconcile khi code đổi, kèm evidence code. Intent docs
  (`docs/BRD.md`, `docs/PRD.md`, `docs/USER_FLOW.md` target, business rules trong `SPECIFICATIONS.md` nếu có)
  chỉ đổi qua Change Request + user duyệt.
- **Code ≠ intent**: ghi gap vào gap register nếu có (vd `docs/changes/TECHNICAL_REQUIREMENT_GAPS.md`),
  **KHÔNG** hạ cấp intent cho khớp code. Fix code sai rồi sửa doc cho khớp = hợp pháp hoá bug, coi là vi phạm.
- **Docs không nhúng code tay**: API_SPEC/ERD là overview + pointer tới source of truth/generated.

### Tool Loop Guard

- Không chạy lặp cùng 1 shell/search/read command y hệt quá 1 lần.
- Không thử cùng 1 giả thuyết quá 2 lần bằng biến thể gần giống.
- Command/search trả empty hoặc non-zero → ghi nhận kết quả và chuyển hướng; không retry vô hạn.
- Bash bị permission deny → **DỪNG NGAY**: không retry, không đổi biến thể, không vòng qua pipeline;
  chuyển Grep/Read hoặc ghi `Blocked`.
- Không xác minh được → ghi `Residual risk`/`Blocked`, không lặp tool.

### Session handoff & resume (Run Journal)

- **Artifact:** `.context/runs/<type>-<slug>-<phaseTask>.md` (template `.context/runs/_TEMPLATE.md`).
  Primary ghi; subagent không ghi. WIP/checkpoint **KHÔNG** ghi vào task file.
- **Agent attribution (bắt buộc):** TRƯỚC khi gọi subagent ghi `agent: <tên>` vào journal; banner
  `▶ START [agent: X]` / `✅ DONE [agent: X]`; completion report của subagent mở đầu bằng `Agent: <tên>`.
- **Luật đầy đủ:** `AGENTS.md` § Session Handoff (write-ahead checkpoint, banner, Session Start Protocol).
- **Resume matrix** (journal `step`/`status` → việc session mới làm):

  | Cancel ở | journal | Session mới làm |
  |---|---|---|
  | giữa builder | `builder` / `running` | **redo builder** (read-before-write, không revert) |
  | sau builder, trước reviewer | `builder` / `awaiting` | **bỏ builder → chạy reviewer** |
  | giữa reviewer | `reviewer` / `running` | **rerun reviewer** (dọn report dở) |
  | sau reviewer | `reviewer` / `awaiting` | bước kế: `fix` \| `spec_validator` \| `closeout` \| phase sau |
  | giữa `fix` | `fix` / `running` | **redo builder ở chế độ fix** (đọc finding trong report trước) |
  | giữa `spec_validator` | `spec_validator` / `running` | **rerun spec_validator** |
  | giữa `closeout` | `closeout` / `running` | **idempotent close-out** (xem dưới) |

- **Guardrail redo** (bắt buộc khi redo bất kỳ bước):
  - Scope theo `filesTouched`/`filesNew` trong journal — **không revert toàn cục**
    (`checkout --`/`reset --hard` bị deny).
  - Reviewer: **dọn/ghi đè report dở** trước khi rerun.
  - Builder: check side-effect đã lỡ chạy — migration file đã tạo (không tạo lại), generate client,
    test DB local, process/port còn treo.
  - `interrupted ≠ failed attempt` — redo do cancel **không** tăng `attempt`.

- **Close-out idempotent** (tránh double-commit khi cancel giữa close-out):
  1. journal `closeout` / `running`.
  2. Cập nhật `.context/progress.json` (status/phase/task/verdict) — **TRƯỚC** commit,
     để pointer không stale nếu bị cancel giữa chừng.
  3. `git log --oneline` kiểm task đã có commit chưa:
     - chưa có → commit (stage **đúng** file thuộc task) → push theo branch model (§2.8: chỉ khi
       user yêu cầu rõ hoặc `auto_push_after_pass: true`) → 4.
     - đã có commit nhưng chưa push → `push` nếu được phép (§2.8) (**không** commit lại) → 4.
  4. journal `done`.

- **Nguyên tắc:** đĩa là sự thật, pointer (`progress.json`) chỉ là hint; `interrupted ≠ failed attempt`.
- **Report path:** journal lưu `evidence.reportPath` **chính xác** — resume không parse tên file report.
- **Usage gate:** `.context/session-policy.json` (`usageGate`); ở mỗi checkpoint gọi tool `usage()`,
  vượt ngưỡng thì hỏi user End/Làm tiếp (xem `AGENTS.md` § Session Handoff).

### Check commands
Lấy từ `.context/project-config.md` → các field `lint_command`, `typecheck_command`,
`test_command`, `build_command` (mobile dùng alias generic; field `web_*`/`api_*` để null). `check_commands` chỉ là alias tổng hợp
từ các field trên nếu project đã điền.
Ví dụ placeholder (thay bằng lệnh thật khi repo có app code):
```
web typecheck → <configured command or skip, no app configured>
web lint      → <configured command or skip, no app configured>
api typecheck → <configured command or skip, no app configured>
api lint      → <configured command or skip, no app configured>
test          → <configured command or skip, no app configured>
```
Monorepo: filter theo package bị đụng bằng package manager đã cấu hình (vd `<pm> --filter <pkg> ...`).
Nếu chưa cấu hình package manager/test command hoặc chưa có `apps/`, API/web/test → **skip, no app configured**,
không fail workflow và không tự hardcode lệnh.

### Reviewer level (risk-based)
- Reviewer tự chọn `FAST` / `NORMAL` / `STRICT`; mặc định `NORMAL`.
- `FAST` chỉ dùng khi scope rất hẹp, không shared/API/auth/tenant/schema, Builder đã test PASS.
- Bắt buộc `STRICT` nếu có risk đỏ: auth/RBAC/permission; tenant/school/org isolation;
  schema/migration/database; data loss/destructive/bulk update; API contract/DTO/response shape dùng nhiều màn/client;
  shared service/hook/component/API client/cache key/navigation; payment/subscription/entitlement;
  import/export/report; cron/background job/webhook; security/token/session/password/upload/file access;
  root cause chưa rõ; logic quan trọng thiếu test.
- Report bắt buộc có: `Review level`, `Reason`, `Blast radius`, `Verify commands + result`,
  `Findings`, `Verdict PASS/FAIL`.

---

## 7. Model mapping + luật opt-in

### Cách bật model mapping (bắt buộc khi clone template)
1. Khai model từng vai ở `.context/project-config.md` → block `models:`
   (`builder`, `builder_strong`, `reviewer`, `spec_validator`).
2. **Bỏ comment** dòng `model:` trong frontmatter `.opencode/agent/*.md` (hiện đang comment
   `<provider>/<...>` để kế thừa).
3. **Restart opencode** — agent/config **không hot-reload**; chưa restart thì model mới chưa có hiệu lực.
4. Kiểm: `builder ≠ reviewer` (khác họ provider) để lộ blind spot khác nhau; `spec-validator` họ thứ 3 nếu có.

- Nếu **chưa** cấu hình, frontmatter để comment → subagent **kế thừa model chính**
  (builder == reviewer, mất tác dụng tránh bias). Khi cần, chạy lại `0.5.C` rồi restart.
- `reviewer` / `spec-validator` không được sửa source; chỉ được ghi report scoped khi đang review.
- Chạy dạng **subagent** → context sạch, không thừa hưởng completion report của builder.
- **`explore` (built-in)**: subagent kế thừa model/variant của session cha. Nếu cha chạy variant `high`,
  `explore` cũng tốn variant `high` → set override `agent.explore` trong `opencode.jsonc`
  (`model` rẻ hơn + `variant: low`) để tránh đốt reasoning token. Đi kèm rule chống spawn `explore`
  thừa ở `AGENTS.md` § Tool Loop Guard.

### Luật opt-in `builder-strong`
- **CHỈ dùng khi user yêu cầu rõ.** Không tự chọn theo phán đoán "bài này khó".
- Bị chặn cứng ở `opencode.jsonc` → `permission.task."builder-strong": "ask"`.
- ⚠️ Auto-mode (`--auto` / auto-approve) sẽ tự duyệt `ask` → mất gate. Muốn giữ gate, không bật auto.

---

## 8. Human checkpoints

1. **Trước khi code** feature lớn → duyệt phase/task plan.
2. **Hết mỗi phase** → tóm tắt (task done, test, review) → chờ user.
3. **Trước deploy** → chờ user approve production.
4. **Khi bị block** (≥3 retry / không reproduce / nghi ngờ kiến trúc) → dừng, báo user.
