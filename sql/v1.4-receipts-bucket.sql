-- v1.4: Storage bucket for expense receipts uploaded from admin/expenses.html
-- Plus RLS on the expenses table so admins (and only admins) can read/insert.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,                              -- private bucket
  5 * 1024 * 1024,                    -- 5 MB max
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage policies: only admins can upload + read + delete
drop policy if exists "admins_upload_receipts" on storage.objects;
create policy "admins_upload_receipts"
  on storage.objects for insert
  with check (bucket_id = 'receipts' and public.is_admin(auth.uid()));

drop policy if exists "admins_read_receipts" on storage.objects;
create policy "admins_read_receipts"
  on storage.objects for select
  using (bucket_id = 'receipts' and public.is_admin(auth.uid()));

drop policy if exists "admins_delete_receipts" on storage.objects;
create policy "admins_delete_receipts"
  on storage.objects for delete
  using (bucket_id = 'receipts' and public.is_admin(auth.uid()));

-- Expenses table RLS: admins can read all + insert their own + update their own
alter table public.expenses enable row level security;

drop policy if exists "expenses_admin_read"   on public.expenses;
drop policy if exists "expenses_admin_insert" on public.expenses;
drop policy if exists "expenses_admin_update" on public.expenses;

create policy "expenses_admin_read"
  on public.expenses for select
  using (public.is_admin(auth.uid()));

create policy "expenses_admin_insert"
  on public.expenses for insert
  with check (public.is_admin(auth.uid()));

create policy "expenses_admin_update"
  on public.expenses for update
  using (public.is_admin(auth.uid()));
