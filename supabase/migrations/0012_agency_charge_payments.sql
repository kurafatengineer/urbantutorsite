-- =====================================================================
-- AGENCY CHARGE PAYMENTS
--
-- Until now the Agency Charge cards on the Payments tab guessed
-- "Received" from money that had already moved for other reasons
-- (the student's collections, the tutor's payouts) - there was no
-- real ledger entry for the agency's own cut being paid. This adds a
-- third transaction direction, "agency_charge": money paid straight
-- towards the Agency Charge itself, recorded exactly like any other
-- payment.
--
--   demo_id set, tutor_id null   -> Student Agency Charge payment
--                                    (student/parent pays the agency)
--   demo_id set, tutor_id set    -> Tutor Agency Charge payment
--                                    (tutor pays the agency)
-- =====================================================================

alter table public.payments
  drop constraint payments_transaction_type_check;

alter table public.payments
  add constraint payments_transaction_type_check
    check (transaction_type in ('collection', 'payout', 'agency_charge'));

alter table public.payments
  drop constraint payments_payment_type_check;

alter table public.payments
  add constraint payments_payment_type_check
    check (payment_type in ('advance', 'regular', 'final', 'agency'));

alter table public.payments
  add constraint payments_agency_charge_needs_demo_chk
    check (transaction_type <> 'agency_charge' or demo_id is not null);
