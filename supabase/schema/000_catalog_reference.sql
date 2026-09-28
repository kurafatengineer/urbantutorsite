-- =====================================================================
-- SCHEMA CATALOG (REFERENCE ONLY - DO NOT RUN)
--
-- This file is not a migration. It is a hand-maintained map of what is
-- actually live in the Supabase project, so anyone working on this repo
-- can see the whole picture without opening the Supabase dashboard.
-- Real, applied changes belong in supabase/migrations/ as numbered
-- files (0001_..., 0002_..., in order, never edited after they've run).
--
-- Update this file whenever a migration adds/removes/renames something.
-- Last refreshed: 2026-09-28, after 0002_drop_legacy_password_login.
-- =====================================================================


-- ---------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------

-- public.students          One row per registered student/parent.
--   student_id (PK, text)   parents_name         student_name
--   phone                   whatsapp              email
--   gender                  city                  address
--   pin_code                terms_accepted        school
--   class_name              board                 created_at

-- public.tutors             One row per registered tutor.
--   tutor_id (PK, text)     email                 mobile_number
--   whatsapp_number         register_as           full_name
--   birth_date              gender                languages_known
--   identity_proof          profile_image         class12_* (stream/year/%/cgpa/board)
--   graduation_* (course/subject/college/year/%)   pg_* (subject/college/year/%)
--   special_courses         special_child_disability
--   experience_years        classes_you_teach     subjects_you_teach
--   boards_you_teach        teaching_location     city
--   present_address         pin_code              terms_accepted
--   email_verified          verification_status ('Verified'|'Rejected'|'Pending for Verification')
--   registered_at

-- public.tuitions           One row per posted requirement ("Demo ID").
--   demo_id (PK, text)      student_id (FK -> students)
--   subject                 preferred_tutor ('Any'|'Male'|'Female')
--   medium ('Any'|'Online'|'Offline')               preferred_timing
--   terminated              posted_at

-- public.applications       One row per tutor applying to a tuition.
--   id (PK, bigint identity) demo_id (FK -> tuitions)  tutor_id (FK -> tutors)
--   demo_date               demo_time             price / duration / percentage
--   parent_accepted/rejected                       tutor_accepted/rejected
--   classes_completed        applied_at

-- public.admin_users        Employee accounts for the admin panel. Only
--                           reachable via the "admin" Edge Function's
--                           service-role key - RLS denies every direct
--                           client request. Added in 0001.
--   id (PK, uuid -> auth.users)  email (unique)     full_name
--   role: 'super_admin' | 'tuition_coordinator' | 'verification_staff'
--       | 'accounts_finance' | 'tutor_relations'
--   active                   created_at

-- public.payments           Manually entered payment records, one row
--                           per payment (advance, regular, or final).
--                           Same RLS lockdown as admin_users. Added in 0001.
--   id (PK, bigint identity)  demo_id (FK -> tuitions)  tutor_id (FK -> tutors, nullable)
--   amount                    payment_type: 'advance' | 'regular' | 'final'
--   collected_by: 'agency' | 'tutor'   (who physically received the money)
--   our_cut_amount             (agency's commission when collected_by = 'tutor')
--   payment_mode (free text - cash / UPI / bank transfer / cheque / ...)
--   payment_date               notes                recorded_by (FK -> admin_users)
--   created_at


-- ---------------------------------------------------------------------
-- FUNCTIONS - public-facing (called by the website with the visitor's
-- own Supabase Auth session; RLS + these functions are the only way in)
-- ---------------------------------------------------------------------

-- register_student(p jsonb)            New student sign-up.
-- register_student_whatsapp(p jsonb)   Student sign-up via the WhatsApp bot.
-- register_tutor(p jsonb)              New tutor sign-up.
-- set_tutor_documents(...)             Save identity proof / profile image paths.
-- get_student_profile()                The logged-in student's own profile + tuitions.
-- get_tutor_profile()                  The logged-in tutor's own profile + applications.
-- apply_for_tuition(p_demo_id)         Tutor applies to an open tuition.
-- respond_to_demo(demo_id, tutor_id, decision)   Parent accepts/rejects a demo.
-- respond_to_demo_tutor(demo_id, decision)       Tutor accepts/rejects a demo.
-- add_tuition(p jsonb)                 Student posts a new requirement.
-- get_available_tuitions()             Public list of open tuitions (for tutors to browse).
-- get_public_tutors() / get_public_students()    Public directory listings.
-- get_home_stats()                     Counts shown on the landing page.
-- email_status(p_email) / whatsapp_number_status(p_number)   Sign-up duplicate checks.
-- tuition_status(p_demo_id)            Status label for one tuition.
-- auth_email()                         Helper: lower(auth.jwt() ->> 'email').


-- ---------------------------------------------------------------------
-- FUNCTIONS - admin-only (called only by the "admin" Edge Function,
-- which runs with the service role and enforces admin_users' roles)
-- ---------------------------------------------------------------------

-- admin_get_overview()                          Everything the panel needs: tutors,
--                                                students, demos/applications.
-- admin_update_record(kind, id, changes)        Edit one tutor or student row.
-- admin_update_tuition(demo_id, changes)        Edit a tuition's requirement fields.
-- admin_update_demo_row(demo_id, tutor_id, changes)   Edit one application row.
-- admin_assign_tutor(demo_id, tutor_lookup)     Manually assign a tutor to a tuition.
-- admin_set_terminated(demo_id, terminated)     Terminate / reopen a tuition.
-- admin_verify_tutor(tutor_id, status)          Legacy helper - superseded in the
--                                                Edge Function by admin_update_record
--                                                with kind='tutors', but left in place
--                                                since nothing depends on removing it.
--
-- Payments, employees, and admin login/roles are NOT separate SQL
-- functions - the Edge Function talks to the payments / admin_users
-- tables directly with its service-role key (see
-- supabase/functions/admin/index.ts). This keeps that logic in one
-- reviewable place instead of split across SQL and TypeScript.


-- ---------------------------------------------------------------------
-- FUNCTIONS - internal helpers (prefixed _, never called directly by
-- the website or the admin panel - only by the functions above)
-- ---------------------------------------------------------------------

-- _clean / _date / _num / _mobile / _demo_iso     Input parsing helpers.
-- _adm_text / _adm_num / _adm_bool / _adm_date / _adm_mobile   Admin-edit
--     field helpers: read one field out of a jsonb "changes" object,
--     falling back to the current value.
-- _adm_show / _adm_ts                             Output formatting helpers.
-- _apply_auto_rejections(demo_id)                 Auto-rejects other tutors
--     once one is accepted for a tuition.
-- _tuition_locked(demo_id, except_id)              Guard against double-booking.
-- application_status(a, terminated)                Status label for one application row.
-- rls_auto_enable()                                Event trigger: turns RLS on for
--                                                   any newly created table automatically.


-- ---------------------------------------------------------------------
-- EDGE FUNCTIONS  (supabase/functions/<name>/index.ts)
-- ---------------------------------------------------------------------

-- admin              The admin panel's only server. OTP session in ->
--                     role check against admin_users -> role-gated actions.
-- whatsapp-webhook    Handles the WhatsApp bot integration (student
--                     registration via WhatsApp). Not touched by this
--                     project's changes - listed here for completeness.
