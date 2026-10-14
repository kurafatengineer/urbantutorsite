-- The bots post tuitions with the service role (chat "Apply for New Tuition").
-- generate_demo_id() takes the next number from demo_id_seq, so the service role needs the sequence too.
grant usage, select, update on sequence public.demo_id_seq to service_role;
