/* =====================================================================
   SHARED HELPERS - used by several pages
   (student sign-up, student profile, tutor profile, tutor advertisement)

   These two small functions used to be copied into every page's own JS
   file. They live here once now - fix them here and every page gets the fix.

     escapeHTML(value)  Makes text safe to put inside HTML (stops a name like
                        "<script>" from being run as code). Always use it
                        when putting user-typed text into innerHTML.
     hasSession()       true if someone is logged in right now.
     hasPortalSession(role)  true only if that login was made at the
                        "student" / "tutor" door (see js/portal.js).
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

// Logged in AND through the right door? (a Student login must not open the
// Tutor profile, even when the email is the same - see js/portal.js)
async function hasPortalSession(role) {
  if (!window.UrbanPortal) return hasSession();
  return window.UrbanPortal.allows(role);
}
