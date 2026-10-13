-- Demo ID in the same shape as Student / Tutor IDs: DID + YYYY + 4 digits
-- (e.g. DID20260001). Existing rows keep their IDs; nothing is deleted.
-- While no tuition exists yet, the counter starts again from 0001.

create or replace function public.generate_demo_id(p_student_id text)
returns text
language plpgsql
set search_path to 'public'
as $$
declare
  yr     text := to_char(now(), 'YYYY');
  next_n bigint;
begin
  next_n := nextval('public.demo_id_seq');
  return 'DID' || yr || lpad(next_n::text, 4, '0');
end;
$$;

do $$
begin
  if not exists (select 1 from public.tuitions) then
    perform setval('public.demo_id_seq', 1, false);
  end if;
end
$$;
