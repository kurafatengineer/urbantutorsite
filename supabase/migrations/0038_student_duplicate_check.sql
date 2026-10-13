-- Add a Student (Admin Panel): the same student added twice is refused.
-- Same mobile number + same email + same student name (ignoring case and
-- extra spaces) as a student already on file = a duplicate. A brother /
-- sister on the same number and email (a different name) is fine.

create or replace function public.admin_register_student(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_email    text := lower(btrim(coalesce(p->>'email', '')));
  v_id       text;
  v_phone    text := public._mobile(p->>'phone');
  v_whatsapp text := coalesce(public._mobile(p->>'whatsapp'), public._mobile(p->>'phone'));
  v_subject  text;
  v_demo     text;
  v_demos    text[] := '{}';
  v_dup      text;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address.'; end if;
  if public._clean(p->>'parentsName') is null then raise exception 'Parents Name is required.'; end if;
  if public._clean(p->>'studentName') is null then raise exception 'Student Name is required.'; end if;
  if v_phone is null then raise exception 'Enter a valid 10-digit mobile number.'; end if;
  if coalesce(p->>'gender', '') not in ('Male', 'Female') then raise exception 'Select the student''s gender.'; end if;
  if public._clean(p->>'className') is null then raise exception 'Class is required.'; end if;

  if public._clean(p->>'subjects') is not null and public._clean(p->>'preferredTiming') is null then
    raise exception 'Select at least one preferred timing.';
  end if;

  select s.student_id into v_dup
  from public.students s
  where public._mobile(s.phone) = v_phone
    and lower(btrim(coalesce(s.email, ''))) = v_email
    and lower(regexp_replace(btrim(coalesce(s.student_name, '')), '\s+', ' ', 'g'))
        = lower(regexp_replace(btrim(coalesce(p->>'studentName', '')), '\s+', ' ', 'g'))
  limit 1;
  if v_dup is not null then
    raise exception 'This student already exists (%) - same name, mobile number and email.', v_dup;
  end if;

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
