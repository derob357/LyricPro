/**
 * Lightweight DDEX DSR flat-file structural linter.
 *
 * Checks obvious shape errors before a file is handed to a publisher.
 * This is NOT a full DDEX-validator — it catches structural omissions only.
 *
 * Pure function: string in, issues out. No file I/O.
 */

export interface LintIssue {
  /** Machine-readable error code. */
  code: string;
  /** 1-based line number, when applicable. */
  line?: number;
  /** Human-readable extra context. */
  detail?: string;
}

/**
 * Valid ISRC pattern: 2 uppercase letters (country) + 3 uppercase alphanumerics
 * (registrant) + 7 digits (designation code). Total 12 characters.
 * ISO 3901 / DDEX ResourceISRC column in AS02.04 at cell index 4.
 */
const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

/**
 * Lint a DDEX DSR Basic Audio Profile flat-file.
 *
 * Returns an empty array when the file passes all checks.
 */
export function lintDdex(content: string): LintIssue[] {
  const issues: LintIssue[] = [];

  // Split on any line ending; filter to non-empty lines for structural checks.
  const rawLines = content.split(/\r?\n/);
  const nonEmptyLines = rawLines
    .map((text, idx) => ({ text, lineNo: idx + 1 }))
    .filter(({ text }) => text.trim() !== "");

  if (nonEmptyLines.length === 0) {
    // Completely empty file — flag all applicable structural issues.
    issues.push({ code: "MISSING_HEAD" });
    issues.push({ code: "MISSING_FOOT" });
    issues.push({ code: "NO_SUMMARY" });
    issues.push({ code: "NO_USAGE" });
    return issues;
  }

  const firstLine = nonEmptyLines[0];
  const lastLine = nonEmptyLines[nonEmptyLines.length - 1];

  // ── 1. MISSING_HEAD ──────────────────────────────────────────────────────
  const firstCell = (line: { text: string }) => line.text.split("\t")[0];

  if (firstCell(firstLine) !== "HEAD") {
    issues.push({
      code: "MISSING_HEAD",
      line: firstLine.lineNo,
      detail: `First non-empty line starts with '${firstCell(firstLine)}', expected 'HEAD'`,
    });
  }

  // ── 2. MISSING_FOOT ──────────────────────────────────────────────────────
  if (firstCell(lastLine) !== "FOOT") {
    issues.push({
      code: "MISSING_FOOT",
      line: lastLine.lineNo,
      detail: `Last non-empty line starts with '${firstCell(lastLine)}', expected 'FOOT'`,
    });
  }

  // ── Gather record codes for subsequent checks ─────────────────────────────
  let hasSummary = false;
  let hasUsage = false;
  let hasMainBody = false; // any RE, AS, or SU record

  for (const { text, lineNo } of nonEmptyLines) {
    const cells = text.split("\t");
    const code = cells[0];

    if (code.startsWith("SY")) hasSummary = true;
    if (code.startsWith("SU")) hasUsage = true;
    if (
      code.startsWith("RE") ||
      code.startsWith("AS") ||
      code.startsWith("SU")
    ) {
      hasMainBody = true;
    }

    // ── 5. BAD_ISRC — check AS02.04 ResourceISRC at cell index 4 ────────────
    if (code === "AS02.04") {
      const isrcCell = cells[4] ?? "";
      // Only report if the cell is non-empty — a blank means unknown/omitted,
      // which is a separate concern (not shape-malformed).
      if (isrcCell !== "" && !ISRC_RE.test(isrcCell)) {
        issues.push({
          code: "BAD_ISRC",
          line: lineNo,
          detail: `Malformed ISRC '${isrcCell}' in AS02.04 record`,
        });
      }
    }
  }

  // ── 3. NO_SUMMARY ────────────────────────────────────────────────────────
  if (!hasSummary) {
    issues.push({
      code: "NO_SUMMARY",
      detail: "No record whose first cell starts with 'SY' was found",
    });
  }

  // ── 4. NO_USAGE ──────────────────────────────────────────────────────────
  if (!hasUsage) {
    issues.push({
      code: "NO_USAGE",
      detail: "No record whose first cell starts with 'SU' was found",
    });
  }

  // ── 6. EMPTY_MAIN — HEAD and FOOT present but no RE/AS/SU body records ───
  if (!hasMainBody) {
    // Only flag if both HEAD and FOOT are present (otherwise other issues already
    // describe the problem more precisely).
    const headOk = firstCell(firstLine) === "HEAD";
    const footOk = firstCell(lastLine) === "FOOT";
    if (headOk && footOk) {
      issues.push({
        code: "EMPTY_MAIN",
        detail: "File has HEAD and FOOT but no RE/AS/SU records between them",
      });
    }
  }

  return issues;
}
