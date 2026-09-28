# Supabase Auth email templates

The login OTP emails (both the public site and the admin panel use
"email + a 6-digit code") are sent directly by Supabase Auth, not by
any code in this repo - they come from templates stored in the
project's Auth config, which can only be edited from the Supabase
Dashboard (or the Management API with a personal access token, which
this repo has no access to). That's why these are plain HTML files
here for reference/version control, not something `deploy_edge_function`
can push.

## Where to paste these

Supabase Dashboard → your project → **Authentication → Email Templates**.

1. Open the **Magic Link** template (this is the one used for every
   OTP login, despite the name - Supabase shares one template between
   "magic link" and "OTP" sign-in).
   - Subject: `{{ .Token }} is your Urban Tutor Site login code`
   - Body: paste the contents of `magic_link.html`
2. Open the **Confirm signup** template (only used the very first time
   a new email address signs in).
   - Subject: `{{ .Token }} is your Urban Tutor Site login code`
   - Body: paste the contents of `confirm_signup.html`
3. Save each template.

Both use `{{ .Token }}` (Supabase's Go-template variable for the 6-digit
code), styled the same dark-card way as every other Urban Tutor Site
email (see `supabase/functions/_shared/email.ts`).

No further code change is needed - Supabase Auth uses whatever HTML is
saved in these two templates for every future OTP email, automatically.
