-- sql/v1.2-02-bookings-user-id.sql
alter table public.bookings
  add column if not exists user_id uuid references auth.users(id);

create index if not exists bookings_user_id_idx on public.bookings(user_id);

update public.bookings b
   set user_id = u.id
  from auth.users u
 where b.user_id is null
   and lower(b.agent_email) = lower(u.email);

alter table public.bookings enable row level security;

drop policy if exists "bookings_own_select" on public.bookings;
create policy "bookings_own_select"
  on public.bookings for select using (auth.uid() = user_id);
