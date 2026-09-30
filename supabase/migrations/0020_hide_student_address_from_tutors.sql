-- =====================================================================
-- Tutors no longer get a student's full address up front.
--
--  * get_available_tuitions() (the public Tutor Advertisement list):
--    only City and PIN Code - the full address is never sent, even to
--    a verified tutor.
--  * get_tutor_profile(): for a tuition the tutor applied to, the full
--    address is sent only once a demo has been scheduled (demo_date is
--    set); until then just City and PIN Code.
--
-- Written as in-place edits of the live definitions so nothing else in
-- either function is disturbed.
-- =====================================================================

do $$
declare
  d text;
begin

  d := pg_get_functiondef('public.get_available_tuitions()'::regprocedure);
  d := replace(d, 'case when v_verified then s.address else '''' end', '''''');
  execute d;

  d := pg_get_functiondef('public.get_tutor_profile()'::regprocedure);
  d := replace(d, '''address'',         s.address,', '''address'',         case when a.demo_date is not null then s.address else '''' end,');
  execute d;

end $$;
