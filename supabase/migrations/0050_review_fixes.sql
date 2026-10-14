-- Review fixes (all applied to the live database on 2026-10-14).
--
-- 1) Indexes on the three foreign keys the Supabase advisor flagged.
create index if not exists payments_recorded_by_idx on public.payments (recorded_by);
create index if not exists payments_subscription_id_idx on public.payments (subscription_id);
create index if not exists subscriptions_created_by_idx on public.subscriptions (created_by);

-- 2) A fixed search_path on a helper function.
alter function public._tutor_experience_since() set search_path = public, pg_temp;

-- 3) The bots look people up by Telegram chat on every tap: index it.
create index if not exists students_telegram_chat_idx on public.students (telegram_chat_id) where telegram_chat_id is not null;
create index if not exists tutors_telegram_chat_idx on public.tutors (telegram_chat_id) where telegram_chat_id is not null;
create index if not exists class_notifications_pending_idx on public.class_notifications (id) where sent_at is null;

-- 4) Exact-match lookup columns for phone numbers and e-mails (kept up to date by the database itself).
--    The bots and the chat registration use these instead of "ilike" scans, so they stay fast with many people.
alter table public.students
  add column if not exists phone10 text generated always as (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)) stored,
  add column if not exists whatsapp10 text generated always as (right(regexp_replace(coalesce(whatsapp, ''), '\D', '', 'g'), 10)) stored,
  add column if not exists email_lc text generated always as (lower(btrim(coalesce(email, '')))) stored;
create index if not exists students_phone10_idx on public.students (phone10) where phone10 <> '';
create index if not exists students_whatsapp10_idx on public.students (whatsapp10) where whatsapp10 <> '';
create index if not exists students_email_lc_idx on public.students (email_lc);

alter table public.tutors
  add column if not exists mobile10 text generated always as (right(regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g'), 10)) stored,
  add column if not exists whatsapp10 text generated always as (right(regexp_replace(coalesce(whatsapp_number, ''), '\D', '', 'g'), 10)) stored,
  add column if not exists email_lc text generated always as (lower(btrim(coalesce(email, '')))) stored;
create index if not exists tutors_mobile10_idx on public.tutors (mobile10) where mobile10 <> '';
create index if not exists tutors_whatsapp10_idx on public.tutors (whatsapp10) where whatsapp10 <> '';
