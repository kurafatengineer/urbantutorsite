-- A tutor applies for a tuition from the WhatsApp / Telegram bot by typing its Tuition ID (DID...).
-- Same rules as the website's apply_for_tuition (verified, not blocked, tuition still open, not applied twice),
-- plus one more: the tutor's gender must match the tuition's preferred tutor ("Any" accepts everyone).
-- Only the bots call it, with the service role; the bot has already worked out which tutor is chatting.

create or replace function public.bot_apply_for_tuition(p_email text, p_demo_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_demo   text := upper(regexp_replace(coalesce(p_demo_id, ''), '\s', '', 'g'));
  v_pref   text;
  v_gender text;
begin
  select initcap(trim(coalesce(t.preferred_tutor, ''))) into v_pref
  from public.tuitions t where t.demo_id = v_demo;

  if not found then
    return jsonb_build_object('success', false, 'notFound', true,
      'message', 'No tuition was found with this Tuition ID.');
  end if;

  select initcap(trim(coalesce(gender, ''))) into v_gender
  from public.tutors where lower(email) = lower(trim(p_email))
  limit 1;

  if v_pref in ('Male', 'Female') and coalesce(v_gender, '') <> v_pref then
    return jsonb_build_object('success', false, 'genderMismatch', true, 'needed', v_pref,
      'message', 'This tuition is only for ' || lower(v_pref) || ' tutors.');
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('email', lower(trim(p_email)))::text, true);
  return public.apply_for_tuition(v_demo);
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

revoke all on function public.bot_apply_for_tuition(text, text) from public, anon, authenticated;
grant execute on function public.bot_apply_for_tuition(text, text) to service_role;
