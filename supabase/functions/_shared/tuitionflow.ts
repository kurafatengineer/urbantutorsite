// "Post a new tuition request" chat flow, shared by the Telegram and WhatsApp bots.
// Same request the website's "Apply For New Tuition" form makes: one tuition (Demo ID) per subject,
// with the preferred tutor, the mode and the preferred timing.
// The caller decides which students the chat may post for (WhatsApp: the sender's number; Telegram: the linked chat),
// and that list is kept in the session, so a tapped button can never post for someone else's student.
import { q, inList, rest } from "./botdata.ts";
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

const splitSubjects = (v: string) =>
  [...new Map(v.split(",").map((x) => titleCase(x)).filter((x) => x.length >= 2).map((x) => [x.toLowerCase(), x])).values()];

function prompt(step: string, d: Json): Out {
  switch (step) {
    case "t_pick": return {
      text: "*Post a New Tuition*\nYou can type *Cancel* any time.\n\nWhich *student* is this tuition for?",
      choices: [...d.allowed.slice(0, 9).map((s: Json) => ({ id: `t_pick:${s.id}`, title: s.name || s.id, description: s.id })), CANCEL],
    };
    case "t_subjects": return {
      text: `*Post a New Tuition*\nStudent: *${d.studentName}*\nStudent ID: *${d.studentId}*\n\nYou can type *Cancel* any time.\n\n` +
        "Which *subjects* do you need a tutor for?\nFor more than one subject, separate them with commas.\n\nFor example -\nMaths, Science",
    };
    case "t_timing": return { text: "Your *preferred time* for the class?\n\nFor example -\n5 PM\n6 PM - 8 PM" };
    case "t_tutor": return {
      text: "Which *tutor* do you prefer?",
      choices: [{ id: "t_tutor:any", title: "Any" }, { id: "t_tutor:male", title: "Male" }, { id: "t_tutor:female", title: "Female" }],
    };
    case "t_mode": return {
      text: "Which *mode* do you want?",
      choices: [{ id: "t_mode:any", title: "Any" }, { id: "t_mode:home", title: "Home" }, { id: "t_mode:online", title: "Online" }],
    };
    case "t_confirm": return {
      text: "*Please check your tuition request:*\n\n" +
        `Student: *${d.studentName}* (${d.studentId})\nSubjects: *${d.subjects.join(", ")}*\n` +
        `Time: ${d.timing}\nTutor: ${tutorText(d.tutor)}\nMode: ${modeText(d.medium)}`,
      choices: [{ id: "t_post", title: "Post Request" }, CANCEL],
    };
    default: return { text: "" };
  }
}

async function goTo(ctx: Ctx, step: string, d: Json): Promise<Out[]> {
  await save(ctx, step, d);
  return [prompt(step, d)];
}

// students: the ones this chat may post for ({ student_id, student_name, blocked_at? })
// adminId: an employee posts the tuition for the parent (the admin function does the posting and tells the parent).
export async function startTuition(ctx: Ctx, students: Json[], opts: { adminId?: string } = {}): Promise<Out[]> {
  const allowed = students.filter((s) => !s.blocked_at).map((s) => ({ id: String(s.student_id), name: String(s.student_name ?? "") }));
  if (!allowed.length) {
    await clear(ctx);
    return [{ text: "Your account is blocked.\nPlease contact Urban Tutor Site.\n\nSend *Hi* any time for the menu." }];
  }
  const d: Json = { allowed };
  if (opts.adminId) d.adminId = opts.adminId;
  if (allowed.length === 1) {
    d.studentId = allowed[0].id;
    d.studentName = allowed[0].name;
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
    return [{ text: "Cancelled.\nSend *Hi* any time for the menu." }];
  }
  const again = (msg: string): Out[] => [{ text: msg }, prompt(s.step, d)];

  switch (s.step) {
    case "t_pick": {
      const pick = d.allowed.find((x: Json) => key === "t_pick" && x.id === value);
      if (!pick) return again("Please tap a *student* from the list.");
      d.studentId = pick.id;
      d.studentName = pick.name;
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
      if (key !== "t_tutor" || !TUTOR[value]) return again("Please tap *Any*, *Male* or *Female*.");
      d.tutor = TUTOR[value];
      return goTo(ctx, "t_mode", d);
    case "t_mode":
      if (key !== "t_mode" || !MODE[value]) return again("Please tap *Any*, *Home* or *Online*.");
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
      const list = res.demos!.map((x) => `Tuition: *${x.subject}* (${x.demoId})\nTutor - ${d.tutor}`).join("\n\n");
      return [{
        text: `*Tuition request posted!*\nStudent: *${d.studentName}* (${d.studentId})\n\n${list}\n\n` +
          (d.adminId ? "The parent has been told.\nUse *Assign Tutor* in the Menu to add a tutor." : "We will let you know as soon as a tutor applies."),
      }];
    }
  }
  return [];
}

