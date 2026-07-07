# SOC 2 Evidence Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone, config-driven Node CLI (`soc2-evidence-collector`) that collects SOC 2 evidence from GitHub/Vercel/CI + generates manual-evidence templates, writing an auditor-facing manifest into any project's `compliance/evidence/` folder.

**Architecture:** New git repo at `~/Documents/myWork/Compliance/soc2-evidence-collector` (ESM Node, own package.json + CI). `collect.mjs` loads `projects/<name>.json`, runs 7 category collectors (uniform interface, isolated failures) that shell out to authed `gh`/`vercel`/`pnpm` CLIs (no stored tokens), redacts output, and writes a dated run folder + MANIFEST.md/COVERAGE.md. Spec: `<lyricpro>/docs/superpowers/specs/2026-07-07-soc2-evidence-collector-design.md`.

**Tech Stack:** Node 22+ ESM, `node:test` + `node:assert` (zero test deps), child_process wrapping `gh`/`vercel`/`pnpm`/`git`. No runtime npm deps.

## Global Constraints

- **The tool lives ONLY in the new repo** `~/Documents/myWork/Compliance/soc2-evidence-collector`. It writes evidence into a target project's `compliance/evidence/` (configured path) but adds NO code to any app repo.
- **No secrets anywhere:** never store a GitHub/Vercel token in the repo or in evidence. `gh` uses the keychain session; Vercel uses its login session or `VERCEL_TOKEN` from env at runtime. A redaction pass strips token/DSN/key/JWT patterns from all captured output before write. Never print env values.
- **Read-only:** collectors only do API GETs + local writes. Never mutate GitHub/Vercel state. Controls that are OFF (branch protection, Dependabot) are recorded as `gap`, not flipped.
- **Isolated failures:** one collector erroring (auth missing, Vercel unlinked) marks that category `gap`/`error` in COVERAGE with a clear reason and continues — never aborts the whole run.
- **Config-driven / reusable:** nothing LyricPro-specific in core or collectors; all specifics live in `projects/<name>.json`.
- **CC mapping (from LyricPro `compliance/program/control-matrix-cc.md`):** change-management categories → CC8.1; access-control → CC6.1/CC6.2/CC6.3; vulnerability-review → CC7.1 + CC6.8. These are the LyricPro config defaults.
- ESM (`"type":"module"`), Node ≥ 22. Tests: `node --test`. Conventional commits, NO Co-Authored-By.
- LyricPro facts for `projects/lyricpro.json`: githubRepo `derob357/LyricPro`, vercelProject `lyricpro-ai`, vercelScope `deric-robinsons-projects`, projectRoot `/Users/drob/Documents/myWork/CCS/LyricPro/lyricpro-ai-2.0`, outputDir `<projectRoot>/compliance/evidence`, ciWorkflow `CI`.

---

### Task 1: Repo scaffold + config loader + sh + redact (foundation, TDD)

**Files (all under `~/Documents/myWork/Compliance/soc2-evidence-collector/`):**
- Create: `package.json`, `.gitignore`, `lib/sh.mjs`, `lib/redact.mjs`, `lib/config.mjs`, `projects/lyricpro.json`
- Test: `test/redact.test.mjs`, `test/config.test.mjs`

**Interfaces:**
- Produces:
  - `sh(cmd, args, opts?) → { code, stdout, stderr }` (never throws on non-zero; captures both streams) from `lib/sh.mjs`
  - `redact(text: string) → string` from `lib/redact.mjs`
  - `loadConfig(name: string) → Config` (validates required keys, resolves paths) from `lib/config.mjs`

- [ ] **Step 1: Create the repo + scaffold**

```bash
mkdir -p ~/Documents/myWork/Compliance/soc2-evidence-collector
cd ~/Documents/myWork/Compliance/soc2-evidence-collector
git init -q
mkdir -p lib collectors templates projects fixtures test
```

`package.json`:
```json
{
  "name": "soc2-evidence-collector",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "soc2-collect": "./collect.mjs" },
  "scripts": {
    "test": "node --test",
    "collect": "node collect.mjs"
  },
  "engines": { "node": ">=22" }
}
```

`.gitignore`:
```
node_modules/
*.log
.DS_Store
/tmp-dryrun/
```

- [ ] **Step 2: Write the redaction test**

```javascript
// test/redact.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "../lib/redact.mjs";

test("redacts postgres connection strings", () => {
  const out = redact("db postgresql://u:secretpw@host:5432/db end");
  assert.ok(!out.includes("secretpw"));
  assert.match(out, /\[REDACTED\]/);
});
test("redacts bearer/JWT and known key prefixes", () => {
  assert.ok(!redact("Authorization: Bearer sk_live_ABCDEF1234567890").includes("sk_live_ABCDEF1234567890"));
  assert.ok(!redact("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc").includes("eyJhbGciOiJIUzI1NiJ9"));
  assert.ok(!redact("ghp_0123456789abcdefghijABCDEFGHIJ0123456789").includes("ghp_0123456789abcdefghijABCDEFGHIJ0123456789"));
});
test("leaves ordinary text untouched", () => {
  assert.equal(redact("PR #42 approved by alice"), "PR #42 approved by alice");
});
```

- [ ] **Step 3: Run test → fail**

Run: `cd ~/Documents/myWork/Compliance/soc2-evidence-collector && node --test test/redact.test.mjs`
Expected: FAIL (cannot find `../lib/redact.mjs`).

- [ ] **Step 4: Implement redact.mjs**

```javascript
// lib/redact.mjs
// Strips secret-shaped substrings from any text before it is written to an
// evidence file. Defense-in-depth: no token should ever reach the collector,
// but if an API echoes one, it must not land in the audit record.
const PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s"']+/gi,           // DB connection strings
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, // JWTs
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, // Stripe-style keys
  /\bwhsec_[A-Za-z0-9]{10,}\b/g,              // Stripe webhook secrets
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,          // GitHub tokens
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,           // AWS access key ids
  /Bearer\s+[A-Za-z0-9._-]{20,}/gi,           // bearer tokens
];
export function redact(text) {
  if (typeof text !== "string") return text;
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}
```

- [ ] **Step 5: Run test → pass**

Run: `node --test test/redact.test.mjs`
Expected: 3 tests pass.

- [ ] **Step 6: Implement sh.mjs** (no test — thin wrapper, exercised by later live steps)

```javascript
// lib/sh.mjs
// Non-throwing child_process wrapper. Returns {code, stdout, stderr} so a
// failed CLI (e.g. gh not authed) becomes a handled `gap`, not a crash.
import { spawnSync } from "node:child_process";
export function sh(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error.message) : "") };
}
// Convenience: run `gh api <path>` and parse JSON, or return {error}.
export function ghJson(path) {
  const r = sh("gh", ["api", path, "--paginate"]);
  if (r.code !== 0) return { error: r.stderr.trim() || `gh api ${path} failed` };
  try { return { data: JSON.parse(r.stdout) }; }
  catch { return { error: `unparseable JSON from gh api ${path}` }; }
}
```

- [ ] **Step 7: Write config test + implement config.mjs**

`projects/lyricpro.json`:
```json
{
  "project": "lyricpro",
  "githubRepo": "derob357/LyricPro",
  "vercelProject": "lyricpro-ai",
  "vercelScope": "deric-robinsons-projects",
  "projectRoot": "/Users/drob/Documents/myWork/CCS/LyricPro/lyricpro-ai-2.0",
  "outputDir": "/Users/drob/Documents/myWork/CCS/LyricPro/lyricpro-ai-2.0/compliance/evidence",
  "window": { "days": 90 },
  "ciWorkflow": "CI",
  "controlMap": {
    "code-review": ["CC8.1"],
    "change-request": ["CC8.1", "CC3.4"],
    "testing": ["CC8.1"],
    "deployment-approval": ["CC8.1"],
    "deployment-evidence": ["CC8.1"],
    "access-control": ["CC6.1", "CC6.2", "CC6.3"],
    "vulnerability-review": ["CC7.1", "CC6.8"]
  }
}
```

```javascript
// test/config.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../lib/config.mjs";
test("loads and validates lyricpro config", () => {
  const c = loadConfig("lyricpro");
  assert.equal(c.githubRepo, "derob357/LyricPro");
  assert.equal(c.window.days, 90);
  assert.ok(c.controlMap["code-review"].includes("CC8.1"));
});
test("throws a clear error for a missing project", () => {
  assert.throws(() => loadConfig("nope"), /no config/i);
});
```

```javascript
// lib/config.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const REQUIRED = ["project", "githubRepo", "projectRoot", "outputDir", "controlMap"];
export function loadConfig(name) {
  const p = join(HERE, "..", "projects", `${name}.json`);
  if (!existsSync(p)) throw new Error(`no config: projects/${name}.json not found`);
  const cfg = JSON.parse(readFileSync(p, "utf8"));
  const missing = REQUIRED.filter((k) => cfg[k] == null);
  if (missing.length) throw new Error(`config projects/${name}.json missing keys: ${missing.join(", ")}`);
  cfg.window ??= { days: 90 };
  return cfg;
}
```

- [ ] **Step 8: Run all tests + commit**

Run: `node --test` → all pass (redact 3, config 2).

```bash
git add -A
git commit -m "feat: collector scaffold — config loader, sh wrapper, secret redaction"
```

---

### Task 2: Run orchestrator + manifest engine + code-review collector (pipeline end-to-end, TDD + live)

**Files:**
- Create: `collect.mjs`, `lib/run.mjs`, `lib/manifest.mjs`, `collectors/code-review.mjs`, `fixtures/prs.json`, `fixtures/branch-protection-404.json`
- Test: `test/manifest.test.mjs`, `test/code-review.test.mjs`

**Interfaces:**
- Consumes: `loadConfig`, `sh`/`ghJson`, `redact` (Task 1).
- Produces:
  - Collector contract: `export default { category, controlKey, async collect(cfg, ctx) → { status, artifacts, summaryMd, notes } }` where `ctx = { runDir, write(relPath, data), sh, ghJson, since }` and `write` redacts + mkdirs.
  - `buildManifest(cfg, results, runDir)` → writes `MANIFEST.md`, `COVERAGE.md`, `collection.json`.
  - `runCollection(cfg, { only?, dryRun? })` → orchestrates, returns summary.
  - `code-review` collector: PRs in window (number, title, state, mergedAt, mergedBy, reviews→approvals) + branch-protection status (gap if 404).

- [ ] **Step 1: Write the code-review collector test (fixtures → parsed summary)**

`fixtures/prs.json` (representative `gh api` shape — 2 PRs, one approved+merged, one open):
```json
[
  {"number":42,"title":"feat: vendor api","state":"closed","merged_at":"2026-07-05T10:00:00Z","user":{"login":"derob357"},"merged_by":{"login":"derob357"}},
  {"number":43,"title":"fix: bug","state":"open","merged_at":null,"user":{"login":"derob357"},"merged_by":null}
]
```
`fixtures/reviews-42.json`:
```json
[{"user":{"login":"reviewerA"},"state":"APPROVED","submitted_at":"2026-07-05T09:50:00Z"}]
```

```javascript
// test/code-review.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summarizeCodeReview } from "../collectors/code-review.mjs";

test("summarizes PRs + approvals, flags no branch protection", () => {
  const prs = JSON.parse(readFileSync(new URL("../fixtures/prs.json", import.meta.url)));
  const reviewsByPr = { 42: JSON.parse(readFileSync(new URL("../fixtures/reviews-42.json", import.meta.url))) };
  const out = summarizeCodeReview(prs, reviewsByPr, { protected: false });
  assert.equal(out.totalPrs, 2);
  assert.equal(out.mergedWithApproval, 1);
  assert.equal(out.branchProtection, "GAP: main not protected");
  assert.match(out.md, /#42/);
  assert.match(out.md, /reviewerA/);
});
```

- [ ] **Step 2: Run → fail** (`node --test test/code-review.test.mjs` → cannot find module).

- [ ] **Step 3: Implement code-review.mjs**

```javascript
// collectors/code-review.mjs
// Evidence: GitHub PR history + reviewer approvals + branch-protection status.
// Control: CC8.1 (changes reviewed/approved before merge).
export function summarizeCodeReview(prs, reviewsByPr, protection) {
  const merged = prs.filter((p) => p.merged_at);
  const mergedWithApproval = merged.filter((p) => (reviewsByPr[p.number] ?? []).some((r) => r.state === "APPROVED")).length;
  const branchProtection = protection?.protected ? "OK: main protected" : "GAP: main not protected";
  const rows = prs.map((p) => {
    const apprs = (reviewsByPr[p.number] ?? []).filter((r) => r.state === "APPROVED").map((r) => r.user.login);
    return `| #${p.number} | ${p.title} | ${p.state}${p.merged_at ? " (merged)" : ""} | ${apprs.join(", ") || "—"} |`;
  });
  const md = [
    `# Code Review Evidence`, ``,
    `- PRs in window: **${prs.length}**`,
    `- Merged with ≥1 approval: **${mergedWithApproval}/${merged.length}**`,
    `- Branch protection: **${branchProtection}**`, ``,
    `| PR | Title | State | Approved by |`, `|---|---|---|---|`,
    ...rows, ``,
  ].join("\n");
  return { totalPrs: prs.length, mergedWithApproval, branchProtection, md };
}

export default {
  category: "code-review",
  controlKey: "code-review",
  async collect(cfg, ctx) {
    const repo = cfg.githubRepo;
    const prsRes = ctx.ghJson(`repos/${repo}/pulls?state=all&per_page=100&sort=updated&direction=desc`);
    if (prsRes.error) return { status: "error", artifacts: [], summaryMd: "", notes: prsRes.error };
    const prs = prsRes.data.filter((p) => new Date(p.updated_at ?? p.created_at) >= ctx.since);
    const reviewsByPr = {};
    for (const p of prs) {
      const rv = ctx.ghJson(`repos/${repo}/pulls/${p.number}/reviews`);
      reviewsByPr[p.number] = rv.error ? [] : rv.data;
    }
    // Branch protection: 404 (gh api exits non-zero) ⇒ not protected ⇒ gap.
    const prot = ctx.ghJson(`repos/${repo}/branches/main/protection`);
    const protection = { protected: !prot.error };
    const sum = summarizeCodeReview(prs, reviewsByPr, protection);
    ctx.write("code-review/pull-requests.json", JSON.stringify(prs, null, 2));
    ctx.write("code-review/reviews.json", JSON.stringify(reviewsByPr, null, 2));
    ctx.write("code-review/summary.md", sum.md);
    return {
      status: protection.protected ? "collected" : "gap",
      artifacts: [
        { path: "code-review/pull-requests.json", kind: "pr-history" },
        { path: "code-review/reviews.json", kind: "reviews" },
        { path: "code-review/summary.md", kind: "summary" },
      ],
      summaryMd: sum.md,
      notes: sum.branchProtection.startsWith("GAP") ? sum.branchProtection : "",
    };
  },
};
```

- [ ] **Step 4: Run → pass** (`node --test test/code-review.test.mjs`).

- [ ] **Step 5: Write manifest test + implement manifest.mjs**

```javascript
// test/manifest.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest } from "../lib/manifest.mjs";
test("manifest maps artifacts to CC criteria and reports coverage", () => {
  const runDir = mkdtempSync(join(tmpdir(), "soc2-"));
  const cfg = { project: "x", controlMap: { "code-review": ["CC8.1"] } };
  const results = [{ category: "code-review", status: "gap", artifacts: [{ path: "code-review/summary.md", kind: "summary" }], notes: "GAP: main not protected" }];
  buildManifest(cfg, results, runDir);
  const manifest = readFileSync(join(runDir, "MANIFEST.md"), "utf8");
  const coverage = readFileSync(join(runDir, "COVERAGE.md"), "utf8");
  assert.match(manifest, /CC8\.1/);
  assert.match(manifest, /code-review\/summary\.md/);
  assert.match(coverage, /code-review.*GAP/i);
});
```

```javascript
// lib/manifest.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";
export function buildManifest(cfg, results, runDir) {
  const now = new Date().toISOString();
  const manRows = [], covRows = [];
  for (const r of results) {
    const ccs = (cfg.controlMap[r.category] ?? []).join(", ") || "—";
    covRows.push(`| ${r.category} | ${r.status.toUpperCase()} | ${r.notes || ""} |`);
    for (const a of (r.artifacts ?? [])) {
      manRows.push(`| ${a.path} | ${a.kind} | ${r.category} | ${ccs} | ${r.status} | ${now} |`);
    }
    if (!(r.artifacts ?? []).length) manRows.push(`| — | (none) | ${r.category} | ${ccs} | ${r.status} | ${now} |`);
  }
  const manifest = [
    `# SOC 2 Evidence Manifest — ${cfg.project}`, ``, `Generated: ${now}`, ``,
    `| Artifact | Kind | Category | CC criteria | Status | Collected |`,
    `|---|---|---|---|---|---|`, ...manRows, ``,
  ].join("\n");
  const coverage = [
    `# Coverage — ${cfg.project}`, ``, `Generated: ${now}`, ``,
    `| Category | Status | Notes |`, `|---|---|---|`, ...covRows, ``,
    `Legend: COLLECTED = auto evidence captured · GAP = control off/missing · MANUAL-PENDING = template awaiting owner · ERROR = source unreachable`, ``,
  ].join("\n");
  writeFileSync(join(runDir, "MANIFEST.md"), manifest);
  writeFileSync(join(runDir, "COVERAGE.md"), coverage);
  writeFileSync(join(runDir, "collection.json"), JSON.stringify({ project: cfg.project, generatedAt: now, results: results.map((r) => ({ category: r.category, status: r.status, notes: r.notes })) }, null, 2));
}
```

- [ ] **Step 6: Run manifest test → pass.**

- [ ] **Step 7: Implement run.mjs + collect.mjs**

```javascript
// lib/run.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { ghJson, sh } from "./sh.mjs";
import { redact } from "./redact.mjs";
import { buildManifest } from "./manifest.mjs";
import codeReview from "../collectors/code-review.mjs";
// Later tasks append their collectors to this array.
const COLLECTORS = [codeReview];
export async function runCollection(cfg, { only, dryRun } = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const base = dryRun ? join(process.cwd(), "tmp-dryrun") : cfg.outputDir;
  const runDir = join(base, `${date}-collection`);
  mkdirSync(runDir, { recursive: true });
  const since = new Date(Date.now() - (cfg.window.days ?? 90) * 86400000);
  const write = (rel, data) => {
    const p = join(runDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, redact(typeof data === "string" ? data : String(data)));
  };
  const ctx = { runDir, write, sh, ghJson, since };
  const chosen = only ? COLLECTORS.filter((c) => c.category === only) : COLLECTORS;
  const results = [];
  for (const c of chosen) {
    try { results.push({ category: c.category, ...(await c.collect(cfg, ctx)) }); }
    catch (err) { results.push({ category: c.category, status: "error", artifacts: [], notes: redact(String(err.message)) }); }
  }
  buildManifest(cfg, results, runDir);
  return { runDir, results };
}
```

```javascript
#!/usr/bin/env node
// collect.mjs — CLI entry.
import { loadConfig } from "./lib/config.mjs";
import { runCollection } from "./lib/run.mjs";
const args = process.argv.slice(2);
const get = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const project = get("--project");
if (!project) { console.error("usage: node collect.mjs --project <name> [--only <category>] [--dry-run]"); process.exit(1); }
try {
  const cfg = loadConfig(project);
  const { runDir, results } = await runCollection(cfg, { only: get("--only"), dryRun: args.includes("--dry-run") });
  const gaps = results.filter((r) => r.status === "gap" || r.status === "error");
  console.log(`Collected → ${runDir}`);
  for (const r of results) console.log(`  ${r.status.padEnd(16)} ${r.category}${r.notes ? " — " + r.notes : ""}`);
  process.exitCode = 0; // gaps are honest findings, not tool failures
} catch (err) {
  console.error("ERROR:", err.message);
  process.exit(1);
}
```

- [ ] **Step 8: Live dry-run against LyricPro** (read-only; writes to `tmp-dryrun/`, not the real evidence folder)

Run: `node collect.mjs --project lyricpro --only code-review --dry-run`
Expected: prints `Collected → …/tmp-dryrun/<date>-collection`, code-review status `gap` (main not protected), and `tmp-dryrun/<date>-collection/MANIFEST.md` exists referencing CC8.1 + real PR numbers. (Requires `gh` authed — it is.)

- [ ] **Step 9: Run all tests + commit**

Run: `node --test` → all pass (redact 3, config 2, manifest 1, code-review 1).

```bash
git add -A && git commit -m "feat: run orchestrator + manifest engine + code-review collector"
```

---

### Task 3: change-request, testing, deployment-approval collectors (TDD)

**Files:**
- Create: `collectors/change-request.mjs`, `collectors/testing.mjs`, `collectors/deployment-approval.mjs`
- Modify: `lib/run.mjs` (register the 3 collectors in `COLLECTORS`)
- Test: `test/change-request.test.mjs`, `test/testing.test.mjs`

**Interfaces:** each exports the same default collector contract as code-review. Consumes `ctx.ghJson`, `ctx.sh`, `cfg.projectRoot`, `cfg.ciWorkflow`.

- [ ] **Step 1: change-request collector**

Command: GitHub Issues `repos/<repo>/issues?state=all&since=<iso>` (note: the issues endpoint returns PRs too — filter `!i.pull_request`). Also index local `docs/superpowers/specs` + `plans` as documented change tickets (`sh("ls", [join(projectRoot,"docs/superpowers/specs")])`).

```javascript
// collectors/change-request.mjs
// Evidence: change tickets (GitHub Issues) + documented change records (specs/plans).
// Control: CC8.1, CC3.4.
import { join } from "node:path";
export function summarizeIssues(issues) {
  const real = issues.filter((i) => !i.pull_request);
  const open = real.filter((i) => i.state === "open").length;
  const rows = real.map((i) => `| #${i.number} | ${i.title} | ${i.state} | ${(i.labels ?? []).map((l) => l.name).join(",") || "—"} |`);
  return { count: real.length, open, md: [`# Change Requests (Issues)`, ``, `- Total: **${real.length}** (open ${open})`, ``, `| # | Title | State | Labels |`, `|---|---|---|---|`, ...rows, ``].join("\n") };
}
export default {
  category: "change-request", controlKey: "change-request",
  async collect(cfg, ctx) {
    const res = ctx.ghJson(`repos/${cfg.githubRepo}/issues?state=all&since=${ctx.since.toISOString()}&per_page=100`);
    const issues = res.error ? [] : res.data;
    const sum = summarizeIssues(issues);
    ctx.write("change-request/issues.json", JSON.stringify(issues, null, 2));
    // Documented change records: specs + plans in the target repo.
    const specs = ctx.sh("ls", [join(cfg.projectRoot, "docs/superpowers/specs")]).stdout.trim().split("\n").filter(Boolean);
    const plans = ctx.sh("ls", [join(cfg.projectRoot, "docs/superpowers/plans")]).stdout.trim().split("\n").filter(Boolean);
    ctx.write("change-request/documented-changes.md", [`# Documented change records`, ``, `## Specs (${specs.length})`, ...specs.map((s) => `- ${s}`), ``, `## Plans (${plans.length})`, ...plans.map((p) => `- ${p}`), ``].join("\n"));
    ctx.write("change-request/summary.md", sum.md);
    return { status: res.error ? "error" : "collected", artifacts: [{ path: "change-request/issues.json", kind: "issues" }, { path: "change-request/documented-changes.md", kind: "change-records" }, { path: "change-request/summary.md", kind: "summary" }], summaryMd: sum.md, notes: res.error ? res.error : (sum.count === 0 ? "No GitHub Issues in window — change records are PR + specs/plans based" : "") };
  },
};
```

Test `test/change-request.test.mjs`: feed a fixture with 1 issue + 1 pull_request object, assert `summarizeIssues` counts only the real issue.

- [ ] **Step 2: testing collector**

Command: CI runs `repos/<repo>/actions/runs?per_page=20` (filter to `cfg.ciWorkflow` by `name`), capture conclusion + html_url + head_sha; write a summary. Generate/link the manual QA checklist (Task 5 provides the template; here just reference `_manual/testing/manual-qa-checklist.md` and mark `manual-pending` if the file is empty/absent).

```javascript
// collectors/testing.mjs
// Evidence: CI test runs (automated) + manual QA checklist/screenshots (owner).
// Control: CC8.1.
export function summarizeRuns(runs, workflowName) {
  const mine = runs.filter((r) => r.name === workflowName);
  const passed = mine.filter((r) => r.conclusion === "success").length;
  const rows = mine.slice(0, 15).map((r) => `| ${r.head_sha?.slice(0,7)} | ${r.conclusion ?? r.status} | ${r.created_at} | ${r.html_url} |`);
  return { total: mine.length, passed, md: [`# Testing Evidence (CI)`, ``, `- ${workflowName} runs: **${mine.length}**, success: **${passed}**`, ``, `| Commit | Result | When | Link |`, `|---|---|---|---|`, ...rows, ``].join("\n") };
}
export default {
  category: "testing", controlKey: "testing",
  async collect(cfg, ctx) {
    const res = ctx.ghJson(`repos/${cfg.githubRepo}/actions/runs?per_page=30`);
    const runs = res.error ? [] : (res.data.workflow_runs ?? []);
    const sum = summarizeRuns(runs, cfg.ciWorkflow ?? "CI");
    ctx.write("testing/ci-runs.json", JSON.stringify(runs, null, 2));
    ctx.write("testing/summary.md", sum.md);
    return { status: res.error ? "error" : (sum.total ? "collected" : "gap"), artifacts: [{ path: "testing/ci-runs.json", kind: "ci-runs" }, { path: "testing/summary.md", kind: "summary" }], summaryMd: sum.md, notes: (sum.total ? "" : "No CI runs found — check ciWorkflow name") + " · manual QA signoff in _manual/testing/ (owner)" };
  },
};
```

Test `test/testing.test.mjs`: `summarizeRuns` with 3 fixture runs (2 named "CI", 1 other) → total 2, passed per fixture.

- [ ] **Step 3: deployment-approval collector**

Reuses PR merge data (approvals = deployment gate for main→prod). Reads `code-review/reviews.json` isn't available cross-collector reliably, so re-fetch: list merged PRs in window + their approvals, plus reference the manual release-approval checklist.

```javascript
// collectors/deployment-approval.mjs
// Evidence: PR approvals gating merge-to-main (which triggers Vercel prod deploy)
// + manual release-approval checklist. Control: CC8.1.
export default {
  category: "deployment-approval", controlKey: "deployment-approval",
  async collect(cfg, ctx) {
    const res = ctx.ghJson(`repos/${cfg.githubRepo}/pulls?state=closed&base=main&per_page=100&sort=updated&direction=desc`);
    if (res.error) return { status: "error", artifacts: [], summaryMd: "", notes: res.error };
    const merged = res.data.filter((p) => p.merged_at && new Date(p.merged_at) >= ctx.since);
    const rows = [];
    for (const p of merged) {
      const rv = ctx.ghJson(`repos/${cfg.githubRepo}/pulls/${p.number}/reviews`);
      const approvers = rv.error ? [] : rv.data.filter((r) => r.state === "APPROVED").map((r) => r.user.login);
      rows.push(`| #${p.number} | ${p.merged_at} | ${approvers.join(", ") || "— (no approval on record)"} |`);
    }
    const md = [`# Deployment Approval Evidence`, ``, `Merges to \`main\` (→ prod deploy) in window: **${merged.length}**`, ``, `| PR | Merged | Approved by |`, `|---|---|---|`, ...rows, ``, `Manual release-approval checklist: _manual/deployment-approval/release-approval-checklist.md`, ``].join("\n");
    ctx.write("deployment-approval/summary.md", md);
    const noApproval = merged.length && rows.every((r) => r.includes("no approval on record"));
    return { status: noApproval ? "gap" : "collected", artifacts: [{ path: "deployment-approval/summary.md", kind: "summary" }], summaryMd: md, notes: noApproval ? "GAP: merges lack recorded PR approvals (branch protection off + direct pushes)" : "" };
  },
};
```

- [ ] **Step 4: Register + run all tests + dry-run + commit**

In `lib/run.mjs`, import the 3 and add to `COLLECTORS`. Run `node --test` (all pass). Run `node collect.mjs --project lyricpro --dry-run` → 4 categories now in MANIFEST/COVERAGE.

```bash
git add -A && git commit -m "feat: change-request, testing, deployment-approval collectors"
```

---

### Task 4: deployment-evidence, access-control, vulnerability-review collectors + manual templates (TDD)

**Files:**
- Create: `collectors/deployment-evidence.mjs`, `collectors/access-control.mjs`, `collectors/vulnerability-review.mjs`, and `templates/{manual-qa-checklist,release-approval-checklist,production-access-list,mfa-attestation,manual-dependency-review}.md`
- Create: `lib/templates.mjs` (copies templates into `<outputDir>/_manual/<category>/` once, never overwriting a non-empty existing file)
- Modify: `lib/run.mjs` (register 3 collectors; call template sync before collectors)
- Test: `test/deployment-evidence.test.mjs`, `test/vulnerability-review.test.mjs`, `test/templates.test.mjs`

- [ ] **Step 1: deployment-evidence collector** (Vercel + git tags)

Vercel prod deployments: `sh("vercel", ["ls", cfg.vercelProject, "--prod", "--scope", cfg.vercelScope])` — parse the text table (or use `vercel ls --json` if available on the installed CLI; the plan's implementer verifies which the installed CLI supports and adapts, writing raw output either way). Git tags: `sh("git", ["-C", cfg.projectRoot, "tag", "--sort=-creatordate", "-l"])` + `git for-each-ref` for tag messages. Write raw + a summary. Provide a `summarizeTags(tagLines)` pure fn for the test.

```javascript
// collectors/deployment-evidence.mjs
// Evidence: Vercel prod deployments + git release tags/notes + tagged commits.
// Control: CC8.1.
export function summarizeTags(tags) {
  const list = tags.filter(Boolean);
  return { count: list.length, md: [`## Release tags (${list.length})`, ...list.map((t) => `- ${t}`), ``].join("\n") };
}
export default {
  category: "deployment-evidence", controlKey: "deployment-evidence",
  async collect(cfg, ctx) {
    const artifacts = [];
    // Vercel — capture raw output (text or json), never fail the run if unlinked.
    let vres = ctx.sh("vercel", ["ls", cfg.vercelProject, "--prod", "--scope", cfg.vercelScope ?? ""].filter(Boolean));
    const vercelOk = vres.code === 0;
    ctx.write("deployment-evidence/vercel-prod-deployments.txt", vercelOk ? vres.stdout : `vercel ls failed: ${vres.stderr}`);
    artifacts.push({ path: "deployment-evidence/vercel-prod-deployments.txt", kind: "vercel-deployments" });
    // Git tags + notes from the target repo.
    const tags = ctx.sh("git", ["-C", cfg.projectRoot, "tag", "--sort=-creatordate", "-l"]).stdout.trim().split("\n");
    const notes = ctx.sh("git", ["-C", cfg.projectRoot, "for-each-ref", "--sort=-creatordate", "--format=%(refname:short) %(creatordate:short) %(contents:subject)", "refs/tags"]).stdout;
    const sum = summarizeTags(tags);
    ctx.write("deployment-evidence/release-tags.txt", notes || "(no tags)");
    ctx.write("deployment-evidence/summary.md", [`# Deployment Evidence`, ``, `Vercel prod deployments: see vercel-prod-deployments.txt (${vercelOk ? "captured" : "GAP: vercel not linked/authed"})`, ``, sum.md].join("\n"));
    artifacts.push({ path: "deployment-evidence/release-tags.txt", kind: "release-tags" }, { path: "deployment-evidence/summary.md", kind: "summary" });
    return { status: vercelOk ? "collected" : "gap", artifacts, summaryMd: "", notes: vercelOk ? (sum.count ? "" : "no git release tags found") : "GAP: vercel CLI not linked/authed (run `vercel login`)" };
  },
};
```

- [ ] **Step 2: access-control collector** (collaborators + Dependabot status + manual templates)

```javascript
// collectors/access-control.mjs
// Evidence: GitHub repo collaborators + permission levels; security features status;
// manual production-access-list + MFA attestation. Control: CC6.1/6.2/6.3.
export function summarizeCollaborators(collabs) {
  const rows = collabs.map((c) => `| ${c.login} | ${c.role_name ?? (c.permissions?.admin ? "admin" : c.permissions?.push ? "write" : "read")} |`);
  return { count: collabs.length, md: [`# Access Control Evidence`, ``, `## GitHub repo collaborators (${collabs.length})`, ``, `| Login | Permission |`, `|---|---|`, ...rows, ``].join("\n") };
}
export default {
  category: "access-control", controlKey: "access-control",
  async collect(cfg, ctx) {
    const res = ctx.ghJson(`repos/${cfg.githubRepo}/collaborators?per_page=100`);
    const collabs = res.error ? [] : res.data.map((c) => ({ login: c.login, role_name: c.role_name, permissions: c.permissions })); // NOTE: login + permission only, no email/PII
    const sum = summarizeCollaborators(collabs);
    ctx.write("access-control/collaborators.json", JSON.stringify(collabs, null, 2));
    // Dependabot / security status (records on/off).
    const alerts = ctx.sh("gh", ["api", `repos/${cfg.githubRepo}/vulnerability-alerts`, "-i"]);
    const dependabotOn = /HTTP\/[\d.]+ 204/.test(alerts.stdout);
    const secMd = `\n## Security features\n- Dependabot alerts: **${dependabotOn ? "ENABLED" : "DISABLED (gap)"}**\n`;
    ctx.write("access-control/summary.md", sum.md + secMd + `\n## Manual\n- Production access list (Supabase/Vercel/Stripe/AWS): _manual/access-control/production-access-list.md\n- MFA attestation + screenshots: _manual/access-control/\n`);
    return { status: res.error ? "error" : "collected", artifacts: [{ path: "access-control/collaborators.json", kind: "collaborators" }, { path: "access-control/summary.md", kind: "summary" }], summaryMd: "", notes: (res.error ? res.error + " · " : "") + (dependabotOn ? "" : "Dependabot disabled (gap)") + " · production access list + MFA are manual (owner)" };
  },
};
```

- [ ] **Step 3: vulnerability-review collector** (`pnpm audit --json` in projectRoot)

```javascript
// collectors/vulnerability-review.mjs
// Evidence: prod dependency audit + Dependabot status + manual dependency review.
// Control: CC7.1, CC6.8.
export function summarizeAudit(auditJson) {
  const meta = auditJson?.metadata?.vulnerabilities ?? {};
  const total = Object.values(meta).reduce((a, v) => a + v, 0);
  return { total, meta, md: [`# Vulnerability Review`, ``, `- \`pnpm audit --prod\`: **${total}** vulnerabilities`, `  - critical ${meta.critical ?? 0} · high ${meta.high ?? 0} · moderate ${meta.moderate ?? 0} · low ${meta.low ?? 0}`, ``, `Manual dependency review: _manual/vulnerability-review/manual-dependency-review.md`, ``].join("\n") };
}
export default {
  category: "vulnerability-review", controlKey: "vulnerability-review",
  async collect(cfg, ctx) {
    const r = ctx.sh("pnpm", ["audit", "--prod", "--json"], { cwd: cfg.projectRoot });
    let auditJson = {}; try { auditJson = JSON.parse(r.stdout); } catch { /* pnpm exits nonzero when vulns exist; stdout still JSON */ }
    const sum = summarizeAudit(auditJson);
    ctx.write("vulnerability-review/pnpm-audit.json", r.stdout || `audit failed: ${r.stderr}`);
    ctx.write("vulnerability-review/summary.md", sum.md);
    return { status: r.stdout ? "collected" : "error", artifacts: [{ path: "vulnerability-review/pnpm-audit.json", kind: "audit" }, { path: "vulnerability-review/summary.md", kind: "summary" }], summaryMd: sum.md, notes: sum.total > 0 ? `${sum.total} vulns (see audit)` : "0 vulns" };
  },
};
```

Tests: `summarizeTags`, `summarizeAudit` (feed `{metadata:{vulnerabilities:{high:2,low:1}}}` → total 3), `summarizeCollaborators`.

- [ ] **Step 4: Manual templates + `lib/templates.mjs`**

Write the 5 markdown templates (checklists with owner-fill fields — no placeholders-as-defects; they're intentionally fillable forms). `templates.mjs`:

```javascript
// lib/templates.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
// category → template files
const MAP = {
  testing: ["manual-qa-checklist.md"],
  "deployment-approval": ["release-approval-checklist.md"],
  "access-control": ["production-access-list.md", "mfa-attestation.md"],
  "vulnerability-review": ["manual-dependency-review.md"],
};
export function syncTemplates(outputDir) {
  for (const [cat, files] of Object.entries(MAP)) {
    const dstDir = join(outputDir, "_manual", cat);
    mkdirSync(join(dstDir, "screenshots"), { recursive: true });
    for (const f of files) {
      const dst = join(dstDir, f);
      // Never overwrite an owner-filled file (size grown beyond the blank template).
      if (existsSync(dst) && statSync(dst).size > 0) continue;
      writeFileSync(dst, readFileSync(join(HERE, "..", "templates", f), "utf8"));
    }
  }
}
```

Call `syncTemplates(cfg.outputDir)` at the top of `runCollection` (skip when `dryRun`). Test `test/templates.test.mjs`: sync into a tmp dir → files exist; write owner content into one → re-sync → owner content preserved.

- [ ] **Step 5: Register, full test, dry-run, commit**

Register the 3 collectors. `node --test` all pass. `node collect.mjs --project lyricpro --dry-run` → 7 categories in MANIFEST.

```bash
git add -A && git commit -m "feat: deployment/access/vuln collectors + manual templates"
```

---

### Task 5: Reuse polish + first real run + evidence commit

**Files:**
- Create: `projects/example.json` (commented), `README.md`, `.github/workflows/ci.yml` (the collector's OWN ci: `node --test`)

- [ ] **Step 1: `projects/example.json`** — same shape as lyricpro.json with `"_comment"` fields explaining each key and placeholder values (`"githubRepo": "owner/repo"`, etc.).

- [ ] **Step 2: `README.md`** — what it is; install (`node ≥22`, `gh auth login`, `vercel login`); usage (`node collect.mjs --project <name> [--only <cat>] [--dry-run]`); onboarding a new project (copy example.json → fill → run); the 7 categories → CC mapping table; where evidence lands; the manual `_manual/` templates; that gaps are honest findings not failures.

- [ ] **Step 3: Collector's own CI** — `.github/workflows/ci.yml` running `node --test` on push (only if this repo gets a GitHub remote; otherwise note it's local). This is the collector repo's CI, unrelated to any app repo.

- [ ] **Step 4: First real run against LyricPro** (writes into the real evidence folder)

Run: `node collect.mjs --project lyricpro`
Expected: `Collected → <lyricpro>/compliance/evidence/<date>-collection`. Inspect `MANIFEST.md` (all 7 categories, CC criteria, real artifacts), `COVERAGE.md` (code-review/deployment-approval = GAP branch-protection; access-control notes Dependabot off; vuln = 0). Confirm no secrets in any written file: `grep -rIE "postgres(ql)?://|sk_live|whsec|ghp_|eyJ[A-Za-z0-9]" <lyricpro>/compliance/evidence/<date>-collection` → 0 matches.

- [ ] **Step 5: Commit the collector repo + fill an owner note**

```bash
cd ~/Documents/myWork/Compliance/soc2-evidence-collector
git add -A && git commit -m "feat: reuse polish — example config, README, collector CI"
```
The generated evidence lives in LyricPro's gitignored `compliance/evidence/` (local-only, not committed to any app repo — intended). Append to LyricPro `todo.md` under the SOC 2 section: `- [x] Evidence collector built (~/Documents/myWork/Compliance/soc2-evidence-collector); first run <date>. Follow-ups: fill _manual/ templates (MFA screenshots, prod access list, QA signoffs); wire monthly scheduled run.` and commit that todo.md change in the LyricPro repo.

- [ ] **Step 6: Verify final state**

Run (collector repo): `node --test` → all pass. `git log --oneline` → 5 feature commits. Confirm the collector added ZERO files to any app repo except the one-line LyricPro `todo.md` note.
