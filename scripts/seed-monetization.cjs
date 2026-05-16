// Seed monetization suggestion rules + commentary templates
// Run: set -a; source .env; set +a; node scripts/seed-monetization.cjs

const postgres = require("postgres");

async function run() {
  const sql = postgres(process.env.SUPABASE_SESSION_POOLER_STRING);

  // Task 1: Suggestion rules
  console.log("Seeding suggestion rules...");
  await sql`
    INSERT INTO suggestion_rules (category, trigger_key, text, action, priority) VALUES
      ('upsell', 'event-entry-nudge', 'The prize draw closes soon. 8 Golden Notes to enter.', '/shop', 15),
      ('upsell', 'post-game-shop', ${"Nice game! You're close to affording a practice pack."}, '/shop', 25),
      ('mode', 'partner-concert', 'iHeartRadio has concert tickets in tonight''s prize pool. Play to win.', '/setup', 5),
      ('upsell', 'streak-protection-upsell', 'Your streak is at risk. Streak Insurance = 2 Golden Notes.', '/shop', 18),
      ('mode', 'returning-bonus', 'Welcome back! Play a game today and earn bonus rewards.', '/setup', 55)
    ON CONFLICT (trigger_key) DO NOTHING
  `;
  console.log("Suggestion rules seeded.");

  // Task 3: Commentary templates
  console.log("Seeding commentary templates...");
  await sql`
    INSERT INTO commentary_templates (trigger_key, text, priority) VALUES
      ('shop_nudge_low_balance', 'Running low on Golden Notes — the shop has your back.', 10),
      ('shop_nudge_low_balance', 'Your Golden Notes are getting thin. Time to restock?', 20),
      ('event_reminder', ${"Don't forget — the prize draw is live. Enter from the shop."}, 10),
      ('perfect_game_reward', ${"Perfect game! You've earned bragging rights and then some."}, 10)
    ON CONFLICT DO NOTHING
  `;
  console.log("Commentary templates seeded.");

  await sql.end();
  console.log("Done.");
}

run().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
