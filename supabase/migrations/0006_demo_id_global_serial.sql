-- =====================================================================
-- Demo IDs used to be numbered per-student (STUxxxx-DID001, DID002...
-- restarting at 1 for every student). Switch to one global, always-
-- increasing sequence shared across every student, so a Demo ID alone
-- identifies a tuition without needing to know whose it is.
-- =====================================================================

create sequence if not exists public.demo_id_seq;

select setval('public.demo_id_seq',
  greatest(1, coalesce((
    select max(substring(demo_id from 'DID([0-9]+)$')::int) from public.tuitions
  ), 0))
);

CREATE OR REPLACE FUNCTION public.generate_demo_id(p_student_id text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  return 'DID' || lpad(nextval('public.demo_id_seq')::text, 6, '0');
end;
$function$;
