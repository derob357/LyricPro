// scripts/_lib/lyrics-sources.mjs
// Shared lyric-source chain: LRClib (primary) → Musixmatch (fallback) →
// Genius (HTML-scrape fallback). Per-source semaphores live as module-level
// state so multiple importers share the same rate-limit budget within a run.
//
// Public API:
//   fetchCanonicalLyrics({ title, artist, musixmatchKey, geniusToken })
//     → { source: "lrclib"|"musixmatch"|"genius"|"none",
//         lyrics: string,                // empty string when source==="none"
//         partial?: boolean,             // true for musixmatch (free-tier snippet)
//         reasons?: { lrclib, musixmatch, genius } } // only when source==="none"
//
// All requests go through their per-source semaphore so callers don't have
// to do anything extra. Concurrency limits are tuned for the Phase-1 audit:
// LRClib 5 in flight, Musixmatch/Genius 1 in flight + 1s gap.

const LRCLIB_CONCURRENCY = 5;
const MUSIXMATCH_CONCURRENCY = 1;
const GENIUS_CONCURRENCY = 1;
const MUSIXMATCH_GAP_MS = 1000;
const GENIUS_GAP_MS = 1000;

const USER_AGENT = "LyricPro Ai/lyric-tools 1.0 (deric@intentionai.ai)";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Per-source semaphore: only N tasks in flight at once. Optional minGapMs
// enforces a wait between *starts* (rate-limit-style).
function makeSemaphore(maxConcurrent, minGapMs = 0) {
  let active = 0;
  let lastStart = 0;
  const queue = [];
  function tryRun() {
    while (active < maxConcurrent && queue.length > 0) {
      const { fn, resolve, reject } = queue.shift();
      active += 1;
      const now = Date.now();
      const wait = Math.max(0, minGapMs - (now - lastStart));
      lastStart = now + wait;
      const start = wait === 0 ? Promise.resolve() : sleep(wait);
      start
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          tryRun();
        });
    }
  }
  return function acquire(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      tryRun();
    });
  };
}

// Module-level semaphores. Singletons within the process.
const lrclibSem = makeSemaphore(LRCLIB_CONCURRENCY);
const musixmatchSem = makeSemaphore(MUSIXMATCH_CONCURRENCY, MUSIXMATCH_GAP_MS);
const geniusSem = makeSemaphore(GENIUS_CONCURRENCY, GENIUS_GAP_MS);

// ─── Levenshtein (used only for fuzzy artist match in Genius) ────────────────
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function fuzzyArtistMatch(a, b) {
  const norm = (s) =>
    String(s ?? "")
      .toLowerCase()
      .trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const d = levenshtein(x, y);
  const maxLen = Math.max(x.length, y.length);
  return d / maxLen <= 0.2; // ≤20% Levenshtein, lowercased
}

// ─── HTML → text helper for Genius scrape ────────────────────────────────────
function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'");
  return s;
}

// ─── Per-source fetchers ─────────────────────────────────────────────────────

// LRClib — primary, free, no auth.
async function fetchLrclib(title, artist) {
  const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(
    artist
  )}&track_name=${encodeURIComponent(title)}`;
  return lrclibSem(async () => {
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
    } catch (err) {
      return { ok: false, reason: `network: ${String(err)}` };
    }
    if (res.status === 404) return { ok: false, reason: "404 not found" };
    if (!res.ok) return { ok: false, reason: `http ${res.status}` };
    let body;
    try {
      body = await res.json();
    } catch (err) {
      return { ok: false, reason: `parse: ${String(err)}` };
    }
    const lyrics = body?.plainLyrics;
    if (!lyrics || typeof lyrics !== "string" || lyrics.trim().length === 0) {
      return { ok: false, reason: "empty plainLyrics" };
    }
    return { ok: true, lyrics };
  });
}

// Musixmatch — fallback. Free tier returns ~30% with a copyright footer that
// must be stripped (the line of asterisks Musixmatch appends).
async function fetchMusixmatch(title, artist, apiKey) {
  if (!apiKey) return { ok: false, reason: "no api key" };
  const url = `https://api.musixmatch.com/ws/1.1/matcher.lyrics.get?q_track=${encodeURIComponent(
    title
  )}&q_artist=${encodeURIComponent(artist)}&apikey=${encodeURIComponent(
    apiKey
  )}`;
  return musixmatchSem(async () => {
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
    } catch (err) {
      return { ok: false, reason: `network: ${String(err)}` };
    }
    if (!res.ok) return { ok: false, reason: `http ${res.status}` };
    let body;
    try {
      body = await res.json();
    } catch (err) {
      return { ok: false, reason: `parse: ${String(err)}` };
    }
    const status = body?.message?.header?.status_code;
    if (status !== 200) return { ok: false, reason: `mm status ${status}` };
    const raw = body?.message?.body?.lyrics?.lyrics_body;
    if (!raw || typeof raw !== "string" || raw.trim().length === 0) {
      return { ok: false, reason: "empty lyrics_body" };
    }
    // Strip the "*******" footer Musixmatch appends to free-tier snippets.
    const idx = raw.search(/^\*{5,}/m);
    const lyrics = idx >= 0 ? raw.slice(0, idx).trim() : raw.trim();
    if (lyrics.length === 0) return { ok: false, reason: "all-footer" };
    return { ok: true, lyrics, partial: true };
  });
}

// Genius — fallback. Search API to find the path, then HTML scrape for
// `<div data-lyrics-container="true">…</div>` blocks. If no token is set
// we silently skip (per spec).
async function fetchGenius(title, artist, accessToken) {
  if (!accessToken) return { ok: false, reason: "no api token" };
  const q = `${title} ${artist}`;
  return geniusSem(async () => {
    let searchRes;
    try {
      searchRes = await fetch(
        `https://api.genius.com/search?q=${encodeURIComponent(q)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": USER_AGENT,
            Accept: "application/json",
          },
        }
      );
    } catch (err) {
      return { ok: false, reason: `network search: ${String(err)}` };
    }
    if (!searchRes.ok) {
      return { ok: false, reason: `search http ${searchRes.status}` };
    }
    let searchBody;
    try {
      searchBody = await searchRes.json();
    } catch (err) {
      return { ok: false, reason: `parse search: ${String(err)}` };
    }
    const hits = searchBody?.response?.hits ?? [];
    if (hits.length === 0) return { ok: false, reason: "no hits" };

    const match = hits.find((h) =>
      fuzzyArtistMatch(h?.result?.primary_artist?.name, artist)
    );
    if (!match) return { ok: false, reason: "no artist-matched hit" };
    const songPath = match?.result?.path;
    if (!songPath) return { ok: false, reason: "hit missing path" };

    let pageRes;
    try {
      pageRes = await fetch(`https://genius.com${songPath}`, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch (err) {
      return { ok: false, reason: `network page: ${String(err)}` };
    }
    if (!pageRes.ok) return { ok: false, reason: `page http ${pageRes.status}` };
    let html;
    try {
      html = await pageRes.text();
    } catch (err) {
      return { ok: false, reason: `read page: ${String(err)}` };
    }

    const blockRe =
      /<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/gi;
    const blocks = [];
    let m;
    while ((m = blockRe.exec(html)) !== null) {
      blocks.push(htmlToText(m[1]));
    }
    if (blocks.length === 0) {
      return { ok: false, reason: "no lyric blocks in HTML" };
    }
    const lyrics = blocks.join("\n").trim();
    if (lyrics.length === 0) return { ok: false, reason: "empty after strip" };
    return { ok: true, lyrics };
  });
}

// ─── Public entry point ──────────────────────────────────────────────────────
// Try sources in order; return a normalized result. `lyrics` is "" (empty
// string) when no source had the song — callers can do `if (!lyrics)`.
export async function fetchCanonicalLyrics({
  title,
  artist,
  musixmatchKey = "",
  geniusToken = "",
}) {
  const lr = await fetchLrclib(title, artist);
  if (lr.ok) return { source: "lrclib", lyrics: lr.lyrics, partial: false };

  const mm = await fetchMusixmatch(title, artist, musixmatchKey);
  if (mm.ok)
    return { source: "musixmatch", lyrics: mm.lyrics, partial: !!mm.partial };

  const gn = await fetchGenius(title, artist, geniusToken);
  if (gn.ok) return { source: "genius", lyrics: gn.lyrics, partial: false };

  return {
    source: "none",
    lyrics: "",
    partial: false,
    reasons: { lrclib: lr.reason, musixmatch: mm.reason, genius: gn.reason },
  };
}
