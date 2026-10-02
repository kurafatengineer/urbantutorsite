-- The admin login now decides on the SERVER (Edge Function "admin", action adminSendCode),
-- so nobody needs to ask the database "is this email an admin?" from the browser any more.
revoke execute on function public.admin_email_allowed(text) from anon, authenticated, public;
