import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  genres,
  banners,
  bannerImpressions,
  suggestionRules,
  commentaryTemplates,
  lyricMoments,
  gameplayItems,
} from "../../drizzle/schema";

/**
 * Regression test for the silent column-name drift bug.
 *
 * The Drizzle schema declares table columns with a TypeScript field name
 * (`createdAt`) and an underlying DB column name (the string argument to
 * `timestamp("...")`). These MUST match what the migration SQL created.
 *
 * Migrations 0007/0009/0010/0011 + the out-of-band three-layer migration
 * declared these timestamp columns as snake_case (`created_at`, `updated_at`).
 * The shared `createdAtColumn()` / `updatedAtColumn()` helpers in schema.ts
 * map to camelCase (`createdAt`, `updatedAt`) — and using them on these
 * tables generated SQL that 500'd at runtime:
 *
 *   ERROR: column "createdAt" of relation "genres" does not exist
 *
 * which propagated as `INTERNAL_SERVER_ERROR` to tRPC clients and silently
 * broke the admin/songs Genre dropdown, the Shop banners, the AI commentary
 * engine, the suggestion engine, and the admin Banners/Suggestions tabs.
 *
 * If a future migration adds another snake_case timestamp column and a future
 * schema author reaches for the shared helper, this test fails before the
 * code ships.
 */
describe("schema column names match migration SQL", () => {
  it("genres.createdAt → created_at", () => {
    expect(getTableColumns(genres).createdAt.name).toBe("created_at");
  });

  it("suggestion_rules.{createdAt,updatedAt} → snake_case", () => {
    const cols = getTableColumns(suggestionRules);
    expect(cols.createdAt.name).toBe("created_at");
    expect(cols.updatedAt.name).toBe("updated_at");
  });

  it("commentary_templates.{createdAt,updatedAt} → snake_case", () => {
    const cols = getTableColumns(commentaryTemplates);
    expect(cols.createdAt.name).toBe("created_at");
    expect(cols.updatedAt.name).toBe("updated_at");
  });

  it("banners.{createdAt,updatedAt} → snake_case", () => {
    const cols = getTableColumns(banners);
    expect(cols.createdAt.name).toBe("created_at");
    expect(cols.updatedAt.name).toBe("updated_at");
  });

  it("banner_impressions.shownAt → shown_at (and no created/updated)", () => {
    const cols = getTableColumns(bannerImpressions);
    expect(cols.shownAt.name).toBe("shown_at");
    expect(cols.clickedAt.name).toBe("clicked_at");
  });

  it("lyric_moments + gameplay_items use snake_case for created_at/updated_at", () => {
    expect(getTableColumns(lyricMoments).createdAt.name).toBe("created_at");
    expect(getTableColumns(lyricMoments).updatedAt.name).toBe("updated_at");
    expect(getTableColumns(gameplayItems).createdAt.name).toBe("created_at");
    expect(getTableColumns(gameplayItems).updatedAt.name).toBe("updated_at");
  });
});
