// scripts/apply-chat-trigger-fix.mjs
// One-shot fixup: replaces the three chat broadcast trigger functions with
// corrected realtime.broadcast_changes() call signatures (8 args:
// topic, event, operation, table_name, table_schema, NEW, OLD, [level]).
//
// The original migration 0013 used a 7-arg signature with to_jsonb() that
// doesn't exist; every INSERT on chat_messages or chat_bans errored with
// 42883 "function ... does not exist" — verified via failing chatBans tests.
//
// CREATE OR REPLACE FUNCTION is idempotent, so this runs cleanly on top of
// the already-applied migration.

import postgres from "postgres";
import dotenv from "dotenv";
dotenv.config();

const sql = postgres(
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL,
  { max: 1, prepare: false }
);

const FIX = `
BEGIN;

CREATE OR REPLACE FUNCTION chat_messages_broadcast() RETURNS TRIGGER AS $$
DECLARE
  follower_id INTEGER;
BEGIN
  IF NEW.scope = 'global' THEN
    PERFORM realtime.broadcast_changes('chat:global', 'message_inserted', 'INSERT', 'chat_messages', 'public', NEW, NULL);
  ELSIF NEW.scope = 'tournament' THEN
    PERFORM realtime.broadcast_changes('chat:tournament:' || NEW.room_id::text, 'message_inserted', 'INSERT', 'chat_messages', 'public', NEW, NULL);
  ELSIF NEW.scope = 'friends' THEN
    PERFORM realtime.broadcast_changes('chat:user:' || NEW.author_id::text || ':feed', 'message_inserted', 'INSERT', 'chat_messages', 'public', NEW, NULL);
    IF NOT NEW.posted_while_shadow_banned THEN
      FOR follower_id IN
        SELECT uf.follower_id FROM user_favorites uf
        WHERE uf.favorite_id = NEW.author_id
      LOOP
        PERFORM realtime.broadcast_changes('chat:user:' || follower_id::text || ':feed', 'message_inserted', 'INSERT', 'chat_messages', 'public', NEW, NULL);
      END LOOP;
    END IF;
    PERFORM realtime.broadcast_changes('chat:moderation', 'message_inserted', 'INSERT', 'chat_messages', 'public', NEW, NULL);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION chat_messages_broadcast_update() RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
     OR (NEW.body != OLD.body)
     OR (NEW.edited_at IS DISTINCT FROM OLD.edited_at)
     OR (NEW.flag_status != OLD.flag_status)
  THEN
    IF NEW.scope = 'global' THEN
      PERFORM realtime.broadcast_changes('chat:global', 'message_updated', 'UPDATE', 'chat_messages', 'public', NEW, OLD);
    ELSIF NEW.scope = 'tournament' THEN
      PERFORM realtime.broadcast_changes('chat:tournament:' || NEW.room_id::text, 'message_updated', 'UPDATE', 'chat_messages', 'public', NEW, OLD);
    ELSIF NEW.scope = 'friends' THEN
      PERFORM realtime.broadcast_changes('chat:user:' || NEW.author_id::text || ':feed', 'message_updated', 'UPDATE', 'chat_messages', 'public', NEW, OLD);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION chat_bans_broadcast() RETURNS TRIGGER AS $$
DECLARE
  event_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'ban_applied';
  ELSIF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    event_name := 'ban_revoked';
  ELSE
    RETURN NEW;
  END IF;
  PERFORM realtime.broadcast_changes(
    'chat:user:' || NEW.user_id::text || ':feed',
    event_name,
    TG_OP,
    'chat_bans',
    'public',
    NEW,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD ELSE NULL END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
`;

try {
  console.log("Applying chat trigger function fixes ...");
  await sql.unsafe(FIX).simple();
  console.log("Trigger functions replaced. Testing with a probe ...");

  // Probe: insert a chat message (then delete it). If the trigger signature is
  // now correct, the INSERT should succeed.
  const admins = await sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1`;
  if (admins.length === 0) {
    console.log("No admin user to test with; trigger fix applied, untested.");
  } else {
    const adminId = admins[0].id;
    const [inserted] = await sql`
      INSERT INTO chat_messages (scope, room_id, author_id, body)
      VALUES ('global', 1, ${adminId}, 'probe — trigger signature test')
      RETURNING id
    `;
    await sql`DELETE FROM chat_messages WHERE id = ${inserted.id}`;
    console.log(`Probe OK: inserted msg id=${inserted.id}, deleted cleanly.`);
  }
} catch (err) {
  console.error("Trigger fix FAILED:", err.message ?? err);
  process.exit(1);
} finally {
  await sql.end();
}
