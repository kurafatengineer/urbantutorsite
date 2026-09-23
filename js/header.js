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

// Same Apps Script Web App as every other page. Used only to look up
// the logged-in user's NAME for the header initials, once, when it
// is not already known.
const HEADER_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwnhZnXpGVegX3kQtggtRjTej1JrsgfUdDyPrtMmuxh-IR_I8EGudmGAgLscda2y3nxLg/exec";

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
          href="student.html"
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
        : "student.html";

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
        : "student.html";

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

    loginButton.href = "student.html";

  }

}


/* =========================================================
   NEW: TUTOR SESSION CHECK
   =========================================================
   Read-only check against localStorage - the header never
   creates, verifies with the server, or clears a session.
   That stays entirely in tutorregistration.js / tutorprofile.js.
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
   Read-only, same as the tutor check above. student.js and
   studentprofile.js remain the only places that create,
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

    const response = await fetch(HEADER_WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: role === "tutor" ? "getTutorProfile" : "getStudentProfile",
        sessionToken: token
      })
    });

    const result = JSON.parse(await response.text());

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
