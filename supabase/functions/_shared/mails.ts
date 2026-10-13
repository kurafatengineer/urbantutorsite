// The ten notification emails the site sends (everything else is silent):
//   1 tuition request posted        (student)
//   2 a tutor applied               (student)
//   3 demo scheduled                (student + tutor)
//   4 tutor accepted / rejected     (student)
//   5 parent accepted / rejected    (tutor)
//   6 tuition payment received      (student)
//   7 agency charge received        (student or tutor)
//   8 payment sent to a tutor       (tutor)
//   9 / 10 subscription payment     (student / tutor)
// Each builder returns { subject, html } in the shared Urban Tutor Site template,
// plus tg / cta: the same message for Telegram (see telegram.ts notify).

import { emailTemplate, detailRow } from "./email.ts";

export const SITE_URL = "https://kurafatengineer.github.io/urbantutorsite";

type Row = [string, string];
// tg: the same message for Telegram (HTML), cta: its button
export type Built = { subject: string; html: string; tg: string; cta: { label: string; page: string } };
type Tone = "green" | "red" | "blue" | "orange" | "purple";

const TG_ICON: Record<Tone, string> = { green: "✅", red: "❌", blue: "📝", orange: "🔔", purple: "📅" };
const tgText = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const make = (
  subject: string, heading: string, badge: { text: string; tone: Tone },
  name: string, intro: string, rows: Row[], cta: { label: string; page: string },
): Built => {
  const shown = rows.filter(([, v]) => v !== "" && v != null);
  return {
    subject,
    html: emailTemplate({
      heading, badge, greeting: `Hi ${name || "there"},`, intro,
      detailRowsHtml: shown.map(([l, v]) => detailRow(l, v)).join(""),
      cta: { label: cta.label, url: `${SITE_URL}/${cta.page}` },
    }),
    tg: `${TG_ICON[badge.tone]} <b>${tgText(heading)}</b>\n\n` +
      `Hi ${tgText(name || "there")},\n${tgText(intro)}\n\n` +
      shown.map(([l, v]) => `• ${tgText(l)}: <b>${tgText(v)}</b>`).join("\n"),
    cta,
  };
};

/* ---------- formatting ---------- */

export const inr = (n: unknown) => "₹" + Number(n || 0).toLocaleString("en-IN");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function fmtDate(iso?: string | null): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

export function fmtTime(hhmm?: string | null): string {
  const m = String(hhmm ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

// The Payment Date chosen by the admin, plus the time the payment was recorded (IST).
export function fmtPaidOn(paymentDate?: string | null, createdAt?: string | null): string {
  const day = fmtDate(paymentDate);
  const at = createdAt ? new Date(createdAt) : null;
  if (!day || !at || isNaN(at.getTime())) return day;
  const time = at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
  return `${day}, ${time.toUpperCase()}`;
}

const isAny = (v: unknown) => /^(any|both)$/i.test(String(v ?? "").trim());
export const modeText = (v: unknown) => isAny(v) ? "Online | Home" : String(v ?? "").replace(/^offline$/i, "Home");
export const genderPref = (v: unknown) => isAny(v) ? "Male | Female" : String(v ?? "");
const years = (n: unknown) => {
  const x = Number(n);
  return Number.isFinite(x) && String(n ?? "") !== "" ? `${x} ${x === 1 ? "Year" : "Years"}` : "";
};

const PAYMENT_TYPE: Record<string, string> = {
  advance: "Advance payment", regular: "Regular payment", final: "Final payment", agency: "Agency charge",
};

/* ---------- 1 · tuition request posted (student) ---------- */

export function tuitionPostedMail(d: {
  name: string; demos: { demoId: string; subject: string }[]; cls?: string; board?: string;
  medium?: string; preferredTutor?: string; city?: string; pin?: string;
}): Built {
  const rows: Row[] = d.demos.map((x) => [x.demoId, x.subject] as Row);
  rows.push(["Class", [d.cls, d.board].filter(Boolean).join(" · ")]);
  rows.push(["Mode", modeText(d.medium)]);
  rows.push(["Tutor preference", genderPref(d.preferredTutor)]);
  rows.push(["Location", [d.city, d.pin].filter(Boolean).join(" - ")]);
  return make(
    "Your tuition request is posted", "Tuition Request Posted", { text: "NEW REQUEST", tone: "blue" }, d.name,
    "Your tuition request is live. Verified tutors can now apply, and we'll let you know as soon as one does.",
    rows, { label: "View My Tuitions", page: "studentprofile.html" },
  );
}

/* ---------- 2 · a tutor applied (student) ---------- */

export function tutorAppliedMail(d: {
  name: string; demoId: string; subject: string; tutorName: string; tutorId: string; experience?: unknown; gender?: string;
}): Built {
  return make(
    "A tutor applied for your tuition", "A Tutor Applied", { text: "APPLIED BY TUTOR", tone: "orange" }, d.name,
    `${d.tutorName} has applied for your ${d.subject} tuition. Open your profile to review the tutor.`,
    [["Demo ID", d.demoId], ["Tutor", d.tutorName], ["Tutor ID", d.tutorId], ["Experience", years(d.experience)], ["Gender", d.gender ?? ""]],
    { label: "Review Tutor", page: "studentprofile.html" },
  );
}

/* ---------- 3 · demo scheduled (student + tutor) ---------- */

export function demoScheduledMail(d: {
  forTutor: boolean; name: string; otherName: string; demoId: string; subject: string; date: string; time: string; mode?: string;
}): Built {
  return make(
    "Your demo class is scheduled", "Demo Scheduled", { text: "DEMO SCHEDULED", tone: "purple" }, d.name,
    `A demo class has been scheduled for the ${d.subject} tuition. Please be ready a few minutes early.`,
    [["Demo ID", d.demoId], [d.forTutor ? "Student" : "Tutor", d.otherName], ["Date", fmtDate(d.date)], ["Time", fmtTime(d.time)], ["Mode", modeText(d.mode)]],
    { label: "Open My Profile", page: d.forTutor ? "tutorprofile.html" : "studentprofile.html" },
  );
}

/* ---------- 4 · tutor accepted / rejected (student) ---------- */

export function tutorResponseMail(d: {
  name: string; demoId: string; subject: string; tutorName: string; tutorId: string; accepted: boolean;
}): Built {
  return d.accepted
    ? make("Your tutor accepted the tuition", "Tutor Accepted Your Tuition", { text: "ACCEPTED BY TUTOR", tone: "green" }, d.name,
        `Good news! ${d.tutorName} has accepted your ${d.subject} tuition. Please confirm from your profile to get started.`,
        [["Demo ID", d.demoId], ["Tutor", d.tutorName], ["Tutor ID", d.tutorId]],
        { label: "Confirm in My Profile", page: "studentprofile.html" })
    : make("Your tutor declined the tuition", "Tutor Declined Your Tuition", { text: "REJECTED BY TUTOR", tone: "red" }, d.name,
        `${d.tutorName} is not able to take your ${d.subject} tuition. Your request is still open, so other tutors can apply.`,
        [["Demo ID", d.demoId], ["Tutor", d.tutorName]],
        { label: "View My Tuitions", page: "studentprofile.html" });
}

/* ---------- 5 · parent accepted / rejected (tutor) ---------- */

export function parentResponseMail(d: {
  name: string; demoId: string; subject: string; studentName: string; cls?: string; board?: string; city?: string; pin?: string; accepted: boolean;
}): Built {
  return d.accepted
    ? make("A parent accepted you", "Parent Accepted You", { text: "ACCEPTED BY PARENT", tone: "green" }, d.name,
        `${d.studentName}'s parent has accepted you for the ${d.subject} tuition. Please confirm from your profile.`,
        [["Demo ID", d.demoId], ["Student", d.studentName], ["Class", [d.cls, d.board].filter(Boolean).join(" · ")], ["Location", [d.city, d.pin].filter(Boolean).join(" - ")]],
        { label: "Open My Profile", page: "tutorprofile.html" })
    : make("A parent declined", "Parent Declined", { text: "REJECTED BY PARENT", tone: "red" }, d.name,
        `${d.studentName}'s parent has chosen not to go ahead with you for the ${d.subject} tuition. You can apply for other tuitions anytime.`,
        [["Demo ID", d.demoId], ["Subject", d.subject]],
        { label: "Search New Tuitions", page: "advertisement.html" });
}

/* both accepted (student + tutor) - the tuition is confirmed */
export function matchedMail(d: {
  forTutor: boolean; name: string; demoId: string; subject: string; otherName: string; otherId?: string;
}): Built {
  return make(
    "Your tuition is confirmed", "Tuition Confirmed", { text: "BOTH ACCEPTED", tone: "green" }, d.name,
    `You and ${d.otherName} have both accepted the ${d.subject} tuition. Our agency will contact you shortly - class and payment details will be shared with you.`,
    [["Demo ID", d.demoId], [d.forTutor ? "Student" : "Tutor", d.otherName], ["Tutor ID", d.forTutor ? "" : (d.otherId ?? "")]],
    { label: "Open My Profile", page: d.forTutor ? "tutorprofile.html" : "studentprofile.html" },
  );
}

/* ---------- 6 · tuition payment received (student) ---------- */

export function paymentReceivedMail(d: {
  name: string; subject: string; demoId: string; receipt: number; amount: number; type: string; mode: string;
  paymentDate: string; createdAt: string; totalPaid?: number; duesLeft?: number;
}): Built {
  return make(
    "Payment received", "Payment Received", { text: "PAID", tone: "green" }, d.name,
    `We have received your payment for the ${d.subject} tuition. Thank you!`,
    [["Receipt No.", `#P-${d.receipt}`], ["Demo ID", d.demoId], ["Amount", inr(d.amount)], ["Type", PAYMENT_TYPE[d.type] ?? d.type],
     ["Mode", d.mode], ["Paid on", fmtPaidOn(d.paymentDate, d.createdAt)],
     ["Total paid", d.totalPaid != null ? inr(d.totalPaid) : ""], ["Dues left", d.duesLeft != null ? inr(d.duesLeft) : ""]],
    { label: "View Payments", page: "studentprofile.html" },
  );
}

/* ---------- 7 · agency charge received (student or tutor) ---------- */

export function agencyChargeMail(d: {
  forTutor: boolean; name: string; subject: string; demoId: string; receipt: number; amount: number; mode: string;
  paymentDate: string; createdAt: string; remaining?: number;
}): Built {
  return make(
    "Agency charge received", "Agency Charge Received", { text: "PAID", tone: "green" }, d.name,
    `We have received the agency charge for the ${d.subject} tuition.`,
    [["Receipt No.", `#P-${d.receipt}`], ["Demo ID", d.demoId], ["Amount", inr(d.amount)], ["Mode", d.mode],
     ["Paid on", fmtPaidOn(d.paymentDate, d.createdAt)], ["Charge remaining", d.remaining != null ? inr(d.remaining) : ""]],
    { label: "View Payments", page: d.forTutor ? "tutorprofile.html" : "studentprofile.html" },
  );
}

/* ---------- 8 · payment sent to a tutor ---------- */

export function payoutMail(d: {
  name: string; subject: string; demoId: string; studentName: string; receipt: number; amount: number; mode: string;
  paymentDate: string; createdAt: string; totalReceived?: number; stillDue?: number;
}): Built {
  return make(
    "A payment was sent to you", "Payment Sent to You", { text: "PAYOUT", tone: "green" }, d.name,
    `We have sent you a payment for your ${d.subject} tuition.`,
    [["Receipt No.", `#P-${d.receipt}`], ["Demo ID", d.demoId], ["Student", d.studentName], ["Amount", inr(d.amount)], ["Mode", d.mode],
     ["Paid on", fmtPaidOn(d.paymentDate, d.createdAt)], ["Total received", d.totalReceived != null ? inr(d.totalReceived) : ""],
     ["Still due", d.stillDue != null ? inr(d.stillDue) : ""]],
    { label: "View Payments", page: "tutorprofile.html" },
  );
}

/* ---------- 9 / 10 · subscription (student / tutor) ---------- */

export function subscriptionMail(d: {
  forTutor: boolean; name: string; plan: string; amount: number; paid: number; startDate?: string | null; nextDue?: string | null;
}): Built {
  const settled = d.paid >= d.amount;
  return make(
    settled ? "Your subscription is active" : "Subscription payment received",
    settled ? "Subscription Activated" : "Subscription Payment Received",
    { text: settled ? "ACTIVE" : "PART PAID", tone: settled ? "green" : "orange" }, d.name,
    settled
      ? `Your Urban Tutor Site ${d.forTutor ? "tutor" : "student"} subscription is now active. A Verified badge now shows on your profile.`
      : `We have received a payment towards your Urban Tutor Site ${d.forTutor ? "tutor" : "student"} subscription.`,
    [["Plan", d.plan], ["Amount", inr(d.amount)], ["Paid", inr(d.paid)], ["Dues left", settled ? "" : inr(d.amount - d.paid)],
     ["Valid from", fmtDate(d.startDate)], ["Renews on", settled ? fmtDate(d.nextDue) : ""]],
    { label: "Open My Profile", page: d.forTutor ? "tutorprofile.html" : "studentprofile.html" },
  );
}

/* ---------- tuition agreement (parent / tutor) - sent when a class is finalised ---------- */
// The parent's copy never shows the agency's cut; the tutor's copy spells it out.

export function agreementMail(d: {
  forTutor: boolean; name: string; demoId: string; subject: string; studentName: string;
  tutorName: string; tutorId: string; mode?: string; startDate?: string; days?: string; time?: string;
  // numbers from dealNumbers() (deal.ts)
  m: Record<string, unknown>; parentFreq: string; tutorFreq: string;
}): Built {
  const m = d.m as Record<string, number & string>;
  const freq = (f: string) => f === "15 Days" ? "Every 15 Days" : (f || "Monthly");
  const common: Row[] = [
    ["Demo ID", d.demoId], ["Subject", d.subject], ["Student", d.studentName],
    ["Tutor", `${d.tutorName}${d.tutorId ? ` (${d.tutorId})` : ""}`], ["Mode", d.mode ? modeText(d.mode) : ""],
    ["Classes Start", d.startDate ? fmtDate(d.startDate) : ""], ["Class Days", d.days ?? ""],
    ["Class Time", d.time ? fmtTime(d.time) : ""], ["Duration", m.minutes ? `${m.minutes} minutes per class` : ""],
    ["Classes per Month", m.classes ? String(m.classes) : ""],
    ["Hours per Month", m.hours ? `${Math.round(Number(m.hours) * 100) / 100} hours` : ""],
  ];
  let rows: Row[];
  let intro: string;

  if (m.model === "margin") {
    rows = d.forTutor
      ? [...common,
         ["Parent Pays per Class", inr(m.parentPerClass)], ["Agency Share per Class", inr(m.margin)],
         ["You Receive per Class", inr(m.tutorPerClass)], ["You Receive per Hour", inr(m.tutorPerHour)],
         ["You Receive per Month", inr(m.tutorMonthly)],
         ["Paid to You by", "Urban Tutor Site (agency)"],
         ["Payment Schedule", `${freq(d.tutorFreq)} - ${inr(m.tutorInstallment)} each`]]
      : [...common,
         ["Fee per Class", inr(m.parentPerClass)], ["Fee per Hour", inr(m.parentPerHour)],
         ["Fee per Month", inr(m.parentMonthly)], ["Pay to", "Urban Tutor Site (agency)"],
         ["Payment Schedule", `${freq(d.parentFreq)} - ${inr(m.parentInstallment)} each`]];
    intro = d.forTutor
      ? "Your class is confirmed. These are the agreed class details and your earnings. The agency collects the fee from the parent and pays you as per the schedule below. You are paid only for classes actually taken."
      : "Your class is confirmed. These are the agreed class details and fees. Fees are paid to the agency as per the schedule below. If the tutor leaves, any fee paid for classes not taken is refunded to you.";
  } else {
    const viaAgency = m.feeTo === "Agency";
    rows = d.forTutor
      ? [...common,
         ["Monthly Fee", inr(m.monthlyFee)], ["Fee per Class", inr(m.perClass)], ["Fee per Hour", inr(m.perHour)],
         ["Agency Commission", `${inr(m.cut)}${m.cutPercent ? ` (${m.cutPercent}% of the first month's fee)` : ""} - one time only`],
         ...(viaAgency
           ? [["First Month's Fee Paid to", "Agency"], ["You Receive (First Month)", `${inr(m.tutorFirstMonth)} - ${freq(d.tutorFreq)}, ${inr(m.tutorInstallment)} each`],
              ["From the Second Month", "The parent pays you directly"]] as Row[]
           : [["Fee Paid to", "You, directly by the parent"],
              ["Commission Payment", `${freq(d.tutorFreq)} - ${inr(m.cutInstallment)} each, to the agency`]] as Row[])]
      : [...common,
         ["Monthly Fee", inr(m.monthlyFee)], ["Fee per Class", inr(m.perClass)], ["Fee per Hour", inr(m.perHour)],
         ["Pay to", viaAgency ? "Urban Tutor Site (agency) for the first month, then the tutor directly" : "The tutor directly"],
         ["Payment Schedule", `${freq(d.parentFreq)} - ${inr(m.parentInstallment)} each`]];
    intro = d.forTutor
      ? "Your class is confirmed. These are the agreed class details. The agency's commission is taken once, from the first month's fee only. If fewer classes take place than agreed, the extra commission is kept as a balance in your account and adjusted against your next tuition."
      : "Your class is confirmed. These are the agreed class details and fees. If the tutor leaves, any fee paid for classes not taken is refunded to you.";
  }

  return make(
    `Tuition Agreement - ${d.subject} (${d.demoId})`, "Tuition Agreement", { text: "CONFIRMED", tone: "green" }, d.name,
    intro, rows, { label: "Open My Profile", page: d.forTutor ? "tutorprofile.html" : "studentprofile.html" },
  );
}
