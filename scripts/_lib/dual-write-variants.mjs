// scripts/_lib/dual-write-variants.mjs
//
// Phase 5d — Write-path dual-write helper.
//
// Mission: every generation script that mutates per-song lyric content must
// keep the LEGACY store (songs.lyricVariants jsonb) and the LAYER-3 store
// (lyric_moments + gameplay_items) in lockstep until the legacy column is
// dropped in Phase 5g. Without this, any new song or regenerated variant
// would only land in the legacy column and become invisible to the layer-3
// read path once the feature flag flips.
//
// API
// ───
//   syncSongVariants(sql, songId, variants)
//
// `sql` is a postgres-js client. `variants` is the standard
// Array<{prompt, answer, distractors, sectionType}> shape used everywhere
// else in the codebase.
//
// Behavior
// ────────
//   1. Begins a single Postgres transaction (sql.begin).
//   2. UPDATEs songs.lyricVariants jsonb with the new array (legacy path —
//      preserves the existing read behavior).
//   3. Replaces the song's layer-3 rows entirely:
//        DELETE FROM gameplay_items WHERE song_id = X
//        DELETE FROM lyric_moments  WHERE song_id = X
//        INSERT one moment + one item per variant, mirroring the
//        scripts/backfill-three-layer.mjs pattern.
//   4. Commits.
//
// If the legacy UPDATE or any layer-3 statement fails, the transaction
// rolls back — the two stores cannot drift out of sync.
//
// Idempotency: feeding the same `variants` array twice produces identical
// final state in both stores. The DELETE+INSERT replacement pattern is
// heavier than a diff-based update, but per-song frequency is low (only
// when generation runs) and the bulletproof correctness is worth the cost.
//
// ON CONFLICT note: the moment INSERT uses
//   ON CONFLICT (song_id, lyric_text) DO UPDATE SET section_order = EXCLUDED.section_order
// to handle the case where two variants on the same song collapse to the
// same lyric_text (e.g. Marvin Gaye "Let's Get It On" — multiple variants
// hit the same hook line). The first INSERT lands the moment; subsequent
// variants with the same lyric_text reuse that moment id and only differ at
// the gameplay_items level.
//
// Also exports `clearSongLayer3` for the deactivation path: when a song is
// flagged isActive=false because every variant failed regen, its layer-3
// rows must be removed too — otherwise the layer-3 reader would still see
// gameplay_items for an inactive song.

/**
 * Build the lyric_text used to dedup lyric_moments per song. Mirrors the
 * pattern in scripts/backfill-three-layer.mjs::lyricTextFromVariant.
 *
 * @param {{prompt?: string, answer?: string}} variant
 * @returns {string}
 */
export function lyricTextFromVariant(variant) {
  const p = (variant?.prompt ?? "").toString().trim();
  const a = (variant?.answer ?? "").toString().trim();
  if (p && a) return `${p} ${a}`;
  return p || a;
}

/**
 * Map the legacy songs.difficulty enum to the three boolean fit flags on
 * lyric_moments. Mirrors scripts/backfill-three-layer.mjs::difficultyFitFlags.
 *
 * @param {"low"|"medium"|"high"|string|null|undefined} difficulty
 */
function difficultyFitFlags(difficulty) {
  return {
    low_fit: difficulty === "low",
    medium_fit: difficulty === "medium",
    hard_fit: difficulty === "high",
  };
}

/**
 * Atomically replace a song's lyric variants in BOTH stores.
 *
 * @param {import("postgres").Sql} sql        postgres-js client
 * @param {number}                 songId
 * @param {Array<{prompt: string, answer: string, distractors: string[], sectionType: string}>} variants
 */
export async function syncSongVariants(sql, songId, variants) {
  if (!Number.isInteger(songId) || songId <= 0) {
    throw new Error(`syncSongVariants: invalid songId ${songId}`);
  }
  if (!Array.isArray(variants)) {
    throw new Error(`syncSongVariants: variants must be an array (got ${typeof variants})`);
  }

  await sql.begin(async (tx) => {
    // ─── 1. Resolve the parent song's difficulty for moment fit-flag math ──
    const [songRow] = await tx`
      SELECT id, difficulty
      FROM songs
      WHERE id = ${songId}
      LIMIT 1
    `;
    if (!songRow) {
      throw new Error(`syncSongVariants: song id ${songId} not found`);
    }
    const fits = difficultyFitFlags(songRow.difficulty);

    // ─── 2. Legacy store: rewrite songs.lyricVariants jsonb ────────────────
    // tx.json() ensures postgres-js binds the array as jsonb, not as a
    // JSON-encoded string (that bug bit generate-lyric-variants once already).
    await tx`
      UPDATE songs
      SET "lyricVariants" = ${tx.json(variants)},
          "updatedAt"    = NOW()
      WHERE id = ${songId}
    `;

    // ─── 3. Layer-3 store: blow away existing rows, reinsert from scratch ──
    // gameplay_items first (FK -> lyric_moments via lyric_moment_id), then
    // lyric_moments. The ordering matters because lyric_moments could be
    // RESTRICT-referenced by other items — this script only manages this
    // song's moments, so deleting the items first is sufficient.
    await tx`DELETE FROM gameplay_items WHERE song_id = ${songId}`;
    await tx`DELETE FROM lyric_moments  WHERE song_id = ${songId}`;

    // Re-insert one moment + one item per variant. ON CONFLICT preserves the
    // dedup behavior the backfill script established: if two variants on the
    // same song produce the same lyric_text, both gameplay_items point at the
    // same moment row.
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i] ?? {};
      const lyricText = lyricTextFromVariant(variant);
      if (!lyricText) {
        // Empty/garbage variant — skip both moment and item. Defensive: the
        // verification gate upstream should keep these from arriving here.
        continue;
      }

      const [m] = await tx`
        INSERT INTO lyric_moments (
          song_id, section_type, section_order, candidate_use_case,
          lyric_text,
          low_fit, medium_fit, hard_fit,
          song_recognition_fit, artist_recognition_fit,
          year_fit, finish_the_lyric_fit,
          reviewer_notes, approval_status, approved_at
        ) VALUES (
          ${songId},
          ${variant.sectionType ?? "verse"},
          ${i + 1},
          'finish_the_lyric',
          ${lyricText},
          ${fits.low_fit}, ${fits.medium_fit}, ${fits.hard_fit},
          true, true, true, true,
          ${`Synced from dual-write at variant index ${i}`},
          'approved', NOW()
        )
        ON CONFLICT (song_id, lyric_text) DO UPDATE
          SET section_order = EXCLUDED.section_order
        RETURNING id
      `;
      const momentId = m.id;

      const distractors = Array.isArray(variant.distractors)
        ? variant.distractors
        : [];

      await tx`
        INSERT INTO gameplay_items (
          lyric_moment_id, song_id,
          difficulty, question_type, prompt_format,
          prompt_text, correct_answer,
          distractor_1, distractor_2, distractor_3,
          qa_status, is_active
        ) VALUES (
          ${momentId}, ${songId},
          ${songRow.difficulty}, 'finish_the_lyric', 'multiple_choice',
          ${variant.prompt ?? ""}, ${variant.answer ?? ""},
          ${distractors[0] ?? null},
          ${distractors[1] ?? null},
          ${distractors[2] ?? null},
          'passed', true
        )
      `;
    }
  });
}

/**
 * Wipe a song's layer-3 rows. Used by the deactivation path in
 * regenerate-failing-variants.mjs when every variant failed regen and the
 * song flips to isActive=false — we don't want stale gameplay_items
 * referenced by the layer-3 reader.
 *
 * Does NOT touch songs.lyricVariants. The legacy reader filters by
 * isActive itself, so leaving the legacy jsonb in place is harmless and
 * preserves the audit trail of what the song *was* before deactivation.
 *
 * @param {import("postgres").Sql} sql
 * @param {number}                 songId
 */
export async function clearSongLayer3(sql, songId) {
  if (!Number.isInteger(songId) || songId <= 0) {
    throw new Error(`clearSongLayer3: invalid songId ${songId}`);
  }
  await sql.begin(async (tx) => {
    await tx`DELETE FROM gameplay_items WHERE song_id = ${songId}`;
    await tx`DELETE FROM lyric_moments  WHERE song_id = ${songId}`;
  });
}
