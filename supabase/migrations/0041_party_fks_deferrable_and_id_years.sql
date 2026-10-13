-- Let student / tutor IDs be renumbered inside one transaction: the
-- subscriptions and payments links are checked at commit instead of per
-- statement (tuitions / applications already follow an ID change).
alter table public.subscriptions alter constraint subscriptions_student_id_fkey deferrable initially immediate;
alter table public.subscriptions alter constraint subscriptions_tutor_id_fkey deferrable initially immediate;
alter table public.payments alter constraint payments_tutor_id_fkey deferrable initially immediate;

-- One-time data fix, done on 2026-10-13 (no rows deleted): the users
-- imported from the old site were renumbered so the year in their ID is
-- their own registration year (India time), serial by registration time:
--   students: SID20250001-0004, SID20260162-0613 (SID20260001-0160 unchanged)
--   tutors:   TID20250001-0178, TID20260002-0367 (TID20260001 unchanged)
-- Subscriptions were moved to the new IDs in the same transaction, and
-- student_id_seq / tutor_id_seq were set to the highest 2026 serial.

-- Later the same day every 2026 ID (old and imported) was renumbered once
-- more, serial by registration time, earliest first:
--   students SID20260001-0611 (last: the newest entry), tutors TID20260001-0367.
-- 2025 IDs stayed as above. Sequences now continue from 611 / 367.
