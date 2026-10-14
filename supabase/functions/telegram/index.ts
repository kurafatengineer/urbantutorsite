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

import { notify, notifyIfMatched, demoResponseButtons, studentQuiet, tutorQuiet } from "../_shared/telegram.ts";
import { handleInput, startRegistration, type Out } from "../_shared/regflow.ts";
import { inList, loadLife, q, rest as db } from "../_shared/botdata.ts";
import { SITE_URL } from "../_shared/constants.ts";
import { parentResponseMail, tutorResponseMail, fmtDate, fmtTime, modeText, classReminderMail, classConfirmMail, classDoneMail, contactLine } from "../_shared/mails.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
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
    reply_markup: { inline_keyboard: [[studentButton], [tutorButton], [{ text: "📝 Register as Student here in chat", callback_data: "rg:start" }]] },
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
  // (or, once both have accepted, "Tuition Confirmed" to both)
  try {
    const subject = String(tuition.subject ?? "");
    if (accept && await notifyIfMatched(demoId, tutorId)) {
      // done
    } else if (side === "s") {
      await notify(tutor.email, parentResponseMail({
        name: tutor.full_name, demoId, subject, studentName: student.student_name,
        cls: student.class_name, board: student.board, city: student.city, pin: student.pin_code, accepted: accept,
      }));
    } else if (!(await studentQuiet(tuition.student_id))) {
      await notify(student.email, tutorResponseMail({
        name: student.student_name, demoId, subject, tutorName: tutor.full_name, tutorId: tutor.tutor_id, accepted: accept,
      }));
    }
  } catch (err) {
    console.error("demo response notify failed", String(err));
  }
}


/* ---- the menu a linked student / tutor gets when they say "hi" ----
   Linked as a student only -> the student menu; as a tutor only -> the tutor menu; as both -> they first
   pick which one to act as. The menu lists their live tuitions (running, applied, demo scheduled ...);
   tapping one shows its details (for a student: which tutors applied). One button switches ALL their
   notifications (email + Telegram) off / on. callback_data "m:<action>:<s|t>[:<demoId>]":
   h = home, r = choose role, t = a tuition, n = toggle notifications */


/* ---- "register as a student" in the chat (the flow itself lives in _shared/regflow.ts) ----
   callback "rg:start"        starts it;  "rg:<choice>"  a tapped answer (gender, I agree, Submit ...)
   free text / shared contact while a registration is open are answers to the current question. */

async function sendOut(chatId: number, out: Out) {
  const message: Json = { chat_id: chatId, text: out.text, disable_web_page_preview: true };
  if (out.askPhone) {
    message.reply_markup = { keyboard: [[{ text: "📱 Share my number", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
  } else if (out.choices?.length) {
    message.reply_markup = { inline_keyboard: out.choices.map((c) => [{ text: c.title, callback_data: `rg:${c.id}` }]) };
  } else {
    message.reply_markup = { remove_keyboard: true };
  }
  await telegram("sendMessage", message);
}
async function sendAll(chatId: number, outs: Out[]) { for (const o of outs) await sendOut(chatId, o); }

async function onRegButton(cb: Json) {
  const chatId = Number(cb.message?.chat?.id ?? 0);
  const messageId = Number(cb.message?.message_id ?? 0);
  const fromId = Number(cb.from?.id ?? 0);
  const choice = String(cb.data ?? "").slice(3);
  const answer = () => telegram("answerCallbackQuery", { callback_query_id: cb.id });
  if (!chatId || chatId !== fromId) { await answer(); return; }
  const ctx = { channel: "tg" as const, key: String(chatId), telegramChatId: chatId };
  if (choice === "start") {
    await answer();
    await sendAll(chatId, await startRegistration(ctx));
    return;
  }
  // the tapped buttons go away, so an answer can't be given twice
  if (messageId) await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
  await answer();
  const outs = await handleInput(ctx, { choice });
  if (outs) await sendAll(chatId, outs);
}


async function linked(chatId: number): Promise<{ students: Json[]; tutors: Json[] }> {
  const students = await db(`students?telegram_chat_id=eq.${chatId}&select=student_id,student_name,notifications_off,blocked_at`) ?? [];
  const tutors = await db(`tutors?telegram_chat_id=eq.${chatId}&select=tutor_id,full_name,notifications_off,blocked_at`) ?? [];
  return { students, tutors };
}

// where one tutor's application stands (rejected / declined ones are left out by the callers)
function nicePlace(parts: Json[]): string {
  return parts.map((x) => String(x ?? "").trim()).filter(Boolean).join(" - ");
}

// Telegram centres button text; padding it with invisible braille blanks pushes the words to the left
const leftPad = (t: string, width = 34) => t + "\u2800".repeat(Math.max(0, width - [...t].length));

const CATS: Record<string, string> = { running: "✅ Running", scheduled: "📅 Demo Scheduled", new: "", completed: "🏁 Completed" };
const CAT_ORDER = ["running", "scheduled", "new", "completed"];
const catLabel = (role: "s" | "t", cat: string) => cat === "new" ? (role === "s" ? "🔎 Finding Tutor" : "📨 Applied") : CATS[cat];

async function menuContent(chatId: number, role: "s" | "t"): Promise<{ text: string; rows: Json[][] } | null> {
  const { students, tutors } = await linked(chatId);
  const mine = role === "s" ? students : tutors;
  if (!mine.length) return null;
  const both = !!(students.length && tutors.length);
  const off = mine.every((r) => r.notifications_off === true || r.blocked_at);
  const name = String(role === "s" ? mine[0].student_name : mine[0].full_name ?? "");
  const life = await loadLife(role, mine.map((r) => String(r[role === "s" ? "student_id" : "tutor_id"])));

  const rows: Json[][] = [];
  for (const cat of CAT_ORDER) {
    const n = life.filter((l) => l.cat === cat).length;
    if (n) rows.push([{ text: leftPad(`${catLabel(role, cat)} (${n})`), callback_data: `m:c:${role}:${cat}` }]);
  }
  if (both) rows.push([{ text: leftPad(role === "s" ? "🔁 Switch to Tutor" : "🔁 Switch to Student"), callback_data: `m:h:${role === "s" ? "t" : "s"}` }]);
  rows.push([{ text: leftPad(off ? "🔕 Notifications OFF - Tap to turn ON" : "🔔 Notifications ON - Tap to turn OFF"), callback_data: `m:n:${role}` }]);
  rows.push([{ text: leftPad("👤 Open My Profile"), web_app: profileRow(role)[0].web_app }]);

  const text =
    `👋 Hi ${escapeHtml(name || "there")}!\n` +
    `<b>${role === "s" ? "🎓 Student" : "👨‍🏫 Tutor"} menu</b>\n\n` +
    (life.length
      ? `${role === "s" ? "Your tuitions" : "Tuitions you applied for"} - tap one to see its details.`
      : role === "s" ? "You have no live tuitions right now." : "You have not applied for any tuition yet.") +
    `\n\n${off ? "🔕 Notifications are OFF (no email, no Telegram)." : "🔔 Notifications are ON."}`;
  return { text, rows };
}

async function showText(chatId: number, messageId: number | null, text: string, rows: Json[][]) {
  const message = { parse_mode: "HTML", text, reply_markup: { inline_keyboard: rows }, disable_web_page_preview: true };
  if (messageId) {
    const done = await telegram("editMessageText", { chat_id: chatId, message_id: messageId, ...message });
    if (done?.ok || /not modified/i.test(String(done?.description ?? ""))) return;
  }
  await sendReplacing(chatId, message);
}

async function showMenu(chatId: number, role: "s" | "t", messageId: number | null) {
  const menu = await menuContent(chatId, role);
  if (!menu) return false;
  await showText(chatId, messageId, menu.text, menu.rows);
  return true;
}

// "hi" (or any text) from someone: menu if linked, otherwise the register / login buttons
async function home(chatId: number, firstName: string) {
  const { students, tutors } = await linked(chatId);
  if (students.length && tutors.length) {
    await sendReplacing(chatId, {
      parse_mode: "HTML",
      text: `👋 Hi${firstName ? ` ${escapeHtml(firstName)}` : ""}! You are registered as both a student and a tutor.\n\nWhich one do you want to use now?`,
      reply_markup: { inline_keyboard: [
        [{ text: leftPad("🎓 Act as Student"), callback_data: "m:h:s" }],
        [{ text: leftPad("👨‍🏫 Act as Tutor"), callback_data: "m:h:t" }],
      ] },
    });
    return;
  }
  if (students.length) { await showMenu(chatId, "s", null); return; }
  if (tutors.length) { await showMenu(chatId, "t", null); return; }
  await greet(chatId, firstName);
}

const minutesText = (a: Json): string => {
  const m = Number(a?.billing_plan?.deal?.minutes ?? a?.class_duration ?? 0);
  return m > 0 ? `${m} min` : "-";
};
const timeText = (a: Json): string => {
  const t = String(a?.billing_plan?.deal?.time ?? "").trim();
  return t ? fmtTime(t) : "-";
};

// the list a category button opens: a few basic lines per tuition
async function showCategory(chatId: number, messageId: number, role: "s" | "t", cat: string) {
  const back = [{ text: leftPad("⬅️ Back"), callback_data: `m:h:${role}` }];
  const { students, tutors } = await linked(chatId);
  const mine = role === "s" ? students : tutors;
  const life = (await loadLife(role, mine.map((r) => String(r[role === "s" ? "student_id" : "tutor_id"])))).filter((l) => l.cat === cat);
  if (!life.length) { await showText(chatId, messageId, "Nothing here right now.", [back]); return; }

  const allTutors = [...new Set(life.flatMap((l) => l.tutorIds))];
  const info = role === "s" && allTutors.length
    ? await db(`tutors?tutor_id=${inList(allTutors)}&select=tutor_id,full_name,gender,experience_years`) ?? []
    : [];
  const tutorOf = (id: string) => info.find((x: Json) => x.tutor_id === id) ?? {};
  const dateLine = (a: Json) => a?.demo_date ? `${fmtDate(a.demo_date)}${a.demo_time ? ", " + fmtTime(a.demo_time) : ""}` : "-";
  const e = (v: unknown) => escapeHtml(String(v ?? ""));

  const blocks = life.map((l) => {
    const head = `📚 <b>${e(l.subject)}</b> · ${e(l.demo)}`;
    if (role === "s") {
      if (cat === "running" || cat === "completed") {
        const t = tutorOf(String(l.app?.tutor_id));
        return `${head}\n👨‍🏫 Tutor: ${e(t.full_name ?? l.app?.tutor_id)}\n⏱ Class duration: ${e(minutesText(l.app))}\n⏰ Class time: ${e(timeText(l.app))}`;
      }
      if (cat === "scheduled") {
        const t = tutorOf(String(l.app?.tutor_id));
        return `${head}\n👨‍🏫 Tutor: ${e(t.full_name ?? l.app?.tutor_id)}\n📅 Demo: ${e(dateLine(l.app))}`;
      }
      const lines = l.apps.map((a) => {
        const t = tutorOf(String(a.tutor_id));
        return `   • ${e(t.full_name ?? a.tutor_id)}${t.gender ? ` (${e(t.gender)})` : ""}`;
      });
      return `${head}\n${lines.length ? "Tutors applied:\n" + lines.join("\n") : "No tutor has applied yet."}`;
    }
    const st = l.student ?? {};
    if (cat === "running" || cat === "completed") {
      return `${head}\n👤 Student: ${e(st.student_name ?? "-")}\n⏱ Class duration: ${e(minutesText(l.app))}\n⏰ Class time: ${e(timeText(l.app))}`;
    }
    if (cat === "scheduled") return `${head}\n🏫 ${e([st.class_name, st.board].filter(Boolean).join(" · "))}\n📅 Demo: ${e(dateLine(l.app))}`;
    return `${head}\n🏫 ${e([st.class_name, st.board].filter(Boolean).join(" · "))}\n📍 ${e(nicePlace([st.city, st.pin_code]))}`;
  });
  await showText(chatId, messageId, `<b>${e(catLabel(role, cat))}</b>\n\n${blocks.join("\n\n")}`, [back]);
}

async function onMenuButton(cb: Json) {
  const chatId = Number(cb.message?.chat?.id ?? 0);
  const messageId = Number(cb.message?.message_id ?? 0);
  const fromId = Number(cb.from?.id ?? 0);
  const [, action, roleRaw, demoId] = String(cb.data ?? "").split(":");
  const answer = (text = "", alert = false) => telegram("answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: alert });
  const role = roleRaw === "t" ? "t" : "s";
  if (!chatId || !messageId || chatId !== fromId) { await answer(); return; }

  if (action === "h") {
    if (!(await showMenu(chatId, role, messageId))) await greet(chatId, String(cb.from?.first_name ?? ""));
    await answer();
  } else if (action === "c" && demoId) {
    await showCategory(chatId, messageId, role, demoId);
    await answer();
  } else if (action === "n") {
    const { students, tutors } = await linked(chatId);
    const mine = role === "s" ? students : tutors;
    if (!mine.length) { await answer("No account is linked to this chat.", true); return; }
    const turnOff = mine.some((r) => r.notifications_off !== true);
    const table = role === "s" ? "students" : "tutors";
    const col = role === "s" ? "student_id" : "tutor_id";
    await db(`${table}?${col}=${inList(mine.map((r) => String(r[col])))}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ notifications_off: turnOff }),
    });
    await showMenu(chatId, role, messageId);
    await answer(turnOff ? "Notifications are OFF - no email, no Telegram." : "Notifications are ON again.");
  } else {
    await answer();
  }
}


/* ---- class reminders (queue filled by pg_cron: class_notifications) ----
   POST ?run=1   sends what is waiting: "You have class today" 15 minutes before to the tutor and the student,
                 and "Have you taken your class today?" (with a Yes button) to the tutor once it should be over.
                 Harmless to call by anyone - it only sends what is due, once.
   callback "cl:y:<demoId>:<YYYY-MM-DD>"   the tutor taps Yes: the day is marked done (the calendar turns green)
                 and the parent is told the class took place. */

async function sendQueued(r: Json) {
  const tuition = await one(`tuitions?demo_id=eq.${q(r.demo_id)}&select=subject,student_id`);
  const student = tuition?.student_id
    ? await one(`students?student_id=eq.${q(tuition.student_id)}&select=student_id,student_name,parents_name,email,phone,whatsapp`)
    : null;
  const tutor = await one(`tutors?tutor_id=eq.${q(r.tutor_id)}&select=tutor_id,full_name,email,telegram_chat_id,mobile_number,whatsapp_number`);
  if (!tuition || !student || !tutor) return;
  const base = { demoId: String(r.demo_id), subject: String(tuition.subject ?? ""), time: String(r.class_time ?? ""), minutes: r.minutes, date: String(r.class_date) };

  if (r.kind === "reminder") {
    if (r.audience === "tutor") {
      await notify(tutor.email, classReminderMail({ ...base, forTutor: true, name: tutor.full_name, otherName: student.student_name, otherPhone: student.phone || student.whatsapp }));
    } else if (!(await studentQuiet(student.student_id))) {
      await notify(student.email, classReminderMail({ ...base, forTutor: false, name: student.parents_name || student.student_name, otherName: tutor.full_name, otherPhone: tutor.mobile_number || tutor.whatsapp_number }));
    }
    return;
  }

  // confirm: the tutor only
  if (await tutorQuiet(tutor.email)) return;
  await notify(tutor.email, classConfirmMail({ ...base, name: tutor.full_name, otherName: student.student_name, otherPhone: student.phone || student.whatsapp }), { telegram: false });
  if (tutor.telegram_chat_id) {
    await telegram("sendMessage", {
      chat_id: Number(tutor.telegram_chat_id), parse_mode: "HTML", disable_web_page_preview: true,
      text:
        `📅 <b>Class check</b>\n\nHi ${escapeHtml(String(tutor.full_name ?? "there"))}, have you taken today's class?\n\n` +
        `🆔 ${escapeHtml(base.demoId)}\n📚 ${escapeHtml(base.subject)}\n` +
        (r.minutes ? `⏱ ${r.minutes} minutes\n` : "") + (base.time ? `⏰ ${fmtTime(base.time)}\n` : "") +
        `\nTap <b>Yes</b> to confirm.\n${escapeHtml(contactLine(true, student.phone || student.whatsapp))}`,
      reply_markup: { inline_keyboard: [
        [{ text: "✅ Yes, I took the class", callback_data: `cl:y:${r.demo_id}:${r.class_date}` }],
        profileRow("t"),
      ] },
    });
  }
}

async function runQueue(): Promise<Response> {
  const rows = await db("class_notifications?sent_at=is.null&order=id.asc&limit=40&select=*") ?? [];
  let sent = 0;
  for (const r of rows) {
    // claim the row first, so two runs never send the same message twice
    const claimed = await db(`class_notifications?id=eq.${r.id}&sent_at=is.null`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ sent_at: new Date().toISOString() }),
    });
    if (!claimed?.length) continue;
    try { await sendQueued(r); sent++; } catch (err) { console.error("class notification failed", String(err)); }
  }
  return json({ ok: true, sent });
}

async function onClassButton(cb: Json) {
  const chatId = Number(cb.message?.chat?.id ?? 0);
  const messageId = Number(cb.message?.message_id ?? 0);
  const fromId = Number(cb.from?.id ?? 0);
  const [, step, demoId, date] = String(cb.data ?? "").split(":");
  const answer = (text = "", alert = false) => telegram("answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: alert });
  if (step !== "y" || !chatId || !messageId || !demoId || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) { await answer(); return; }

  const tutors = await db(`tutors?telegram_chat_id=eq.${fromId}&select=tutor_id,email,full_name`) ?? [];
  let result: Json = { success: false, message: "This button is not for your account. Please use the website." };
  let who: Json | null = null;
  for (const t of tutors) {
    const res = await rpcCall("bot_mark_class", { p_email: t.email, p_demo_id: demoId, p_date: date });
    if (res?.success) { result = res; who = t; break; }
    if (!/not on your account/i.test(String(res?.message ?? ""))) result = res;
  }
  if (!result?.success) { await answer(String(result?.message ?? "Could not save."), true); return; }

  await setButtons(chatId, messageId, [[{ text: "✅ Marked as taken", callback_data: "cl:x:-:-" }], profileRow("t")]);
  await answer("Saved. Thank you!");
  if (result.already) return;

  // tell the parent the class took place
  try {
    const student = result.studentId
      ? await one(`students?student_id=eq.${q(String(result.studentId))}&select=student_id,student_name,parents_name,email`)
      : null;
    const tp = who?.tutor_id ? await one(`tutors?tutor_id=eq.${q(String(who.tutor_id))}&select=mobile_number,whatsapp_number`) : null;
    if (student?.email && !(await studentQuiet(student.student_id))) {
      await notify(student.email, classDoneMail({
        tutorPhone: tp?.mobile_number || tp?.whatsapp_number, name: student.parents_name || student.student_name, tutorName: String(result.tutorName ?? ""), demoId,
        subject: String(result.subject ?? ""), time: result.time, minutes: result.minutes, date,
      }));
    }
  } catch (err) {
    console.error("class done notify failed", String(err));
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
  const rows = await db(`${table}?email_lc=eq.${encodeURIComponent(email)}&select=${idColumn},email`) ?? [];
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

  // the queue sender: only sends what is due, once - safe for anyone to wake
  if (url.searchParams.get("run") === "1") return await runQueue();

  // only Telegram knows the secret header
  if (req.headers.get("x-telegram-bot-api-secret-token") !== await webhookSecret()) {
    return json({ ok: false }, 401);
  }

  try {
    const update = await req.json();
    if (update?.callback_query) {
      const cb = update.callback_query;
      if (String(cb.data ?? "").startsWith("dr:")) await onDemoButton(cb);
      else if (String(cb.data ?? "").startsWith("m:")) await onMenuButton(cb);
      else if (String(cb.data ?? "").startsWith("cl:")) await onClassButton(cb);
      else if (String(cb.data ?? "").startsWith("rg:")) await onRegButton(cb);
      else await telegram("answerCallbackQuery", { callback_query_id: cb.id });
      return json({ ok: true });
    }
    const msg = update?.message;
    // private chats only; groups are ignored
    if (msg?.chat?.id && msg.chat.type === "private") {
      // keep the chat clean: whatever the user sent is removed
      if (msg.message_id) await telegram("deleteMessage", { chat_id: msg.chat.id, message_id: msg.message_id });
      const command = String(msg.text ?? "").trim().split(/[\s@]/)[0].toLowerCase();
      const first = String(msg.from?.first_name ?? "");
      // an open registration: what was typed / shared answers the current question (commands are not answers)
      if (!command.startsWith("/")) {
        const ctx = { channel: "tg" as const, key: String(msg.chat.id), telegramChatId: Number(msg.chat.id) };
        // a contact only counts when it is the sender's own
        const own = msg.contact && Number(msg.contact.user_id) === Number(msg.from?.id);
        const outs = await handleInput(ctx, { text: String(msg.text ?? ""), contactPhone: own ? String(msg.contact.phone_number ?? "") : "" });
        if (outs) { await sendAll(msg.chat.id, outs); return json({ ok: true }); }
      }
      if (command === "/student") {
        if (!(await showMenu(msg.chat.id, "s", null))) await sendOne(msg.chat.id, false);
      } else if (command === "/tutor") {
        if (!(await showMenu(msg.chat.id, "t", null))) await sendOne(msg.chat.id, true);
      } else await home(msg.chat.id, first);
    }
  } catch (err) {
    console.error("telegram update failed", String(err));
  }

  // always 200, so Telegram doesn't keep re-sending the same update
  return json({ ok: true });
});
