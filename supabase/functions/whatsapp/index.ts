// WhatsApp Cloud API bot (test phase): the same student / tutor menu that the Telegram bot has.
// Secrets (Supabase > Edge Functions > Secrets): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN,
// and optionally WHATSAPP_APP_SECRET (when set, every incoming call must carry a valid Meta signature).
import { SITE_URL } from "../_shared/constants.ts";
import { handleInput, startRegistration, type Out } from "../_shared/regflow.ts";
import { startTuition } from "../_shared/tuitionflow.ts";
import { accountsByPhone, inList, last10, loadLife, rest } from "../_shared/botdata.ts";
import { demoDetail, findingDetail, people, runningDetail } from "../_shared/classinfo.ts";

type Json = Record<string, any>;

const TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const VERIFY = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const patch = (path: string, body: Json) =>
  rest(path, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body) });

async function send(to: string, message: Json) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, ...message }),
  });
  if (!res.ok) console.error("whatsapp send failed", res.status, await res.text().catch(() => ""));
}
// Replies from the registration flow: up to 3 choices become buttons, more become a list.
async function sendOut(to: string, out: Out) {
  const choices = out.choices ?? [];
  if (out.link && !choices.length) {
    // WhatsApp has no text hyperlinks; a "cta_url" button opens the page instead.
    await send(to, {
      type: "interactive",
      interactive: {
        type: "cta_url", body: { text: out.text.slice(0, 1024) },
        action: { name: "cta_url", parameters: { display_text: out.link.label.slice(0, 20), url: out.link.url } },
      },
    });
    return;
  }
  if (!choices.length) { await sendText(to, out.text); return; }
  const text = out.text.slice(0, 1024);
  if (choices.length <= 3) {
    await send(to, {
      type: "interactive",
      interactive: { type: "button", body: { text }, action: { buttons: choices.map((c) => ({ type: "reply", reply: { id: `reg|${c.id}`, title: c.title.slice(0, 20) } })) } },
    });
    return;
  }
  await send(to, {
    type: "interactive",
    interactive: { type: "list", body: { text }, action: { button: "Choose", sections: [{ title: "Options", rows: choices.slice(0, 10).map((c) => ({ id: `reg|${c.id}`, title: c.title.slice(0, 24), ...(c.description ? { description: c.description.slice(0, 72) } : {}) })) }] } },
  });
}
async function sendAll(to: string, outs: Out[]) { for (const o of outs) await sendOut(to, o); }

const sendText = (to: string, body: string) => send(to, { type: "text", text: { body, preview_url: false } });

// Meta signs the raw body with the app secret: X-Hub-Signature-256: sha256=<hex>
async function validSignature(raw: string, header: string | null) {
  if (!APP_SECRET) return true;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const mine = "sha256=" + [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  return !!header && header.length === mine.length && header === mine;
}

// ---- who is this number? (WhatsApp has already verified it belongs to the sender) ----

// ---- menu labels (the tuition lifecycle itself is in _shared/botdata.ts) ----
const CAT_ORDER = ["running", "new", "scheduled"];
const catLabel = (role: string, cat: string) =>
  cat === "running" ? "Running Classes" : cat === "scheduled" ? "Demo Scheduled" : role === "s" ? "Finding Tutor" : "Applied";

const lifeOf = (role: string, accounts: { students: Json[]; tutors: Json[] }) =>
  loadLife(role, (role === "s" ? accounts.students : accounts.tutors).map((r) => String(r[role === "s" ? "student_id" : "tutor_id"])));

// ---- screens ----
async function showMenu(to: string, role: string, accounts: { students: Json[]; tutors: Json[] }) {
  const mine = role === "s" ? accounts.students : accounts.tutors;
  const life = await lifeOf(role, accounts);
  const off = mine.every((r) => r.notifications_off === true || r.blocked_at);
  const rows: Json[] = [];
  for (const cat of CAT_ORDER) {
    const n = life.filter((l) => l.cat === cat).length;
    if (n) rows.push({ id: `c:${role}:${cat}`, title: `${catLabel(role, cat)} (${n})`.slice(0, 24) });
  }
  rows.push(role === "s" ? { id: "a:s", title: "Apply for New Tuition" } : { id: "a:t", title: "Find New Tuitions" });
  if (accounts.students.length && accounts.tutors.length) {
    rows.push({ id: `h:${role === "s" ? "t" : "s"}`, title: role === "s" ? "Switch to Tutor" : "Switch to Student" });
  }
  rows.push({ id: `n:${role}`, title: off ? "Turn ON Notifications" : "Turn OFF Notifications" });
  const idCol = role === "s" ? "student_id" : "tutor_id";
  const names = mine.map((r) => `*${String((role === "s" ? r.student_name : r.full_name) || "-")}* (${r[idCol]})`);
  const body = `Hi,\n${names.join("\n")}\n\nOpen the *Menu* to see the details.`;
  await send(to, {
    type: "interactive",
    interactive: {
      type: "list", body: { text: body.slice(0, 1024) }, footer: { text: "Urban Tutor Site" },
      action: { button: "Menu", sections: [{ title: "Menu", rows: rows.slice(0, 10) }] },
    },
  });
}

const MENU_HINT = "\n\nSend *Hi* any time for the menu.";

async function showCategory(to: string, role: string, cat: string, accounts: { students: Json[]; tutors: Json[] }, sid = "") {
  let life = (await lifeOf(role, accounts)).filter((l) => l.cat === cat);
  if (!life.length) { await sendText(to, "Nothing here right now." + MENU_HINT); return; }
  // more than one child with tuitions here: ask whose details first
  const sids = [...new Set(life.map((l) => l.sid))];
  if (role === "s" && !sid && sids.length > 1) {
    const kids = accounts.students.filter((s) => sids.includes(String(s.student_id)));
    const text = `*${catLabel(role, cat)}*\n\nWhose details do you want to see?\n\n` +
      kids.map((s) => `${s.student_name} (${s.student_id})`).join("\n");
    await send(to, kids.length <= 3
      ? { type: "interactive", interactive: { type: "button", body: { text },
          action: { buttons: kids.map((s) => ({ type: "reply", reply: { id: `c:s:${cat}:${s.student_id}`, title: String(s.student_name || s.student_id).slice(0, 20) } })) } } }
      : { type: "interactive", interactive: { type: "list", body: { text },
          action: { button: "Students", sections: [{ title: "Students", rows: kids.slice(0, 10).map((s) => ({ id: `c:s:${cat}:${s.student_id}`, title: String(s.student_name || s.student_id).slice(0, 24), description: String(s.student_id) })) }] } } });
    return;
  }
  if (sid) life = life.filter((l) => l.sid === sid);
  if (!life.length) { await sendText(to, "Nothing here right now." + MENU_HINT); return; }
  // more than one running class: pick one first
  if (cat === "running" && life.length > 1) {
    await send(to, {
      type: "interactive",
      interactive: {
        type: "list", body: { text: "*Running Classes*\n\nWhich class do you want to see?" },
        action: { button: "Classes", sections: [{ title: "Running Classes", rows: life.slice(0, 10).map((l) => ({ id: `r:${role}:${l.demo}`, title: l.subject.slice(0, 24), description: l.demo })) }] },
      },
    });
    return;
  }
  const who = await people(role, life);
  if (cat === "running") { await sendText(to, runningDetail(role, life[0], who) + MENU_HINT); return; }
  const blocks = life.map((l) => cat === "scheduled" ? demoDetail(role, l, who)
    : role === "s" ? findingDetail(l, who)
    : `*${l.subject}* (${l.demo})\n${[l.student?.class_name, l.student?.board].filter(Boolean).join(" · ")}`);
  await sendText(to, `*${catLabel(role, cat)}*\n\n${blocks.join("\n\n")}` + MENU_HINT);
}

async function showRunning(to: string, role: string, demo: string, accounts: { students: Json[]; tutors: Json[] }) {
  const l = (await lifeOf(role, accounts)).find((x) => x.cat === "running" && x.demo === demo);
  if (!l) { await sendText(to, "That class was not found." + MENU_HINT); return; }
  await sendText(to, runningDetail(role, l, await people(role, [l])) + MENU_HINT);
}

async function onMessage(m: Json) {
  const from = String(m.from ?? "");
  if (!from) return;
  const picked = String(m.interactive?.list_reply?.id ?? m.interactive?.button_reply?.id ?? "");

  // "register as a student" chat flow
  const reg = { channel: "wa" as const, key: last10(from), verifiedPhone: from };
  const regChoice = picked.startsWith("reg|") ? picked.slice(4) : "";
  if (regChoice === "start") { await sendAll(from, await startRegistration(reg)); return; }
  const inFlow = await handleInput(reg, { text: m.type === "text" ? String(m.text?.body ?? "") : "", choice: regChoice });
  if (inFlow) { await sendAll(from, inFlow); return; }

  const accounts = await accountsByPhone(from);
  if (!accounts.students.length && !accounts.tutors.length) {
    await send(from, {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Hi! 👋\n\nWelcome to *Urban Tutor Site*.\n\nFind the right tutor for your learning needs.\n\nParents & Students can register right here on WhatsApp in just 2 minutes.\n\nLet's get started!" },
        action: { buttons: [{ type: "reply", reply: { id: "reg|start", title: "Register as Student" } }] },
      },
    });
    return;
  }
  const [action, roleRaw, cat, sid] = picked.split(":");
  const role = roleRaw === "t" && accounts.tutors.length ? "t" : roleRaw === "s" && accounts.students.length ? "s" : accounts.students.length ? "s" : "t";

  if (action === "n") {
    const mine = role === "s" ? accounts.students : accounts.tutors;
    const turnOff = mine.some((r) => r.notifications_off !== true);
    const table = role === "s" ? "students" : "tutors";
    const col = role === "s" ? "student_id" : "tutor_id";
    await patch(`${table}?${col}=${inList(mine.map((r) => String(r[col])))}`, { notifications_off: turnOff });
    await sendText(from, turnOff ? "Your notifications are *OFF* now.\n(No email, WhatsApp or Telegram messages.)\n\nSend *Hi* any time for the menu." : "Your notifications are *ON* again.\n\nSend *Hi* any time for the menu.");
    return;
  }
  if (action === "a" && role === "s") { await sendAll(from, await startTuition(reg, accounts.students)); return; }
  if (action === "a") {
    await sendOut(from, { text: "*Find New Tuitions*\nTap the button below to see the tuitions you can apply for.\n\nSend *Hi* any time for the menu.", link: { label: "Open Website", url: `${SITE_URL}/advertisement.html` } });
    return;
  }
  if (action === "c" && cat) { await showCategory(from, role, cat, accounts, sid ?? ""); return; }
  if (action === "r" && cat) { await showRunning(from, role, cat, accounts); return; }
  if (accounts.students.length && accounts.tutors.length && action !== "h") {
    await send(from, {
      type: "interactive",
      interactive: {
        type: "button", body: { text: "You are registered as both a student and a tutor. Which one do you want to use now?" },
        action: { buttons: [{ type: "reply", reply: { id: "h:s", title: "Act as Student" } }, { type: "reply", reply: { id: "h:t", title: "Act as Tutor" } }] },
      },
    });
    return;
  }
  await showMenu(from, role, accounts);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    // Meta's webhook check
    if (url.searchParams.get("hub.mode") === "subscribe" && VERIFY && url.searchParams.get("hub.verify_token") === VERIFY) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return json({ ok: true, bot: "whatsapp" }, url.searchParams.has("hub.mode") ? 403 : 200);
  }
  if (req.method !== "POST") return json({ ok: false }, 405);
  if (!TOKEN || !PHONE_ID) return json({ ok: false, message: "WhatsApp secrets are not set." }, 500);

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("x-hub-signature-256")))) return json({ ok: false }, 401);
  try {
    const body = JSON.parse(raw);
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const m of change?.value?.messages ?? []) await onMessage(m);
      }
    }
  } catch (err) {
    console.error("whatsapp update failed", String(err));
  }
  return json({ ok: true });
});
