-- Students: Block + notification switch (Students tab icons).
--   blocked_at         - set = the student is blocked. Nothing is erased. A blocked
--                        student can only open their page: they can't post tuitions or
--                        answer tutors, their open tuitions are hidden from tutors,
--                        they can't be edited, and no notification goes to them.
--   notifications_off  - the office switched this student's notifications off.
-- (blocked_at is the short-lived Trash column deleted_at, renamed - it was never used.)

alter table public.students rename column deleted_at to blocked_at;
alter table public.students add column if not exists notifications_off boolean not null default false;

create or replace function public.add_tuition(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_email    text := public.auth_email();
  v_student  text := public._clean(p->>'studentId');
  v_subject  text;
  v_demo     text;
  v_demos    text[] := '{}';
  v_repeated text[];
begin
  if v_email = '' then
    raise exception 'Please log in first.';
  end if;

  if not exists (select 1 from public.students
                 where student_id = v_student and lower(email) = v_email) then
    raise exception 'That student is not on your account.';
  end if;

  if exists (select 1 from public.students where student_id = v_student and blocked_at is not null) then
    raise exception 'Your account is blocked. Please contact Urban Tutor Site.';
  end if;

  if public._clean(p->>'preferredTiming') is null then
    raise exception 'Select at least one preferred timing.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_student));

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
    raise exception 'You already have a running request for %.', array_to_string(v_repeated, ', ');
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

  return jsonb_build_object(
    'success', true,
    'demoIds', to_jsonb(v_demos),
    'message', case when cardinality(v_demos) = 1
                    then 'Your tuition request has been posted.'
                    else cardinality(v_demos) || ' tuition requests have been posted.' end
  );
end;
$function$;

create or replace function public.admin_add_tuition(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
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

  if exists (select 1 from public.students where student_id = v_student and blocked_at is not null) then
    raise exception 'This student is blocked. Unblock them first.';
  end if;

  if public._clean(p->>'preferredTiming') is null then
    raise exception 'Select at least one preferred timing.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_student));

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
$function$;

create or replace function public.respond_to_demo(p_demo_id text, p_tutor_id text, p_decision text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_email text := public.auth_email();
  a       public.applications;
  t       public.tuitions;
begin
  if v_email = '' then
    raise exception 'Please log in first.';
  end if;

  select tu.* into t
  from public.tuitions tu
  join public.students s on s.student_id = tu.student_id
  where tu.demo_id = p_demo_id and lower(s.email) = v_email;

  if t.demo_id is null then
    raise exception 'That tuition is not on your account.';
  end if;

  if exists (select 1 from public.students where student_id = t.student_id and blocked_at is not null) then
    raise exception 'Your account is blocked. Please contact Urban Tutor Site.';
  end if;

  select * into a from public.applications
  where demo_id = p_demo_id and tutor_id = p_tutor_id
  for update;

  if a.id is null then
    raise exception 'That tutor has not applied for this tuition.';
  end if;

  if t.terminated or a.parent_accepted or a.parent_rejected
     or a.tutor_rejected or a.classes_completed
     or public._tuition_locked(p_demo_id, a.id) then
    raise exception 'This can no longer be changed.';
  end if;

  if lower(p_decision) = 'accept' then

    if a.demo_date is null then
      raise exception 'You can accept once the demo class is scheduled.';
    end if;

    update public.applications set parent_accepted = true where id = a.id;
    perform public._apply_auto_rejections(p_demo_id);

    return jsonb_build_object('success', true, 'message', 'Tutor accepted.');

  elsif lower(p_decision) = 'reject' then

    update public.applications set parent_rejected = true where id = a.id;
    return jsonb_build_object('success', true, 'message', 'Tutor rejected.');

  end if;

  raise exception 'Unknown choice.';
end;
$function$;

create or replace function public.apply_for_tuition(p_demo_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_email  text := public.auth_email();
  v_tutor  public.tutors;
  v_status text;
begin
  if v_email = '' then
    raise exception 'Please log in first.';
  end if;

  select * into v_tutor from public.tutors where lower(email) = v_email;

  if v_tutor.tutor_id is null then
    raise exception 'Please register as a tutor first.';
  end if;

  if v_tutor.verification_status <> 'Verified' then
    return jsonb_build_object('success', false, 'notVerified', true,
      'message', 'Your profile is being verified. You can apply once it is verified.');
  end if;

  if not exists (select 1 from public.tuitions t
                 join public.students s on s.student_id = t.student_id
                 where t.demo_id = p_demo_id and not t.terminated and s.blocked_at is null) then
    raise exception 'This tuition is no longer available.';
  end if;

  v_status := public.tuition_status(p_demo_id);

  if v_status not in ('Finding Tutor', 'Tutors Applied', 'Demo Scheduled') then
    raise exception 'This tuition is no longer available.';
  end if;

  if exists (select 1 from public.applications
             where demo_id = p_demo_id and tutor_id = v_tutor.tutor_id) then
    return jsonb_build_object('success', true, 'alreadyApplied', true,
      'message', 'You have already applied for this tuition.');
  end if;

  insert into public.applications (demo_id, tutor_id)
  values (p_demo_id, v_tutor.tutor_id);

  return jsonb_build_object('success', true,
    'message', 'Applied successfully. We will contact you soon.');
end;
$function$;

create or replace function public.get_available_tuitions()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_email    text := public.auth_email();
  v_tutor    public.tutors;
  v_verified boolean := false;
begin
  if v_email <> '' then
    select * into v_tutor from public.tutors where lower(email) = v_email;
    v_verified := coalesce(v_tutor.verification_status = 'Verified', false);
  end if;

  return jsonb_build_object(
    'success', true,
    'tutorVerified', v_verified,
    'loggedInTutor', v_tutor.tutor_id is not null,
    'appliedDemoIds', coalesce((
      select jsonb_agg(a.demo_id)
      from public.applications a
      where v_tutor.tutor_id is not null and a.tutor_id = v_tutor.tutor_id
    ), '[]'::jsonb),
    'tuitions', coalesce((
      select jsonb_agg(x.j order by x.posted_at desc)
      from (
        select
          t.posted_at,
          jsonb_build_object(
            'demoId',          t.demo_id,
            'className',       s.class_name,
            'board',           s.board,
            'subject',         t.subject,
            'medium',          t.medium,
            'preferredTutor',  t.preferred_tutor,
            'preferredTiming', t.preferred_timing,
            'city',            s.city,
            'pinCode',         s.pin_code,
            'address',         '',
            'postedOn',        to_char(t.posted_at, 'YYYY-MM-DD'),
            'tutorsApplied',   (select count(*) from public.applications a
                                where a.demo_id = t.demo_id
                                  and not a.parent_rejected and not a.tutor_rejected),
            'applied',         exists (select 1 from public.applications a
                                       where a.demo_id = t.demo_id
                                         and a.tutor_id = v_tutor.tutor_id)
          ) as j
        from public.tuitions t
        join public.students s on s.student_id = t.student_id
        where not t.terminated
          and s.blocked_at is null
          and public.tuition_status(t.demo_id) in ('Finding Tutor', 'Tutors Applied', 'Demo Scheduled')
      ) x
    ), '[]'::jsonb)
  );
end;
$function$;

-- The student's own page: the same data, plus whether each student is blocked.
-- The original function is kept (renamed) and closed to every caller, so it
-- can't be used to skip the blocked flag.
alter function public.get_student_profile() rename to _get_student_profile_base;
revoke execute on function public._get_student_profile_base() from public, anon, authenticated;

create function public.get_student_profile()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare r jsonb;
begin
  r := public._get_student_profile_base();
  return jsonb_set(r, '{students}', coalesce((
    select jsonb_agg(s || jsonb_build_object('blocked', exists (
             select 1 from public.students x where x.student_id = s->>'studentId' and x.blocked_at is not null))
           order by s->>'studentId')
    from jsonb_array_elements(r->'students') s
  ), '[]'::jsonb));
end;
$function$;
revoke execute on function public.get_student_profile() from public, anon;
grant execute on function public.get_student_profile() to authenticated, service_role;
