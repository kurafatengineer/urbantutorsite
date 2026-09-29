-- =====================================================================
-- Every student and every tutor must take a subscription - nobody is
-- meant to be left without one. Rather than rely on the admin to
-- remember to add it by hand, register_student()/register_tutor() now
-- create it automatically (unpaid, ₹500/year for a student, ₹1000/year
-- for a tutor) the moment the account itself is created. The admin
-- panel's pay-status badge then shows red until a payment is recorded
-- against it (see 0009 and the "admin" Edge Function's
-- alignSubscriptionToFirstPayment, which pulls the 1-year period to
-- start from that first payment's date).
--
-- These two functions weren't tracked in this migrations folder
-- before (they predate it); this reproduces their live definitions in
-- full and adds the one insert each.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.register_tutor(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email  text := public.auth_email();
  v_id     text;
  v_mobile text := public._mobile(p->>'mobileNumber');
begin
  if v_email = '' then
    raise exception 'Please log in first.';
  end if;

  if exists (select 1 from public.tutors where lower(email) = v_email) then
    raise exception 'A tutor is already registered with this e-mail.';
  end if;

  if public._clean(p->>'fullName') is null then raise exception 'Full Name is required.'; end if;
  if v_mobile is null then raise exception 'Enter a valid 10-digit mobile number.'; end if;
  if coalesce(p->>'gender', '') not in ('Male', 'Female') then raise exception 'Select your gender.'; end if;
  if not coalesce((p->>'termsAccepted')::boolean, false) then raise exception 'Please accept the Terms & Conditions.'; end if;

  if exists (select 1 from public.tutors where mobile_number = v_mobile) then
    raise exception 'This mobile number is already registered.';
  end if;

  v_id := public.generate_tutor_id();

  insert into public.tutors (
    tutor_id, email, mobile_number, whatsapp_number, register_as, full_name,
    birth_date, gender, languages_known,
    class12_stream, class12_passing_year, class12_percentage, class12_cgpa, class12_board,
    graduation_course, graduation_subject, graduation_college,
    graduation_passing_year, graduation_percentage,
    pg_subject, pg_college, pg_passing_year, pg_percentage,
    special_courses, special_child_disability, experience_years,
    classes_you_teach, subjects_you_teach, boards_you_teach,
    teaching_location, city, present_address, pin_code,
    terms_accepted, email_verified, verification_status
  ) values (
    v_id, v_email, v_mobile,
    coalesce(public._mobile(p->>'whatsappNumber'), v_mobile),
    public._clean(p->>'registerAs'),
    public._clean(p->>'fullName'),
    public._date(p->>'birthDate'),
    p->>'gender',
    public._clean(p->>'languagesKnown'),
    public._clean(p->>'class12Stream'),
    public._num(p->>'class12PassingYear')::int,
    public._num(p->>'class12Percentage'),
    public._num(p->>'class12Cgpa'),
    public._clean(p->>'class12Board'),
    public._clean(p->>'graduationCourse'),
    public._clean(p->>'graduationSubject'),
    public._clean(p->>'graduationCollege'),
    public._num(p->>'graduationPassingYear')::int,
    public._num(p->>'graduationPercentage'),
    public._clean(p->>'pgSubject'),
    public._clean(p->>'pgCollege'),
    public._num(p->>'pgPassingYear')::int,
    public._num(p->>'pgPercentage'),
    public._clean(p->>'specialCourses'),
    public._clean(p->>'specialChildDisability'),
    public._num(p->>'experienceYears'),
    public._clean(p->>'classesYouTeach'),
    public._clean(p->>'subjectsYouTeach'),
    public._clean(p->>'boardsYouTeach'),
    public._clean(p->>'teachingLocation'),
    public._clean(p->>'city'),
    public._clean(p->>'presentAddress'),
    public._clean(p->>'pinCode'),
    true,
    true,                          -- they just verified the e-mail code
    'Pending for Verification'
  );

  insert into public.subscriptions (tutor_id, plan_name, amount, billing_cycle, start_date, status)
  values (v_id, 'Tutor Yearly Subscription', 1000, 'Yearly', current_date, 'active');

  return jsonb_build_object('success', true, 'tutorId', v_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.register_student(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email    text := public.auth_email();
  v_id       text;
  v_phone    text := public._mobile(p->>'phone');
  v_whatsapp text := coalesce(public._mobile(p->>'whatsapp'), public._mobile(p->>'phone'));
  v_subject  text;
  v_demo     text;
  v_demos    text[] := '{}';
begin
  if v_email = '' then
    raise exception 'Please log in first.';
  end if;

  if public._clean(p->>'parentsName') is null then raise exception 'Parents Name is required.'; end if;
  if public._clean(p->>'studentName') is null then raise exception 'Student Name is required.'; end if;
  if v_phone is null then raise exception 'Enter a valid 10-digit mobile number.'; end if;
  if coalesce(p->>'gender', '') not in ('Male', 'Female') then raise exception 'Select the student''s gender.'; end if;
  if public._clean(p->>'className') is null then raise exception 'Class is required.'; end if;

  v_id := public.generate_student_id();

  insert into public.students (
    student_id, parents_name, student_name, phone, whatsapp, email, gender,
    city, address, pin_code, terms_accepted, school, class_name, board
  ) values (
    v_id,
    public._clean(p->>'parentsName'),
    public._clean(p->>'studentName'),
    v_phone,
    v_whatsapp,
    v_email,
    p->>'gender',
    public._clean(p->>'city'),
    public._clean(p->>'address'),
    public._clean(p->>'pinCode'),
    coalesce((p->>'termsAccepted')::boolean, false),
    public._clean(p->>'school'),
    public._clean(p->>'className'),
    public._clean(p->>'board')
  );

  insert into public.subscriptions (student_id, plan_name, amount, billing_cycle, start_date, status)
  values (v_id, 'Student Yearly Subscription', 500, 'Yearly', current_date, 'active');

  -- one tuition request per subject (none for "Add a Student")
  for v_subject in
    select distinct initcap(btrim(x))
    from unnest(string_to_array(coalesce(p->>'subjects', ''), ',')) as x
    where btrim(x) <> ''
  loop
    v_demo := public.generate_demo_id(v_id);
    insert into public.tuitions (demo_id, student_id, subject, preferred_tutor, medium, preferred_timing)
    values (
      v_demo, v_id, v_subject,
      coalesce(nullif(p->>'preferredTutor', ''), 'Any'),
      coalesce(nullif(p->>'medium', ''), 'Any'),
      public._clean(p->>'preferredTiming')
    );
    v_demos := v_demos || v_demo;
  end loop;

  return jsonb_build_object('success', true, 'studentId', v_id, 'demoIds', to_jsonb(v_demos));
end;
$function$;
