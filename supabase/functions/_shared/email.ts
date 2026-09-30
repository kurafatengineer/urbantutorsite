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
}): string {
  const { heading, greeting, intro, detailRowsHtml = "", footerNote = "" } = opts;

  // Three blocks on a dark-grey card: a black header whose bottom corners
  // are rounded, the message + details in the middle, and a white footer
  // whose top corners are rounded.
  const MID = "#161616";

  return (
    '<div bgcolor="#000000" style="background-color:#000000;padding:36px 16px;font-family:Arial,Helvetica,sans-serif;text-align:center;">' +
      '<table role="presentation" width="100%" bgcolor="' + MID + '" style="max-width:380px;margin:0 auto;background-color:' + MID + ';border-radius:16px;overflow:hidden;text-align:center;">' +

        '<tr><td bgcolor="#000000" style="background-color:#000000;padding:22px 24px 20px;text-align:center;border-bottom-left-radius:18px;border-bottom-right-radius:18px;border-top-left-radius:16px;border-top-right-radius:16px;">' +
          '<div style="font-size:15px;font-weight:700;letter-spacing:1.5px;color:#ffffff;">Urban Tutor Site</div>' +
        "</td></tr>" +

        '<tr><td bgcolor="' + MID + '" style="background-color:' + MID + ';padding:26px 24px 4px;text-align:center;">' +
          '<h1 style="margin:0 0 10px;font-size:19px;color:#ffffff;text-align:center;">' + escapeHtml(heading) + "</h1>" +
          '<p style="margin:0;font-size:14px;line-height:1.6;color:#aaaaaa;text-align:center;">' + escapeHtml(greeting) + "<br>" + escapeHtml(intro) + "</p>" +
        "</td></tr>" +

        (detailRowsHtml
          ? '<tr><td bgcolor="' + MID + '" style="background-color:' + MID + ';padding:20px 24px 8px;text-align:center;">' +
              '<table role="presentation" align="center" width="100%" style="margin:0 auto;max-width:320px;background-color:#ffffff;border-radius:10px;padding:6px 16px;" bgcolor="#ffffff">' +
                detailRowsHtml +
              "</table>" +
            "</td></tr>"
          : "") +

        (footerNote
          ? '<tr><td bgcolor="' + MID + '" style="background-color:' + MID + ';padding:14px 24px 4px;text-align:center;">' +
              '<span style="font-size:12px;color:#999999;">' + escapeHtml(footerNote) + "</span>" +
            "</td></tr>"
          : "") +

        '<tr><td bgcolor="' + MID + '" style="background-color:' + MID + ';height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>' +

        '<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:14px 24px;text-align:center;border-top-left-radius:18px;border-top-right-radius:18px;border-bottom-left-radius:16px;border-bottom-right-radius:16px;">' +
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

// Best-effort: a notification failure must never break the underlying
// action (payment saved, demo response recorded, etc.), so errors are
// logged and swallowed rather than thrown.
export async function sendMail(to: string | null | undefined, subject: string, html: string): Promise<void> {
  if (!to) return;
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
