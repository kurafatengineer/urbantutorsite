-- Security hardening only (no behaviour change): pin the search_path of the
-- small helper functions so a look-alike object in another schema can never
-- be picked up in their place.
alter function public._clean(text)                      set search_path = public, pg_temp;
alter function public._date(text)                       set search_path = public, pg_temp;
alter function public._demo_iso(date, time)             set search_path = public, pg_temp;
alter function public._mobile(text)                     set search_path = public, pg_temp;
alter function public._num(text)                        set search_path = public, pg_temp;
alter function public.application_status(applications, boolean) set search_path = public, pg_temp;
alter function public.tuition_status(text)              set search_path = public, pg_temp;
