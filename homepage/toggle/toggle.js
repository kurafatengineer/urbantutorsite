"use strict";

/*
 * =========================================================
 * TOGGLE COMPONENT
 * =========================================================
 *
 * Responsibilities:
 *
 * 1. Handle Student / Tutor selection
 * 2. Maintain the selected user type
 * 3. Update active button
 * 4. Update the Header login link
 * 5. Notify other components that the user type changed
 *
 * This component does NOT control:
 *
 * - Hero content
 * - Tutor section
 * - Student section
 * - Classes section
 */


/* =========================================================
   CONFIG
   ========================================================= */

const TOGGLE_STUDENT_LOGIN_URL = "student.html";

// FIX: there is no "tutor.html" file in this project - the
// real tutor login + registration page is "tutorregistration.html".
const TOGGLE_TUTOR_LOGIN_URL = "tutorregistration.html";


/* =========================================================
   STATE
   ========================================================= */

let selectedUserType = "student";


/* =========================================================
   INITIALIZE
   ========================================================= */

function initializeToggle() {

  const studentButton =
    document.getElementById("studentButton");

  const tutorButton =
    document.getElementById("tutorButton");


  if (!studentButton || !tutorButton) {
    console.warn(
      "Toggle component: buttons not found."
    );

    return;
  }


  /* -------------------------------------------------------
     Student
     ------------------------------------------------------- */

  studentButton.addEventListener("click", function () {

    setUserType("student");

  });


  /* -------------------------------------------------------
     Tutor
     ------------------------------------------------------- */

  tutorButton.addEventListener("click", function () {

    setUserType("tutor");

  });


  /* -------------------------------------------------------
     Initial state

     NEW: defaults to "student" exactly as before, UNLESS a
     tutor is currently signed in on this device, or just
     came straight from tutor login/registration - in which
     case the toggle opens on "Tutor" instead.
     ------------------------------------------------------- */

  setUserType(
    isLoggedInTutor_() ? "tutor" : "student"
  );

}


/* =========================================================
   NEW: TUTOR SESSION CHECK
   =========================================================
   Read-only check against localStorage/sessionStorage - this
   component never talks to the server. tutorregistration.js
   and tutorprofile.js remain the only places that create,
   verify, or clear a tutor session.
   ========================================================= */

function isLoggedInTutor_() {

  try {

    if (sessionStorage.getItem("urbantutorsite_last_login") === "tutor") {
      return true;
    }

    return !!localStorage.getItem("urbantutorsite_tutor_session");

  } catch (error) {
    return false;
  }

}


/* =========================================================
   SET USER TYPE
   ========================================================= */

function setUserType(type) {

  if (type !== "student" && type !== "tutor") {
    return;
  }


  selectedUserType = type;


  const studentButton =
    document.getElementById("studentButton");

  const tutorButton =
    document.getElementById("tutorButton");


  if (!studentButton || !tutorButton) {
    return;
  }


  /* -------------------------------------------------------
     Update active button
     ------------------------------------------------------- */

  const isStudent =
    selectedUserType === "student";

  const isTutor =
    selectedUserType === "tutor";


  studentButton.classList.toggle(
    "active",
    isStudent
  );

  tutorButton.classList.toggle(
    "active",
    isTutor
  );


  /* -------------------------------------------------------
     Accessibility
     ------------------------------------------------------- */

  studentButton.setAttribute(
    "aria-pressed",
    String(isStudent)
  );

  tutorButton.setAttribute(
    "aria-pressed",
    String(isTutor)
  );


  /* -------------------------------------------------------
     Update Header login link
     ------------------------------------------------------- */

  updateLoginLink();


  /* -------------------------------------------------------
     Notify other homepage components
     ------------------------------------------------------- */

  window.dispatchEvent(
    new CustomEvent("userTypeChanged", {
      detail: {
        type: selectedUserType
      }
    })
  );

}


/* =========================================================
   UPDATE LOGIN LINK
   ========================================================= */

function updateLoginLink() {

  const loginButton =
    document.getElementById("loginButton");


  if (!loginButton) {
    return;
  }


  loginButton.href =
    selectedUserType === "tutor"
      ? TOGGLE_TUTOR_LOGIN_URL
      : TOGGLE_STUDENT_LOGIN_URL;

}


/* =========================================================
   PUBLIC API
   =========================================================
   
   homepage.js can call:

       window.ToggleComponent.init();

   Other components can read:

       window.ToggleComponent.getUserType();

   ========================================================= */

window.ToggleComponent = {

  init: initializeToggle,

  getUserType: function () {
    return selectedUserType;
  },

  setUserType: setUserType

};
