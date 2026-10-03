// Telegram messages from @UrbanTutorSiteBot to a student / tutor whose chat
// is linked (students.telegram_chat_id / tutors.telegram_chat_id).
// These messages stay in the chat (they are not the bot's one buttons
// message, which the telegram function replaces).
//
// notify(): every notification goes out as the email AND, to whoever has
// linked their Telegram, as the same message on Telegram. The email follows
// the Emails On / Off switches; the Telegram message always goes.

import { sendMail } from "./email.ts";
import { type Built, fmtDate, fmtTime, modeText, SITE_URL } from "./mails.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

export function tgEscape(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// rows: extra button rows above the page button (e.g. the demo's Accept / Reject)
export async function sendTelegram(chatId: unknown, html: string, button?: { text: string; page: string }, rows: unknown[][] = []) {
  if (!BOT_TOKEN || !chatId) return;
  const body: Record<string, unknown> = { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true };
  const keyboard = [...rows];
  if (button) keyboard.push([{ text: button.text, web_app: { url: `${SITE_URL}/${button.page}` } }]);
  if (keyboard.length) body.reply_markup = { inline_keyboard: keyboard };
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error("telegram send failed", res.status, await res.text().catch(() => ""));
}

// the linked chat of the student / tutor record(s) with this email
async function chatIdByEmail(email: string): Promise<number | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const target = email.trim().toLowerCase();
  if (!url || !key || !target) return null;
  for (const table of ["students", "tutors"]) {
    const res = await fetch(
      `${url}/rest/v1/${table}?email=ilike.${encodeURIComponent(target)}&telegram_chat_id=not.is.null&select=email,telegram_chat_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) continue;
    const rows = await res.json().catch(() => []);
    const hit = (rows ?? []).find((r: { email?: string }) => String(r.email ?? "").trim().toLowerCase() === target);
    if (hit?.telegram_chat_id) return Number(hit.telegram_chat_id);
  }
  return null;
}

export async function notify(email: string | null | undefined, mail: Built, opts: { email?: boolean; telegram?: boolean } = {}) {
  if (!email) return;
  if (opts.email !== false) await sendMail(email, mail.subject, mail.html);
  if (opts.telegram === false) return;
  try {
    const chatId = await chatIdByEmail(email);
    if (chatId) await sendTelegram(chatId, mail.tg, { text: mail.cta.label, page: mail.cta.page });
  } catch (e) {
    console.error("telegram notify failed", String(e));
  }
}

// Accept / Reject under a "Demo Scheduled" message. The telegram function
// handles the press (callback_data "dr:<step>:<a|r>:<s|t>:<demoId>:<tutorId>",
// s = the student / parent answering, t = the tutor): first tap asks to
// confirm, then it runs the same accept / reject as the website.
export function demoResponseButtons(side: "s" | "t", demoId: string, tutorId: string): unknown[][] {
  return [[
    { text: "✅ Accept", callback_data: `dr:q:a:${side}:${demoId}:${tutorId}` },
    { text: "❌ Reject", callback_data: `dr:q:r:${side}:${demoId}:${tutorId}` },
  ]];
}

const line = (icon: string, label: string, value: unknown) =>
  String(value ?? "").trim() ? `${icon} ${label}: <b>${tgEscape(value)}</b>\n` : "";

// Demo scheduled. No mobile numbers and no full address go out: the tutor
// sees only the student's area (city - PIN).
export function demoScheduledTelegram(d: {
  forTutor: boolean; name: string; demoId: string; subject: string; date: string; time: string; mode?: string;
  studentName: string; cls?: string; board?: string; area?: string; tutorName: string; tutorId: string;
}): string {
  return `📅 <b>Demo Scheduled</b>\n\n` +
    `Hi ${tgEscape(d.name || "there")}, your demo class for <b>${tgEscape(d.subject)}</b> is scheduled.\n\n` +
    line("🆔", "Demo ID", d.demoId) +
    (d.forTutor
      ? line("👤", "Student", d.studentName) + line("🏫", "Class", [d.cls, d.board].filter(Boolean).join(" · ")) +
        line("📍", "Area", d.area)
      : line("👨‍🏫", "Tutor", d.tutorName) + line("🪪", "Tutor ID", d.tutorId)) +
    line("🗓", "Date", fmtDate(d.date)) +
    line("⏰", "Time", fmtTime(d.time)) +
    line("🏠", "Mode", modeText(d.mode)) +
    `\nPlease be ready a few minutes early. After the demo, tap Accept or Reject below.`;
}
