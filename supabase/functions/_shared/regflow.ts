// "Register as a student" chat flow, shared by the Telegram and WhatsApp bots.
// The channel adapters pass in what the user typed / tapped / shared and send back the replies.
// Email is always verified with a 6-digit code mailed to it; the mobile number is already verified by the
// channel itself (WhatsApp: the sender's number; Telegram: the contact the user shares).
import { emailTemplate, sendMail } from "./email.ts";
import { AGENCY_PHONE, SITE_URL } from "./constants.ts";
import { last10, q, rest, studentEmailTaken as studentWithEmail, studentPhoneTaken as studentWithPhone } from "./botdata.ts";

type Json = Record<string, any>;

export type Choice = { id: string; title: string };
// link: one button that opens a page of the site (WhatsApp "cta_url" button, Telegram web-app button).
export type Out = { text: string; choices?: Choice[]; askPhone?: boolean; link?: { label: string; url: string } };
export type Input = { text?: string; choice?: string; contactPhone?: string };
export type Ctx = { channel: "wa" | "tg"; key: string; verifiedPhone?: string; telegramChatId?: number };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const SESSION_HOURS = 3;
const OTP_MINUTES = 10;
const OTP_MAX_TRIES = 5;
const OTP_MAX_SENDS = 3;
const OTP_GAP_SECONDS = 30;

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const titleCase = (v: string) => clean(v).toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_m, a, b) => a + b.toUpperCase());

async function load(ctx: Ctx): Promise<{ step: string; data: Json } | null> {
  const rows = await rest(`bot_sessions?channel=eq.${ctx.channel}&chat_key=eq.${q(ctx.key)}&select=step,data,updated_at`);
  const row = rows?.[0];
  if (!row) return null;
  // a half-finished registration is forgotten after a few hours, so a later "hi" starts fresh
  if (Date.now() - new Date(row.updated_at).getTime() > SESSION_HOURS * 3_600_000) {
    await clear(ctx);
    return null;
  }
  return row;
}
async function save(ctx: Ctx, step: string, data: Json) {
  await rest("bot_sessions?on_conflict=channel,chat_key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ channel: ctx.channel, chat_key: ctx.key, step, data, updated_at: new Date().toISOString() }),
  });
}
async function clear(ctx: Ctx) {
  await rest(`bot_sessions?channel=eq.${ctx.channel}&chat_key=eq.${q(ctx.key)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}

async function sha(text: string) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newCode() {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(100000 + (n[0] % 900000));
}

// ---- the steps, in order ----
const ORDER = ["parents", "student", "phone", "email", "otp", "gender", "class", "school", "board", "city", "pin", "address", "terms", "confirm"];

const PROFILE_LINK = { label: "Open Website", url: `${SITE_URL}/studentprofile.html` };
const CANCEL: Choice ={ id: "cancel", title: "Cancel" };

// The two buttons under every "type the code" message.
const OTP_CHOICES: Choice[] = [{ id: "otp:resend", title: "Resend Code" }, { id: "otp:change", title: "Change Email" }];

// Texts use WhatsApp's *bold*; the Telegram bot turns *...* into bold too.
function prompt(step: string, d: Json): Out {
  switch (step) {
    case "parents": return { text: "Let's register you as a *student*.\nYou can type *Cancel* any time.\n\nWhat is the *parent's name*?" };
    case "student": return { text: "What is the *student's name*?" };
    case "phone": return { text: "Please share your *mobile number* with the button below, so we know it is really yours.", askPhone: true };
    case "email": return { text: "Enter your *email address*.\nWe will send a 6-digit code for verification." };
    case "otp": return {
      text: `We sent a 6-digit code to -\n*${d.email}*\n\nType it here (valid for ${OTP_MINUTES} minutes).\nCheck the spam folder if you can't see it.`,
      choices: OTP_CHOICES,
    };
    case "gender": return { text: "The student's *gender*?", choices: [{ id: "gender:Male", title: "Male" }, { id: "gender:Female", title: "Female" }] };
    case "class": return { text: "Which *class* is the student in?\n\nFor example -\n10th\n12th\nB.Com" };
    case "school": return { text: "*School / College* name?" };
    case "board": return { text: "*Board / University*?\n\nFor example -\nCBSE\nICSE\nState Board\nDelhi University" };
    case "city": return { text: "Which *city* do you live in?" };
    case "pin": return { text: "*PIN code* (6 digits)?" };
    case "address": return { text: "Your *address*?" };
    case "terms": return { text: "I confirm that the information provided by me is accurate and I agree to the *Terms & Conditions* and privacy requirements of Urbantutorsite.", choices: [{ id: "terms:yes", title: "I Agree" }, CANCEL] };
    case "confirm": return {
      text: "*Please check your details:*\n\n" +
        `Parent: *${d.parentsName}*\nStudent: *${d.studentName}*\nGender: ${d.gender}\nClass: ${d.className}\nSchool: ${d.school}\nBoard: ${d.board}\n` +
        `Mobile: ${d.phone}\nEmail: ${d.email}\nCity: ${d.city} - ${d.pinCode}\nAddress: ${d.address}`,
      choices: [{ id: "confirm:yes", title: "Submit" }, CANCEL],
    };
    default: return { text: "" };
  }
}

function nextStep(step: string, d: Json) {
  let i = ORDER.indexOf(step) + 1;
  // the mobile step is skipped when the channel already knows the number (WhatsApp)
  if (ORDER[i] === "phone" && d.phone) i++;
  return ORDER[i] ?? "confirm";
}

export async function startRegistration(ctx: Ctx): Promise<Out[]> {
  const d: Json = {};
  if (ctx.verifiedPhone) d.phone = last10(ctx.verifiedPhone);
  if (d.phone && (await studentWithPhone(d.phone))) {
    return [{ text: `This mobile number is *already registered* with a student account.\nPlease log in with your email on the website.\n\nNeed help? Call ${AGENCY_PHONE}.`, link: PROFILE_LINK }];
  }
  await save(ctx, "parents", d);
  return [prompt("parents", d)];
}

async function sendOtp(ctx: Ctx, d: Json): Promise<string | null> {
  const sends = Number(d.otpSends ?? 0);
  if (sends >= OTP_MAX_SENDS) return "Too many codes were requested. Please try again later or register on the website.";
  const wait = OTP_GAP_SECONDS * 1000 - (Date.now() - Number(d.otpSentAt ?? 0));
  if (wait > 0) return `Please wait ${Math.ceil(wait / 1000)} seconds before asking for another code.`;
  const code = newCode();
  d.otpHash = await sha(`${ctx.channel}:${ctx.key}:${d.email}:${code}`);
  d.otpExp = Date.now() + OTP_MINUTES * 60_000;
  d.otpTries = 0;
  d.otpSends = sends + 1;
  d.otpSentAt = Date.now();
  await sendMail(
    d.email,
    "Your Urban Tutor Site verification code",
    emailTemplate({
      heading: "Verify your email",
      greeting: "Hi,",
      intro: `Your verification code is ${code}. It is valid for ${OTP_MINUTES} minutes. If you did not ask for it, ignore this email.`,
      badge: { text: "VERIFY EMAIL", tone: "blue" },
    }),
    { always: true },
  );
  return null;
}

export async function handleInput(ctx: Ctx, input: Input): Promise<Out[] | null> {
  const s = await load(ctx);
  if (!s) return null;
  const d = s.data;
  const text = clean(input.text);
  const choice = input.choice ?? "";

  if (choice === "cancel" || /^cancel$/i.test(text)) {
    await clear(ctx);
    return [{ text: "Registration cancelled.\nSend *Hi* to start again." }];
  }

  const again = (msg: string): Out[] => [{ text: msg }, prompt(s.step, d)];
  const go = async (from: string): Promise<Out[]> => {
    const next = nextStep(from, d);
    await save(ctx, next, d);
    return [prompt(next, d)];
  };

  switch (s.step) {
    case "parents":
      if (text.length < 2 || text.length > 80) return again("Please type the parent's name.");
      d.parentsName = titleCase(text);
      return go("parents");

    case "student":
      if (text.length < 2 || text.length > 80) return again("Please type the student's name.");
      d.studentName = titleCase(text);
      return go("student");

    case "phone": {
      const phone = last10(input.contactPhone);
      if (phone.length !== 10) return [{ text: "Please tap the button below to share your number.\n(Typing it is not accepted.)", askPhone: true }];
      if (await studentWithPhone(phone)) {
        await clear(ctx);
        return [{ text: `This mobile number is *already registered* with a student account.\nPlease log in with your email on the website.\n\nNeed help? Call ${AGENCY_PHONE}.`, link: PROFILE_LINK }];
      }
      d.phone = phone;
      return go("phone");
    }

    case "email": {
      const email = text.toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) return again("That doesn't look like an email address.\nPlease type it again.");
      if (await studentWithEmail(email)) {
        return [{ text: `This email is *already registered*.\nTo add another student, please log in on the website.\n\nOr type a different email address here.`, link: PROFILE_LINK }];
      }
      d.email = email;
      const err = await sendOtp(ctx, d);
      if (err) return [{ text: err }];
      await save(ctx, "otp", d);
      return [prompt("otp", d)];
    }

    case "otp": {
      if (choice === "otp:change") {
        delete d.otpHash;
        await save(ctx, "email", d);
        return [prompt("email", d)];
      }
      if (choice === "otp:resend") {
        const err = await sendOtp(ctx, d);
        await save(ctx, "otp", d);
        return [{ text: err ?? `A new code was sent to ${d.email}.` }];
      }
      if (!/^\d{6}$/.test(text)) return [{ text: "Enter the *6-digit code* for your email verification.", choices: OTP_CHOICES }];
      if (!d.otpHash || Date.now() > Number(d.otpExp ?? 0)) return [{ text: "That code has *expired*.\nTap *Resend Code*.", choices: OTP_CHOICES }];
      if (Number(d.otpTries ?? 0) >= OTP_MAX_TRIES) return [{ text: "Too many wrong tries.\nTap *Resend Code*.", choices: OTP_CHOICES }];
      if (await sha(`${ctx.channel}:${ctx.key}:${d.email}:${text}`) !== d.otpHash) {
        d.otpTries = Number(d.otpTries ?? 0) + 1;
        await save(ctx, "otp", d);
        return [{ text: "That code is *not correct*.\nPlease try again.", choices: OTP_CHOICES }];
      }
      delete d.otpHash;
      d.emailVerified = true;
      return [{ text: "*Email verified.*" }, ...(await go("otp"))];
    }

    case "gender": {
      const g = choice.replace(/^gender:/, "");
      if (g !== "Male" && g !== "Female") return again("Please tap *Male* or *Female*.");
      d.gender = g;
      return go("gender");
    }

    case "class":
      if (text.length < 1 || text.length > 80) return again("Please type the class.");
      d.className = text;
      return go("class");

    case "school":
      if (text.length < 2 || text.length > 150) return again("Please type the school / college name.");
      d.school = titleCase(text);
      return go("school");

    case "board":
      if (text.length < 2 || text.length > 150) return again("Please type the board / university.");
      d.board = text;
      return go("board");

    case "city":
      if (text.length < 2 || text.length > 80) return again("Please type your city.");
      d.city = titleCase(text);
      return go("city");

    case "pin":
      if (!/^\d{6}$/.test(text)) return again("The PIN code must be 6 digits.");
      d.pinCode = text;
      return go("pin");

    case "address":
      if (text.length < 5 || text.length > 250) return again("Please type your address (at least a few words).");
      d.address = text;
      return go("address");

    case "terms":
      if (choice !== "terms:yes") return again("Please tap *I Agree* to continue, or *Cancel*.");
      d.terms = true;
      return go("terms");

    case "confirm": {
      if (choice !== "confirm:yes") return [prompt("confirm", d)];
      if (!d.emailVerified || !d.phone) { await clear(ctx); return [{ text: "Something went wrong.\nPlease send *Hi* and try again." }]; }
      // checked again right before saving, in case it was taken in the meantime
      if (await studentWithEmail(d.email) || await studentWithPhone(d.phone)) {
        await clear(ctx);
        return [{ text: `This email or mobile number is *already registered*.\nPlease log in on the website.`, link: PROFILE_LINK }];
      }
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_register_student`, {
        method: "POST",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p: {
          email: d.email, parentsName: d.parentsName, studentName: d.studentName, phone: d.phone, whatsapp: d.phone,
          gender: d.gender, className: d.className, school: d.school, board: d.board, city: d.city, pinCode: d.pinCode,
          address: d.address, termsAccepted: true,
        } }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok || !out?.success) {
        console.error("bot register failed", res.status, JSON.stringify(out));
        const why = String(out?.message ?? "").replace(/^.*?:\s*/, "");
        await clear(ctx);
        return [{ text: `We could not complete the registration${why ? ` (${why})` : ""}.\nPlease send *Hi* to try again, or register on the website.` }];
      }
      if (ctx.channel === "tg" && ctx.telegramChatId) {
        await rest(`students?student_id=eq.${q(String(out.studentId))}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ telegram_chat_id: ctx.telegramChatId }),
        });
      }
      await save(ctx, "tuition", { studentId: out.studentId });
      return [{
        text: `*You are registered!*\nYour Student ID is *${out.studentId}*.\n\nDo you want to post a new tuition request now?`,
        choices: [{ id: "tuition:yes", title: "Yes, Post Now" }, { id: "tuition:no", title: "Not Now" }],
      }];
    }

    case "tuition": {
      await clear(ctx);
      if (choice === "tuition:yes") {
        return [{
          text: "*Post a New Tuition*\nTap the button below, log in with your email and tap *Apply For New Tuition*.\n\nSend *Hi* any time for the menu.",
          link: PROFILE_LINK,
        }];
      }
      return [{ text: "All set.\nSend *Hi* any time for the menu." }];
    }
  }
  return null;
}
