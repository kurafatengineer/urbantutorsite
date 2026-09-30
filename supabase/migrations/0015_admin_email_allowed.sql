-- Asked before an admin login code is emailed: is this address an ACTIVE
-- office employee? (Or is the panel brand new, with no employee yet, so the
-- first Super Admin can set themselves up?) Only these two yes/no flags leave
-- the database - nothing else about the employee.
create or replace function public.admin_email_allowed(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'allowed', exists (
      select 1 from public.admin_users
      where lower(email) = lower(trim(p_email)) and active
    ),
    'bootstrap', not exists (select 1 from public.admin_users)
  );
$$;

revoke all on function public.admin_email_allowed(text) from public;
grant execute on function public.admin_email_allowed(text) to anon, authenticated;
