-- CLEAN-UP, APPLIED 2026-10-16 (run by hand from Supabase -> SQL Editor, in one transaction).
-- These objects were not used by the website, the Edge Functions or any other database function
-- (checked 2026-10-14). The SQL tool used in the review hung on every DROP / function statement,
-- so it was run from the SQL Editor. Checked afterwards: all six functions, _import_stage and the
-- test row are gone; the live bot / registration functions are still there.

drop function if exists public.get_public_students();
drop function if exists public.get_public_tutors();
drop function if exists public.register_student_whatsapp(jsonb);
drop function if exists public.whatsapp_number_status(text);
drop function if exists public.admin_email_allowed(text);
drop function if exists public.admin_verify_tutor(text, text);

-- temporary data left over from the old-site import (14 rows of text chunks)
drop table if exists public._import_stage;

-- a test row of the class-reminder queue (already marked as sent)
delete from public.class_notifications where demo_id = 'DID_TEST_NONE';

-- Optional, once a day: forget old reminders and half-finished chat registrations
-- (run only if you want it; it needs the pg_cron extension)
-- select cron.schedule('bot-housekeeping', '20 19 * * *',
--   $$delete from public.class_notifications where class_date < current_date - 30;
--     delete from public.bot_sessions where updated_at < now() - interval '1 day';$$);
