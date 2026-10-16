-- A tutor can only apply for a tuition whose preferred tutor ("Male" / "Female") matches the tutor's gender.
-- "Any" (or "Both") accepts everyone. The check lives in apply_for_tuition, so the website, the chat bots and
-- the admin all follow it; get_available_tuitions now also tells the page the logged-in tutor's gender, so the
-- Apply button can show "Not Applicable" up front instead of failing after the click.

create or replace function public.apply_for_tuition(p_demo_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email  text := public.auth_email();
  v_tutor  public.tutors;
  v_status text;
  v_pref   text;
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

  select initcap(trim(coalesce(preferred_tutor, ''))) into v_pref from public.tuitions where demo_id = p_demo_id;
  if v_pref in ('Male', 'Female') and initcap(trim(coalesce(v_tutor.gender, ''))) <> v_pref then
    return jsonb_build_object('success', false, 'genderMismatch', true, 'needed', v_pref,
      'message', 'This tuition is only for ' || lower(v_pref) || ' tutors.');
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
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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
    'tutorGender', case when v_tutor.tutor_id is not null then initcap(trim(coalesce(v_tutor.gender, ''))) end,
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
