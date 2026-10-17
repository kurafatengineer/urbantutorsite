// WhatsApp (later Telegram) chat flows for an EMPLOYEE (admin), shared by the bots.
//   1. Create New Tuition - find the parent by WhatsApp / mobile number or Student ID, then the usual tuition questions
//   2. Assign Tutor       - Tuition ID, then the tutor's WhatsApp / mobile number (or Tutor ID)
//   3. Schedule Demo      - Tuition ID, tutor, date, time
//   4. Tutor / Parent Confirm - see who has agreed on a tuition; confirm for the tutor or for the parent
//   5. Record Payment     - only for a tuition where the tutor and the parent have both agreed
//   6. Add New Student    - only the name and a mobile number are needed; every other detail can be skipped (no email code)
//   7. Class & Agreement  - days, start date, time, duration, billing model, fees, how often, who is paid; saves it and sends the agreement
// Every change is made by the "admin" Edge Function (see adminbridge.ts), so it follows the same rules as the
// Admin Panel: the employee must be active, inside their login hours and allowed to run that action.
// The chat only decides what to ask; reading (names, IDs, status) is done here with the service role.
import { accountsByPhone, inList, last10, q, rest } from "./botdata.ts";
import { adminCall } from "./adminbridge.ts";
import { startTuition } from "./tuitionflow.ts";
import { fmtDate, fmtTime } from "./format.ts";
import { inr } from "./mails.ts";
import { dealNumbers } from "./deal.ts";
import { type Choice, type Ctx, type Input, type Out, clean, clear, save, titleCase } from "./session.ts";

type Json = Record<string, any>;
export type AdminKind = "new" | "assign" | "demo" | "conf" | "pay" | "student" | "deal";

const CANCEL: Choice = { id: "cancel", title: "Cancel" };
const YES = (title: string): Choice => ({ id: "ad_yes", title });
const RETRY = "Type again, or *Cancel*.";
const ST_SKIP: Choice = { id: "st_skip", title: "Skip" };
const MENU_HINT = "\n\nSend *Hi* any time for the menu.";

// What the employee needs for each flow (the admin function checks the real action again when it runs).
const NEED: Record<AdminKind, string> = {
  new: "tuitions_add", assign: "tuitions_assign_tutor", demo: "tuitions_edit", conf: "tuitions_view", pay: "payments_add",
  student: "students_add", deal: "tuitions_edit",
};

const FIRST_STEP: Record<AdminKind, string> = {
  new: "ad_new_find", assign: "ad_as_demo", demo: "ad_sd_demo", conf: "ad_tc_demo", pay: "ad_pm_demo",
  student: "ad_st_phone", deal: "ad_dl_demo",
};

const TITLE: Record<AdminKind, string> = {
  new: "Create New Tuition", assign: "Assign Tutor", demo: "Schedule Demo", conf: "Tutor / Parent Confirm", pay: "Record Payment",
  student: "Add New Student", deal: "Class & Agreement",
};

/* ------------------------------------------------------------------ menu */

// The rows an employee sees in their WhatsApp menu, only for what they may do.
export function adminMenuRows(perms: string[]): Choice[] {
  const has = (p: string) => perms.includes(p);
  const rows: Choice[] = [];
  (["student", "new", "assign", "demo", "conf", "deal", "pay"] as AdminKind[]).forEach((k) => {
    if (has(NEED[k])) rows.push({ id: `ad:${k}`, title: TITLE[k] });
  });
  return rows;
}

export async function whoAmI(employeeId: string): Promise<{ ok: true; name: string; role: string; perms: string[]; hide: boolean } | { ok: false; message: string }> {
  const res = await adminCall(employeeId, "adminWhoAmI");
  if (!res?.success || !res.me) return { ok: false, message: String(res?.message ?? "Your admin access could not be checked.") };
  return { ok: true, name: String(res.me.fullName ?? ""), role: String(res.me.role ?? ""), perms: res.me.permissions ?? [], hide: !!res.me.hideContacts };
}

/* --------------------------------------------------------------- parsing */

const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const nowMinutesIst = () => { const t = new Date(Date.now() + 5.5 * 3_600_000); return t.getUTCHours() * 60 + t.getUTCMinutes(); };
const addDaysIso = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

// "18-10-2026", "18/10/2026", "18 10 2026", "2026-10-18", "today", "tomorrow" -> "2026-10-18" ("" when it is not a real date)
export function parseDate(text: string): string {
  const t = clean(text).toLowerCase();
  if (t === "today") return todayIst();
  if (t === "tomorrow" || t === "tmrw") return addDaysIso(todayIst(), 1);
  let y = 0, m = 0, d = 0, hit = t.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{4})$/);
  if (hit) { d = +hit[1]; m = +hit[2]; y = +hit[3]; }
  else if ((hit = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { y = +hit[1]; m = +hit[2]; d = +hit[3]; }
  else return "";
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "";
  return date.toISOString().slice(0, 10);
}

// "5 pm", "5:30 PM", "5.30pm", "17:30" -> "17:30" ("" when it is not a time)
export function parseTime(text: string): string {
  const t = clean(text).toLowerCase().replace(/\./g, ":").replace(/:+$/, "").replace(/\s+/g, " ");
  let h = -1, m = 0, hit = t.match(/^(\d{1,2})(?::(\d{2}))?\s?(am|pm)$/);
  if (hit) {
    h = +hit[1]; m = hit[2] ? +hit[2] : 0;
    if (h < 1 || h > 12) return "";
    h = h % 12 + (hit[3] === "pm" ? 12 : 0);
  } else if ((hit = t.match(/^(\d{1,2}):(\d{2})$/))) {
    h = +hit[1]; m = +hit[2];
  } else return "";
  if (h < 0 || h > 23 || m < 0 || m > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parseAmount(text: string): number {
  const n = Number(clean(text).replace(/rs\.?|inr|₹|,|\s/gi, ""));
  return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? Math.round(n * 100) / 100 : 0;
}

// What the employee typed: a Student / Tuition / Tutor ID, or a 10-digit phone number.
export function classify(text: string): { kind: "sid" | "did" | "tid" | "phone" | "badphone" | ""; value: string } {
  const compact = clean(text).replace(/\s/g, "").toUpperCase();
  if (/^SID\d{8}$/.test(compact)) return { kind: "sid", value: compact };
  if (/^DID\d{8}$/.test(compact)) return { kind: "did", value: compact };
  if (/^TID\d{8}$/.test(compact)) return { kind: "tid", value: compact };
  const digits = compact.replace(/[+\-().]/g, "");
  if (/^\d{10,13}$/.test(digits)) {
    const ten = last10(digits);
    return /^[6-9]\d{9}$/.test(ten) ? { kind: "phone", value: ten } : { kind: "badphone", value: ten };
  }
  return { kind: "", value: "" };
}


const WEEKDAY: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

// "Mon, Wed, Fri", "mon-sat", "Fri to Mon", "daily" -> [1, 3, 5] (0 = Sunday); [] when something is not a day
export function parseDays(text: string): number[] {
  const t = clean(text).toLowerCase();
  if (/^(daily|everyday|every day|all|all days|7 days)$/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  const tokens = t.replace(/\s+(to|till)\s+/g, "-").replace(/\s*[-–—]\s*/g, "-").split(/[\s,&\/+]+/).filter((x) => x && x !== "and");
  const out = new Set<number>();
  for (const tok of tokens) {
    const range = tok.split("-");
    if (range.length > 2 || range.some((x) => WEEKDAY[x] === undefined)) return [];
    if (range.length === 1) { out.add(WEEKDAY[range[0]]); continue; }
    let i = WEEKDAY[range[0]];
    const end = WEEKDAY[range[1]];
    for (let n = 0; n < 8; n++) { out.add(i); if (i === end) break; i = (i + 1) % 7; }
  }
  return MON_FIRST.filter((x) => out.has(x));
}

const daysText = (days: number[]) => days.length === 7 ? "Every day" : days.map((x) => DAY_NAME[x]).join(", ");

// "20%" -> percent 20; "1000" / "Rs. 1,000" -> amount 1000; null when it is not a number
export function parseCut(text: string): { type: "percent" | "amount"; value: number } | null {
  const t = clean(text).toLowerCase().replace(/,/g, "");
  const m = t.match(/^(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(%|percent|per cent|rs\.?|rupees?)?$/);
  if (!m) return null;
  return { type: m[2] && /^(%|per)/.test(m[2]) ? "percent" : "amount", value: Math.round(+m[1] * 100) / 100 };
}

const isoPlusDays = (iso: string, n: number) => addDaysIso(iso, n);
// the k-th payment date counted from the class start (same rule as the Admin Panel)
export function payDateAt(startISO: string, freq: string, k: number): string {
  if (freq === "Weekly") return isoPlusDays(startISO, 7 * k);
  if (freq === "15 Days") return isoPlusDays(startISO, 15 * k);
  const [y, m, d] = startISO.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}
// the first payment date that is today or later
export function nextParentDate(startISO: string, freq: string): string {
  const today = todayIst();
  let k = 0;
  while (k < 800 && payDateAt(startISO, freq, k) < today) k++;
  return payDateAt(startISO, freq, k);
}
// the class dates of the first month (start date up to the day before the next month begins) on the chosen weekdays
export function classDatesFor(startISO: string, days: number[]): string[] {
  const end = payDateAt(startISO, "Monthly", 1);
  const out: string[] = [];
  for (let d = startISO; d < end; d = addDaysIso(d, 1)) {
    if (days.includes(new Date(d + "T00:00:00Z").getUTCDay())) out.push(d);
  }
  return out;
}

/* ----------------------------------------------------------------- data */

const modeText = (m: unknown) => /^online$/i.test(String(m)) ? "Online" : /^(home|offline)$/i.test(String(m)) ? "Home" : "Home or Online";
const wantedText = (t: unknown) => /^(male|female)$/i.test(String(t).trim()) ? String(t).trim() : "Male or Female";

async function findTuition(demoId: string): Promise<Json | null> {
  const t = (await rest(`tuitions?demo_id=eq.${q(demoId)}&select=demo_id,subject,medium,preferred_tutor,preferred_timing,student_id,terminated`))?.[0];
  if (!t) return null;
  const student = (await rest(`students?student_id=eq.${q(t.student_id)}&select=student_id,student_name,parents_name,phone,whatsapp,gender,class_name,board,school,address,city,pin_code,blocked_at`))?.[0] ?? {};
  const status = String(await rest("rpc/tuition_status", { method: "POST", body: JSON.stringify({ p_demo_id: demoId }) }) ?? "");
  return { ...t, student, status };
}

const closed = (t: Json) => t.terminated === true || ["Completed", "Terminated"].includes(t.status);

function tuitionCard(t: Json, hide: boolean): string {
  const cls = [t.student?.class_name, t.student?.board].filter(Boolean).join(" · ");
  return `*${t.subject}* (${t.demo_id})\nStudent: ${studentCard(t.student ?? {}, hide)}\n` +
    (cls ? `Class: ${cls}\n` : "") + `Mode: ${modeText(t.medium)}\nTutor wanted: ${wantedText(t.preferred_tutor)}\nStatus: ${t.status || "-"}`;
}

// ---- the cards of "Assign Tutor": everything we hold about the student, the tuition and the tutor (no e-mail)
const fullAddress = (s: Json) => [s.address, [s.city, s.pin_code].filter(Boolean).join(" - ")].filter(Boolean).join(", ");
const joined = (v: unknown) => Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v ?? "").trim();
const lineOf = (label: string, v: unknown) => v ? `\n${label}: ${v}` : "";

function studentFullText(s: Json, hide: boolean): string {
  const wa = numText(s.whatsapp, hide), ph = numText(s.phone, hide);
  return "*Student Details:*\n" + (s.parents_name ? `Parent: ${s.parents_name}\n` : "") +
    `Name: *${s.student_name ?? "-"}*\nStudent ID: ${s.student_id ?? "-"}` +
    lineOf("Gender", s.gender) + lineOf("Class", s.class_name) + lineOf("Board", s.board) + lineOf("School", s.school) +
    lineOf("WhatsApp", wa) + lineOf("Mobile No.", ph) + (hide ? "" : lineOf("Address", fullAddress(s)));
}

function tuitionText(t: Json, withStatus = false): string {
  return `*Tuition Details:*\nSubject: *${t.subject}*\nTuition ID: ${t.demo_id}\nTutor wanted: ${wantedText(t.preferred_tutor)}\nMode: ${modeText(t.medium)}` +
    lineOf("Time", t.preferred_timing) + (withStatus ? lineOf("Status", t.status) : "");
}

function tutorFullText(t: Json, hide: boolean): string {
  const wa = numText(t.whatsapp_number, hide), mo = numText(t.mobile_number, hide);
  const addr = hide ? "" : [t.present_address, [t.city, t.pin_code].filter(Boolean).join(" - ")].filter(Boolean).join(", ");
  return `*Tutor Details:*\nName: *${t.full_name ?? "-"}*\nTutor ID: ${t.tutor_id}` +
    lineOf("Gender", t.gender) + lineOf("WhatsApp", wa) + lineOf("Mobile No.", mo) + lineOf("Address", addr);
}

// the parent, then each student with the ID, then the numbers and the address
function studentsBlock(rows: Json[], hide: boolean): string {
  const groups = new Map<string, Json[]>();
  for (const s of rows) {
    const k = String(s.parents_name ?? "").trim().toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return [...groups.values()].map((list) => {
    const first = list[0];
    const wa = numText(first.whatsapp, hide), ph = numText(first.phone, hide), addr = hide ? "" : fullAddress(first);
    return (first.parents_name ? `Parent: *${first.parents_name}*\n\n` : "") +
      list.map((s) => `Student: *${s.student_name ?? "-"}*\nStudent ID: ${s.student_id}`).join("\n\n") +
      (wa ? `\n\nWhatsApp: ${wa}` : "") + (ph ? `\nMobile No.: ${ph}` : "") + (addr ? `\nAddress: ${addr}` : "");
  }).join("\n\n---\n\n");
}

// every tuition of a Tuition ID, a Student ID or a WhatsApp / mobile number
async function tuitionsFor(c: Json): Promise<Json[]> {
  if (c.kind === "did") {
    const t = await findTuition(c.value);
    return t ? [t] : [];
  }
  const ids = (await findStudents(c)).map((x) => String(x.student_id));
  if (!ids.length) return [];
  const rows = await rest(`tuitions?student_id=${inList(ids)}&terminated=eq.false&select=demo_id&order=posted_at.desc`) ?? [];
  const out: Json[] = [];
  for (const r of rows.slice(0, 9)) {
    const t = await findTuition(String(r.demo_id));
    if (t) out.push(t);
  }
  return out;
}

const APP_COLS = "tutor_id,parent_accepted,tutor_accepted,parent_rejected,tutor_rejected,classes_completed,demo_date,demo_time,billing_plan,class_dates";

async function applicationsFor(demoId: string): Promise<Json[]> {
  const rows: Json[] = await rest(`applications?demo_id=eq.${q(demoId)}&select=${APP_COLS}&order=id`) ?? [];
  const ids = [...new Set(rows.map((r) => String(r.tutor_id)))];
  const tutors: Json[] = ids.length ? await rest(`tutors?tutor_id=${inList(ids)}&select=tutor_id,full_name,gender,mobile_number,whatsapp_number`) ?? [] : [];
  return rows.map((r) => {
    const tutor = tutors.find((t) => t.tutor_id === r.tutor_id) ?? { tutor_id: r.tutor_id };
    return { ...r, tutor, tutorName: String(tutor.full_name ?? r.tutor_id) };
  });
}

async function findTutors(c: { kind: string; value: string }): Promise<Json[]> {
  const cols = "tutor_id,full_name,gender,mobile_number,whatsapp_number,verification_status,blocked_at,experience_years,subjects_you_teach,classes_you_teach,boards_you_teach,teaching_location,present_address,city,pin_code";
  if (c.kind === "tid") return await rest(`tutors?tutor_id=eq.${q(c.value)}&select=${cols}`) ?? [];
  const [a, b] = await Promise.all([
    rest(`tutors?whatsapp10=eq.${c.value}&select=${cols}`),
    rest(`tutors?mobile10=eq.${c.value}&select=${cols}`),
  ]);
  return [...new Map([...(a ?? []), ...(b ?? [])].map((r: Json) => [r.tutor_id, r])).values()];
}

async function findStudents(c: { kind: string; value: string }): Promise<Json[]> {
  if (c.kind === "sid") return await rest(`students?student_id=eq.${q(c.value)}&select=student_id,student_name,parents_name,phone,whatsapp,blocked_at`) ?? [];
  return (await accountsByPhone(c.value)).students;
}

const person = (p: Json, id = "tutor_id", name = "full_name") => `*${p[name] ?? "-"}* (${p[id]})`;

// A number as the employee sees it: in full, or only the last two digits when their account hides numbers.
const numText = (v: unknown, hide: boolean): string => {
  const d = last10(v);
  if (d.length < 10) return "";
  return hide ? "*".repeat(8) + d.slice(-2) : `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
};
// Name, ID, parent and WhatsApp number of a student / tutor - shown wherever an employee works, so it is always clear who it is.
function studentCard(s: Json, hide: boolean): string {
  const wa = numText(s.whatsapp || s.phone, hide);
  return `*${s.student_name ?? "-"}* (${s.student_id ?? "-"})` + (s.parents_name ? `\n   Parent: ${s.parents_name}` : "") + (wa ? `\n   WhatsApp: ${wa}` : "");
}
function tutorCard(t: Json, hide: boolean): string {
  const wa = numText(t.whatsapp_number || t.mobile_number, hide);
  return `*${t.full_name ?? "-"}* (${t.tutor_id ?? "-"})` + (t.gender ? ` · ${t.gender}` : "") + (wa ? `\n   WhatsApp: ${wa}` : "");
}

/* --------------------------------------------------------------- prompts */

const askDemo = (kind: AdminKind): Out => ({
  text: `*${TITLE[kind]}*\nYou can type *Cancel* any time.\n\nEnter the *Tuition ID*.\nIt starts with *DID* followed by *8 digits*.\n\nFor example -\nDID20260007`,
});

// the details above, the question below - the whole thing must fit one button / list message (1024 characters)
const withHead = (head: string, question: string): string => {
  const room = 1024 - question.length - 4;
  const h = String(head ?? "");
  return (h.length > room ? h.slice(0, Math.max(0, room - 1)) + "…" : h) + "\n\n" + question;
};

const pickOut = (text: string, options: Json[], idKey: string, nameKey: string, extra?: (o: Json) => string): Out => ({
  text,
  choices: [
    ...options.slice(0, 9).map((o) => ({ id: `ad_pick:${o[idKey]}`, title: String(o[nameKey] || o[idKey]), description: extra ? extra(o) : String(o[idKey]) })),
    CANCEL,
  ],
});

const KIND_TEXT: Record<string, string> = { collection: "Parent paid us", payout: "We paid the tutor", agency_charge: "Tutor paid the agency" };
const PTYPE_TEXT: Record<string, string> = { advance: "Advance", regular: "Regular", final: "Final", agency: "Agency charge" };

function prompt(step: string, d: Json): Out {
  switch (step) {
    case "ad_new_find": return {
      text: "*Create New Tuition*\n\n" +
        (d.hide
          ? "Send the *Student ID*.\n\nFor example -\nSID20260613"
          : "Send the parent's *WhatsApp number* or *mobile number*, or the *Student ID*.\n\nFor example -\n9876543210\nSID20260613"),
      choices: [CANCEL],
    };
    case "ad_new_pick": return pickOut("Which *student* is the tuition for?", d.options, "student_id", "student_name",
      (o) => `${o.student_id}${o.parents_name ? " · Parent " + o.parents_name : ""}`);
    case "ad_as_demo": return {
      text: "*Assign Tutor*\n\n" + (d.hide
        ? "Send the *Tuition ID* or the *Student ID*.\n\nFor example -\nDID20260007\nSID20260613"
        : "Send the *Tuition ID*, the *Student ID*, or the parent's *WhatsApp / mobile number*.\n\nFor example -\nDID20260007\nSID20260613\n9876543210"),
      choices: [CANCEL],
    };
    case "ad_as_tpick": {
      const o = pickOut(withHead(d.head, "Which *tuition* do you want to assign a tutor to?"), d.tuitions, "demo_id", "subject", (x) => `${x.demo_id} · ${x.student_name}`);
      return o;
    }
    case "ad_sd_demo": return askDemo("demo");
    case "ad_tc_demo": return askDemo("conf");
    case "ad_pm_demo": return askDemo("pay");
    case "ad_as_tutor": return {
      text: withHead(d.card, d.hide
        ? "Send the tutor's *Tutor ID*.\n\nFor example -\nTID20260123"
        : "Send the tutor's *Tutor ID*, *WhatsApp number* or *mobile number*.\n\nFor example -\nTID20260123\n9876543210"),
      choices: [CANCEL],
    };
    case "ad_as_pick": return pickOut("Which *tutor*?", d.options, "tutor_id", "full_name",
      (o) => `${o.tutor_id} · ${numText(o.whatsapp_number || o.mobile_number, d.hide)}`);
    case "ad_as_confirm": return {
      text: `${d.tutorText}\n\nAssign this tutor to *${d.subject}* (${d.demoId}) of *${d.studentName}*?` +
        (d.mismatch ? `\n\nNote: this tuition asks for *${d.wanted.toLowerCase()}* tutors.` : ""),
      choices: [YES(d.mismatch ? "Assign Anyway" : "Assign This Tutor"), CANCEL],
    };
    case "ad_sd_pick": return pickOut("Which *tutor* is the demo for?", d.options, "tutor_id", "tutorName",
      (o) => `${o.tutor_id} · ${numText(o.tutor?.whatsapp_number || o.tutor?.mobile_number, d.hide)}`);
    case "ad_sd_date": return {
      text: `Demo *date* for *${d.tutorName}*?\n\nType it like *18-10-2026* (day-month-year), or *Today* / *Tomorrow*.` +
        (d.currentDemo ? `\n\nThe demo is now on ${d.currentDemo}. A new date will move it.` : ""),
    };
    case "ad_sd_time": return { text: "Demo *time*?\n\nFor example -\n5 PM\n5:30 PM\n17:30" };
    case "ad_sd_confirm": return {
      text: `*Please check the demo:*\n\n*${d.subject}* (${d.demoId})\nStudent: ${d.studentCard}\nTutor: ${d.tutorCard}\n` +
        `Date: *${fmtDate(d.date)}*\nTime: *${fmtTime(d.time)}*\n\nThe parent and the tutor will be told.`,
      choices: [YES("Schedule"), CANCEL],
    };
    case "ad_tc_pick": return {
      text: "Confirm for whom?\nUse this only after that person has agreed to you.",
      choices: [...d.options.slice(0, 9).map((o: Json) => ({ id: `ad_pick:${o.side}:${o.tutor_id}`, title: `${o.side === "p" ? "Parent" : "Tutor"}: ${o.tutorName}`, description: `${o.tutor_id} · ${o.side === "p" ? "parent / student confirms" : "tutor confirms"}` })),
        { id: "ad_done", title: "Done" }],
    };
    case "ad_tc_confirm": return {
      text: d.side === "p"
        ? `Confirm that the *parent / student* accepts this tutor for *${d.subject}* (${d.demoId})?\n\nStudent: ${d.studentCard}\nTutor: ${d.tutorCard}\n\nUse this only after the parent has agreed to you.`
        : `Confirm that the *tutor accepts* *${d.subject}* (${d.demoId})?\n\nTutor: ${d.tutorCard}\nStudent: ${d.studentCard}\n\nUse this only after the tutor has agreed to you.`,
      choices: [YES("Yes, Confirm"), CANCEL],
    };
    case "ad_pm_pick": return pickOut("Which *tutor* is the payment for?", d.options, "tutor_id", "tutorName",
      (o) => `${o.tutor_id} · ${numText(o.tutor?.whatsapp_number || o.tutor?.mobile_number, d.hide)}`);
    case "ad_pm_kind": return {
      text: "What kind of payment is this?",
      choices: [{ id: "pm_kind:collection", title: KIND_TEXT.collection }, { id: "pm_kind:payout", title: KIND_TEXT.payout },
        { id: "pm_kind:agency_charge", title: "Tutor paid agency" }],
    };
    case "ad_pm_amount": return { text: "How much? Type the *amount* in rupees.\n\nFor example -\n3600" };
    case "ad_pm_ptype": return {
      text: "Which *payment type*?",
      choices: [{ id: "pm_ptype:advance", title: "Advance" }, { id: "pm_ptype:regular", title: "Regular" }, { id: "pm_ptype:final", title: "Final" }],
    };
    case "ad_pm_mode": return { text: "How was it paid?", choices: [{ id: "pm_mode:Online", title: "Online" }, { id: "pm_mode:Offline", title: "Offline" }] };
    case "ad_pm_date": return {
      text: "*Payment date*?\n\nTap *Today*, or type it like *17-10-2026*.",
      choices: [{ id: "pm_today", title: "Today" }],
    };
    case "ad_pm_next": return {
      text: "When is the *next payment* due?\n\nType the date like *17-11-2026*, or tap *Skip*.",
      choices: [{ id: "pm_skip", title: "Skip" }],
    };
    case "ad_pm_confirm": return {
      text: `*Please check the payment:*\n\n*${d.subject}* (${d.demoId})\nStudent: ${d.studentCard}\nTutor: ${d.tutorCard}\n` +
        `Kind: ${KIND_TEXT[d.kind]}\nAmount: *${inr(d.amount)}*\nPayment type: ${PTYPE_TEXT[d.ptype]}\nMode: ${d.mode}\n` +
        `Date: ${fmtDate(d.date)}\n` + (d.next ? `Next payment: ${fmtDate(d.next)}\n` : "") +
        "\nThe parent / tutor will get the payment message.",
      choices: [YES("Record Payment"), CANCEL],
    };
    case "ad_st_phone": return {
      text: "*Add New Student*\n\nWhat is the parent's *WhatsApp number*? (10 digits)",
      choices: [CANCEL],
    };
    case "ad_st_found": return { text: foundCard(d), choices: [{ id: "st_add", title: "Add New Student" }, CANCEL] };
    case "ad_st_parent": return { text: "No student is registered on this number yet.\n\nThe *parent's name*?", choices: [ST_SKIP, CANCEL] };
    case "ad_st_name": return { text: "What is the *student's name*?", choices: [CANCEL] };
    case "ad_st_gender": return { text: "The student's *gender*?", choices: [{ id: "st_gender:Male", title: "Male" }, { id: "st_gender:Female", title: "Female" }, CANCEL] };
    case "ad_st_class": return { text: "Which *class* is the student in?\n\nFor example -\n10th\nB.Com", choices: [CANCEL] };
    case "ad_st_board": return { text: "*Board / University*?\n\nFor example -\nCBSE\nICSE", choices: [CANCEL] };
    case "ad_st_school": return { text: "*School / College* name?", choices: [ST_SKIP, CANCEL] };
    case "ad_st_more": return {
      text: "Do you also want to add the email, city, PIN code or address?",
      choices: [{ id: "st_save", title: "Save Now" }, { id: "st_more", title: "Add More Details" }, CANCEL],
    };
    case "ad_st_email": return { text: "The *email address*?\nNo code is sent to it.", choices: [ST_SKIP, CANCEL] };
    case "ad_st_city": return { text: "Which *city*?", choices: [ST_SKIP, CANCEL] };
    case "ad_st_pin": return { text: "*PIN code* (6 digits)?", choices: [ST_SKIP, CANCEL] };
    case "ad_st_address": return { text: "The *address*?", choices: [ST_SKIP, CANCEL] };
    case "ad_st_confirm": return { text: studentSummary(d), choices: [YES("Save Student"), CANCEL] };
    case "ad_st_post": return {
      text: newStudentCard(d),
      ...(d.perms.includes("tuitions_add") ? { choices: [{ id: "st_post", title: "Create New Tuition" }] } : {}),
    };
    case "ad_dl_demo": return askDemo("deal");
    case "ad_dl_pick": return pickOut("Which *tutor*?", d.options, "tutor_id", "tutorName",
      (o) => `${o.tutor_id} · ${numText(o.tutor?.whatsapp_number || o.tutor?.mobile_number, d.hide)}`);
    case "ad_dl_days": return {
      text: `*Class & Agreement*\n*${d.subject}* (${d.demoId})\nStudent: ${d.studentCard}\nTutor: ${d.tutorCard}\n` +
        (d.existing ? "\nA deal is already saved for this class. Continuing will replace it and send the agreement again.\n" : "") +
        "\nOn which *days of the week* are the classes?\n\nFor example -\nMon, Wed, Fri\nMon-Sat\nDaily",
    };
    case "ad_dl_start": return {
      text: "From which *date* do the classes start?\n\nType it like *20-10-2026*, or tap a button.",
      choices: [{ id: "dl_start:today", title: "Today" }, { id: "dl_start:tomorrow", title: "Tomorrow" }],
    };
    case "ad_dl_time": return { text: "The *class time*?\n\nFor example -\n5 PM\n5:30 PM\n17:30" };
    case "ad_dl_min": return {
      text: "How long is *each class* (minutes)?\n\nTap a button, or type the minutes.",
      choices: [{ id: "dl_min:30", title: "30 minutes" }, { id: "dl_min:45", title: "45 minutes" }, { id: "dl_min:60", title: "60 minutes" }],
    };
    case "ad_dl_model": return {
      text: "How is this class billed?\n\n*Monthly Commission* - a fixed fee each month. The agency takes its cut once, from the first month.\n\n" +
        "*Per Class Commission* - the parent pays a price per class. The agency keeps a share of every class and pays the tutor the rest.",
      choices: [{ id: "dl_model:commission", title: "Monthly Commission" }, { id: "dl_model:margin", title: "Per Class Commission" }],
    };
    case "ad_dl_fee": return {
      text: d.model === "margin" ? "What does the parent pay *per class* (rupees)?\n\nFor example -\n300" : "What is the *monthly fee* the parent pays (rupees)?\n\nFor example -\n6000",
    };
    case "ad_dl_cut": return {
      text: (d.model === "margin" ? "How much does the *agency keep per class*?" : "How much is the *agency cut*? (taken once, from the first month)") +
        "\n\nType a percentage like *20%*, or an amount in rupees like *1000*.",
    };
    case "ad_dl_payto": return {
      text: "Who gets the *first month's fee*?\n\n*Tutor* - the parent pays the tutor, and the tutor pays the agency its cut.\n*Agency* - the parent pays the agency, which keeps its cut and pays the rest to the tutor.",
      choices: [{ id: "dl_to:Tutor", title: "Tutor" }, { id: "dl_to:Agency", title: "Agency" }],
    };
    case "ad_dl_freq": return {
      text: "How often does the parent pay?",
      choices: [{ id: "dl_freq:Weekly", title: "Weekly" }, { id: "dl_freq:15 Days", title: "Every 15 Days" }, { id: "dl_freq:Monthly", title: "Monthly" }],
    };
    case "ad_dl_confirm": return { text: dealSummary(d), choices: [YES("Save & Send"), CANCEL] };
    default: return { text: "" };
  }
}

const go = async (ctx: Ctx, step: string, d: Json): Promise<Out[]> => { await save(ctx, step, d); return [prompt(step, d)]; };
const finish = async (ctx: Ctx, text: string): Promise<Out[]> => { await clear(ctx); return [{ text: text + MENU_HINT }]; };

/* ----------------------------------------------------------------- start */

export async function startAdminFlow(ctx: Ctx, employeeId: string, kind: AdminKind): Promise<Out[]> {
  const me = await whoAmI(employeeId);
  if (!me.ok) return finish(ctx, me.message);
  if (!me.perms.includes(NEED[kind])) return finish(ctx, "You do not have permission for this.");
  const d: Json = { eid: employeeId, name: me.name, perms: me.perms, hide: me.hide, kind };
  return go(ctx, FIRST_STEP[kind], d);
}

/* ----------------------------------------------------------------- steps */

export async function adminInput(ctx: Ctx, s: { step: string; data: Json }, input: Input): Promise<Out[]> {
  const d = s.data;
  const step = s.step;
  const text = clean(input.text);
  const choice = input.choice ?? "";

  if (choice === "cancel" || /^cancel$/i.test(text)) { await clear(ctx); return [{ text: "", menu: "a" }]; }
  const again = (msg: string): Out[] => [{ text: `${msg}\n\n${RETRY}` }];
  const pickedId = choice.startsWith("ad_pick:") ? choice.slice(8) : "";
  const skipped = choice === "st_skip" || /^skip$/i.test(text);

  switch (step) {

    /* ---------- 1. new tuition ---------- */
    case "ad_new_find": {
      const c = classify(text);
      if (c.kind === "phone" && d.hide) return again("Your account cannot search by number.\nSend the *Student ID* (SID + 8 digits).");
      if (c.kind !== "phone" && c.kind !== "sid") {
        return again(d.hide ? "That is not a Student ID.\nIt starts with *SID* followed by *8 digits*." :
          "That is not a valid number or ID.\nSend a 10-digit *WhatsApp / mobile number*, or a *Student ID* (SID + 8 digits).");
      }
      const found = await findStudents(c);
      if (!found.length) return again(`No student was found with *${text}*.`);
      const open = found.filter((x) => !x.blocked_at);
      if (!open.length) return again("This student is blocked.\nUnblock them in the Admin Panel first.");
      if (open.length === 1) return startTuition(ctx, [open[0]], { adminId: d.eid, hide: d.hide, perms: d.perms });
      d.options = open.slice(0, 9).map((x) => ({ student_id: x.student_id, student_name: x.student_name, parents_name: x.parents_name, whatsapp: x.whatsapp, phone: x.phone }));
      return go(ctx, "ad_new_pick", d);
    }
    case "ad_new_pick": {
      const chosen = (d.options ?? []).find((o: Json) => o.student_id === pickedId);
      if (!chosen) return [prompt(step, d)];
      return startTuition(ctx, [chosen], { adminId: d.eid, hide: d.hide, perms: d.perms });
    }

    /* ---------- 2. assign tutor ---------- */
    case "ad_as_demo": {
      const c = classify(text);
      if (c.kind === "phone" && d.hide) return again("Your account cannot search by number.\nSend the *Tuition ID* or the *Student ID*.");
      if (!["did", "sid", "phone"].includes(c.kind)) {
        return again(d.hide ? "That is not a valid ID.\nSend a *Tuition ID* (DID + 8 digits) or a *Student ID* (SID + 8 digits)."
          : "That is not a valid ID or number.\nSend a *Tuition ID* (DID + 8 digits), a *Student ID* (SID + 8 digits) or a 10-digit *WhatsApp / mobile number*.");
      }
      const all = await tuitionsFor(c);
      if (!all.length) return again(c.kind === "did" ? `No tuition was found with the ID *${c.value}*.` : `No tuition has been created yet for *${text}*.`);
      const open = all.filter((t) => !closed(t) && !t.student?.blocked_at);
      if (!open.length) {
        if (c.kind === "did") return again(all[0].student?.blocked_at ? "This student is blocked." : `*${c.value}* is closed (${all[0].status || "terminated"}).`);
        return again("All the tuitions here are closed or the student is blocked.");
      }
      if (open.length === 1) return pickTuition(ctx, d, open[0]);
      d.tuitions = open.map((t) => ({ demo_id: t.demo_id, subject: t.subject, student_name: t.student?.student_name ?? "" }));
      await save(ctx, "ad_as_tpick", d);
      const students = [...new Map(open.map((t) => [t.student?.student_id, t.student ?? {}])).values()];
      d.head = studentsBlock(students, !!d.hide);
      await save(ctx, "ad_as_tpick", d);
      return [prompt("ad_as_tpick", d)];
    }
    case "ad_as_tpick": {
      const chosen = (d.tuitions ?? []).find((o: Json) => o.demo_id === pickedId);
      if (!chosen) return [prompt(step, d)];
      const t = await findTuition(chosen.demo_id);
      if (!t || closed(t)) return again("That tuition is closed now.");
      return pickTuition(ctx, d, t);
    }
    case "ad_as_tutor": {
      const c = classify(text);
      if (c.kind === "phone" && d.hide) return again("Your account cannot search by number.\nSend the *Tutor ID* (TID + 8 digits).");
      if (c.kind !== "phone" && c.kind !== "tid") {
        return again(d.hide ? "That is not a Tutor ID.\nIt starts with *TID* followed by *8 digits*." :
          "That is not a valid number or ID.\nSend a 10-digit *WhatsApp / mobile number*, or a *Tutor ID* (TID + 8 digits).");
      }
      const found = await findTutors(c);
      if (!found.length) return again(`No tutor was found with *${text}*.`);
      if (found.length > 1) {
        d.options = found.slice(0, 9);
        return go(ctx, "ad_as_pick", d);
      }
      return assignConfirm(ctx, d, found[0]);
    }
    case "ad_as_pick": {
      const chosen = (d.options ?? []).find((o: Json) => o.tutor_id === pickedId);
      return chosen ? assignConfirm(ctx, d, chosen) : [prompt(step, d)];
    }
    case "ad_as_confirm": {
      if (choice !== "ad_yes") return [prompt(step, d)];
      const res = await adminCall(d.eid, "adminAssignTutor", { demoId: d.demoId, tutor: d.tutorId });
      if (!res?.success) return finish(ctx, `The tutor could not be assigned.\n${String(res?.message ?? "")}`);
      await clear(ctx);
      return [{ text: `*Tutor Assigned!*\n\n${d.tuitionText}\n\n${d.studentText}\n\n${d.tutorText}` }];
    }

    /* ---------- 3. schedule demo ---------- */
    case "ad_sd_demo": {
      const c = classify(text);
      if (c.kind !== "did") return again("That is not a valid *Tuition ID*.\nIt starts with *DID* followed by *8 digits*.");
      const t = await findTuition(c.value);
      if (!t) return again(`No tuition was found with the ID *${c.value}*.`);
      if (closed(t)) return again(`*${c.value}* is closed (${t.status || "terminated"}).`);
      const rows = (await applicationsFor(t.demo_id)).filter((r) => !r.parent_rejected && !r.tutor_rejected);
      if (!rows.length) return again(`No tutor is on *${c.value}* yet.\nUse *Assign Tutor* first.`);
      d.demoId = t.demo_id; d.subject = t.subject; d.studentName = t.student?.student_name ?? ""; d.studentCard = studentCard(t.student ?? {}, d.hide);
      if (rows.length === 1) return demoDate(ctx, d, rows[0]);
      d.options = rows.slice(0, 9);
      return go(ctx, "ad_sd_pick", d);
    }
    case "ad_sd_pick": {
      const chosen = (d.options ?? []).find((o: Json) => o.tutor_id === pickedId);
      return chosen ? demoDate(ctx, d, chosen) : [prompt(step, d)];
    }
    case "ad_sd_date": {
      const iso = parseDate(text);
      if (!iso) return again("That is not a valid date.\nType it like *18-10-2026* (day-month-year), or *Today* / *Tomorrow*.");
      if (iso < todayIst()) return again("That date has already passed.");
      d.date = iso;
      return go(ctx, "ad_sd_time", d);
    }
    case "ad_sd_time": {
      const hhmm = parseTime(text);
      if (!hhmm) return again("That is not a valid time.\nType it like *5 PM*, *5:30 PM* or *17:30*.");
      const [h, m] = hhmm.split(":").map(Number);
      if (d.date === todayIst() && h * 60 + m <= nowMinutesIst()) return again("That time has already passed today.");
      d.time = hhmm;
      return go(ctx, "ad_sd_confirm", d);
    }
    case "ad_sd_confirm": {
      if (choice !== "ad_yes") return [prompt(step, d)];
      const res = await adminCall(d.eid, "adminUpdateDemoRow", {
        demoId: d.demoId, tutorId: d.tutorId, changes: { "Demo Date": d.date, "Demo Time": d.time },
      });
      if (!res?.success) return finish(ctx, `The demo could not be scheduled.\n${String(res?.message ?? "")}`);
      return finish(ctx, `*Demo scheduled!*\n*${d.subject}* (${d.demoId}) with ${d.tutorLine}\n${fmtDate(d.date)}, ${fmtTime(d.time)}\n\nThe parent and the tutor have been told.`);
    }

    /* ---------- 4. tutor confirmation ---------- */
    case "ad_tc_demo": {
      const c = classify(text);
      if (c.kind !== "did") return again("That is not a valid *Tuition ID*.\nIt starts with *DID* followed by *8 digits*.");
      const t = await findTuition(c.value);
      if (!t) return again(`No tuition was found with the ID *${c.value}*.`);
      const rows = await applicationsFor(t.demo_id);
      if (!rows.length) return again(`No tutor is on *${c.value}* yet.`);
      const lines = rows.map((r) => `${tutorCard(r.tutor, d.hide)}\n   Tutor: ${stateText(r.tutor_accepted, r.tutor_rejected)}\n   Parent: ${stateText(r.parent_accepted, r.parent_rejected)}\n` +
        `   Demo: ${r.demo_date ? `${fmtDate(r.demo_date)}${r.demo_time ? ", " + fmtTime(r.demo_time) : ""}` : "Not scheduled"}`);
      const head = `${tuitionCard(t, d.hide)}\n\n${lines.join("\n\n")}`;
      const canConfirm = d.perms.includes("tuitions_edit") && !closed(t);
      const entries: Json[] = [];
      for (const r of rows) {
        if (r.parent_rejected || r.tutor_rejected) continue;
        if (!r.tutor_accepted) entries.push({ side: "t", tutor_id: r.tutor_id, tutorName: r.tutorName, card: tutorCard(r.tutor, d.hide) });
        if (!r.parent_accepted) entries.push({ side: "p", tutor_id: r.tutor_id, tutorName: r.tutorName, card: tutorCard(r.tutor, d.hide) });
      }
      if (!canConfirm || !entries.length) {
        const both = rows.some((r) => r.tutor_accepted && r.parent_accepted && !r.tutor_rejected && !r.parent_rejected);
        return finish(ctx, head + (both ? "\n\nThe tutor and the parent have agreed. Use *Class & Agreement*, then *Record Payment* in the Menu." : ""));
      }
      d.demoId = t.demo_id; d.subject = t.subject; d.studentName = t.student?.student_name ?? ""; d.studentCard = studentCard(t.student ?? {}, d.hide);
      d.options = entries.slice(0, 9);
      await save(ctx, "ad_tc_pick", d);
      return [{ text: head }, prompt("ad_tc_pick", d)];
    }
    case "ad_tc_pick": {
      if (choice === "ad_done") return finish(ctx, "Done.");
      const chosen = (d.options ?? []).find((o: Json) => `${o.side}:${o.tutor_id}` === pickedId);
      if (!chosen) return [prompt(step, d)];
      d.side = chosen.side; d.tutorId = chosen.tutor_id; d.tutorCard = chosen.card;
      d.tutorLine = `*${chosen.tutorName}* (${chosen.tutor_id})`;
      return go(ctx, "ad_tc_confirm", d);
    }
    case "ad_tc_confirm": {
      if (choice !== "ad_yes") return [prompt(step, d)];
      const res = await adminCall(d.eid, "adminUpdateDemoRow", { demoId: d.demoId, tutorId: d.tutorId, changes: { [d.side === "p" ? "Parent Accepted" : "Tutor Accepted"]: true } });
      if (!res?.success) return finish(ctx, `It could not be saved.\n${String(res?.message ?? "")}`);
      const row = (await applicationsFor(d.demoId)).find((r) => r.tutor_id === d.tutorId);
      const bothOk = !!row?.parent_accepted && !!row?.tutor_accepted && !row?.parent_rejected && !row?.tutor_rejected;
      return finish(ctx, `*${d.side === "p" ? "Parent confirmed" : "Tutor confirmed"}.*\n${d.tutorLine} - *${d.subject}* (${d.demoId}).\n\nTutor: ${stateText(row?.tutor_accepted, row?.tutor_rejected)}\nParent: ${stateText(row?.parent_accepted, row?.parent_rejected)}` +
        (bothOk ? "\n\nThe tutor and the parent have agreed. Use *Class & Agreement*, then *Record Payment* in the Menu." : ""));
    }

    /* ---------- 5. create payment ---------- */
    case "ad_pm_demo": {
      const c = classify(text);
      if (c.kind !== "did") return again("That is not a valid *Tuition ID*.\nIt starts with *DID* followed by *8 digits*.");
      const t = await findTuition(c.value);
      if (!t) return again(`No tuition was found with the ID *${c.value}*.`);
      if (closed(t)) return again(`*${c.value}* is closed (${t.status || "terminated"}).`);
      const rows = await applicationsFor(t.demo_id);
      const agreed = rows.filter((r) => r.parent_accepted && r.tutor_accepted && !r.parent_rejected && !r.tutor_rejected);
      if (!agreed.length) {
        const why = rows.length
          ? "\n\n" + rows.map((r) => `${r.tutorName}: Tutor ${stateText(r.tutor_accepted, r.tutor_rejected).toLowerCase()}, Parent ${stateText(r.parent_accepted, r.parent_rejected).toLowerCase()}`).join("\n")
          : "\n\nNo tutor is on it yet.";
        return again(`A payment can be created only after the tutor and the parent have both agreed.${why}`);
      }
      d.demoId = t.demo_id; d.subject = t.subject; d.studentName = t.student?.student_name ?? ""; d.studentCard = studentCard(t.student ?? {}, d.hide);
      if (agreed.length === 1) return payKind(ctx, d, agreed[0]);
      d.options = agreed.slice(0, 9);
      return go(ctx, "ad_pm_pick", d);
    }
    case "ad_pm_pick": {
      const chosen = (d.options ?? []).find((o: Json) => o.tutor_id === pickedId);
      return chosen ? payKind(ctx, d, chosen) : [prompt(step, d)];
    }
    case "ad_pm_kind": {
      const kind = choice.startsWith("pm_kind:") ? choice.slice(8) : "";
      if (!KIND_TEXT[kind]) return [prompt(step, d)];
      d.kind = kind;
      return go(ctx, "ad_pm_amount", d);
    }
    case "ad_pm_amount": {
      const amount = parseAmount(text);
      if (!amount) return again("That is not a valid amount.\nType the amount in rupees, like *3600*.");
      d.amount = amount;
      if (d.kind === "agency_charge") { d.ptype = "agency"; return go(ctx, "ad_pm_mode", d); }
      return go(ctx, "ad_pm_ptype", d);
    }
    case "ad_pm_ptype": {
      const t = choice.startsWith("pm_ptype:") ? choice.slice(9) : "";
      if (!["advance", "regular", "final"].includes(t)) return [prompt(step, d)];
      d.ptype = t;
      return go(ctx, "ad_pm_mode", d);
    }
    case "ad_pm_mode": {
      const typed = /^online$/i.test(text) ? "Online" : /^offline$/i.test(text) ? "Offline" : "";
      const m = choice.startsWith("pm_mode:") ? choice.slice(8) : typed;
      if (m !== "Online" && m !== "Offline") return [prompt(step, d)];
      d.mode = m;
      return go(ctx, "ad_pm_date", d);
    }
    case "ad_pm_date": {
      const iso = choice === "pm_today" ? todayIst() : parseDate(text);
      if (!iso) return again("That is not a valid date.\nType it like *17-10-2026*, or tap *Today*.");
      if (iso > todayIst()) return again("The payment date cannot be in the future.");
      d.date = iso;
      return go(ctx, "ad_pm_next", d);
    }
    case "ad_pm_next": {
      if (choice === "pm_skip" || /^skip$/i.test(text)) d.next = "";
      else {
        const iso = parseDate(text);
        if (!iso) return again("That is not a valid date.\nType it like *17-11-2026*, or tap *Skip*.");
        if (iso <= d.date) return again("The next payment date must be after the payment date.");
        d.next = iso;
      }
      return go(ctx, "ad_pm_confirm", d);
    }
    case "ad_pm_confirm": {
      if (choice !== "ad_yes") return [prompt(step, d)];
      const res = await adminCall(d.eid, "adminAddPayment", {
        transactionType: d.kind, demoId: d.demoId, tutorId: d.tutorId, amount: d.amount, paymentType: d.ptype,
        collectedBy: "agency", paymentMode: d.mode, paymentDate: d.date, nextPaymentDate: d.next || undefined,
        notes: `Added on WhatsApp by ${d.name}`,
      });
      if (!res?.success) return finish(ctx, `The payment could not be recorded.\n${String(res?.message ?? "")}`);
      return finish(ctx, `*Payment recorded.*\n${KIND_TEXT[d.kind]}: *${inr(d.amount)}*\n*${d.subject}* (${d.demoId})\n${fmtDate(d.date)}`);
    }
    case "ad_st_phone": {
      const c = classify(text);
      if (c.kind !== "phone") return again("That is not a valid WhatsApp number.\nType the 10-digit number.");
      d.f = { whatsapp: c.value };
      const ids = (await accountsByPhone(c.value)).students.map((x: Json) => String(x.student_id));
      d.ex = ids.length
        ? await rest(`students?student_id=${inList(ids)}&select=student_id,student_name,parents_name,phone,whatsapp,email,address,city,pin_code&order=student_id`) ?? []
        : [];
      return go(ctx, d.ex.length ? "ad_st_found" : "ad_st_parent", d);
    }
    case "ad_st_found": {
      if (choice !== "st_add") return [prompt(step, d)];
      return go(ctx, "ad_st_name", d);
    }
    case "ad_st_parent": {
      if (!skipped) {
        if (text.length < 2 || text.length > 80) return again("Please type the parent's name, or tap *Skip*.");
        d.f.parentsName = titleCase(text);
      }
      return go(ctx, "ad_st_name", d);
    }
    case "ad_st_name": {
      if (text.length < 2 || text.length > 80) return again("Please type the student's name.");
      d.f.studentName = titleCase(text);
      return go(ctx, "ad_st_gender", d);
    }
    case "ad_st_more": {
      if (choice === "st_more") return go(ctx, "ad_st_email", d);
      if (choice === "st_save") return go(ctx, "ad_st_confirm", d);
      return [prompt(step, d)];
    }
    case "ad_st_gender": case "ad_st_class": case "ad_st_board": case "ad_st_school":
    case "ad_st_email": case "ad_st_city": case "ad_st_pin": case "ad_st_address": {
      const field = ST_FIELDS.find((x) => x.step === step)!;
      if (skipped && !field.required) return go(ctx, nextStudentStep(step, d), d);
      const typedGender = /^male$/i.test(text) ? "Male" : /^female$/i.test(text) ? "Female" : "";
      const value = field.key === "gender" ? (choice.startsWith("st_gender:") ? choice.slice(10) : typedGender) : text;
      const bad = field.check(value);
      if (bad) return again(bad);
      d.f[field.key] = field.fix ? field.fix(value) : value;
      return go(ctx, nextStudentStep(step, d), d);
    }
    case "ad_st_confirm": {
      if (choice !== "ad_yes") return [prompt(step, d)];
      const home = (d.ex ?? [])[0];
      const p = {
        basic: true, ...d.f, termsAccepted: false,
        ...(home ? {
          parentsName: home.parents_name || undefined, email: home.email || undefined, address: home.address || undefined,
          city: home.city || undefined, pinCode: home.pin_code || undefined,
        } : {}),
        phone: home?.phone || d.f.whatsapp, whatsapp: home?.whatsapp || d.f.whatsapp,
      };
      const res = await adminCall(d.eid, "adminAddStudent", { p });
      if (!res?.success) return finish(ctx, `The student could not be added.\n${String(res?.message ?? "").replace(/^.*?:\s*/, "")}`);
      d.studentId = String(res.studentId);
      d.studentName = d.f.studentName;
      d.saved = (await rest(`students?student_id=eq.${q(d.studentId)}&select=student_id,student_name,gender,class_name,board,school,parents_name,phone,whatsapp,email,address,city,pin_code`))?.[0]
        ?? { student_id: d.studentId, student_name: d.studentName, phone: p.phone, whatsapp: p.whatsapp };
      if (!d.perms.includes("tuitions_add")) { await clear(ctx); return [{ text: newStudentCard(d) }]; }
      await save(ctx, "ad_st_post", d);
      return [prompt("ad_st_post", d)];
    }
    case "ad_st_post": {
      if (choice === "st_post") return startTuition(ctx, [d.saved], { adminId: d.eid, hide: d.hide, perms: d.perms });
      await clear(ctx);
      return [{ text: "", menu: "a" }];
    }
    case "ad_after": {
      const did = choice.startsWith("af_assign:") ? choice.slice(10) : "";
      if (!did) { await clear(ctx); return [{ text: "", menu: "a" }]; }
      const nd = { eid: d.eid, name: d.name ?? "", perms: d.perms, hide: d.hide, kind: "assign" };
      return adminInput(ctx, { step: "ad_as_demo", data: nd }, { text: did });
    }
    case "ad_dl_demo": {
      const c = classify(text);
      if (c.kind !== "did") return again("That is not a valid *Tuition ID*.\nIt starts with *DID* followed by *8 digits*.");
      const t = await findTuition(c.value);
      if (!t) return again(`No tuition was found with the ID *${c.value}*.`);
      if (closed(t)) return again(`*${c.value}* is closed (${t.status || "terminated"}).`);
      const rows = await applicationsFor(t.demo_id);
      const agreed = rows.filter((r) => r.parent_accepted && r.tutor_accepted && !r.parent_rejected && !r.tutor_rejected);
      if (!agreed.length) {
        const why = rows.length
          ? "\n\n" + rows.map((r) => `${r.tutorName}: Tutor ${stateText(r.tutor_accepted, r.tutor_rejected).toLowerCase()}, Parent ${stateText(r.parent_accepted, r.parent_rejected).toLowerCase()}`).join("\n")
          : "\n\nNo tutor is on it yet.";
        return again(`The class can be set only after the tutor and the parent have both agreed.${why}`);
      }
      d.demoId = t.demo_id;
      d.subject = t.subject;
      d.studentName = t.student?.student_name ?? ""; d.studentCard = studentCard(t.student ?? {}, d.hide);
      if (agreed.length === 1) return dealStart(ctx, d, agreed[0]);
      d.options = agreed.slice(0, 9);
      return go(ctx, "ad_dl_pick", d);
    }
    case "ad_dl_pick": {
      const chosen = (d.options ?? []).find((o: Json) => o.tutor_id === pickedId);
      return chosen ? dealStart(ctx, d, chosen) : [prompt(step, d)];
    }
    case "ad_dl_days": {
      const days = parseDays(text);
      if (!days.length) return again("I could not read the days.\nType them like *Mon, Wed, Fri* or *Mon-Sat*, or *Daily*.");
      d.days = days;
      return go(ctx, "ad_dl_start", d);
    }
    case "ad_dl_start": {
      const iso = choice === "dl_start:today" ? todayIst() : choice === "dl_start:tomorrow" ? addDaysIso(todayIst(), 1) : parseDate(text);
      if (!iso) return again("That is not a valid date.\nType it like *20-10-2026*, or *Today* / *Tomorrow*.");
      if (iso < addDaysIso(todayIst(), -30)) return again("That date is too far in the past.");
      d.start = iso;
      return go(ctx, "ad_dl_time", d);
    }
    case "ad_dl_time": {
      const hhmm = parseTime(text);
      if (!hhmm) return again("That is not a valid time.\nType it like *5 PM*, *5:30 PM* or *17:30*.");
      d.time = hhmm;
      return go(ctx, "ad_dl_min", d);
    }
    case "ad_dl_min": {
      const n = Math.round(Number(choice.startsWith("dl_min:") ? choice.slice(7) : text.replace(/\s*(min|minutes?)$/i, "")));
      if (!(n >= 10 && n <= 600)) return again("Type the minutes for each class, like *45* or *60*.");
      d.minutes = n;
      return go(ctx, "ad_dl_model", d);
    }
    case "ad_dl_model": {
      const model = choice.startsWith("dl_model:") ? choice.slice(9) : "";
      if (model !== "commission" && model !== "margin") return [prompt(step, d)];
      d.model = model;
      return go(ctx, "ad_dl_fee", d);
    }
    case "ad_dl_fee": {
      const amount = parseAmount(text);
      if (!amount) return again("That is not a valid amount.\nType the amount in rupees.");
      d.fee = amount;
      return go(ctx, "ad_dl_cut", d);
    }
    case "ad_dl_cut": {
      const cut = parseCut(text);
      if (!cut) return again("I could not read that.\nType a percentage like *20%*, or an amount like *1000*.");
      if (cut.type === "percent" ? cut.value > 100 : cut.value > d.fee) return again(cut.type === "percent" ? "A percentage cannot be more than 100." : "The agency's share cannot be more than the fee.");
      d.cutType = cut.type;
      d.cutValue = cut.value;
      if (d.model === "margin") d.feeTo = "Agency";
      return go(ctx, d.model === "margin" ? "ad_dl_freq" : "ad_dl_payto", d);
    }
    case "ad_dl_payto": {
      const to = choice.startsWith("dl_to:") ? choice.slice(6) : "";
      if (to !== "Tutor" && to !== "Agency") return [prompt(step, d)];
      d.feeTo = to;
      return go(ctx, "ad_dl_freq", d);
    }
    case "ad_dl_freq": {
      const f = choice.startsWith("dl_freq:") ? choice.slice(8) : /^weekly$/i.test(text) ? "Weekly" : /^monthly$/i.test(text) ? "Monthly" : "";
      if (!["Weekly", "15 Days", "Monthly"].includes(f)) return [prompt(step, d)];
      d.freq = f;
      return go(ctx, "ad_dl_confirm", d);
    }
    case "ad_dl_confirm": {
      if (choice !== "ad_yes") return [prompt(step, d)];
      const dates = classDatesFor(d.start, d.days);
      if (!dates.length) return finish(ctx, "No class falls on those days in the first month.");
      const fresh = (await rest(`applications?demo_id=eq.${q(d.demoId)}&tutor_id=eq.${q(d.tutorId)}&select=billing_plan`))?.[0];
      const deal = { ...(fresh?.billing_plan?.deal ?? {}), ...dealOf(d) };
      const m: Json = dealNumbers(deal, dates.length);
      const parentDue = nextParentDate(d.start, d.freq);
      const changes: Json = {
        "Class Dates": dates, "Class Start Date": d.start, "Billing Mode": deal.model,
        "Billing Plan": { ...(fresh?.billing_plan ?? {}), deal },
        "Class Duration": deal.minutes,
        "Class Charges": m.model === "margin" ? m.parentPerClass : m.perClass,
        "Class Total Amount": m.model === "margin" ? m.parentMonthly : m.monthlyFee,
        "Student Payment To": m.model === "commission" ? m.feeTo : "Agency",
        "Tutor Payment From": m.model === "commission" && m.feeTo === "Tutor" ? "Parents" : "Agency",
        "Tutor Agency Charge": m.model === "commission" ? m.cut : m.agencyMonthly,
        "Student Payment Frequency": d.freq, "Tutor Payment Frequency": d.freq,
        "Student Next Due Date": parentDue, "Tutor Next Payment Date": addDaysIso(parentDue, 1),
      };
      const saved = await adminCall(d.eid, "adminUpdateDemoRow", { demoId: d.demoId, tutorId: d.tutorId, changes });
      if (!saved?.success) return finish(ctx, `The class could not be saved.\n${String(saved?.message ?? "")}`);
      const sent = await adminCall(d.eid, "adminFinalizeClass", { demoId: d.demoId, tutorId: d.tutorId, deal });
      if (!sent?.success) return finish(ctx, `The class was saved, but the agreement was not sent.\n${String(sent?.message ?? "")}`);
      return finish(ctx, `*Class set and agreement sent!*\n*${d.subject}* (${d.demoId}) with ${d.tutorLine}\n${dates.length} classes in the first month, from ${fmtDate(d.start)}.\n\nThe parent and the tutor have got the agreement.`);
    }
  }
  return [];
}

/* --------------------------------------------------------- step helpers */

function stateText(accepted: unknown, rejected: unknown): string {
  return rejected ? "Rejected" : accepted ? "Agreed" : "Waiting";
}

// the chosen tuition: show it with the student, then ask for the tutor
async function pickTuition(ctx: Ctx, d: Json, t: Json): Promise<Out[]> {
  d.demoId = t.demo_id; d.subject = t.subject; d.studentName = t.student?.student_name ?? "";
  d.studentCard = studentCard(t.student ?? {}, d.hide);
  d.wanted = wantedText(t.preferred_tutor);
  d.studentText = studentFullText(t.student ?? {}, !!d.hide);
  d.tuitionText = tuitionText(t);
  const onIt = await applicationsFor(t.demo_id);
  d.card = `${tuitionText(t, true)}\n\n${d.studentText}` + (onIt.length ? `\n\nTutors on it:\n${onIt.map((r) => "- " + tutorCard(r.tutor, d.hide)).join("\n")}` : "");
  await save(ctx, "ad_as_tutor", d);
  return [prompt("ad_as_tutor", d)];
}

async function assignConfirm(ctx: Ctx, d: Json, tutor: Json): Promise<Out[]> {
  const again = (msg: string): Out[] => [{ text: `${msg}\n\n${RETRY}` }];
  if (tutor.blocked_at) return again(`*${tutor.full_name}* is blocked.`);
  if (tutor.verification_status !== "Verified") return again(`*${tutor.full_name}* is not a verified tutor.`);
  if ((await applicationsFor(d.demoId)).some((r) => r.tutor_id === tutor.tutor_id)) return again(`*${tutor.full_name}* is already on this tuition.`);
  d.tutorId = tutor.tutor_id;
  d.tutorLine = person(tutor) + (tutor.gender ? ` (${tutor.gender})` : "");
  d.tutorCard = tutorCard(tutor, d.hide);
  d.tutorText = tutorFullText(tutor, !!d.hide);
  d.mismatch = /^(male|female)$/i.test(d.wanted) && String(tutor.gender ?? "").toLowerCase() !== d.wanted.toLowerCase();
  return go(ctx, "ad_as_confirm", d);
}

async function demoDate(ctx: Ctx, d: Json, row: Json): Promise<Out[]> {
  d.tutorId = row.tutor_id;
  d.tutorName = row.tutorName;
  d.tutorLine = person({ ...row, full_name: row.tutorName });
  d.tutorCard = tutorCard(row.tutor ?? {}, d.hide);
  d.currentDemo = row.demo_date ? `${fmtDate(row.demo_date)}${row.demo_time ? ", " + fmtTime(row.demo_time) : ""}` : "";
  return go(ctx, "ad_sd_date", d);
}

// Both sides have agreed: show what the deal says the instalments are (when the class has been finalised), then ask the kind.
async function payKind(ctx: Ctx, d: Json, row: Json): Promise<Out[]> {
  d.tutorId = row.tutor_id;
  d.tutorName = row.tutorName;
  d.tutorLine = person({ ...row, full_name: row.tutorName });
  d.tutorCard = tutorCard(row.tutor ?? {}, d.hide);
  const deal = row.billing_plan?.deal ?? {};
  const dates = (row.class_dates ?? []).map(String);
  const ready = deal.finalizedAt && (deal.model === "margin" || deal.model === "commission") && dates.length;
  const m = ready ? dealNumbers(deal, dates.length) : null;
  await save(ctx, "ad_pm_kind", d);
  return [{
    text: `*Record Payment*\n*${d.subject}* (${d.demoId})\nStudent: ${d.studentCard}\nTutor: ${d.tutorCard}\nThe tutor and the parent have agreed.` +
      (m ? `\n\nAs per the deal -\nParent pays each time: ${inr(m.parentInstallment)}\nTutor gets each time: ${inr(m.tutorInstallment)}` : ""),
  }, prompt("ad_pm_kind", d)];
}

/* ------------------------------------------------------ student + deal */

// The details of "Add New Student": the main ones first, then the optional extras (only for a number with no student yet).
const ST_FIELDS: { step: string; key: string; required?: boolean; check: (v: string) => string; fix?: (v: string) => string }[] = [
  { step: "ad_st_gender", key: "gender", required: true, check: (v) => v === "Male" || v === "Female" ? "" : "Please tap *Male* or *Female*." },
  { step: "ad_st_class", key: "className", required: true, check: (v) => v.length >= 1 && v.length <= 80 ? "" : "Please type the class." },
  { step: "ad_st_board", key: "board", required: true, check: (v) => v.length >= 2 && v.length <= 150 ? "" : "Please type the board / university." },
  { step: "ad_st_school", key: "school", check: (v) => v.length >= 2 && v.length <= 150 ? "" : "Please type the school / college, or tap *Skip*.", fix: titleCase },
  { step: "ad_st_email", key: "email", check: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && v.length <= 120 ? "" : "That doesn't look like an email address.\nType it again, or tap *Skip*.", fix: (v) => v.toLowerCase() },
  { step: "ad_st_city", key: "city", check: (v) => v.length >= 2 && v.length <= 80 ? "" : "Please type the city, or tap *Skip*.", fix: titleCase },
  { step: "ad_st_pin", key: "pinCode", check: (v) => /^\d{6}$/.test(v) ? "" : "The PIN code must be 6 digits, or tap *Skip*." },
  { step: "ad_st_address", key: "address", check: (v) => v.length >= 5 && v.length <= 250 ? "" : "Please type the address (a few words), or tap *Skip*." },
];

function nextStudentStep(step: string, d: Json): string {
  const i = ST_FIELDS.findIndex((x) => x.step === step);
  const next = ST_FIELDS[i + 1];
  if (step === "ad_st_school") return (d.ex ?? []).length ? "ad_st_confirm" : "ad_st_more";
  return next ? next.step : "ad_st_confirm";
}


// Students already on this number: parent, each student with the ID, then the numbers and the address.
function foundCard(d: Json): string {
  return `*Students with this WhatsApp / Mobile Number:*\n\n${studentsBlock(d.ex ?? [], !!d.hide)}\n\nDo you want to add one more student here?`;
}

function studentSummary(d: Json): string {
  const f = d.f ?? {};
  const home = (d.ex ?? [])[0];
  const line = (label: string, v: unknown) => v ? `${label}: ${v}\n` : "";
  const wa = numText(home?.whatsapp || f.whatsapp, d.hide), ph = numText(home?.phone || f.whatsapp, d.hide);
  return ("*Please check the new student:*\n\n" +
    `Parent: ${home?.parents_name || f.parentsName || "(not given)"}\n` + `Student: *${f.studentName}*\n` +
    line("Gender", f.gender) + line("Class", f.className) + line("Board", f.board) + line("School", f.school) +
    line("WhatsApp", wa) + line("Mobile No.", ph) +
    line("Email", home?.email || f.email) + line("Address", d.hide ? "" : fullAddress(home ?? { address: f.address, city: f.city, pin_code: f.pinCode }))).trimEnd();
}

// the saved student, with everything we hold (numbers hidden for a "Hide Mobile Number" account)
function newStudentCard(d: Json): string {
  const s = d.saved ?? {};
  const line = (label: string, v: unknown) => v ? `\n${label}: ${v}` : "";
  const wa = numText(s.whatsapp, d.hide), ph = numText(s.phone, d.hide);
  return "*New Student Added!*\n\n*Student Details:*\n" +
    `Name: *${s.student_name ?? d.studentName}*\nStudent ID: ${s.student_id ?? d.studentId}` +
    line("Gender", s.gender) + line("Class", s.class_name) + line("Board", s.board) + line("School", s.school) +
    line("Parent", s.parents_name) + line("WhatsApp", wa) + line("Mobile No.", ph) +
    (d.hide ? "" : line("Email", s.email) + line("Address", fullAddress(s)));
}

// the deal in the shape the Admin Panel saves it
function dealOf(d: Json): Json {
  const margin = d.model === "margin";
  return {
    model: d.model, minutes: String(d.minutes), time: d.time,
    monthlyFee: margin ? "" : d.fee, cutType: margin ? "percent" : d.cutType, cutValue: margin ? "" : d.cutValue,
    parentPerClass: margin ? d.fee : "", marginType: margin ? d.cutType : "amount", marginValue: margin ? d.cutValue : "",
    parentFreq: d.freq, tutorFreq: d.freq, feeTo: margin ? "Agency" : d.feeTo,
  };
}

function dealSummary(d: Json): string {
  const dates = classDatesFor(d.start, d.days);
  const m: Json = dealNumbers(dealOf(d), dates.length);
  const per = d.freq === "Weekly" ? "Weekly" : d.freq === "15 Days" ? "Every 15 days" : "Monthly";
  const money = m.model === "margin"
    ? `Parent pays per class: *${inr(m.parentPerClass)}*\nAgency keeps: ${inr(m.margin)} per class\nTutor gets: *${inr(m.tutorPerClass)}* per class\n` +
      `Parent pays: ${per} - *${inr(m.parentInstallment)}*\nTutor is paid by the agency: ${per} - ${inr(m.tutorInstallment)}`
    : `Monthly fee: *${inr(m.monthlyFee)}*\nAgency cut: ${inr(m.cut)}${m.cutPercent ? ` (${m.cutPercent}%)` : ""} - once, from the first month\n` +
      `First month's fee goes to: *${m.feeTo}*\n` +
      (m.feeTo === "Agency" ? `Tutor gets (first month): ${inr(m.tutorFirstMonth)}\n` : `Tutor pays the agency: ${inr(m.cut)}\n`) +
      `Parent pays: ${per} - *${inr(m.parentInstallment)}*`;
  return `*Please check the class deal:*\n\n*${d.subject}* (${d.demoId})\nStudent: ${d.studentCard}\nTutor: ${d.tutorCard}\n\n` +
    `Days: ${daysText(d.days)}\nStarts: ${fmtDate(d.start)}, ${fmtTime(d.time)} (${d.minutes} min)\n` +
    `Classes in the first month: ${dates.length}\n\n${money}\nNext parent payment: ${fmtDate(nextParentDate(d.start, d.freq))}\n\n` +
    "The agreement will be sent to the parent and the tutor.";
}

async function dealStart(ctx: Ctx, d: Json, row: Json): Promise<Out[]> {
  d.tutorId = row.tutor_id;
  d.tutorName = row.tutorName;
  d.tutorLine = person({ ...row, full_name: row.tutorName });
  d.tutorCard = tutorCard(row.tutor ?? {}, d.hide);
  d.existing = !!row.billing_plan?.deal?.finalizedAt;
  return go(ctx, "ad_dl_days", d);
}
