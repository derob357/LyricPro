// Phase 5c — Read-path feature flag.
//
// Controls whether the game-router runtime reads lyric variants from the
// legacy `songs.lyricVariants` jsonb column (OFF, default) or from the
// three-layer schema `lyric_moments` + `gameplay_items` (ON).
//
// Resolution: env var `LYRIC_PRO_READ_FROM_LAYER3`, evaluated ONCE at module
// load (no per-request lookup). Truthy values are "1" and "true"
// (case-insensitive); anything else — including unset — leaves the flag OFF
// and the legacy path stays active.
//
// The flag is intentionally checked at module load so flipping the env var
// requires the serverless lambda to re-initialize (a deploy or env edit on
// Vercel triggers a fresh function instance). This is the same lifecycle as
// every other ENV-derived constant in this project.
//
// Cutover plan: Phase 5e flips the env var on Vercel; no code change is
// required for the flip. To roll back, unset the env var (or set to "0")
// and re-deploy or wait for the next cold start.

function readFlag(): boolean {
  const raw = (process.env.LYRIC_PRO_READ_FROM_LAYER3 ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export const READ_FROM_LAYER3 = readFlag();
