-- 2026-07-07-restore-realtime-rls-policies.sql
-- RLS was enabled out-of-band on all public tables, leaving users / room_players /
-- tournament_members / tournaments deny-all with no policy. The realtime.messages
-- channel-join policies read those tables as `authenticated` via current_chat_user_id()
-- (LANGUAGE sql STABLE, NOT security definer), so current_chat_user_id() returns NULL and
-- every game:{id} / chat:* private-channel join fails → multiplayer + chat realtime broken.
-- These 4 additive SELECT policies restore channel authorization. RLS is ALREADY enabled;
-- no ENABLE statements here. Idempotent. Applied via scripts/apply-kpi-migration.mjs.

-- Helper hygiene: pin search_path (defense-in-depth; functions stay STABLE, non-definer).
ALTER FUNCTION public.current_chat_user_id() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_chat_admin(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_chat_banned(integer, chat_ban_scope, integer) SET search_path = public, pg_temp;

-- users: own row only. Uses auth.uid() DIRECTLY (not the helper — the helper reads users;
-- referencing it here would recurse).
DO $$ BEGIN
  CREATE POLICY users_select_own ON public.users
    FOR SELECT TO authenticated
    USING ("openId" = (select auth.uid())::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- room_players: own memberships. Feeds realtime_game_channel_join EXISTS.
DO $$ BEGIN
  CREATE POLICY room_players_select_own ON public.room_players
    FOR SELECT TO authenticated
    USING ("userId" = (select public.current_chat_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tournament_members: own active memberships. Feeds realtime_chat_channel_join EXISTS.
DO $$ BEGIN
  CREATE POLICY tournament_members_select_own ON public.tournament_members
    FOR SELECT TO authenticated
    USING (user_id = (select public.current_chat_user_id()) AND left_at IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tournaments: tournaments the caller is an active member of. Feeds the chat:tournament join.
DO $$ BEGIN
  CREATE POLICY tournaments_select_member ON public.tournaments
    FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.tournament_members tm
      WHERE tm.tournament_id = tournaments.id
        AND tm.user_id = (select public.current_chat_user_id())
        AND tm.left_at IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ROLLBACK (uncomment to revert to the current deny-all/broken-but-safe state):
-- DROP POLICY IF EXISTS users_select_own ON public.users;
-- DROP POLICY IF EXISTS room_players_select_own ON public.room_players;
-- DROP POLICY IF EXISTS tournament_members_select_own ON public.tournament_members;
-- DROP POLICY IF EXISTS tournaments_select_member ON public.tournaments;
