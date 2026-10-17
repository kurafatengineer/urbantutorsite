// "Apply for New Tuition" chat flow for tutors, shared by the Telegram and WhatsApp bots.
// The tutor types a Tuition ID (DID + 8 digits); bot_apply_for_tuition applies with the website's rules
// and also refuses a tutor whose gender does not match the tuition's preferred tutor.
// The caller passes the tutor accounts this chat belongs to, and the email used to apply is kept in the session.
import { inList, q, rest } from "./botdata.ts";
import { tutorAppliedMail } from "./mails.ts";
import { notify, studentQuiet } from "./telegram.ts";
import { waTutorApplied } from "./wasend.ts";
import { type Ctx, type Input, type Out, clean, clear, save } from "./session.ts";

type Json = Record<string, any>;

const ID_RE = /^DID\d{8}$/;
const ASK =
  "*Apply for New Tuition*\n\n" +
  "Enter the *Tuition ID* you want to apply for.\n" +
  "It starts with *DID* followed by *8 digits*.\n\n" +
  "For example -\nDID20260007\n\n" +
  "You can type *Cancel* any time.";
const AGAIN = "Type another *Tuition ID*, or *Cancel*.";

const modeText = (m: unknown) =>
  /^online$/i.test(String(m)) ? "Online" : /^(home|offline)$/i.test(String(m)) ? "Home" : "Home or Online";

export async function startApply(ctx: Ctx, tutors: Json[]): Promise<Out[]> {
  const ids = tutors.filter((t) => !t.blocked_at).map((t) => String(t.tutor_id));
  const me = ids.length ? (await rest(`tutors?tutor_id=${inList(ids)}&select=tutor_id,email&order=tutor_id&limit=1`))?.[0] : null;
  if (!me?.email) {
    await clear(ctx);
    return [{ text: "Your account is blocked.\nPlease contact Urban Tutor Site.\n\nSend *Hi* any time for the menu." }];
  }
  await save(ctx, "a_id", { tutorId: String(me.tutor_id), email: String(me.email) });
  return [{ text: ASK }];
}

async function tellParent(demoId: string, tutorId: string) {
  await waTutorApplied(demoId, tutorId);
  try {
    const tuition = (await rest(`tuitions?demo_id=eq.${q(demoId)}&select=subject,student_id`))?.[0];
    const student = tuition?.student_id
      ? (await rest(`students?student_id=eq.${q(tuition.student_id)}&select=student_id,student_name,email`))?.[0]
      : null;
    const tutor = (await rest(`tutors?tutor_id=eq.${q(tutorId)}&select=tutor_id,full_name,experience_years,gender`))?.[0];
    if (!student?.email || !tutor || await studentQuiet(String(student.student_id))) return;
    await notify(student.email, tutorAppliedMail({
      name: student.student_name, demoId, subject: tuition.subject ?? "", tutorName: tutor.full_name,
      tutorId: tutor.tutor_id, experience: tutor.experience_years, gender: tutor.gender,
    }));
  } catch (err) {
    console.error("bot apply notify failed", String(err));
  }
}

export async function applyInput(ctx: Ctx, s: Json, input: Input): Promise<Out[]> {
  const d = s.data;
  const text = clean(input.text);
  if (input.choice === "cancel" || /^cancel$/i.test(text)) {
    await clear(ctx);
    return [{ text: "Cancelled.\nSend *Hi* any time for the menu." }];
  }

  const demoId = text.replace(/\s/g, "").toUpperCase();
  if (!ID_RE.test(demoId)) {
    return [{ text: "That is not a valid *Tuition ID*.\nIt starts with *DID* followed by *8 digits*, for example *DID20260007*.\n\n" + AGAIN }];
  }

  const res = await rest("rpc/bot_apply_for_tuition", { method: "POST", body: JSON.stringify({ p_email: d.email, p_demo_id: demoId }) });
  if (!res?.success) {
    const why = res?.genderMismatch
      ? `*${demoId}* is only for *${String(res.needed).toLowerCase()}* tutors, so you cannot apply for it.`
      : res?.notFound
        ? `No tuition was found with the ID *${demoId}*.\nPlease check the ID.`
        : res?.notVerified
          ? "Your profile is being verified.\nYou can apply once it is verified."
          : `${String(res?.message ?? "Your application could not be saved.").replace(/^.*?:\s*/, "")}`;
    if (res?.notVerified) { await clear(ctx); return [{ text: why + "\n\nSend *Hi* any time for the menu." }]; }
    return [{ text: why + "\n\n" + AGAIN }];
  }
  if (res.alreadyApplied) {
    return [{ text: `You have *already applied* for *${demoId}*.\n\n` + AGAIN }];
  }

  await clear(ctx);
  const t = (await rest(`tuitions?demo_id=eq.${q(demoId)}&select=subject,medium,student_id`))?.[0] ?? {};
  const st = t.student_id ? (await rest(`students?student_id=eq.${q(t.student_id)}&select=class_name,board,city,pin_code`))?.[0] ?? {} : {};
  await tellParent(demoId, String(d.tutorId));
  const cls = [st.class_name, st.board].filter(Boolean).join(" · ");
  const area = [st.city, st.pin_code].filter(Boolean).join(" - ");
  return [{
    text: `*Applied successfully!*\n\n*${t.subject ?? "Tuition"}* (${demoId})\n` +
      (cls ? `Class: ${cls}\n` : "") + `Mode: ${modeText(t.medium)}\n` + (area ? `Area: ${area}\n` : "") +
      "\nThe parent has been told. We will contact you soon.\n\nSend *Hi* any time for the menu.",
  }];
}
