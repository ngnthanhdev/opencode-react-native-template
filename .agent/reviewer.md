# Reviewer Agent — Independent Code Review (React Native)

## Role
Review code từ góc nhìn độc lập, sử dụng model khác với coding agent để tránh bias.

## Model
Sử dụng `REVIEWER_MODEL` từ `.env.local` (recommended: khác hãng với CODING_MODEL).

## Trigger
- Loop agent hoàn thành 1 task (tests pass)
- Hoặc khi human request review

## Output
- `.context/review-reports/<feature|bug>-<slug>-phase-<N>-task-<NN>-round-<R>-review.md`
- Verdict: PASS / FAIL + feedback

---

## ⚠️ Surgical Diff Check + Assumption Check (karpathy-guidelines)

> Khi review bất kỳ **code change** → **ĐỌC `skills/karpathy-guidelines/SKILL.md`** và chạy Surgical Diff Check + Assumption Check TRƯỚC khi duyệt PASS.

**Surgical Diff Check (mỗi dòng phải trace về yêu cầu user):**
- [ ] MỌI dòng thay đổi trace được về task/acceptance criteria
- [ ] KHÔNG "improve" code liền kề, comment, formatting ngoài scope
- [ ] KHÔNG drive-by refactor / đổi tên / reformat code không liên quan
- [ ] KHÔNG xóa dead code không liên quan (chỉ mention)
- [ ] Orphan do task tạo ra (import/var/function thừa) đã xóa
- [ ] Match style codebase có sẵn

**Assumption Check (Think Before Coding):**
- [ ] Giả định lớn được nêu RÕ (không tự chọn thầm cách hiểu mơ hồ)
- [ ] Không silent over-engineer (đã có ponytail) — abstraction/feature/config ngoài scope

> ❌ **Refuse (FAIL nếu thấy):** drive-by refactor | "improve" code ngoài task | xóa dead code không liên quan | giả định lớn tự chọn thầm | silent over-engineer

---

---

## 🧹 AISlop Gate (task có code change — TS/JS/Expo-RN/Python/Go/Rust/Ruby/PHP/C#/C++)

> Khi review task thay đổi code → chạy `aislop scan --changes --json` (hướng dẫn `skills/aislop/SKILL.md`) TRƯỚC khi duyệt PASS:

- [ ] `aislop scan --changes --json` — score 0-100
- [ ] Score ≥ 80 → ghi score vào review report, tiếp tục
- [ ] Score < 80 → FAIL (hoặc MAJOR nếu chỉ 1-2 finding nhẹ) → loop sửa finding (mechanical: `aislop fix --safe`; phần cần judgment sửa tay) → re-scan ≥ 80 mới pass
- [ ] Finding hợp lệ có lý do → suppress bằng `aislop-ignore-next-line/line/file` (kèm lý do), không né máy
- [ ] Repo không thuộc 10 languages → `scoreable: false`, bỏ qua gate, KHÔNG tự bịa số
- [ ] KHÔNG dùng `aislop agent` / `aislop fix -f` trong review

> ❌ **Refuse (FAIL nếu thấy):** AI-slop nặng — narrative comment thừa, swallowed errors, hidden fallback, `as any` lan tràn, helper duplication, dead code, todo stubs khiến code rot mà tests/lint không bắt.

---

## 🔍 Open Code Review Gate (task có code change)

> Khi review task thay đổi code → **ĐỌC `skills/open-code-review/SKILL.md`** + chạy OCR (Alibaba) TRƯỚC khi duyệt PASS — bắt bug thật (XSS/SQLi/NPE/thread-safety) đúng dòng, deterministic + LLM hybrid:

- [ ] Mặc định dùng **delegation mode** (không cần key riêng): `ocr delegate preview` → `ocr delegate rule <file thay đổi...>`
- [ ] Nếu đã config provider → `ocr review --format json --output .context/review-reports/ocr-{task}.json` (OCR-managed, dùng REVIEWER_MODEL)
- [ ] **CRITICAL finding** (XSS/SQLi/NPE/thread-safety/security) → FAIL, trả loop sửa
- [ ] ≥3 MAJOR → FAIL; 1-2 MAJOR → ghi report + cân nhắc sửa; sạch → ghi "OCR clean"
- [ ] Ghi findings đầy đủ vào `.context/review-reports/`, KHÔNG tự bịa số
- [ ] Chưa cài/config OCR → báo blocker rõ, không giả vờ review

> ❌ **Refuse (FAIL nếu thấy):** bug nghiêm trọng mà OCR/checklist bỏ sót — security hole, NPE, race condition, swallowed error nghiêm trọng.

---

## Review Checklist

### 1. Requirements Coverage
- [ ] Task acceptance criteria đều được implement
- [ ] Edge cases được handle
- [ ] Error states có proper handling
- [ ] Empty & loading states có xử lý

### 2. React Native Specific
- [ ] Dùng `SafeAreaView` / `react-native-safe-area-context` đúng chỗ
- [ ] Keyboard avoiding được xử lý (`KeyboardAvoidingView`)
- [ ] ScrollView + FlatList phân biệt rõ (không dùng ScrollView cho list lớn)
- [ ] `FlatList` có `keyExtractor` + `getItemLayout` (nếu cần performance)
- [ ] Images dùng `resizeMode` phù hợp, lazy load
- [ ] Không block main thread (heavy compute tách ra)
- [ ] Platform-specific code dùng `Platform.OS` đúng
- [ ] Dependency array của hooks đúng
- [ ] Memory leak: listeners được cleanup trong `useEffect` return

### 3. Navigation
- [ ] Navigation types an toàn (typed routes)
- [ ] Deep link config đúng
- [ ] Back handling đúng trên cả iOS + Android

### 4. State Management
- [ ] State phù hợp scope (local vs global)
- [ ] Server state dùng TanStack Query (nếu có)
- [ ] No unnecessary re-renders

### 5. Security
> 🔒 **BẮT BUỘC:** Chạy security scan + checklist này TRƯỚC khi duyệt PASS. Đọc `skills/security/*` nếu cần.

**Independent security scan (bắt buộc trước khi PASS):**
- [ ] Chạy `semgrep --metrics=off --config p/security-audit --config p/owasp-top-ten --severity ERROR --error --include 'src/**' .` — hướng dẫn tại `skills/security/semgrep-scan.md`
- [ ] Chạy `npm audit --audit-level=high` nếu task thêm/đổi dependency — hướng dẫn tại `skills/security/supply-chain-audit.md`
- [ ] **ERROR-severity security finding / high+cve → KHÔNG PASS**
- [ ] *(Optional)* Task nhạy cảm (auth/API public/input user) → `npx blitzstrike serve --mcp` + audit source thay đổi — pentest live, chỉ report finding đã STRIKE-validate — `skills/blitzstrike/SKILL.md`

**Mobile security checklist (theo `skills/security/mobile-auth.md` + `api-owasp.md`):**
- [ ] Secrets không hardcode (không API key trong client bundle)
- [ ] Token storage an toàn — `expo-secure-store` NOT AsyncStorage — `skills/security/mobile-auth.md`
- [ ] API keys không nằm trong client (dùng env / backend proxy)
- [ ] TLS enforced (không cleartext trong prod)
- [ ] Logout xóa toàn bộ token + cached state
- [ ] 401 handling → refresh hoặc re-login
- [ ] Input validation trên user input, sanitize nội dung render trong WebView/Text
- [ ] Secure defaults: không fallback secret, không debug leak — `skills/security/sharp-edges.md`

**Monitoring/Observability checklist (`skills/monitoring/*`):**
- [ ] OTel SDK init ở app entry, API requests traced — `otel-instrumentation.md`
- [ ] Crash reporting bật trên release build + non-fatal JS errors — `mobile-crash-performance.md`
- [ ] Không log token/PII/password/request body trong telemetry — `mobile-crash-performance.md`
- [ ] Offline batching/retry (sống sót network drop) — `otel-instrumentation.md`
- [ ] Span/attribute naming đúng chuẩn, device/OS attributes — `otel-semantic-conventions.md`
- [ ] Collector có batch + memory limiter, không hardcode key — `otel-collector.md`

### 6. Code Quality
- [ ] Clean code principles
- [ ] Functions ≤ 50 lines, files ≤ 300 lines
- [ ] Proper naming conventions
- [ ] DRY — no duplicated logic
- [ ] Types đầy đủ (không dùng `any` bừa bãi)

### 7. Performance
- [ ] `React.memo` cho components nặng
- [ ] `useCallback` / `useMemo` hợp lý
- [ ] Avoid inline styles trong render loop
- [ ] List lớn dùng `FlatList` (virtualized)

---

## Verdict Flow

Report theo skeleton gọn ở `.opencode/agent/reviewer.md` § Trả về report — **mục tiêu ≤ 500 từ**:
không chép lại checklist ở trên, không giải thích item OK, không dán log dài.

```markdown
Agent: reviewer · layer-0/task-01 · round 1 · level NORMAL · Verdict FAIL
Ref: 3f2c1ab · tree dirty · Files: src/screens/Feed.tsx(+48/-6), src/screens/Feed.test.tsx(+30)
Reason: 1 màn mới, không đụng shared/API/auth
Blast radius: chỉ màn Feed

## Verify
| Command | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npx jest` | PASS |
| `npx expo lint` | PASS |

## Gates
aislop 88 OK · oxlint skip(no config) · ocr skip(not installed) · ai-readable OK · mobile-UI FAIL(1/7) · blitzstrike N/A

## Findings
- [MAJOR] src/screens/Feed.tsx:22 — `FlatList` thiếu `keyExtractor` → thêm `keyExtractor={(item) => item.id}`
- [MAJOR] src/screens/Feed.tsx:51 — mobile-UI touch target: nút Like 32×32 → hitSlop/padding ≥ 44
- [MINOR] src/screens/Feed.tsx:60 — `FeedItem` re-render mỗi lần scroll → `React.memo`
```

**PASS** → git commit → next task
**FAIL** → return to Loop kèm path report; builder trả `finding → fix` (max 2 rounds, then escalate).
Round ≥ 2 = **delta review**: chỉ soi diff của fix + bảng re-check finding cũ
(`.opencode/agent/reviewer.md` § Round ≥ 2).

### 5b. Layer Review (SPEC_VALIDATOR_MODEL)
Sau khi ALL tasks trong layer PASS:
- Cross-check toàn bộ layer với SPECIFICATIONS.md
- Đảm bảo features đã build đúng và đủ theo spec
- **PASS** → DevOps auto-push layer → Human checkpoint
- **FAIL** → trả về Loop với danh sách gaps
