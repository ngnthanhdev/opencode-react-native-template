#!/usr/bin/env node
// Sync reviewer/spec-validator bash allow-rules with the verify commands in .context/project-config.md.
// Only edits the block between the `# verify-commands:start` / `# verify-commands:end` markers
// inside .opencode/agent/reviewer.md and .opencode/agent/spec-validator.md. Idempotent.
//
// Safety: only auto-allows commands that are safe to serialize in YAML and do NOT look destructive.
// Generated patterns are EXACT (no trailing wildcard) so `cmd && destructive` cannot ride along.
// Anything unsafe (quotes/backslashes/newlines, shell metacharacters, wildcard, DB-destructive,
// git-mutating, force) is skipped with a warning so the user can add an explicit rule manually.
//
// Usage: node scripts/apply-verify-permissions.mjs
//        node scripts/apply-verify-permissions.mjs --dry-run
//        node scripts/apply-verify-permissions.mjs --write   (required to actually write; default dry-run)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PROFILE = join(ROOT, ".context", "project-config.md");
const DRY_RUN = !process.argv.includes("--write");
const START = "# verify-commands:start";
const END = "# verify-commands:end";

const AGENT_FILES = [
  join(ROOT, ".opencode", "agent", "reviewer.md"),
  join(ROOT, ".opencode", "agent", "spec-validator.md"),
];

const COMMAND_FIELDS = [
  "web_typecheck_command",
  "web_lint_command",
  "api_typecheck_command",
  "api_lint_command",
  "lint_command",
  "typecheck_command",
  "test_command",
  "integration_test_command",
  "build_command",
  "install_command",
];

// Không auto-allow lệnh có thể mutate DB/git — để user tự thêm nếu thật sự muốn.
const BLOCKED = [
  /\bdb\s+push\b/i,
  /\bdrizzle-kit\s+push\b/i,
  /\bdrizzle-kit\s+migrate\b/i,
  /\bmigrate\s+reset\b/i,
  /\bprisma\s+db\s+seed\b/i,
  /\bsupabase\s+db\s+reset\b/i,
  /\bdb:(push|reset|seed)\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\b/i,
  /\bgit\s+checkout\b/i,
  /\brm\b/i,
  /\bdeploy\b/i,
  /(^|\s)--force(\s|$)/i,
  /(^|\s)-f(\s|$)/,
];

// Shell metacharacters cho phép chaining/injection → không bao giờ auto-allow.
const SHELL_META = /[;&|`$(){}<>*]/;

function parseCommands(text) {
  const commands = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([a-z_]+_command)\s*:\s*(.*)$/);
    if (!m) continue;
    if (!COMMAND_FIELDS.includes(m[1])) continue;
    let value = m[2].replace(/\s+#.*$/, "").trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1).trim();
    }
    if (!value) continue;
    if (value === "null" || value === "~") continue;
    if (/^<.*>$/.test(value)) continue;
    if (/^skip\b/i.test(value)) continue;
    commands.push(value);
  }
  return [...new Set(commands)];
}

function classify(command) {
  if (command === "*" || command.startsWith("*")) {
    return { ok: false, reason: "quá rộng (wildcard toàn bộ)" };
  }
  if (/["\\\r\n]/.test(command)) {
    return { ok: false, reason: "chứa quote/backslash/newline — không an toàn để ghi YAML" };
  }
  if (SHELL_META.test(command)) {
    return { ok: false, reason: "chứa shell metacharacter (chaining/wildcard) — thêm rule tay nếu cần" };
  }
  for (const re of BLOCKED) {
    if (re.test(command)) return { ok: false, reason: `khớp pattern phá hoại (${re})` };
  }
  // Exact pattern (không nối `*`) để `cmd && destructive` không thể lọt theo.
  return { ok: true, pattern: command };
}

function hasMarkers(file) {
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf8");
  const startIdx = text.indexOf(START);
  const endIdx = text.indexOf(END);
  return startIdx !== -1 && endIdx !== -1 && endIdx > startIdx;
}

function patchAgent(file, patterns, eol) {
  if (!existsSync(file)) return { file, status: "missing" };
  const original = readFileSync(file, "utf8");
  const startIdx = original.indexOf(START);
  const endIdx = original.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { file, status: "no-markers" };
  }

  const blockStart = original.indexOf("\n", startIdx) + 1;
  const endLineStart = original.lastIndexOf("\n", endIdx) + 1;
  const generated = patterns.map((p) => `    "${p}": allow`).join(eol);
  const replacement = generated ? `${generated}${eol}` : "";
  const updated = original.slice(0, blockStart) + replacement + original.slice(endLineStart);

  if (updated === original) return { file, status: "unchanged" };
  if (!DRY_RUN) writeFileSync(file, updated, "utf8");
  return { file, status: DRY_RUN ? "would-update" : "updated" };
}

function main() {
  if (!existsSync(PROFILE)) {
    console.error(`Không tìm thấy ${PROFILE}`);
    process.exitCode = 1;
    return;
  }

  const commands = parseCommands(readFileSync(PROFILE, "utf8"));
  const patterns = [];
  const skipped = [];
  for (const command of commands) {
    const verdict = classify(command);
    if (verdict.ok) patterns.push(verdict.pattern);
    else skipped.push({ command, reason: verdict.reason });
  }

  if (patterns.length === 0) {
    console.log("Không có verify command nào đủ an toàn để auto-allow.");
  }

  // Abort sớm nếu thiếu file target hoặc thiếu marker, tránh sync lệch giữa 2 agent file.
  const missingFiles = AGENT_FILES.filter((f) => !existsSync(f));
  if (missingFiles.length) {
    console.log("Thiếu agent file — không ghi file nào:");
    for (const file of missingFiles) console.log(`- ${file.replace(`${ROOT}/`, "")}`);
    process.exitCode = 1;
    return;
  }
  const missingMarkers = AGENT_FILES.filter((f) => !hasMarkers(f));
  if (missingMarkers.length) {
    console.log("Thiếu marker — không ghi file nào:");
    for (const file of missingMarkers) {
      console.log(`- ${file.replace(`${ROOT}/`, "")}: cần \`${START}\`/\`${END}\`.`);
    }
    process.exitCode = 1;
    return;
  }

  const sampleFile = AGENT_FILES.find((f) => existsSync(f));
  const eol = sampleFile && readFileSync(sampleFile, "utf8").includes("\r\n") ? "\r\n" : "\n";

  for (const file of AGENT_FILES) {
    const res = patchAgent(file, patterns, eol);
    const rel = file.replace(`${ROOT}/`, "");
    if (res.status === "missing") {
      console.log(`- ${rel}: không tồn tại, bỏ qua.`);
    } else if (res.status === "no-markers") {
      console.log(`- ${rel}: thiếu marker.`);
    } else {
      console.log(`- ${rel}: ${res.status} (${patterns.length} rule).`);
    }
  }

  if (patterns.length) {
    console.log(`\nAllow patterns: ${patterns.map((p) => `\`${p}\``).join(", ")}`);
  }
  if (skipped.length) {
    console.log("\nBỏ qua (cần user tự thêm rule nếu muốn):");
    for (const s of skipped) console.log(`- \`${s.command}\` — ${s.reason}`);
  }
  if (DRY_RUN) console.log("\n(dry-run mặc định — thêm `--write` để ghi file)");
}

main();
