import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { lintDdex, type LintIssue } from "./_core/ddex-lint";

const fixtureDir = path.resolve(import.meta.dirname, "fixtures");

function fixtureContent(): string {
  return readFileSync(
    path.join(fixtureDir, "ddex-expected-output.tsv"),
    "utf-8",
  );
}

/** Build a minimal valid-ish file string from an array of record arrays. */
function makeFile(records: string[][]): string {
  return records.map((cells) => cells.join("\t")).join("\n") + "\n";
}

/** One valid AS02.04 resource record with a well-formed ISRC at cell 4. */
const VALID_AS = [
  "AS02.04",
  "BLK-1",
  "1",
  "RES-USRC12400001",
  "USRC12400001",
  "Some Title",
  "",
  "Some Artist",
  "",
  "",
  "SoundRecording",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "true",
  "false",
  "",
  "Some Artist",
];

/** Minimal file: HEAD + SY + RE + AS + SU + FOOT (no issues expected). */
function makeMinimalValid(): string {
  return makeFile([
    [
      "HEAD",
      "2025-current",
      "BasicAudioProfile",
      "1.4",
      "MSG-MAIN-20260515T031500",
      "2026-05-15T03:15:00Z",
      "1",
      "1",
      "2026-04-01",
      "2026-04-30",
      "LYRICPRO",
      "LYRICPRO",
      "LyricProApp",
      "RECIP",
      "RECIP",
      "",
    ],
    [
      "SY01.03",
      "SUM-1",
      "LyricProApp",
      "",
      "SubscriptionModel",
      "OnDemandStream",
      "US",
      "LyricProApp-Premium",
      "1",
      "",
      "USD",
      "0.00",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    ["RE01.03", "BLK-1", "1", "REL-USRC12400001", "", "", "", "Artist", "", "Title", "", "Single", "", "", "LyricPro", "", "Artist"],
    VALID_AS,
    ["SU02.03", "BLK-1", "SUM-1", "TXN-1", "", "1", "true", "1", "", "", "OnDemandStream", ""],
    ["FOOT", "6", "6", "1", "", ""],
  ]);
}

describe("lintDdex", () => {
  it("returns [] for the real ddex-expected-output.tsv fixture", () => {
    const issues = lintDdex(fixtureContent());
    expect(issues).toEqual([]);
  });

  it("flags MISSING_HEAD when the file does not start with HEAD", () => {
    const content = makeMinimalValid().replace(/^HEAD\t/, "BADSTART\t");
    const issues = lintDdex(content);
    const codes = issues.map((i: LintIssue) => i.code);
    expect(codes).toContain("MISSING_HEAD");
  });

  it("flags MISSING_FOOT when the file does not end with FOOT", () => {
    // Replace last FOOT record code with something else
    const content = makeMinimalValid().replace(/^FOOT\t/m, "BADEND\t");
    const issues = lintDdex(content);
    const codes = issues.map((i: LintIssue) => i.code);
    expect(codes).toContain("MISSING_FOOT");
  });

  it("flags BAD_ISRC for a malformed ISRC in an AS02.04 record", () => {
    const badAs = [...VALID_AS];
    badAs[4] = "BADISRC123"; // cell 4 is the ResourceISRC
    const content = makeFile([
      [
        "HEAD",
        "2025-current",
        "BasicAudioProfile",
        "1.4",
        "MSG-MAIN-20260515T031500",
        "2026-05-15T03:15:00Z",
        "1",
        "1",
        "2026-04-01",
        "2026-04-30",
        "LYRICPRO",
        "LYRICPRO",
        "LyricProApp",
        "RECIP",
        "RECIP",
        "",
      ],
      [
        "SY01.03",
        "SUM-1",
        "LyricProApp",
        "",
        "SubscriptionModel",
        "OnDemandStream",
        "US",
        "LyricProApp-Premium",
        "1",
        "",
        "USD",
        "0.00",
        "",
        "",
        "",
        "",
        "",
        "",
      ],
      ["RE01.03", "BLK-1", "1", "REL-BADISRC123", "", "", "", "Artist", "", "Title", "", "Single", "", "", "LyricPro", "", "Artist"],
      badAs,
      ["SU02.03", "BLK-1", "SUM-1", "TXN-1", "", "1", "true", "1", "", "", "OnDemandStream", ""],
      ["FOOT", "6", "6", "1", "", ""],
    ]);
    const issues = lintDdex(content);
    const codes = issues.map((i: LintIssue) => i.code);
    expect(codes).toContain("BAD_ISRC");
    const isrcIssue = issues.find((i: LintIssue) => i.code === "BAD_ISRC");
    expect(isrcIssue?.detail).toContain("BADISRC123");
  });

  it("flags EMPTY_MAIN for a file with only HEAD and FOOT", () => {
    const content = makeFile([
      [
        "HEAD",
        "2025-current",
        "BasicAudioProfile",
        "1.4",
        "MSG",
        "2026-05-15T03:15:00Z",
        "1",
        "1",
        "2026-04-01",
        "2026-04-30",
        "LYRICPRO",
        "LYRICPRO",
        "LyricProApp",
        "RECIP",
        "RECIP",
        "",
      ],
      ["FOOT", "2", "2", "0", "", ""],
    ]);
    const issues = lintDdex(content);
    const codes = issues.map((i: LintIssue) => i.code);
    expect(codes).toContain("EMPTY_MAIN");
  });

  it("flags NO_USAGE for a file with HEAD + SY + RE + AS + FOOT but no SU record", () => {
    const content = makeFile([
      [
        "HEAD",
        "2025-current",
        "BasicAudioProfile",
        "1.4",
        "MSG",
        "2026-05-15T03:15:00Z",
        "1",
        "1",
        "2026-04-01",
        "2026-04-30",
        "LYRICPRO",
        "LYRICPRO",
        "LyricProApp",
        "RECIP",
        "RECIP",
        "",
      ],
      [
        "SY01.03",
        "SUM-1",
        "LyricProApp",
        "",
        "SubscriptionModel",
        "OnDemandStream",
        "US",
        "LyricProApp-Premium",
        "1",
        "",
        "USD",
        "0.00",
        "",
        "",
        "",
        "",
        "",
        "",
      ],
      ["RE01.03", "BLK-1", "1", "REL-USRC12400001", "", "", "", "Artist", "", "Title", "", "Single", "", "", "LyricPro", "", "Artist"],
      VALID_AS,
      ["FOOT", "5", "5", "1", "", ""],
    ]);
    const issues = lintDdex(content);
    const codes = issues.map((i: LintIssue) => i.code);
    expect(codes).toContain("NO_USAGE");
    expect(codes).not.toContain("NO_SUMMARY");
    expect(codes).not.toContain("EMPTY_MAIN");
  });
});
