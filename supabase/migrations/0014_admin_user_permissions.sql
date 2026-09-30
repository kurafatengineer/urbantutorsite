-- Per-employee permissions. NULL means "use the role's defaults", so every
-- existing employee keeps exactly the access their role already gave them.
alter table public.admin_users add column if not exists permissions text[];
