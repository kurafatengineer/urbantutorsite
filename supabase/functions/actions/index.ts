// =====================================================================
// URBANTUTORSITE - STUDENT/TUTOR SELF-SERVICE ACTIONS  (Edge Function "actions")
//
// Thin wrapper around three self-service RPCs that students and tutors
// already call directly from the site:
//   apply_for_tuition, respond_to_demo, respond_to_demo_tutor
//
// It exists only so a notification email can go out to the OTHER party
// after a successful call, without touching the RPCs themselves (they
// stay SECURITY DEFINER functions run with the CALLER's own auth
// context - this function re-authenticates as that same caller using
// their access token, so RLS/ownership checks behave identically to a
// direct .rpc() call from the browser).
//
// Request (POST, JSON):  { action, ...fields }
//   Authorization: Bearer <supabase auth access token>
// Reply (JSON):          same shape the RPC itself returns
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { emailTemplate, detailRow, sendMail } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// deno-lint-ignore no-explicit-any
type Json = any;

function reply(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function callAsUser(token: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ------------------------------------------------------------------
   NOTIFICATION CONTEXT - who to email and what to say
------------------------------------------------------------------ */

interface DemoContext {
  demoId: string;
  subject: string | null;
  student: { name: string; email: string | null } | null;
  tutor: { id: string; name: string; email: string | null } | null;
}

async function loadDemoContext(demoId: string, tutorId?: string): Promise<DemoContext> {
  const { data: tuition } = await db
    .from("tuitions")
    .select("demo_id, subject, student_id")
    .eq("demo_id", demoId)
    .maybeSingle();

  let student: DemoContext["student"] = null;
  if (tuition?.student_id) {
    const { data: s } = await db
      .from("students")
      .select("student_name, email")
      .eq("student_id", tuition.student_id)
      .maybeSingle();
    if (s) student = { name: s.student_name, email: s.email };
  }

  let tutor: DemoContext["tutor"] = null;
  if (tutorId) {
    const { data: t } = await db
      .from("tutors")
      .select("tutor_id, full_name, email")
      .eq("tutor_id", tutorId)
      .maybeSingle();
    if (t) tutor = { id: t.tutor_id, name: t.full_name, email: t.email };
  }

  return { demoId, subject: tuition?.subject ?? null, student, tutor };
}

async function notify(to: string | null | undefined, subject: string, heading: string, greeting: string, intro: string, rows: [string, string][]) {
  const detailRowsHtml = rows.map(([label, value]) => detailRow(label, value)).join("");
  const html = emailTemplate({ heading, greeting, intro, detailRowsHtml });
  await sendMail(to, subject, html);
}

/* ------------------------------------------------------------------
   ACTIONS
------------------------------------------------------------------ */

async function handleApplyForTuition(userClient: ReturnType<typeof callAsUser>, body: Json) {
  const demoId = String(body.p_demo_id ?? "").trim();
  const { data, error } = await userClient.rpc("apply_for_tuition", { p_demo_id: demoId });
  if (error) return reply({ success: false, message: error.message }, 400);

  if (data?.success && !data?.alreadyApplied) {
    // Applications table doesn't record which tutor made this specific
    // call outside the RPC's own auth context, so look it up by demo+caller.
    const { data: authUser } = await userClient.auth.getUser();
    const email = (authUser?.user?.email ?? "").toLowerCase();
    const { data: tutorRow } = await db.from("tutors").select("tutor_id, full_name").ilike("email", email).maybeSingle();
    if (tutorRow) {
      const ctx = await loadDemoContext(demoId);
      if (ctx.student?.email) {
        await notify(
          ctx.student.email,
          "A tutor applied for your tuition request",
          "New Tutor Application",
          `Hi ${ctx.student.name},`,
          `${tutorRow.full_name} has applied to teach your tuition request. Log in to your dashboard to review and schedule a demo.`,
          [["Demo ID", demoId], ["Subject", ctx.subject ?? "-"], ["Tutor", tutorRow.full_name]],
        );
      }
    }
  }

  return reply(data ?? { success: true });
}

async function handleRespondToDemo(userClient: ReturnType<typeof callAsUser>, body: Json) {
  const demoId = String(body.p_demo_id ?? "").trim();
  const tutorId = String(body.p_tutor_id ?? "").trim();
  const decision = String(body.p_decision ?? "").trim();
  const { data, error } = await userClient.rpc("respond_to_demo", {
    p_demo_id: demoId,
    p_tutor_id: tutorId,
    p_decision: decision,
  });
  if (error) return reply({ success: false, message: error.message }, 400);

  if (data?.success) {
    const ctx = await loadDemoContext(demoId, tutorId);
    if (ctx.tutor?.email && ctx.student) {
      const accepted = decision.toLowerCase() === "accept";
      await notify(
        ctx.tutor.email,
        accepted ? "A parent accepted your demo" : "A parent responded to your demo application",
        accepted ? "Demo Accepted" : "Demo Not Accepted",
        `Hi ${ctx.tutor.name},`,
        accepted
          ? `${ctx.student.name} has accepted you for this tuition. You can view the details in your dashboard.`
          : `${ctx.student.name} has decided not to proceed with you for this tuition.`,
        [["Demo ID", demoId], ["Subject", ctx.subject ?? "-"], ["Student", ctx.student.name]],
      );
    }
  }

  return reply(data ?? { success: true });
}

async function handleRespondToDemoTutor(userClient: ReturnType<typeof callAsUser>, body: Json) {
  const demoId = String(body.p_demo_id ?? "").trim();
  const decision = String(body.p_decision ?? "").trim();
  const { data, error } = await userClient.rpc("respond_to_demo_tutor", {
    p_demo_id: demoId,
    p_decision: decision,
  });
  if (error) return reply({ success: false, message: error.message }, 400);

  if (data?.success) {
    const { data: authUser } = await userClient.auth.getUser();
    const email = (authUser?.user?.email ?? "").toLowerCase();
    const { data: tutorRow } = await db.from("tutors").select("tutor_id, full_name").ilike("email", email).maybeSingle();
    if (tutorRow) {
      const ctx = await loadDemoContext(demoId);
      if (ctx.student?.email) {
        const accepted = decision.toLowerCase() === "accept";
        await notify(
          ctx.student.email,
          accepted ? "Your tutor accepted the demo" : "Your tutor responded to the demo",
          accepted ? "Tuition Accepted" : "Tuition Not Accepted",
          `Hi ${ctx.student.name},`,
          accepted
            ? `${tutorRow.full_name} has accepted your tuition request.`
            : `${tutorRow.full_name} is unable to take up your tuition request.`,
          [["Demo ID", demoId], ["Subject", ctx.subject ?? "-"], ["Tutor", tutorRow.full_name]],
        );
      }
    }
  }

  return reply(data ?? { success: true });
}

/* ------------------------------------------------------------------
   ENTRY POINT
------------------------------------------------------------------ */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ success: false, message: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  const token = (authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return reply({ success: false, message: "Please log in first." }, 401);

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return reply({ success: false, message: "Invalid request." }, 400);
  }

  const userClient = callAsUser(token);
  const action = String(body?.action ?? "");

  try {
    switch (action) {
      case "applyForTuition":
        return await handleApplyForTuition(userClient, body);
      case "respondToDemo":
        return await handleRespondToDemo(userClient, body);
      case "respondToDemoTutor":
        return await handleRespondToDemoTutor(userClient, body);
      default:
        return reply({ success: false, message: "Unknown action." }, 400);
    }
  } catch (err) {
    console.error("actions function error", err);
    return reply({ success: false, message: "Something went wrong. Please try again." }, 500);
  }
});
