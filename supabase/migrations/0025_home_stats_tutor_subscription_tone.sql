-- Homepage "Tutors worth meeting": each tutor also carries the colour class of
-- their subscription ('paid' | 'partial' | 'unpaid', or null when they have no
-- subscription), so the verified badge can follow the subscription status like
-- everywhere else. Only that one word is exposed - no amounts.
-- Applied in place so it works on top of the live get_home_stats definition.
do $m$
declare
  v_def text := pg_get_functiondef('public.get_home_stats()'::regprocedure);
  v_old text := '''experience'', experience_years, ''city'', city';
  v_new text := '''experience'', experience_years, ''city'', city, ''tone'', (
          select case when s.amount <= 0 or s.paid >= s.amount then ''paid''
                      when s.paid > 0 then ''partial'' else ''unpaid'' end
          from (
            select sub.amount,
                   coalesce((select sum(pm.amount) from public.payments pm
                             where pm.subscription_id = sub.id
                               and pm.transaction_type = ''collection''), 0) as paid
            from public.subscriptions sub
            where sub.tutor_id = x.tutor_id
            order by (sub.status = ''active'') desc, sub.created_at desc
            limit 1
          ) s
        )';
begin
  if position('''tone''' in v_def) = 0 then
    if position(v_old in v_def) = 0 then raise exception 'get_home_stats changed; edit not applied'; end if;
    execute replace(v_def, v_old, v_new);
  end if;
end
$m$;
