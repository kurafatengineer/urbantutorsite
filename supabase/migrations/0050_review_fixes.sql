-- Review fixes: indexes on the three foreign keys the Supabase advisor flagged,
-- and a fixed search_path on a helper function.
create index if not exists payments_recorded_by_idx on public.payments (recorded_by);
create index if not exists payments_subscription_id_idx on public.payments (subscription_id);
create index if not exists subscriptions_created_by_idx on public.subscriptions (created_by);

alter function public._tutor_experience_since() set search_path = public, pg_temp;
