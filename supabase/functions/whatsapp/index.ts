// WhatsApp Cloud API bot (test phase): the same student / tutor menu that the Telegram bot has.
// Secrets (Supabase > Edge Functions > Secrets): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN,
// and optionally WHATSAPP_APP_SECRET (when set, every incoming call must carry a valid Meta signature).
import { SITE_URL } from "../_shared/constants.ts";
import { handleInput, startAddChild, startRegistration, type Out } from "../_shared/regflow.ts";
import { startTuition } from "../_shared/tuitionflow.ts";
import { startApply } from "../_shared/applyflow.ts";
import { accountsByPhone, employeeByPhone, inList, last10, loadLife, pickerText, rest } from "../_shared/botdata.ts";
import { adminMenuRows, startAdminFlow, whoAmI, type AdminKind } from "../_shared/adminflow.ts";
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
type Accounts = { students: Json[]; tutors: Json[] };
const kidName = (s: Json) => String(s.student_name || s.student_id);
const ADD_CHILD = "Add New Child";

// More than one child on this number / email: ask who the parent wants to talk about.
async function showPicker(to: string, accounts: Accounts) {
  const kids = accounts.students;
  const text = pickerText(kids).slice(0, 1024);
  const rows = [...kids.map((s) => ({ id: `k:s:${s.student_id}`, title: kidName(s) })), { id: "nc:s", title: ADD_CHILD }];
  await send(to, kids.length <= 2
    ? { type: "interactive", interactive: { type: "button", body: { text },
        action: { buttons: rows.map((r) => ({ type: "reply", reply: { id: r.id, title: r.title.slice(0, 20) } })) } } }
    : { type: "interactive", interactive: { type: "list", body: { text },
        action: { button: "Students", sections: [{ title: "Students", rows: rows.slice(0, 10).map((r) => ({ ...r, title: r.title.slice(0, 24) })) }] } } });
}

// The menu of one tutor, one student (sid), or the only student on the number.
// A number can belong to an employee (a), a parent (s) and a tutor (t) at once - rare, but it happens.
const SWITCH_TO: Record<string, string> = { a: "Switch to Admin", s: "Switch to Student", t: "Switch to Tutor" };
const ACT_AS: Record<string, string> = { a: "Act as Admin", s: "Act as Student", t: "Act as Tutor" };
const ROLE_WORDS: Record<string, string> = { a: "an *admin*", s: "a *student*", t: "a *tutor*" };

async function showAdminMenu(to: string, employeeId: string, roles: string[]) {
  const me = await whoAmI(employeeId);
  if (!me.ok) { await sendText(to, `${me.message}\n\nSend *Hi* any time for the menu.`); return; }
  const rows: Json[] = adminMenuRows(me.perms).map((r) => ({ id: r.id, title: r.title }));
  for (const other of roles.filter((r) => r !== "a")) rows.push({ id: `h:${other}`, title: SWITCH_TO[other] });
  if (!adminMenuRows(me.perms).length) {
    await sendText(to, `Hi,\n*${me.name}*\n\nYour account has no admin work on WhatsApp yet.\nAsk the Super Admin to give you the permissions.`);
    if (!rows.length) return;
  }
  await send(to, {
    type: "interactive",
    interactive: {
      type: "list", body: { text: `Hi,\n*${me.name}* (Admin)\n\nOpen the *Menu* to see what you can do.`.slice(0, 1024) },
      action: { button: "Menu", sections: [{ title: "Admin Menu", rows: rows.slice(0, 10) }] },
    },
  });
}

async function showMenu(to: string, role: string, accounts: Accounts, sid = "", many = false, roles: string[] = []) {
  const mine = role === "s" ? accounts.students : accounts.tutors;
  const tag = sid ? `:${sid}` : "";
  const life = await lifeOf(role, accounts);
  const off = mine.every((r) => r.notifications_off === true || r.blocked_at);
  const rows: Json[] = [];
  for (const cat of CAT_ORDER) {
    const n = life.filter((l) => l.cat === cat).length;
    if (n) rows.push({ id: `c:${role}:${cat}${tag}`, title: `${catLabel(role, cat)} (${n})`.slice(0, 24) });
  }
  rows.push(role === "s" ? { id: `a:s${tag}`, title: "Apply for New Tuition" } : { id: "a:t", title: "Find New Tuitions" });
  if (role === "t") rows.push({ id: "ap:t", title: "Apply for New Tuition" });
  rows.push({ id: `n:${role}${tag}`, title: off ? "Turn ON Notifications" : "Turn OFF Notifications" });
  if (role === "s") rows.push({ id: "nc:s", title: ADD_CHILD });
  if (many) rows.push({ id: "k:s", title: "Switch Student" });
  for (const other of roles.filter((r) => r !== role)) rows.push({ id: `h:${other}`, title: SWITCH_TO[other] });
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


async function showCategory(to: string, role: string, cat: string, accounts: Accounts, sid = "") {
  let life = (await lifeOf(role, accounts)).filter((l) => l.cat === cat);
  if (!life.length) { await sendText(to, "Nothing here right now."); return; }
  if (sid) life = life.filter((l) => l.sid === sid);
  if (!life.length) { await sendText(to, "Nothing here right now."); return; }
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
  if (cat === "running") { await sendText(to, runningDetail(role, life[0], who)); return; }
  const blocks = life.map((l) => cat === "scheduled" ? demoDetail(role, l, who)
    : role === "s" ? findingDetail(l, who)
    : `*${l.subject}* (${l.demo})\n${[l.student?.class_name, l.student?.board].filter(Boolean).join(" · ")}`);
  await sendText(to, `*${catLabel(role, cat)}*\n\n${blocks.join("\n\n")}`);
}

async function showRunning(to: string, role: string, demo: string, accounts: { students: Json[]; tutors: Json[] }) {
  const l = (await lifeOf(role, accounts)).find((x) => x.cat === "running" && x.demo === demo);
  if (!l) { await sendText(to, "That class was not found."); return; }
  await sendText(to, runningDetail(role, l, await people(role, [l])));
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
  // An employee is recognised by their Mobile / WhatsApp number - and only when Meta's signature on the call is
  // checked (WHATSAPP_APP_SECRET), because admin work must never rest on a message that could have been faked.
  const employee = APP_SECRET ? await employeeByPhone(from) : null;
  const roles = [employee ? "a" : "", accounts.students.length ? "s" : "", accounts.tutors.length ? "t" : ""].filter(Boolean);
  if (!roles.length) {
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
  const [action, roleRaw, ...rest3] = picked.split(":");
  const role = roles.includes(roleRaw) ? roleRaw : roles.includes("s") ? "s" : roles.includes("t") ? "t" : "a";
  const arg = rest3[0] ?? "";
  if (action === "ad" && employee && ["new", "assign", "demo", "conf", "pay", "student", "deal"].includes(roleRaw)) {
    await sendAll(from, await startAdminFlow(reg, employee.id, roleRaw as AdminKind));
    return;
  }
  if (action === "r" && arg) { await showRunning(from, role, arg, accounts); return; }
  if (action === "ap" && accounts.tutors.length) { await sendAll(from, await startApply(reg, accounts.tutors)); return; }
  if (action === "nc" && accounts.students.length) { await sendAll(from, await startAddChild(reg, accounts.students)); return; }
  const cat = action === "c" ? arg : "";
  const asked = action === "c" ? rest3[1] ?? "" : arg;
  // one child at a time: the chosen one, or the only one
  const many = accounts.students.length > 1;
  const kid = accounts.students.find((s) => String(s.student_id) === asked) ?? (many ? null : accounts.students[0] ?? null);
  const sid = kid && many ? String(kid.student_id) : "";
  const scoped: Accounts = kid ? { students: [kid], tutors: accounts.tutors } : accounts;

  if (role === "s" && many && !kid && ["k", "c", "n", "a"].includes(action)) { await showPicker(from, accounts); return; }
  if (action === "k" && kid) { await showMenu(from, "s", scoped, sid, many, roles); return; }
  if (action === "n") {
    const mine = role === "s" ? scoped.students : accounts.tutors;
    const turnOff = mine.some((r) => r.notifications_off !== true);
    const table = role === "s" ? "students" : "tutors";
    const col = role === "s" ? "student_id" : "tutor_id";
    await patch(`${table}?${col}=${inList(mine.map((r) => String(r[col])))}`, { notifications_off: turnOff });
    const who = role === "s" && many ? ` for *${kidName(kid!)}*` : "";
    await sendText(from, turnOff ? `Notifications${who} are *OFF* now.\n(No email, WhatsApp or Telegram messages.)\n\nSend *Hi* any time for the menu.` : `Notifications${who} are *ON* again.\n\nSend *Hi* any time for the menu.`);
    return;
  }
  if (action === "a" && role === "s") { await sendAll(from, await startTuition(reg, scoped.students)); return; }
  if (action === "a") {
    await sendOut(from, { text: "*Find New Tuitions*\nTap the button below to see the tuitions you can apply for.\n\nSend *Hi* any time for the menu.", link: { label: "Open Website", url: `${SITE_URL}/advertisement.html` } });
    return;
  }
  if (action === "c" && cat) { await showCategory(from, role, cat, scoped, sid); return; }
  // the same number is more than one of admin / student / tutor: ask which one to use
  if (roles.length > 1 && action !== "h") {
    const words = roles.map((r) => ROLE_WORDS[r]);
    const list = words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0];
    await send(from, {
      type: "interactive",
      interactive: {
        type: "button", body: { text: `This number is registered as ${list}. Which one do you want to use now?` },
        action: { buttons: roles.map((r) => ({ type: "reply", reply: { id: `h:${r}`, title: ACT_AS[r] } })) },
      },
    });
    return;
  }
  if (role === "a" && employee) { await showAdminMenu(from, employee.id, roles); return; }
  if (role === "s" && many) { await showPicker(from, accounts); return; }
  await showMenu(from, role, scoped, "", false, roles);
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
