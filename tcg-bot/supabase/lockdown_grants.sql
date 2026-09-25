-- Lock down the public API roles (2026-09-25).
-- Every caller (bot, Activity, studio, gallery) uses the service_role key, and the
-- pg_cron jobs run as postgres. anon + authenticated had Supabase's default grants:
-- full table privileges (incl. TRUNCATE) and EXECUTE on every RPC (grant_packs,
-- add_card_to_player, settle_hunt, ...). RLS with no policies was the ONLY layer that
-- stopped the public anon key. This removes the grants, so a future permissive policy
-- or a SECURITY DEFINER function cannot expose the economy.
-- Keeps: the public catalog read (cards, subjects) that the RLS policies already allow.
begin;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.cards, public.subjects to anon, authenticated;

-- New objects that postgres creates in a later migration start locked too.
-- Postgres grants EXECUTE to PUBLIC on every new function by a GLOBAL default, so the
-- schema-scoped revoke alone does not remove it (a probe function proved this).
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

commit;
