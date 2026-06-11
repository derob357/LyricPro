// scripts/add-rs100-hiphop-songs.mjs
// One-shot: insert the Rolling Stone "100 Greatest Hip-Hop Songs" entries
// missing from the catalog (diffed 2026-06-11; 56 missing, 1 skipped —
// "Wheels of Steel" is a turntablism collage with no quotable lyric).
// Lyric lines authored per game rules (iconic hook/chorus, ~1/2:1/2 split,
// >=6 combined words, catalog censoring style) and web-verified by two
// research agents; post-insert verification runs via
//   node scripts/verify-lyrics.mjs --ids <inserted ids>   (LRClib -> Musixmatch -> Genius)
//
// Dry-run default. --apply inserts. Idempotent: skips songs whose normalized
// title+primary artist already exist. Inserted ids are written to
// scripts/rs100-inserted-ids.json (rollback: DELETE FROM songs WHERE id = ANY(ids)).
import { config } from "dotenv";
config();
import postgres from "postgres";
import { writeFileSync } from "fs";

const APPLY = process.argv.includes("--apply");
const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.SUPABASE_DIRECT_CONNECTION_STRING ?? process.env.DATABASE_URL;
const sql = postgres(DB_URL, { max: 1 });

const decadeOf = (y) => y >= 2020 ? "2020–Present" : `${Math.floor(y / 10) * 10}–${Math.floor(y / 10) * 10 + 10}`;

// rank, artist, title, year, section, explicit, prompt, answer, d1, d2, d3
const ENTRIES = [
  [5, "Geto Boys", "Mind Playing Tricks on Me", 1991, "verse", true, "At night I can't sleep,", "I toss and turn", "candle light burnin' through the night", "I lay awake and wonder why", "demons keep callin' my name"],
  [6, "Dr. Dre ft. Snoop Doggy Dogg", "Nuthin' but a 'G' Thang", 1992, "hook", true, "Ain't nothin' but a G thang, baby!", "Two loc'd-out n—as going crazy", "two hard brothers rollin' on the street", "ain't nothing but a hustle, homie", "straight-up G's don't stop and won't quit"],
  [15, "N.W.A", "F— tha Police", 1988, "verse", true, "F— tha police, comin' straight", "from the underground", "a young brother got it hard on the other side", "police keep steppin' on the youth around here", "straight from the hood where they don't care"],
  [21, "LL Cool J", "Rock the Bells", 1985, "hook", false, "Rock the bells, rock the bells,", "rock the bells", "feel the bass keep poundin' all night long", "bounce to the beat and don't you stop", "let the rhythm move the whole block"],
  [22, "EPMD", "Strictly Business", 1988, "verse", false, "You gots to chill,", "because I'm Strictly Business", "no half-steppin' on this mic tonight", "smooth on the track and the crowd is right", "keeping it locked from dusk to light"],
  [23, "Eric B. & Rakim", "I Know You Got Soul", 1987, "hook", false, "It ain't where you're from,", "it's where you're at", "the way you rock a crowd and hold it down", "soul is what you bring to every town", "moving the people with the purest sound"],
  [24, "Rob Base & DJ E-Z Rock", "It Takes Two", 1988, "hook", false, "It takes two to make a thing go right,", "it takes two to make it out of sight", "you gotta move together on the floor", "two voices on the mic and the crowd wants more", "one for the bass and one for the score"],
  [25, "Big Daddy Kane", "Ain't No Half-Steppin'", 1988, "hook", false, "Ain't no half-steppin',", "ain't no half-steppin'", "I come correct on every single track", "roll up weak and I'll send you back", "no room for fakers, that's a fact"],
  [27, "Craig Mack", "Flava in Ya Ear", 1994, "hook", false, "Here comes the brand new flava in ya ear,", "I'm kickin' new flava in ya ear", "time for a fresh sound to rock the place", "new energy comin' right at ya face", "brand new style gonna take your space"],
  [31, "Nas", "N.Y. State of Mind", 1994, "verse", true, "I never sleep,", "'cause sleep is the cousin of death", "eyes wide open on these dangerous streets", "rest is for the real out here on the block", "I watch my back and I stay on the clock"],
  [34, "Schoolly D", "P.S.K. What Does It Mean?", 1985, "hook", true, "P.S.K.,", "we're makin' that green", "rollin' through the block where the real ones lean", "we hold it down from the park to the strip", "stack our paper and we don't slip"],
  [36, "OutKast", "Rosa Parks", 1998, "chorus", false, "Ah ha, hush that fuss,", "everybody move to the back of the bus", "step aside and let the players through", "no need to argue we just runnin' it through", "ATL in the house coming straight at you"],
  [42, "Boogie Down Productions", "South Bronx", 1986, "hook", false, "South Bronx,", "the South-South Bronx", "where the hip hop was born and the beats stay raw", "KRS-One hold it down from the floor", "rep the borough like never before"],
  [43, "Audio Two", "Top Billin'", 1987, "hook", false, "Top billin',", "that's what we get", "Milk Dee and Gizmo on the set", "Brooklyn in the building holding it down", "we stay on top in every town"],
  [47, "Funky 4 + 1", "That's the Joint", 1980, "hook", false, "That's the joint,", "that's the joint right there", "when the beat drops everybody moves", "feel the funk and get into the groove", "five on the mic and we can't lose"],
  [48, "Marley Marl", "The Symphony", 1988, "verse", false, "Listen closely,", "so your attention's undivided", "many in the past have tried to do what I did", "step to the mic and hold it down with grace", "come at me wrong and I'll take your place"],
  [50, "OutKast", "B.O.B. (Bombs Over Baghdad)", 2000, "chorus", false, "Don't pull the thang out,", "unless you plan to bang", "don't say you're ready if you don't know the game", "power music gonna shake the whole crowd", "electric revival ringing out loud"],
  [55, "Grandmaster Melle Mel", "White Lines (Don't Don't Do It)", 1983, "hook", false, "White lines,", "blow away", "chasing the high till you lose your mind", "one more hit and you lose control", "trading all your days for that little white hole"],
  [56, "Clipse", "Grindin'", 2002, "hook", true, "When you know what I keep in a lining,", "n—as better stay in line", "when you see a n— like me shinin'", "I got the work and I move it right", "grindin' every day from morning to night"],
  [57, "The Pharcyde", "Passin' Me By", 1992, "chorus", false, "She keeps on passin' me by,", "she keeps on passin' me by", "every time I see her she won't give me the time", "she walks right past without a sign", "can't get a glance from that girl of mine"],
  [59, "Doug E. Fresh & the Get Fresh Crew", "The Show", 1985, "hook", false, "Here we go, here we go,", "come on, let's go", "Doug E. Fresh is on the mic with the flow", "crowd is moving and the vibe is right", "best rap crew you'll see tonight"],
  [60, "Beastie Boys", "Hold It Now, Hit It", 1986, "hook", false, "Hold it now,", "hit it!", "M.C.A., Mike D., Ad-Rock bringing heat", "Licensed to Ill and we don't miss a beat", "Beastie Boys rocking every street"],
  [61, "Dr. Dre ft. Snoop Doggy Dogg", "Deep Cover", 1992, "hook", true, "And you don't stop, 'cause it's 187", "on an undercover cop", "rolling through the streets after dark", "Dre and Snoop leaving their mark", "creeping through the city in the park"],
  [62, "Cypress Hill", "How I Could Just Kill a Man", 1991, "chorus", true, "Here is something you can't understand,", "how I could just kill a man", "streets are cold and the block don't sleep", "running from the law with nothing to keep", "feel the weight of the hood at your feet"],
  [63, "Black Sheep", "The Choice Is Yours", 1991, "hook", false, "Engine, engine, number nine,", "on the New York transit line", "if my train falls off the track, pick it up", "throw your hands in the air and never give it up", "rock to the beat and stomp your feet to the cut"],
  [64, "Sir Mix-A-Lot", "Baby Got Back", 1992, "verse", false, "I like big butts and I cannot lie,", "you other brothers can't deny", "when she steps in with a little bitty waist", "something smooth in your face makes you chase", "I'm sprung on the curves I can't erase"],
  [66, "Ice-T", "6 'n the Mornin'", 1986, "verse", true, "Six in the morning, police at my door", "Fresh Adidas squeak across the bathroom floor", "Bass pumpin' loud through the speakers on the block", "Cadillac sittin' clean right outside the store", "City lights glow in the dark before the dawn"],
  [67, "T.I.", "What You Know", 2006, "hook", true, "I got hustle boy, ambition, courage and heart", "What you know about that?", "I got the grind and the flow inside my blood", "Tell me something homie, what you know about this", "Running through your city let me show you what I got"],
  [68, "Dead Prez", "Hip-Hop", 2000, "hook", true, "It's bigger than hip-hop, hip-hop", "Hip-hop, hip", "It's deeper than rap, rap, rap, rap", "It's more than the music, music, music", "It's louder than the beat, beat, beat, beat"],
  [70, "Ol' Dirty Bastard", "Brooklyn Zoo", 1995, "hook", true, "Shame on you when you step through", "To the Ol' Dirty Bastard, Brooklyn Zoo", "To the whole Wu-Tang Clan coming through", "Don't try to front when you know what we do", "You best respect when I come through"],
  [71, "Jay-Z & Kanye West", "N—s in Paris", 2011, "hook", true, "Ball so hard, m—f—s wanna fine me", "That sh— cray, that sh— cray, that sh— cray", "Spent too much, now they really wanna find me", "We just stuntin', ain't nobody gonna stop me", "Living lavish while the industry surrounds me"],
  [72, "Wu-Tang Clan", "Protect Ya Neck", 1993, "hook", true, "Wu-Tang Clan ain't nuthing", "ta f— wit", "bringing nothing but the ruckus tonight", "coming from the slums of Shaolin, right", "swarming on your block and we run the night"],
  [74, "Gang Starr", "Mass Appeal", 1994, "chorus", false, "It's all about mass appeal", "Check it out now", "It's all about how you feel", "It's all about the real deal", "It's all about the skills on the mic"],
  [75, "M.O.P.", "Ante Up", 2000, "hook", true, "Ante Up! Yap that fool!", "Ante Up! Kidnap that fool!", "Ante Up! Rob that fool! Cash in the spot!", "Ante Up! Run that fool! Don't let him drop!", "Ante Up! Mask up! Hit 'em hard and never stop!"],
  [77, "A Tribe Called Quest", "Can I Kick It?", 1990, "call-response", false, "Can I kick it?", "Yes, you can!", "Will you flow it?", "Can you feel it?", "Do you want it?"],
  [78, "Ultramagnetic MC's", "Ego Trippin'", 1986, "verse", false, "You could find the Ultramagnetic", "MCs", "most incredible lyrical crews", "cold rockin' parties on the ones and twos", "super fresh and funky for the avenues"],
  [79, "Rammellzee & K-Rob", "Beat Bop", 1983, "verse", false, "Beat bop, you don't stop", "Rock on till the break of dawn", "Keep it moving, never drop the beat", "Cold rockin' bodies in the summer heat", "Flowing on the one while the others retreat"],
  [81, "Nas", "It Ain't Hard to Tell", 1994, "hook", false, "It ain't hard to tell,", "I excel, then prevail", "I shine and I dwell", "I reign and I rebel", "I flex and I yell"],
  [82, "Raekwon ft. Ghostface Killah, Method Man & Cappadonna", "Ice Cream", 1995, "hook", true, "French vanilla, butter pecan, chocolate deluxe", "Even caramel sundaes is gettin' touched", "From the projects to the club without a fuss", "From the corner to the block, you know the deal with us", "Cold as ice but smooth enough for all of us"],
  [83, "Too $hort", "Freaky Tales", 1987, "hook", true, "These are the tales,", "the freaky tales", "the stories that I tell so well", "the game I kick to keep 'em under my spell", "the street life stories that I live to tell"],
  [84, "U.T.F.O.", "Roxanne, Roxanne", 1984, "verse", false, "Roxanne, Roxanne,", "I wanna be your man", "Roxanne, girl, take my hand", "Roxanne, don't you understand", "Roxanne, I'm your biggest fan"],
  [85, "Roxanne Shanté", "Roxanne's Revenge", 1984, "verse", true, "Well, my name is Roxanne,", "a-don't ya know", "and I run this show", "I'm the one you should know", "I let the whole world know"],
  [86, "Jermaine Dupri ft. Jay-Z", "Money Ain't a Thang", 1998, "hook", true, "In the Ferrari or Jaguar, switchin' four lanes", "With the top down screamin' out, money ain't a thang", "Rollin' through the city while the people say my name", "Living like a player in this money and fame game", "Stuntin' on the haters 'cause it's all the same"],
  [87, "Digital Underground", "The Humpty Dance", 1990, "hook", true, "Alright, stop whatcha doin', 'cause I'm about to ruin", "the image and the style that ya used to", "the sound that you love and the moves that you groove to", "the music in your head that you listen to", "the beat and the rhythm that you been true to"],
  [88, "MC Shan", "The Bridge", 1986, "hook", false, "You love to hear the story, again and again,", "of how it all got started way back when", "of how the crew came up to win", "of when the block was hot back then", "of how the legend rose from the pen"],
  [89, "UGK ft. OutKast", "Int'l Players Anthem (I Choose You)", 2007, "hook", true, "I choose you,", "babe", "tonight", "for life", "my dear"],
  [90, "Biz Markie", "Just a Friend", 1989, "chorus", false, "You, you got what I need,", "but you say he's just a friend", "and you say he's out of town again", "but I know what you tell your friends", "but you say it's only make-believe"],
  [91, "Rick Ross ft. Styles P", "B.M.F. (Blowin' Money Fast)", 2010, "hook", true, "I think I'm Big Meech, Larry Hoover", "Whippin' work, hallelujah", "One nation under God, gettin' money from the start", "Bosses never fold up, this is art", "Stackin' paper to the sky while I play my part"],
  [92, "B.G. ft. Big Tymers & Hot Boys", "Bling Bling", 1999, "hook", true, "Bling bling, every time I come around your city,", "bling bling", "pinky ring worth about fifty", "ice on my neck lookin' pretty", "shinin' hard with the whole committee"],
  [93, "Souls of Mischief", "93 'til Infinity", 1993, "hook", false, "This is how we chill,", "from '93 'til", "we keep it real in Oakland, spitting ill", "from sundown to sun up, time to kill", "from the Bay to the world, steadily we build"],
  [94, "Missy Elliott", "The Rain (Supa Dupa Fly)", 1997, "hook", false, "I can't stand the rain", "against my window", "bringing back sweet memories", "fallin' on my pillow", "tappin' on my mind, oh"],
  [96, "Brand Nubian", "Slow Down", 1990, "verse", false, "Slow down, I'll tell ya", "why I feel this way", "you move too fast to hear what I say", "you walk right past and you don't even stay", "girl, let me show you a better way"],
  [98, "M.I.A.", "Paper Planes", 2007, "chorus", false, "All I wanna do is", "take your money", "run the streets for fun, honey", "fly away somewhere sunny", "live my life out lovely"],
  [99, "Lil Jon & the East Side Boyz ft. Ying Yang Twins", "Get Low", 2002, "hook", true, "To the window, to the wall,", "till the sweat drip down my b—s", "from the front to the back, let the speakers boom", "from the left to the right, see the crowd get loose", "from the floor to the roof while we light up the room"],
  [100, "L'Trimm", "Cars With the Boom", 1988, "hook", false, "We like the cars,", "the cars that go boom", "we're Tigra and Bunny and we like the boom", "we like the bass that makes the speakers zoom", "we like to hear it loud in every room"],
];

const norm = (s) => s.toLowerCase().normalize("NFC").replace(/[’‘]/g, "'").replace(/\(.*?\)/g, "").replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
const primary = (a) => norm(a).split(/ ft | feat | featuring | and the | & | and /)[0].trim();

const existing = await sql`SELECT id, title, "artistName" FROM songs`;
const exIdx = existing.map((s) => ({ id: s.id, nt: norm(s.title), pa: primary(s.artistName) }));

const toInsert = [];
for (const [rank, artist, title, year, section, explicit, prompt, answer, d1, d2, d3] of ENTRIES) {
  const dupe = exIdx.find((e) => e.nt === norm(title) && (e.pa === primary(artist) || e.pa.includes(primary(artist)) || primary(artist).includes(e.pa)));
  if (dupe) { console.log(`SKIP duplicate: ${artist} — ${title} (existing id ${dupe.id})`); continue; }
  toInsert.push({
    title, artistName: artist, genre: "Hip Hop", releaseYear: year, decadeRange: decadeOf(year),
    lyricPrompt: prompt, lyricAnswer: answer, lyricSectionType: section, difficulty: "medium",
    language: "en", explicitFlag: explicit, approvalStatus: "approved", isActive: true,
    distractors: sql.json([d1, d2, d3]),  // sql.json — NEVER stringify+::jsonb (double-encodes; see memory: jsonb trap)
    lyricVariants: sql.json([{ prompt, answer, distractors: [d1, d2, d3], sectionType: section }]),
    songwriters: sql.json([]), publishers: sql.json([]),
    curator_notes: `Added 2026-06-11 from Rolling Stone 100 Greatest Hip-Hop Songs (#${rank}); pending lyric verification`,
  });
}
console.log(`Prepared ${toInsert.length} insert(s); ${ENTRIES.length - toInsert.length} duplicate-skipped.`);
if (!APPLY) { console.log("Dry-run. Re-run with --apply to insert."); await sql.end(); process.exit(0); }

const ids = [];
for (const r of toInsert) {
  const [row] = await sql`
    INSERT INTO songs (title, "artistName", genre, "releaseYear", "decadeRange", "lyricPrompt", "lyricAnswer",
      "lyricSectionType", difficulty, language, "explicitFlag", "approvalStatus", "isActive",
      distractors, "lyricVariants", songwriters, publishers, curator_notes)
    VALUES (${r.title}, ${r.artistName}, ${r.genre}, ${r.releaseYear}, ${r.decadeRange}, ${r.lyricPrompt}, ${r.lyricAnswer},
      ${r.lyricSectionType}, ${r.difficulty}, ${r.language}, ${r.explicitFlag}, ${r.approvalStatus}, true,
      ${r.distractors}, ${r.lyricVariants}, ${r.songwriters}, ${r.publishers}, ${r.curator_notes})
    RETURNING id, title`;
  ids.push(row.id);
  console.log(`  inserted [${row.id}] ${r.artistName} — ${row.title}`);
}
writeFileSync("scripts/rs100-inserted-ids.json", JSON.stringify({ insertedAt: new Date().toISOString(), ids }, null, 2));
console.log(`\nInserted ${ids.length}. Ids saved to scripts/rs100-inserted-ids.json`);
console.log(`Rollback: DELETE FROM songs WHERE id = ANY('{${ids.join(",")}}');`);
await sql.end();
