-- Students tab icons: when a student was last edited, sent a notification,
-- or moved to the Trash (Delete never erases a student; restore clears it).
alter table public.students
  add column if not exists edited_at timestamptz,
  add column if not exists notified_at timestamptz,
  add column if not exists deleted_at timestamptz;

-- edited_at moves only when a detail itself changes (not the ID, the
-- notification / Trash marks or the Telegram link).
create or replace function public._students_mark_edited()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.parents_name, new.student_name, new.phone, new.whatsapp, new.email, new.gender, new.city,
      new.address, new.pin_code, new.school, new.class_name, new.board)
     is distinct from
     (old.parents_name, old.student_name, old.phone, old.whatsapp, old.email, old.gender, old.city,
      old.address, old.pin_code, old.school, old.class_name, old.board) then
    new.edited_at := now();
  end if;
  return new;
end $$;

create trigger students_mark_edited before update on public.students
  for each row execute function public._students_mark_edited();
