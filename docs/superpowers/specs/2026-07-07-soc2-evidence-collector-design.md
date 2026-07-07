# SOC 2 Evidence Collector — Design

**Date:** 2026-07-07
**Status:** Approved (brainstorm complete)
**Purpose:** A standalone, reusable tool that collects SOC 2 audit evidence from GitHub / Vercel / CI + generates templates for manual evidence, writing organized, auditor-facing artifacts into each project's `compliance/evidence/` folder.

## Constraints (from brainstorm)

| Decision | Choice |
|---|---|
| Where the tool lives | **Separate git repo** at `~/Documents/myWork/Compliance/soc2-evidence-collector` (versioned; serves multiple projects) |
| Relationship to app code | **Zero footprint in any app repo.** Never added to LyricPro (or other) app code/CI. Only writes into the target project's `compliance/evidence/`. |
| Runtime | Node (ESM), own `package.json` + minimal CI |
| Auth | Shell out to authed `gh` CLI (keychain session — **no GitHub token stored**) + `vercel` CLI (`vercel login` session or `VERCEL_TOKEN` from env at runtime) |
| Mutations | **None.** Read-only API GETs + local file writes. Records controls that are OFF as gaps; never flips them. |
| Reuse | **Config-driven, project-agnostic.** One config file per project; core + collectors are generic. |
| Cadence | Manual run now (`node collect.mjs --project <name>`); scheduling is a documented follow-up. |
| Secrets/PII | No tokens in repo or evidence; redaction pass before write; captures collaborator logins + permission levels, not emails/PII. |

## Architecture

Standalone Node CLI. `collect.mjs` loads a project config, runs the 7 category collectors, and writes a dated evidence run + an auditor-facing manifest/coverage report.

```
soc2-evidence-collector/            (new repo, ~/Documents/myWork/Compliance/)
├── collect.mjs                     # CLI entry: --project <name> [--dry-run] [--only <cat>]
├── package.json                    # ESM, own deps (minimal), own CI
├── lib/
│   ├── config.mjs                  # load + validate projects/<name>.json
│   ├── run.mjs                     # orchestrate collectors, build MANIFEST/COVERAGE
│   ├── sh.mjs                      # safe child_process wrapper for gh/vercel/pnpm
│   ├── redact.mjs                  # strip token/DSN/key patterns before write
│   └── manifest.mjs                # MANIFEST.md + COVERAGE.md + collection.json
├── collectors/                     # one module per category, uniform interface
│   ├── code-review.mjs
│   ├── change-request.mjs
│   ├── testing.mjs
│   ├── deployment-approval.mjs
│   ├── deployment-evidence.mjs
│   ├── access-control.mjs
│   └── vulnerability-review.mjs
├── templates/                      # manual-evidence markdown templates
│   ├── manual-qa-checklist.md
│   ├── release-approval-checklist.md
│   ├── production-access-list.md
│   ├── mfa-attestation.md
│   └── manual-dependency-review.md
├── projects/
│   ├── lyricpro.json               # LyricPro config
│   └── example.json                # commented template for new projects
├── fixtures/                       # recorded gh/vercel/pnpm JSON for offline tests
└── test/                           # unit tests (vitest or node:test)
```

**Collector interface (uniform):** `async collect(config, ctx) → { category, artifacts: [{ path, kind, controlIds }], status: "collected" | "gap" | "manual-pending", notes }`. `ctx` provides the run dir, a `sh` runner, and `write(relPath, data)` (which redacts). Each collector is independently testable with fixtures.

## Config schema — `projects/<name>.json`

```json
{
  "project": "lyricpro",
  "githubRepo": "derob357/LyricPro",
  "vercelProject": "lyricpro-ai",
  "vercelScope": null,
  "projectRoot": "/Users/drob/Documents/myWork/CCS/LyricPro/lyricpro-ai-2.0",
  "outputDir": "/Users/drob/Documents/myWork/CCS/LyricPro/lyricpro-ai-2.0/compliance/evidence",
  "window": { "days": 90 },
  "ciWorkflow": "CI",
  "controlMap": {
    "code-review": ["CC8.1"],
    "change-request": ["CC8.1"],
    "testing": ["CC8.1"],
    "deployment-approval": ["CC8.1"],
    "deployment-evidence": ["CC8.1"],
    "access-control": ["CC6.1", "CC6.2", "CC6.3"],
    "vulnerability-review": ["CC7.1"]
  }
}
```

`projectRoot` = the target repo (for `pnpm audit`, git tags, local docs). `outputDir` = where evidence is written (the target project's `compliance/evidence/`). `controlMap` values are illustrative defaults — confirm against the target project's control matrix at plan time.

## The 7 collectors

Each writes raw JSON + a human `.md` summary into `<run>/<category>/`. Auto where an API exposes it; a generated template + drop-folder where the evidence is inherently manual.

| # | Category | Auto (source) | Manual (template + `_manual/…/screenshots/`) | Control |
|---|---|---|---|---|
| 1 | Code review | `gh api` PRs in window (state, mergedBy, reviewers, **approval decisions**); `gh api …/branches/main/protection` (records ON/OFF) | — | CC8.1 |
| 2 | Change request | `gh api` Issues (open/closed, labels, linked PRs); index of `docs/superpowers/specs` + `plans` as documented change tickets | — | CC8.1 |
| 3 | Testing | CI runs (`gh api …/actions/runs`: conclusion, html_url) + download latest run's test-step log | `manual-qa-checklist.md` + `screenshots/` (owner smoke signoffs) | CC8.1 |
| 4 | Deployment approval | PR merge-approvals (reuses #1 data) | `release-approval-checklist.md` | CC8.1 |
| 5 | Deployment evidence | `vercel` prod deployments (state, commit SHA, timestamps, URL) + `git tag` release tags + tag/release notes | — | CC8.1 |
| 6 | Access control | `gh api …/collaborators` (login + permission level); Dependabot/security status | `production-access-list.md` (Supabase/Vercel/Stripe/AWS admins) + `mfa-attestation.md` + `screenshots/` | CC6.1/6.2/6.3 |
| 7 | Vulnerability review | `pnpm audit --json` in `projectRoot` (or read CI audit log) + Dependabot enabled/disabled | `manual-dependency-review.md` | CC7.1 |

Branch protection and Dependabot are currently OFF on LyricPro — collectors 1 and 6/7 record that honestly as `gap`, per "collect only."

## Output structure

Per run: `<outputDir>/<YYYY-MM-DD>-collection/`
- One subfolder per category (raw JSON + `.md` summary).
- **`MANIFEST.md`** — auditor-facing: every artifact → control → CC criteria → auto vs manual-pending → collected-at.
- **`COVERAGE.md`** — green/gap/manual-pending scorecard (e.g. "branch protection: GAP — off"; "MFA screenshots: PENDING owner upload").
- `collection.json` — machine-readable run summary.

Manual templates are generated **once** into a stable `<outputDir>/_manual/` (not overwritten per run, so filled-in signoffs/screenshots persist). Each run's MANIFEST links them and flags any still empty.

## Secrets & PII

- No tokens in the repo or in evidence. `gh` uses the keychain session; Vercel uses its login session or `VERCEL_TOKEN` read from env at runtime only.
- **Redaction pass** (`lib/redact.mjs`) runs on all captured CLI output before write — strips token/DSN/key/JWT-shaped patterns (defense-in-depth against an API echoing a secret).
- Access-control evidence records collaborator **login + permission level** (needed for the control); it does NOT record emails/PII unless an API unavoidably returns them, and the collector documents exactly which identifiers it captures.
- Evidence lands in the target project's `compliance/` folder, which is gitignored/local-only (no accidental publication).

## Reuse across projects

Everything project-specific is in `projects/<name>.json`; core + all 7 collectors are generic. Onboarding another project (Rafi, Arabis, IntentionAI, …) = add a config file pointing at that repo / Vercel project / compliance path. Ships with `projects/lyricpro.json` + a fully-commented `projects/example.json` and a README onboarding section.

## Testing

- Unit tests (node:test or vitest) for parsing / manifest / coverage / redaction logic, run against **recorded JSON fixtures** (captured `gh`/`vercel`/`pnpm audit` outputs) — offline, no live API calls.
- `--dry-run` performs live read-only collection into a temp dir without touching the real evidence folder.
- Redaction has explicit tests (feed synthetic secrets → assert they never reach output).
- The collector's own minimal CI runs the unit tests.

## Error handling

- Each collector is isolated: a failure (e.g. Vercel not linked, gh not authed) marks that category `gap`/`error` in COVERAGE with the reason and continues — one broken source never aborts the whole run.
- Missing auth is a clear, actionable message ("run `gh auth login` / `vercel login`"), never a stack trace.

## Phasing (each independently useful)

1. **Core**: repo scaffold + `config.mjs` + `run.mjs` + `manifest.mjs` + `redact.mjs` + `sh.mjs` + the **code-review** collector end-to-end → produces a real MANIFEST/COVERAGE against LyricPro. Proves the whole pipeline.
2. **Remaining 6 collectors** + the 5 manual templates.
3. **Reuse polish**: `example.json`, README onboarding, documented monthly cadence.

## Out of scope (recorded)

- Enabling branch protection / Dependabot (owner decision; collector records them as gaps).
- Scheduled automation (follow-up — manual run first).
- Non-GitHub/Vercel integrations (Jira/Snyk/ServiceNow) — config leaves room; not built now.
- Uploading evidence anywhere external (stays in the local, gitignored `compliance/` folder).
