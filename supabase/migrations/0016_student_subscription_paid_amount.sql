-- =====================================================================
-- STUDENT PROFILE: expose how much of each subscription has been paid
--
-- The Student Profile page shows a "verified" badge on the student's
-- avatar, coloured the same way the Admin Panel colours a subscription:
--   fully paid / exempted  -> green
--   partially paid         -> orange
--   nothing paid           -> red
-- That needs the amount actually collected against each subscription,
-- which get_student_profile() didn't send before - only the amount due.
-- =====================================================================

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
        and pm.transaction_type = 'collection'
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
        'notes',        sub.notes,
        -- Money actually collected against this subscription (never
        -- a payout, which is always demo-linked, not subscription-linked).
        'paidAmount',   coalesce((
          select sum(pm.amount)
          from public.payments pm
          where pm.subscription_id = sub.id
            and pm.transaction_type = 'collection'
        ), 0)
      ) order by sub.created_at desc)
      from public.subscriptions sub
      join public.students s3 on s3.student_id = sub.student_id
      where lower(s3.email) = v_email
    ), '[]'::jsonb)
  );
end;
$function$;
