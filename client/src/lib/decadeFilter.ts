/**
 * Returns the subset of `allDecades` that have enough songs for the selected
 * genres. Used to hide decades with fewer than `minSongs` (default 5) from
 * the decade picker when there is not enough content to make the selection
 * worthwhile.
 *
 * Rules (in priority order):
 * 1. `counts` undefined (loading) or `selectedGenres` empty → return allDecades.
 * 2. "Mixed" in selectedGenres → treat as ALL genres (sum every genre's counts).
 * 3. A decade qualifies if sum of counts[genre][decade] across selectedGenres ≥ minSongs.
 * 4. If NO decade qualifies → fall back to decades with ≥1 song across the selection.
 * 5. If that is also empty → return allDecades (never leave an empty picker).
 */
export function availableDecades(
  counts: Record<string, Record<string, number>> | undefined,
  selectedGenres: string[],
  allDecades: string[],
  minSongs = 5,
): string[] {
  // Rule 1 — loading or nothing selected
  if (!counts || selectedGenres.length === 0) return allDecades;

  // Rule 2 — "Mixed" means every genre in the counts object
  const isMixed = selectedGenres.includes("Mixed");
  const genresToSum: string[] = isMixed ? Object.keys(counts) : selectedGenres;

  // Sum counts per decade across the relevant genres
  const decadeTotal: Record<string, number> = {};
  for (const genre of genresToSum) {
    const genreCounts = counts[genre];
    if (!genreCounts) continue;
    for (const [decade, n] of Object.entries(genreCounts)) {
      decadeTotal[decade] = (decadeTotal[decade] ?? 0) + n;
    }
  }

  // Rule 3 — qualified decades (≥ minSongs)
  const qualified = allDecades.filter(d => (decadeTotal[d] ?? 0) >= minSongs);
  if (qualified.length > 0) return qualified;

  // Rule 4 — fallback: any decade with ≥1 song
  const anyContent = allDecades.filter(d => (decadeTotal[d] ?? 0) >= 1);
  if (anyContent.length > 0) return anyContent;

  // Rule 5 — last resort
  return allDecades;
}
