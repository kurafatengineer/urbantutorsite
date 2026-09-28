-- =====================================================================
-- ADMIN EMPLOYEES (RBAC) + PAYMENTS
-- Both tables are reachable only through the "admin" Edge Function's
-- service-role key, same pattern as admin_failed_logins: RLS denies
-- every direct client request.
-- =====================================================================

create table public.admin_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text not null,
  role        text not null check (role in (
                'super_admin', 'tuition_coordinator', 'verification_staff',
                'accounts_finance', 'tutor_relations'
              )),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create policy admin_users_no_access on public.admin_users
  for all using (false) with check (false);

create table public.payments (
  id               bigint generated always as identity primary key,
  demo_id          text not null references public.tuitions(demo_id),
  tutor_id         text references public.tutors(tutor_id),
  amount           numeric not null check (amount > 0),
  payment_type     text not null default 'regular'
                     check (payment_type in ('advance', 'regular', 'final')),
  collected_by     text not null default 'agency'
                     check (collected_by in ('agency', 'tutor')),
  our_cut_amount   numeric check (our_cut_amount is null or our_cut_amount >= 0),
  payment_mode     text not null,
  payment_date     date not null default current_date,
  notes            text,
  recorded_by      uuid references public.admin_users(id),
  created_at       timestamptz not null default now()
);

create index payments_demo_id_idx on public.payments(demo_id);
create index payments_tutor_id_idx on public.payments(tutor_id);

alter table public.payments enable row level security;

create policy payments_no_access on public.payments
  for all using (false) with check (false);
