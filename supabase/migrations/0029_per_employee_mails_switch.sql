-- Emails On / Off is now each employee's own switch: when an employee
-- turns it off, only the updates THAT employee makes in the Admin Panel
-- send no email. Everyone else's updates still email as usual.
-- Turning it off needs the "mails_toggle" permission (Super Admin always
-- has it); without the permission the switch is always treated as on.

alter table public.admin_users
  add column if not exists mails_enabled boolean not null default true;

-- app_settings "admin_mails" (0028) stays: it is now the SUPER ADMIN's
-- site-wide switch (see 0030).
