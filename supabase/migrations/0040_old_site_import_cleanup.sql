-- One-time import of old-site (WordPress Ultimate Member) users, done on 2026-10-13.
--   * 456 students -> students (SID20260162 .. SID20260617), each with a
--     "Student Yearly Subscription" (500, Yearly, active).
--   * 544 tutors   -> tutors   (TID20260002 .. TID20260545), status
--     'Pending for Verification', each with a "Tutor Yearly Subscription"
--     (1000, Yearly, active).
-- Data was cleaned (title case, boards/cities/courses normalised, mobiles to
-- 10 digits, duplicates merged) before upload. No personal data lives in the
-- repo. The encrypted staging table used for the upload is removed here.

drop table if exists public._import_stage;
