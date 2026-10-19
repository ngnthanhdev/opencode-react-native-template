# 📱 AI-Powered Project Template (React Native)

> A model-agnostic multi-agent template for **mobile repos that already have code** (bug/feature/update).

> 📌 **Workflow:** type **once** `/start` — the chain **runs continuously, auto-advancing between steps**: read spec (`/spec-init` if missing) → brainstorm (clarify requirements + config) → design (design tokens + screen specs) → graph (split into layers/tasks) → **loop** → `/change` for all subsequent changes (the `change-request` agent). It only **STOPS at checkpoints** for approval; **you never re-type a command for each step**.
>
> ⭐ **Once a spec exists, EVERY change (new feature + bug fix) goes through ONE agent: `change-request`.**
> Entry points: **`/change`** (reads all `spec/changes/*.md`) · `/bug` · `/feature`.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Works with](https://img.shields.io/badge/Works%20with-Cursor%20%7C%20Opencode%20%7C%20Windsurf%20%7C%20Copilot-blue)](https://opencode.ai)

---

## 📋 Table of Contents

- [Getting Started](#getting-started)
- [Overview](#overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Workflow Router (maintenance)](#workflow-router-maintenance)
- [🔒 Security Integration](#-security-integration)
- [📊 Monitoring Integration](#-monitoring-integration)
- [⚙️ Workflow Skills Integration](#️-workflow-skills-integration)
- [How It Works](#how-it-works)
- [Agent Roles](#agent-roles)
- [Smoke Test Without App Code](#smoke-test-without-app-code)
- [Agent Models](#agent-models)
- [Git & CI/CD](#git--cicd)
- [Change Requests](#change-requests)
- [License](#license)

---

## Getting Started

### New project

```bash
# 1. Copy the template into your project folder
git clone <template-repo-url> my-app && cd my-app

# 2. Open opencode
opencode

# 3. (Recommended) Set per-role models:
#    edit .context/project-config.md → models:, then uncomment the `model:` line in .opencode/agent/*.md

# 4. Start the project
/start
```

`/start` runs the whole init chain and stops only at checkpoints:

```
read spec → brainstorm → design → graph → loop (build)
```

Type `/start` **once** — the chain advances on its own. Reply **"ok"** at each checkpoint to continue.
Once the build is done, use **`/change`** for every change (new feature or bug fix).

> ⚠️ After editing `.opencode/` or `opencode.jsonc`, restart opencode (config is not hot-reloaded).

### Commands

| Command | When to use |
|---|---|
| `/start` 🚀 | Start a project (once) — runs read spec → brainstorm → design → graph → loop |
| `/change` ⭐ | Change something after the build (feature + bug) |
| `/bug-check <area>` | Sweep an area read-only and list defects |
| `/resume <type>/<slug>` | Continue an unfinished session |

> Smoke test for the empty template → `docs/smoke-tests/MAINTENANCE_TEMPLATE_SMOKE.md`.

### Resuming a session

```
Read AGENTS.md and resume the project
# or:  /resume feature/<slug>   /resume bug/<slug>
```

The agent reads `.context/progress.json` + the Run Journal `.context/runs/<type>-<slug>-<phaseTask>.md` and continues from the last checkpoint.

### Syncing template updates into an existing project

A project is a copy of this template. When the template changes (new rules, agents, commands, skills), sync the **template-owned files** into your project with one command — **without touching your code, spec, docs, or config**:

```bash
node scripts/template-sync.mjs          # from inside the project
# ─ or ─
node /path/to/template/scripts/template-sync.mjs --project /path/to/project
```

- Overwrites only: `AGENTS.md` · `.agent/` · `.opencode/` · `scripts/` · `skills/`
- **Never touches**: your code, `SPECIFICATIONS.md`, `BRIEF.md`, `docs/`, `spec/`, `tasks/`, `.context/`, `.devops/`, `.env*`, `README.md`, `opencode.jsonc` (only reported if drifted)
- Safe: it **stops** if a managed path has uncommitted changes in your project; every change lands in git (`git diff` / `git checkout -- <path>` to undo)
- Preview first: `node scripts/template-sync.mjs --dry-run` · Remove files dropped upstream: `--prune` · Custom source: `--template <git-url>` · Optional per-project config: `.template-sync.json`

## Overview

This template provides a **multi-agent workflow** for **mobile repos that already have code** (bug / feature / update). Start with `/start` (type once, runs continuously): read spec → brainstorm (clarify requirements + config) → design (tokens + screen specs) → graph (split layers/tasks) → loop executes independent tasks **in parallel** (worktree-per-task, then the dispatcher merges) → `/change` for all subsequent changes (the `change-request` agent). `AGENTS.md` routes every request; specialized subagents handle build, independent review, spec validation, and close-out.

**Key features:**
- 🧭 **Intent router** — `AGENTS.md` classifies every request (bug / sweep / feature / review / research) before any code is touched
- 🔒 **Bug discipline** — root cause before fix (Iron Law), repro verification, no fix-by-symptom
- 🧩 **Change Request workflow** — classify ADDITIVE/MODIFY/REMOVE → spec delta → phase/task → build/review/validate
- 🤖 **Model-agnostic** — works with any AI tool (Cursor, Opencode, Windsurf, GitHub Copilot); roles are real subagents in `.opencode/agent/`
- 🔍 **Independent review** — reviewer / spec-validator run as separate subagents (`edit: deny`) with different models to reduce bias
- 💾 **Session handoff** — Run Journal in `.context/runs/` + `/resume`, so a new session continues from the last safe step
- 🧠 **Error memory** — agents learn from mistakes, avoid repeating them
- 📱 **Expo-first** — built on Expo + Expo Go, EAS Build for production
- 🗜️ **Auto context compaction** — context compressed every 3 tasks and after each layer

---

## Architecture

This template combines **4 architectural patterns**:

| Pattern | Role |
|---------|------|
| **Event-Driven** | Classify intent, route to correct agent |
| **Graph** | Dependency-driven layer breakdown (Layer 0 → 1 → 2 → ...) |
| **Loop (ReAct)** | Execute tasks, test, fix, retry until passing |
| **Blackboard** | Shared state in `.context/` — enables pause/resume |

---

## Project Structure

```
project-template/
├── AGENTS.md                     ← ✅ Entry point (router) — always loaded
├── SPECIFICATIONS.md             ← Canonical spec (built by /spec-init from code)
├── opencode.jsonc                ← Permission gate (builder-strong = ask)
├── .env.local                    ← Git/deploy secrets (gitignored)
├── .env.local.example            ← Template for .env.local
│
├── .opencode/
│   ├── agent/
│   │   ├── builder.md            ← Default code+test (main coding model)
│   │   ├── builder-strong.md     ← Hard task (opt-in only; gated)
│   │   ├── change-request.md     ← ⭐ the ONLY agent for all changes (feature + bug)
│   │   ├── design.md             ← Design Agent: design tokens + screen specs
│   │   ├── graph.md              ← Split spec/design into layers + tasks
│   │   ├── spec-init.md          ← reverse-engineer spec for an EXISTING project
│   │   ├── spec-publisher.md     ← auto-publish spec + test-scope for the test template
│   │   ├── reviewer.md           ← Independent review (edit: deny)
│   │   └── spec-validator.md     ← Spec/phase cross-check (edit: deny)
│   ├── command/
│   │   ├── start.md              ← /start → continuous init chain (spec → brainstorm → design → graph → loop)
│   │   ├── brainstorm.md         ← /brainstorm → clarify requirements + project config
│   │   ├── design.md             ← /design → design tokens + screen specs
│   │   ├── graph.md              ← /graph → split into layers/tasks + layer-plan diagram
│   │   ├── change.md             ← /change → post-build change request (reads spec/changes/ → agent change-request)
│   │   ├── bug-check.md          ← /bug-check → read-only sweep, list defects
│   │   ├── bug.md                ← /bug  → fix ONE known bug (→ agent change-request)
│   │   ├── feature.md            ← /feature → Change Request workflow (→ agent change-request)
│   │   ├── spec-init.md          ← /spec-init → reverse-engineer spec for an EXISTING project
│   │   ├── spec-publish.md       ← /spec-publish → publish spec for the test template
│   │   └── resume.md             ← /resume → continue from Run Journal (cross-session)
│   └── plugins/loop-guard.ts     ← Doom-loop guard + usage() gate
│
├── spec/                         ← Spec versioning + change requests
│   ├── CHANGELOG.md              ← spec version history
│   ├── updates/                  ← 1 file / update (spec delta)
│   ├── archive/                  ← spec frozen per release
│   ├── changes/                  ← ⭐ post-build change requests (pending → archive)
│   └── test-scope/current.json   ← handoff contract for the test template
│
├── docs/                         ← Drop your project docs here (optional)
│   ├── INDEX.md                  ← Canonical vs historical classification
│   ├── BRD.md                    ← Business requirements (template)
│   ├── DESIGN.md                 ← Design spec / Figma notes (template)
│   ├── API_SPEC.md               ← API overview + pointer (no hand-embedded code)
│   ├── ERD.md                    ← Schema overview + pointer
│   ├── PERMISSION.md             ← Roles + guard order (synced from code)
│   ├── smoke-tests/              ← MAINTENANCE_TEMPLATE_SMOKE.md (template, no app code)
│   └── generated/                ← AUTO-GENERATED inventory (do not edit)
│       └── inventory.md
│
├── scripts/
│   ├── generate-inventory.mjs         ← Deterministic inventory generator
│   ├── detect-profile.mjs             ← Detect stack → suggest project-config (used by /brainstorm)
│   ├── apply-verify-permissions.mjs   ← Sync verify-command allow rules into reviewer/spec-validator
│   └── template-sync.mjs              ← One-command sync of template-owned files into a project (see Getting Started → Syncing)
│
├── .agent/
│   ├── FEATURE_WORKFLOW.md       ← ✅ Workflow entry (bug/feature/update) — minimal; details in workflows/
│   ├── workflows/                ← Detailed per-workflow files (loaded on demand, not every turn)
│   │   ├── bug.md                ← §2 Bug workflow + §2b bug discovery sweep
│   │   ├── change.md             ← §3 Change Request workflow (feature / update)
│   │   └── state-commit.md       ← §2.8 commit-first + §5 state/paths + §7 model mapping
│   ├── brainstorm.md             ← ✅ Read spec/code → clarify requirements + set config → .context/project-config.md
│   ├── design.md                 ← Design Agent: design tokens + screen specs (before layer split)
│   ├── graph.md                  ← Split spec/design → layers + tasks (dependency order)
│   ├── loop.md                   ← Execute tasks in parallel (ReAct, worktree-per-task, dispatcher merges)
│   ├── devops.md                 ← Git init, EAS build, store deploy
│   ├── rollback.md               ← Git checkpoint + revert strategy
│   ├── blackboard.md             ← Shared state (.context/progress.json is the source of truth)
│   ├── context-manager.md        ← Compress context when it grows too large
│   ├── references/               ← taste-skill-v2.md (anti-slop design reference)
│   ├── spec-validator.md         ← Validate spec vs code/docs
│   ├── spec-init.md              ← /spec-init: reverse-engineer spec for an EXISTING project
│   ├── spec-publish.md           ← /spec-publish: publish spec + test-scope
│   ├── reviewer.md               ← Independent code review
│   ├── error-analyzer.md         ← Root cause analysis + error memory
│   └── change-request.md        ← ⭐ the ONLY agent for all changes (feature + bug) — reads spec/changes/
│
├── skills/
│   ├── react-native/
│   │   ├── conventions.md        ← Coding style, folder structure
│   │   ├── stack.md              ← Libraries, tools, versions
│   │   ├── patterns.md           ← Navigation, state, API, testing patterns
│   │   ├── common-errors.md     ← Known issues + fixes
│   │   ├── SKILL.md             ← Wrapper skill (frontmatter)
│   │   ├── e2e-maestro.md       ← Maestro E2E testing (YAML flows)
│   │   └── design-tokens.md     ← Design tokens (generated by Design Agent)
│   ├── security/                 ← 🔒 Security skills (mandatory)
│   │   ├── semgrep-scan.md          ← Static analysis security scan
│   │   ├── api-owasp.md             ← OWASP API Top 10 checklist
│   │   ├── mobile-auth.md           ← Token storage & mobile auth hardening
│   │   ├── sharp-edges.md           ← Secure defaults & footgun config
│   │   ├── supply-chain-audit.md    ← dependency audit + dependency risk
│   │   └── codex-security.md        ← OpenAI Codex Security CLI scan/fix (AI-driven, curated)
│   └── monitoring/               ← 📊 Monitoring skills (mandatory)
│       ├── otel-instrumentation.md  ← OTel traces/metrics/logs (RN)
│       ├── mobile-crash-performance.md ← Crash reporting + performance
│       ├── otel-collector.md        ← Collector config (receivers/exporters)
│       ├── otel-semantic-conventions.md ← OTel naming compliance
│       ├── production-monitoring.md ← Release health, alerting, secure logs
│       └── eas-observe.md          ← EAS Observe: startup perf (TTI/launch) production for Expo/EAS
│   ├── superpowers/             ← 🧠 Debug Iron Law + TDD test-first (obra/superpowers)
│   ├── brainstorming/           ← 💬 Clarify requirements → propose approaches → design doc before coding (the "clarify" half of /brainstorm)
│   ├── archify/                 ← 🗺️ Diagram (architecture/workflow/dataflow) → self-contained HTML (tt-a1i/archify, curated)
│   ├── ponytail/                ← 🪶 Lazy senior dev ladder, avoid over-engineering
│   ├── impeccable/              ← 🎨 UI craft-floor + polish gate (pbakaus) — mobile UI
│   ├── anti-slop/               ← 🧬 Oxlint rules against low-evidence TS/JS (dmmulroy/anti-slop)
│   ├── ai-readable-codebase/    ← 🧠 Code for 2 readers (human + AI) — README+ARCHITECTURE
│   ├── scalability-architecture/ ← 📦 OPTIONAL scalability tiers — only when user enables the option
│   ├── karpathy-guidelines/      ← ✂️ Surgical changes + think before coding (andrej-karpathy-skills)
│   ├── aislop/                   ← 🧹 AI-slop detection gate (scanaislop/aislop, curated)
│   ├── open-code-review/         ← 🔍 Alibaba OCR gate (alibaba/open-code-review, curated) — CRITICAL → FAIL
│   └── blitzstrike/              ← ⚡ MCP pentest toolbelt (shinthink/blitzstrike, curated) — optional security
│
├── tasks/                        ← Maintenance task board
│   ├── README.md                 ← Task file format + rules
│   ├── feature-<slug>/phase-<N>-task-<NN>.md
│   └── bug-<slug>/               ← scan.md (/bug-check) + phase-<N>-task-<NN>.md
│
├── .context/
│   ├── progress.json             ← Current work-item status (features[] / bugs[])
│   ├── session-policy.json       ← Usage gate thresholds (loop-guard)
│   ├── runs/                     ← Run Journal per task (cross-session resume)
│   │   └── _TEMPLATE.md
│   ├── project-config.md         ← ✅ Project config (branch, pm, checks, DB, models) — written by /brainstorm
│   ├── decisions.md              ← Architecture decisions log
│   ├── spec-notes.md             ← Spec build notes (/spec-init)
│   ├── error-memory.md           ← Errors encountered + fixes
│   └── review-reports/           ← Reviewer / spec-validator reports
│
└── .devops/
    ├── templates/
    │   ├── eas-preview.md        ← EAS Preview (internal distribution)
    │   ├── eas-production.md     ← EAS Store submit (App Store + Play Store)
    │   ├── eas-expo.md           ← EAS/Expo setup notes
    │   └── github-actions-eas.md ← CI build via GitHub Actions
    ├── environments.md
    └── deploy-log.md
```

---

## Workflow Router (maintenance)

`AGENTS.md` (always loaded) classifies every request before any code:

| Intent (user says…) | Route |
|---|---|
| "fix bug", "broken", crash (known bug) | **`/change`** or **`/bug`** — agent `change-request` (class BUG): root cause → fix → review |
| "sweep a screen", "feels like many bugs" | **`/bug-check`** — READ-ONLY sweep, list defects, then stop and wait for approval |
| "add/modify/remove a feature" | **`/change`** or **`/feature`** — agent `change-request` (class ADDITIVE/MODIFY/REMOVE) |
| a change already written in `spec/changes/` | **`/change`** — read all pending files → agent `change-request` |
| "implement feature" (spec/task already exists) | **builder** subagent per task file |
| "review / check" | **reviewer** subagent — never edits code |
| question / investigation | research-only — no edits |

Unclear intent → ask one short question, don't guess. Details: `AGENTS.md` + `.agent/FEATURE_WORKFLOW.md`.

## 🔒 Security Integration

The template ships with built-in security rules (read and applied mandatorily by multiple agents) to ensure the generated code meets security standards.

### Skills (`skills/security/`)

| Skill | Purpose |
|-------|---------|
| `semgrep-scan.md` | Static analysis security scan before commit |
| `api-owasp.md` | OWASP API Top 10 checklist for every endpoint |
| `mobile-auth.md` | Token storage (`expo-secure-store`) + mobile auth hardening |
| `sharp-edges.md` | Secure defaults & footgun config/secret/storage |
| `supply-chain-audit.md` | `npm audit` + dependency takeover risk |
| `codex-security.md` | OpenAI Codex Security CLI — AI-driven scan/fix (curated, optional) |

### 3 Mandatory Checkpoints

1. **When coding** (`loop.md`) → read the security skill before writing any file that handles auth/storage/input/API
2. **When reviewing** (`reviewer.md`) → run semgrep + `npm audit` + mobile security checklist before PASS
3. **When pushing** (`devops.md`/CI) → `npm audit --audit-level=high` + semgrep scan in CI

> 🔴 ERROR-severity security finding or high/critical CVE → **DO NOT PASS / do not merge**.

---

## 📊 Monitoring Integration

The template ships with built-in production monitoring (release health + runtime observability) based on **OpenTelemetry** — vendor-neutral, plus crash/performance tracking for mobile.

### Skills (`skills/monitoring/`)

| Skill | Purpose |
|-------|---------|
| `otel-instrumentation.md` | OTel traces/metrics/logs for React Native (network, screens) |
| `mobile-crash-performance.md` | Crash reporting + JS/native errors + performance |
| `otel-collector.md` | Collector config (receivers/processors/exporters) |
| `otel-semantic-conventions.md` | OTel naming compliance (span/attribute) |
| `production-monitoring.md` | Release health, alerting, secure logs, offline batch |
| `eas-observe.md` | EAS Observe — startup perf (TTI/TTR/launch/frame drops), per-route timings, CLI query (Expo/EAS) |

### Keys setup (Phase 0.5)

Monitor keys/tokens (OTLP endpoint, service name, Sentry DSN) are stored in `.env.local` during `/brainstorm`.

### 3 Mandatory Checkpoints

1. **When coding** (`loop.md`) → read the monitoring skill before writing API/network/performance/logging files
2. **When reviewing** (`reviewer.md`) → check crash capture, no PII in telemetry, OTel naming before PASS
3. **When pushing** (`devops.md`) → verify OTel init + env keys in Health Check

---

## ⚙️ Workflow Skills Integration

The template ships with curated workflow skills (curated from well-known open-source repos — picking the essence, not copying verbatim) to raise code quality throughout the pipeline. These are stack-agnostic methodologies, applicable to React Native.

### Skills (`skills/`)

| Skill | Source | When used / Purpose |
|-------|-------|---------------------|
| `superpowers/` | obra/superpowers (270k⭐) | Every coding task — **Iron Law debug** (no fix without root cause) + **TDD test-first** |
| `brainstorming/` | curated (in-house) | **Before coding** a feature/big change — clarify requirements one question at a time, propose 2-3 approaches + trade-offs, present the design, write `docs/specs/*-design.md`, get user approval before implementing (HARD-GATE). The "clarify" half of `/brainstorm` |
| `archify/` | tt-a1i/archify (curated, MIT) | **Diagrams** — architecture/workflow/sequence/dataflow → self-contained HTML (dark/light, export PNG/SVG). Used in brainstorm (arch gap), design (design-spec), graph (layer-plan diagram) |
| `ponytail/` | DietrichGebert/ponytail (100k⭐) | Loop while implementing — **lazy senior dev ladder**, stop at the simplest solution, avoid over-engineering |
| `aislop/` | scanaislop/aislop (curated, MIT) | Reviewer reviews **code changes** — deterministic AI-slop scan (narrative comments, swallowed errors, hidden fallbacks, `as any`, duplication, dead code, todo stubs), score 0-100 ≥80 gate, `fix --safe` mechanical, offline no API key |
| `open-code-review/` | alibaba/open-code-review (curated, Apache-2.0) | Reviewer reviews **code changes** — hybrid deterministic + LLM code review, precise line-level comments, built-in ruleset (NPE, thread-safety, XSS, SQLi). Delegation mode = no API key needed; CRITICAL finding → FAIL |
| `blitzstrike/` | shinthink/blitzstrike (curated, MIT) | Reviewer — **optional** MCP pentest toolbelt (BLITZ recon → EAGLE-EYE source trace → STRIKE live validate). Sensitive tasks (auth/API/input) → only report live-verified findings |
| `security/codex-security.md` | openai/codex-security (curated, npm `@openai/codex-security`) | Reviewer for sensitive tasks (optional) — AI-driven scan/fix; **CRITICAL verified** → FAIL, ≥3 MAJOR → FAIL; not logged in / no network → mark `N/A`, do not block PASS |
| `react-native/e2e-maestro.md` | mobile-dev-inc/maestro (curated, Apache-2.0) | Builder writes E2E + Reviewer — YAML flows (`launchApp`/`tapOn`/`assertVisible`) run `maestro test .maestro/`; flow fails → FAIL; no device/environment → mark `N/A` |

### 3 Mandatory Checkpoints

1. **When debugging** (`error-analyzer.md`) → Iron Law: **NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST**. Read `superpowers/systematic-debugging.md` before proposing a fix. ≥3 failed fixes = suspect the architecture, don't try fix #4
2. **When implementing** (`loop.md`) → TDD test-first (`superpowers/test-driven-development.md`) + ponytail ladder; test fails → write minimal code to pass
3. **When reviewing** (`reviewer.md`) → confirm test-first was followed, no over-engineering (YAGNI/DRY)

> 💡 `ui-ux-pro-max` (web design intelligence) does not apply to RN — mobile uses design tokens from the Design Agent. `impeccable` (UI craft-floor) **does apply** to mobile UI review (see Mobile UI Checklist Gate).

---

## How It Works

> 📌 **Start a project:** type **once** `/start` — the chain **runs continuously, auto-advances between steps**: read spec (`/spec-init` if missing) → brainstorm (clarify requirements + design doc + config) → design (design spec + tokens) → graph (split into layers/tasks) → **loop**. It only **STOPS at checkpoints** for approval; **you never re-type a command for each step**.
> Once the build is done → `/change` for all changes. `/brainstorm`, `/design`, `/graph` are **manual overrides** (run them by hand when you want to re-run one step).

### Pipeline

```
🚀 /start  (type once — the chain runs continuously, auto-advances, stops only at ⏸ checkpoints)
├─ 1. Read spec    → use it if it exists; otherwise /spec-init; then spec-validator      ⏸ (validator must PASS)
├─ 2. Brainstorm   → design doc docs/specs/ + config .context/project-config.md          ⏸ approve design
├─ 3. Design       → design tokens + screen specs .context/design-spec.md                ⏸ confirm tokens
└─ 4. Graph        → tasks/<slug>/layer-N-task-NN.md + layer-plan diagram                ⏸ approve plan
    │
    ▼  (auto-continues after you reply "ok")
Loop Agent — execute tasks in PARALLEL (ReAct per task, worktree-per-task)
├─ Dispatcher  plan --layer N → split into parallel waves (by file independence)
├─ per task (SPAWNED IN PARALLEL, each in its own git worktree):
│    ├─ 5a Builder   code + test (TDD)
│    ├─ 5b Observe   tsc / lint / jest / expo build
│    ├─ 5c Error Analyzer → fix → retry (max 3)
│    ├─ 5d Reviewer  independent review (different model)
│    └─ commit inside worktree
└─ 5e Merge     dispatcher merges all task branches → verify whole layer → write progress.json once → cleanup
    │
    ▼
⏸ Human Checkpoint → next layer (Layer N+1 only unlocks when Layer N PASSes + you approve)
   (DevOps agent: git init/CI-CD at layer 0, CI checks after each layer, EAS build/store submit at the final layer)

────────── Afterwards: all changes ──────────
spec/changes/<file>.md → /change → agent change-request
├─ classify: BUG / ADDITIVE / MODIFY / REMOVE
├─ spec delta + ★ Spec Publisher (spec/updates/ + spec/test-scope/current.json)
├─ loop(builder/reviewer) → spec-validator
└─ progress + commit-first → change file archive
```

### Step-by-step — which agent handles which step

> Subagent = `.opencode/agent/*.md` (invoked via the `task` tool). Prompt-level = `.agent/*.md` (read and executed in the main session).

| Step | What | Subagent | Prompt-level | Skill | Output | Gate |
|---|---|---|---|---|---|---|
| **0** | Session start / resume | — | `AGENTS.md`, `.agent/blackboard.md` | — | reads `progress.json` (`activeWorkItem`); if in-progress → `/resume` | — |
| **1a** | Build spec from code (if none) | **`spec-init`** | `.agent/spec-init.md` | — | `SPECIFICATIONS.md` + `spec/` + `spec/test-scope/current.json` | read-only, once |
| **1b** | Validate spec vs code/docs | **`spec-validator`** | `.agent/spec-validator.md` | — | report `.context/review-reports/spec-validation.md` | PASS → step 2 · FAIL → clarify, re-validate (max 2 rounds) |
| **2** | Clarify requirements + set config | — | `.agent/brainstorm.md` | `brainstorming` | design doc `docs/specs/*.md` + `.context/project-config.md` (+ secrets → `.env.local`) | ⏸ **approve design** — HARD-GATE: no code before approval |
| **3** | Design tokens + screen specs (if UI) | **`design`** | `.agent/design.md` | `impeccable`, `taste-skill-v2` | `skills/react-native/design-tokens.md` + `.context/design-spec.md` (+ archify diagram) | ⏸ **confirm tokens** |
| **4** | Split into layers + tasks (dependency order) | **`graph`** | `.agent/graph.md` | `archify` | `tasks/<slug>/layer-{N}-task-{NN}.md` + `docs/diagrams/layer-plan.html` + `progress.json` | ⏸ **approve plan** |
| **5a** | Implement one task (+ tests, TDD) | **`builder`** (hard: `builder-strong`, opt-in) | `.agent/loop.md` | `superpowers`, `ponytail`, `karpathy-guidelines`, `security`, `monitoring` | code + tests | — |
| **5b** | Observe: tsc / lint / jest / expo build | — | `.agent/loop.md` | — | verify results (commands from `project-config`) | FAIL → 5c |
| **5c** | Root cause + fix | (`error-analyzer`) | `.agent/error-analyzer.md` | `superpowers/systematic-debugging` | `.context/error-memory.md` | retry max 3 → `BLOCKED` |
| **5d** | Independent review | **`reviewer`** | `.agent/reviewer.md` | `aislop`, `anti-slop`, `open-code-review`, `impeccable`, `react-native/e2e-maestro` | `.context/review-reports/<feature\|bug>-<slug>-phase-<N>-task-<NN>-round-<R>-review.md` | PASS → 5e · FAIL → back to 5a (max 2 rounds) |
| **5e** | Close-out task | — | `.agent/loop.md`, `.agent/FEATURE_WORKFLOW.md` §6 + `.agent/workflows/state-commit.md` §2.8/§5 | — | Doc Impact/Reconcile → `progress.json` → **commit** (1 task = 1 commit) | — |
| **5f** | Compact context | — | `.agent/context-manager.md` | — | `.context/compressed-summary.md` | every 3 tasks + end of layer |
| **5g** | End of layer → phase review | **`spec-validator`** | `.agent/spec-validator.md` | — | phase report | ⏸ **checkpoint after each layer** — Layer N+1 unlocks only when Layer N PASSes + you approve |
| **6** | Git init / EAS build / store deploy | — | `.agent/devops.md` (+ `.devops/templates/*`) | — | git repo, EAS profiles, build preview → store submit | ⏸ **approve production submit** |
| **7** | Rollback on failure | — | `.agent/rollback.md` | — | tag `layer-N-done`, revert to checkpoint | notify human |

**Runtime hand-off:** every subagent call writes the Run Journal **write-ahead** (`.context/runs/<type>-<slug>-<phaseTask>.md`), printing `▶ START` before / `✅ DONE` after (§ Session Handoff).

### After the build — every change goes through one agent

| Entry | Agent | Steps |
|---|---|---|
| `/change` · `/bug` · `/feature` | **`change-request`** (+ `.agent/change-request.md`) | classify BUG / ADDITIVE / MODIFY / REMOVE → spec delta → **`spec-publisher`** (bump `spec_version` + `spec/updates/` + `spec/test-scope/current.json`) → `spec-validator` → phase/task → `loop`(builder→reviewer) → `spec-validator` (phase close) → doc reconcile → progress → commit → archive change file |
| `/bug-check` | — (read-only) | sweep the area, list defects into `tasks/bug-<slug>/scan.md`, **STOP for you to choose** — does NOT call builder |
| `/spec-publish` | **`spec-publisher`** | publish spec + test-scope (usually automatic inside change-request; use manually when needed) |

> 💡 **The test loop:** every change leaves behind `spec/test-scope/current.json` → the test template runs `/autotest` (creates test cases from the new spec; user approves → headless run → browser run) and `/retest` (re-runs already-tested cases).

---

## Agent Roles

**Maintenance (default)** — real subagents live in `.opencode/agent/` (clean context, `edit: deny` where applicable):

| Agent | File | Description |
|-------|------|-------------|
| **Builder** | `.opencode/agent/builder.md` | Implement exactly one task + tests; no scope creep; never commits/pushes |
| **Builder (strong)** | `.opencode/agent/builder-strong.md` | Same, for hard tasks — **opt-in only**, gated by `permission.task` |
| **Reviewer** | `.opencode/agent/reviewer.md` | Independent review, risk level FAST/NORMAL/STRICT (`edit: deny`) |
| **Spec Validator** | `.opencode/agent/spec-validator.md` | Cross-check spec/phase vs requirements (`edit: deny`) |
| **Change Request** ⭐ | `.opencode/agent/change-request.md` | **The ONLY agent for all post-build changes** (new feature + bug fix) — reads `spec/changes/`, spec-publish + test-scope. Entry: `/change`, `/bug`, `/feature` |
| **Design** | `.opencode/agent/design.md` | Produce design tokens + screen specs (`.context/design-spec.md`); automatic within `/start` |
| **Graph** | `.opencode/agent/graph.md` | Split spec/design → layers + tasks (dependency order) + layer-plan diagram |
| **Spec Init** | `.opencode/agent/spec-init.md` | Reverse-engineer spec for an EXISTING project (no spec yet) |
| **Spec Publisher** | `.opencode/agent/spec-publisher.md` | Auto-bump spec + produce `spec/test-scope/current.json` for the test template |

**Prompt-level agents in `.agent/`:**

| Agent | File | Description |
|-------|------|-------------|
| **Spec Validator** | `.agent/spec-validator.md` | Cross-validates spec against code/docs; detects conflicts |
| **Spec Init** | `.agent/spec-init.md` | Reverse-engineer spec for an EXISTING project (no spec yet) |
| **Spec Publisher** | `.agent/spec-publish.md` | Publish spec + test-scope for the test template |
| **Design** | `.agent/design.md` | Design tokens + screen specs before the layer split (RN) |
| **Graph** | `.agent/graph.md` | Split spec → layers/tasks by dependency; Layer N+1 only unlocks when Layer N PASSes + user approves |
| **DevOps** | `.agent/devops.md` | Git init, EAS build/submit, store deploy |
| **Rollback** | `.agent/rollback.md` | Git checkpoint (tag `layer-N-done`) + revert strategy |
| **Blackboard** | `.agent/blackboard.md` | Shared state — `.context/progress.json` is the source of truth |
| **Context Manager** | `.agent/context-manager.md` | Compress context when it grows too large (pin + trim) |
| **Loop Builder** | `.agent/loop.md` | Implements tasks using ReAct (read → plan → code → test → fix) |
| **Reviewer** | `.agent/reviewer.md` | Independent code review with a different model |
| **Error Analyzer** | `.agent/error-analyzer.md` | Root cause analysis; builds error memory to prevent recurrence |
| **Change Request** ⭐ | `.agent/change-request.md` | **The ONLY agent for all changes** (feature + bug) — reads `spec/changes/`, spec-publish + test-scope. Entry: `/change`, `/bug`, `/feature` |

---

## docs/ Folder

The `docs/` folder is where you drop any existing project documentation. The agent automatically classifies each file by content — no need to follow a naming convention.

### Supported Doc Types

| Type | Detected by | Template file |
|------|-------------|---------------|
| Business Requirements (BRD/PRD) | "user story", "acceptance criteria", "business rule" | `docs/BRD.md` |
| Design Spec | screen names, colors, layout, component names | `docs/DESIGN.md` |
| API Spec | endpoints, request/response schemas, HTTP methods | `docs/API_SPEC.md` |
| Database Schema (ERD) | table definitions, relationships, indexes | `docs/ERD.md` |

### docs/INDEX.md (optional)

If you want to skip auto-detection, create `docs/INDEX.md`:

```markdown
- PRD_v2.md: business requirements
- figma-export.md: design reference
- swagger.yaml: api spec
```

---

## Smoke Test Without App Code

The template repo (no app code yet) can still test the workflow — `docs/smoke-tests/MAINTENANCE_TEMPLATE_SMOKE.md`:

- **A. `/bug-check` Smoke** — simulate a Settings screen: must create exactly `tasks/bug-<slug>/scan.md`, must not call Builder, must not touch other files (final `git status --short` check).
- **A2. Cross-Cutting** — system-wide dark mode: must enumerate every surface under `source_roots`, sampling is FORBIDDEN, must include `## Coverage` + `## Not yet swept`.
- **B. Permission gates** — `git push origin main` deny, `--force` deny, `db push` deny; `builder-strong` is gated `ask`.
- **C. Close-out** — Reviewer PASS + report with the exact name + progress.json updated → commit; FAIL → no commit.

---

## Agent Models

Per-role models live in the **frontmatter** of `.opencode/agent/*.md` (`builder`, `builder-strong`,
`reviewer`, `spec-validator`) — declare them in `.context/project-config.md` (`models:`) then **uncomment**
the `model:` line and copy the value across. Use **different provider families** for builder and reviewer to avoid bias.

| Agent | File | Suggested |
|-------|------|-----------|
| Builder | `.opencode/agent/builder.md` | main coding model |
| Builder (strong) | `.opencode/agent/builder-strong.md` | stronger model, **opt-in only** |
| Reviewer | `.opencode/agent/reviewer.md` | different provider than builder |
| Spec Validator | `.opencode/agent/spec-validator.md` | third provider family if available |

> ⚠️ Model variables in `.env.local` have NO effect on opencode (not read). Removed.
> After editing `.opencode/*` or `opencode.jsonc`, **restart opencode** (config is not hot-reloaded).

---

## Git & CI/CD

### Branch Strategy (maintenance)

- **Default staging-direct**: work on `target_branch` (declared in `.context/project-config.md`), commit directly there.
- **Never push `forbidden_branch`** (default `main`) — hard-blocked in `opencode.jsonc` → `permission.bash`.
- **Never `--force` / `-f`** — hard-blocked.
- Feature branch (`feature/<slug>` / `bug/<slug>`) only when the user explicitly asks; PR only when the user asks.
- `auto_push_after_pass: true` only auto-pushes `target_branch` after PASS — the commit after PASS is always mandatory.

### EAS Build Profiles (`.devops/templates/`)

| Profile | Purpose |
|---------|---------|
| **Preview** | Internal distribution via EAS (testers, QA) |
| **Production** | App Store + Play Store submission |

### Git Token Setup

| Platform | Token URL | Scope |
|----------|-----------|-------|
| **GitHub** | https://github.com/settings/tokens | `repo` |
| **GitLab** | https://gitlab.com/-/user_settings/personal_access_tokens | `api` |
| **Bitbucket** | https://bitbucket.org/account/settings/app-passwords | `Repositories Read+Write` |

---

## Change Requests

After the project is complete, use the **Change Request Agent** for modifications:

| Type | Example |
|------|---------|
| **ADDITIVE** | "Add offline sync feature" |
| **MODIFY** | "Change checkout flow" |
| **REMOVE** | "Remove push notifications" |

### Auto-intake backlog (after the initial build)

Once all layers are built (`mode: maintenance`), **requirements and bugs that you type in chat are captured automatically** — no need to create change files by hand:

1. The agent writes a line into `spec/changes/BACKLOG.md` (`pending`) and creates the change doc `spec/changes/YYYY-MM-DD-<slug>.md` from what you said (asks once if info is missing, never invents requirements).
2. It replies **"✅ logged to backlog — type `/change` to process"** and does **not** code yet.
3. You type `/change` (or `/change <slug>`) → the `change-request` agent processes it as before → sets the change `done` + archives it → updates the backlog row to `done` with the date.

`/change --list` shows what is done vs pending (`pending` → `in_progress` → `done` | `blocked`). Every row in `BACKLOG.md` maps 1-to-1 to a change doc under `spec/changes/`; rows that are `done` are kept for history.

SPECIFICATIONS.md is automatically versioned on each change.

---

## License

MIT
