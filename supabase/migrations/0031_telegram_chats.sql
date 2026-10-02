-- @UrbanTutorSiteBot keeps each chat to ONE message: it remembers the id of
-- the last buttons message it sent in each chat, and deletes it when it
-- sends a new one. Only the telegram Edge Function (service role) uses it.

create table if not exists public.telegram_chats (
  chat_id          bigint primary key,
  last_message_id  bigint,
  updated_at       timestamptz not null default now()
);

alter table public.telegram_chats enable row level security;
revoke all on public.telegram_chats from anon, authenticated;
grant select, insert, update, delete on public.telegram_chats to service_role;
