"use strict";

/* =========================================================
   URBAN TUTOR SITE
   GLOBAL HEADER
   ========================================================= */


/* =========================================================
   HEADER COMPONENT
   ========================================================= */

const HEADER_COMPONENT =
  "components/header.html";

// The logged-in user's NAME for the header initials is looked up once,
// when not already known, from Supabase (get_tutor_profile /
// get_student_profile via window.sbCall - js/supabase-client.js).

const HEADER_NAME_CACHE_KEY = "urbantutorsite_header_name";


/* =========================================================
   INITIALIZE
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  loadHeader
);


/* =========================================================
   LOAD HEADER
   ========================================================= */

async function loadHeader() {

  const container =
    document.getElementById("site-header");


  /*
   * Header container does not exist
   * on this page.
   */

  if (!container) {
    return;
  }


  try {

    const response =
      await fetch(
        HEADER_COMPONENT,
        {
          method: "GET",
          cache: "no-cache"
        }
      );


    if (!response.ok) {

      throw new Error(
        "Header HTTP error: " +
        response.status
      );

    }


    const html =
      await response.text();


    if (!html.trim()) {

      throw new Error(
        "Header component is empty."
      );

    }


    container.innerHTML =
      html;


  } catch (error) {

    console.error(
      "Header loading error:",
      error
    );


    /*
     * Fallback header.
     *
     * If header.html fails to load,
     * the header will still appear.
     */

    container.innerHTML =
      createFallbackHeader();

  }


  initializeHeaderLogin();

  renderHeaderAvatar();

}


/* =========================================================
   FALLBACK HEADER
   ========================================================= */

function createFallbackHeader() {

  return `

    <header class="site-header">

      <div class="header-inner">

        <a
          href="index.html"
          class="site-logo"
          aria-label="UrbanTutorSite Home"
        >
          <span class="brand-urban">Urban</span><span class="brand-tutorsite">TutorSite</span>
        </a>


        <a
          href="studentregistration.html"
          id="headerLogin"
          class="header-login"
          aria-label="Login"
          title="Login"
        >

          <svg
            class="header-login-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >

            <circle
              cx="12"
              cy="8"
              r="3.2"
            />

            <path
              d="M5.5 20c.7-3.5 3-5.5 6.5-5.5s5.8 2 6.5 5.5"
            />

          </svg>

        </a>

      </div>

    </header>

  `;

}


/* =========================================================
   LOGIN INITIALIZATION
   ========================================================= */

function initializeHeaderLogin() {

  const loginButton =
    document.getElementById(
      "headerLogin"
    );


  if (!loginButton) {
    return;
  }


  /*
   * Set the correct initial destination.
   */

  updateLoginDestination();


  /*
   * Event delegation.
   *
   * This is important because the header
   * was inserted dynamically.
   */

  document.addEventListener(
    "click",
    handleHeaderClick,
    true
  );

}


/* =========================================================
   HANDLE HEADER / TOGGLE CLICKS
   ========================================================= */

function handleHeaderClick(event) {

  const loginButton =
    document.getElementById(
      "headerLogin"
    );


  if (!loginButton) {
    return;
  }


  const studentButton =
    event.target.closest(
      "#studentButton"
    );


  const tutorButton =
    event.target.closest(
      "#tutorButton"
    );


  const login =
    event.target.closest(
      "#headerLogin"
    );


  /*
   * Student selected
   */

  if (studentButton) {

    // NEW: logged-in student -> Student Profile page.
    loginButton.href =
      isLoggedInStudent_()
        ? "studentprofile.html"
        : "studentregistration.html";

    loginButton.title =
      isLoggedInStudent_() ? "My Profile" : "Login";

    return;
  }


  /*
   * Tutor selected
   */

  if (tutorButton) {

    // FIX: "tutor.html" does not exist in this project.
    loginButton.href =
      isLoggedInTutor_()
        ? "tutorprofile.html"
        : "tutorregistration.html";

    return;
  }


  /*
   * Login clicked.
   *
   * Re-check the selected toggle immediately
   * before navigation.
   */

  if (login) {

    updateLoginDestination();

  }

}


/* =========================================================
   UPDATE LOGIN DESTINATION
   ========================================================= */

function updateLoginDestination() {

  const loginButton =
    document.getElementById(
      "headerLogin"
    );


  if (!loginButton) {
    return;
  }


  // Admin Panel: the header badge is a plain "AD" label, never a link.
  if (isAdminPage_()) {
    loginButton.removeAttribute("href");
    return;
  }


  const studentButton =
    document.getElementById(
      "studentButton"
    );


  const tutorButton =
    document.getElementById(
      "tutorButton"
    );


  /*
   * Tutor selected
   */

  if (
    tutorButton &&
    tutorButton.classList.contains(
      "active"
    )
  ) {

    // FIX: "tutor.html" does not exist in this project.
    loginButton.href =
      isLoggedInTutor_()
        ? "tutorprofile.html"
        : "tutorregistration.html";

    loginButton.title =
      isLoggedInTutor_() ? "My Profile" : "Login";

    return;
  }


  /*
   * Student selected
   */

  if (
    studentButton &&
    studentButton.classList.contains(
      "active"
    )
  ) {

    // NEW: logged-in student -> Student Profile page.
    loginButton.href =
      isLoggedInStudent_()
        ? "studentprofile.html"
        : "studentregistration.html";

    loginButton.title =
      isLoggedInStudent_() ? "My Profile" : "Login";

    return;
  }


  /*
   * Default (pages without the Student / Tutor toggle).
   * NEW: a logged-in student goes to their Student Profile.
   * If both a tutor and a student are signed in on this
   * device, the most recent login wins.
   */

  const lastLogin = lastLoginType_();

  if (isLoggedInStudent_() && (lastLogin === "student" || !isLoggedInTutor_())) {

    loginButton.href = "studentprofile.html";
    loginButton.title = "My Profile";

  } else if (isLoggedInTutor_()) {

    loginButton.href = "tutorprofile.html";
    loginButton.title = "My Profile";

  } else {

    loginButton.href = "studentregistration.html";

  }

}


/* =========================================================
   NEW: TUTOR SESSION CHECK
   =========================================================
   Read-only check against localStorage - the header never
   creates, verifies with the server, or clears a session.
   That stays entirely in tutor-registration.js / tutor-profile.js.
   ========================================================= */

function isLoggedInTutor_() {

  try {
    return !!localStorage.getItem("urbantutorsite_tutor_session");
  } catch (error) {
    return false;
  }

}


/* =========================================================
   NEW: STUDENT SESSION CHECK
   =========================================================
   Read-only, same as the tutor check above. studentregistration.js and
   student-profile.js remain the only places that create,
   verify, or clear a student session.
   ========================================================= */

function isLoggedInStudent_() {

  try {
    return !!localStorage.getItem("urbantutorsite_student_session");
  } catch (error) {
    return false;
  }

}


function lastLoginType_() {

  try {
    return sessionStorage.getItem("urbantutorsite_last_login") || "";
  } catch (error) {
    return "";
  }

}



/* =========================================================
   NEW: WHO IS LOGGED IN  (shared by every page)
   =========================================================
   window.UrbanSession.role() -> "student" | "tutor" | ""

   One role at a time: if both a tutor and a student session exist
   on this device, the most recent login wins (same rule the header
   already used for its link).
   ========================================================= */

window.UrbanSession = {

  role: function () {

    const student = isLoggedInStudent_();
    const tutor = isLoggedInTutor_();

    if (student && (lastLoginType_() === "student" || !tutor)) return "student";
    if (tutor) return "tutor";

    return "";

  },

  readSession: function (role) {

    try {
      const raw = localStorage.getItem(
        role === "tutor" ? "urbantutorsite_tutor_session" : "urbantutorsite_student_session"
      );
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }

  },

  // Profile pages call this when they know the name, so the header
  // shows the right initials straight away.
  rememberName: function (role, name) {

    const session = this.readSession(role);

    if (!session || !session.sessionToken || !name) return;

    try {
      localStorage.setItem(HEADER_NAME_CACHE_KEY, JSON.stringify({
        role: role,
        token: session.sessionToken,
        name: String(name)
      }));
    } catch (ignore) {}

    renderHeaderAvatar();

  }

};


/* =========================================================
   NEW: HEADER AVATAR  (logged-in user's initials)
   ========================================================= */

// The Admin Panel's badge shows the signed-in employee's initials (set by
// admin.js once it knows who that is); "AD" until then. Still not clickable.
let adminInitials_ = "AD";

window.setAdminHeaderInitials = function (name) {
  adminInitials_ = initialsFromName_(name) || "AD";
  const button = document.getElementById("headerLogin");
  if (!button) return;
  setHeaderInitials_(button, adminInitials_);
  button.setAttribute("aria-label", "Admin");
};

function isAdminPage_() {
  return !!(document.body && document.body.dataset.page === "admin");
}

// Student/Tutor profile pages call this with "paid" | "partial" | "unpaid" |
// "" once they know how much of the signed-in student/tutor's subscription
// has been paid, so the header avatar shows the same verified badge as
// the profile page's.
let headerBadgeTone_ = "";

window.setHeaderAvatarBadge = function (tone) {
  headerBadgeTone_ = tone || "";
  const button = document.getElementById("headerLogin");
  if (button) setHeaderBadge_(button, headerBadgeTone_);
};

function setHeaderBadge_(button, tone) {

  const existing = button.querySelector(".header-sub-badge");
  if (existing) existing.remove();

  if (!tone) return;

  const title = tone === "paid" ? "Subscription fully paid" : tone === "partial" ? "Subscription partially paid" : "Subscription not paid";

  button.insertAdjacentHTML("beforeend", `
    <span class="header-sub-badge" data-tone="${tone}" title="${title}">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/>
      </svg>
    </span>
  `);

}

function initialsFromName_(name) {

  return String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join("");

}

function cachedHeaderName_(role, token) {

  try {
    const raw = localStorage.getItem(HEADER_NAME_CACHE_KEY);
    const data = raw ? JSON.parse(raw) : null;

    if (data && data.role === role && data.token === token) return data.name;
  } catch (ignore) {}

  return "";

}

async function renderHeaderAvatar() {

  const button = document.getElementById("headerLogin");

  if (!button) return;

  // Re-apply whatever badge tone was last set, since the header markup
  // may just have been (re)inserted into the page.
  setHeaderBadge_(button, headerBadgeTone_);

  // Admin Panel: the employee's initials ("AD" until known), not clickable.
  if (isAdminPage_()) {

    // the UrbanTutorSite logo does nothing on the Admin Panel
    document.querySelectorAll(".site-logo").forEach(function (logo) {
      logo.removeAttribute("href");
      logo.setAttribute("aria-disabled", "true");
      logo.style.cursor = "default";
      logo.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
      }, true);
    });

    setHeaderInitials_(button, adminInitials_);

    button.removeAttribute("href");
    button.setAttribute("aria-label", "Admin");
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("tabindex", "-1");
    button.removeAttribute("title");
    button.classList.add("header-login-static");

    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
    }, true);

    return;

  }

  const role = window.UrbanSession.role();

  if (!role) {
    setHeaderInitials_(button, "");
    return;
  }

  const session = window.UrbanSession.readSession(role) || {};
  const token = session.sessionToken || "";

  let name =
    cachedHeaderName_(role, token) ||
    (role === "tutor" && session.profile && session.profile.fullName) || "";

  setHeaderInitials_(button, initialsFromName_(name));

  if (name || !token) return;

  // Not known yet (e.g. first page after a student login): ask once.
  try {

    // Pages that don't load Supabase simply keep the plain icon.
    if (typeof window.sbCall !== "function") return;

    const result = await window.sbCall(
      role === "tutor" ? "get_tutor_profile" : "get_student_profile", {}
    );

    if (!result || !result.success) return;

    if (role === "tutor") {
      name = result.profile && result.profile.fullName;
    } else {
      let selected = "";
      try { selected = localStorage.getItem("urbantutorsite_selected_student") || ""; } catch (ignore) {}
      const list = result.students || [];
      const pick = list.find(s => s.studentId === selected) || list[0];
      name = pick && pick.studentName;
    }

    if (name) window.UrbanSession.rememberName(role, name);

  } catch (error) {
    console.warn("Header avatar:", error);
  }

}

function setHeaderInitials_(button, initials) {

  if (isAdminPage_() && initials !== adminInitials_) return;


  let badge = button.querySelector(".header-initials");
  const icon = button.querySelector(".header-login-icon");

  if (!initials) {
    if (badge) badge.remove();
    if (icon) icon.style.display = "";
    button.classList.remove("has-initials");
    return;
  }

  if (!badge) {
    badge = document.createElement("span");
    badge.className = "header-initials";
    badge.setAttribute("aria-hidden", "true");
    button.appendChild(badge);
  }

  badge.textContent = initials;

  if (icon) icon.style.display = "none";

  button.classList.add("has-initials");
  button.setAttribute("aria-label", "My Profile");

}
