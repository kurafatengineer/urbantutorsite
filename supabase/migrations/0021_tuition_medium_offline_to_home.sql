-- Tuition Mode (column "medium"): "Offline" is now "Home".
alter table public.tuitions drop constraint if exists tuitions_medium_check;
update public.tuitions set medium = 'Home' where medium = 'Offline';
alter table public.tuitions add constraint tuitions_medium_check
  check (medium = any (array['Any'::text, 'Online'::text, 'Home'::text]));
