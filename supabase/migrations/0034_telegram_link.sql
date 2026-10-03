-- @UrbanTutorSiteBot notifications: the Telegram chat of a student / tutor.
-- Filled by the telegram Edge Function when the person is logged in on the
-- site INSIDE Telegram (the Mini App), after checking Telegram's signed
-- initData. Used to send "Demo Scheduled" messages. Nobody can write it
-- from the browser (students / tutors have no update rights on these tables).

alter table public.students add column if not exists telegram_chat_id bigint;
alter table public.tutors   add column if not exists telegram_chat_id bigint;
