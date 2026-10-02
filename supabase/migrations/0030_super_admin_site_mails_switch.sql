-- Emails On / Off, final shape:
--   * Super Admin  -> app_settings "admin_mails" = the switch for the WHOLE
--     site: Off stops every notification email (Admin Panel, students,
--     tutors). Login codes (OTP) come from Supabase Auth and still go out.
--     Checked in supabase/functions/_shared/email.ts (sendMail).
--   * Other staff  -> admin_users.mails_enabled (0029), their own updates only.
-- Start with emails ON (an earlier test had left the old switch off).

insert into public.app_settings (key, value) values ('admin_mails', '{"enabled": true}')
on conflict (key) do update set value = '{"enabled": true}', updated_at = now();
