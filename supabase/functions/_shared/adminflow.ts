// WhatsApp (later Telegram) chat flows for an EMPLOYEE (admin), shared by the bots.
//   1. New Tuition        - find the parent by WhatsApp / mobile number or Student ID, then the usual tuition questions
//   2. Assign Tutor       - Tuition ID, then the tutor's WhatsApp / mobile number (or Tutor ID)
//   3. Schedule Demo      - Tuition ID, tutor, date, time
//   4. Tutor Confirmation - see who has agreed on a tuition; confirm for a tutor
//   5. Create Payment     - only for a tuition where the tutor and the parent have both agreed
// Every change is made by the "admin" Edge Function (see adminbridge.ts), so it follows the same rules as the
// Admin Panel: the employee must be active, inside their login hours and allowed to run that action.
// The chat only decides what to ask; reading (names, IDs, status) is done here with the service role.
import { accountsByPhone, inList, last10, q, rest } from "./botdata.ts";
import { adminCall } from "./adminbridge.ts";
import { startTuition } from "./tuitionflow.ts";
import { fmtDate, fmtTime } from "./format.ts";
import { inr } from "./mails.ts";
import { dealNumbers } from "./deal.ts";
import { type Choice, type Ctx, type Input, type Out, clean, clear, save } from "./session.ts";

type Json = Record<string, any>;
export type AdminKind = "new" | "assign" | "demo" | "conf" | "pay";

const CANCEL: Choice = { id: "cancel", title: "Cancel" };
const YES = (title: string): Choice => ({ id: "ad_yes", title });
const RETRY = "Type again, or *Cancel*.";
const MENU_HINT = "\n\nSend *Hi* any time for the menu.";

// What the employee needs for each flow (the admin function checks the real action again when it runs).
const NEED: Record<AdminKind, string> = {
  new: "tuitions_add", assign: "tuitions_assign_tutor", demo: "tuitions_edit", conf: "tuitions_view", pay: "payments_add",
};

const FIRST_STEP: Record<AdminKind, string> = {
  new: "ad_new_find", assign: "ad_as_demo", demo: "ad_sd_demo", conf: "ad_tc_demo", pay: "ad_pm_demo",
};

const TITLE: Record<AdminKind, string> = {
  new: "New Tuition", assign: "Assign Tutor", demo: "Schedule Demo", conf: "Tutor Confirmation", pay: "Create Payment",
};

/* ------------------------------------------------------------------ menu */

// The rows an employee sees in their WhatsApp menu, only for what they may do.
export function adminMenuRows(perms: string[]): Choice[] {
  const has = (p: string) => perms.includes(p);
  const rows: Choice[] = [];
  (["new", "assign", "demo", "conf", "pay"] as AdminKind[]).forEach((k) => {
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

/* ----------------------------------------------------------------- data */

const modeText = (m: unknown) => /^online$/i.test(String(m)) ? "Online" : /^(home|offline)$/i.test(String(m)) ? "Home" : "Home or Online";
const wantedText = (t: unknown) => /^(male|female)$/i.test(String(t).trim()) ? String(t).trim() : "Male or Female";

async function findTuition(demoId: string): Promise<Json | null> {
  const t = (await rest(`tuitions?demo_id=eq.${q(demoId)}&select=demo_id,subject,medium,preferred_tutor,student_id,terminated`))?.[0];
  if (!t) return null;
  const student = (await rest(`students?student_id=eq.${q(t.student_id)}&select=student_id,student_name,class_name,board,blocked_at`))?.[0] ?? {};
  const status = String(await rest("rpc/tuition_status", { method: "POST", body: JSON.stringify({ p_demo_id: demoId }) }) ?? "");
  return { ...t, student, status };
}

const closed = (t: Json) => t.terminated === true || ["Completed", "Terminated"].includes(t.status);

function tuitionCard(t: Json): string {
  const cls = [t.student?.class_name, t.student?.board].filter(Boolean).join(" · ");
  return `*${t.subject}* (${t.demo_id})\nStudent: *${t.student?.student_name ?? "-"}* (${t.student?.student_id ?? "-"})\n` +
    (cls ? `Class: ${cls}\n` : "") + `Mode: ${modeText(t.medium)}\nTutor wanted: ${wantedText(t.preferred_tutor)}\nStatus: ${t.status || "-"}`;
}

const APP_COLS = "tutor_id,parent_accepted,tutor_accepted,parent_rejected,tutor_rejected,classes_completed,demo_date,demo_time,billing_plan,class_dates";

async function applicationsFor(demoId: string): Promise<Json[]> {
  const rows: Json[] = await rest(`applications?demo_id=eq.${q(demoId)}&select=${APP_COLS}&order=id`) ?? [];
  const ids = [...new Set(rows.map((r) => String(r.tutor_id)))];
  const tutors: Json[] = ids.length ? await rest(`tutors?tutor_id=${inList(ids)}&select=tutor_id,full_name,gender`) ?? [] : [];
  return rows.map((r) => ({ ...r, tutorName: String(tutors.find((t) => t.tutor_id === r.tutor_id)?.full_name ?? r.tutor_id) }));
}

async function findTutors(c: { kind: string; value: string }): Promise<Json[]> {
  const cols = "tutor_id,full_name,gender,verification_status,blocked_at";
  if (c.kind === "tid") return await rest(`tutors?tutor_id=eq.${q(c.value)}&select=${cols}`) ?? [];
  const [a, b] = await Promise.all([
    rest(`tutors?whatsapp10=eq.${c.value}&select=${cols}`),
    rest(`tutors?mobile10=eq.${c.value}&select=${cols}`),
  ]);
  return [...new Map([...(a ?? []), ...(b ?? [])].map((r: Json) => [r.tutor_id, r])).values()];
}

async function findStudents(c: { kind: string; value: string }): Promise<Json[]> {
  if (c.kind === "sid") return await rest(`students?student_id=eq.${q(c.value)}&select=student_id,student_name,parents_name,blocked_at`) ?? [];
  return (await accountsByPhone(c.value)).students;
}

const person = (p: Json, id = "tutor_id", name = "full_name") => `*${p[name] ?? "-"}* (${p[id]})`;

/* --------------------------------------------------------------- prompts */

const askDemo = (kind: AdminKind): Out => ({
  text: `*${TITLE[kind]}*\nYou can type *Cancel* any time.\n\nEnter the *Tuition ID*.\nIt starts with *DID* followed by *8 digits*.\n\nFor example -\nDID20260007`,
});

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
      text: "*New Tuition*\nYou can type *Cancel* any time.\n\n" +
        (d.hide
          ? "Send the *Student ID*.\n\nFor example -\nSID20260613"
          : "Send the parent's *WhatsApp number* or *mobile number*, or the *Student ID*.\n\nFor example -\n9876543210\nSID20260613"),
    };
    case "ad_new_pick": return pickOut("Which *student* is the tuition for?", d.options, "student_id", "student_name");
    case "ad_as_demo": return askDemo("assign");
    case "ad_sd_demo": return askDemo("demo");
    case "ad_tc_demo": return askDemo("conf");
    case "ad_pm_demo": return askDemo("pay");
    case "ad_as_tutor": return {
      text: d.hide
        ? "Send the tutor's *Tutor ID*.\n\nFor example -\nTID20260123"
        : "Send the tutor's *WhatsApp number* or *mobile number*, or the *Tutor ID*.\n\nFor example -\n9876543210\nTID20260123",
    };
    case "ad_as_pick": return pickOut("Which *tutor*?", d.options, "tutor_id", "full_name");
    case "ad_as_confirm": return {
      text: `*Please check:*\n\nAssign ${d.tutorLine}\n\nto *${d.subject}* (${d.demoId}) of *${d.studentName}*?` +
        (d.mismatch ? `\n\nNote: this tuition asks for *${d.wanted.toLowerCase()}* tutors.` : ""),
      choices: [YES(d.mismatch ? "Assign Anyway" : "Assign"), CANCEL],
    };
    case "ad_sd_pick": return pickOut("Which *tutor* is the demo for?", d.options, "tutor_id", "tutorName",
      (o) => o.demo_date ? `${o.tutor_id} · demo ${fmtDate(o.demo_date)}` : `${o.tutor_id} · no demo yet`);
    case "ad_sd_date": return {
      text: `Demo *date* for *${d.tutorName}*?\n\nType it like *18-10-2026* (day-month-year), or *Today* / *Tomorrow*.` +
        (d.currentDemo ? `\n\nThe demo is now on ${d.currentDemo}. A new date will move it.` : ""),
    };
    case "ad_sd_time": return { text: "Demo *time*?\n\nFor example -\n5 PM\n5:30 PM\n17:30" };
    case "ad_sd_confirm": return {
      text: `*Please check the demo:*\n\n*${d.subject}* (${d.demoId})\nStudent: *${d.studentName}*\nTutor: ${d.tutorLine}\n` +
        `Date: *${fmtDate(d.date)}*\nTime: *${fmtTime(d.time)}*\n\nThe parent and the tutor will be told.`,
      choices: [YES("Schedule"), CANCEL],
    };
    case "ad_tc_pick": return {
      text: "Confirm for which tutor?\nUse this only after the tutor has agreed to you.",
      choices: [...d.options.slice(0, 8).map((o: Json) => ({ id: `ad_pick:${o.tutor_id}`, title: `Confirm: ${o.tutorName}`, description: String(o.tutor_id) })),
        { id: "ad_done", title: "Done" }],
    };
    case "ad_tc_confirm": return {
      text: `Confirm for ${d.tutorLine} that the tutor *accepts* *${d.subject}* (${d.demoId})?\n\nUse this only after the tutor has agreed to you.`,
      choices: [YES("Yes, Confirm"), CANCEL],
    };
    case "ad_pm_pick": return pickOut("Which *tutor* is the payment for?", d.options, "tutor_id", "tutorName");
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
      text: `*Please check the payment:*\n\n*${d.subject}* (${d.demoId})\nStudent: *${d.studentName}*\nTutor: ${d.tutorLine}\n` +
        `Kind: ${KIND_TEXT[d.kind]}\nAmount: *${inr(d.amount)}*\nPayment type: ${PTYPE_TEXT[d.ptype]}\nMode: ${d.mode}\n` +
        `Date: ${fmtDate(d.date)}\n` + (d.next ? `Next payment: ${fmtDate(d.next)}\n` : "") +
        "\nThe parent / tutor will get the payment message.",
      choices: [YES("Record Payment"), CANCEL],
    };
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

  if (choice === "cancel" || /^cancel$/i.test(text)) return finish(ctx, "Cancelled.");
  const again = (msg: string): Out[] => [{ text: `${msg}\n\n${RETRY}` }];
  const pickedId = choice.startsWith("ad_pick:") ? choice.slice(8) : "";

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
      if (open.length === 1) return startTuition(ctx, [open[0]], { adminId: d.eid });
      d.options = open.slice(0, 9).map((x) => ({ student_id: x.student_id, student_name: x.student_name }));
      return go(ctx, "ad_new_pick", d);
    }
    case "ad_new_pick": {
      const chosen = (d.options ?? []).find((o: Json) => o.student_id === pickedId);
      if (!chosen) return [prompt(step, d)];
      return startTuition(ctx, [{ student_id: chosen.student_id, student_name: chosen.student_name }], { adminId: d.eid });
    }

    /* ---------- 2. assign tutor ---------- */
    case "ad_as_demo": {
      const c = classify(text);
      if (c.kind !== "did") return again("That is not a valid *Tuition ID*.\nIt starts with *DID* followed by *8 digits*.");
      const t = await findTuition(c.value);
      if (!t) return again(`No tuition was found with the ID *${c.value}*.`);
      if (closed(t)) return again(`*${c.value}* is closed (${t.status || "terminated"}).`);
      if (t.student?.blocked_at) return again("This student is blocked.");
      d.demoId = t.demo_id; d.subject = t.subject; d.studentName = t.student?.student_name ?? "";
      d.wanted = wantedText(t.preferred_tutor);
      const onIt = (await applicationsFor(t.demo_id)).length;
      d.card = tuitionCard(t) + `\nTutors on it: ${onIt}`;
      await save(ctx, "ad_as_tutor", d);
      return [{ text: d.card }, prompt("ad_as_tutor", d)];
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
      return finish(ctx, `*Tutor assigned!*\n${d.tutorLine} is now on *${d.subject}* (${d.demoId}).\n\nNext: *Schedule Demo* in the Menu.`);
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
      d.demoId = t.demo_id; d.subject = t.subject; d.studentName = t.student?.student_name ?? "";
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
      const lines = rows.map((r) => `${person({ ...r, full_name: r.tutorName })}\nTutor: ${stateText(r.tutor_accepted, r.tutor_rejected)}\nParent: ${stateText(r.parent_accepted, r.parent_rejected)}\n` +
        `Demo: ${r.demo_date ? `${fmtDate(r.demo_date)}${r.demo_time ? ", " + fmtTime(r.demo_time) : ""}` : "Not scheduled"}`);
      const head = `${tuitionCard(t)}\n\n${lines.join("\n\n")}`;
      const canConfirm = d.perms.includes("tuitions_edit") && !closed(t);
      const todo = rows.filter((r) => !r.tutor_accepted && !r.tutor_rejected && !r.parent_rejected);
      if (!canConfirm || !todo.length) {
        const both = rows.some((r) => r.tutor_accepted && r.parent_accepted && !r.tutor_rejected && !r.parent_rejected);
        return finish(ctx, head + (both ? "\n\nThe tutor and the parent have agreed. Use *Create Payment* in the Menu." : ""));
      }
      d.demoId = t.demo_id; d.subject = t.subject; d.options = todo.slice(0, 8);
      await save(ctx, "ad_tc_pick", d);
      return [{ text: head }, prompt("ad_tc_pick", d)];
    }
    case "ad_tc_pick": {
      if (choice === "ad_done") return finish(ctx, "Done.");
      const chosen = (d.options ?? []).find((o: Json) => o.tutor_id === pickedId);
      if (!chosen) return [prompt(step, d)];
      d.tutorId = chosen.tutor_id; d.tutorLine = person({ ...chosen, full_name: chosen.tutorName });
      return go(ctx, "ad_tc_confirm", d);
    }
    case "ad_tc_confirm": {
      if (choice !== "ad_yes") return [prompt(step, d)];
      const res = await adminCall(d.eid, "adminUpdateDemoRow", { demoId: d.demoId, tutorId: d.tutorId, changes: { "Tutor Accepted": true } });
      if (!res?.success) return finish(ctx, `It could not be saved.\n${String(res?.message ?? "")}`);
      const row = (await applicationsFor(d.demoId)).find((r) => r.tutor_id === d.tutorId);
      const parentOk = !!row?.parent_accepted && !row?.parent_rejected;
      return finish(ctx, `*Tutor confirmed.*\n${d.tutorLine} accepts *${d.subject}* (${d.demoId}).\n\nParent: ${stateText(row?.parent_accepted, row?.parent_rejected)}` +
        (parentOk ? "\n\nThe tutor and the parent have agreed. Use *Create Payment* in the Menu." : ""));
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
      d.demoId = t.demo_id; d.subject = t.subject; d.studentName = t.student?.student_name ?? "";
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
  }
  return [];
}

/* --------------------------------------------------------- step helpers */

function stateText(accepted: unknown, rejected: unknown): string {
  return rejected ? "Rejected" : accepted ? "Agreed" : "Waiting";
}

async function assignConfirm(ctx: Ctx, d: Json, tutor: Json): Promise<Out[]> {
  const again = (msg: string): Out[] => [{ text: `${msg}\n\n${RETRY}` }];
  if (tutor.blocked_at) return again(`*${tutor.full_name}* is blocked.`);
  if (tutor.verification_status !== "Verified") return again(`*${tutor.full_name}* is not a verified tutor.`);
  if ((await applicationsFor(d.demoId)).some((r) => r.tutor_id === tutor.tutor_id)) return again(`*${tutor.full_name}* is already on this tuition.`);
  d.tutorId = tutor.tutor_id;
  d.tutorLine = person(tutor) + (tutor.gender ? ` (${tutor.gender})` : "");
  d.mismatch = /^(male|female)$/i.test(d.wanted) && String(tutor.gender ?? "").toLowerCase() !== d.wanted.toLowerCase();
  return go(ctx, "ad_as_confirm", d);
}

async function demoDate(ctx: Ctx, d: Json, row: Json): Promise<Out[]> {
  d.tutorId = row.tutor_id;
  d.tutorName = row.tutorName;
  d.tutorLine = person({ ...row, full_name: row.tutorName });
  d.currentDemo = row.demo_date ? `${fmtDate(row.demo_date)}${row.demo_time ? ", " + fmtTime(row.demo_time) : ""}` : "";
  return go(ctx, "ad_sd_date", d);
}

// Both sides have agreed: show what the deal says the instalments are (when the class has been finalised), then ask the kind.
async function payKind(ctx: Ctx, d: Json, row: Json): Promise<Out[]> {
  d.tutorId = row.tutor_id;
  d.tutorName = row.tutorName;
  d.tutorLine = person({ ...row, full_name: row.tutorName });
  const deal = row.billing_plan?.deal ?? {};
  const dates = (row.class_dates ?? []).map(String);
  const ready = deal.finalizedAt && (deal.model === "margin" || deal.model === "commission") && dates.length;
  const m = ready ? dealNumbers(deal, dates.length) : null;
  await save(ctx, "ad_pm_kind", d);
  return [{
    text: `*Create Payment*\n*${d.subject}* (${d.demoId})\nStudent: *${d.studentName}*\nTutor: ${d.tutorLine}\nThe tutor and the parent have agreed.` +
      (m ? `\n\nAs per the deal -\nParent pays each time: ${inr(m.parentInstallment)}\nTutor gets each time: ${inr(m.tutorInstallment)}` : ""),
  }, prompt("ad_pm_kind", d)];
}
