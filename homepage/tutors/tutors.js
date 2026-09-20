"use strict";

/* ============================================================
   URBANTUTORSITE
   TUTORS COMPONENT JAVASCRIPT

   File:
   homepage/tutors/tutors.js

   RESPONSIBILITY:
   ------------------------------------------------------------
   This file controls ONLY the Tutors section.

   It does NOT control:
   - Header
   - Footer
   - Toggle
   - Hero
   - Login
   - Student section

   The component is initialized from index.html using:

       window.TutorsComponent.init();

   ============================================================ */


/* ============================================================
   01. CONFIGURATION
   ============================================================ */

/*
 * Google Apps Script Web App URL.
 *
 * This is the same API previously used by the website
 * to retrieve approved tutors.
 */
const TUTORS_API_URL =
  "https://script.google.com/macros/s/AKfycbzuQGM24P9Lf6wySxhnDMGY1dwYP_6oEhVKXyn77ZS1Ou2icNEkYShyYnF6NxS8toExuw/exec";


/* ============================================================
   02. COMPONENT STATE
   ============================================================ */

/*
 * Stores all tutors received from the API.
 */
let tutors = [];


/*
 * Current starting position of the carousel.
 */
let currentTutorIndex = 0;


/*
 * Automatic carousel timer.
 */
let rotationTimer = null;


/*
 * Prevents the component from being initialized
 * multiple times accidentally.
 */
let tutorsInitialized = false;


/*
 * Used during window resizing.
 */
let resizeTimer = null;


/*
 * Prevents multiple animations from running
 * at the same time.
 */
let isAnimating = false;


/* ============================================================
   03. DOM ELEMENT REFERENCES
   ============================================================ */

/*
 * These variables are assigned only AFTER
 * tutors.html has been loaded.

 * This is important because tutors.html is dynamically
 * inserted into index.html.
 */

let tutorGrid = null;
let loadingCard = null;
let noTutors = null;
let tutorControls = null;
let tutorDots = null;
let previousTutor = null;
let nextTutor = null;


/* ============================================================
   04. PUBLIC COMPONENT
   ============================================================ */

/*
 * The index.html loader calls:

       window.TutorsComponent.init();

 * Therefore we expose the component globally.
 */

window.TutorsComponent = {

  init: function () {

    /*
     * Prevent duplicate initialization.
     */
    if (tutorsInitialized) {
      return;
    }

    tutorsInitialized = true;


    /*
     * Find all Tutor section elements
     * after tutors.html has been inserted.
     */
    cacheElements();


    /*
     * Verify that the essential Tutor elements
     * actually exist.
     */
    if (!tutorGrid) {

      console.error(
        "TutorsComponent: #tutorGrid was not found."
      );

      return;
    }


    /*
     * Attach button events.
     */
    bindEvents();


    /*
     * Load tutors from Google Apps Script.
     */
    loadTutors();

  }

};


/* ============================================================
   05. CACHE DOM ELEMENTS
   ============================================================ */

function cacheElements() {

  tutorGrid =
    document.getElementById("tutorGrid");


  loadingCard =
    document.getElementById("loadingCard");


  noTutors =
    document.getElementById("noTutors");


  tutorControls =
    document.getElementById("tutorControls");


  tutorDots =
    document.getElementById("tutorDots");


  previousTutor =
    document.getElementById("previousTutor");


  nextTutor =
    document.getElementById("nextTutor");

}


/* ============================================================
   06. EVENT BINDINGS
   ============================================================ */

function bindEvents() {

  /*
   * Previous button.
   */
  if (previousTutor) {

    previousTutor.addEventListener(
      "click",
      showPreviousTutor
    );

  }


  /*
   * Next button.
   */
  if (nextTutor) {

    nextTutor.addEventListener(
      "click",
      showNextTutor
    );

  }


  /*
   * Responsive resize handling.
   *
   * We wait briefly before recalculating the cards.
   * This prevents excessive rendering while the
   * browser is being resized.
   */
  window.addEventListener(
    "resize",
    handleResize
  );

}


/* ============================================================
   07. HANDLE WINDOW RESIZE
   ============================================================ */

function handleResize() {

  clearTimeout(resizeTimer);


  resizeTimer = setTimeout(
    function () {

      if (!tutors.length) {
        return;
      }


      /*
       * Re-render using the new number of
       * cards that fit the screen.
       */
      renderTutorCarousel(false);

    },
    180
  );

}


/* ============================================================
   08. LOAD TUTORS FROM API
   ============================================================ */

async function loadTutors() {

  try {

    /*
     * Keep the loading state visible while
     * the API request is running.
     */
    showLoading();


    const response = await fetch(
      TUTORS_API_URL + "?action=getTutors",
      {
        method: "GET",
        cache: "no-store"
      }
    );


    /*
     * HTTP error handling.
     */
    if (!response.ok) {

      throw new Error(
        "HTTP " + response.status
      );

    }


    /*
     * Convert response into JSON.
     */
    const result =
      await response.json();


    /*
     * API-level error handling.
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
     * Remove loading state.
     */
    hideLoading();


    /*
     * If there are no tutors, show the
     * empty state.
     */
    if (!tutors.length) {

      showEmptyState();

      return;

    }


    /*
     * Hide empty state.
     */
    hideEmptyState();


    /*
     * Start from the first tutor.
     */
    currentTutorIndex = 0;


    /*
     * Create navigation dots.
     */
    createDots();


    /*
     * Render cards.
     *
     * FALSE means initial render.
     * We do not animate the first appearance.
     */
    renderTutorCarousel(false);


    /*
     * Start automatic rotation.
     */
    startRotation();


  } catch (error) {

    console.error(
      "TutorsComponent: Tutor loading failed.",
      error
    );


    /*
     * IMPORTANT:
     *
     * We do NOT display the old
     * "Tutors coming soon" message here.
     *
     * That message should only be used when
     * the API successfully returns ZERO tutors.
     */
    hideLoading();


    if (tutorGrid) {

      tutorGrid.innerHTML = "";

      tutorGrid.classList.add("hidden");

    }


    /*
     * Hide controls when API fails.
     */
    if (tutorControls) {

      tutorControls.classList.add("hidden");

    }


    /*
     * Display a simple error message instead
     * of showing "Tutors coming soon".
     */
    showErrorState();

  }

}


/* ============================================================
   09. LOADING STATE
   ============================================================ */

function showLoading() {

  if (loadingCard) {

    loadingCard.classList.remove("hidden");

  }

}


function hideLoading() {

  if (loadingCard) {

    loadingCard.classList.add("hidden");

  }

}


/* ============================================================
   10. EMPTY STATE
   ============================================================ */

function showEmptyState() {

  /*
   * Make sure loading is completely hidden.
   */
  hideLoading();


  /*
   * Hide the tutor grid.
   */
  if (tutorGrid) {

    tutorGrid.classList.add("hidden");

  }


  /*
   * Show the "coming soon" state ONLY when
   * the API actually returned zero tutors.
   */
  if (noTutors) {

    noTutors.classList.remove("hidden");

  }


  /*
   * Hide carousel controls.
   */
  if (tutorControls) {

    tutorControls.classList.add("hidden");

  }

}


function hideEmptyState() {

  if (noTutors) {

    noTutors.classList.add("hidden");

  }

}


/* ============================================================
   11. API ERROR STATE
   ============================================================ */

function showErrorState() {

  /*
   * We deliberately use the existing noTutors element
   * as a simple error container, but replace its content.
   *
   * This prevents:
   *
   * "Tutors coming soon"
   *
   * from appearing when the API simply failed.
   */

  if (!noTutors) {
    return;
  }


  noTutors.innerHTML = `

    <div class="empty-icon" aria-hidden="true">
      !
    </div>

    <h3>
      Unable to load tutors
    </h3>

    <p>
      Please try again later.
    </p>

  `;


  noTutors.classList.remove("hidden");

}


/* ============================================================
   12. DETERMINE HOW MANY CARDS FIT
   ============================================================ */

/*
 * IMPORTANT:
 *
 * We do NOT use:
 *
 *   3 cards on desktop
 *   2 cards on tablet
 *   1 card on mobile
 *
 * anymore.
 *
 * Instead, CSS determines how many columns fit.
 *
 * JavaScript reads the actual grid columns from CSS.
 *
 * This means:
 *
 * Large screen  → as many cards as fit
 * Medium screen → as many cards as fit
 * Small screen  → as many cards as fit
 *
 * CSS remains responsible for layout.
 */

function getCardsPerPage() {

  if (!tutorGrid) {
    return 1;
  }


  /*
   * Ask the browser what columns currently exist.
   */
  const computedStyle =
    window.getComputedStyle(tutorGrid);


  const columns =
    computedStyle.gridTemplateColumns;


  /*
   * Example:
   *
   * "300px 300px 300px 300px"
   *
   * becomes:
   *
   * 4 columns.
   */
  if (
    columns &&
    columns !== "none"
  ) {

    const columnCount =
      columns
        .split(" ")
        .filter(Boolean)
        .length;


    if (columnCount > 0) {

      return Math.min(
        columnCount,
        tutors.length
      );

    }

  }


  /*
   * Safe fallback.
   */
  return Math.min(
    1,
    tutors.length
  );

}


/* ============================================================
   13. CIRCULAR INDEX
   ============================================================ */

function circularIndex(index) {

  const total =
    tutors.length;


  if (!total) {
    return 0;
  }


  return (
    (index % total) + total
  ) % total;

}


/* ============================================================
   14. GET VISIBLE TUTORS
   ============================================================ */

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


/* ============================================================
   15. RENDER TUTOR CAROUSEL
   ============================================================ */

function renderTutorCarousel(animate = true) {

  if (
    !tutorGrid ||
    !tutors.length
  ) {

    return;

  }


  /*
   * Prevent two animations from fighting
   * with each other.
   */
  if (
    animate &&
    isAnimating
  ) {

    return;

  }


  /*
   * Get the tutors that should currently
   * be visible.
   */
  const visibleTutors =
    getVisibleTutors();


  /*
   * Smooth transition.
   *
   * We fade the existing cards out first,
   * then replace them.
   *
   * This avoids the harsh visual flicker
   * caused by immediate DOM replacement.
   */
  if (animate) {

    isAnimating = true;

    tutorGrid.classList.add(
      "tutors-changing"
    );

  }


  /*
   * Small delay allows the browser to
   * apply the fade-out before replacing
   * the cards.
   */
  const renderDelay =
    animate ? 180 : 0;


  setTimeout(
    function () {

      /*
       * Build all cards inside a document
       * fragment first.
       *
       * This prevents the browser from
       * repeatedly recalculating the layout.
       */
      const fragment =
        document.createDocumentFragment();


      visibleTutors.forEach(
        function (tutor) {

          fragment.appendChild(
            createTutorCard(tutor)
          );

        }
      );


      /*
       * Replace the grid contents only once.
       */
      tutorGrid.innerHTML = "";

      tutorGrid.appendChild(
        fragment
      );


      /*
       * Make sure grid is visible.
       */
      tutorGrid.classList.remove(
        "hidden"
      );


      /*
       * Update navigation.
       */
      updateControls();


      /*
       * Fade cards back in.
       */
      if (animate) {

        requestAnimationFrame(
          function () {

            tutorGrid.classList.remove(
              "tutors-changing"
            );


            /*
             * Allow another animation after
             * the CSS transition has completed.
             */
            setTimeout(
              function () {

                isAnimating = false;

              },
              220
            );

          }
        );

      }

    },
    renderDelay
  );

}


/* ============================================================
   16. CREATE TUTOR CARD
   ============================================================ */

function createTutorCard(tutor) {

  const card =
    document.createElement("article");


  card.className =
    "tutor-card card-animation";


  /* ==========================================================
     TUTOR IMAGE / HEADER
     ========================================================== */

  const imageArea =
    document.createElement("div");


  imageArea.className =
    "tutor-image-area";


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
   * If the tutor image fails,
   * use our placeholder.
   */
  image.addEventListener(
    "error",
    function () {

      image.src =
        createPlaceholderImage();

    },
    { once: true }
  );


  /* ==========================================================
     CARD TEXT OVERLAY
     ========================================================== */

  const overlay =
    document.createElement("div");


  overlay.className =
    "tutor-card-overlay";


  /*
   * Name.
   */
  const name =
    document.createElement("div");


  name.className =
    "tutor-title";


  name.textContent =
    getTutorName(tutor);


  /*
   * IMPORTANT:
   *
   * No verified badge is created here.
   *
   * The previous JS contained:
   *
   *     verified-badge
   *
   * That has intentionally been removed.
   */


  /*
   * Tutor type / role.
   */
  const role =
    document.createElement("div");


  role.className =
    "tutor-role";


  role.textContent =
    cleanValue(
      tutor.registerAs
    ) || "Tutor";


  overlay.appendChild(
    name
  );


  overlay.appendChild(
    role
  );


  imageArea.appendChild(
    image
  );


  imageArea.appendChild(
    overlay
  );


  /* ==========================================================
     INFORMATION AREA
     ========================================================== */

  const information =
    document.createElement("div");


  information.className =
    "tutor-information";


  /*
   * Experience.
   */
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


  /* ==========================================================
     QUALIFICATION
     ========================================================== */

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
   * College / University.
   *
   * Supports both field names so the component
   * remains compatible with existing API data.
   */
  addDetailRow(
    qualificationBlock,
    "College",
    cleanValue(
      tutor.graduationUniversity
    ) ||
    cleanValue(
      tutor.graduationCollege
    )
  );


  information.appendChild(
    qualificationBlock
  );


  /* ==========================================================
     LOCATION
     ========================================================== */

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


  /* ==========================================================
     OPTIONAL INFORMATION
     ========================================================== */

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


  /* ==========================================================
     FINISH CARD
     ========================================================== */

  card.appendChild(
    imageArea
  );


  card.appendChild(
    information
  );


  return card;

}


/* ============================================================
   17. TUTOR NAME
   ============================================================ */

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


/* ============================================================
   18. DETAIL ROW
   ============================================================ */

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
   * IMPORTANT:
   *
   * No "......." separator is generated.
   *
   * Previous version used:
   *
   *     detail-dots
   *
   * That has been removed.
   */


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
   * Accessibility / tooltip for long
   * values.
   */
  value.title =
    valueText || "";


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


/* ============================================================
   19. OPTIONAL TAG BLOCK
   ============================================================ */

function appendTagBlock(
  container,
  title,
  rawValue
) {

  const values =
    splitValues(rawValue);


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


/* ============================================================
   20. EXPERIENCE FORMATTER
   ============================================================ */

function formatExperience(value) {

  const experience =
    cleanValue(value);


  if (!experience) {
    return "—";
  }


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


/* ============================================================
   21. SPLIT MULTIPLE VALUES
   ============================================================ */

function splitValues(value) {

  if (
    value === undefined ||
    value === null
  ) {

    return [];

  }


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


/* ============================================================
   22. CLEAN VALUE
   ============================================================ */

function cleanValue(value) {

  if (
    value === undefined ||
    value === null
  ) {

    return "";

  }


  return String(value).trim();

}


/* ============================================================
   23. NEXT TUTOR
   ============================================================ */

function showNextTutor() {

  if (
    tutors.length < 2 ||
    isAnimating
  ) {

    return;

  }


  currentTutorIndex =
    circularIndex(
      currentTutorIndex + 1
    );


  renderTutorCarousel(true);


  restartRotation();

}


/* ============================================================
   24. PREVIOUS TUTOR
   ============================================================ */

function showPreviousTutor() {

  if (
    tutors.length < 2 ||
    isAnimating
  ) {

    return;

  }


  currentTutorIndex =
    circularIndex(
      currentTutorIndex - 1
    );


  renderTutorCarousel(true);


  restartRotation();

}


/* ============================================================
   25. CREATE NAVIGATION DOTS
   ============================================================ */

function createDots() {

  if (!tutorDots) {
    return;
  }


  tutorDots.innerHTML = "";


  tutors.forEach(
    function (_, index) {

      const dot =
        document.createElement("span");


      dot.className =
        "tutor-dot";


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

          if (isAnimating) {
            return;
          }


          currentTutorIndex =
            index;


          renderTutorCarousel(
            true
          );


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


            if (isAnimating) {
              return;
            }


            currentTutorIndex =
              index;


            renderTutorCarousel(
              true
            );


            restartRotation();

          }

        }
      );


      tutorDots.appendChild(
        dot
      );

    }
  );

}


/* ============================================================
   26. UPDATE CONTROLS
   ============================================================ */

function updateControls() {

  /*
   * One tutor means there is nothing to
   * rotate.
   */
  if (
    tutors.length <= 1
  ) {

    if (tutorControls) {

      tutorControls.classList.add(
        "hidden"
      );

    }

    return;

  }


  /*
   * Multiple tutors.
   */
  if (tutorControls) {

    tutorControls.classList.remove(
      "hidden"
    );

  }


  /*
   * Update counter if the element exists.
   */
  const counter =
    document.getElementById(
      "tutorCounter"
    );


  if (counter) {

    counter.textContent =
      `${currentTutorIndex + 1} / ${tutors.length}`;

  }


  /*
   * Update navigation dots.
   */
  updateDots();

}


/* ============================================================
   27. UPDATE DOTS
   ============================================================ */

function updateDots() {

  if (!tutorDots) {
    return;
  }


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


/* ============================================================
   28. AUTOMATIC ROTATION
   ============================================================ */

function startRotation() {

  /*
   * Always clear an existing timer first.
   */
  clearInterval(
    rotationTimer
  );


  /*
   * No need for automatic rotation
   * if there is only one tutor.
   */
  if (
    tutors.length < 2
  ) {

    return;

  }


  /*
   * Rotate every 6 seconds.
   */
  rotationTimer =
    setInterval(
      function () {

        if (isAnimating) {
          return;
        }


        currentTutorIndex =
          circularIndex(
            currentTutorIndex + 1
          );


        renderTutorCarousel(
          true
        );

      },
      6000
    );

}


/* ============================================================
   29. RESTART ROTATION
   ============================================================ */

function restartRotation() {

  startRotation();

}


/* ============================================================
   30. PLACEHOLDER PROFILE IMAGE
   ============================================================ */

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
