"use strict";


/* =====================================================
   OUR TUTORS COMPONENT
   =====================================================

   File:
   homepage/tutors/tutors.js

   Responsibilities:
   1. Fetch verified tutors from Google Apps Script.
   2. Build tutor cards.
   3. Control responsive card count.
   4. Control next / previous navigation.
   5. Control automatic rotation.
   6. Keep loading and empty states separate.
   7. Provide a smooth transition between card groups.

   This file should contain ONLY Tutor-specific logic.
   ===================================================== */


/* =====================================================
   GOOGLE APPS SCRIPT API
   ===================================================== */

const TUTORS_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbzuQGM24P9Lf6wySxhnDMGY1dwYP_6oEhVKXyn77ZS1Ou2icNEkYShyYnF6NxS8toExuw/exec";


/* =====================================================
   COMPONENT STATE
   ===================================================== */

let tutors = [];

let currentTutorIndex = 0;

let rotationTimer = null;

let resizeTimer = null;

let isChanging = false;


/* =====================================================
   COMPONENT INITIALIZATION
   =====================================================

   IMPORTANT:

   index.html loads tutors.html FIRST.

   Then index.html calls:

       TutorsComponent.init();

   Therefore all Tutor HTML elements exist here.
   ===================================================== */

window.TutorsComponent = {

  init: function () {

    initializeTutors();

  }

};


/* =====================================================
   ELEMENT REFERENCES
   ===================================================== */

let tutorGrid = null;

let loadingCard = null;

let noTutors = null;

let tutorControls = null;

let tutorDots = null;

let previousTutor = null;

let nextTutor = null;


/* =====================================================
   INITIALIZE TUTORS
   ===================================================== */

function initializeTutors() {


  /* -----------------------------------------------------
     Find Tutor HTML elements
     ----------------------------------------------------- */

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


  /* -----------------------------------------------------
     Safety check
     ----------------------------------------------------- */

  if (
    !tutorGrid ||
    !loadingCard ||
    !noTutors
  ) {

    console.error(
      "Tutors component could not initialize."
    );

    return;

  }


  /* -----------------------------------------------------
     Button events
     ----------------------------------------------------- */

  if (previousTutor) {

    previousTutor.addEventListener(
      "click",
      showPreviousTutor
    );

  }


  if (nextTutor) {

    nextTutor.addEventListener(
      "click",
      showNextTutor
    );

  }


  /* -----------------------------------------------------
     Responsive resize
     ----------------------------------------------------- */

  window.addEventListener(
    "resize",
    function () {

      clearTimeout(resizeTimer);

      resizeTimer =
        setTimeout(
          handleResize,
          180
        );

    }
  );


  /* -----------------------------------------------------
     Start API request
     ----------------------------------------------------- */

  loadTutors();

}


/* =====================================================
   RESPONSIVE CARD COUNT
   =====================================================

   The number of cards depends on the actual available
   screen width.

   5 cards = large desktop
   4 cards = desktop
   3 cards = tablet / small desktop
   2 cards = small tablet
   1 card  = mobile
   ===================================================== */

function getCardsPerPage() {

  const width =
    window.innerWidth;


  if (width >= 1250) {

    return Math.min(
      5,
      tutors.length
    );

  }


  if (width >= 1000) {

    return Math.min(
      4,
      tutors.length
    );

  }


  if (width >= 760) {

    return Math.min(
      3,
      tutors.length
    );

  }


  if (width >= 520) {

    return Math.min(
      2,
      tutors.length
    );

  }


  return Math.min(
    1,
    tutors.length
  );

}


/* =====================================================
   LOAD TUTORS
   ===================================================== */

async function loadTutors() {


  /* -----------------------------------------------------
     Show loading state
     ----------------------------------------------------- */

  showLoadingState();


  try {


    /* ---------------------------------------------------
       Request verified tutors
       --------------------------------------------------- */

    const response =
      await fetch(
        TUTORS_WEB_APP_URL +
        "?action=getTutors",
        {
          method: "GET",
          cache: "no-store"
        }
      );


    if (!response.ok) {

      throw new Error(
        "HTTP " + response.status
      );

    }


    /* ---------------------------------------------------
       Convert response to JSON
       --------------------------------------------------- */

    const result =
      await response.json();


    if (!result.success) {

      throw new Error(
        result.message ||
        "Unable to load tutors."
      );

    }


    /* ---------------------------------------------------
       Store Tutor data
       --------------------------------------------------- */

    tutors =
      Array.isArray(result.tutors)
        ? result.tutors
        : [];


    /* ---------------------------------------------------
       Handle zero tutors
       --------------------------------------------------- */

    if (!tutors.length) {

      showEmptyState();

      return;

    }


    /* ---------------------------------------------------
       Tutors available
       --------------------------------------------------- */

    currentTutorIndex = 0;

    showTutorState();

    createDots();

    renderTutorCarousel(false);

    startRotation();


  } catch (error) {


    console.error(
      "Tutor loading error:",
      error
    );


    /* ---------------------------------------------------
       If API fails, do NOT leave loading visible.

       We show the normal empty state instead.
       --------------------------------------------------- */

    showEmptyState();

  }

}


/* =====================================================
   LOADING STATE
   ===================================================== */

function showLoadingState() {

  loadingCard.classList.remove(
    "hidden"
  );

  tutorGrid.classList.add(
    "hidden"
  );

  noTutors.classList.add(
    "hidden"
  );

  if (tutorControls) {

    tutorControls.classList.add(
      "hidden"
    );

  }

}


/* =====================================================
   EMPTY STATE
   ===================================================== */

function showEmptyState() {

  loadingCard.classList.add(
    "hidden"
  );

  tutorGrid.classList.add(
    "hidden"
  );

  noTutors.classList.remove(
    "hidden"
  );

  if (tutorControls) {

    tutorControls.classList.add(
      "hidden"
    );

  }

}


/* =====================================================
   TUTOR STATE
   ===================================================== */

function showTutorState() {

  loadingCard.classList.add(
    "hidden"
  );

  noTutors.classList.add(
    "hidden"
  );

  tutorGrid.classList.remove(
    "hidden"
  );

}


/* =====================================================
   CIRCULAR INDEX
   ===================================================== */

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


/* =====================================================
   GET VISIBLE TUTORS
   ===================================================== */

function getVisibleTutors() {

  const count =
    getCardsPerPage();

  const visible =
    [];


  for (
    let offset = 0;
    offset < count;
    offset++
  ) {

    visible.push(
      tutors[
        circularIndex(
          currentTutorIndex +
          offset
        )
      ]
    );

  }


  return visible;

}


/* =====================================================
   RENDER CAROUSEL
   =====================================================

   The old implementation immediately destroyed and
   recreated the cards.

   This version:

   1. Fades the grid out.
   2. Rebuilds the cards while invisible.
   3. Fades the grid back in.

   No rotation animation is applied to individual cards.

   This removes the visible flicker / distortion.
   ===================================================== */

function renderTutorCarousel(
  animate = true
) {


  if (!tutors.length) {

    return;

  }


  /* -----------------------------------------------------
     Prevent multiple simultaneous transitions
     ----------------------------------------------------- */

  if (isChanging) {

    return;

  }


  if (!animate) {

    buildTutorCards();

    return;

  }


  isChanging = true;


  /* -----------------------------------------------------
     Fade current cards out
     ----------------------------------------------------- */

  tutorGrid.classList.add(
    "is-changing"
  );


  /* -----------------------------------------------------
     Wait for fade-out
     ----------------------------------------------------- */

  setTimeout(
    function () {

      buildTutorCards();


      /* -------------------------------------------------
         Allow browser to paint the new cards before
         starting the fade-in.
         ------------------------------------------------- */

      requestAnimationFrame(
        function () {

          requestAnimationFrame(
            function () {

              tutorGrid.classList.remove(
                "is-changing"
              );

              isChanging = false;

            }
          );

        }
      );

    },
    160
  );

}


/* =====================================================
   BUILD TUTOR CARDS
   ===================================================== */

function buildTutorCards() {


  /* -----------------------------------------------------
     Clear old cards
     ----------------------------------------------------- */

  tutorGrid.innerHTML = "";


  /* -----------------------------------------------------
     Create visible cards
     ----------------------------------------------------- */

  getVisibleTutors().forEach(
    function (tutor) {

      tutorGrid.appendChild(
        createTutorCard(tutor)
      );

    }
  );


  /* -----------------------------------------------------
     Update controls
     ----------------------------------------------------- */

  if (tutors.length <= 1) {

    tutorControls.classList.add(
      "hidden"
    );

  } else {

    tutorControls.classList.remove(
      "hidden"
    );

  }


  /* -----------------------------------------------------
     Update navigation dots
     ----------------------------------------------------- */

  updateDots();

}


/* =====================================================
   CREATE TUTOR CARD
   ===================================================== */

function createTutorCard(tutor) {


  /* -----------------------------------------------------
     Main card
     ----------------------------------------------------- */

  const card =
    document.createElement(
      "article"
    );

  card.className =
    "tutor-card";


  /* =====================================================
     PROFILE IMAGE AREA
     ===================================================== */

  const imageArea =
    document.createElement(
      "div"
    );

  imageArea.className =
    "tutor-image-area";


  /* -----------------------------------------------------
     Profile image
     ----------------------------------------------------- */

  const image =
    document.createElement(
      "img"
    );

  image.src =
    tutor.profileImage ||
    createPlaceholderImage();

  image.alt =
    getTutorName(tutor) +
    " profile";

  image.loading =
    "lazy";


  /* -----------------------------------------------------
     Fallback if image fails
     ----------------------------------------------------- */

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


  /* =====================================================
     PROFILE OVERLAY
     ===================================================== */

  const overlay =
    document.createElement(
      "div"
    );

  overlay.className =
    "tutor-card-overlay";


  /* -----------------------------------------------------
     Name row
     ----------------------------------------------------- */

  const nameRow =
    document.createElement(
      "div"
    );

  nameRow.className =
    "tutor-name-row";


  /* Tutor name */

  const name =
    document.createElement(
      "div"
    );

  name.className =
    "tutor-title";

  name.textContent =
    getTutorName(tutor);


  /* =====================================================
     VERIFIED BADGE
     ===================================================== */

  const badge =
    document.createElement(
      "span"
    );

  badge.className =
    "verified-badge";

  badge.setAttribute(
    "aria-label",
    "Verified tutor"
  );

  badge.title =
    "Verified tutor";


  nameRow.appendChild(name);

  nameRow.appendChild(badge);


  /* -----------------------------------------------------
     Tutor role
     ----------------------------------------------------- */

  const role =
    document.createElement(
      "div"
    );

  role.className =
    "tutor-role";

  role.textContent =
    cleanValue(
      tutor.registerAs
    ) ||
    "Tutor";


  /* -----------------------------------------------------
     Assemble overlay
     ----------------------------------------------------- */

  overlay.appendChild(
    nameRow
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


  /* =====================================================
     INFORMATION AREA
     ===================================================== */

  const information =
    document.createElement(
      "div"
    );

  information.className =
    "tutor-information";


  /* -----------------------------------------------------
     Experience
     ----------------------------------------------------- */

  addDetailRow(
    information,
    "Experience",
    formatExperience(
      tutor.experience
    )
  );


  /* =====================================================
     QUALIFICATION
     ===================================================== */

  const qualificationBlock =
    document.createElement(
      "div"
    );

  qualificationBlock.className =
    "qualification-section";


  const qualificationLabel =
    document.createElement(
      "div"
    );

  qualificationLabel.className =
    "block-label";

  qualificationLabel.textContent =
    "QUALIFICATION (GRADUATION)";


  qualificationBlock.appendChild(
    qualificationLabel
  );


  /* Course */

  addDetailRow(
    qualificationBlock,
    "Course",
    cleanValue(
      tutor.graduationCourse
    )
  );


  /* Stream */

  addDetailRow(
    qualificationBlock,
    "Stream",
    cleanValue(
      tutor.graduationSubject
    )
  );


  /* College */

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


  /* =====================================================
     LOCATION
     ===================================================== */

  const locationValue =
    cleanValue(
      tutor.location
    ) ||
    cleanValue(
      tutor.city
    );


  if (locationValue) {

    const locationBlock =
      document.createElement(
        "div"
      );

    locationBlock.className =
      "location-detail";


    addDetailRow(
      locationBlock,
      "Location",
      locationValue
    );


    information.appendChild(
      locationBlock
    );

  }


  /* -----------------------------------------------------
     Optional subject tags
     ----------------------------------------------------- */

  appendTagBlock(
    information,
    "SUBJECTS",
    tutor.subjects
  );


  /* -----------------------------------------------------
     Optional class tags
     ----------------------------------------------------- */

  appendTagBlock(
    information,
    "CLASSES",
    tutor.classes
  );


  /* -----------------------------------------------------
     Optional board tags
     ----------------------------------------------------- */

  appendTagBlock(
    information,
    "BOARDS",
    tutor.boards
  );


  /* -----------------------------------------------------
     Optional special courses
     ----------------------------------------------------- */

  appendTagBlock(
    information,
    "SPECIAL COURSES",
    tutor.specialCourses
  );


  /* =====================================================
     FINAL CARD ASSEMBLY
     ===================================================== */

  card.appendChild(
    imageArea
  );

  card.appendChild(
    information
  );


  return card;

}


/* =====================================================
   ADD DETAIL ROW
   =====================================================

   IMPORTANT:

   No dotted separator is created.

   Old:

       EXPERIENCE ........ 3 Years

   New:

       EXPERIENCE          3 Years
   ===================================================== */

function addDetailRow(
  container,
  labelText,
  valueText
) {


  const row =
    document.createElement(
      "div"
    );

  row.className =
    "detail-line";


  const label =
    document.createElement(
      "span"
    );

  label.className =
    "detail-label";

  label.textContent =
    labelText;


  const value =
    document.createElement(
      "span"
    );

  value.className =
    "detail-value";

  value.textContent =
    valueText ||
    "—";


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


/* =====================================================
   TAG BLOCK
   ===================================================== */

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
    document.createElement(
      "div"
    );

  block.className =
    "professional-block";


  const label =
    document.createElement(
      "span"
    );

  label.className =
    "block-label";

  label.textContent =
    title;


  const list =
    document.createElement(
      "div"
    );

  list.className =
    "tag-list";


  values
    .slice(0, 12)
    .forEach(
      function (item) {

        const tag =
          document.createElement(
            "span"
          );

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


/* =====================================================
   GET TUTOR NAME
   ===================================================== */

function getTutorName(tutor) {


  const firstName =
    cleanValue(
      tutor.firstName
    );


  const lastName =
    cleanValue(
      tutor.lastName
    );


  const fullName =
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
    fullName ||
    cleanValue(tutor.name) ||
    "Professional Tutor"
  );

}


/* =====================================================
   FORMAT EXPERIENCE
   ===================================================== */

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


/* =====================================================
   SPLIT VALUES
   ===================================================== */

function splitValues(value) {


  if (
    value === undefined ||
    value === null
  ) {

    return [];

  }


  return String(value)

    .split(
      /[,|•]+/
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


/* =====================================================
   CLEAN VALUE
   ===================================================== */

function cleanValue(value) {


  if (
    value === undefined ||
    value === null
  ) {

    return "";

  }


  return String(value).trim();

}


/* =====================================================
   NEXT TUTOR
   ===================================================== */

function showNextTutor() {


  if (
    tutors.length < 2 ||
    isChanging
  ) {

    return;

  }


  currentTutorIndex =
    circularIndex(
      currentTutorIndex + 1
    );


  renderTutorCarousel(
    true
  );


  restartRotation();

}


/* =====================================================
   PREVIOUS TUTOR
   ===================================================== */

function showPreviousTutor() {


  if (
    tutors.length < 2 ||
    isChanging
  ) {

    return;

  }


  currentTutorIndex =
    circularIndex(
      currentTutorIndex - 1
    );


  renderTutorCarousel(
    true
  );


  restartRotation();

}


/* =====================================================
   CREATE DOTS
   ===================================================== */

function createDots() {


  if (!tutorDots) {

    return;

  }


  tutorDots.innerHTML = "";


  tutors.forEach(
    function (_, index) {


      const dot =
        document.createElement(
          "button"
        );


      dot.type =
        "button";


      dot.className =
        "tutor-dot";


      dot.setAttribute(
        "aria-label",
        "Show tutor " +
        (index + 1)
      );


      dot.addEventListener(
        "click",
        function () {


          if (isChanging) {

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


      tutorDots.appendChild(
        dot
      );


    }
  );

}


/* =====================================================
   UPDATE DOTS
   ===================================================== */

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


/* =====================================================
   AUTOMATIC ROTATION
   ===================================================== */

function startRotation() {


  clearInterval(
    rotationTimer
  );


  if (
    tutors.length < 2
  ) {

    return;

  }


  rotationTimer =
    setInterval(
      function () {


        if (isChanging) {

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


/* =====================================================
   RESTART ROTATION
   ===================================================== */

function restartRotation() {


  startRotation();

}


/* =====================================================
   RESPONSIVE RESIZE
   ===================================================== */

function handleResize() {


  if (!tutors.length) {

    return;

  }


  /* Rebuild the grid only if the required card count
     changes because of the new screen width. */

  const requiredCount =
    getCardsPerPage();


  const currentCount =
    tutorGrid.children.length;


  if (
    requiredCount !== currentCount
  ) {

    renderTutorCarousel(
      false
    );

  }

}


/* =====================================================
   PLACEHOLDER IMAGE
   ===================================================== */

function createPlaceholderImage() {


  return (
    "data:image/svg+xml;charset=UTF-8," +

    encodeURIComponent(`

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
          fill="#202020"
        />

        <path
          d="
            M145 500
            C160 390
            220 350
            300 350
            C380 350
            440 390
            455 500
            Z
          "
          fill="#202020"
        />

      </svg>

    `)
  );

}
