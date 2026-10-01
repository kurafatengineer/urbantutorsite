/* =====================================================================
   SHARED HELPERS - used by several pages
   (student sign-up, student profile, tutor profile, tutor advertisement)

   These two small functions used to be copied into every page's own JS
   file. They live here once now - fix them here and every page gets the fix.

     escapeHTML(value)  Makes text safe to put inside HTML (stops a name like
                        "<script>" from being run as code). Always use it
                        when putting user-typed text into innerHTML.
     hasSession()       true if someone is logged in right now.
   ===================================================================== */

function escapeHTML(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function hasSession() {
  try {
    const { data: { session } } = await window.sb.auth.getSession();
    return !!session;
  } catch (error) {
    console.error("Session check error:", error);
    return false;
  }
}
