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

  const { data, error } = await window.sb.rpc(fnName, args || {});

  if (error) {

    // A function we wrote with "raise exception '...'" arrives
    // here as error.message - show that text to the person.
    return { success: false, message: error.message };

  }

  // Our functions already return {success: true, ...} themselves.
  return data;

};
