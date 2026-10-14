-- Employees tab: the bell icon switches an employee's notifications off / on
-- (login codes still go out).
alter table public.admin_users add column if not exists notifications_off boolean not null default false;
