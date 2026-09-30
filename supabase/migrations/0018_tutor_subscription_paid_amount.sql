-- =====================================================================
-- TUTOR PROFILE: expose how much of each subscription has been paid,
-- so the profile's verified badge can be coloured like the Admin
-- Panel's (green fully paid, orange partial, red nothing paid).
-- =====================================================================

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
        'id',              pm.id,
        'demoId',          pm.demo_id,
        'amount',          pm.amount,
        'paymentType',     pm.payment_type,
        'transactionType', pm.transaction_type,
        'collectedBy',     pm.collected_by,
        'ourCutAmount',    pm.our_cut_amount,
        'paymentMode',     pm.payment_mode,
        'paymentDate',     pm.payment_date,
        'notes',           pm.notes
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
        'notes',        sub.notes,
        'paidAmount',   coalesce((
          select sum(pm.amount)
          from public.payments pm
          where pm.subscription_id = sub.id
            and pm.transaction_type = 'collection'
        ), 0)
      ) order by sub.created_at desc)
      from public.subscriptions sub
      where sub.tutor_id = u.tutor_id
    ), '[]'::jsonb)
  );
end;
$function$;
