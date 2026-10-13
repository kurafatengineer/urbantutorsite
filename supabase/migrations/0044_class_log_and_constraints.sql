-- Per-day class log (calendar ticks / crosses) and the billing check fixes.
-- Applied to the project as the migrations class_log_and_constraint_fix,
-- class_log_calendar and class_day_admin.
--
--   applications.class_log   jsonb  { "YYYY-MM-DD": { s: done|missed, by: tutor|admin, at, m: minutes, t: "HH:MM" } }
--   Class Count              = the days marked done (trigger below)
--   tutor_mark_class         = a tutor marks a scheduled day done / undone (on the day or after)
--   admin_set_class_day      = the office corrects one day (status, minutes, time); service_role only
--
-- Also applied in the same migrations (kept in the database, not repeated here):
--   * admin_update_demo_row: handles 'Class Log' and prunes the log to the new 'Class Dates'
--   * admin_get_overview / get_tutor_profile wrapped (originals renamed _admin_get_overview_base /
--     _get_tutor_profile_base and closed to every caller) to add classLog (+ classDates, classMinutes,
--     classTime for the tutor)

alter table public.applications add column if not exists class_log jsonb not null default '{}'::jsonb;

alter table public.applications drop constraint if exists applications_billing_mode_check;
alter table public.applications add constraint applications_billing_mode_check
  check (billing_mode is null or billing_mode in ('classes', 'hourly', 'commission', 'margin'));

alter table public.applications drop constraint if exists applications_student_payment_frequency_check;
alter table public.applications add constraint applications_student_payment_frequency_check
  check (student_payment_frequency is null or student_payment_frequency in ('Weekly', '15 Days', 'Monthly'));

alter table public.applications drop constraint if exists applications_tutor_payment_frequency_check;
alter table public.applications add constraint applications_tutor_payment_frequency_check
  check (tutor_payment_frequency is null or tutor_payment_frequency in ('Weekly', '15 Days', 'Monthly'));

create or replace function public._apps_class_count()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if new.class_log is distinct from old.class_log then
    new.class_count := (select count(*) from jsonb_each(new.class_log) e where e.value->>'s' = 'done')::int;
  end if;
  return new;
end;
$function$;

drop trigger if exists applications_class_count on public.applications;
create trigger applications_class_count before update on public.applications
  for each row execute function public._apps_class_count();

create or replace function public.tutor_mark_class(p_demo_id text, p_date date, p_done boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_email text := public.auth_email();
  v_tutor text;
  a       public.applications;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_entry jsonb;
  v_next  jsonb;
begin
  if v_email = '' then raise exception 'Please log in first.'; end if;

  select tutor_id into v_tutor from public.tutors where lower(email) = v_email;
  if v_tutor is null then raise exception 'Please register as a tutor first.'; end if;

  select * into a from public.applications where demo_id = p_demo_id and tutor_id = v_tutor for update;
  if a.id is null then raise exception 'That tuition is not on your account.'; end if;

  if not (a.parent_accepted and a.tutor_accepted) or a.parent_rejected or a.tutor_rejected or a.classes_completed
     or exists (select 1 from public.tuitions t where t.demo_id = p_demo_id and t.terminated) then
    raise exception 'This class is not running.';
  end if;

  if a.class_dates is null or not (p_date = any (a.class_dates)) then
    raise exception 'That date is not on the class schedule.';
  end if;

  if p_date > v_today then raise exception 'You can mark a class on its day or after it.'; end if;

  v_entry := coalesce(a.class_log -> p_date::text, '{}'::jsonb);
  if v_entry->>'by' = 'admin' and v_entry ? 's' then
    raise exception 'The office has already set this day. Please contact Urban Tutor Site to change it.';
  end if;

  v_entry := v_entry - 's' - 'by' - 'at';
  if p_done then
    v_entry := v_entry || jsonb_build_object('s', 'done', 'by', 'tutor', 'at', now());
  end if;

  v_next := case when v_entry = '{}'::jsonb then a.class_log - p_date::text
                 else a.class_log || jsonb_build_object(p_date::text, v_entry) end;

  update public.applications set class_log = v_next where id = a.id;

  return jsonb_build_object('success', true,
    'message', case when p_done then 'Class marked done.' else 'Mark removed.' end);
end;
$function$;
revoke execute on function public.tutor_mark_class(text, date, boolean) from public, anon;
grant execute on function public.tutor_mark_class(text, date, boolean) to authenticated;

create or replace function public.admin_set_class_day(p_demo_id text, p_tutor_id text, p_date date, p_entry jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  e     jsonb := coalesce(p_entry, '{}'::jsonb);
  clean jsonb := '{}'::jsonb;
  v_min int;
begin
  if e->>'s' in ('done', 'missed') then
    clean := clean || jsonb_build_object('s', e->>'s', 'by', coalesce(nullif(e->>'by', ''), 'admin'));
    if e->>'at' is not null then clean := clean || jsonb_build_object('at', e->>'at'); end if;
  end if;

  if e->>'m' ~ '^\d{1,3}$' then
    v_min := (e->>'m')::int;
    if v_min between 1 and 600 then clean := clean || jsonb_build_object('m', v_min); end if;
  end if;

  if e->>'t' ~ '^([01]\d|2[0-3]):[0-5]\d$' then
    clean := clean || jsonb_build_object('t', e->>'t');
  end if;

  update public.applications a set
    class_log = case when clean = '{}'::jsonb then a.class_log - p_date::text
                     else a.class_log || jsonb_build_object(p_date::text, clean) end
  where a.demo_id = p_demo_id and a.tutor_id = p_tutor_id and p_date = any (a.class_dates);

  if not found then raise exception 'That class day was not found. Refresh and try again.'; end if;

  return jsonb_build_object('success', true, 'message', 'Class day saved.');
end;
$function$;
revoke execute on function public.admin_set_class_day(text, text, date, jsonb) from public, anon, authenticated;
grant execute on function public.admin_set_class_day(text, text, date, jsonb) to service_role;
