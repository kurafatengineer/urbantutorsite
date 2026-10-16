-- Employees get a Mobile Number and a WhatsApp Number (10 digits, no +91).
-- The WhatsApp bot uses them to recognise an employee who writes to it, so no two employees may share a
-- number in the same column. mobile10 / whatsapp10 are the same last-10-digits helpers students and tutors have.

alter table public.admin_users
  add column if not exists mobile_number   text,
  add column if not exists whatsapp_number text,
  add column if not exists mobile10   text generated always as (right(regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g'), 10)) stored,
  add column if not exists whatsapp10 text generated always as (right(regexp_replace(coalesce(whatsapp_number, ''), '\D', '', 'g'), 10)) stored;

create unique index if not exists admin_users_mobile10_key   on public.admin_users (mobile10)   where mobile10 <> '';
create unique index if not exists admin_users_whatsapp10_key on public.admin_users (whatsapp10) where whatsapp10 <> '';
