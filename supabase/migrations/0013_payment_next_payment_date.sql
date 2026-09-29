-- When the rest of a part-paid payment (e.g. an Agency Charge not
-- cleared in one go) is due, so it can be followed up.
alter table public.payments add column if not exists next_payment_date date;
