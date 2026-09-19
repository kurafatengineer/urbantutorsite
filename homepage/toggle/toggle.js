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
const TOGGLE_TUTOR_LOGIN_URL = "tutor.html";


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
     ------------------------------------------------------- */

  setUserType("student");

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
