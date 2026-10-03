// Telegram messages from @UrbanTutorSiteBot to a student / tutor whose chat
// is linked (students.telegram_chat_id / tutors.telegram_chat_id).
// These messages stay in the chat (they are not the bot's one buttons
// message, which the telegram function replaces).

import { fmtDate, fmtTime, modeText, SITE_URL } from "./mails.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

export function tgEscape(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendTelegram(chatId: unknown, html: string, button?: { text: string; page: string }) {
  if (!BOT_TOKEN || !chatId) return;
  const body: Record<string, unknown> = { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true };
  if (button) body.reply_markup = { inline_keyboard: [[{ text: button.text, web_app: { url: `${SITE_URL}/${button.page}` } }]] };
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error("telegram send failed", res.status, await res.text().catch(() => ""));
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
    `\nPlease be ready a few minutes early.`;
}
