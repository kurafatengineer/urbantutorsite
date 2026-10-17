// WhatsApp template messages (approved in Meta's WhatsApp Manager) for the automatic notifications:
//   class reminder (tutor + student), "did you take the class?" (tutor, Yes / No), "class conducted" (student),
//   "a tutor applied" (student, first one / later ones with a "Check All Tutors" button),
//   "demo scheduled" (tutor + student).
// Every sender here is safe to call from any Edge Function: it never throws, and it sends nothing unless
// app_settings "whatsapp" has {"enabled": true}. The agency number lives in the same setting, so it can be
// changed without touching a template.

import { accountsByPhone, inList, last10, q, rest } from "./botdata.ts";
import { fmtDate, fmtTime } from "./format.ts";

type Json = Record<string, any>;

const TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

// Template names exactly as they are in WhatsApp Manager, and their language code.
export const WA_LANG = "en";
export const TEMPLATES = {
  classReminderTutor: "class_reminder_tutor",
  classReminderStudent: "class_reminder_student",
  classCheck: "class_taken_check",
  classDone: "class_done_student",
  tutorAppliedFirst: "new_tutor_applied_first",
  tutorApplied: "new_tutor_applied",
  demoTutor: "demo_scheduled_tutor",
  demoStudent: "demo_scheduled_student",
};

const DEFAULT_AGENCY = "+91 90018 00307";
let cached: { at: number; enabled: boolean; agency: string } | null = null;

async function settings(): Promise<{ enabled: boolean; agency: string }> {
  if (cached && Date.now() - cached.at < 30_000) return cached;
  const row = (await rest("app_settings?key=eq.whatsapp&select=value"))?.[0]?.value ?? {};
  cached = { at: Date.now(), enabled: row.enabled === true, agency: String(row.agency_phone ?? "").trim() || DEFAULT_AGENCY };
  return cached;
}

export const agencyPhone = async () => (await settings()).agency;

/* ---- small helpers ---- */

export const waNumber = (v: unknown) => { const d = last10(v); return d.length === 10 ? `91${d}` : ""; };

// "+91 98765 43210"
export const phoneText = (v: unknown) => {
  const d = last10(v);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : "-";
};

// template variables cannot hold new lines, tabs or runs of spaces, and cannot be empty
const clip = (v: unknown, max = 400) => {
  const s = String(v ?? "").replace(/[\r\n\t]+/g, ", ").replace(/ {2,}/g, " ").trim();
  return (s.length > max ? s.slice(0, max - 1) + "…" : s) || "-";
};

const modeWord = (m: unknown) => /^online$/i.test(String(m).trim()) ? "Online" : /^(home|offline)$/i.test(String(m).trim()) ? "Home" : "Home or Online";
const yearsText = (n: unknown) => {
  const x = Number(n);
  return Number.isFinite(x) && String(n ?? "") !== "" ? `${x} ${x === 1 ? "Year" : "Years"}` : "Not given";
};
const addressOf = (s: Json) => [s.address, [s.city, s.pin_code].filter(Boolean).join(" - ")].filter(Boolean).join(", ");
const quiet = (r: Json | null | undefined) => !r || !!r.blocked_at || r.notifications_off === true;

// numbers shown to the other side: both lines always carry a number (the mobile number is the main one)
const studentNumbers = (s: Json) => ({ wa: phoneText(s.whatsapp || s.phone), mobile: phoneText(s.phone || s.whatsapp), to: s.whatsapp || s.phone });
const tutorNumbers = (t: Json) => ({ wa: phoneText(t.whatsapp_number || t.mobile_number), mobile: phoneText(t.mobile_number || t.whatsapp_number), to: t.whatsapp_number || t.mobile_number });

/* ---- the two kinds of send ---- */

async function post(body: Json): Promise<boolean> {
  if (!TOKEN || !PHONE_ID) return false;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    if (!res.ok) console.error("whatsapp send failed", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (err) {
    console.error("whatsapp send failed", String(err));
    return false;
  }
}

// A template message. `payloads` fill the Quick Reply buttons, in order.
export async function sendTemplate(phone: unknown, name: string, params: unknown[], payloads: string[] = []): Promise<boolean> {
  if (!(await settings()).enabled) return false;
  const to = waNumber(phone);
  if (!to) return false;
  const components: Json[] = [{ type: "body", parameters: params.map((p) => ({ type: "text", text: clip(p) })) }];
  payloads.forEach((payload, index) => components.push({
    type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }],
  }));
  return post({ to, type: "template", template: { name, language: { code: WA_LANG }, components } });
}

// A plain message: only allowed while the person messaged us in the last 24 hours (e.g. right after a button tap).
export const sendText = (to: string, body: string) => post({ to, type: "text", text: { body, preview_url: false } });

/* ---- what we know about a tuition ---- */

async function load(demoId: string, tutorId: string) {
  const tuition = (await rest(`tuitions?demo_id=eq.${q(demoId)}&select=demo_id,subject,medium,student_id`))?.[0];
  if (!tuition) return null;
  const student = (await rest(`students?student_id=eq.${q(String(tuition.student_id))}&select=student_id,student_name,parents_name,phone,whatsapp,address,city,pin_code,blocked_at,notifications_off`))?.[0];
  const tutor = (await rest(`tutors?tutor_id=eq.${q(tutorId)}&select=tutor_id,full_name,gender,experience_years,mobile_number,whatsapp_number,blocked_at,notifications_off`))?.[0];
  return student && tutor ? { tuition, student, tutor } : null;
}

const parentName = (s: Json) => String(s.parents_name || s.student_name || "there");

/* ---- class reminder + class check (the queue in class_notifications) ---- */

export async function waClassReminder(r: Json, audience: "tutor" | "student") {
  try {
    const d = await load(String(r.demo_id), String(r.tutor_id));
    if (!d) return;
    const { tuition, student, tutor } = d;
    const time = fmtTime(r.class_time), minutes = r.minutes ?? "";
    const agency = await agencyPhone();
    if (audience === "tutor") {
      if (quiet(tutor)) return;
      const s = studentNumbers(student);
      await sendTemplate(tutorNumbers(tutor).to, TEMPLATES.classReminderTutor, [
        tutor.full_name, tuition.subject, time, minutes, r.demo_id, student.student_name, student.student_id, s.wa, s.mobile, addressOf(student) || "Not given", agency,
      ]);
    } else {
      if (quiet(student)) return;
      const t = tutorNumbers(tutor);
      await sendTemplate(studentNumbers(student).to, TEMPLATES.classReminderStudent, [
        parentName(student), tuition.subject, time, minutes, r.demo_id, tutor.full_name, tutor.tutor_id, t.wa, t.mobile, agency,
      ]);
    }
  } catch (err) {
    console.error("whatsapp class reminder failed", String(err));
  }
}

export async function waClassCheck(r: Json) {
  try {
    const d = await load(String(r.demo_id), String(r.tutor_id));
    if (!d || quiet(d.tutor)) return;
    const { tuition, student, tutor } = d;
    const s = studentNumbers(student);
    const key = `${r.demo_id}:${r.tutor_id}:${r.class_date}`;
    await sendTemplate(tutorNumbers(tutor).to, TEMPLATES.classCheck, [
      tutor.full_name, tuition.subject, r.demo_id, fmtTime(r.class_time), r.minutes ?? "", student.student_name, s.wa, s.mobile, addressOf(student) || "Not given", r.minutes ?? "",
    ], [`cl:y:${key}`, `cl:n:${key}`]);
  } catch (err) {
    console.error("whatsapp class check failed", String(err));
  }
}

// the tutor said Yes: tell the parent
export async function waClassDone(demoId: string, tutorId: string, date: string, minutes: unknown) {
  try {
    const d = await load(demoId, tutorId);
    if (!d || quiet(d.student)) return;
    const { tuition, student, tutor } = d;
    const t = tutorNumbers(tutor);
    await sendTemplate(studentNumbers(student).to, TEMPLATES.classDone, [
      parentName(student), tuition.subject, fmtDate(date), minutes ?? "", demoId, tutor.full_name, tutor.tutor_id, t.wa, t.mobile, await agencyPhone(),
    ]);
  } catch (err) {
    console.error("whatsapp class done failed", String(err));
  }
}

/* ---- a tutor applied ---- */

export async function waTutorApplied(demoId: string, tutorId: string) {
  try {
    const d = await load(demoId, tutorId);
    if (!d || quiet(d.student)) return;
    const { tuition, student, tutor } = d;
    const apps: Json[] = await rest(`applications?demo_id=eq.${q(demoId)}&select=tutor_id,parent_rejected,tutor_rejected`) ?? [];
    const live = apps.filter((a) => !a.parent_rejected && !a.tutor_rejected);
    const others = live.filter((a) => String(a.tutor_id) !== tutorId).length;
    const base = [parentName(student), tuition.subject, demoId, tutor.full_name, tutor.tutor_id, tutor.gender || "Not given", yearsText(tutor.experience_years)];
    const agency = await agencyPhone();
    if (others === 0) await sendTemplate(studentNumbers(student).to, TEMPLATES.tutorAppliedFirst, [...base, agency]);
    else await sendTemplate(studentNumbers(student).to, TEMPLATES.tutorApplied, [...base, live.length, agency], [`tl:${demoId}`]);
  } catch (err) {
    console.error("whatsapp tutor applied failed", String(err));
  }
}

// "Check All Tutors": every tutor on the tuition, newest first, as plain messages (split when long)
export async function allTutorsTexts(demoId: string): Promise<string[]> {
  const tuition = (await rest(`tuitions?demo_id=eq.${q(demoId)}&select=subject`))?.[0];
  const apps: Json[] = (await rest(`applications?demo_id=eq.${q(demoId)}&select=id,tutor_id,applied_at,parent_rejected,tutor_rejected&order=applied_at.desc,id.desc`) ?? [])
    .filter((a: Json) => !a.parent_rejected && !a.tutor_rejected);
  const tutors: Json[] = apps.length
    ? await rest(`tutors?tutor_id=${inList(apps.map((a) => String(a.tutor_id)))}&select=tutor_id,full_name,gender,experience_years`) ?? []
    : [];
  const agency = await agencyPhone();
  const head = `*All Tutors Applied* 👨‍🏫\n\n*Subject:* ${tuition?.subject ?? "-"}\n*Tuition ID:* ${demoId}\n*Total Tutors:* ${apps.length}\n\n━━━━━━━━━━━━━━`;
  const foot = `━━━━━━━━━━━━━━\n\nTo choose a tutor, open your profile on the website, or contact our agency at ${agency}.`;
  if (!apps.length) return [`${head}\n\nNo tutor is on this tuition right now.\n\n${foot}`];
  const blocks = apps.map((a, i) => {
    const t = tutors.find((x) => x.tutor_id === a.tutor_id) ?? {};
    return `*${i + 1}. ${t.full_name ?? a.tutor_id}*${i === 0 ? " 🆕" : ""}\nTutor ID: ${a.tutor_id}\nGender: ${t.gender || "Not given"}\nExperience: ${yearsText(t.experience_years)}`;
  });
  const out: string[] = [];
  let cur = head;
  for (const b of blocks) {
    if ((cur + "\n\n" + b).length > 3400) { out.push(cur); cur = `*All Tutors Applied* (continued)\n\n━━━━━━━━━━━━━━`; }
    cur += "\n\n" + b;
  }
  out.push(`${cur}\n\n${foot}`);
  return out;
}

/* ---- demo scheduled ---- */

export async function waDemoScheduled(demoId: string, tutorId: string, date: string, time: string) {
  try {
    const d = await load(demoId, tutorId);
    if (!d) return;
    const { tuition, student, tutor } = d;
    const agency = await agencyPhone();
    const demo = [tuition.subject, demoId, fmtDate(date), fmtTime(time), modeWord(tuition.medium)];
    if (!quiet(student)) {
      const t = tutorNumbers(tutor);
      await sendTemplate(studentNumbers(student).to, TEMPLATES.demoStudent, [parentName(student), ...demo, tutor.full_name, tutor.tutor_id, t.wa, t.mobile, agency]);
    }
    if (!quiet(tutor)) {
      const s = studentNumbers(student);
      await sendTemplate(tutorNumbers(tutor).to, TEMPLATES.demoTutor, [tutor.full_name, ...demo, student.student_name, student.student_id, s.wa, s.mobile, addressOf(student) || "Not given", agency]);
    }
  } catch (err) {
    console.error("whatsapp demo scheduled failed", String(err));
  }
}

/* ---- button taps on the template messages ("cl:y:..." / "cl:n:..." / "tl:...") ---- */

export async function handleTemplateButton(from: string, payload: string): Promise<boolean> {
  const parts = payload.split(":");
  const me = last10(from);

  if (parts[0] === "cl" && (parts[1] === "y" || parts[1] === "n")) {
    const [, answer, demoId, tutorId, date] = parts;
    const tutor = (await rest(`tutors?tutor_id=eq.${q(String(tutorId))}&select=tutor_id,email,full_name,whatsapp10,mobile10,blocked_at`))?.[0];
    if (!tutor || (tutor.whatsapp10 !== me && tutor.mobile10 !== me)) {
      await sendText(from, "This button is not for your number.\n\nSend *Hi* any time for the menu.");
      return true;
    }
    if (answer === "n") {
      await sendText(from, `Thank you for letting us know. Please contact your agency regarding this class on ${await agencyPhone()}.`);
      return true;
    }
    const res = await rest("rpc/bot_mark_class", { method: "POST", body: JSON.stringify({ p_email: tutor.email, p_demo_id: demoId, p_date: date }) });
    if (!res?.success) {
      await sendText(from, `${String(res?.message ?? "Your answer could not be saved. Please try again from the website.")}\n\nSend *Hi* any time for the menu.`);
      return true;
    }
    await sendText(from, "Thank you. Your class has been recorded.\n\nSend *Hi* any time for the menu.");
    if (!res.already) await waClassDone(String(demoId), String(tutorId), String(date), res.minutes);
    return true;
  }

  if (parts[0] === "tl" && parts[1]) {
    const demoId = parts[1];
    const tuition = (await rest(`tuitions?demo_id=eq.${q(demoId)}&select=student_id`))?.[0];
    const mine = tuition ? (await accountsByPhone(from)).students.some((s: Json) => String(s.student_id) === String(tuition.student_id)) : false;
    if (!mine) {
      await sendText(from, "This button is not for your number.\n\nSend *Hi* any time for the menu.");
      return true;
    }
    for (const text of await allTutorsTexts(demoId)) await sendText(from, text);
    return true;
  }
  return false;
}
