"use strict";


/* =========================================================
   OUR TUTORS COMPONENT
   =========================================================

   File:
   homepage/tutors/tutors.js

   Responsibilities:
   - Fetch tutors from Google Apps Script
   - Display loading state
   - Display empty state
   - Create tutor cards
   - Display tutor information
   - Responsive card count
   - Previous / Next navigation
   - Circular carousel
   - Tutor navigation dots
   - Automatic rotation
   - Placeholder profile image

   This file should contain ONLY Tutor-section logic.

   It does NOT handle:
   - Header
   - Footer
   - Toggle
   - Hero
   - Students
   - Classes
   ========================================================= */



/* =========================================================
   01. CONFIGURATION
   ========================================================= */


/*
 * Google Apps Script Web App endpoint.
 *
 * This is the same endpoint used by the original
 * Tutor section.
 */
const TUTORS_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbzuQGM24P9Lf6wySxhnDMGY1dwYP_6oEhVKXyn77ZS1Ou2icNEkYShyYnF6NxS8toExuw/exec";



/*
 * Automatic carousel rotation interval.
 *
 * Original behavior:
 * 6 seconds.
 */
const TUTOR_ROTATION_INTERVAL = 6000;



/* =========================================================
   02. COMPONENT STATE
   ========================================================= */


/*
 * Array containing all tutors returned by the API.
 */
let tutors = [];


/*
 * Index of the currently active tutor.
 */
let currentTutorIndex = 0;


/*
 * Stores the automatic rotation timer.
 */
let rotationTimer = null;


/*
 * Stores the resize debounce timer.
 */
let resizeTimer = null;



/* =========================================================
   03. COMPONENT ELEMENTS
   ========================================================= */


/*
 * These elements exist inside tutors.html.
 *
 * They are deliberately looked up when the component
 * initializes because tutors.html is loaded dynamically.
 */

let loadingCard = null;

let tutorGrid = null;

let noTutors = null;

let tutorControls = null;

let tutorCounter = null;

let tutorDots = null;

let previousTutor = null;

let nextTutor = null;



/* =========================================================
   04. INITIALIZE TUTOR COMPONENT
   ========================================================= */


/*
 * Public initialization function.
 *
 * homepage.js will call:
 *
 *     window.TutorsComponent.init();
 *
 * after tutors.html has been inserted into the page.
 */
function initializeTutors() {


  /*
   * Find Tutor component elements.
   */
  loadingCard =
    document.getElementById("loadingCard");

  tutorGrid =
    document.getElementById("tutorGrid");

  noTutors =
    document.getElementById("noTutors");

  tutorControls =
    document.getElementById("tutorControls");

  tutorCounter =
    document.getElementById("tutorCounter");

  tutorDots =
    document.getElementById("tutorDots");

  previousTutor =
    document.getElementById("previousTutor");

  nextTutor =
    document.getElementById("nextTutor");


  /*
   * Verify required elements.
   */
  if (
    !loadingCard ||
    !tutorGrid ||
    !noTutors ||
    !tutorControls ||
    !tutorCounter ||
    !tutorDots ||
    !previousTutor ||
    !nextTutor
  ) {

    console.error(
      "Tutors component: required elements were not found."
    );

    return;

  }


  /*
   * Previous button.
   */
  previousTutor.addEventListener(
    "click",
    showPreviousTutor
  );


  /*
   * Next button.
   */
  nextTutor.addEventListener(
    "click",
    showNextTutor
  );


  /*
   * Responsive behavior.
   *
   * When the browser width changes, the number of
   * visible tutor cards may need to change:
   *
   * Desktop  = 3
   * Tablet   = 2
   * Mobile   = 1
   */
  window.addEventListener(
    "resize",
    handleResize
  );


  /*
   * Load tutors from the API.
   */
  loadTutors();

}



/* =========================================================
   05. LOAD TUTORS FROM GOOGLE APPS SCRIPT
   ========================================================= */

async function loadTutors() {

  try {


    /*
     * Request tutor data.
     */
    const response =
      await fetch(
        TUTORS_WEB_APP_URL +
        "?action=getTutors",
        {
          method: "GET"
        }
      );


    /*
     * Check HTTP response.
     */
    if (!response.ok) {

      throw new Error(
        "HTTP " + response.status
      );

    }


    /*
     * Convert response to JSON.
     */
    const result =
      await response.json();


    /*
     * Check API success response.
     */
    if (!result.success) {

      throw new Error(
        result.message ||
        "Unable to load tutors."
      );

    }


    /*
     * Store tutors safely.
     */
    tutors =
      Array.isArray(result.tutors)
        ? result.tutors
        : [];


    /*
     * Hide loading state.
     */
    loadingCard.classList.add("hidden");


    /*
     * No tutors available.
     */
    if (!tutors.length) {

      tutorGrid.classList.add("hidden");

      noTutors.classList.remove("hidden");

      tutorControls.classList.add("hidden");

      tutorCounter.textContent =
        "0 / 0";

      return;

    }


    /*
     * Tutors are available.
     */
    noTutors.classList.add("hidden");

    tutorGrid.classList.remove("hidden");

    currentTutorIndex = 0;


    /*
     * Create navigation dots.
     */
    createDots();


    /*
     * Render first group of tutors.
     */
    renderTutorCarousel();


    /*
     * Start automatic rotation.
     */
    startRotation();


  } catch (error) {


    /*
     * Log the actual error for debugging.
     */
    console.error(
      "Tutor loading error:",
      error
    );


    /*
     * Hide loading state.
     */
    loadingCard.classList.add("hidden");


    /*
     * Hide Tutor cards.
     */
    tutorGrid.classList.add("hidden");


    /*
     * Show empty/error state.
     */
    noTutors.classList.remove("hidden");


    /*
     * Hide carousel controls.
     */
    tutorControls.classList.add("hidden");


    /*
     * Update counter.
     */
    tutorCounter.textContent =
      "Unable to load";

  }

}



/* =========================================================
   06. RESPONSIVE CARD COUNT
   ========================================================= */


/*
 * Determines how many Tutor cards should be visible.
 *
 * Desktop:
 *   3 cards
 *
 * Tablet:
 *   2 cards
 *
 * Mobile:
 *   1 card
 */
function getCardsPerPage() {


  /*
   * Desktop.
   */
  if (window.innerWidth >= 1050) {

    return Math.min(
      3,
      tutors.length
    );

  }


  /*
   * Tablet.
   */
  if (window.innerWidth >= 700) {

    return Math.min(
      2,
      tutors.length
    );

  }


  /*
   * Mobile.
   */
  return Math.min(
    1,
    tutors.length
  );

}



/* =========================================================
   07. CIRCULAR INDEX
   ========================================================= */


/*
 * Keeps the carousel index inside the tutor array.
 *
 * Example:
 *
 * Tutors = 4
 *
 * index 4 → 0
 * index 5 → 1
 * index -1 → 3
 */
function circularIndex(index) {

  const total =
    tutors.length;


  if (!total) {

    return 0;

  }


  return (
    (index % total) +
    total
  ) % total;

}



/* =========================================================
   08. GET VISIBLE TUTORS
   ========================================================= */


/*
 * Creates a circular window of tutors.
 *
 * Example with 4 tutors and 3 visible cards:
 *
 * 1 2 3
 * 2 3 4
 * 3 4 1
 * 4 1 2
 *
 * This prevents the last slide from containing
 * blank spaces.
 */
function getVisibleTutors() {

  const count =
    getCardsPerPage();

  const visibleTutors = [];


  for (
    let offset = 0;
    offset < count;
    offset++
  ) {

    visibleTutors.push(
      tutors[
        circularIndex(
          currentTutorIndex + offset
        )
      ]
    );

  }


  return visibleTutors;

}



/* =========================================================
   09. RENDER TUTOR CAROUSEL
   ========================================================= */

function renderTutorCarousel() {


  /*
   * Nothing to render.
   */
  if (!tutors.length) {

    return;

  }


  /*
   * Clear previous cards.
   */
  tutorGrid.innerHTML = "";


  /*
   * Get the current visible Tutor group.
   */
  const visibleTutors =
    getVisibleTutors();


  /*
   * Create each Tutor card.
   */
  visibleTutors.forEach(
    function (tutor) {

      tutorGrid.appendChild(
        createTutorCard(tutor)
      );

    }
  );


  /*
   * If only one Tutor exists,
   * hide carousel controls.
   */
  if (tutors.length <= 1) {

    tutorControls.classList.add(
      "hidden"
    );

  } else {

    tutorControls.classList.remove(
      "hidden"
    );

  }


  /*
   * Update counter.
   *
   * Example:
   * 1 / 5
   * 2 / 5
   */
  tutorCounter.textContent =
    `${currentTutorIndex + 1} / ${tutors.length}`;


  /*
   * Update active navigation dot.
   */
  updateDots();

}



/* =========================================================
   10. CREATE TUTOR CARD
   ========================================================= */

function createTutorCard(tutor) {


  /*
   * Main card.
   */
  const card =
    document.createElement("article");

  card.className =
    "tutor-card";


  /* -------------------------------------------------------
     Tutor Image Area
     ------------------------------------------------------- */

  const imageArea =
    document.createElement("div");

  imageArea.className =
    "tutor-image-area";


  /*
   * Tutor profile image.
   */
  const image =
    document.createElement("img");


  image.src =
    tutor.profileImage ||
    createPlaceholderImage();


  image.alt =
    getTutorName(tutor) +
    " profile";


  /*
   * Allow browser to lazy-load images.
   */
  image.loading =
    "lazy";


  /*
   * If the Tutor image fails,
   * replace it with the placeholder.
   */
  image.addEventListener(
    "error",
    function () {

      image.src =
        createPlaceholderImage();

    },
    {
      once: true
    }
  );



  /* -------------------------------------------------------
     Image Overlay
     ------------------------------------------------------- */

  const overlay =
    document.createElement("div");

  overlay.className =
    "tutor-card-overlay";



  /* -------------------------------------------------------
     Tutor Name Row
     ------------------------------------------------------- */

  const nameRow =
    document.createElement("div");

  nameRow.className =
    "tutor-name-row";


  /*
   * Tutor name.
   */
  const name =
    document.createElement("div");

  name.className =
    "tutor-title";

  name.textContent =
    getTutorName(tutor);


  /*
   * Verified badge.
   */
  const badge =
    document.createElement("span");

  badge.className =
    "verified-badge";

  badge.textContent =
    "✓";

  badge.setAttribute(
    "aria-label",
    "Verified tutor"
  );

  badge.title =
    "Verified tutor";


  /*
   * Add name + badge.
   */
  nameRow.appendChild(name);

  nameRow.appendChild(badge);



  /* -------------------------------------------------------
     Tutor Role
     ------------------------------------------------------- */

  const role =
    document.createElement("div");

  role.className =
    "tutor-role";

  role.textContent =
    cleanValue(
      tutor.registerAs
    ) || "Tutor";


  /*
   * Add overlay content.
   */
  overlay.appendChild(nameRow);

  overlay.appendChild(role);


  /*
   * Add image + overlay.
   */
  imageArea.appendChild(image);

  imageArea.appendChild(overlay);



  /* -------------------------------------------------------
     Tutor Information
     ------------------------------------------------------- */

  const information =
    document.createElement("div");

  information.className =
    "tutor-information";



  /* -------------------------------------------------------
     Experience
     ------------------------------------------------------- */

  const experience =
    document.createElement("div");

  experience.className =
    "detail-row experience-row";


  addDetailRow(
    experience,
    "Experience",
    formatExperience(
      tutor.experience
    )
  );


  information.appendChild(
    experience
  );



  /* -------------------------------------------------------
     Qualification
     ------------------------------------------------------- */

  const qualificationBlock =
    document.createElement("div");

  qualificationBlock.className =
    "qualification-section professional-block";


  /*
   * Qualification heading.
   */
  const qualificationLabel =
    document.createElement("div");

  qualificationLabel.className =
    "block-label";

  qualificationLabel.textContent =
    "QUALIFICATION (GRADUATION)";


  qualificationBlock.appendChild(
    qualificationLabel
  );


  /*
   * Course.
   */
  addDetailRow(
    qualificationBlock,
    "Course",
    cleanValue(
      tutor.graduationCourse
    )
  );


  /*
   * Stream / Subject.
   */
  addDetailRow(
    qualificationBlock,
    "Stream",
    cleanValue(
      tutor.graduationSubject
    )
  );


  /*
   * College / University.
   */
  addDetailRow(
    qualificationBlock,
    "College",
    cleanValue(
      tutor.graduationUniversity
    )
  );


  information.appendChild(
    qualificationBlock
  );



  /* -------------------------------------------------------
     Location
     ------------------------------------------------------- */

  const locationValue =
    cleanValue(
      tutor.location
    ) ||
    cleanValue(
      tutor.city
    );


  if (locationValue) {

    const locationBlock =
      document.createElement("div");

    locationBlock.className =
      "location-detail professional-block";


    addDetailRow(
      locationBlock,
      "Location",
      locationValue
    );


    information.appendChild(
      locationBlock
    );

  }



  /* -------------------------------------------------------
     Subjects
     ------------------------------------------------------- */

  appendTagBlock(
    information,
    "SUBJECTS",
    tutor.subjects
  );



  /* -------------------------------------------------------
     Classes
     ------------------------------------------------------- */

  appendTagBlock(
    information,
    "CLASSES",
    tutor.classes
  );



  /* -------------------------------------------------------
     Boards
     ------------------------------------------------------- */

  appendTagBlock(
    information,
    "BOARDS",
    tutor.boards
  );



  /* -------------------------------------------------------
     Special Courses
     ------------------------------------------------------- */

  appendTagBlock(
    information,
    "SPECIAL COURSES",
    tutor.specialCourses
  );



  /* -------------------------------------------------------
     Complete Card
     ------------------------------------------------------- */

  card.appendChild(
    imageArea
  );

  card.appendChild(
    information
  );


  return card;

}



/* =========================================================
   11. GET TUTOR NAME
   ========================================================= */

function getTutorName(tutor) {

  const firstName =
    cleanValue(
      tutor.firstName
    );

  const lastName =
    cleanValue(
      tutor.lastName
    );


  /*
   * Combine first + last name.
   */
  const name =
    [
      firstName,
      lastName
    ]
      .filter(
        function (part) {
          return part.length > 0;
        }
      )
      .join(" ");


  /*
   * Fallback to tutor.name.
   */
  return (
    name ||
    cleanValue(tutor.name) ||
    "Professional Tutor"
  );

}



/* =========================================================
   12. CREATE DETAIL ROW
   ========================================================= */

function addDetailRow(
  container,
  labelText,
  valueText
) {


  /*
   * Main row.
   */
  const row =
    document.createElement("div");

  row.className =
    "detail-line";


  /*
   * Label.
   */
  const label =
    document.createElement("span");

  label.className =
    "detail-label";

  label.textContent =
    labelText;


  /*
   * Dotted separator.
   */
  const dots =
    document.createElement("span");

  dots.className =
    "detail-dots";

  dots.setAttribute(
    "aria-hidden",
    "true"
  );


  /*
   * Value.
   */
  const value =
    document.createElement("span");

  value.className =
    "detail-value";

  value.textContent =
    valueText || "—";


  /*
   * Assemble row.
   */
  row.appendChild(label);

  row.appendChild(dots);

  row.appendChild(value);


  /*
   * Add row to parent.
   */
  container.appendChild(row);

}



/* =========================================================
   13. CREATE TAG BLOCK
   ========================================================= */

function appendTagBlock(
  container,
  title,
  rawValue
) {


  /*
   * Convert API value into an array.
   */
  const values =
    splitValues(rawValue);


  /*
   * Nothing to display.
   */
  if (!values.length) {

    return;

  }


  /*
   * Main block.
   */
  const block =
    document.createElement("div");

  block.className =
    "professional-block";


  /*
   * Block heading.
   */
  const label =
    document.createElement("span");

  label.className =
    "block-label";

  label.textContent =
    title;


  /*
   * Tag container.
   */
  const list =
    document.createElement("div");

  list.className =
    "tag-list";


  /*
   * Limit tags to the same maximum
   * used by the original Tutor section.
   */
  values
    .slice(0, 12)
    .forEach(
      function (item) {

        const tag =
          document.createElement("span");

        tag.className =
          "tag";

        tag.textContent =
          item;

        list.appendChild(tag);

      }
    );


  /*
   * Assemble tag block.
   */
  block.appendChild(label);

  block.appendChild(list);

  container.appendChild(block);

}



/* =========================================================
   14. FORMAT EXPERIENCE
   ========================================================= */

function formatExperience(value) {

  const experience =
    cleanValue(value);


  /*
   * Empty experience.
   */
  if (!experience) {

    return "—";

  }


  /*
   * Avoid adding "Years" twice.
   */
  return (
    experience +
    (
      experience
        .toLowerCase()
        .includes("year")
        ? ""
        : " Years"
    )
  );

}



/* =========================================================
   15. SPLIT MULTIPLE VALUES
   ========================================================= */

function splitValues(value) {


  /*
   * Empty value.
   */
  if (
    value === undefined ||
    value === null
  ) {

    return [];

  }


  /*
   * Tutor API values may contain:
   *
   * commas
   * pipes
   * bullet characters
   */
  return String(value)

    .split(/[,|•]+/)

    .map(
      function (item) {

        return item.trim();

      }
    )

    .filter(
      function (item) {

        return item.length > 0;

      }
    );

}



/* =========================================================
   16. CLEAN API VALUE
   ========================================================= */

function cleanValue(value) {

  if (
    value === undefined ||
    value === null
  ) {

    return "";

  }


  return String(value).trim();

}



/* =========================================================
   17. NEXT TUTOR
   ========================================================= */

function showNextTutor() {


  /*
   * No need to rotate if fewer than
   * two tutors exist.
   */
  if (tutors.length < 2) {

    return;

  }


  /*
   * Move to next circular index.
   */
  currentTutorIndex =
    circularIndex(
      currentTutorIndex + 1
    );


  /*
   * Render new cards.
   */
  renderTutorCarousel();


  /*
   * Restart automatic timer.
   */
  restartRotation();

}



/* =========================================================
   18. PREVIOUS TUTOR
   ========================================================= */

function showPreviousTutor() {


  /*
   * No need to rotate if fewer than
   * two tutors exist.
   */
  if (tutors.length < 2) {

    return;

  }


  /*
   * Move backwards through the
   * circular Tutor list.
   */
  currentTutorIndex =
    circularIndex(
      currentTutorIndex - 1
    );


  /*
   * Render new cards.
   */
  renderTutorCarousel();


  /*
   * Restart automatic timer.
   */
  restartRotation();

}



/* =========================================================
   19. CREATE NAVIGATION DOTS
   ========================================================= */

function createDots() {


  /*
   * Clear existing dots.
   */
  tutorDots.innerHTML = "";


  /*
   * Create one dot per Tutor.
   */
  tutors.forEach(
    function (_, index) {


      const dot =
        document.createElement("span");


      dot.className =
        "tutor-dot";


      /*
       * Make the dot keyboard accessible.
       */
      dot.setAttribute(
        "role",
        "button"
      );


      dot.setAttribute(
        "tabindex",
        "0"
      );


      dot.setAttribute(
        "aria-label",
        "Show tutor " +
        (index + 1)
      );


      /*
       * Mouse / touch click.
       */
      dot.addEventListener(
        "click",
        function () {

          currentTutorIndex =
            index;

          renderTutorCarousel();

          restartRotation();

        }
      );


      /*
       * Keyboard accessibility.
       */
      dot.addEventListener(
        "keydown",
        function (event) {

          if (
            event.key === "Enter" ||
            event.key === " "
          ) {

            event.preventDefault();

            currentTutorIndex =
              index;

            renderTutorCarousel();

            restartRotation();

          }

        }
      );


      /*
       * Add dot.
       */
      tutorDots.appendChild(dot);

    }
  );

}



/* =========================================================
   20. UPDATE ACTIVE DOT
   ========================================================= */

function updateDots() {


  const dots =
    tutorDots.querySelectorAll(
      ".tutor-dot"
    );


  dots.forEach(
    function (dot, index) {

      dot.classList.toggle(
        "active",
        index === currentTutorIndex
      );

    }
  );

}



/* =========================================================
   21. START AUTOMATIC ROTATION
   ========================================================= */

function startRotation() {


  /*
   * Clear an existing timer first.
   */
  clearInterval(
    rotationTimer
  );


  /*
   * Don't rotate if there is only
   * one Tutor.
   */
  if (tutors.length < 2) {

    return;

  }


  /*
   * Rotate every 6 seconds.
   */
  rotationTimer =
    setInterval(
      function () {

        currentTutorIndex =
          circularIndex(
            currentTutorIndex + 1
          );

        renderTutorCarousel();

      },
      TUTOR_ROTATION_INTERVAL
    );

}



/* =========================================================
   22. RESTART AUTOMATIC ROTATION
   ========================================================= */

function restartRotation() {

  startRotation();

}



/* =========================================================
   23. RESPONSIVE RESIZE HANDLER
   ========================================================= */

function handleResize() {


  /*
   * Avoid rendering repeatedly while the
   * browser is being resized.
   */
  clearTimeout(
    resizeTimer
  );


  resizeTimer =
    setTimeout(
      function () {

        if (tutors.length) {

          renderTutorCarousel();

        }

      },
      150
    );

}



/* =========================================================
   24. PLACEHOLDER PROFILE IMAGE
   ========================================================= */


/*
 * Used when:
 *
 * - Tutor has no profile image
 * - Tutor image fails to load
 */
function createPlaceholderImage() {

  return (

    "data:image/svg+xml;charset=UTF-8," +

    encodeURIComponent(

      `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="600"
        height="600"
        viewBox="0 0 600 600"
      >

        <rect
          width="600"
          height="600"
          fill="#111111"
        />

        <circle
          cx="300"
          cy="230"
          r="90"
          fill="#222222"
        />

        <path
          d="
            M145 500
            C160 390 220 350 300 350
            C380 350 440 390 455 500
            Z
          "
          fill="#222222"
        />

      </svg>
      `

    )

  );

}



/* =========================================================
   25. PUBLIC COMPONENT API
   ========================================================= */


/*
 * Expose only the initialization function.
 *
 * homepage.js will use:
 *
 *     window.TutorsComponent.init();
 *
 * The internal Tutor functions remain private to this file.
 */
window.TutorsComponent = {

  init: initializeTutors

};
