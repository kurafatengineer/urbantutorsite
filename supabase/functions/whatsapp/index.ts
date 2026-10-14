// WhatsApp Cloud API bot (test phase): the same student / tutor menu that the Telegram bot has.
// Secrets (Supabase > Edge Functions > Secrets): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN,
// and optionally WHATSAPP_APP_SECRET (when set, every incoming call must carry a valid Meta signature).
import { fmtDate, fmtTime } from "../_shared/mails.ts";
import { handleInput, startRegistration, type Out } from "../_shared/regflow.ts";

type Json = Record<string, any>;

const TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const VERIFY = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SITE_URL = "https://kurafatengineer.github.io/urbantutorsite";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function db(path: string): Promise<Json[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  return res.ok ? ((await res.json().catch(() => [])) ?? []) : [];
}
const q = encodeURIComponent;
const inList = (ids: string[]) => `in.(${ids.map((x) => q(`"${x}"`)).join(",")})`;

async function patch(path: string, body: Json) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
}

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
    interactive: { type: "list", body: { text }, action: { button: "Choose", sections: [{ title: "Options", rows: choices.slice(0, 10).map((c) => ({ id: `reg|${c.id}`, title: c.title.slice(0, 24) })) }] } },
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
const last10 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);

async function accountsFor(from: string) {
  const tail = last10(from);
  if (tail.length < 10) return { students: [] as Json[], tutors: [] as Json[] };
  const like = `*${tail.split("").join("*")}*`.replace(/\*+/g, "*");
  const [s1, s2, t1, t2] = await Promise.all([
    db(`students?whatsapp=ilike.${q(like)}&select=student_id,student_name,whatsapp,phone,blocked_at,notifications_off`),
    db(`students?phone=ilike.${q(like)}&select=student_id,student_name,whatsapp,phone,blocked_at,notifications_off`),
    db(`tutors?whatsapp_number=ilike.${q(like)}&select=tutor_id,full_name,whatsapp_number,mobile_number,blocked_at,notifications_off`),
    db(`tutors?mobile_number=ilike.${q(like)}&select=tutor_id,full_name,whatsapp_number,mobile_number,blocked_at,notifications_off`),
  ]);
  const uniq = (rows: Json[], key: string) => [...new Map(rows.map((r) => [r[key], r])).values()];
  const students = uniq([...s1, ...s2], "student_id").filter((r) => last10(r.whatsapp) === tail || last10(r.phone) === tail);
  const tutors = uniq([...t1, ...t2], "tutor_id").filter((r) => last10(r.whatsapp_number) === tail || last10(r.mobile_number) === tail);
  return { students, tutors };
}

// ---- tuition lifecycle (same rules as the Telegram bot) ----
const declined = (a: Json) => !!(a.parent_rejected || a.tutor_rejected);
function appState(a: Json) {
  if (a.classes_completed) return "completed";
  if (a.parent_accepted && a.tutor_accepted && a.demo_date) return "running";
  if (a.demo_date) return "scheduled";
  return "applied";
}
const RANK = ["running", "scheduled", "applied", "completed"];
const CAT_ORDER = ["running", "scheduled", "new", "completed"];
const catLabel = (role: string, cat: string) =>
  cat === "running" ? "Running" : cat === "scheduled" ? "Demo Scheduled" : cat === "completed" ? "Completed"
  : role === "s" ? "Finding Tutor" : "Applied";

type Life = { demo: string; subject: string; cat: string; app: Json | null; apps: Json[]; student: Json | null };
const COLS = "demo_id,tutor_id,parent_accepted,tutor_accepted,parent_rejected,tutor_rejected,classes_completed,demo_date,demo_time,class_duration,billing_plan";

async function loadLife(role: string, ids: string[]): Promise<Life[]> {
  const out: Life[] = [];
  if (role === "s") {
    const tuitions = await db(`tuitions?student_id=${inList(ids)}&terminated=eq.false&select=demo_id,subject,student_id&order=posted_at.desc`);
    const apps = tuitions.length ? await db(`applications?demo_id=${inList(tuitions.map((t) => t.demo_id))}&select=${COLS}`) : [];
    for (const t of tuitions) {
      const mine = apps.filter((a) => a.demo_id === t.demo_id && !declined(a));
      const best = RANK.find((r) => mine.some((a) => appState(a) === r));
      const app = mine.find((a) => appState(a) === best) ?? null;
      out.push({ demo: t.demo_id, subject: String(t.subject ?? ""), cat: !best || best === "applied" ? "new" : best, app, apps: mine, student: null });
    }
  } else {
    const apps = (await db(`applications?tutor_id=${inList(ids)}&select=${COLS}`)).filter((a) => !declined(a));
    const tuitions = apps.length ? await db(`tuitions?demo_id=${inList(apps.map((a) => a.demo_id))}&terminated=eq.false&select=demo_id,subject,student_id`) : [];
    const studs = tuitions.length ? await db(`students?student_id=${inList([...new Set(tuitions.map((t) => String(t.student_id)))])}&select=student_id,student_name,class_name,board,city,pin_code`) : [];
    for (const a of apps) {
      const t = tuitions.find((x) => x.demo_id === a.demo_id);
      if (!t) continue;
      const st = appState(a);
      out.push({ demo: t.demo_id, subject: String(t.subject ?? ""), cat: st === "applied" ? "new" : st, app: a, apps: [a], student: studs.find((x) => x.student_id === t.student_id) ?? null });
    }
  }
  return out;
}

const minutesText = (a: Json | null) => { const m = Number(a?.billing_plan?.deal?.minutes ?? a?.class_duration ?? 0); return m > 0 ? `${m} min` : "-"; };
const timeText = (a: Json | null) => { const t = String(a?.billing_plan?.deal?.time ?? "").trim(); return t ? fmtTime(t) : "-"; };
const dateLine = (a: Json | null) => a?.demo_date ? `${fmtDate(a.demo_date)}${a.demo_time ? ", " + fmtTime(a.demo_time) : ""}` : "-";

// ---- screens ----
async function showMenu(to: string, role: string, accounts: { students: Json[]; tutors: Json[] }) {
  const mine = role === "s" ? accounts.students : accounts.tutors;
  const name = String(role === "s" ? mine[0].student_name : mine[0].full_name ?? "");
  const life = await loadLife(role, mine.map((r) => String(r[role === "s" ? "student_id" : "tutor_id"])));
  const rows: Json[] = [];
  for (const cat of CAT_ORDER) {
    const n = life.filter((l) => l.cat === cat).length;
    if (n) rows.push({ id: `c:${role}:${cat}`, title: `${catLabel(role, cat)} (${n})`.slice(0, 24) });
  }
  if (accounts.students.length && accounts.tutors.length) {
    rows.push({ id: `h:${role === "s" ? "t" : "s"}`, title: role === "s" ? "Switch to Tutor" : "Switch to Student" });
  }
  const off = mine.every((r) => r.notifications_off === true || r.blocked_at);
  rows.push({ id: `n:${role}`, title: off ? "Notifications OFF" : "Notifications ON", description: off ? "Tap to turn ON" : "Tap to turn OFF" });
  const body = `Hi ${name || "there"}!\n${role === "s" ? "Student" : "Tutor"} menu\n\n` +
    (life.length
      ? `${role === "s" ? "Your tuitions" : "Tuitions you applied for"} - pick one below to see its details.`
      : role === "s" ? "You have no live tuitions right now." : "You have not applied for any tuition yet.") +
    `\n\n${off ? "Notifications are OFF (no email, no WhatsApp, no Telegram)." : "Notifications are ON."}` +
    `\n\nProfile: ${SITE_URL}/${role === "s" ? "studentprofile" : "tutorprofile"}.html`;
  await send(to, {
    type: "interactive",
    interactive: {
      type: "list", body: { text: body.slice(0, 1024) }, footer: { text: "Urban Tutor Site" },
      action: { button: "Open menu", sections: [{ title: "Tuitions", rows: rows.slice(0, 10) }] },
    },
  });
}

async function showCategory(to: string, role: string, cat: string, accounts: { students: Json[]; tutors: Json[] }) {
  const mine = role === "s" ? accounts.students : accounts.tutors;
  const life = (await loadLife(role, mine.map((r) => String(r[role === "s" ? "student_id" : "tutor_id"])))).filter((l) => l.cat === cat);
  if (!life.length) { await sendText(to, "Nothing here right now. Send *hi* for the menu."); return; }
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
  await sendText(to, `*${catLabel(role, cat)}*\n\n${blocks.join("\n\n")}\n\nSend *hi* for the menu.`);
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

  const accounts = await accountsFor(from);
  if (!accounts.students.length && !accounts.tutors.length) {
    await send(from, {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Hi! Welcome to Urban Tutor Site.\n\nThis number is not registered yet. Parents / students can register right here in the chat - it takes about 2 minutes." },
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
    await sendText(from, turnOff ? "Notifications are OFF - no email, no WhatsApp, no Telegram.\n\nSend *hi* for the menu." : "Notifications are ON again.\n\nSend *hi* for the menu.");
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
