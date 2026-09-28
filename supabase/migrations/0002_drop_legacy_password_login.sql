-- =====================================================================
-- CLEANUP: remove the old shared-password admin login machinery.
-- Admin login is now per-employee email + OTP (see admin_users and
-- the "admin" Edge Function) - these were only ever called by the
-- password-checking code that has been replaced, so they are dead.
-- =====================================================================

drop function if exists public.admin_login_failed();
drop function if exists public.admin_login_locked();
drop function if exists public.admin_login_succeeded();
drop table if exists public.admin_failed_logins;
