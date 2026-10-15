// The details the bots show for one tuition: a running class (days, time, fee) and a scheduled demo.
// Texts use WhatsApp's *bold*; the Telegram bot turns *...* into bold too.
import { inList, rest, type Life } from "./botdata.ts";
import { dealNumbers } from "./deal.ts";
import { contactLine, fmtDate, fmtTime, inr } from "./mails.ts";

type Json = Record<string, any>;

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const modeText = (m: string) => /^online$/i.test(m) ? "Online" : /^(home|offline)$/i.test(m) ? "Home" : "Home or Online";
const freqText = (f: unknown) => f === "15 Days" ? "Every 15 days" : f === "Weekly" ? "Every week" : "Every month";

// The tutors (role "s") or students (role "t") behind these tuitions: name + phone.
export async function people(role: string, lives: Life[]): Promise<Map<string, Json>> {
  const out = new Map<string, Json>();
  if (role === "s") {
    const ids = [...new Set(lives.flatMap((l) => [l.app?.tutor_id, ...l.apps.map((a) => a.tutor_id)]).map((x) => String(x ?? "")).filter(Boolean))];
    if (!ids.length) return out;
    for (const t of await rest(`tutors?tutor_id=${inList(ids)}&select=tutor_id,full_name,gender,mobile_number,whatsapp_number`) ?? []) {
      out.set(String(t.tutor_id), { name: t.full_name, phone: t.mobile_number || t.whatsapp_number, gender: t.gender });
    }
  } else {
    const ids = [...new Set(lives.map((l) => String(l.student?.student_id ?? "")).filter(Boolean))];
    if (!ids.length) return out;
    for (const s of await rest(`students?student_id=${inList(ids)}&select=student_id,student_name,phone,whatsapp`) ?? []) {
      out.set(String(s.student_id), { name: s.student_name, phone: s.phone || s.whatsapp });
    }
  }
  return out;
}

const other = (role: string, l: Life, who: Map<string, Json>) =>
  (role === "s" ? who.get(String(l.app?.tutor_id)) : who.get(String(l.student?.student_id))) ?? {};

// One running class, with what the parent pays (role "s") or what the tutor receives (role "t").
export function runningDetail(role: string, l: Life, who: Map<string, Json>): string {
  const a = l.app ?? {};
  const deal = a.billing_plan?.deal ?? {};
  const dates: string[] = (a.class_dates ?? []).map(String).sort();
  const days = [...new Set(dates.map((d) => new Date(d + "T00:00:00Z").getUTCDay()))]
    .sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map((w) => DAY[w]).join(", ");
  const minutes = Number(deal.minutes ?? a.class_duration ?? 0);
  const p = other(role, l, who);

  const lines = [
    `*${l.subject}* (${l.demo})`,
    "",
    `${role === "s" ? "Tutor" : "Student"}: *${p.name ?? "-"}*`,
    `Mode: ${modeText(l.mode)}`,
  ];
  if (days) lines.push(`Class days: ${days}`);
  if (deal.time) lines.push(`Class time: ${fmtTime(deal.time)}`);
  if (minutes > 0) lines.push(`Duration: ${minutes} minutes`);
  if (dates.length) lines.push(`Classes per month: ${dates.length}`);
  if (a.class_start_date || dates[0]) lines.push(`Started on: ${fmtDate(a.class_start_date || dates[0])}`);

  lines.push("", "*Fee*");
  const ready = deal.finalizedAt && (deal.model === "margin" || deal.model === "commission") && dates.length;
  if (!ready) {
    lines.push("The fee details will be shared by the agency soon.");
  } else {
    const m = dealNumbers(deal, dates.length) as Json;
    if (m.model === "margin") {
      if (role === "s") {
        lines.push(`Fee per class: *${inr(m.parentPerClass)}*`, `Fee per month: *${inr(m.parentMonthly)}*`,
          "Pay to: Urban Tutor Site (agency)", `Payment: ${freqText(deal.parentFreq)} - *${inr(m.parentInstallment)}*`);
      } else {
        lines.push(`You receive per class: *${inr(m.tutorPerClass)}*`, `You receive per month: *${inr(m.tutorMonthly)}*`,
          "Paid by: Urban Tutor Site (agency)", `Payment: ${freqText(deal.tutorFreq)} - *${inr(m.tutorInstallment)}*`);
      }
    } else {
      const viaAgency = m.feeTo === "Agency";
      if (role === "s") {
        lines.push(`Monthly fee: *${inr(m.monthlyFee)}*`, `Fee per class: ${inr(m.perClass)}`,
          `Pay to: ${viaAgency ? "Urban Tutor Site (agency) for the first month, then the tutor directly" : "The tutor directly"}`,
          `Payment: ${freqText(deal.parentFreq)} - *${inr(m.parentInstallment)}*`);
      } else {
        lines.push(`Monthly fee: *${inr(m.monthlyFee)}*`, `Agency commission: ${inr(m.cut)} (first month only)`,
          viaAgency
            ? `First month: the agency pays you *${inr(m.tutorFirstMonth)}* (${freqText(deal.tutorFreq)} - ${inr(m.tutorInstallment)})`
            : `Fee paid to you by the parent; commission to the agency: ${freqText(deal.tutorFreq)} - ${inr(m.cutInstallment)}`);
      }
    }
  }
  lines.push("", contactLine(role === "t", p.phone));
  return lines.join("\n");
}

// One scheduled demo: when, and with whom.
export function demoDetail(role: string, l: Life, who: Map<string, Json>): string {
  const a = l.app ?? {};
  const p = other(role, l, who);
  const when = a.demo_date ? `${fmtDate(a.demo_date)}${a.demo_time ? ", " + fmtTime(a.demo_time) : ""}` : "-";
  return [
    `*${l.subject}* (${l.demo})`,
    `${role === "s" ? "Tutor" : "Student"}: *${p.name ?? "-"}*`,
    `Demo: *${when}*`,
    `Mode: ${modeText(l.mode)}`,
  ].join("\n");
}

// The tutors who applied for a tuition that is still finding a tutor.
export function findingDetail(l: Life, tutors: Map<string, Json>): string {
  const names = l.apps.map((a: Json) => {
    const t = tutors.get(String(a.tutor_id)) ?? {};
    return `- ${t.name ?? a.tutor_id}${t.gender ? ` (${t.gender})` : ""}`;
  });
  return `*${l.subject}* (${l.demo})\n` + (names.length ? `Tutors applied:\n${names.join("\n")}` : "No tutor has applied yet.");
}
