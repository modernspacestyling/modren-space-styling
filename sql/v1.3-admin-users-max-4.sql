-- v1.3: cap admin_users at 4 rows via BEFORE INSERT trigger.
-- Defense-in-depth alongside the API check in api/agent-approval.js (?action=invite_admin).

create or replace function public.enforce_admin_users_max()
returns trigger language plpgsql as $$
declare cnt int;
begin
  select count(*) into cnt from public.admin_users;
  if cnt >= 4 then
    raise exception 'Admin limit reached: maximum 4 admin accounts allowed (currently %)', cnt;
  end if;
  return new;
end $$;

drop trigger if exists trg_admin_users_max on public.admin_users;
create trigger trg_admin_users_max
  before insert on public.admin_users
  for each row execute procedure public.enforce_admin_users_max();
