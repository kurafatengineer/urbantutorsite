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

    loginButton.href =
      "student.html";

    return;
  }


  /*
   * Tutor selected
   */

  if (tutorButton) {

    loginButton.href =
      "tutor.html";

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

    loginButton.href =
      "tutor.html";

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

    loginButton.href =
      "student.html";

    return;
  }


  /*
   * Default
   */

  loginButton.href =
    "student.html";

}
