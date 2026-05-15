import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  generateDdexDsr,
  type ExportContext,
  type SongDisplayWithSong,
} from "./_core/ddex-exporter";

const fixtureDir = path.resolve(import.meta.dirname, "fixtures");

const rows: SongDisplayWithSong[] = JSON.parse(
  readFileSync(path.join(fixtureDir, "ddex-sample-input.json"), "utf-8"),
);

function ctx(overrides: Partial<ExportContext> = {}): ExportContext {
  return {
    messageSender: "LYRICPRO-UNREGISTERED",
    messageRecipient: "PADPIDA2021010101A",
    reportingPeriodStart: new Date("2026-04-01T00:00:00.000Z"),
    reportingPeriodEnd: new Date("2026-04-30T00:00:00.000Z"),
    messageVersion: "2025-current",
    ...overrides,
  };
}

describe("generateDdexDsr", () => {
  it("generates a mainFile that starts with the HEAD record code", () => {
    const { mainFile } = generateDdexDsr(rows, ctx());
    expect(mainFile.startsWith("HEAD\t")).toBe(true);
  });

  it("generates a mainFile that ends with the FOOT record code", () => {
    const { mainFile } = generateDdexDsr(rows, ctx());
    const lines = mainFile.trim().split("\n");
    expect(lines[lines.length - 1].startsWith("FOOT\t")).toBe(true);
  });

  it("routes rows without an ISRC into the noMatchFile, not the mainFile", () => {
    const { mainFile, noMatchFile } = generateDdexDsr(rows, ctx());
    // "Paper Lanterns" is the isrc:null row in the fixture.
    expect(mainFile).not.toContain("Paper Lanterns");
    expect(noMatchFile).not.toBeNull();
    expect(noMatchFile as string).toContain("Paper Lanterns");
    expect((noMatchFile as string).startsWith("HEAD\t")).toBe(true);
  });

  it("returns noMatchFile === null when every row has an ISRC", () => {
    const onlyMatched = rows.filter((r) => r.isrc !== null);
    const { noMatchFile } = generateDdexDsr(onlyMatched, ctx());
    expect(noMatchFile).toBeNull();
  });

  it("conglomerates N rows in the same group into 1 usage record", () => {
    // The fixture has 2 rows for USRC12400001 / US / subscription.
    // They must collapse into a single SU02.03 row with NumberOfStreams = 2.
    const { mainFile } = generateDdexDsr(rows, ctx());
    const suLines = mainFile
      .split("\n")
      .filter((l) => l.startsWith("SU02.03\t"));
    // Matched rows: USRC1 US (2 events -> 1 rec), USRC1 CA (1 -> 1),
    // USRC2 US (2 events -> 1 rec) = 3 usage records total.
    expect(suLines).toHaveLength(3);
    // SU02.03 cell 8 (index 7) is NumberOfStreams. Two groups summed 2 events
    // each (USRC...01/US/subscription and USRC...02/US/ad_supported); one had 1.
    const streamCounts = suLines
      .map((l) => l.split("\t")[7])
      .sort();
    expect(streamCounts).toEqual(["1", "2", "2"]);
  });

  it("produces a filename matching the DDEX DSR naming pattern", () => {
    const { filename } = generateDdexDsr(rows, ctx());
    // DSR_<recipient>_<sender>_<service>_<period>_<territory>_<created>.tsv
    expect(filename).toMatch(
      /^DSR_[^_]+_[^_]+_[^_]+_\d{4}-\d{2}-\d{2}--\d{4}-\d{2}-\d{2}_[A-Za-z]+_\d{8}T\d{6}\.tsv$/,
    );
  });

  it("matches the expected-output snapshot", () => {
    const expectedTsv = readFileSync(
      path.join(fixtureDir, "ddex-expected-output.tsv"),
      "utf-8",
    );
    // MessageCreatedDateTime is non-deterministic; pin it via a fixed clock.
    const fixed = new Date("2026-05-15T03:15:00.000Z");
    const { mainFile } = generateDdexDsr(rows, ctx({ now: fixed }));
    expect(mainFile.trim()).toBe(expectedTsv.trim());
  });
});
