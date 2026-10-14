-- Tutors: Block + notification switch (Tutors tab icons), the same as for students.
--   blocked_at         - set = the tutor is blocked. Nothing is erased. A blocked tutor can only
--                        open their page: they can't apply, accept / reject a demo, or mark classes,
--                        they get no notification, and their details can't be edited.
--   notifications_off  - the office switched this tutor's notifications off.

alter table public.tutors add column if not exists blocked_at timestamptz;
alter table public.tutors add column if not exists notifications_off boolean not null default false;

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

  if v_tutor.blocked_at is not null then
    raise exception 'Your account is blocked. Please contact Urban Tutor Site.';
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

create or replace function public.respond_to_demo_tutor(p_demo_id text, p_decision text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_email text := public.auth_email();
  v_tutor public.tutors;
  a       public.applications;
  v_term  boolean;
begin
  if v_email = '' then
    raise exception 'Please log in first.';
  end if;

  select * into v_tutor from public.tutors where lower(email) = v_email;

  if v_tutor.tutor_id is null then
    raise exception 'Tutor profile not found.';
  end if;

  if v_tutor.blocked_at is not null then
    raise exception 'Your account is blocked. Please contact Urban Tutor Site.';
  end if;

  if v_tutor.verification_status <> 'Verified' then
    raise exception 'Your profile must be verified first.';
  end if;

  select * into a from public.applications
  where demo_id = p_demo_id and tutor_id = v_tutor.tutor_id
  for update;

  if a.id is null then
    raise exception 'You have not applied for this tuition.';
  end if;

  select terminated into v_term from public.tuitions where demo_id = p_demo_id;

  if v_term or a.tutor_accepted or a.tutor_rejected
     or a.parent_rejected or a.classes_completed then
    raise exception 'This can no longer be changed.';
  end if;

  if lower(p_decision) = 'accept' then

    if a.demo_date is null then
      raise exception 'You can accept once the demo class is scheduled.';
    end if;

    if public._tuition_locked(p_demo_id, a.id) then
      raise exception 'Another tutor has already been confirmed for this tuition.';
    end if;

    update public.applications set tutor_accepted = true where id = a.id;
    perform public._apply_auto_rejections(p_demo_id);

    return jsonb_build_object('success', true, 'message', 'Tuition accepted.');

  elsif lower(p_decision) = 'reject' then

    update public.applications set tutor_rejected = true where id = a.id;
    return jsonb_build_object('success', true, 'message', 'Tuition rejected.');

  end if;

  raise exception 'Unknown choice.';
end;
$function$;
