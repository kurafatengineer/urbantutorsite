-- =====================================================================
-- SUBSCRIPTIONS
-- One row per recurring (or one-time) billing arrangement the agency
-- has set up with a student or a tutor. Plan name, amount and billing
-- cycle are all free text set by the agency - there is no fixed
-- pricing tier baked into the schema, matching how payments already
-- work (flexible, manually entered).
--
-- Payments can now optionally be tied to a subscription instead of
-- (or in addition to) a tuition, since a subscription's billing isn't
-- always about one specific Demo ID.
-- =====================================================================

create table public.subscriptions (
  id            bigint generated always as identity primary key,
  student_id    text references public.students(student_id),
  tutor_id      text references public.tutors(tutor_id),
  plan_name     text not null,
  amount        numeric not null check (amount > 0),
  billing_cycle text not null default 'monthly',
  start_date    date not null default current_date,
  next_due_date date,
  status        text not null default 'active'
                  check (status in ('active', 'paused', 'cancelled', 'completed')),
  notes         text,
  created_by    uuid references public.admin_users(id),
  created_at    timestamptz not null default now(),

  constraint subscriptions_party_chk check (
    (student_id is not null and tutor_id is null) or
    (tutor_id is not null and student_id is null)
  )
);

create index subscriptions_student_id_idx on public.subscriptions(student_id);
create index subscriptions_tutor_id_idx on public.subscriptions(tutor_id);

alter table public.subscriptions enable row level security;

-- Same lockdown as admin_users / payments: only the "admin" Edge
-- Function's service-role key can write here.
create policy subscriptions_no_access on public.subscriptions
  for all using (false) with check (false);

alter table public.payments
  alter column demo_id drop not null,
  add column subscription_id bigint references public.subscriptions(id);

alter table public.payments
  add constraint payments_target_chk check (demo_id is not null or subscription_id is not null);


-- ---------------------------------------------------------------------
-- Let students and tutors see their OWN payments and subscriptions on
-- their dashboards, the same way they already see their own tuitions /
-- applications: through the existing get_student_profile() /
-- get_tutor_profile() RPCs (SECURITY DEFINER, filtered by auth_email()),
-- not by opening the locked-down tables directly.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_student_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := public.auth_email();
begin
  if v_email = '' then
    raise exception 'Please log in first.';
  end if;

  return jsonb_build_object(
    'success', true,
    'account', (
      select jsonb_build_object('parentsName', s.parents_name, 'email', s.email, 'phone', s.phone)
      from public.students s
      where lower(s.email) = v_email
      order by s.created_at
      limit 1
    ),
    'students', coalesce((
      select jsonb_agg(stu order by stu->>'studentId')
      from (
        select jsonb_build_object(
          'studentId',   s.student_id,
          'studentName', s.student_name,
          'parentsName', s.parents_name,
          'gender',      s.gender,
          'phone',       s.phone,
          'whatsapp',    s.whatsapp,
          'city',        s.city,
          'address',     s.address,
          'pinCode',     s.pin_code,
          'school',      s.school,
          'className',   s.class_name,
          'board',       s.board,
          'tuitions', coalesce((
            select jsonb_agg(tu order by (tu->>'timestampMs')::bigint desc)
            from (
              select
                jsonb_build_object(
                  'demoId',          t.demo_id,
                  'subject',         t.subject,
                  'medium',          t.medium,
                  'preferredTutor',  t.preferred_tutor,
                  'preferredTiming', t.preferred_timing,
                  'postedOn',        to_char(t.posted_at, 'YYYY-MM-DD'),
                  'timestampMs',     (extract(epoch from t.posted_at) * 1000)::bigint,
                  'terminated',      t.terminated,
                  'status',          public.tuition_status(t.demo_id),
                  'tutorsApplied',   (select count(*) from public.applications a
                                      where a.demo_id = t.demo_id
                                        and not a.parent_rejected and not a.tutor_rejected),
                  'declinedCount',   (select count(*) from public.applications a
                                      where a.demo_id = t.demo_id
                                        and (a.parent_rejected or a.tutor_rejected)),
                  'tutors', coalesce((
                    select jsonb_agg(jsonb_build_object(
                      'tutorId',        u.tutor_id,
                      'fullName',       u.full_name,
                      'gender',         u.gender,
                      'degree',         concat_ws(' - ', u.graduation_course, u.graduation_subject),
                      'experience',     u.experience_years,
                      'status',         public.application_status(a, t.terminated),
                      'demoDate',       public._demo_iso(a.demo_date, a.demo_time),
                      'parentAccepted', a.parent_accepted,
                      'parentRejected', a.parent_rejected,
                      'tutorAccepted',  a.tutor_accepted,
                      'tutorRejected',  a.tutor_rejected,
                      -- a tuition is "locked" once another tutor is confirmed
                      'canReject', not t.terminated
                                   and not a.parent_accepted and not a.parent_rejected
                                   and not a.tutor_rejected and not a.classes_completed
                                   and not exists (
                                     select 1 from public.applications o
                                     where o.demo_id = a.demo_id and o.id <> a.id
                                       and o.parent_accepted and o.tutor_accepted
                                       and o.demo_date is not null
                                       and not o.parent_rejected and not o.tutor_rejected),
                      'canAccept', not t.terminated
                                   and a.demo_date is not null
                                   and not a.parent_accepted and not a.parent_rejected
                                   and not a.tutor_rejected and not a.classes_completed
                                   and not exists (
                                     select 1 from public.applications o
                                     where o.demo_id = a.demo_id and o.id <> a.id
                                       and o.parent_accepted and o.tutor_accepted
                                       and o.demo_date is not null
                                       and not o.parent_rejected and not o.tutor_rejected)
                    ) order by a.applied_at)
                    from public.applications a
                    join public.tutors u on u.tutor_id = a.tutor_id
                    where a.demo_id = t.demo_id
                  ), '[]'::jsonb)
                ) as tu
              from public.tuitions t
              where t.student_id = s.student_id
            ) x
          ), '[]'::jsonb)
        ) as stu
        from public.students s
        where lower(s.email) = v_email
      ) y
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',          pm.id,
        'demoId',      pm.demo_id,
        'amount',      pm.amount,
        'paymentType', pm.payment_type,
        'collectedBy', pm.collected_by,
        'paymentMode', pm.payment_mode,
        'paymentDate', pm.payment_date,
        'notes',       pm.notes
      ) order by pm.payment_date desc, pm.id desc)
      from public.payments pm
      join public.tuitions tu on tu.demo_id = pm.demo_id
      join public.students s2 on s2.student_id = tu.student_id
      where lower(s2.email) = v_email
    ), '[]'::jsonb),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',           sub.id,
        'studentId',    sub.student_id,
        'planName',     sub.plan_name,
        'amount',       sub.amount,
        'billingCycle', sub.billing_cycle,
        'startDate',    sub.start_date,
        'nextDueDate',  sub.next_due_date,
        'status',       sub.status,
        'notes',        sub.notes
      ) order by sub.created_at desc)
      from public.subscriptions sub
      join public.students s3 on s3.student_id = sub.student_id
      where lower(s3.email) = v_email
    ), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_tutor_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email    text := public.auth_email();
  u          public.tutors;
  v_verified boolean;
begin
  if v_email = '' then
    raise exception 'Please log in first.';
  end if;

  select * into u from public.tutors where lower(email) = v_email;

  if u.tutor_id is null then
    raise exception 'Tutor profile not found.';
  end if;

  v_verified := u.verification_status = 'Verified';

  return jsonb_build_object(
    'success', true,
    'profile', jsonb_build_object(
      'tutorId',            u.tutor_id,
      'fullName',           u.full_name,
      'email',              u.email,
      'mobile',             u.mobile_number,
      'whatsapp',           u.whatsapp_number,
      'gender',             u.gender,
      'registerAs',         u.register_as,
      'qualification',      concat_ws(' - ', u.graduation_course, u.graduation_subject),
      'graduationCourse',   u.graduation_course,
      'graduationSubject',  u.graduation_subject,
      'experience',         u.experience_years,
      'classesTeach',       u.classes_you_teach,
      'subjectsTeach',      u.subjects_you_teach,
      'boardsTeach',        u.boards_you_teach,
      'location',           u.teaching_location,
      'city',               u.city,
      'address',            u.present_address,
      'pinCode',            u.pin_code,
      'profileImage',       u.profile_image,
      'verificationStatus', u.verification_status,
      'verified',           v_verified
    ),
    'classes', coalesce((
      select jsonb_agg(c order by (c->>'timestampMs')::bigint desc)
      from (
        select jsonb_build_object(
          'demoId',          t.demo_id,
          'timestampMs',     (extract(epoch from a.applied_at) * 1000)::bigint,
          'studentName',     s.student_name,
          'className',       s.class_name,
          'board',           s.board,
          'subject',         t.subject,
          'medium',          t.medium,
          'preferredTutor',  t.preferred_tutor,
          'preferredTiming', t.preferred_timing,
          'city',            s.city,
          'address',         s.address,
          'pinCode',         s.pin_code,
          'demoDate',        public._demo_iso(a.demo_date, a.demo_time),
          'parentAccepted',  a.parent_accepted,
          'parentRejected',  a.parent_rejected,
          'tutorAccepted',   a.tutor_accepted,
          'tutorRejected',   a.tutor_rejected,
          'price',           a.price,
          'duration',        a.duration,
          'terminated',      t.terminated,
          'status',          public.application_status(a, t.terminated),
          'canReject', v_verified and not t.terminated
                       and not a.tutor_accepted and not a.tutor_rejected
                       and not a.parent_rejected and not a.classes_completed,
          'canAccept', v_verified and not t.terminated
                       and a.demo_date is not null
                       and not a.tutor_accepted and not a.tutor_rejected
                       and not a.parent_rejected and not a.classes_completed
                       and not exists (
                         select 1 from public.applications o
                         where o.demo_id = a.demo_id and o.id <> a.id
                           and o.parent_accepted and o.tutor_accepted
                           and o.demo_date is not null
                           and not o.parent_rejected and not o.tutor_rejected)
        ) as c
        from public.applications a
        join public.tuitions t on t.demo_id = a.demo_id
        join public.students s on s.student_id = t.student_id
        where a.tutor_id = u.tutor_id
      ) x
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',           pm.id,
        'demoId',       pm.demo_id,
        'amount',       pm.amount,
        'paymentType',  pm.payment_type,
        'collectedBy',  pm.collected_by,
        'ourCutAmount', pm.our_cut_amount,
        'paymentMode',  pm.payment_mode,
        'paymentDate',  pm.payment_date,
        'notes',        pm.notes
      ) order by pm.payment_date desc, pm.id desc)
      from public.payments pm
      where pm.tutor_id = u.tutor_id
    ), '[]'::jsonb),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',           sub.id,
        'planName',     sub.plan_name,
        'amount',       sub.amount,
        'billingCycle', sub.billing_cycle,
        'startDate',    sub.start_date,
        'nextDueDate',  sub.next_due_date,
        'status',       sub.status,
        'notes',        sub.notes
      ) order by sub.created_at desc)
      from public.subscriptions sub
      where sub.tutor_id = u.tutor_id
    ), '[]'::jsonb)
  );
end;
$function$;
