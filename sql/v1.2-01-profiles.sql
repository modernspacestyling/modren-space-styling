-- sql/v1.2-01-profiles.sql
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  agency_name   text not null,
  mobile_phone  text not null,
  email         text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_self_read"   on public.profiles;
drop policy if exists "profiles_self_update" on public.profiles;
drop policy if exists "profiles_self_insert" on public.profiles;

create policy "profiles_self_read"
  on public.profiles for select using (auth.uid() = id);
create policy "profiles_self_update"
  on public.profiles for update using (auth.uid() = id);
create policy "profiles_self_insert"
  on public.profiles for insert with check (auth.uid() = id);

create or replace function public.touch_profiles_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
  before update on public.profiles
  for each row execute procedure public.touch_profiles_updated_at();
