-- Class reminders + "did you take today's class?" (queue filled by pg_cron every minute, sent by the
-- telegram edge function's ?run=1, which also marks the day done when the tutor taps Yes).
--   reminder : 15 minutes before the class, to the tutor AND the student ("You have class today ...")
--   confirm  : when the class should have ended and nobody has marked the day, to the tutor only
create table if not exists public.class_notifications (
  id          bigserial primary key,
  kind        text not null check (kind in ('reminder', 'confirm')),
  audience    text not null check (audience in ('tutor', 'student')),
  demo_id     text not null,
  tutor_id    text not null,
  class_date  date not null,
  class_time  text,
  minutes     int,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  unique (kind, audience, demo_id, tutor_id, class_date)
);
alter table public.class_notifications enable row level security;

create or replace function public.enqueue_class_notifications()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  v_now   timestamp := now() at time zone 'Asia/Kolkata';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  r       record;
  v_time  text;
  v_min   int;
  v_start timestamp;
  v_n     int := 0;
  v_got   int;
begin
  for r in
    select a.demo_id, a.tutor_id, a.class_log, a.billing_plan
      from public.applications a
      join public.tuitions t on t.demo_id = a.demo_id
     where a.parent_accepted and a.tutor_accepted and not a.parent_rejected and not a.tutor_rejected
       and not coalesce(a.classes_completed, false) and not t.terminated
       and a.class_dates is not null and v_today = any (a.class_dates)
  loop
    if r.class_log -> v_today::text ->> 's' = 'missed' then continue; end if;
    v_time := nullif(coalesce(r.class_log -> v_today::text ->> 't', r.billing_plan -> 'deal' ->> 'time'), '');
    if v_time is null or v_time !~ '^\d{1,2}:\d{2}' then continue; end if;
    v_min := coalesce(nullif(r.class_log -> v_today::text ->> 'm', '')::int,
                      nullif(r.billing_plan -> 'deal' ->> 'minutes', '')::int, 60);
    v_start := v_today + v_time::time;

    if v_now >= v_start - interval '15 minutes' and v_now < v_start then
      insert into public.class_notifications (kind, audience, demo_id, tutor_id, class_date, class_time, minutes)
      select 'reminder', x, r.demo_id, r.tutor_id, v_today, v_time, v_min from unnest(array['tutor', 'student']) x
      on conflict do nothing;
      get diagnostics v_got = row_count; v_n := v_n + v_got;
    end if;

    if v_now >= v_start + make_interval(mins => v_min) and (r.class_log -> v_today::text ->> 's') is null then
      insert into public.class_notifications (kind, audience, demo_id, tutor_id, class_date, class_time, minutes)
      values ('confirm', 'tutor', r.demo_id, r.tutor_id, v_today, v_time, v_min)
      on conflict do nothing;
      get diagnostics v_got = row_count; v_n := v_n + v_got;
    end if;
  end loop;
  return v_n;
end;
$function$;
revoke all on function public.enqueue_class_notifications() from public, anon, authenticated;

-- every minute: queue what is due, and wake the sender when something is waiting
create or replace function public.tick_class_notifications()
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public.enqueue_class_notifications();
  if exists (select 1 from public.class_notifications where sent_at is null) then
    perform net.http_post(
      url := 'https://zbvtdcqoouwyrcxkzjfv.supabase.co/functions/v1/telegram?run=1',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
end;
$function$;
revoke all on function public.tick_class_notifications() from public, anon, authenticated;

-- the tutor taps "Yes" in Telegram: marks the day done (calendar turns green). service_role only.
create or replace function public.bot_mark_class(p_email text, p_demo_id text, p_date date)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_tutor public.tutors;
  a       public.applications;
  t       public.tuitions;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_entry jsonb;
  v_min   int;
  v_time  text;
begin
  select * into v_tutor from public.tutors where lower(email) = lower(p_email) limit 1;
  if v_tutor.tutor_id is null then return jsonb_build_object('success', false, 'message', 'Tutor not found.'); end if;
  if v_tutor.blocked_at is not null then return jsonb_build_object('success', false, 'message', 'Your account is blocked. Please contact Urban Tutor Site.'); end if;

  select * into a from public.applications where demo_id = p_demo_id and tutor_id = v_tutor.tutor_id for update;
  select * into t from public.tuitions where demo_id = p_demo_id;
  if a.id is null or t.demo_id is null then return jsonb_build_object('success', false, 'message', 'That tuition is not on your account.'); end if;
  if not (a.parent_accepted and a.tutor_accepted) or a.parent_rejected or a.tutor_rejected or a.classes_completed or t.terminated then
    return jsonb_build_object('success', false, 'message', 'This class is not running.');
  end if;
  if a.class_dates is null or not (p_date = any (a.class_dates)) then
    return jsonb_build_object('success', false, 'message', 'That date is not on the class schedule.');
  end if;
  if p_date > v_today then return jsonb_build_object('success', false, 'message', 'You can mark a class on its day or after it.'); end if;

  v_entry := coalesce(a.class_log -> p_date::text, '{}'::jsonb);
  if v_entry ->> 's' = 'done' then
    return jsonb_build_object('success', true, 'already', true, 'message', 'This class was already marked as taken.');
  end if;
  if v_entry ->> 'by' = 'admin' and v_entry ? 's' then
    return jsonb_build_object('success', false, 'message', 'The office has already set this day. Please contact Urban Tutor Site.');
  end if;

  v_min := coalesce(nullif(v_entry ->> 'm', '')::int, nullif(a.billing_plan -> 'deal' ->> 'minutes', '')::int, nullif(regexp_replace(coalesce(a.class_duration, ''), '\D', '', 'g'), '')::int, 60);
  v_time := nullif(coalesce(v_entry ->> 't', a.billing_plan -> 'deal' ->> 'time'), '');
  v_entry := (v_entry - 's' - 'by' - 'at') || jsonb_build_object('s', 'done', 'by', 'tutor', 'at', now(), 'm', v_min);
  update public.applications set class_log = a.class_log || jsonb_build_object(p_date::text, v_entry) where id = a.id;

  return jsonb_build_object('success', true, 'message', 'Class marked as taken.',
    'subject', t.subject, 'studentId', t.student_id, 'tutorName', v_tutor.full_name, 'minutes', v_min, 'time', v_time);
end;
$function$;
revoke all on function public.bot_mark_class(text, text, date) from public, anon, authenticated;
grant execute on function public.bot_mark_class(text, text, date) to service_role;

create extension if not exists pg_net;
select cron.schedule('class-notify-tick', '* * * * *', $$select public.tick_class_notifications()$$);

-- (applied separately) the edge function reads / claims the queue as service_role
grant select, insert, update, delete on public.class_notifications to service_role;
grant usage, select on sequence public.class_notifications_id_seq to service_role;
