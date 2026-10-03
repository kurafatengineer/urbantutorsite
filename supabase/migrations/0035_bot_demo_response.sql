-- Accept / Reject a demo from Telegram (@UrbanTutorSiteBot).
-- The telegram Edge Function first checks that the button was pressed in
-- the chat linked to that student / tutor, then calls these with that
-- person's email. They run the SAME functions the website uses
-- (respond_to_demo / respond_to_demo_tutor) as that person, so every rule
-- is identical. Only the service role (the Edge Function) may call them.

create or replace function public.bot_respond_to_demo(p_email text, p_demo_id text, p_tutor_id text, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('email', lower(trim(p_email)))::text, true);
  return public.respond_to_demo(p_demo_id, p_tutor_id, p_decision);
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

create or replace function public.bot_respond_to_demo_tutor(p_email text, p_demo_id text, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('email', lower(trim(p_email)))::text, true);
  return public.respond_to_demo_tutor(p_demo_id, p_decision);
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

revoke all on function public.bot_respond_to_demo(text, text, text, text) from public, anon, authenticated;
revoke all on function public.bot_respond_to_demo_tutor(text, text, text) from public, anon, authenticated;
grant execute on function public.bot_respond_to_demo(text, text, text, text) to service_role;
grant execute on function public.bot_respond_to_demo_tutor(text, text, text) to service_role;
