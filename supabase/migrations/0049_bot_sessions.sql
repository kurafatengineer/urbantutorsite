-- Where each Telegram / WhatsApp chat is in the "register as a student" chat flow.
create table if not exists public.bot_sessions (
  channel text not null,
  chat_key text not null,
  step text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (channel, chat_key)
);
alter table public.bot_sessions enable row level security;
revoke all on public.bot_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.bot_sessions to service_role;
