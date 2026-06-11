// scripts/fix-rs100-flagged.mjs
// Data-fix for the 17 RS-100 hip-hop songs flagged by verify-lyrics.mjs after
// the 2026-06-11 backfill insert. Each entry has been classified as:
//   CENSOR_ONLY  — stored wording matches canonical except for em-dash censoring → keep unchanged
//   WORDING      — actual word difference from canonical → UPDATE lyricPrompt/lyricAnswer
//                  + lyricVariants[0].prompt/answer
//   NO_CANONICAL — lyric chain returned nothing or song genuinely lacks the line → deactivate
//
// Safe to re-run: each UPDATE is idempotent (sets exact values).
// Only touches the 17 ids listed in FIXES. No other rows are affected.
//
// Usage:
//   node scripts/fix-rs100-flagged.mjs             # dry-run (default)
//   node scripts/fix-rs100-flagged.mjs --apply     # write to DB
//
// After applying, re-verify with:
//   node scripts/verify-lyrics.mjs --ids 20047,20048,20053,20055,20059,20062,20063,20065,20072,20075,20076,20077,20080,20081,20096,20097,20098

import { config } from "dotenv";
config();
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set SUPABASE_SESSION_POOLER_STRING in .env");
  process.exit(1);
}
const sql = postgres(DB_URL, { max: 1 });

// ─── Classification notes ────────────────────────────────────────────────────
//
// 20047 Nuthin' but a 'G' Thang (Dr. Dre ft. Snoop Doggy Dogg)
//   Canonical (LRClib): "Ain't nuttin' but a G thang, baby, two loc'ed out niggaz so we're crazy"
//   Stored: "Ain't nothin' but a G thang, baby!" / "Two loc'd-out n—as going crazy"
//   Errors: "nothin'" vs "nuttin'"; "loc'd-out" vs "loc'ed out"; "going" vs "so we're"
//   Fix: split at canonical comma; censor "niggaz" → "n—as"
//   Classification: WORDING
//
// 20048 Rock the Bells (LL Cool J)
//   Canonical (LRClib): hook is just "Rock the bells" (single line — too short for game).
//   Stored prompt "Rock the bells, rock the bells," is a fabricated doubling not in canonical.
//   Best quotable: canonical opening verse couplet (exact match confirmed).
//   Classification: WORDING
//
// 20053 Flava in Ya Ear (Craig Mack)
//   Canonical chorus (LRClib):
//     "Here comes the brand new flava in ya ear"  [line 1]
//     "Time for new flava in ya ear"               [line 2]
//     "I'm kickin' new flava in ya ear"            [line 3]
//     "Mack's the brand new flava in ya ear"       [line 4]
//   Stored: prompt=line1, answer=line3 (non-adjacent). Fix: prompt=line1, answer=line2 (adjacent).
//   Classification: WORDING
//
// 20055 P.S.K. What Does It Mean? (Schoolly D)
//   Canonical (LRClib): "PSK / We're making that green"
//   Stored: "P.S.K.," / "we're makin' that green"
//   Errors: dots in acronym; "makin'" vs "making"
//   Classification: WORDING
//
// 20059 That's the Joint (Funky 4 + 1)
//   Canonical (LRClib): "We're here for the party people on Sugar Hill" / "So what's the deal? (Sugar Hill!)"
//   Stored: "That's the joint," / "that's the joint right there" — fabricated, not in canonical.
//   Fix: use canonical adjacent couplet (exact match confirmed).
//   Classification: WORDING
//
// 20062 White Lines (Don't Don't Do It) (Grandmaster Melle Mel)
//   Canonical (LRClib — now resolves, initial run used Musixmatch partial):
//     "(Telling your body to come along, but white lines blow away)"
//   Stored: "White lines," / "blow away" — both tokens present in canonical; verifier PASSES
//   against full LRClib text (editRate=0 confirmed in test). Initial failure was due to
//   Musixmatch partial returning a shorter snippet.
//   Classification: CENSOR_ONLY (no censoring, but a source-artifact false positive — keep unchanged)
//
// 20063 Grindin' (Clipse)
//   Canonical (LRClib): "You know what I keep in a lining (whoa) / Niggas better stay in line when (whoa)"
//   Stored prompt had spurious "When" prefix not in canonical; answer "n—as better stay in line"
//   censors "Niggas". The "(whoa)" interjections between lines cause verifier to fail
//   regardless of fix, but the underlying wording is correct except for the "When" prefix.
//   Fix: remove "When" from prompt. Still flagged by verifier (accepted CENSOR_ONLY behavior).
//   Classification: WORDING (prompt-only: remove "When " prefix)
//
// 20065 The Show (Doug E. Fresh & the Get Fresh Crew)
//   Canonical (LRClib): "Here we go... / Here we go... / Come on... / Come on..."
//   Stored: "Here we go, here we go," / "come on, let's go" — "let's go" not in canonical.
//   Classification: WORDING
//
// 20072 What You Know (T.I.)
//   Canonical (LRClib): "Ay, don't you know I got key by the three? / When I chirp, shawty, chirp back"
//   Stored: "I got hustle boy, ambition, courage and heart" / "What you know about that?" — not in canonical.
//   Classification: WORDING
//
// 20075 N—s in Paris (Jay-Z & Kanye West)
//   Canonical (LRClib): "Ball so hard, motherfuckers wanna fine me" / "That shit cray, that shit cray, that shit cray"
//   Stored: "Ball so hard, m—f—s wanna fine me" / "That sh— cray, that sh— cray, that sh— cray"
//   Censoring only: m—f—s, sh—. Wording is correct.
//   Will still fail verifier — accepted.
//   Classification: CENSOR_ONLY
//
// 20076 Protect Ya Neck (Wu-Tang Clan)
//   Canonical (LRClib): "Wu-Tang Clan comin' at ya / Watch your step kid"
//   Stored: "Wu-Tang Clan ain't nuthing" / "ta f— wit" — lyrics from a DIFFERENT Wu-Tang song.
//   Classification: WORDING
//
// 20077 Mass Appeal (Gang Starr)
//   Canonical (LRClib): chorus = "Money's growing like grass with the mass appeal" (×4)
//   Stored: "It's all about mass appeal" / "Check it out now" — not in canonical.
//   Fix: split canonical chorus line at natural pause.
//   Classification: WORDING
//
// 20080 Ego Trippin' (Ultramagnetic MC's)
//   Canonical (LRClib): "Just for you, it's the Ultra-magnetic, MC's!" (intro line)
//   Stored: "You could find the Ultramagnetic" / "MCs" — not in canonical.
//   Fix uses canonical intro; fuzzy match passes (editRate=0.0513).
//   Classification: WORDING
//
// 20081 Beat Bop (Rammellzee & K-Rob)
//   Canonical (Genius — only source): Rammellzee verse contains adjacent couplet:
//     "You gotta rock rock you don't stop the baby y'all"
//     "You gotta now rock and you don't stop"
//   Stored: "Beat bop, you don't stop" / "Rock on till the break of dawn" — not in canonical.
//   Fix: use confirmed adjacent canonical couplet.
//   Classification: WORDING
//
// 20096 Slow Down (Brand Nubian)
//   Canonical (LRClib): song is a crack narrative; opening couplet:
//     "Hey baby your hips is getting big"
//     "Now you're getting thin you don't care about your wig"
//   Stored: "Slow down, I'll tell ya" / "why I feel this way" — not in canonical.
//   Classification: WORDING
//
// 20097 Paper Planes (M.I.A.)
//   Canonical (LRClib): "All I wanna do is- / And a- / And take your money"
//   "And a-" are gunshot sound notations present in the LRClib text (normalized: "and a").
//   Stored: "All I wanna do is" / "take your money" — missing "and a" between lines.
//   Best iconic split that both passes verifier and works for display: verse opening couplet
//   "I fly like paper," / "get high like planes" (exact match, confirmed PASS).
//   Classification: WORDING
//
// 20098 Get Low (Lil Jon & the East Side Boyz ft. Ying Yang Twins)
//   Canonical (LRClib): "To the window (to the window) / To the wall (to the wall) / Till the sweat drop down my balls (my balls)"
//   Parenthetical echoes make the stored split "To the window, to the wall," misalign.
//   Stored had "drip" not "drop" (genuine error). Fix: include canonical echo in prompt:
//   "To the window, to the wall, to the wall," / "till the sweat drop down my b—s"
//   "b—s" censors "balls" (INTENTIONAL). "drop" corrected from "drip".
//   Classification: WORDING

// ─── Fix entries ─────────────────────────────────────────────────────────────
// Each entry: { id, classification, prompt?, answer?, note }
// CENSOR_ONLY entries have no prompt/answer (no DB change needed).
// WORDING entries: provide new prompt + answer.
// NO_CANONICAL entries: isActive = false + curator_notes append.

const FIXES = [
  {
    id: 20047,
    classification: "WORDING",
    title: "Nuthin' but a 'G' Thang",
    prompt: "Ain't nuttin' but a G thang, baby,",
    answer: "two loc'ed out n—as so we're crazy",
    note: "canonical: 'Ain't nuttin' but a G thang, baby, two loc'ed out niggaz so we're crazy'; 'nothin'→'nuttin'', 'loc'd-out'→'loc'ed out', 'going'→'so we're'; censor n-word",
  },
  {
    id: 20048,
    classification: "WORDING",
    title: "Rock the Bells",
    prompt: "L.L. Cool J. is hard as hell,",
    answer: "battle anybody I don't care who you tell",
    note: "canonical opening verse couplet (exact match); original 'Rock the bells, rock the bells,' is a fabricated doubling not in canonical; hook is just 'Rock the bells' (too short)",
  },
  {
    id: 20053,
    classification: "WORDING",
    title: "Flava in Ya Ear",
    prompt: "Here comes the brand new flava in ya ear,",
    answer: "time for new flava in ya ear",
    note: "chorus lines 1+2 are adjacent in canonical; original had prompt=line1 + answer=line3 (non-adjacent); 'Time' → 'time' (lowercase to match natural split)",
  },
  {
    id: 20055,
    classification: "WORDING",
    title: "P.S.K. What Does It Mean?",
    prompt: "PSK,",
    answer: "we're making that green",
    note: "canonical: 'PSK / We're making that green'; remove dots from acronym; 'makin'' → 'making'",
  },
  {
    id: 20059,
    classification: "WORDING",
    title: "That's the Joint",
    prompt: "We're here for the party people on Sugar Hill,",
    answer: "so what's the deal?",
    note: "canonical adjacent couplet (exact match); stored 'That's the joint, that's the joint right there' is fabricated",
  },
  {
    id: 20062,
    classification: "CENSOR_ONLY",
    title: "White Lines (Don't Don't Do It)",
    note: "stored 'White lines, / blow away' PASSES against LRClib canonical (editRate=0); initial flag was from Musixmatch-partial source artifact. No change needed.",
  },
  {
    id: 20063,
    classification: "WORDING",
    title: "Grindin'",
    prompt: "You know what I keep in a lining,",
    answer: "n—as better stay in line",
    note: "canonical: 'You know what I keep in a lining (whoa) / Niggas better stay in line when (whoa)'; stored prompt had spurious 'When' prefix; answer censors 'Niggas' → 'n—as'; still fails verifier due to '(whoa)' interjections (accepted CENSOR_ONLY behavior on answer)",
  },
  {
    id: 20065,
    classification: "WORDING",
    title: "The Show",
    prompt: "Here we go, here we go,",
    answer: "come on, come on",
    note: "canonical: 'Here we go... / Come on...' repeated; stored 'let's go' not in canonical",
  },
  {
    id: 20072,
    classification: "WORDING",
    title: "What You Know",
    prompt: "Ay, don't you know I got key by the three?",
    answer: "when I chirp, shawty, chirp back",
    note: "canonical adjacent couplet (exact match); stored 'I got hustle boy, ambition, courage and heart' is not in canonical at all",
  },
  {
    id: 20075,
    classification: "CENSOR_ONLY",
    title: "N—s in Paris",
    note: "canonical: 'Ball so hard, motherfuckers wanna fine me / That shit cray...'; stored wording correct except em-dash censoring (m—f—s, sh—); KEEP unchanged; will still flag verifier — accepted",
  },
  {
    id: 20076,
    classification: "WORDING",
    title: "Protect Ya Neck",
    prompt: "Wu-Tang Clan comin' at ya,",
    answer: "watch your step kid",
    note: "canonical adjacent couplet (exact match); stored lyric was from DIFFERENT Wu-Tang song 'Wu-Tang Clan Ain't Nuthing ta F— Wit'",
  },
  {
    id: 20077,
    classification: "WORDING",
    title: "Mass Appeal",
    prompt: "Money's growing like grass",
    answer: "with the mass appeal",
    note: "canonical chorus: 'Money's growing like grass with the mass appeal' (×4); stored 'It's all about mass appeal / Check it out now' not in canonical",
  },
  {
    id: 20080,
    classification: "WORDING",
    title: "Ego Trippin'",
    prompt: "Just for you,",
    answer: "it's the Ultramagnetic MCs!",
    note: "canonical intro: 'Just for you, it's the Ultra-magnetic, MC's!'; fuzzy match (editRate=0.0513 ≤ 0.10); stored 'You could find the Ultramagnetic / MCs' not in canonical",
  },
  {
    id: 20081,
    classification: "WORDING",
    title: "Beat Bop",
    prompt: "You gotta rock rock you don't stop the baby y'all,",
    answer: "you gotta now rock and you don't stop",
    note: "canonical (Genius): adjacent couplet in Rammellzee verse (exact match); stored 'Beat bop, you don't stop / Rock on till the break of dawn' not in canonical; 'Rock on till' → 'Rock on to' and context from different non-adjacent section",
  },
  {
    id: 20096,
    classification: "WORDING",
    title: "Slow Down",
    prompt: "Hey baby your hips is getting big,",
    answer: "now you're getting thin you don't care about your wig",
    note: "canonical opening couplet (exact match); stored 'Slow down, I'll tell ya / why I feel this way' not in canonical",
  },
  {
    id: 20097,
    classification: "WORDING",
    title: "Paper Planes",
    prompt: "I fly like paper,",
    answer: "get high like planes",
    note: "canonical (LRClib) opening couplet (exact match); original 'All I wanna do is / take your money' fails because LRClib has 'And a-' (gunshot notation) between lines; verse opening is cleaner, equally iconic, unambiguous",
  },
  {
    id: 20098,
    classification: "WORDING",
    title: "Get Low",
    prompt: "To the window, to the wall, to the wall,",
    answer: "till the sweat drop down my b—s",
    note: "canonical: 'To the window (to the window) / To the wall (to the wall) / Till the sweat drop down my balls'; parenthetical echoes require including second 'to the wall' in prompt; 'drip' → 'drop' (genuine error); 'b—s' censors 'balls' (INTENTIONAL)",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function normalizeForCompare(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[''""]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function distractorCollides(distractor, answer) {
  return normalizeForCompare(distractor) === normalizeForCompare(answer);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log("─".repeat(70));
console.log("fix-rs100-flagged — RS-100 hip-hop lyric fixes");
console.log(`mode: ${APPLY ? "APPLY (writing to DB)" : "DRY-RUN (no writes)"}`);
console.log("─".repeat(70));

const ids = FIXES.map((f) => f.id);
const rows = await sql`
  SELECT id, title, "lyricPrompt", "lyricAnswer", "lyricVariants", distractors
  FROM songs
  WHERE id = ANY(${ids})
  ORDER BY id
`;

const rowMap = Object.fromEntries(rows.map((r) => [r.id, r]));

const updates = [];
const skipped = [];

for (const fix of FIXES) {
  const row = rowMap[fix.id];
  if (!row) {
    console.error(`  ERROR: id ${fix.id} not found in DB — skipping`);
    continue;
  }

  if (fix.classification === "CENSOR_ONLY") {
    skipped.push(fix);
    console.log(
      `  [CENSOR_ONLY] #${fix.id} "${fix.title}" — no change needed`
    );
    continue;
  }

  if (fix.classification === "NO_CANONICAL") {
    updates.push({ type: "deactivate", id: fix.id, title: fix.title });
    console.log(`  [NO_CANONICAL] #${fix.id} "${fix.title}" — will deactivate`);
    continue;
  }

  // WORDING: build updated fields
  const newPrompt = fix.prompt;
  const newAnswer = fix.answer;

  // Clone and update lyricVariants[0]
  const variants = Array.isArray(row.lyricVariants)
    ? JSON.parse(JSON.stringify(row.lyricVariants))
    : [];
  if (variants.length === 0) {
    console.error(`  ERROR: id ${fix.id} has no variants — skipping`);
    continue;
  }

  variants[0].prompt = newPrompt;
  variants[0].answer = newAnswer;

  // Check distractor collisions with new answer
  const currentDistractors = Array.isArray(row.distractors)
    ? row.distractors
    : [];
  const hasCollision = currentDistractors.some((d) =>
    distractorCollides(d, newAnswer)
  );

  if (hasCollision) {
    console.warn(
      `  [WARN] #${fix.id} "${fix.title}" has distractor collision with new answer "${newAnswer}":`,
      currentDistractors.filter((d) => distractorCollides(d, newAnswer))
    );
  }

  updates.push({
    type: "wording",
    id: fix.id,
    title: fix.title,
    oldPrompt: row.lyricPrompt,
    oldAnswer: row.lyricAnswer,
    newPrompt,
    newAnswer,
    variants,
    hasCollision,
    note: fix.note,
  });

  console.log(`  [WORDING] #${fix.id} "${fix.title}"`);
  console.log(`    prompt: "${row.lyricPrompt}" → "${newPrompt}"`);
  console.log(`    answer: "${row.lyricAnswer}" → "${newAnswer}"`);
  if (hasCollision)
    console.warn(`    *** DISTRACTOR COLLISION — manual review needed ***`);
}

if (!APPLY) {
  console.log("\nDry-run complete. Re-run with --apply to write to DB.");
  console.log(
    `  ${updates.filter((u) => u.type === "wording").length} WORDING fix(es)`
  );
  console.log(
    `  ${updates.filter((u) => u.type === "deactivate").length} NO_CANONICAL deactivation(s)`
  );
  console.log(`  ${skipped.length} CENSOR_ONLY (no change)`);
  await sql.end();
  process.exit(0);
}

// ─── Apply ────────────────────────────────────────────────────────────────────
console.log("\nApplying fixes...");
let applied = 0;
let errors = 0;

for (const upd of updates) {
  try {
    if (upd.type === "deactivate") {
      await sql`
        UPDATE songs
        SET "isActive" = false,
            curator_notes = curator_notes || ' | deactivated: unverifiable lyric'
        WHERE id = ${upd.id}
      `;
      console.log(`  deactivated #${upd.id} "${upd.title}"`);
    } else if (upd.type === "wording") {
      // Write lyricVariants using sql.json — NEVER JSON.stringify+::jsonb (double-encodes)
      await sql`
        UPDATE songs
        SET "lyricPrompt"   = ${upd.newPrompt},
            "lyricAnswer"   = ${upd.newAnswer},
            "lyricVariants" = ${sql.json(upd.variants)}
        WHERE id = ${upd.id}
      `;
      console.log(`  fixed #${upd.id} "${upd.title}"`);
    }
    applied += 1;
  } catch (err) {
    console.error(`  ERROR on #${upd.id}: ${err.message}`);
    errors += 1;
  }
}

await sql.end();
console.log(
  `\nDone: ${applied} applied, ${errors} error(s), ${skipped.length} CENSOR_ONLY unchanged.`
);
console.log(
  `\nRe-verify with:\n  node scripts/verify-lyrics.mjs --ids 20047,20048,20053,20055,20059,20062,20063,20065,20072,20075,20076,20077,20080,20081,20096,20097,20098`
);
