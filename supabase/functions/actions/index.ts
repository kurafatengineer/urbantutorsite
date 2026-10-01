// =====================================================================
// URBANTUTORSITE - STUDENT/TUTOR SELF-SERVICE ACTIONS  (Edge Function "actions")
//
// Thin wrapper around the self-service RPCs that students and tutors call
// from the site: add_tuition, register_student, apply_for_tuition,
// respond_to_demo, respond_to_demo_tutor
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
import { sendMail } from "../_shared/email.ts";
import { tuitionPostedMail, tutorAppliedMail, parentResponseMail, tutorResponseMail } from "../_shared/mails.ts";

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
   LOOKUPS used by the notification emails
------------------------------------------------------------------ */

async function demoAndStudent(demoId: string) {
  const { data: tuition } = await db.from("tuitions")
    .select("demo_id, subject, student_id, medium, preferred_tutor").eq("demo_id", demoId).maybeSingle();
  const { data: student } = tuition?.student_id
    ? await db.from("students").select("student_id, student_name, email, class_name, board, city, pin_code")
        .eq("student_id", tuition.student_id).maybeSingle()
    : { data: null };
  return { tuition, student };
}

async function tutorByEmail(email: string) {
  const { data } = await db.from("tutors")
    .select("tutor_id, full_name, gender, experience_years").ilike("email", email).maybeSingle();
  return data;
}

async function tutorById(tutorId: string) {
  const { data } = await db.from("tutors").select("tutor_id, full_name, email").eq("tutor_id", tutorId).maybeSingle();
  return data;
}

async function callerEmail(userClient: ReturnType<typeof callAsUser>): Promise<string> {
  const { data } = await userClient.auth.getUser();
  return (data?.user?.email ?? "").toLowerCase();
}

// 1 - tuition request(s) posted: one mail to the student listing every Demo ID.
async function sendTuitionPosted(studentId: string, demoIds: string[]) {
  if (!studentId || !demoIds?.length) return;
  const { data: student } = await db.from("students")
    .select("student_name, email, class_name, board, city, pin_code").eq("student_id", studentId).maybeSingle();
  if (!student?.email) return;
  const { data: rows } = await db.from("tuitions")
    .select("demo_id, subject, medium, preferred_tutor").in("demo_id", demoIds).order("demo_id");
  if (!rows?.length) return;
  const mail = tuitionPostedMail({
    name: student.student_name, demos: rows.map((r: Json) => ({ demoId: r.demo_id, subject: r.subject })),
    cls: student.class_name, board: student.board, medium: rows[0].medium, preferredTutor: rows[0].preferred_tutor,
    city: student.city, pin: student.pin_code,
  });
  await sendMail(student.email, mail.subject, mail.html);
}

/* ------------------------------------------------------------------
   ACTIONS
------------------------------------------------------------------ */

// 1 - a student posts a new tuition request
async function handleAddTuition(userClient: ReturnType<typeof callAsUser>, body: Json) {
  const p = body.p ?? {};
  const { data, error } = await userClient.rpc("add_tuition", { p });
  if (error) return reply({ success: false, message: error.message }, 400);
  if (data?.success) await sendTuitionPosted(String(p.studentId ?? ""), data.demoIds ?? []);
  return reply(data ?? { success: true });
}

// 1 - a new student registers with their first tuition request(s)
async function handleRegisterStudent(userClient: ReturnType<typeof callAsUser>, body: Json) {
  const { data, error } = await userClient.rpc("register_student", { p: body.p ?? {} });
  if (error) return reply({ success: false, message: error.message }, 400);
  if (data?.success) await sendTuitionPosted(String(data.studentId ?? ""), data.demoIds ?? []);
  return reply(data ?? { success: true });
}

// 2 - a tutor applied: tell the student
async function handleApplyForTuition(userClient: ReturnType<typeof callAsUser>, body: Json) {
  const demoId = String(body.p_demo_id ?? "").trim();
  const { data, error } = await userClient.rpc("apply_for_tuition", { p_demo_id: demoId });
  if (error) return reply({ success: false, message: error.message }, 400);

  if (data?.success && !data?.alreadyApplied) {
    const tutor = await tutorByEmail(await callerEmail(userClient));
    const { tuition, student } = await demoAndStudent(demoId);
    if (tutor && student?.email) {
      const mail = tutorAppliedMail({
        name: student.student_name, demoId, subject: tuition?.subject ?? "", tutorName: tutor.full_name,
        tutorId: tutor.tutor_id, experience: tutor.experience_years, gender: tutor.gender,
      });
      await sendMail(student.email, mail.subject, mail.html);
    }
  }

  return reply(data ?? { success: true });
}

// 5 - the parent accepted / rejected a tutor: tell the tutor
async function handleRespondToDemo(userClient: ReturnType<typeof callAsUser>, body: Json) {
  const demoId = String(body.p_demo_id ?? "").trim();
  const tutorId = String(body.p_tutor_id ?? "").trim();
  const decision = String(body.p_decision ?? "").trim();
  const { data, error } = await userClient.rpc("respond_to_demo", {
    p_demo_id: demoId, p_tutor_id: tutorId, p_decision: decision,
  });
  if (error) return reply({ success: false, message: error.message }, 400);

  if (data?.success) {
    const tutor = await tutorById(tutorId);
    const { tuition, student } = await demoAndStudent(demoId);
    if (tutor?.email && student) {
      const mail = parentResponseMail({
        name: tutor.full_name, demoId, subject: tuition?.subject ?? "", studentName: student.student_name,
        cls: student.class_name, board: student.board, city: student.city, pin: student.pin_code,
        accepted: decision.toLowerCase() === "accept",
      });
      await sendMail(tutor.email, mail.subject, mail.html);
    }
  }

  return reply(data ?? { success: true });
}

// 4 - the tutor accepted / rejected: tell the student
async function handleRespondToDemoTutor(userClient: ReturnType<typeof callAsUser>, body: Json) {
  const demoId = String(body.p_demo_id ?? "").trim();
  const decision = String(body.p_decision ?? "").trim();
  const { data, error } = await userClient.rpc("respond_to_demo_tutor", { p_demo_id: demoId, p_decision: decision });
  if (error) return reply({ success: false, message: error.message }, 400);

  if (data?.success) {
    const tutor = await tutorByEmail(await callerEmail(userClient));
    const { tuition, student } = await demoAndStudent(demoId);
    if (tutor && student?.email) {
      const mail = tutorResponseMail({
        name: student.student_name, demoId, subject: tuition?.subject ?? "", tutorName: tutor.full_name,
        tutorId: tutor.tutor_id, accepted: decision.toLowerCase() === "accept",
      });
      await sendMail(student.email, mail.subject, mail.html);
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
      case "addTuition":
        return await handleAddTuition(userClient, body);
      case "registerStudent":
        return await handleRegisterStudent(userClient, body);
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
