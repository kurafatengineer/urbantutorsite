-- =====================================================================
-- FIX: admin_users, payments and subscriptions were created without
-- the standard grants Supabase gives service_role on every table
-- (SELECT/INSERT/UPDATE/DELETE) - only REFERENCES/TRIGGER/TRUNCATE
-- came through automatically. The Edge Function's service-role key
-- was therefore hitting "permission denied for table ..." before RLS
-- was even evaluated. RLS itself still denies anon/authenticated on
-- all three (by design - only the Edge Function should ever touch
-- them), so no grant is given to those roles here.
-- =====================================================================

grant select, insert, update, delete on public.admin_users to service_role;
grant select, insert, update, delete on public.payments to service_role;
grant select, insert, update, delete on public.subscriptions to service_role;

-- also cover sequences behind the identity columns, needed for inserts
grant usage, select on all sequences in schema public to service_role;
