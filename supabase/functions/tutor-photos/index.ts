// =====================================================================
// URBANTUTORSITE - TUTOR PHOTOS FOR STUDENTS  (Edge Function "tutor-photos")
//
// A tutor's profile photo lives in the PRIVATE storage bucket
// "tutor-documents", so the browser cannot open it directly. A logged-in
// STUDENT asks this function for the photos of specific tutors and gets
// back links that work for 1 hour - but only for tutors who
//   1. are Verified (the office has checked the tutor, photo included), and
//   2. applied for / were assigned to one of THIS student's tuitions.
// Nobody else can fetch a photo through it (tutors see their own photo
// directly; the Admin Panel has its own links).
//
// Request (POST, JSON):  { tutorIds: ["TID...", ...] }   max 20
//   Authorization: Bearer <supabase auth access token>
// Reply (JSON):          { success: true, photos: { "TID...": "https://..." } }
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "tutor-documents";
const LINK_SECONDS = 60 * 60;

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
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ success: false, message: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return reply({ success: false, message: "Please log in first." }, 401);

  let body: Json;
  try { body = await req.json(); } catch { return reply({ success: false, message: "Invalid request." }, 400); }

  try {
    const { data: auth } = await db.auth.getUser(token);
    const email = (auth?.user?.email ?? "").toLowerCase();
    if (!email) return reply({ success: false, message: "Please log in again." }, 401);

    const wanted: string[] = [...new Set((Array.isArray(body?.tutorIds) ? body.tutorIds : []).map(String))].slice(0, 20);
    if (!wanted.length) return reply({ success: true, photos: {} });

    // this caller's own students -> their tuitions -> tutors who applied
    const { data: students } = await db.from("students").select("student_id").ilike("email", email);
    const studentIds = (students ?? []).map((s: Json) => s.student_id);
    if (!studentIds.length) return reply({ success: true, photos: {} });

    const { data: tuitions } = await db.from("tuitions").select("demo_id").in("student_id", studentIds);
    const demoIds = (tuitions ?? []).map((t: Json) => t.demo_id);
    if (!demoIds.length) return reply({ success: true, photos: {} });

    const { data: apps } = await db.from("applications").select("tutor_id").in("demo_id", demoIds).in("tutor_id", wanted);
    const allowed = [...new Set((apps ?? []).map((a: Json) => a.tutor_id))];
    if (!allowed.length) return reply({ success: true, photos: {} });

    const { data: tutors } = await db.from("tutors").select("tutor_id, profile_image")
      .in("tutor_id", allowed).eq("verification_status", "Verified");
    const paths = (tutors ?? []).filter((t: Json) => t.profile_image && !/^https?:\/\//i.test(t.profile_image));
    if (!paths.length) return reply({ success: true, photos: {} });

    const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths.map((t: Json) => t.profile_image), LINK_SECONDS);
    const byPath = new Map<string, string>();
    (signed ?? []).forEach((s: Json) => { if (s?.path && s?.signedUrl) byPath.set(s.path, s.signedUrl); });

    const photos: Record<string, string> = {};
    paths.forEach((t: Json) => { const u = byPath.get(t.profile_image); if (u) photos[t.tutor_id] = u; });
    return reply({ success: true, photos });
  } catch (err) {
    console.error("tutor-photos error", err);
    return reply({ success: false, message: "Something went wrong." }, 500);
  }
});
