-- =====================================================================
-- A subscription payment records WHO actually received the money (an
-- admin/staff member's name), separate from "Collected By" (agency vs.
-- tutor, which only applies to a tuition collection) and from
-- recorded_by (which admin_users account filed the record). Defaults
-- to the logged-in admin's own name in the UI, but stays a free-text
-- field since the person receiving it isn't always the one filing it.
-- =====================================================================

alter table public.payments add column received_by text;
