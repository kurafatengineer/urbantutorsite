-- Payments card (Tuitions tab): a calendar of class dates + how the class
-- is billed.
--   class_dates   the dates ticked on the card's calendar
--   billing_mode  'classes' = Price per class x Number of classes
--                 'hourly'  = Price per hour x (Minutes per class / 60) x classes
-- The existing columns hold the rest: class_duration = minutes per class,
-- class_charges = the price (per class or per hour), class_total_amount =
-- the Amount. Number of classes = how many dates are ticked.

alter table public.applications add column if not exists class_dates date[];
alter table public.applications add column if not exists billing_mode text;
alter table public.applications drop constraint if exists applications_billing_mode_check;
alter table public.applications add constraint applications_billing_mode_check
  check (billing_mode is null or billing_mode in ('classes', 'hourly'));

-- admin_update_demo_row: also save 'Class Dates' (["YYYY-MM-DD", ...]) and 'Billing Mode'
do $mig$
declare d text; before text;
begin
  d := pg_get_functiondef('public.admin_update_demo_row'::regproc);
  before := d;
  d := replace(d,
    $x$    class_duration        = public._adm_text(c, 'Class Duration', a.class_duration),$x$,
    $x$    class_dates           = case when c ? 'Class Dates'
                               then (select array_agg(x::date order by x::date) from jsonb_array_elements_text(c->'Class Dates') x)
                               else a.class_dates end,
    billing_mode          = case when c ? 'Billing Mode'
                               then nullif(public._clean(c->>'Billing Mode'), '')
                               else a.billing_mode end,
    class_duration        = public._adm_text(c, 'Class Duration', a.class_duration),$x$);
  if d = before then raise exception 'admin_update_demo_row: anchor not found'; end if;
  execute d;
end
$mig$;

-- admin_get_overview: send classDates + billingMode with every demo row
do $mig$
declare d text; before text;
begin
  d := pg_get_functiondef('public.admin_get_overview'::regproc);
  before := d;
  d := replace(d,
    $x$'classTotalAmount', public._adm_show(class_total_amount),$x$,
    $x$'classTotalAmount', public._adm_show(class_total_amount),
        'classDates',       coalesce((select jsonb_agg(to_char(x, 'YYYY-MM-DD') order by x) from unnest(class_dates) x), '[]'::jsonb),
        'billingMode',      coalesce(billing_mode, ''),$x$);
  d := replace(d, 'a.class_count, a.class_total_amount,', 'a.class_count, a.class_total_amount, a.class_dates, a.billing_mode,');
  if d = before or position('a.class_dates' in d) = 0 then raise exception 'admin_get_overview: anchor not found'; end if;
  execute d;
end
$mig$;
