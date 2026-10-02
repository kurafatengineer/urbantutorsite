// URBANTUTORSITE - TELEGRAM BOT  (Supabase Edge Function "telegram")
//
// @UrbanTutorSiteBot. The bot itself only greets and hands out buttons;
// the registration is the website's own page, opened INSIDE Telegram as a
// Mini App - same flow (email + 6-digit code), same design, same database.
//
//   POST (from Telegram)  /start or anything else -> "Student - Register / Login"
//                         and "Tutor - Register / Login" buttons; /student and
//                         /tutor -> just that one button. (The two pages do
//                         both: a new email registers, a known email logs in
//                         and lands on its profile.)
//                         The chat always holds just ONE message: whatever the
//                         user types is deleted, and the bot's previous buttons
//                         message (remembered in table telegram_chats) is
//                         deleted once the new one is sent.
//                         Only accepted with Telegram's secret header.
//   GET  ?setup=1         one-time setup: points the bot's webhook here, makes
//                         the menu button open the website, and removes the
//                         command list. Safe to run again.
//
// Secret: TELEGRAM_BOT_TOKEN (from @BotFather). The webhook's secret header is
// derived from it, so no second secret is needed.

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SITE_URL = "https://kurafatengineer.github.io/urbantutorsite";
const STUDENT_URL = `${SITE_URL}/studentregistration.html`;
const TUTOR_URL = `${SITE_URL}/tutorregistration.html`;
const HOME_URL = `${SITE_URL}/index.html`;
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/telegram`;

// deno-lint-ignore no-explicit-any
type Json = any;

async function webhookSecret(): Promise<string> {
  const data = new TextEncoder().encode("urbantutorsite-telegram:" + BOT_TOKEN);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

async function telegram(method: string, body: Json): Promise<Json> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.json().catch(() => ({ ok: false }));
}

function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });
}

/* ---- the one message per chat (table telegram_chats) ---- */

async function db(path: string, init: RequestInit = {}): Promise<Json> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json", ...(init.headers ?? {}),
    },
  });
  return res.ok ? await res.json().catch(() => null) : null;
}

async function lastMessageId(chatId: number): Promise<number | null> {
  const rows = await db(`telegram_chats?chat_id=eq.${chatId}&select=last_message_id`);
  return rows?.[0]?.last_message_id ?? null;
}

async function rememberMessage(chatId: number, messageId: number) {
  await db("telegram_chats?on_conflict=chat_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ chat_id: chatId, last_message_id: messageId, updated_at: new Date().toISOString() }),
  });
}

// send the new buttons message, then remove the previous one
async function sendReplacing(chatId: number, message: Json) {
  const previous = await lastMessageId(chatId);
  const sent = await telegram("sendMessage", { chat_id: chatId, ...message });
  const newId = sent?.result?.message_id;
  if (!newId) return;
  await rememberMessage(chatId, newId);
  if (previous && previous !== newId) await telegram("deleteMessage", { chat_id: chatId, message_id: previous });
}

const studentButton = { text: "🎓 Student - Register / Login", web_app: { url: STUDENT_URL } };
const tutorButton = { text: "👨‍🏫 Tutor - Register / Login", web_app: { url: TUTOR_URL } };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function greet(chatId: number, firstName: string) {
  const name = firstName ? ` ${escapeHtml(firstName)}` : "";
  await sendReplacing(chatId, {
    parse_mode: "HTML",
    text:
      `👋 Hi${name}! Welcome to <b>Urban Tutor Site</b>.\n\n` +
      `🎓 <b>Parents / Students</b> - find a verified home or online tutor.\n` +
      `👨‍🏫 <b>Tutors</b> - register and get tuition requests near you.\n\n` +
      `Choose below to register or log in - it opens right here in Telegram. ` +
      `New here? Just register. Already registered? Use the same email to log in. ` +
      `A 6-digit code comes to your email either way.`,
    reply_markup: { inline_keyboard: [[studentButton], [tutorButton]] },
  });
}

async function sendOne(chatId: number, forTutor: boolean) {
  await sendReplacing(chatId, {
    text: forTutor ? "Tap below to register or log in as a tutor:" : "Tap below to register or log in as a student / parent:",
    reply_markup: { inline_keyboard: [[forTutor ? tutorButton : studentButton]] },
  });
}

async function setup(): Promise<Response> {
  if (!BOT_TOKEN) return json({ ok: false, message: "TELEGRAM_BOT_TOKEN is not set in Supabase Edge Function secrets." }, 500);
  const webhook = await telegram("setWebhook", {
    url: WEBHOOK_URL,
    secret_token: await webhookSecret(),
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  // the menu button opens the website itself (no command list)
  const menu = await telegram("setChatMenuButton", {
    menu_button: { type: "web_app", text: "Open", web_app: { url: HOME_URL } },
  });
  const commands = await telegram("deleteMyCommands", {});
  return json({ ok: !!(webhook.ok && menu.ok && commands.ok), webhook, menu, commands });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (url.searchParams.get("setup") === "1") return await setup();
    return json({ ok: true, bot: "@UrbanTutorSiteBot" });
  }

  if (req.method !== "POST") return json({ ok: false }, 405);
  if (!BOT_TOKEN) return json({ ok: false }, 500);

  // only Telegram knows the secret header
  if (req.headers.get("x-telegram-bot-api-secret-token") !== await webhookSecret()) {
    return json({ ok: false }, 401);
  }

  try {
    const update = await req.json();
    const msg = update?.message;
    // private chats only; groups are ignored
    if (msg?.chat?.id && msg.chat.type === "private") {
      // keep the chat clean: whatever the user sent is removed
      if (msg.message_id) await telegram("deleteMessage", { chat_id: msg.chat.id, message_id: msg.message_id });
      const command = String(msg.text ?? "").trim().split(/[\s@]/)[0].toLowerCase();
      if (command === "/student") await sendOne(msg.chat.id, false);
      else if (command === "/tutor") await sendOne(msg.chat.id, true);
      else await greet(msg.chat.id, String(msg.from?.first_name ?? ""));
    }
  } catch (err) {
    console.error("telegram update failed", String(err));
  }

  // always 200, so Telegram doesn't keep re-sending the same update
  return json({ ok: true });
});
