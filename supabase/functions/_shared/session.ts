// The chat flows (register a student, post a tuition) keep their progress in bot_sessions:
// one row per chat with the current step and what was typed so far. Shared by both bots.
import { q, rest } from "./botdata.ts";

type Json = Record<string, any>;

export type Choice = { id: string; title: string; description?: string };
// link: one button that opens a page of the site (WhatsApp "cta_url" button, Telegram web-app button).
export type Out = { text: string; choices?: Choice[]; askPhone?: boolean; link?: { label: string; url: string } };
export type Input = { text?: string; choice?: string; contactPhone?: string };
export type Ctx = { channel: "wa" | "tg"; key: string; verifiedPhone?: string; telegramChatId?: number };

const SESSION_HOURS = 3;

export const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
export const titleCase = (v: string) => clean(v).toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_m, a, b) => a + b.toUpperCase());

export async function load(ctx: Ctx): Promise<{ step: string; data: Json } | null> {
  const rows = await rest(`bot_sessions?channel=eq.${ctx.channel}&chat_key=eq.${q(ctx.key)}&select=step,data,updated_at`);
  const row = rows?.[0];
  if (!row) return null;
  // a half-finished flow is forgotten after a few hours, so a later "hi" starts fresh
  if (Date.now() - new Date(row.updated_at).getTime() > SESSION_HOURS * 3_600_000) {
    await clear(ctx);
    return null;
  }
  return row;
}
export async function save(ctx: Ctx, step: string, data: Json) {
  await rest("bot_sessions?on_conflict=channel,chat_key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ channel: ctx.channel, chat_key: ctx.key, step, data, updated_at: new Date().toISOString() }),
  });
}
export async function clear(ctx: Ctx) {
  await rest(`bot_sessions?channel=eq.${ctx.channel}&chat_key=eq.${q(ctx.key)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}
