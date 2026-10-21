# Session Handoff (Run Journal) — đọc khi bắt đầu session, gọi subagent, resume

> Tách nguyên văn từ section "Session Handoff (Run Journal)" cũ của `AGENTS.md` (không nạp tự động mọi lượt).
> Hiệu lực ngang `AGENTS.md` (xem `AGENTS.md` § Precedence). Resume matrix + close-out idempotent:
> `.agent/FEATURE_WORKFLOW.md` § Session handoff & resume.
> **Primary đọc file này** đầu mỗi session, trước khi gọi subagent đầu tiên, khi chạy `/resume`, và sau auto-compact.

Mục tiêu: **dừng ở bất kỳ ranh giới step, mở session mới làm tiếp** — không mất code, không lạc step,
worst case **redo đúng 1 step**. Resume là **tái dựng** từ artifact, **không** phải nối tiếp lossless.

**Artifact:** `.context/runs/<type>-<slug>-<phaseTask>.md` (template: `.context/runs/_TEMPLATE.md`).
Primary ghi journal; **subagent không ghi**.

**Write-ahead checkpoint (bắt buộc):**
1. TRƯỚC khi gọi subagent: ghi `step=<bước>, status=running`, snapshot `filesTouched`/`filesNew`
   từ `git status --short`, in `▶ START <bước> <phaseTask>`.
2. SAU khi subagent trả về: ghi `status=awaiting`, `evidence`, `next`, cập nhật manifest,
   **rồi mới** in `✅ DONE <bước> <phaseTask>`. Ghi journal **TRƯỚC** khi in `✅ DONE`.
3. `✅ DONE` là **điểm dừng an toàn**. `▶ START ... running` mà cancel → session sau **redo bước đó**.
4. **Gộp lần ghi thừa:** khi cần ghi journal/progress mà lần ghi trước **liền kề và không kèm mốc bắt buộc** (không phải "trước/sau khi gọi subagent", không phải close-out task/phase, không phải ngay trước commit) → **gộp vào lần ghi kế tiếp**, KHÔNG tạo thêm lượt model riêng. Vẫn bắt buộc giữ nguyên: ghi `status=running` TRƯỚC mỗi subagent và `status=awaiting` + evidence SAU mỗi subagent; `progress.json` phải cập nhật TRƯỚC mỗi commit.

**Banner:** mỗi checkpoint in `▶ START` / `✅ DONE` kèm `[agent: <tên>]` + `phaseTask` + `next`; khi `status=running`
ghi rõ "cancel sẽ redo bước này". Completion report của subagent **bắt buộc mở đầu bằng `Agent: <tên>`**
(`builder`, `builder-strong`, `reviewer`, `design`, `graph`, `spec-init`, `spec-publisher`, `spec-validator`, `change-request`).

**Session Start Protocol (đầu mỗi session):**
1. Đọc journal của `activeWorkItem` trong `.context/progress.json` (không có journal → coi pointer là hint).
2. Reconcile với đĩa: `git status --short` (so manifest → file lạ = nhiễm chéo), `git log --oneline`
   (task đã commit chưa), `evidence.reportPath` (reviewer đã chạy chưa, round mấy).
3. In **Resume Briefing**: workItem, step, dirty files vs manifest, evidence, `next` → rồi mới làm.
4. **Đĩa là sự thật, pointer là hint.** Lệch → theo đĩa; bước mơ hồ → redo bước đó.

**Redo policy:** cắt ngang `builder`/`reviewer` → **redo nguyên bước**. Redo là chạy lại **trên đĩa**
(đọc file + `git diff` trước khi sửa), **không revert** (`git checkout --` / `reset --hard` bị deny).
Dọn report dở trước khi rerun reviewer.
**`interrupted ≠ failed attempt`** — redo do cancel **KHÔNG** tăng `attempt`.

**Loop signal:** thấy cùng lỗi lặp ≥ 2 lần → ghi `loopSignal` vào journal + escalate
`architecture_review_needed`, không tự redo vô hạn.

**Sau auto-compact:** phải **re-read journal** từ đĩa, không tin trí nhớ tóm tắt.

**Usage gate (safe-point theo ngưỡng):** policy ở `.context/session-policy.json`
(`usageGate: {enabled, threshold, minStepsLeft, hardThreshold}`). Ở mỗi checkpoint, gọi tool `usage()`
(plugin `loop-guard`); nếu `percent ≥ threshold` **và** còn ≥ `minStepsLeft` bước (hoặc `percent ≥ hardThreshold`)
→ hỏi user bằng `question` tool: `[End — mở session mới] / [Làm tiếp] / [Tiếp, đừng hỏi tới hardThreshold]`.
Chọn End → in Resume Briefing + dòng `/resume <type>/<slug>` để copy sang session mới, rồi dừng turn.
