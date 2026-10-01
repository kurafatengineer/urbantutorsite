// =====================================================================
// ARCHIVED - NOT DEPLOYED.  Kept only so the work is not lost.
// The live Edge Function "whatsapp-webhook" was switched off (it now
// answers 410) because the Facebook / WhatsApp Business setup is not
// verified yet. To use it again: copy this file back to
// supabase/functions/whatsapp-webhook/index.ts and deploy it.
//
// BEFORE re-enabling, add a check of Meta's "X-Hub-Signature-256" header
// (signed with the app secret) to the POST branch, otherwise anyone who
// knows the URL could send fake events to it.
// =====================================================================

// =====================================================================
// URBANTUTORSITE - WHATSAPP WEBHOOK  (Supabase Edge Function "whatsapp-webhook")
//
// Meta calls THIS function for two reasons:
//   1. Once, with a GET request, to prove you own this URL (the
//      "verification handshake").
//   2. Every time something happens on your WhatsApp number - a
//      message arrives, a button is tapped, delivery/read updates -
//      as a POST request with the event as JSON.
//
// RIGHT NOW this function:
//   - verifies itself to Meta (unchanged)
//   - when someone sends a plain text message (e.g. "Hi"), checks if
//     their WhatsApp number is already a registered student/tutor
//       - already registered -> a short "you're already registered" reply
//       - not registered     -> "Register as Student" / "Register as
//                                Tutor" buttons
//   - when "Register as Student" is tapped -> acknowledges (the actual
//     Flow that collects details is wired in next, once it's built and
//     published in Meta's Flow Builder)
//   - when "Register as Tutor" is tapped -> tells them it's on the way,
//     points to the website for now (only the Student flow is built)
//
// Settings it reads (Supabase -> Edge Functions -> Secrets):
//   WHATSAPP_VERIFY_TOKEN      you set this earlier
//   WHATSAPP_TOKEN             the access token from Meta's API Setup
//                              screen (temporary for now, 24h - swap
//                              for a permanent System User token before
//                              going live)
//   WHATSAPP_PHONE_NUMBER_ID   the Phone Number ID from that same screen
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   provided automatically
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const WEBSITE_URL = "https://kurafatengineer.github.io/urbantutorsite/";

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// deno-lint-ignore no-explicit-any
type Json = any;

/* ------------------------------------------------------------------
   SENDING MESSAGES
------------------------------------------------------------------ */

async function callGraph(body: Json) {
  const res = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  if (!res.ok) {
    console.error("WhatsApp send failed:", res.status, await res.text());
  }
}

async function sendText(to: string, text: string) {
  await callGraph({ to, type: "text", text: { body: text } });
}

async function sendRegisterButtons(to: string) {
  await callGraph({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: "Welcome to Urbantutorsite! Are you looking to register as a Student (find a tutor) or as a Tutor (start teaching)?",
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "reg_student", title: "Register as Student" } },
          { type: "reply", reply: { id: "reg_tutor", title: "Register as Tutor" } },
        ],
      },
    },
  });
}

/* ------------------------------------------------------------------
   HANDLING AN INCOMING MESSAGE
------------------------------------------------------------------ */

async function handleIncomingMessage(from: string, message: Json) {
  // ---- a button was tapped ----
  if (message.type === "interactive" && message.interactive?.type === "button_reply") {
    const id = message.interactive.button_reply.id;

    if (id === "reg_student") {
      // The actual multi-screen Flow is wired in next, once it's
      // built and published in Meta's Flow Builder. For now, just
      // confirm the tap was received.
      await sendText(from, "Great choice! We're setting up the Student registration form for WhatsApp — it'll appear here shortly.");
      return;
    }

    if (id === "reg_tutor") {
      await sendText(
        from,
        `Tutor registration on WhatsApp is coming soon. For now, please register here:\n${WEBSITE_URL}tutorregistration.html`
      );
      return;
    }

    return;
  }

  // ---- a plain text message (treat anything as a "Hi") ----
  if (message.type === "text") {
    const { data: status, error } = await db.rpc("whatsapp_number_status", { p_number: from });

    if (error) {
      console.error("whatsapp_number_status:", error.message);
      await sendText(from, "Sorry, something went wrong. Please try again in a moment.");
      return;
    }

    if (status?.student) {
      await sendText(from, `You're already registered as a student with us. Visit ${WEBSITE_URL} and log in with your e-mail to see your dashboard.`);
      return;
    }

    if (status?.tutor) {
      await sendText(from, `You're already registered as a tutor with us. Visit ${WEBSITE_URL} and log in with your e-mail to see your dashboard.`);
      return;
    }

    await sendRegisterButtons(from);
  }
}

/* ------------------------------------------------------------------
   HTTP
------------------------------------------------------------------ */

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // ---- 1. Meta's one-time verification handshake ----
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token && VERIFY_TOKEN && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Verification failed.", { status: 403 });
  }

  // ---- 2. Real events ----
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const value = body?.entry?.[0]?.changes?.[0]?.value;
      const messages: Json[] = value?.messages ?? [];

      for (const message of messages) {
        await handleIncomingMessage(message.from, message);
      }
    } catch (err) {
      console.error("Webhook error:", err);
      // still acknowledge below - Meta retries on non-200 responses
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  return new Response("Method not allowed.", { status: 405 });
});
