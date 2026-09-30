/* =========================================================
   SHARED SUPABASE CONNECTION
   File: js/supabase-client.js

   Every page that talks to Supabase includes this file (after
   the Supabase library, before its own script). It creates ONE
   shared client, window.sb, that:
     - keeps the person logged in across pages/tabs
     - automatically attaches their login to every request, so
       Supabase's security rules can tell who is asking

   The two values below are SAFE to be public: the URL and the
   "publishable" key only let someone do what the Row Level
   Security rules on the database allow - never more. They are
   the website's equivalent of your Apps Script's public web app
   URL.
========================================================= */

const SUPABASE_URL = "https://zbvtdcqoouwyrcxkzjfv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_HW0yD0ilgbwDCsLJByrvbQ_AvxmNBI6";

window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

/* -----------------------------------------------------------
   Small helper: call an RPC function and always get back a
   plain {success, message, ...} object, the same shape every
   page already expects from the old Apps Script API - so the
   rest of a page's code barely has to change.
----------------------------------------------------------- */
window.sbCall = async function (fnName, args) {

  // A phone/tablet that has been idle or in the background often drops
  // the first request ("TypeError: Load failed" on Safari, "Failed to
  // fetch" elsewhere) - the connection is simply gone, not the login.
  // Retry a couple of times, waking the session up in between, before
  // calling it a network problem.
  let result;

  for (let attempt = 0; attempt < 3; attempt++) {

    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, attempt * 700));
      try { await window.sb.auth.getSession(); } catch (e) { /* ignore */ }
    }

    result = await window.sb.rpc(fnName, args || {});

    if (!result.error || !isNetworkError_(result.error)) break;

  }

  const { data, error } = result;

  if (error) {

    if (isNetworkError_(error)) {
      return {
        success: false,
        networkError: true,
        message: "Could not reach the server. Please check your connection and try again."
      };
    }

    // A function we wrote with "raise exception '...'" arrives
    // here as error.message - show that text to the person.
    return { success: false, message: error.message };

  }

  // Our functions already return {success: true, ...} themselves.
  return data;

};

function isNetworkError_(error) {
  const text = String((error && (error.message || error.details)) || error || "");
  return /load failed|failed to fetch|networkerror|network request failed|fetch failed/i.test(text);
}

/* -----------------------------------------------------------
   Small helper: like sbCall, but goes through the "actions"
   Edge Function instead of calling the database function
   directly, so a notification email can be sent to the other
   party (student/tutor) after the action succeeds. Use this
   only for the handful of actions the Edge Function wraps
   (see supabase/functions/actions/index.ts); everything else
   keeps using sbCall as before.
----------------------------------------------------------- */
const ACTIONS_FUNCTION_URL =
  "https://zbvtdcqoouwyrcxkzjfv.supabase.co/functions/v1/actions";

window.sbCallNotify = async function (action, args) {

  let token = "";
  try {
    const { data } = await window.sb.auth.getSession();
    token = (data && data.session && data.session.access_token) || "";
  } catch (e) {
    // fall through with no token - the function will reject with a
    // clear "please log in first" message
  }

  try {

    const response = await fetch(ACTIONS_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify(Object.assign({ action: action }, args || {}))
    });

    const raw = await response.text();
    return JSON.parse(raw);

  } catch (e) {
    return { success: false, message: "Could not reach the server. Please try again." };
  }

};
