-- Student/Tutor profile payments also return paidAt (when the payment was
-- actually recorded), so the profile can show the real time, not just the date.
do $$
declare def text; r record;
begin
  for r in select p.oid, p.proname from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in ('get_student_profile', 'get_tutor_profile') loop
    def := pg_get_functiondef(r.oid);
    if position($q$'paidAt'$q$ in def) = 0 then
      def := replace(def, $q$'paymentDate', pm.payment_date,$q$, $q$'paymentDate', pm.payment_date, 'paidAt', pm.created_at,$q$);
      def := replace(def, $q$'paymentDate',     pm.payment_date,$q$, $q$'paymentDate',     pm.payment_date, 'paidAt', pm.created_at,$q$);
      execute def;
    end if;
  end loop;
end $$;
