"use strict";

/*
 * =========================================================
 * HERO COMPONENT
 * =========================================================
 *
 * Responsibilities:
 *
 * 1. Display Hero content
 * 2. React to Student / Tutor selection
 *
 * This component does NOT:
 *
 * - Control the Toggle
 * - Handle Tutor API
 * - Handle Student API
 * - Handle Classes
 */


/* =========================================================
   HERO CONTENT
   ========================================================= */

const HERO_CONTENT = {

  student: {
    kicker: "FIND YOUR TUTOR",

    title: "Find your",

    highlight: "perfect tutor.",

    description:
      "Learn from qualified tutors who match your class, subject and learning needs."
  },


  tutor: {
    kicker: "JOIN AS A TUTOR",

    title: "Teach what",

    highlight: "you love.",

    description:
      "Create your tutor profile and connect with students who are looking for your expertise."
  }

};


/* =========================================================
   INITIALIZE
   ========================================================= */

function initializeHero() {

  /*
   * Listen for changes coming from Toggle.
   */

  window.addEventListener(
    "userTypeChanged",
    function (event) {

      const type =
        event.detail?.type || "student";

      updateHeroContent(type);

    }
  );


  /*
   * Set initial Hero state.
   */

  // FIX: start from whatever is actually selected (the toggle is
  // loaded before the hero, and a logged-in user has no toggle).
  const initialType =
    (window.UrbanSession && window.UrbanSession.role()) ||
    (window.ToggleComponent && window.ToggleComponent.getUserType && window.ToggleComponent.getUserType()) ||
    "student";

  updateHeroContent(initialType);

}


/* =========================================================
   UPDATE HERO
   ========================================================= */

function updateHeroContent(type) {

  const content =
    HERO_CONTENT[type] || HERO_CONTENT.student;


  const kicker =
    document.getElementById("heroKicker");

  const title =
    document.getElementById("heroTitle");

  const description =
    document.getElementById("heroDescription");


  if (!kicker || !title || !description) {
    return;
  }


  /* -------------------------------------------------------
     Kicker
     ------------------------------------------------------- */

  kicker.textContent =
    content.kicker;


  /* -------------------------------------------------------
     Title
     ------------------------------------------------------- */

  title.innerHTML =
    `${content.title} <span>${content.highlight}</span>`;


  /* -------------------------------------------------------
     Description
     ------------------------------------------------------- */

  description.textContent =
    content.description;

}


/* =========================================================
   PUBLIC API
   ========================================================= */

window.HeroComponent = {

  init: initializeHero,

  update: updateHeroContent

};
