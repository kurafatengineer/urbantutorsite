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
