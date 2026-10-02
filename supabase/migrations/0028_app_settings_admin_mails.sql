-- Small key/value store for site-wide switches the office can flip.
-- First switch: "admin_mails" - when off, the Admin Panel's updates
-- (demo scheduled, payments, subscriptions, tuition posted by the office)
-- send NO emails. Only the server (service_role) reads / writes it.
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select, insert, update on public.app_settings to service_role;

insert into public.app_settings (key, value) values ('admin_mails', '{"enabled": true}')
on conflict (key) do nothing;
