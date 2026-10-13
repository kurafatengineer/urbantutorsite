-- Class deal (two ways of billing a running class) - see _shared/deal.ts.
-- The deal itself lives in applications.billing_plan.deal (no new columns).
--
-- New money movements in payments:
--   refund        agency -> parent: fee paid for classes not taken (tutor left)
--   tutor_credit  extra commission a tutor paid, kept as their balance
--   credit_used   that balance used against a later tuition's commission
-- A tutor's balance = their tutor_credit total - their credit_used total.
-- Payment frequency can now also be every 15 days.

alter table public.payments drop constraint if exists payments_transaction_type_check;
alter table public.payments add constraint payments_transaction_type_check
  check (transaction_type in ('collection', 'payout', 'agency_charge', 'refund', 'tutor_credit', 'credit_used'));

alter table public.payments drop constraint if exists payments_refund_needs_demo_chk;
alter table public.payments add constraint payments_refund_needs_demo_chk
  check (transaction_type <> 'refund' or demo_id is not null);

alter table public.payments drop constraint if exists payments_credit_needs_tutor_chk;
alter table public.payments add constraint payments_credit_needs_tutor_chk
  check (transaction_type not in ('tutor_credit', 'credit_used') or tutor_id is not null);

-- Weekly | 15 Days | Monthly
create or replace function public.admin_update_demo_row(p_demo_id text, p_tutor_id text, p_changes jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c jsonb := coalesce(p_changes, '{}'::jsonb);
  v_time text := public._clean(c->>'Demo Time');
  v_student_freq text := public._clean(c->>'Student Payment Frequency');
  v_tutor_freq text := public._clean(c->>'Tutor Payment Frequency');
begin
  if v_time is not null and v_time !~ '^\d{1,2}:\d{2}(:\d{2})?\s*([AaPp][Mm])?$' then
    raise exception 'Demo Time is not a valid time.';
  end if;

  if v_student_freq is not null and v_student_freq not in ('Weekly', '15 Days', 'Monthly') then
    raise exception 'Student Payment Frequency must be Weekly, 15 Days or Monthly.';
  end if;

  if v_tutor_freq is not null and v_tutor_freq not in ('Weekly', '15 Days', 'Monthly') then
    raise exception 'Tutor Payment Frequency must be Weekly, 15 Days or Monthly.';
  end if;

  update public.applications a set
    demo_date         = public._adm_date(c, 'Demo Date', a.demo_date),
    demo_time         = case when c ? 'Demo Time' then v_time::time else a.demo_time end,
    price             = public._adm_text(c, 'Price', a.price),
    duration          = public._adm_text(c, 'Duration', a.duration),
    percentage        = public._adm_text(c, 'Percentage', a.percentage),
    parent_accepted   = public._adm_bool(c, 'Parent Accepted', a.parent_accepted),
    parent_rejected   = public._adm_bool(c, 'Parent Rejected', a.parent_rejected),
    tutor_accepted    = public._adm_bool(c, 'Tutor Accepted', a.tutor_accepted),
    tutor_rejected    = public._adm_bool(c, 'Tutor Rejected', a.tutor_rejected),
    classes_completed = public._adm_bool(c, 'Classes Completed', a.classes_completed),
    class_days        = case when c ? 'Class Days'
                           then (select array_agg(x) from jsonb_array_elements_text(c->'Class Days') x)
                           else a.class_days end,
    class_dates           = case when c ? 'Class Dates'
                               then (select array_agg(x::date order by x::date) from jsonb_array_elements_text(c->'Class Dates') x)
                               else a.class_dates end,
    billing_plan          = case when jsonb_typeof(c->'Billing Plan') = 'object'
                               then c->'Billing Plan'
                               else a.billing_plan end,
    billing_mode          = case when c ? 'Billing Mode'
                               then nullif(public._clean(c->>'Billing Mode'), '')
                               else a.billing_mode end,
    class_duration        = public._adm_text(c, 'Class Duration', a.class_duration),
    class_charges         = public._adm_num(c, 'Class Charges', a.class_charges),
    class_count           = coalesce(public._adm_num(c, 'Class Count', a.class_count)::int, 0),
    class_total_amount    = public._adm_num(c, 'Class Total Amount', a.class_total_amount),
    class_start_date      = public._adm_date(c, 'Class Start Date', a.class_start_date),
    class_end_date        = public._adm_date(c, 'Class End Date', a.class_end_date),
    student_payment_to        = public._adm_text(c, 'Student Payment To', a.student_payment_to),
    student_agency_charge     = public._adm_num(c, 'Student Agency Charge', a.student_agency_charge),
    student_payment_frequency = case when c ? 'Student Payment Frequency' then v_student_freq else a.student_payment_frequency end,
    student_advance_payment   = public._adm_num(c, 'Student Advance Payment', a.student_advance_payment),
    student_total_amount      = public._adm_num(c, 'Student Total Amount', a.student_total_amount),
    student_next_due_date     = public._adm_date(c, 'Student Next Due Date', a.student_next_due_date),
    tutor_payment_from        = public._adm_text(c, 'Tutor Payment From', a.tutor_payment_from),
    tutor_agency_charge       = public._adm_num(c, 'Tutor Agency Charge', a.tutor_agency_charge),
    tutor_payment_frequency   = case when c ? 'Tutor Payment Frequency' then v_tutor_freq else a.tutor_payment_frequency end,
    tutor_advance_payment     = public._adm_num(c, 'Tutor Advance Payment', a.tutor_advance_payment),
    tutor_total_amount        = public._adm_num(c, 'Tutor Total Amount', a.tutor_total_amount),
    tutor_next_payment_date   = public._adm_date(c, 'Tutor Next Payment Date', a.tutor_next_payment_date)
  where a.demo_id = p_demo_id and a.tutor_id = p_tutor_id;

  if not found then raise exception 'That tutor row was not found. Refresh and try again.'; end if;

  perform public._apply_auto_rejections(p_demo_id);

  return jsonb_build_object('success', true, 'message', 'Saved.');
end;
$function$;
