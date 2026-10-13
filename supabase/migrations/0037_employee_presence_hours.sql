-- Employees section:
--  * presence: the Admin Panel pings every minute while it is open
--      last_seen_at   - the panel was open (logged in)
--      last_active_at - the employee actually used it (mouse / keys)
--      logged_out_at  - pressed Log out / was logged out
--  * login hours: work_start / work_end (India time). Outside them the
--    employee cannot use the Admin Panel. Empty = any time. A Super Admin
--    is never limited (24 x 7).
alter table public.admin_users add column if not exists last_seen_at   timestamptz;
alter table public.admin_users add column if not exists last_active_at timestamptz;
alter table public.admin_users add column if not exists logged_out_at  timestamptz;
alter table public.admin_users add column if not exists work_start     time;
alter table public.admin_users add column if not exists work_end       time;
