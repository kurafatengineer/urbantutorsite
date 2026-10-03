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
//   POST ?link=1          from the site opened INSIDE Telegram, once the person
//                         is logged in: { initData } + their login token. The
//                         initData is checked against the bot token (so it
//                         really is that Telegram user), then the chat is saved
//                         on their student / tutor record(s)
//                         (telegram_chat_id) for "Demo Scheduled" messages.
//   POST (from Telegram)  a press on Accept / Reject under a "Demo Scheduled"
//                         message: asks to confirm, then - only if the press
//                         came from the chat linked to that student / tutor -
//                         runs the website's own accept / reject as them
//                         (bot_respond_to_demo / bot_respond_to_demo_tutor),
//                         tells the other side (email + Telegram) and shows
//                         the result on the message.
//   GET  ?setup=1         one-time setup: points the bot's webhook here, makes
//                         the menu button open the website, and removes the
//                         command list. Safe to run again.
//
// After changing what the bot listens to (allowed_updates), open ?setup=1 once.
//
// Secret: TELEGRAM_BOT_TOKEN (from @BotFather). The webhook's secret header is
// derived from it, so no second secret is needed.

import { notify, demoResponseButtons } from "../_shared/telegram.ts";
import { parentResponseMail, tutorResponseMail } from "../_shared/mails.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
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

/* ---- Accept / Reject buttons under a "Demo Scheduled" message ---- */

// callback_data "dr:<step>:<a|r>:<s|t>:<demoId>:<tutorId>"
//   step q = first tap (ask to confirm), y = confirmed, b = back, x = nothing
async function rpcCall(fn: string, args: Json): Promise<Json> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return await res.json().catch(() => ({ success: false, message: "Something went wrong. Please try again." }));
}

const one = async (path: string) => (await db(path))?.[0] ?? null;
const q = (v: string) => encodeURIComponent(v);

function profileRow(side: string) {
  return [{ text: "Open My Profile", web_app: { url: `${SITE_URL}/${side === "t" ? "tutorprofile" : "studentprofile"}.html` } }];
}

async function setButtons(chatId: number, messageId: number, rows: Json[][]) {
  await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: rows } });
}

async function onDemoButton(cb: Json) {
  const chatId = Number(cb.message?.chat?.id ?? 0);
  const messageId = Number(cb.message?.message_id ?? 0);
  const fromId = Number(cb.from?.id ?? 0);
  const [, step, choice, side, demoId, tutorId] = String(cb.data ?? "").split(":");
  const answer = (text = "", alert = false) =>
    telegram("answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: alert });

  if (!chatId || !messageId || !demoId || !tutorId || !["s", "t"].includes(side) || !["a", "r"].includes(choice)) {
    await answer();
    return;
  }
  const accept = choice === "a";
  const tail = `${side}:${demoId}:${tutorId}`;

  if (step === "q") {
    await setButtons(chatId, messageId, [[
      { text: accept ? "✅ Yes, accept" : "❌ Yes, reject", callback_data: `dr:y:${choice}:${tail}` },
      { text: "↩️ Back", callback_data: `dr:b:${choice}:${tail}` },
    ], profileRow(side)]);
    await answer(accept ? "Tap \"Yes, accept\" to confirm." : "Tap \"Yes, reject\" to confirm. This cannot be undone.");
    return;
  }
  if (step === "b") {
    await setButtons(chatId, messageId, [...demoResponseButtons(side as "s" | "t", demoId, tutorId), profileRow(side)]);
    await answer();
    return;
  }
  if (step !== "y") {
    await answer();
    return;
  }

  // who is answering: only the chat linked to this student / tutor may
  const tuition = await one(`tuitions?demo_id=eq.${q(demoId)}&select=subject,student_id`);
  const student = tuition?.student_id
    ? await one(`students?student_id=eq.${q(tuition.student_id)}&select=student_name,email,telegram_chat_id,class_name,board,city,pin_code`)
    : null;
  const tutor = await one(`tutors?tutor_id=eq.${q(tutorId)}&select=tutor_id,full_name,email,telegram_chat_id`);
  const me = side === "s" ? student : tutor;
  if (!tuition || !student || !tutor || !me?.email || Number(me.telegram_chat_id) !== fromId) {
    await answer("This button is not for your account. Please use the website.", true);
    return;
  }

  const decision = accept ? "accept" : "reject";
  const result = side === "s"
    ? await rpcCall("bot_respond_to_demo", { p_email: me.email, p_demo_id: demoId, p_tutor_id: tutorId, p_decision: decision })
    : await rpcCall("bot_respond_to_demo_tutor", { p_email: me.email, p_demo_id: demoId, p_decision: decision });

  if (!result?.success) {
    const message = String(result?.message ?? "Your response could not be saved.");
    const final = /no longer|already been confirmed/i.test(message);
    await setButtons(chatId, messageId, final
      ? [profileRow(side)]
      : [...demoResponseButtons(side as "s" | "t", demoId, tutorId), profileRow(side)]);
    await answer(message, true);
    return;
  }

  await setButtons(chatId, messageId, [
    [{ text: accept ? "✅ You accepted" : "❌ You rejected", callback_data: "dr:x:a:s:-:-" }],
    profileRow(side),
  ]);
  await answer(String(result.message ?? "Saved."));

  // tell the other side - the same email + Telegram message as from the website
  try {
    const subject = String(tuition.subject ?? "");
    if (side === "s") {
      await notify(tutor.email, parentResponseMail({
        name: tutor.full_name, demoId, subject, studentName: student.student_name,
        cls: student.class_name, board: student.board, city: student.city, pin: student.pin_code, accepted: accept,
      }));
    } else {
      await notify(student.email, tutorResponseMail({
        name: student.student_name, demoId, subject, tutorName: tutor.full_name, tutorId: tutor.tutor_id, accepted: accept,
      }));
    }
  } catch (err) {
    console.error("demo response notify failed", String(err));
  }
}

/* ---- linking a logged-in student / tutor to their Telegram chat ---- */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
}

// Telegram's check for Mini App initData; returns the Telegram user id or null.
async function telegramUserId(initData: string): Promise<number | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), BOT_TOKEN);
  const mine = [...await hmac(secret, check)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (mine !== hash) return null;
  const age = Date.now() / 1000 - Number(params.get("auth_date") ?? 0);
  if (!(age < 7 * 24 * 3600)) return null;
  try {
    const id = Number(JSON.parse(params.get("user") ?? "{}").id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

async function loginEmail(token: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!res.ok) return "";
  const user = await res.json().catch(() => null);
  return String(user?.email ?? "").trim().toLowerCase();
}

// saves the chat on every student / tutor record with this exact email
async function saveChat(table: "students" | "tutors", idColumn: string, email: string, chatId: number): Promise<number> {
  const rows = await db(`${table}?email=ilike.${encodeURIComponent(email)}&select=${idColumn},email`) ?? [];
  const ids = rows.filter((r: Json) => String(r.email ?? "").trim().toLowerCase() === email).map((r: Json) => r[idColumn]);
  if (!ids.length) return 0;
  await db(`${table}?${idColumn}=in.(${ids.map((x: string) => encodeURIComponent(`"${x}"`)).join(",")})`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ telegram_chat_id: chatId }),
  });
  return ids.length;
}

async function link(req: Request): Promise<Response> {
  const reply = (body: Json, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const body = await req.json().catch(() => ({}));
  const chatId = await telegramUserId(String(body?.initData ?? ""));
  if (!chatId) return reply({ ok: false, message: "Not opened from Telegram." }, 400);
  const email = token ? await loginEmail(token) : "";
  if (!email) return reply({ ok: false, message: "Please log in first." }, 401);
  const students = await saveChat("students", "student_id", email, chatId);
  const tutors = await saveChat("tutors", "tutor_id", email, chatId);
  return reply({ ok: true, students, tutors });
}

async function setup(): Promise<Response> {
  if (!BOT_TOKEN) return json({ ok: false, message: "TELEGRAM_BOT_TOKEN is not set in Supabase Edge Function secrets." }, 500);
  const webhook = await telegram("setWebhook", {
    url: WEBHOOK_URL,
    secret_token: await webhookSecret(),
    allowed_updates: ["message", "callback_query"],
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

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false }, 405);
  if (!BOT_TOKEN) return json({ ok: false }, 500);

  if (url.searchParams.get("link") === "1") {
    try {
      return await link(req);
    } catch (err) {
      console.error("telegram link failed", String(err));
      return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }
  }

  // only Telegram knows the secret header
  if (req.headers.get("x-telegram-bot-api-secret-token") !== await webhookSecret()) {
    return json({ ok: false }, 401);
  }

  try {
    const update = await req.json();
    if (update?.callback_query) {
      const cb = update.callback_query;
      if (String(cb.data ?? "").startsWith("dr:")) await onDemoButton(cb);
      else await telegram("answerCallbackQuery", { callback_query_id: cb.id });
      return json({ ok: true });
    }
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
