-- v1.3.1: fix admin_users RLS recursion by using a SECURITY DEFINER helper.
-- The previous policies referenced public.admin_users in an EXISTS clause inside
-- their own USING expression — that inner query was itself RLS-checked, causing
-- the lookup to return 0 rows for everyone including real admins.
--
-- The helper runs with its owner's privileges and bypasses RLS internally —
-- standard Supabase pattern for self-referential policies.

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where id = uid);
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to anon, authenticated, service_role;

drop policy if exists "admins_read_team"   on public.admin_users;
drop policy if exists "profiles_admin_read" on public.profiles;
drop policy if exists "bookings_admin_read" on public.bookings;

create policy "admins_read_team"
  on public.admin_users for select
  using (public.is_admin(auth.uid()));

create policy "profiles_admin_read"
  on public.profiles for select
  using (public.is_admin(auth.uid()));

create policy "bookings_admin_read"
  on public.bookings for select
  using (public.is_admin(auth.uid()));
