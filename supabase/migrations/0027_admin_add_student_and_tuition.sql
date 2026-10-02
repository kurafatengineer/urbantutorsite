-- Office staff can register a student and post a tuition request FOR them
-- (no OTP - the student has not logged in). These are the same rules as the
-- student's own register_student / add_tuition, except:
--   * the student's email comes from the form (p->>'email') instead of the login
--   * tuition subjects are optional when only "Add a Student" is used
--   * the student does not have to be "on the caller's account"
-- Only the server (service_role, used by the Edge Function "admin" after it has
-- checked the employee's permission) may run them - never the browser.

create or replace function public.admin_register_student(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email    text := lower(btrim(coalesce(p->>'email', '')));
  v_id       text;
  v_phone    text := public._mobile(p->>'phone');
  v_whatsapp text := coalesce(public._mobile(p->>'whatsapp'), public._mobile(p->>'phone'));
  v_subject  text;
  v_demo     text;
  v_demos    text[] := '{}';
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address.'; end if;
  if public._clean(p->>'parentsName') is null then raise exception 'Parents Name is required.'; end if;
  if public._clean(p->>'studentName') is null then raise exception 'Student Name is required.'; end if;
  if v_phone is null then raise exception 'Enter a valid 10-digit mobile number.'; end if;
  if coalesce(p->>'gender', '') not in ('Male', 'Female') then raise exception 'Select the student''s gender.'; end if;
  if public._clean(p->>'className') is null then raise exception 'Class is required.'; end if;

  -- a requirement was started (subjects given) -> it needs a timing, like on the website
  if public._clean(p->>'subjects') is not null and public._clean(p->>'preferredTiming') is null then
    raise exception 'Select at least one preferred timing.';
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

  -- every new student starts with the yearly student subscription, same as on the website
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
$$;

create or replace function public.admin_add_tuition(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student  text := public._clean(p->>'studentId');
  v_subject  text;
  v_demo     text;
  v_demos    text[] := '{}';
  v_repeated text[];
begin
  if v_student is null or not exists (select 1 from public.students where student_id = v_student) then
    raise exception 'Choose a student from the list.';
  end if;

  if public._clean(p->>'preferredTiming') is null then
    raise exception 'Select at least one preferred timing.';
  end if;

  -- one at a time per student, so two taps can't create duplicates
  perform pg_advisory_xact_lock(hashtext(v_student));

  -- refuse a subject that already has a live (not finished) request
  select array_agg(x) into v_repeated
  from (
    select distinct initcap(btrim(x)) as x
    from unnest(string_to_array(coalesce(p->>'subjects', ''), ',')) as x
    where btrim(x) <> ''
  ) wanted
  where exists (
    select 1 from public.tuitions t
    where t.student_id = v_student
      and lower(t.subject) = lower(wanted.x)
      and public.tuition_status(t.demo_id) not in ('Completed', 'Terminated')
  );

  if v_repeated is not null then
    raise exception 'This student already has a running request for %.', array_to_string(v_repeated, ', ');
  end if;

  for v_subject in
    select distinct initcap(btrim(x))
    from unnest(string_to_array(coalesce(p->>'subjects', ''), ',')) as x
    where btrim(x) <> ''
  loop
    v_demo := public.generate_demo_id(v_student);
    insert into public.tuitions (demo_id, student_id, subject, preferred_tutor, medium, preferred_timing)
    values (
      v_demo, v_student, v_subject,
      coalesce(nullif(p->>'preferredTutor', ''), 'Any'),
      coalesce(nullif(p->>'medium', ''), 'Any'),
      public._clean(p->>'preferredTiming')
    );
    v_demos := v_demos || v_demo;
  end loop;

  if cardinality(v_demos) = 0 then
    raise exception 'Enter at least one subject.';
  end if;

  return jsonb_build_object('success', true, 'demoIds', to_jsonb(v_demos),
    'message', case when cardinality(v_demos) = 1 then 'Tuition request posted.'
                    else cardinality(v_demos) || ' tuition requests posted.' end);
end;
$$;

revoke all on function public.admin_register_student(jsonb) from public, anon, authenticated;
revoke all on function public.admin_add_tuition(jsonb) from public, anon, authenticated;
grant execute on function public.admin_register_student(jsonb) to service_role;
grant execute on function public.admin_add_tuition(jsonb) to service_role;
