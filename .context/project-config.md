# project-config.md — Cấu hình dự án (canonical)

> **File này do brainstorm quản lý** (`.agent/brainstorm.md` / lệnh `/brainstorm`) — không điền tay,
> không có lệnh setup riêng. Mọi workflow/subagent **đọc giá trị ở đây**, KHÔNG hardcode trong generic docs.
> Nếu field còn placeholder (`<...>`) hoặc `null` → coi như chưa cấu hình, phải **hỏi user**, không bịa.
>
> 💡 Chạy `/brainstorm` để điền/cập nhật. `/brainstorm <nhóm>` chỉ sửa 1 nhóm (vd `git`, `models`).

## Config

```yaml
project: <tên dự án>
output_language: vi            # vi | en — ngôn ngữ cho docs/summary

# ── Git ──
target_branch: <target_branch> # default staging-direct: current branch phải là branch này khi commit/push PASS; chưa điền = hỏi user
forbidden_branch: main         # cấm push trực tiếp (opencode.jsonc hard-deny main/ref main)
branch_pattern: "<target_branch>" # default staging-direct; feature/<slug>|bug/<slug> chỉ khi user yêu cầu feature branch
auto_push_after_pass: false    # ⚠️ KHÔNG phải "tự commit": commit sau PASS luôn BẮT BUỘC. Flag này chỉ = AUTO-PUSH: true = tự `git push origin <target_branch>` sau PASS; false = chỉ commit local, chờ user yêu cầu rõ.

# ── Package / source ──
package_manager: <none|pnpm|npm|yarn|bun>  # none/chưa điền = không hardcode lệnh
source_roots: []               # ví dụ: [src] hoặc [apps, packages]; [] nếu chưa có app code

# ── Verify commands (null/placeholder = skip, no app configured) ──
web_typecheck_command: null
web_lint_command: null
api_typecheck_command: null
api_lint_command: null
test_command: null
install_command: null
lint_command: null          # generic alias if web/api split does not apply
typecheck_command: null     # generic alias if web/api split does not apply
build_command: null
migration_command: null     # only used when db_tool != none and migration_required: true

# ── Database ──
db_tool: none                  # none | prisma | drizzle | other
migration_required: false      # true nếu cần migration versioned (chỉ khi db_tool != none)
staging_db: <env var staging, vd DATABASE_URL_STAGING>   # TÊN ENV VAR, không phải connection string/secret
prod_db: <env var production, vd DATABASE_URL_PROD>       # TÊN ENV VAR; phải khác staging_db
destructive_migration_policy: HIGH_RISK_MIGRATION

# ── Deploy / CI-CD (từ brainstorm; secret nằm ở .env.local) ──
deploy_platform: <vercel|railway|docker-vps|skip>
ci_cd: <github-actions|gitlab-ci|skip>

# ── Monitoring ──
monitor_enabled: false         # true | false
otel_service_name: <tên service trong telemetry>
otel_env: <production|staging>

# ── Worktree hooks (optional — dùng cho parallel loop) ──
# Chạy bởi scripts/parallel-dispatch.mjs. Mục đích: mỗi worktree có DB/ENV RIÊNG để
# test song song không nối chung 1 DB (và không đè .env.local của nhau).
# Có sẵn env: $WORKTREE_PATH (đường dẫn tuyệt đối của worktree), $TASK_ID
# (vd layer-1/task-02), $WORKTREE_SLUG (vd layer-1__task-02). cwd = worktree.
# Rỗng = bỏ qua hook.
worktree_setup_cmd: ""         # chạy SAU khi tạo worktree (tạo DB riêng + ghi .env.local riêng)
worktree_teardown_cmd: ""      # chạy TRƯỚC khi xoá worktree (drop DB tạm, dọn file runtime)
```

### DB / migration

- **`db_tool: none`** → project không dùng DB/ORM: **bỏ qua toàn bộ migration safety rules**.
- `db_tool != none` **và** `migration_required: true` → áp dụng migration gate:
  migration phải versioned + committed, không sửa migration đã apply.
- Không hardcode Prisma/Drizzle: dùng đúng `db_tool` đã khai.
- Trước commit phải inspect migration artifact theo `db_tool`/`migration_command`. Nếu có `DROP TABLE/COLUMN`,
  đổi type, `SET NOT NULL`, `UNIQUE/FK` trên data cũ, enum phá hoại, bulk transform/backfill
  → gắn `HIGH_RISK_MIGRATION`, không promote production, báo destructive op/table/column ảnh hưởng,
  tương thích data, backfill, rollback, kết quả verify staging.
- Cấm `db push`, `migrate reset`, seed/reset, clone data giữa staging/prod.
- `staging_db` phải khác `prod_db`; data độc lập; không sync data staging→prod.

## Check commands (chạy trước khi báo xong)

### Worktree hooks (parallel loop)

`scripts/parallel-dispatch.mjs setup` và `cleanup` gọi 2 hook optional ở trên. Không khai = bỏ qua.
Hook chạy bằng `sh -c` với `cwd = worktree`, env `WORKTREE_PATH`, `TASK_ID`, `WORKTREE_SLUG`.
Hook fail → **cảnh báo rõ nhưng KHÔNG chặn** luồng build/merge (và KHÔNG xoá nhầm worktree).

```yaml
# Postgres: mỗi worktree 1 schema riêng
worktree_setup_cmd: |
  SCHEMA="wt_$(echo "$WORKTREE_SLUG" | tr '[/-]' '___')"
  createdb "$SCHEMA" 2>/dev/null || true
  echo "DATABASE_URL=postgres://localhost:5432/$SCHEMA" > .env.local

worktree_teardown_cmd: |
  SCHEMA="wt_$(echo "$WORKTREE_SLUG" | tr '[/-]' '___')"
  dropdb --if-exists "$SCHEMA"
```

```yaml
# SQLite: mỗi worktree 1 file DB riêng
worktree_setup_cmd: 'echo "DATABASE_URL=file:./.tmp-$WORKTREE_SLUG.db" > .env.local'
worktree_teardown_cmd: 'rm -f ".tmp-$WORKTREE_SLUG.db"'
```

> Mọi người (builder/reviewer) PHẢI dùng đúng lệnh đã cấu hình ở đây, filter theo package bị đụng nếu monorepo.
> Nếu command là `null`/placeholder hoặc repo chưa có app code (`source_roots: []`) → ghi `skip, no app configured`.
> KHÔNG tự suy ra `npm test`, `pnpm lint`, Prisma, package name, hay path `apps/` khi chưa cấu hình.

```yaml
check_commands:
  install: null             # alias of install_command
  web_typecheck: null       # hoặc = web_typecheck_command
  web_lint: null            # hoặc = web_lint_command
  api_typecheck: null       # hoặc = api_typecheck_command
  api_lint: null            # hoặc = api_lint_command
  test: null                # hoặc = test_command
  build: null               # hoặc = build_command
  migration: null           # hoặc = migration_command khi migration_required=true
  docs_inventory: null
```

## Models per role

> Model KHÔNG đọc từ `.env.local`. Khai ở đây rồi **bỏ comment + copy sang frontmatter** của từng file
> `.opencode/agent/*.md`, rồi **restart opencode** (config không hot-reload).
> Quy tắc: **builder ≠ reviewer** (khác họ provider) để lộ blind spot khác nhau.

```yaml
models:
  builder:        <provider>/<model-code-chinh>
  builder_strong: <provider>/<model-manh-hon>     # chỉ dùng khi user yêu cầu rõ (§7 gate)
  reviewer:       <provider>/<model-khac-ho>
  spec_validator: <provider>/<model-ho-thu-3>     # họ thứ 3 nếu có
  change_request: <provider>/<model-plan>          # ⭐ agent hậu-build (classify/spec/task) — cửa vào /change
```

## UI rules (nếu project có UI)

```yaml
ui:
  responsive_breakpoints: [375, 768, 1280]
  max_file_lines: 300
  max_function_lines: 50
```

## Secrets

```yaml
secrets:
  source: env                    # chỉ đọc từ env; KHÔNG hardcode/commit
  required: [DATABASE_URL, JWT_SECRET]
```
