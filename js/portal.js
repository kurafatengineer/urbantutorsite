/* =====================================================================
   PORTAL LOGIN - "which door did you come in through?"

   One email can be a student, a tutor AND office staff. The browser only
   holds ONE login at a time, so without this a login through one door
   (say Student) silently worked in the others (Tutor profile, Admin panel)
   too - the page just saw "someone is logged in".

   Now every login is stamped with the door it was made at:
     UrbanPortal.set("student" | "tutor" | "admin")   after a successful code check
     UrbanPortal.allows("student" | "tutor" | "admin") true only if the
                       current login was made at THAT door

   Result: logging in as Student does NOT open the Tutor profile or the
   Admin panel - each asks for its own login. Only one door is open per
   browser at a time; logging in at another door replaces the first.

   Used by: studentregistration, tutorregistration, studentprofile,
   tutorprofile, advertisement and admin pages. Needs js/supabase-client.js.
   ===================================================================== */
(function () {

  const KEY = "urbantutorsite_portal";

  // the small "someone is logged in" flags the header / homepage read
  const FLAGS = {
    student: "urbantutorsite_student_session",
    tutor: "urbantutorsite_tutor_session"
  };

  async function currentUserId() {
    try {
      const { data } = await window.sb.auth.getSession();
      return data && data.session ? data.session.user.id : "";
    } catch (error) {
      return "";
    }
  }

  async function set(role) {
    const uid = await currentUserId();
    try {
      localStorage.setItem(KEY, JSON.stringify({ role: role, uid: uid }));
      // only the door just used stays marked as logged in
      Object.keys(FLAGS).forEach(r => {
        if (r !== role) localStorage.removeItem(FLAGS[r]);
      });
    } catch (error) { /* storage blocked: nothing to remember */ }
  }

  async function allows(role) {
    const uid = await currentUserId();
    if (!uid) return false;
    try {
      const stamp = JSON.parse(localStorage.getItem(KEY) || "null");
      return !!stamp && stamp.role === role && stamp.uid === uid;
    } catch (error) {
      return false;
    }
  }

  window.UrbanPortal = { set: set, allows: allows };

})();
