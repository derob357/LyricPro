import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const songs = [
  // ── R&B ──────────────────────────────────────────────────────────────────
  { title: "I Will Always Love You", artistName: "Whitney Houston", lyricPrompt: "And I will always love you", lyricAnswer: "I will always love you", releaseYear: 1992, genre: "R&B", decade: "1990–2000", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },
  { title: "No Scrubs", artistName: "TLC", lyricPrompt: "I don't want no scrubs, a scrub is a guy that can't get no love", lyricAnswer: "from me", releaseYear: 1999, genre: "R&B", decade: "1990–2000", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },
  { title: "Crazy in Love", artistName: "Beyoncé ft. Jay-Z", lyricPrompt: "Got me looking so crazy right now, your love's", lyricAnswer: "got me looking so crazy right now", releaseYear: 2003, genre: "R&B", decade: "2000–2010", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },
  { title: "Irreplaceable", artistName: "Beyoncé", lyricPrompt: "To the left, to the left, everything you own in the box", lyricAnswer: "to the left", releaseYear: 2006, genre: "R&B", decade: "2000–2010", difficulty: "low", lyricSectionType: "chorus", explicitFlag: false },
  { title: "Adorn", artistName: "Miguel", lyricPrompt: "These lips can't wait to taste your skin, baby", lyricAnswer: "and these eyes can't wait to see your grin", releaseYear: 2012, genre: "R&B", decade: "2010–2020", difficulty: "high", lyricSectionType: "verse", explicitFlag: false },
  { title: "Drunk in Love", artistName: "Beyoncé ft. Jay-Z", lyricPrompt: "I've been drinking, I've been drinking", lyricAnswer: "I get filthy when that liquor get into me", releaseYear: 2013, genre: "R&B", decade: "2010–2020", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: true },
  { title: "All of Me", artistName: "John Legend", lyricPrompt: "All of me loves all of you, love your curves and all your edges,", lyricAnswer: "all your perfect imperfections", releaseYear: 2013, genre: "R&B", decade: "2010–2020", difficulty: "low", lyricSectionType: "chorus", explicitFlag: false },
  { title: "Slow Motion", artistName: "Trey Songz", lyricPrompt: "Baby take it slow, don't rush", lyricAnswer: "let me put it down right", releaseYear: 2014, genre: "R&B", decade: "2010–2020", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },

  // ── Hip Hop ──────────────────────────────────────────────────────────────
  { title: "Juicy", artistName: "The Notorious B.I.G.", lyricPrompt: "It was all a dream, I used to read Word Up magazine", lyricAnswer: "Salt-N-Pepa and Heavy D up in the limousine", releaseYear: 1994, genre: "Hip Hop", decade: "1990–2000", difficulty: "high", lyricSectionType: "verse", explicitFlag: false },
  { title: "Lose Yourself", artistName: "Eminem", lyricPrompt: "Look, if you had one shot, or one opportunity", lyricAnswer: "to seize everything you ever wanted in one moment", releaseYear: 2002, genre: "Hip Hop", decade: "2000–2010", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },
  { title: "Gold Digger", artistName: "Kanye West ft. Jamie Foxx", lyricPrompt: "Now I ain't saying she a gold digger", lyricAnswer: "but she ain't messing with no broke", releaseYear: 2005, genre: "Hip Hop", decade: "2000–2010", difficulty: "low", lyricSectionType: "chorus", explicitFlag: true },
  { title: "HUMBLE.", artistName: "Kendrick Lamar", lyricPrompt: "Sit down, be humble", lyricAnswer: "sit down", releaseYear: 2017, genre: "Hip Hop", decade: "2010–2020", difficulty: "low", lyricSectionType: "hook", explicitFlag: true },
  { title: "God's Plan", artistName: "Drake", lyricPrompt: "She said, do you love me? I tell her", lyricAnswer: "only partly, I only love my bed and my mama, I'm sorry", releaseYear: 2018, genre: "Hip Hop", decade: "2010–2020", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },
  { title: "Old Town Road", artistName: "Lil Nas X ft. Billy Ray Cyrus", lyricPrompt: "I'm gonna take my horse to the old town road", lyricAnswer: "I'm gonna ride till I can't no more", releaseYear: 2019, genre: "Hip Hop", decade: "2010–2020", difficulty: "low", lyricSectionType: "chorus", explicitFlag: false },
  { title: "WAP", artistName: "Cardi B ft. Megan Thee Stallion", lyricPrompt: "There's some whores in this house", lyricAnswer: "there's some whores in this house", releaseYear: 2020, genre: "Hip Hop", decade: "2020–Present", difficulty: "low", lyricSectionType: "hook", explicitFlag: true },

  // ── Pop ──────────────────────────────────────────────────────────────────
  { title: "Baby One More Time", artistName: "Britney Spears", lyricPrompt: "Oh baby baby, how was I supposed to know", lyricAnswer: "that something wasn't right here", releaseYear: 1998, genre: "Pop", decade: "1990–2000", difficulty: "medium", lyricSectionType: "verse", explicitFlag: false },
  { title: "Toxic", artistName: "Britney Spears", lyricPrompt: "Baby can't you see I'm calling, a guy like you should wear a warning", lyricAnswer: "it's dangerous, I'm falling", releaseYear: 2003, genre: "Pop", decade: "2000–2010", difficulty: "high", lyricSectionType: "verse", explicitFlag: false },
  { title: "Rolling in the Deep", artistName: "Adele", lyricPrompt: "We could have had it all, rolling in the deep", lyricAnswer: "you had my heart inside of your hand", releaseYear: 2010, genre: "Pop", decade: "2010–2020", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },
  { title: "Shape of You", artistName: "Ed Sheeran", lyricPrompt: "I'm in love with the shape of you, we push and pull like a magnet do", lyricAnswer: "although my heart is falling too", releaseYear: 2017, genre: "Pop", decade: "2010–2020", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },
  { title: "Bad Guy", artistName: "Billie Eilish", lyricPrompt: "I'm the bad guy", lyricAnswer: "duh", releaseYear: 2019, genre: "Pop", decade: "2010–2020", difficulty: "low", lyricSectionType: "hook", explicitFlag: false },
  { title: "Blinding Lights", artistName: "The Weeknd", lyricPrompt: "I've been trying to call, I've been on my own for long enough", lyricAnswer: "maybe you can show me how to love, maybe", releaseYear: 2019, genre: "Pop", decade: "2010–2020", difficulty: "high", lyricSectionType: "verse", explicitFlag: false },
  { title: "Levitating", artistName: "Dua Lipa", lyricPrompt: "Baby, you're a shooting star, I wanna be where you are", lyricAnswer: "I'll chase you through the dark", releaseYear: 2020, genre: "Pop", decade: "2020–Present", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },
  { title: "As It Was", artistName: "Harry Styles", lyricPrompt: "In this world, it's just us, you know it's not the same as it was", lyricAnswer: "in this world, it's just us", releaseYear: 2022, genre: "Pop", decade: "2020–Present", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },

  // ── Rock ─────────────────────────────────────────────────────────────────
  { title: "Bohemian Rhapsody", artistName: "Queen", lyricPrompt: "Is this the real life? Is this just fantasy?", lyricAnswer: "caught in a landslide, no escape from reality", releaseYear: 1975, genre: "Rock", decade: "1970–1980", difficulty: "low", lyricSectionType: "chorus", explicitFlag: false },
  { title: "Sweet Child O' Mine", artistName: "Guns N' Roses", lyricPrompt: "She's got a smile that it seems to me", lyricAnswer: "reminds me of childhood memories", releaseYear: 1987, genre: "Rock", decade: "1980–1990", difficulty: "medium", lyricSectionType: "verse", explicitFlag: false },
  { title: "Smells Like Teen Spirit", artistName: "Nirvana", lyricPrompt: "Load up on guns, bring your friends", lyricAnswer: "it's fun to lose and to pretend", releaseYear: 1991, genre: "Rock", decade: "1990–2000", difficulty: "high", lyricSectionType: "verse", explicitFlag: false },
  { title: "Mr. Brightside", artistName: "The Killers", lyricPrompt: "Coming out of my cage and I've been doing just fine", lyricAnswer: "gotta gotta be down because I want it all", releaseYear: 2003, genre: "Rock", decade: "2000–2010", difficulty: "high", lyricSectionType: "verse", explicitFlag: false },
  { title: "Seven Nation Army", artistName: "The White Stripes", lyricPrompt: "I'm gonna fight 'em off, a seven nation army couldn't hold me back", lyricAnswer: "they're gonna rip it off, taking their time right behind my back", releaseYear: 2003, genre: "Rock", decade: "2000–2010", difficulty: "high", lyricSectionType: "verse", explicitFlag: false },

  // ── Country ──────────────────────────────────────────────────────────────
  { title: "Friends in Low Places", artistName: "Garth Brooks", lyricPrompt: "Blame it all on my roots, I showed up in boots", lyricAnswer: "and ruined your black tie affair", releaseYear: 1990, genre: "Country", decade: "1990–2000", difficulty: "medium", lyricSectionType: "verse", explicitFlag: false },
  { title: "Before He Cheats", artistName: "Carrie Underwood", lyricPrompt: "Right now he's probably slow dancing with a bleached-blonde tramp", lyricAnswer: "and she's probably getting frisky", releaseYear: 2005, genre: "Country", decade: "2000–2010", difficulty: "high", lyricSectionType: "verse", explicitFlag: false },
  { title: "Need You Now", artistName: "Lady A", lyricPrompt: "It's a quarter after one, I'm all alone and I need you now", lyricAnswer: "said I wouldn't call but I lost all control and I need you now", releaseYear: 2009, genre: "Country", decade: "2000–2010", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },
  { title: "Body Like a Back Road", artistName: "Sam Hunt", lyricPrompt: "Body like a back road, driving with my eyes closed", lyricAnswer: "I know every curve like the back of my hand", releaseYear: 2017, genre: "Country", decade: "2010–2020", difficulty: "low", lyricSectionType: "chorus", explicitFlag: false },

  // ── Gospel / Soul ─────────────────────────────────────────────────────────
  { title: "Amazing Grace", artistName: "Traditional / Various", lyricPrompt: "Amazing grace, how sweet the sound", lyricAnswer: "that saved a wretch like me", releaseYear: 1779, genre: "Gospel", decade: "1940–1950", difficulty: "low", lyricSectionType: "chorus", explicitFlag: false },
  { title: "Oh Happy Day", artistName: "Edwin Hawkins Singers", lyricPrompt: "Oh happy day, oh happy day", lyricAnswer: "when Jesus washed, when Jesus washed", releaseYear: 1967, genre: "Gospel", decade: "1960–1970", difficulty: "low", lyricSectionType: "chorus", explicitFlag: false },
  { title: "Respect", artistName: "Aretha Franklin", lyricPrompt: "What you want, baby I got it, what you need, do you know I got it?", lyricAnswer: "all I'm asking is for a little respect when you come home", releaseYear: 1967, genre: "Soul", decade: "1960–1970", difficulty: "medium", lyricSectionType: "verse", explicitFlag: false },
  { title: "Superstition", artistName: "Stevie Wonder", lyricPrompt: "Very superstitious, writings on the wall", lyricAnswer: "very superstitious, ladders about to fall", releaseYear: 1972, genre: "Soul", decade: "1970–1980", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },
  { title: "I Say a Little Prayer", artistName: "Aretha Franklin", lyricPrompt: "The moment I wake up, before I put on my makeup", lyricAnswer: "I say a little prayer for you", releaseYear: 1968, genre: "Soul", decade: "1960–1970", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },

  // ── Jazz ─────────────────────────────────────────────────────────────────
  { title: "What a Wonderful World", artistName: "Louis Armstrong", lyricPrompt: "I see trees of green, red roses too", lyricAnswer: "I see them bloom for me and you", releaseYear: 1967, genre: "Jazz", decade: "1960–1970", difficulty: "low", lyricSectionType: "verse", explicitFlag: false },
  { title: "Fly Me to the Moon", artistName: "Frank Sinatra", lyricPrompt: "Fly me to the moon, let me play among the stars", lyricAnswer: "let me see what spring is like on Jupiter and Mars", releaseYear: 1964, genre: "Jazz", decade: "1960–1970", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },
  { title: "The Girl from Ipanema", artistName: "Astrud Gilberto", lyricPrompt: "Tall and tan and young and lovely, the girl from Ipanema goes walking", lyricAnswer: "and when she passes, each one she passes goes ah", releaseYear: 1964, genre: "Jazz", decade: "1960–1970", difficulty: "high", lyricSectionType: "verse", explicitFlag: false },

  // ── 2020s ─────────────────────────────────────────────────────────────────
  { title: "Flowers", artistName: "Miley Cyrus", lyricPrompt: "I can buy myself flowers, write my name in the sand", lyricAnswer: "talk to myself for hours, say things you don't understand", releaseYear: 2023, genre: "Pop", decade: "2020–Present", difficulty: "low", lyricSectionType: "chorus", explicitFlag: false },
  { title: "Unholy", artistName: "Sam Smith ft. Kim Petras", lyricPrompt: "Mummy don't know daddy's getting hot", lyricAnswer: "at the body shop, doing something unholy", releaseYear: 2022, genre: "Pop", decade: "2020–Present", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },
  { title: "Rich Flex", artistName: "Drake & 21 Savage", lyricPrompt: "Rich flex, can you do a rich flex?", lyricAnswer: "ayy, ayy, ayy, ayy", releaseYear: 2022, genre: "Hip Hop", decade: "2020–Present", difficulty: "low", lyricSectionType: "hook", explicitFlag: true },
  { title: "Kill Bill", artistName: "SZA", lyricPrompt: "I might kill my ex, not the best idea", lyricAnswer: "his new girlfriend's next, how'd I get here?", releaseYear: 2022, genre: "R&B", decade: "2020–Present", difficulty: "medium", lyricSectionType: "verse", explicitFlag: false },
  { title: "Cruel Summer", artistName: "Taylor Swift", lyricPrompt: "I'm drunk in the back of the car and I cried like a baby coming home from the bar", lyricAnswer: "said I'm fine but it wasn't true", releaseYear: 2019, genre: "Pop", decade: "2010–2020", difficulty: "high", lyricSectionType: "verse", explicitFlag: false },
  { title: "Anti-Hero", artistName: "Taylor Swift", lyricPrompt: "It's me, hi, I'm the problem, it's me", lyricAnswer: "at tea time, everybody agrees", releaseYear: 2022, genre: "Pop", decade: "2020–Present", difficulty: "medium", lyricSectionType: "chorus", explicitFlag: false },
];

const artistMetadata = [
  { artistName: "Whitney Houston", officialWebsite: "https://whitneyhouston.com", instagramUrl: "https://instagram.com/whitneyhoustonofficial", youtubeUrl: "https://youtube.com/@WhitneyHouston", spotifyUrl: "https://open.spotify.com/artist/6XpaIBNiVzIetEPCWDvAFP", appleMusicUrl: "https://music.apple.com/artist/whitney-houston/13197", newsSearchUrl: "https://news.google.com/search?q=Whitney+Houston" },
  { artistName: "Beyoncé", officialWebsite: "https://beyonce.com", instagramUrl: "https://instagram.com/beyonce", facebookUrl: "https://facebook.com/beyonce", xUrl: "https://x.com/beyonce", youtubeUrl: "https://youtube.com/@beyonce", spotifyUrl: "https://open.spotify.com/artist/6vWDO969PvNqNYHIOW5v0m", appleMusicUrl: "https://music.apple.com/artist/beyoncé/1419227", newsSearchUrl: "https://news.google.com/search?q=Beyoncé" },
  { artistName: "Drake", officialWebsite: "https://drakeofficial.com", instagramUrl: "https://instagram.com/champagnepapi", xUrl: "https://x.com/drake", youtubeUrl: "https://youtube.com/@Drake", spotifyUrl: "https://open.spotify.com/artist/3TVXtAsR1Inumwj472S9r4", appleMusicUrl: "https://music.apple.com/artist/drake/271256", newsSearchUrl: "https://news.google.com/search?q=Drake+rapper" },
  { artistName: "Taylor Swift", officialWebsite: "https://taylorswift.com", instagramUrl: "https://instagram.com/taylorswift", facebookUrl: "https://facebook.com/TaylorSwift", xUrl: "https://x.com/taylorswift13", tiktokUrl: "https://tiktok.com/@taylorswift", youtubeUrl: "https://youtube.com/@TaylorSwift", spotifyUrl: "https://open.spotify.com/artist/06HL4z0CvFAxyc27GXpf02", appleMusicUrl: "https://music.apple.com/artist/taylor-swift/159260351", newsSearchUrl: "https://news.google.com/search?q=Taylor+Swift" },
  { artistName: "Kendrick Lamar", officialWebsite: "https://kendricklamar.com", instagramUrl: "https://instagram.com/kendricklamar", xUrl: "https://x.com/kendricklamar", youtubeUrl: "https://youtube.com/@KendrickLamarVEVO", spotifyUrl: "https://open.spotify.com/artist/2YZyLoL8N0Wb9xBt1NhZWg", appleMusicUrl: "https://music.apple.com/artist/kendrick-lamar/368183298", newsSearchUrl: "https://news.google.com/search?q=Kendrick+Lamar" },
  { artistName: "Adele", officialWebsite: "https://adele.com", instagramUrl: "https://instagram.com/adele", facebookUrl: "https://facebook.com/adele", xUrl: "https://x.com/adele", youtubeUrl: "https://youtube.com/@Adele", spotifyUrl: "https://open.spotify.com/artist/4dpARuHxo51G3z768sgnrY", appleMusicUrl: "https://music.apple.com/artist/adele/262836961", newsSearchUrl: "https://news.google.com/search?q=Adele+singer" },
  { artistName: "Ed Sheeran", officialWebsite: "https://edsheeran.com", instagramUrl: "https://instagram.com/teddysphotos", facebookUrl: "https://facebook.com/EdSheeranMusic", xUrl: "https://x.com/edsheeran", tiktokUrl: "https://tiktok.com/@edsheeran", youtubeUrl: "https://youtube.com/@EdSheeran", spotifyUrl: "https://open.spotify.com/artist/6eUKZXaKkcviH0Ku9w2n3V", appleMusicUrl: "https://music.apple.com/artist/ed-sheeran/183313439", newsSearchUrl: "https://news.google.com/search?q=Ed+Sheeran" },
  { artistName: "Billie Eilish", officialWebsite: "https://billieeilish.com", instagramUrl: "https://instagram.com/billieeilish", facebookUrl: "https://facebook.com/billieeilish", xUrl: "https://x.com/billieeilish", tiktokUrl: "https://tiktok.com/@billieeilish", youtubeUrl: "https://youtube.com/@BillieEilish", spotifyUrl: "https://open.spotify.com/artist/6qqNVTkY8uBg9cP3Jd7DAH", appleMusicUrl: "https://music.apple.com/artist/billie-eilish/1065981054", newsSearchUrl: "https://news.google.com/search?q=Billie+Eilish" },
  { artistName: "The Weeknd", officialWebsite: "https://theweeknd.com", instagramUrl: "https://instagram.com/theweeknd", facebookUrl: "https://facebook.com/theweeknd", xUrl: "https://x.com/theweeknd", tiktokUrl: "https://tiktok.com/@theweeknd", youtubeUrl: "https://youtube.com/@TheWeeknd", spotifyUrl: "https://open.spotify.com/artist/1Xyo4u8uXC1ZmMpatF05PJ", appleMusicUrl: "https://music.apple.com/artist/the-weeknd/479756766", newsSearchUrl: "https://news.google.com/search?q=The+Weeknd" },
  { artistName: "Aretha Franklin", officialWebsite: "https://arethafranklin.net", youtubeUrl: "https://youtube.com/@ArethaFranklinVEVO", spotifyUrl: "https://open.spotify.com/artist/7nwUJBm0HE4ZxD3f5cy5ok", appleMusicUrl: "https://music.apple.com/artist/aretha-franklin/217439", newsSearchUrl: "https://news.google.com/search?q=Aretha+Franklin" },
  { artistName: "Stevie Wonder", officialWebsite: "https://steviewonder.com", instagramUrl: "https://instagram.com/steviewonder", facebookUrl: "https://facebook.com/steviewonder", youtubeUrl: "https://youtube.com/@StevieWonderVEVO", spotifyUrl: "https://open.spotify.com/artist/0C0XlULifJtAgn6ZNCW2eu", appleMusicUrl: "https://music.apple.com/artist/stevie-wonder/217439", newsSearchUrl: "https://news.google.com/search?q=Stevie+Wonder" },
  { artistName: "Miley Cyrus", officialWebsite: "https://mileycyrus.com", instagramUrl: "https://instagram.com/mileycyrus", facebookUrl: "https://facebook.com/MileyCyrus", xUrl: "https://x.com/mileycyrus", tiktokUrl: "https://tiktok.com/@mileycyrus", youtubeUrl: "https://youtube.com/@MileyCyrus", spotifyUrl: "https://open.spotify.com/artist/5YGY8feqx7naU7z4HiWTx9", appleMusicUrl: "https://music.apple.com/artist/miley-cyrus/137057909", newsSearchUrl: "https://news.google.com/search?q=Miley+Cyrus" },
  { artistName: "SZA", officialWebsite: "https://szamusic.com", instagramUrl: "https://instagram.com/sza", xUrl: "https://x.com/sza", tiktokUrl: "https://tiktok.com/@sza", youtubeUrl: "https://youtube.com/@SZA", spotifyUrl: "https://open.spotify.com/artist/7tYKF4w9nC0nq9CsPZTHyP", appleMusicUrl: "https://music.apple.com/artist/sza/547238922", newsSearchUrl: "https://news.google.com/search?q=SZA+singer" },
  { artistName: "Queen", officialWebsite: "https://queenonline.com", instagramUrl: "https://instagram.com/officialqueenmusic", facebookUrl: "https://facebook.com/Queen", xUrl: "https://x.com/queentheband", youtubeUrl: "https://youtube.com/@Queen", spotifyUrl: "https://open.spotify.com/artist/1dfeR4HaWDbWqFHLkxsg1d", appleMusicUrl: "https://music.apple.com/artist/queen/5040714", newsSearchUrl: "https://news.google.com/search?q=Queen+band" },
  { artistName: "Eminem", officialWebsite: "https://eminem.com", instagramUrl: "https://instagram.com/eminem", facebookUrl: "https://facebook.com/eminem", xUrl: "https://x.com/eminem", youtubeUrl: "https://youtube.com/@EminemMusic", spotifyUrl: "https://open.spotify.com/artist/7dGJo4pcD2V6oG8kP0tJRR", appleMusicUrl: "https://music.apple.com/artist/eminem/111051", newsSearchUrl: "https://news.google.com/search?q=Eminem" },
  { artistName: "Dua Lipa", officialWebsite: "https://dualipa.com", instagramUrl: "https://instagram.com/dualipa", facebookUrl: "https://facebook.com/DuaLipa", xUrl: "https://x.com/dualipa", tiktokUrl: "https://tiktok.com/@dualipa", youtubeUrl: "https://youtube.com/@DuaLipa", spotifyUrl: "https://open.spotify.com/artist/6M2wZ9GZgrQXHCFfjv46we", appleMusicUrl: "https://music.apple.com/artist/dua-lipa/1031397873", newsSearchUrl: "https://news.google.com/search?q=Dua+Lipa" },
];

async function seed() {
  const conn = await mysql.createConnection(DB_URL);

  console.log("Seeding artist metadata...");
  for (const meta of artistMetadata) {
    await conn.execute(
      `INSERT IGNORE INTO artist_metadata (artistName, officialWebsite, instagramUrl, facebookUrl, xUrl, tiktokUrl, youtubeUrl, spotifyUrl, appleMusicUrl, newsSearchUrl, aliases)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE artistName=artistName`,
      [
        meta.artistName,
        meta.officialWebsite || null,
        meta.instagramUrl || null,
        meta.facebookUrl || null,
        meta.xUrl || null,
        meta.tiktokUrl || null,
        meta.youtubeUrl || null,
        meta.spotifyUrl || null,
        meta.appleMusicUrl || null,
        meta.newsSearchUrl || null,
        "[]",
      ]
    );
  }

  console.log("Seeding songs...");
  for (const song of songs) {
    // Get artist metadata id
    const [rows] = await conn.execute("SELECT id FROM artist_metadata WHERE artistName = ?", [song.artistName.split(" ft.")[0].trim()]);
    const metaId = rows[0]?.id || null;

    await conn.execute(
      `INSERT IGNORE INTO songs (title, artistName, artistMetadataId, lyricPrompt, lyricAnswer, releaseYear, genre, decadeRange, difficulty, lyricSectionType, explicitFlag, isActive, approvalStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'approved')`,
      [
        song.title,
        song.artistName,
        metaId,
        song.lyricPrompt,
        song.lyricAnswer,
        song.releaseYear,
        song.genre,
        song.decade,
        song.difficulty,
        song.lyricSectionType,
        song.explicitFlag ? 1 : 0,
      ]
    );
  }

  console.log(`✅ Seeded ${songs.length} songs and ${artistMetadata.length} artist metadata records`);
  await conn.end();
}

seed().catch(console.error);
