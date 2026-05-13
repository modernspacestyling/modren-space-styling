-- sql/v1.2-03-admin-users.sql
-- v1.2 Phase 6: admin_users + admin-read policies + Mandeep seed

create table if not exists public.admin_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text not null,
  added_by    uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

alter table public.admin_users enable row level security;

drop policy if exists "admins_read_team" on public.admin_users;
create policy "admins_read_team"
  on public.admin_users for select
  using (exists (select 1 from public.admin_users a where a.id = auth.uid()));

drop policy if exists "profiles_admin_read" on public.profiles;
create policy "profiles_admin_read"
  on public.profiles for select
  using (exists (select 1 from public.admin_users a where a.id = auth.uid()));

drop policy if exists "bookings_admin_read" on public.bookings;
create policy "bookings_admin_read"
  on public.bookings for select
  using (exists (select 1 from public.admin_users a where a.id = auth.uid()));

insert into public.admin_users (id, email, full_name)
  select id, email, 'Mandeep Singh'
    from auth.users
   where email = 'modernspacestyling@gmail.com'
  on conflict (id) do nothing;
