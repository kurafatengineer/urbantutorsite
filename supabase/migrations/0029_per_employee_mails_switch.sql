-- Emails On / Off is now each employee's own switch: when an employee
-- turns it off, only the updates THAT employee makes in the Admin Panel
-- send no email. Everyone else's updates still email as usual.
-- Turning it off needs the "mails_toggle" permission (Super Admin always
-- has it); without the permission the switch is always treated as on.

alter table public.admin_users
  add column if not exists mails_enabled boolean not null default true;

-- The old office-wide switch (0028, table app_settings) is no longer read
-- by anything. It is left in place (service-role only) - dropping it timed
-- out on the live database; it can be dropped later with:
--   drop table if exists public.app_settings;
