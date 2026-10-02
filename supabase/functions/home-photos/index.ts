// =====================================================================
// URBANTUTORSITE - HOMEPAGE TUTOR PHOTOS  (Edge Function "home-photos")
//
// The public homepage section "Tutors worth meeting" shows the 4 newest
// VERIFIED tutors (the same list as get_home_stats). Their photos live in a
// private bucket, so this function hands out 1-hour links for exactly those
// tutors - nobody else's photo, and nothing but the picture and the name
// (used only to match the card). No login is needed because the homepage is
// public. Tutors who are not Verified are never included.
//
// Request (GET or POST, no body)
// Reply (JSON): { success: true, photos: [ { name, url }, ... ] }  (same order as the cards)
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
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// deno-lint-ignore no-explicit-any
type Json = any;

function reply(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // exactly the tutors get_home_stats lists: newest Verified first, 4 of them
    const { data: tutors } = await db.from("tutors").select("full_name, profile_image")
      .eq("verification_status", "Verified").order("registered_at", { ascending: false }).limit(4);

    const list: Json[] = tutors ?? [];
    const paths = list.map((t) => t.profile_image).filter((p) => p && !/^https?:\/\//i.test(p));
    const byPath = new Map<string, string>();

    if (paths.length) {
      const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths, LINK_SECONDS);
      (signed ?? []).forEach((s: Json) => { if (s?.path && s?.signedUrl) byPath.set(s.path, s.signedUrl); });
    }

    return reply({
      success: true,
      photos: list.map((t) => ({ name: t.full_name, url: byPath.get(t.profile_image) ?? "" })),
    });
  } catch (err) {
    console.error("home-photos error", err);
    return reply({ success: false, photos: [] }, 500);
  }
});
