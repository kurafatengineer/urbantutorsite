/* =========================================================
   TUTORS COMPONENT
   =========================================================

   File:
   homepage/tutors/tutors.js

   Purpose:
   - Loads Tutor data from the existing Google Apps Script API.
   - Creates Tutor cards dynamically.
   - Handles Tutor carousel.
   - Handles Tutor navigation.
   - Keeps all Tutor functionality inside this component.

   IMPORTANT:
   This file should NOT control:
   - Header
   - Footer
   - Hero
   - Toggle
   - Students
   - Classes

   ========================================================= */


"use strict";



/* =========================================================
   01. CONFIGURATION
   ========================================================= */

/*
 * Existing Tutor API.
 *
 * Keep your existing API URL here.
 */
const TUTOR_API_URL =
  "https://script.google.com/macros/s/AKfycbzuQGM24P9Lf6wySxhnDMGY1dwYP_6oEhVKXyn77ZS1Ou2icNEkYShyYnF6NxS8toExuw/exec";



/* =========================================================
   02. COMPONENT STATE
   ========================================================= */

let tutors = [];

let currentTutorIndex = 0;

let rotationTimer = null;

let resizeTimer = null;



/* =========================================================
   03. COMPONENT INITIALIZATION
   ========================================================= */

/*
 * The Homepage loader calls:

     TutorsComponent.init();

 * AFTER tutors.html has been loaded.

 * This is important because the Tutor elements do not exist
 * before tutors.html is inserted into the page.
 */

window.TutorsComponent = {

  init: function () {

    initializeTutors();

  }

};



/* =========================================================
   04. INITIALIZE TUTORS
   ========================================================= */

function initializeTutors() {

  /*
   * Load Tutor data from the API.
   */
  loadTutors();


  /*
   * Previous Tutor button.
   */
  const previousTutor =
    document.getElementById("previousTutor");

  if (previousTutor) {

    previousTutor.addEventListener(
      "click",
      showPreviousTutor
    );

  }


  /*
   * Next Tutor button.
   */
  const nextTutor =
    document.getElementById("nextTutor");

  if (nextTutor) {

    nextTutor.addEventListener(
      "click",
      showNextTutor
    );

  }


  /*
   * Recalculate card layout when the screen
   * changes size.
   */
  window.addEventListener(
    "resize",
    function () {

      clearTimeout(resizeTimer);

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
  );

}



/* =========================================================
   05. LOAD TUTORS
   ========================================================= */

async function loadTutors() {

  const loadingCard =
    document.getElementById("loadingCard");

  const tutorGrid =
    document.getElementById("tutorGrid");

  const noTutors =
    document.getElementById("noTutors");

  const tutorControls =
    document.getElementById("tutorControls");


  try {

    /*
     * Request Tutor data.
     */
    const response =
      await fetch(
        TUTOR_API_URL + "?action=getTutors",
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
     * Validate API response.
     */
    if (!result.success) {

      throw new Error(
        result.message ||
        "Unable to load tutors."
      );

    }


    /*
     * Store Tutor data.
     */
    tutors =
      Array.isArray(result.tutors)
        ? result.tutors
        : [];


    /*
     * Hide loading state.
     */
    if (loadingCard) {

      loadingCard.classList.add(
        "hidden"
      );

    }


    /*
     * No Tutor available.
     */
    if (!tutors.length) {

      if (tutorGrid) {

        tutorGrid.classList.add(
          "hidden"
        );

      }


      if (noTutors) {

        noTutors.classList.remove(
          "hidden"
        );

      }


      if (tutorControls) {

        tutorControls.classList.add(
          "hidden"
        );

      }


      return;

    }


    /*
     * Tutor data exists.
     */
    if (noTutors) {

      noTutors.classList.add(
        "hidden"
      );

    }


    if (tutorGrid) {

      tutorGrid.classList.remove(
        "hidden"
      );

    }


    /*
     * Start from first Tutor.
     */
    currentTutorIndex = 0;


    /*
     * Create carousel indicators.
     */
    createDots();


    /*
     * Render Tutor cards.
     */
    renderTutorCarousel();


    /*
     * Start automatic rotation.
     */
    startRotation();


  } catch (error) {

    console.error(
      "Tutor loading error:",
      error
    );


    /*
     * Hide loading state.
     */
    if (loadingCard) {

      loadingCard.classList.add(
        "hidden"
      );

    }


    /*
     * Show empty/error state.
     */
    if (tutorGrid) {

      tutorGrid.classList.add(
        "hidden"
      );

    }


    if (noTutors) {

      noTutors.classList.remove(
        "hidden"
      );

    }


    if (tutorControls) {

      tutorControls.classList.add(
        "hidden"
      );

    }

  }

}



/* =========================================================
   06. RESPONSIVE CARD COUNT
   ========================================================= */

function getCardsPerPage() {

  /*
   * Large desktop:
   * Show up to 3 cards.
   */
  if (window.innerWidth >= 1050) {

    return Math.min(
      3,
      tutors.length
    );

  }


  /*
   * Tablet:
   * Show up to 2 cards.
   */
  if (window.innerWidth >= 700) {

    return Math.min(
      2,
      tutors.length
    );

  }


  /*
   * Mobile:
   * Show 1 card.
   */
  return Math.min(
    1,
    tutors.length
  );

}



/* =========================================================
   07. CIRCULAR INDEX
   ========================================================= */

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

function getVisibleTutors() {

  const count =
    getCardsPerPage();

  const visibleTutors =
    [];


  for (
    let offset = 0;
    offset < count;
    offset++
  ) {

    visibleTutors.push(
      tutors[
        circularIndex(
          currentTutorIndex +
          offset
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

  const tutorGrid =
    document.getElementById("tutorGrid");

  const tutorControls =
    document.getElementById("tutorControls");


  if (!tutorGrid || !tutors.length) {

    return;

  }


  /*
   * Clear previous cards.
   */
  tutorGrid.innerHTML = "";


  /*
   * Create current Tutor cards.
   */
  getVisibleTutors().forEach(
    function (tutor) {

      tutorGrid.appendChild(
        createTutorCard(tutor)
      );

    }
  );


  /*
   * Hide controls if only one Tutor exists.
   */
  if (tutors.length <= 1) {

    if (tutorControls) {

      tutorControls.classList.add(
        "hidden"
      );

    }

  } else {

    if (tutorControls) {

      tutorControls.classList.remove(
        "hidden"
      );

    }

  }


  /*
   * Update navigation dots.
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
    "tutor-card card-animation";



  /* =======================================================
     IMAGE AREA
     ======================================================= */

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

  image.loading =
    "lazy";


  /*
   * Fallback image if the supplied image
   * cannot be loaded.
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



  /* =======================================================
     CARD IDENTITY AREA
     ======================================================= */

  const overlay =
    document.createElement("div");

  overlay.className =
    "tutor-card-overlay";



  /* =======================================================
     APPROVED BADGE
     =======================================================

     New design:

             APPROVED

             Rahul Kumar
             Part Time Tutor

     ======================================================= */

  const badge =
    document.createElement("span");

  badge.className =
    "verified-badge";

  badge.textContent =
    "✓ APPROVED";

  badge.setAttribute(
    "aria-label",
    "Approved tutor"
  );

  badge.title =
    "Approved tutor";



  /* =======================================================
     NAME
     ======================================================= */

  const nameRow =
    document.createElement("div");

  nameRow.className =
    "tutor-name-row";


  const name =
    document.createElement("div");

  name.className =
    "tutor-title";

  name.textContent =
    getTutorName(tutor);


  nameRow.appendChild(
    name
  );



  /* =======================================================
     TUTOR ROLE
     ======================================================= */

  const role =
    document.createElement("div");

  role.className =
    "tutor-role";

  role.textContent =
    cleanValue(
      tutor.registerAs
    ) ||
    "Tutor";



  /*
   * Add identity elements in the requested order:

       Approved
       Name
       Part Time Tutor

   */
  overlay.appendChild(
    badge
  );

  overlay.appendChild(
    nameRow
  );

  overlay.appendChild(
    role
  );



  /*
   * Put image and identity together.
   */
  imageArea.appendChild(
    image
  );

  imageArea.appendChild(
    overlay
  );



  /* =======================================================
     INFORMATION AREA
     ======================================================= */

  const information =
    document.createElement("div");

  information.className =
    "tutor-information";



  /* =======================================================
     EXPERIENCE
     ======================================================= */

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



  /* =======================================================
     QUALIFICATION
     ======================================================= */

  const qualificationBlock =
    document.createElement("div");

  qualificationBlock.className =
    "qualification-section professional-block";


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
   * Stream.
   */
  addDetailRow(
    qualificationBlock,
    "Stream",
    cleanValue(
      tutor.graduationSubject
    )
  );


  /*
   * College.
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



  /* =======================================================
     LOCATION
     ======================================================= */

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



  /* =======================================================
     OPTIONAL TAG BLOCKS
     ======================================================= */

  appendTagBlock(
    information,
    "SUBJECTS",
    tutor.subjects
  );


  appendTagBlock(
    information,
    "CLASSES",
    tutor.classes
  );


  appendTagBlock(
    information,
    "BOARDS",
    tutor.boards
  );


  appendTagBlock(
    information,
    "SPECIAL COURSES",
    tutor.specialCourses
  );



  /* =======================================================
     FINISH CARD
     ======================================================= */

  card.appendChild(
    imageArea
  );

  card.appendChild(
    information
  );


  return card;

}



/* =========================================================
   11. TUTOR NAME
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


  return (
    name ||
    cleanValue(tutor.name) ||
    "Professional Tutor"
  );

}



/* =========================================================
   12. DETAIL ROW
   =========================================================

   IMPORTANT:

   There is NO dotted separator anymore.

   Old:

       Label ........ Value

   New:

       Label          Value

   ========================================================= */

function addDetailRow(
  container,
  labelText,
  valueText
) {

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
   * Value.
   */
  const value =
    document.createElement("span");

  value.className =
    "detail-value";

  value.textContent =
    valueText ||
    "—";


  /*
   * IMPORTANT:
   *
   * We intentionally DO NOT create:
   *
   * const dots = ...
   *
   * The dotted separator has been removed.
   */

  row.appendChild(
    label
  );

  row.appendChild(
    value
  );


  container.appendChild(
    row
  );

}



/* =========================================================
   13. TAG BLOCK
   ========================================================= */

function appendTagBlock(
  container,
  title,
  rawValue
) {

  const values =
    splitValues(
      rawValue
    );


  if (!values.length) {

    return;

  }


  const block =
    document.createElement("div");

  block.className =
    "professional-block";


  const label =
    document.createElement("span");

  label.className =
    "block-label";

  label.textContent =
    title;


  const list =
    document.createElement("div");

  list.className =
    "tag-list";


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

        list.appendChild(
          tag
        );

      }
    );


  block.appendChild(
    label
  );

  block.appendChild(
    list
  );


  container.appendChild(
    block
  );

}



/* =========================================================
   14. CAROUSEL NAVIGATION
   ========================================================= */

function showNextTutor() {

  if (!tutors.length) {

    return;

  }


  currentTutorIndex =
    circularIndex(
      currentTutorIndex + 1
    );


  renderTutorCarousel();

}



/*
 * Previous Tutor.
 */
function showPreviousTutor() {

  if (!tutors.length) {

    return;

  }


  currentTutorIndex =
    circularIndex(
      currentTutorIndex - 1
    );


  renderTutorCarousel();

}



/* =========================================================
   15. AUTOMATIC ROTATION
   ========================================================= */

function startRotation() {

  stopRotation();


  /*
   * No need to rotate a single Tutor.
   */
  if (tutors.length <= 1) {

    return;

  }


  rotationTimer =
    setInterval(
      function () {

        showNextTutor();

      },
      6000
    );

}



/*
 * Stop existing timer.
 */
function stopRotation() {

  if (rotationTimer) {

    clearInterval(
      rotationTimer
    );

    rotationTimer =
      null;

  }

}



/* =========================================================
   16. CAROUSEL DOTS
   ========================================================= */

function createDots() {

  const tutorDots =
    document.getElementById(
      "tutorDots"
    );


  if (!tutorDots) {

    return;

  }


  tutorDots.innerHTML =
    "";


  tutors.forEach(
    function (_, index) {

      const dot =
        document.createElement(
          "span"
        );

      dot.className =
        "tutor-dot";


      if (
        index ===
        currentTutorIndex
      ) {

        dot.classList.add(
          "active"
        );

      }


      tutorDots.appendChild(
        dot
      );

    }
  );

}



/*
 * Update active dot.
 */
function updateDots() {

  const tutorDots =
    document.getElementById(
      "tutorDots"
    );


  if (!tutorDots) {

    return;

  }


  Array
    .from(
      tutorDots.children
    )
    .forEach(
      function (dot, index) {

        dot.classList.toggle(
          "active",
          index ===
          currentTutorIndex
        );

      }
    );

}



/* =========================================================
   17. CLEAN VALUE
   ========================================================= */

function cleanValue(value) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";

  }


  return String(value)
    .trim();

}



/* =========================================================
   18. EXPERIENCE FORMAT
   ========================================================= */

function formatExperience(value) {

  const cleaned =
    cleanValue(value);


  if (!cleaned) {

    return "—";

  }


  /*
   * If the API already contains "Years",
   * do not add it again.
   */
  if (
    /year/i.test(cleaned)
  ) {

    return cleaned;

  }


  return cleaned +
    (
      Number(cleaned) === 1
        ? " Year"
        : " Years"
    );

}



/* =========================================================
   19. SPLIT TAG VALUES
   ========================================================= */

function splitValues(value) {

  const cleaned =
    cleanValue(value);


  if (!cleaned) {

    return [];

  }


  return cleaned
    .split(
      /[,|]/g
    )
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
   20. PLACEHOLDER IMAGE
   ========================================================= */

function createPlaceholderImage() {

  /*
   * Simple SVG placeholder.
   *
   * This avoids depending on an external image.
   */

  const svg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 600 600"
    >

      <rect
        width="600"
        height="600"
        fill="#151515"
      />

      <circle
        cx="300"
        cy="230"
        r="90"
        fill="#222222"
      />

      <circle
        cx="300"
        cy="650"
        r="190"
        fill="#222222"
      />

    </svg>
  `;


  return (
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(svg)
  );

}
