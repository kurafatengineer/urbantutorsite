-- Tutor experience keeps growing after registration.
--   experience_since  - the date the tutor's experience started: (registration date) - (years entered).
--                       "5 years" on 14 Oct 2026 => since 14 Oct 2021, so a year later it reads 6.0.
--   experience_years  - stays the value everything already reads; refreshed every night (1 decimal).
alter table public.tutors add column if not exists experience_since date;

create or replace function public.refresh_tutor_experience()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  perform set_config('app.exp_refresh', '1', true);
  update public.tutors
     set experience_years = round(((current_date - experience_since) / 365.25)::numeric, 1)
   where experience_since is not null
     and experience_years is distinct from round(((current_date - experience_since) / 365.25)::numeric, 1);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.refresh_tutor_experience() from public, anon, authenticated;

create or replace function public._tutor_experience_since()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.experience_years is not null then
      new.experience_since := coalesce(new.registered_at, now())::date - round(new.experience_years * 365.25)::int;
    end if;
  elsif new.experience_years is distinct from old.experience_years
        and coalesce(current_setting('app.exp_refresh', true), '') <> '1' then
    new.experience_since := case when new.experience_years is null then null
                                 else current_date - round(new.experience_years * 365.25)::int end;
  end if;
  return new;
end $$;

drop trigger if exists tutors_experience_since on public.tutors;
create trigger tutors_experience_since before insert or update of experience_years on public.tutors
  for each row execute function public._tutor_experience_since();

-- existing tutors: counted from the day they registered
update public.tutors
   set experience_since = registered_at::date - round(experience_years * 365.25)::int
 where experience_years is not null and experience_since is null;
select public.refresh_tutor_experience();

create extension if not exists pg_cron;
select cron.schedule('tutor-experience-refresh', '35 18 * * *', $$select public.refresh_tutor_experience()$$);

-- Homepage "Tutors worth meeting": verified tutors, nearest to the visitor first
-- (same PIN, then same first 3 PIN digits, then same city, then everyone), random order within each step.
-- Public, read-only: first name, experience, city, PIN, subscription colour and a photo reference only.
create or replace function public.get_home_tutors(p_city text default null, p_pin text default null)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
begin
  return jsonb_build_object('success', true, 'tutors', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', q.full_name, 'experience', q.experience_years, 'city', q.city, 'pin', q.pin_code,
      'tier', q.tier, 'ref', left(md5('ut' || q.tutor_id), 12), 'tone', q.tone
    ) order by q.tier, q.rnd)
    from (
      select x.*, (
          select case when s.amount <= 0 or s.paid >= s.amount then 'paid'
                      when s.paid > 0 then 'partial' else 'unpaid' end
          from (
            select sub.amount,
                   coalesce((select sum(pm.amount) from public.payments pm
                             where pm.subscription_id = sub.id and pm.transaction_type = 'collection'), 0) as paid
            from public.subscriptions sub
            where sub.tutor_id = x.tutor_id
            order by (sub.status = 'active') desc, sub.created_at desc
            limit 1
          ) s
        ) as tone
      from (
        select t.tutor_id, t.full_name, t.experience_years, t.city, t.pin_code, random() as rnd,
               case
                 when nullif(btrim(p_pin), '') is not null and btrim(t.pin_code) = btrim(p_pin) then 0
                 when length(btrim(coalesce(p_pin, ''))) >= 3 and left(btrim(t.pin_code), 3) = left(btrim(p_pin), 3) then 1
                 when nullif(btrim(p_city), '') is not null and lower(btrim(t.city)) = lower(btrim(p_city)) then 2
                 else 3
               end as tier
        from public.tutors t
        where t.verification_status = 'Verified' and t.blocked_at is null
          and nullif(btrim(t.full_name), '') is not null
        order by 7, 6
        limit 24
      ) x
    ) q
  ), '[]'::jsonb));
end $$;
grant execute on function public.get_home_tutors(text, text) to anon, authenticated;
