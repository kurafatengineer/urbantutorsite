// Shared HTML email template + Gmail SMTP sender used by every Edge
// Function that needs to notify a student, tutor, or admin of a change.
// Visual format adapted from the agency's existing OTP-mail template
// (dark card, "Urban Tutor Site" header, white detail box, footer).

import nodemailer from "npm:nodemailer@6";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function detailRow(label: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return (
    '<tr><td style="padding:6px 0;border-bottom:1px solid #eeeeee;font-size:13px;color:#777777;text-align:left;">' +
      escapeHtml(label) +
    '</td><td style="padding:6px 0;border-bottom:1px solid #eeeeee;font-size:13px;color:#000000;font-weight:600;text-align:right;">' +
      escapeHtml(value) +
    "</td></tr>"
  );
}

export function emailTemplate(opts: {
  heading: string;
  greeting: string;
  intro: string;
  detailRowsHtml?: string;
  footerNote?: string;
  // a small coloured status pill under the heading (e.g. "Accepted")
  badge?: { text: string; tone: "green" | "red" | "blue" | "orange" | "purple" };
  // a green button at the end of the message
  cta?: { label: string; url: string };
}): string {
  const { heading, greeting, intro, detailRowsHtml = "", footerNote = "", badge, cta } = opts;

  const TONES = {
    green: ["#14532d", "#86efac"], red: ["#7f1d1d", "#fca5a5"], blue: ["#1e3a8a", "#93c5fd"],
    orange: ["#7c2d12", "#fdba74"], purple: ["#4c1d95", "#c4b5fd"],
  } as const;
  const badgeHtml = badge
    ? '<div style="margin:0 0 12px;"><span style="display:inline-block;padding:5px 14px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.4px;background-color:' +
      TONES[badge.tone][0] + ";color:" + TONES[badge.tone][1] + ';">' + escapeHtml(badge.text) + "</span></div>"
    : "";
  const ctaHtml = cta
    ? '<tr><td style="padding:18px 24px 0;text-align:center;"><a href="' + escapeHtml(cta.url) +
      '" style="display:inline-block;padding:12px 28px;border-radius:999px;background-color:#16a34a;color:#050505;font-size:14px;font-weight:700;text-decoration:none;">' +
      escapeHtml(cta.label) + "</a></td></tr>"
    : "";

  // Full-width layout: the black header sits at the very top of the mail
  // (only its bottom corners are curved), the white footer at the very
  // bottom (only its top corners are curved), and the message + details
  // in between on dark grey.
  const MID = "#161616";

  const inner =
    '<table role="presentation" align="center" width="100%" style="max-width:380px;margin:0 auto;" cellpadding="0" cellspacing="0">' +
      '<tr><td style="padding:28px 24px 4px;text-align:center;">' +
        badgeHtml +
        '<h1 style="margin:0 0 10px;font-size:19px;color:#ffffff;text-align:center;">' + escapeHtml(heading) + "</h1>" +
        '<p style="margin:0;font-size:14px;line-height:1.6;color:#aaaaaa;text-align:center;">' + escapeHtml(greeting) + "<br>" + escapeHtml(intro) + "</p>" +
      "</td></tr>" +
      (detailRowsHtml
        ? '<tr><td style="padding:20px 24px 8px;text-align:center;">' +
            '<table role="presentation" align="center" width="100%" style="margin:0 auto;max-width:320px;background-color:#ffffff;border-radius:10px;padding:6px 16px;" bgcolor="#ffffff">' +
              detailRowsHtml +
            "</table>" +
          "</td></tr>"
        : "") +
      ctaHtml +
      (footerNote
        ? '<tr><td style="padding:14px 24px 4px;text-align:center;"><span style="font-size:12px;color:#999999;">' + escapeHtml(footerNote) + "</span></td></tr>"
        : "") +
      '<tr><td style="height:36px;line-height:36px;font-size:0;">&nbsp;</td></tr>' +
    "</table>";

  return (
    '<div bgcolor="' + MID + '" style="background-color:' + MID + ';margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;text-align:center;">' +
      '<table role="presentation" width="100%" bgcolor="' + MID + '" cellpadding="0" cellspacing="0" style="width:100%;background-color:' + MID + ';">' +

        '<tr><td bgcolor="#000000" style="background-color:#000000;padding:24px 24px 22px;text-align:center;border-bottom-left-radius:22px;border-bottom-right-radius:22px;">' +
          '<div style="font-size:15px;font-weight:700;letter-spacing:1.5px;color:#ffffff;">Urban Tutor Site</div>' +
        "</td></tr>" +

        '<tr><td bgcolor="' + MID + '" style="background-color:' + MID + ';text-align:center;">' + inner + "</td></tr>" +

        '<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:18px 24px;text-align:center;border-top-left-radius:22px;border-top-right-radius:22px;">' +
          '<span style="font-size:11px;color:#555555;">&copy; ' + new Date().getFullYear() + " Urban Tutor Site. All rights reserved.</span>" +
        "</td></tr>" +

      "</table>" +
    "</div>"
  );
}

// deno-lint-ignore no-explicit-any
let cachedTransport: any = null;

function transport() {
  if (cachedTransport) return cachedTransport;
  const user = Deno.env.get("GMAIL_ADDRESS");
  const pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass) {
    throw new Error("Gmail SMTP credentials are not configured (GMAIL_ADDRESS / GMAIL_APP_PASSWORD)");
  }
  cachedTransport = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
  return cachedTransport;
}

// The Super Admin's "Emails Off" (app_settings key "admin_mails") stops
// EVERY notification email, site-wide. Login codes (OTP) are sent by
// Supabase Auth itself, not from here, so they always go out.
async function siteMailsOn(): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return true;
  try {
    const res = await fetch(`${url}/rest/v1/app_settings?key=eq.admin_mails&select=value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return true;
    const rows = await res.json();
    return rows?.[0]?.value?.enabled !== false;
  } catch {
    return true;
  }
}

// Best-effort: a notification failure must never break the underlying
// action (payment saved, demo response recorded, etc.), so errors are
// logged and swallowed rather than thrown.
export async function sendMail(to: string | null | undefined, subject: string, html: string): Promise<void> {
  if (!to) return;
  if (!(await siteMailsOn())) return;   // Super Admin switched all emails off
  const user = Deno.env.get("GMAIL_ADDRESS");
  try {
    await transport().sendMail({
      from: `"Urban Tutor Site" <${user}>`,
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error("sendMail failed", { to, subject, error: String(err) });
  }
}
