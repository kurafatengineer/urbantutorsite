-- =====================================================================
-- Subscriptions are now always one of two fixed types - Student (₹500)
-- or Tutor (₹1000), both billed yearly - but the amount can be reduced
-- or fully exempted case by case. Allow 0 so an exempted subscription
-- can still be recorded (and shown as "fully paid" with nothing due).
-- =====================================================================

alter table public.subscriptions drop constraint subscriptions_amount_check;
alter table public.subscriptions add constraint subscriptions_amount_check check (amount >= 0);
