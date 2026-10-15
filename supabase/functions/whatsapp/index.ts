// WhatsApp Cloud API bot (test phase): the same student / tutor menu that the Telegram bot has.
// Secrets (Supabase > Edge Functions > Secrets): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN,
// and optionally WHATSAPP_APP_SECRET (when set, every incoming call must carry a valid Meta signature).
import { SITE_URL } from "../_shared/constants.ts";
import { fmtDate, fmtTime } from "../_shared/format.ts";
import { handleInput, startRegistration, type Out } from "../_shared/regflow.ts";
import { startTuition } from "../_shared/tuitionflow.ts";
import { accountsByPhone, inList, last10, loadLife, q, rest } from "../_shared/botdata.ts";

type Json = Record<string, any>;

const TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const VERIFY = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// a failed call counts as "nothing found"
const db = async (path: string): Promise<Json[]> => (await rest(path)) ?? [];

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
const CAT_ORDER = ["running", "scheduled", "new", "completed"];
const catLabel = (role: string, cat: string) =>
  cat === "running" ? "Running" : cat === "scheduled" ? "Demo Scheduled" : cat === "completed" ? "Completed"
  : role === "s" ? "Finding Tutor" : "Applied";

const minutesText = (a: Json | null) => { const m = Number(a?.billing_plan?.deal?.minutes ?? a?.class_duration ?? 0); return m > 0 ? `${m} min` : "-"; };
const timeText = (a: Json | null) => { const t = String(a?.billing_plan?.deal?.time ?? "").trim(); return t ? fmtTime(t) : "-"; };
const dateLine = (a: Json | null) => a?.demo_date ? `${fmtDate(a.demo_date)}${a.demo_time ? ", " + fmtTime(a.demo_time) : ""}` : "-";

// ---- screens ----
async function showMenu(to: string, role: string, accounts: { students: Json[]; tutors: Json[] }) {
  const mine = role === "s" ? accounts.students : accounts.tutors;
  const name = String(role === "s" ? mine[0].student_name : mine[0].full_name ?? "");
  const life = await loadLife(role, mine.map((r) => String(r[role === "s" ? "student_id" : "tutor_id"])));
  const off = mine.every((r) => r.notifications_off === true || r.blocked_at);
  const rows: Json[] = [];
  for (const cat of CAT_ORDER) {
    const n = life.filter((l) => l.cat === cat).length;
    if (n) rows.push({ id: `c:${role}:${cat}`, title: `${catLabel(role, cat)} (${n})`.slice(0, 24) });
  }
  rows.push(role === "s"
    ? { id: "a:s", title: "Apply for New Tuition", description: "Post a new tuition request" }
    : { id: "a:t", title: "Find New Tuitions", description: "See the tuitions you can apply for" });
  if (accounts.students.length && accounts.tutors.length) {
    rows.push({ id: `h:${role === "s" ? "t" : "s"}`, title: role === "s" ? "Switch to Tutor" : "Switch to Student" });
  }
  rows.push({ id: `n:${role}`, title: off ? "Notifications are OFF" : "Notifications are ON", description: off ? "Tap to turn it ON" : "Tap to turn it OFF" });
  rows.push({ id: `w:${role}`, title: "Open Website", description: "Your profile on Urban Tutor Site" });
  const body = `Hi,\n*${name || "there"}* (${role === "s" ? "Student" : "Tutor"}).\n\n` +
    (life.length
      ? `${role === "s" ? "Your tuitions" : "Tuitions you applied for"} - open the *Menu* to see their details.`
      : role === "s" ? "You have no live tuitions right now." : "You have not applied for any tuition yet.") +
    `\n\nYour notifications are *${off ? "OFF" : "ON"}*.`;
  await send(to, {
    type: "interactive",
    interactive: {
      type: "list", body: { text: body.slice(0, 1024) }, footer: { text: "Urban Tutor Site" },
      action: { button: "Menu", sections: [{ title: "Menu", rows: rows.slice(0, 10) }] },
    },
  });
}

async function showCategory(to: string, role: string, cat: string, accounts: { students: Json[]; tutors: Json[] }) {
  const mine = role === "s" ? accounts.students : accounts.tutors;
  const life = (await loadLife(role, mine.map((r) => String(r[role === "s" ? "student_id" : "tutor_id"])))).filter((l) => l.cat === cat);
  if (!life.length) { await sendText(to, "Nothing here right now.\nSend *Hi* any time for the menu."); return; }
  const tutorIds = [...new Set(life.flatMap((l) => l.apps.map((a) => String(a.tutor_id))))];
  const info = role === "s" && tutorIds.length ? await db(`tutors?tutor_id=${inList(tutorIds)}&select=tutor_id,full_name,gender`) : [];
  const tutorOf = (id: unknown) => info.find((x) => x.tutor_id === id) ?? {};
  const blocks = life.map((l) => {
    const head = `*${l.subject}* - ${l.demo}`;
    if (role === "s") {
      const t = tutorOf(l.app?.tutor_id);
      if (cat === "running" || cat === "completed") return `${head}\nTutor: ${t.full_name ?? l.app?.tutor_id}\nClass duration: ${minutesText(l.app)}\nClass time: ${timeText(l.app)}`;
      if (cat === "scheduled") return `${head}\nTutor: ${t.full_name ?? l.app?.tutor_id}\nDemo: ${dateLine(l.app)}`;
      const lines = l.apps.map((a) => { const x = tutorOf(a.tutor_id); return `  - ${x.full_name ?? a.tutor_id}${x.gender ? ` (${x.gender})` : ""}`; });
      return `${head}\n${lines.length ? "Tutors applied:\n" + lines.join("\n") : "No tutor has applied yet."}`;
    }
    const st = l.student ?? {};
    if (cat === "running" || cat === "completed") return `${head}\nStudent: ${st.student_name ?? "-"}\nClass duration: ${minutesText(l.app)}\nClass time: ${timeText(l.app)}`;
    const place = [st.class_name, st.board].filter(Boolean).join(" · ");
    if (cat === "scheduled") return `${head}\n${place}\nDemo: ${dateLine(l.app)}`;
    return `${head}\n${place}\n${[st.city, st.pin_code].filter(Boolean).join(" - ")}`;
  });
  await sendText(to, `*${catLabel(role, cat)}*\n\n${blocks.join("\n\n")}\n\nSend *Hi* any time for the menu.`);
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
  const [action, roleRaw, cat] = picked.split(":");
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
  if (action === "w") {
    await sendOut(from, { text: "*Urban Tutor Site*\nTap the button below to open your profile.\n\nSend *Hi* any time for the menu.", link: { label: "Open Website", url: `${SITE_URL}/${role === "s" ? "studentprofile" : "tutorprofile"}.html` } });
    return;
  }
  if (action === "c" && cat) { await showCategory(from, role, cat, accounts); return; }
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
