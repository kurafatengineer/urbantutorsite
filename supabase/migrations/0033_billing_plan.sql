-- Payments card: keep the boxes of BOTH billing options, so switching
-- between "Number of Classes" and "Hourly" never mixes their values.
--   billing_plan  {"classes": {"minutes","price","amount"},
--                  "hourly":  {"minutes","price","amount"}}
-- The chosen option (billing_mode) is still copied into class_duration /
-- class_charges / class_total_amount, which the totals and emails use.

alter table public.applications add column if not exists billing_plan jsonb;

-- admin_update_demo_row: also save 'Billing Plan'
do $mig$
declare d text; before text;
begin
  d := pg_get_functiondef('public.admin_update_demo_row'::regproc);
  before := d;
  d := replace(d,
    $x$    billing_mode          = case when c ? 'Billing Mode'$x$,
    $x$    billing_plan          = case when jsonb_typeof(c->'Billing Plan') = 'object'
                               then c->'Billing Plan'
                               else a.billing_plan end,
    billing_mode          = case when c ? 'Billing Mode'$x$);
  if d = before then raise exception 'admin_update_demo_row: anchor not found'; end if;
  execute d;
end
$mig$;

-- admin_get_overview: send billingPlan with every demo row
do $mig$
declare d text; before text;
begin
  d := pg_get_functiondef('public.admin_get_overview'::regproc);
  before := d;
  d := replace(d,
    $x$'billingMode',      coalesce(billing_mode, ''),$x$,
    $x$'billingMode',      coalesce(billing_mode, ''),
        'billingPlan',      coalesce(billing_plan, '{}'::jsonb),$x$);
  d := replace(d, 'a.class_dates, a.billing_mode,', 'a.class_dates, a.billing_mode, a.billing_plan,');
  if d = before or position('a.billing_plan' in d) = 0 then raise exception 'admin_get_overview: anchor not found'; end if;
  execute d;
end
$mig$;
