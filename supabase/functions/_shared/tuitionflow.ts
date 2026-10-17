// "Post a new tuition request" chat flow, shared by the Telegram and WhatsApp bots.
// Same request the website's "Apply For New Tuition" form makes: one tuition (Demo ID) per subject,
// with the preferred tutor, the mode and the preferred timing.
// The caller decides which students the chat may post for (WhatsApp: the sender's number; Telegram: the linked chat),
// and that list is kept in the session, so a tapped button can never post for someone else's student.
import { q, inList, last10, rest } from "./botdata.ts";
import { adminCall } from "./adminbridge.ts";
import { tuitionPostedMail } from "./mails.ts";
import { notify, studentQuiet } from "./telegram.ts";
import { type Choice, type Ctx, type Input, type Out, clean, clear, save, titleCase } from "./session.ts";

type Json = Record<string, any>;

const CANCEL: Choice = { id: "cancel", title: "Cancel" };

const TUTOR = { male: "Male", female: "Female", any: "Any" } as Record<string, string>;
const MODE = { home: "Home", online: "Online", any: "Any" } as Record<string, string>;
const modeText = (m: string) => m === "Any" ? "Home or Online" : m;
const tutorText = (t: string) => t === "Any" ? "Male or Female" : t;
// "Any" is never shown: Male first, then Female, then both; the same for the mode.
const TUTOR_CHOICES: Choice[] = [{ id: "t_tutor:male", title: "Male" }, { id: "t_tutor:female", title: "Female" }, { id: "t_tutor:any", title: "Male or Female" }];
const MODE_CHOICES: Choice[] = [{ id: "t_mode:home", title: "Home Tutor" }, { id: "t_mode:online", title: "Online Tutor" }, { id: "t_mode:any", title: "Home or Online Tutor" }];

// A number as shown to an employee: in full, or only the last two digits when their account hides numbers.
const numText = (v: unknown, hide: boolean): string => {
  const x = last10(v);
  if (x.length < 10) return "";
  return hide ? "*".repeat(8) + x.slice(-2) : `+91 ${x.slice(0, 5)} ${x.slice(5)}`;
};
// name, ID, WhatsApp and phone of the student (for an employee posting on a parent's behalf)
function studentDetails(d: Json): string {
  const wa = numText(d.studentWa, !!d.hide), ph = numText(d.studentPhone, !!d.hide);
  return `*Student Details:*\n\nName: *${d.studentName}*\nStudent ID: ${d.studentId}` + (wa ? `\nWhatsApp: ${wa}` : "") + (ph ? `\nMobile No.: ${ph}` : "") + (d.studentAddr && !d.hide ? `\nAddress: ${d.studentAddr}` : "");
}

const splitSubjects = (v: string) =>
  [...new Map(v.split(",").map((x) => titleCase(x)).filter((x) => x.length >= 2).map((x) => [x.toLowerCase(), x])).values()];

function prompt(step: string, d: Json): Out {
  switch (step) {
    case "t_pick": return {
      text: d.adminId ? "*Post New Tuition*\n\nWhich *student* is this tuition for?" : "*Post a New Tuition*\nYou can type *Cancel* any time.\n\nWhich *student* is this tuition for?",
      choices: [...d.allowed.slice(0, 9).map((s: Json) => ({ id: `t_pick:${s.id}`, title: s.name || s.id, description: s.id })), CANCEL],
    };
    case "t_subjects": {
      const list = (title: string, xs: string[] = []) => xs.length ? `${title}\n${xs.map((x) => `- ${x}`).join("\n")}\n\n` : "";
      const finding = list("You have a tutor running for these subjects (a new request cannot be posted for them):", d.running)
        + list("You are currently finding a tutor for:", d.finding);
      const ask = "Which *subjects* do you need a tutor for?\nFor more than one subject, separate them with commas.\n\nFor example -\nMaths, Science";
      return d.adminId
        ? { text: `*Post New Tuition*\n\n${studentDetails(d)}\n\n${finding}${ask}`, choices: [CANCEL] }
        : { text: `*Post a New Tuition*\nStudent: *${d.studentName}*\nStudent ID: *${d.studentId}*\n\nYou can type *Cancel* any time.\n\n${finding}${ask}` };
    }
    case "t_timing": return {
      text: "Your *preferred time* for the class?\n\nFor example -\n5 PM\n6 PM - 8 PM",
      ...(d.adminId ? { choices: [CANCEL] } : {}),
    };
    case "t_tutor": return {
      text: "Which *tutor* do you prefer?",
      choices: TUTOR_CHOICES,
    };
    case "t_mode": return {
      text: "Which *mode* do you want?",
      choices: MODE_CHOICES,
    };
    case "t_confirm": return {
      text: "*Please check your tuition request:*\n\n" +
        (d.adminId ? `${studentDetails(d)}\n\n*New Tuition Details:*\n\n` : `Student: *${d.studentName}* (${d.studentId})\n`) +
        `Subjects: *${d.subjects.join(", ")}*\n` +
        `Time: ${d.timing}\nTutor: ${tutorText(d.tutor)}\nMode: ${modeText(d.medium)}`,
      choices: [{ id: "t_post", title: "Post Request" }, CANCEL],
    };
    default: return { text: "" };
  }
}

// Subjects this student is still finding a tutor for, and those already running (shown above the subject question).
async function findingFor(studentId: string): Promise<{ finding: string[]; running: string[] }> {
  try {
    const rows = await rest(`tuitions?student_id=eq.${q(studentId)}&terminated=eq.false&select=demo_id,subject&order=posted_at.desc`) ?? [];
    const finding: string[] = [], running: string[] = [];
    for (const r of rows) {
      const status = String(await rest("rpc/tuition_status", { method: "POST", body: JSON.stringify({ p_demo_id: r.demo_id }) }));
      if (status === "Finding Tutor") finding.push(`*${r.subject}* (${r.demo_id})`);
      else if (!["Completed", "Terminated"].includes(status)) running.push(`*${r.subject}* (${r.demo_id})`);
    }
    return { finding, running };
  } catch {
    return { finding: [], running: [] };
  }
}

// Full address with PIN code (shown in the student details for an employee).
async function addressOf(studentId: string): Promise<string> {
  const st = (await rest(`students?student_id=eq.${q(studentId)}&select=address,city,pin_code`))?.[0];
  if (!st) return "";
  const place = [st.city, st.pin_code].filter(Boolean).join(" - ");
  return [st.address, place].filter(Boolean).join(", ");
}

async function goTo(ctx: Ctx, step: string, d: Json): Promise<Out[]> {
  if (step === "t_subjects") {
    Object.assign(d, await findingFor(String(d.studentId)));
    if (d.adminId) d.studentAddr = await addressOf(String(d.studentId));
  }
  await save(ctx, step, d);
  return [prompt(step, d)];
}

function chooseStudent(d: Json, a: Json) {
  d.studentId = a.id;
  d.studentName = a.name;
  d.studentWa = a.whatsapp ?? "";
  d.studentPhone = a.phone ?? "";
}

// students: the ones this chat may post for ({ student_id, student_name, blocked_at? })
// adminId: an employee posts the tuition for the parent (the admin function does the posting and tells the parent).
export async function startTuition(ctx: Ctx, students: Json[], opts: { adminId?: string; hide?: boolean; perms?: string[] } = {}): Promise<Out[]> {
  const allowed = students.filter((s) => !s.blocked_at).map((s) => ({ id: String(s.student_id), name: String(s.student_name ?? ""), whatsapp: s.whatsapp ?? "", phone: s.phone ?? "" }));
  if (!allowed.length) {
    await clear(ctx);
    return [{ text: "Your account is blocked.\nPlease contact Urban Tutor Site.\n\nSend *Hi* any time for the menu." }];
  }
  const d: Json = { allowed };
  if (opts.adminId) d.adminId = opts.adminId;
  if (opts.hide) d.hide = true;
  if (opts.perms) d.perms = opts.perms;
  if (allowed.length === 1) {
    chooseStudent(d, allowed[0]);
    return goTo(ctx, "t_subjects", d);
  }
  return goTo(ctx, "t_pick", d);
}

// Subjects that already have a request still in progress for this student (the website refuses those too).
async function runningSubjects(studentId: string, subjects: string[]): Promise<string[]> {
  const rows = await rest(`tuitions?student_id=eq.${q(studentId)}&terminated=eq.false&select=demo_id,subject`) ?? [];
  const same = rows.filter((r: Json) => subjects.some((s) => s.toLowerCase() === String(r.subject ?? "").toLowerCase()));
  const out: string[] = [];
  for (const r of same) {
    const status = await rest("rpc/tuition_status", { method: "POST", body: JSON.stringify({ p_demo_id: r.demo_id }) });
    if (!["Completed", "Terminated"].includes(String(status))) out.push(titleCase(String(r.subject)));
  }
  return [...new Set(out)];
}

// An employee posting for a parent: same rules as the Admin Panel's "Apply for new tuition for students".
async function postAsAdmin(d: Json): Promise<{ ok: boolean; demos?: { demoId: string; subject: string }[]; message?: string }> {
  const res = await adminCall(String(d.adminId), "adminAddTuition", { p: {
    studentId: d.studentId, subjects: d.subjects.join(","), preferredTutor: d.tutor, medium: d.medium, preferredTiming: d.timing,
  } });
  if (!res?.success) return { ok: false, message: String(res?.message ?? "The tuition could not be posted. Please try again.") };
  const ids: string[] = (res.demoIds ?? []).map(String);
  const rows = ids.length ? await rest(`tuitions?demo_id=${inList(ids)}&select=demo_id,subject`) ?? [] : [];
  const demos = ids.map((id) => ({ demoId: id, subject: String(rows.find((r: Json) => r.demo_id === id)?.subject ?? "") }));
  return { ok: true, demos };
}

async function post(d: Json): Promise<{ ok: boolean; demos?: { demoId: string; subject: string }[]; message?: string }> {
  const student = (await rest(`students?student_id=eq.${q(d.studentId)}&select=student_id,blocked_at`))?.[0];
  if (!student) return { ok: false, message: "That student was not found." };
  if (student.blocked_at) return { ok: false, message: "Your account is blocked. Please contact Urban Tutor Site." };
  const repeated = await runningSubjects(d.studentId, d.subjects);
  if (repeated.length) return { ok: false, message: `You already have a running request for ${repeated.join(", ")}.` };

  const demos: { demoId: string; subject: string }[] = [];
  for (const subject of d.subjects) {
    const demoId = await rest("rpc/generate_demo_id", { method: "POST", body: JSON.stringify({ p_student_id: d.studentId }) });
    if (!demoId) break;
    const saved = await rest("tuitions", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ demo_id: demoId, student_id: d.studentId, subject, preferred_tutor: d.tutor, medium: d.medium, preferred_timing: d.timing }),
    });
    if (!saved?.length) break;
    demos.push({ demoId: String(demoId), subject });
  }
  if (!demos.length) return { ok: false, message: "The tuition could not be posted. Please try again." };
  return { ok: true, demos };
}

// Same "Tuition Request Posted" email / Telegram message the website sends.
async function tellPosted(studentId: string, demos: { demoId: string; subject: string }[], d: Json) {
  try {
    if (await studentQuiet(studentId)) return;
    const st = (await rest(`students?student_id=eq.${q(studentId)}&select=student_name,email,class_name,board,city,pin_code`))?.[0];
    if (!st?.email) return;
    await notify(st.email, tuitionPostedMail({
      name: st.student_name, demos, cls: st.class_name, board: st.board,
      medium: d.medium, preferredTutor: d.tutor, city: st.city, pin: st.pin_code,
    }));
  } catch (err) {
    console.error("tuition posted notify failed", String(err));
  }
}

export async function tuitionInput(ctx: Ctx, s: { step: string; data: Json }, input: Input): Promise<Out[]> {
  const d = s.data;
  const text = clean(input.text);
  const choice = input.choice ?? "";
  const [key, value] = choice.split(":");
  if (choice === "cancel" || /^cancel$/i.test(text)) {
    await clear(ctx);
    return d.adminId ? [{ text: "", menu: "a" }] : [{ text: "Cancelled.\nSend *Hi* any time for the menu." }];
  }
  const again = (msg: string): Out[] => [{ text: msg }, prompt(s.step, d)];

  switch (s.step) {
    case "t_pick": {
      const pick = d.allowed.find((x: Json) => key === "t_pick" && x.id === value);
      if (!pick) return again("Please tap a *student* from the list.");
      chooseStudent(d, pick);
      return goTo(ctx, "t_subjects", d);
    }
    case "t_subjects": {
      const subjects = splitSubjects(text);
      if (!subjects.length || text.length > 250) return again("Please type at least one subject.");
      if (subjects.length > 10) return again("Please type at most 10 subjects at a time.");
      const repeated = await runningSubjects(d.studentId, subjects);
      if (repeated.length) {
        return [{ text: `You already have a running request for *${repeated.join(", ")}*.\nPlease type the other subjects.` }];
      }
      d.subjects = subjects;
      return goTo(ctx, "t_timing", d);
    }
    case "t_timing":
      if (text.length < 2 || text.length > 120) return again("Please type your preferred time.");
      d.timing = text;
      return goTo(ctx, "t_tutor", d);
    case "t_tutor":
      if (key !== "t_tutor" || !TUTOR[value]) return again("Please tap *Male*, *Female* or *Male or Female*.");
      d.tutor = TUTOR[value];
      return goTo(ctx, "t_mode", d);
    case "t_mode":
      if (key !== "t_mode" || !MODE[value]) return again("Please tap *Home Tutor*, *Online Tutor* or *Home or Online Tutor*.");
      d.medium = MODE[value];
      return goTo(ctx, "t_confirm", d);
    case "t_confirm": {
      if (choice !== "t_post") return [prompt("t_confirm", d)];
      if (!d.allowed?.some((x: Json) => x.id === d.studentId) || !d.subjects?.length) {
        await clear(ctx);
        return [{ text: "Something went wrong.\nPlease send *Hi* and try again." }];
      }
      const res = d.adminId ? await postAsAdmin(d) : await post(d);
      await clear(ctx);
      if (!res.ok) return [{ text: `${res.message}\n\nSend *Hi* any time for the menu.` }];
      if (!d.adminId) await tellPosted(d.studentId, res.demos!, d);
      if (d.adminId) {
        const items = res.demos!.map((x) => `Subject: *${x.subject}*\nTuition ID: ${x.demoId}\nTutor: ${tutorText(d.tutor)}\nMode: ${modeText(d.medium)}`).join("\n\n");
        const text = `*Tuition Request Posted!*\n\n${studentDetails(d)}\n\n*Tuition Details:*\n\n${items}\n\nThe parents have been told.`;
        // an employee who may assign tutors gets a button to go straight on to Assign Tutor
        if (!(d.perms ?? []).includes("tuitions_assign_tutor")) return [{ text }];
        await save(ctx, "ad_after", { eid: d.adminId, hide: !!d.hide, perms: d.perms });
        const many = res.demos!.length > 1;
        return [{
          text,
          choices: res.demos!.map((x) => ({ id: `af_assign:${x.demoId}`, title: many ? `Assign ${x.subject}`.slice(0, 24) : "Assign Tutor" })),
        }];
      }
      const list = res.demos!.map((x) => `Tuition: *${x.subject}* (${x.demoId})\nTutor - ${tutorText(d.tutor)}`).join("\n\n");
      return [{
        text: `*Tuition request posted!*\nStudent: *${d.studentName}* (${d.studentId})\n\n${list}\n\nWe will let you know as soon as a tutor applies.`,
      }];
    }
  }
  return [];
}

