"use strict";

/* =========================================================
   URBANTUTORSITE
   OUR TUTORS COMPONENT
   =========================================================

   FILE:
   homepage/tutors/tutors.js

   PURPOSE:
   ---------------------------------------------------------
   This file controls ONLY the Tutors section.

   It handles:

   • Loading Tutors from Google Apps Script
   • Creating Tutor cards
   • Verified badge
   • Tutor information
   • Responsive number of cards
   • Previous / Next buttons
   • Navigation dots
   • Automatic rotation

   IMPORTANT:
   ---------------------------------------------------------
   This component does NOT run automatically when the file
   loads.

   index.html loads tutors.html first and then calls:

       TutorsComponent.init();

   This prevents the "Meet our tutors only" problem.

   ========================================================= */



/* =========================================================
   01. GOOGLE APPS SCRIPT API
   =========================================================

   This is the same API URL used in your original
   script.js.

   ========================================================= */

const TUTORS_API_URL =
  "https://script.google.com/macros/s/AKfycbzuQGM24P9Lf6wySxhnDMGY1dwYP_6oEhVKXyn77ZS1Ou2icNEkYShyYnF6NxS8toExuw/exec";



/* =========================================================
   02. COMPONENT STATE
   ========================================================= */

let tutors = [];

let currentTutorIndex = 0;

let rotationTimer = null;

let resizeTimer = null;



/* =========================================================
   03. COMPONENT ELEMENTS
   =========================================================

   These are intentionally EMPTY initially.

   They are assigned only after tutors.html has been
   loaded by index.html.

   ========================================================= */

let tutorSection = null;

let loadingCard = null;

let tutorGrid = null;

let noTutors = null;

let tutorControls = null;

let tutorDots = null;

let previousTutor = null;

let nextTutor = null;



/* =========================================================
   04. PUBLIC TUTORS COMPONENT
   =========================================================

   index.html calls:

       window.TutorsComponent.init();

   ========================================================= */

window.TutorsComponent = {

  init: function () {

    /*
     * Prevent duplicate initialization.
     */

    if (tutorSection) {

      return;

    }


    /* -----------------------------------------------------
       Find Tutor elements AFTER tutors.html is loaded.
       ----------------------------------------------------- */

    tutorSection =
      document.getElementById(
        "tutorsSection"
      );

    loadingCard =
      document.getElementById(
        "loadingCard"
      );

    tutorGrid =
      document.getElementById(
        "tutorGrid"
      );

    noTutors =
      document.getElementById(
        "noTutors"
      );

    tutorControls =
      document.getElementById(
        "tutorControls"
      );

    tutorDots =
      document.getElementById(
        "tutorDots"
      );

    previousTutor =
      document.getElementById(
        "previousTutor"
      );

    nextTutor =
      document.getElementById(
        "nextTutor"
      );


    /* -----------------------------------------------------
       Safety check
       ----------------------------------------------------- */

    if (!tutorSection) {

      console.error(
        "TutorsComponent: tutorsSection not found."
      );

      return;

    }


    /* -----------------------------------------------------
       Previous button
       ----------------------------------------------------- */

    if (previousTutor) {

      previousTutor.addEventListener(
        "click",
        showPreviousTutor
      );

    }


    /* -----------------------------------------------------
       Next button
       ----------------------------------------------------- */

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

        clearTimeout(
          resizeTimer
        );


        resizeTimer =
          setTimeout(
            function () {

              if (
                tutors.length
              ) {

                renderTutorCarousel();

              }

            },
            150
          );

      }
    );


    /* -----------------------------------------------------
       Start loading Tutors
       ----------------------------------------------------- */

    loadTutors();

  }

};



/* =========================================================
   05. LOAD TUTORS
   ========================================================= */

async function loadTutors() {

  /* -------------------------------------------------------
     Show loading state
     ------------------------------------------------------- */

  if (loadingCard) {

    loadingCard.classList.remove(
      "hidden"
    );

  }


  if (tutorGrid) {

    tutorGrid.classList.add(
      "hidden"
    );

  }


  if (noTutors) {

    noTutors.classList.add(
      "hidden"
    );

  }


  if (tutorControls) {

    tutorControls.classList.add(
      "hidden"
    );

  }



  try {

    /* -----------------------------------------------------
       Request Tutor data
       ----------------------------------------------------- */

    const response =
      await fetch(
        TUTORS_API_URL +
        "?action=getTutors",
        {
          method: "GET"
        }
      );


    /* -----------------------------------------------------
       Check HTTP response
       ----------------------------------------------------- */

    if (!response.ok) {

      throw new Error(
        "HTTP " +
        response.status
      );

    }


    /* -----------------------------------------------------
       Convert response to JSON
       ----------------------------------------------------- */

    const result =
      await response.json();


    /* -----------------------------------------------------
       Check API result
       ----------------------------------------------------- */

    if (!result.success) {

      throw new Error(
        result.message ||
        "Unable to load tutors."
      );

    }


    /* -----------------------------------------------------
       Store Tutors
       ----------------------------------------------------- */

    tutors =
      Array.isArray(
        result.tutors
      )
        ? result.tutors
        : [];



    /* -----------------------------------------------------
       Hide loading state
       ----------------------------------------------------- */

    if (loadingCard) {

      loadingCard.classList.add(
        "hidden"
      );

    }



    /* -----------------------------------------------------
       NO TUTORS
       ----------------------------------------------------- */

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


      return;

    }



    /* -----------------------------------------------------
       TUTORS AVAILABLE
       ----------------------------------------------------- */

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


    currentTutorIndex =
      0;


    /* -----------------------------------------------------
       Create navigation dots
       ----------------------------------------------------- */

    createDots();


    /* -----------------------------------------------------
       Display Tutor cards
       ----------------------------------------------------- */

    renderTutorCarousel();


    /* -----------------------------------------------------
       Start automatic rotation
       ----------------------------------------------------- */

    startRotation();


  } catch (error) {

    console.error(
      "Tutor loading error:",
      error
    );


    /* -----------------------------------------------------
       Hide loading state
       ----------------------------------------------------- */

    if (loadingCard) {

      loadingCard.classList.add(
        "hidden"
      );

    }


    if (tutorGrid) {

      tutorGrid.classList.add(
        "hidden"
      );

    }


    /* -----------------------------------------------------
       Show error / empty state
       ----------------------------------------------------- */

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
   06. DETERMINE NUMBER OF CARDS
   =========================================================

   The number is calculated from the actual available
   width instead of hard-coding "3 cards".

   This means:

   Large screen  → as many cards as fit
   Tablet        → fewer cards
   Mobile        → one card

   ========================================================= */

function getCardsPerPage() {

  if (!tutorGrid) {

    return 1;

  }


  /*
   * Minimum comfortable Tutor card width.
   */

  const minimumCardWidth =
    265;


  /*
   * Gap between cards.
   */

  const gap =
    18;


  /*
   * Available width of the grid.
   */

  const availableWidth =
    tutorGrid.clientWidth;


  if (
    !availableWidth
  ) {

    return 1;

  }


  /*
   * Calculate how many cards can fit.
   */

  const numberOfCards =
    Math.floor(
      (
        availableWidth +
        gap
      ) /
      (
        minimumCardWidth +
        gap
      )
    );


  /*
   * Never show less than one card.
   */

  return Math.max(
    1,
    Math.min(
      numberOfCards,
      tutors.length
    )
  );

}



/* =========================================================
   07. CIRCULAR INDEX
   ========================================================= */

function circularIndex(
  index
) {

  const total =
    tutors.length;


  if (!total) {

    return 0;

  }


  return (
    (
      index %
      total
    ) +
    total
  ) %
  total;

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

  if (
    !tutors.length ||
    !tutorGrid
  ) {

    return;

  }


  /*
   * Remove existing cards.
   */

  tutorGrid.innerHTML =
    "";


  /*
   * Get cards that should currently be displayed.
   */

  const visibleTutors =
    getVisibleTutors();


  /*
   * Create each card.
   */

  visibleTutors.forEach(
    function (tutor) {

      tutorGrid.appendChild(
        createTutorCard(
          tutor
        )
      );

    }
  );


  /*
   * If there is only one Tutor,
   * navigation is unnecessary.
   */

  if (
    tutors.length <= 1
  ) {

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

function createTutorCard(
  tutor
) {

  /* =======================================================
     MAIN CARD
     ======================================================= */

  const card =
    document.createElement(
      "article"
    );

  card.className =
    "tutor-card";



  /* =======================================================
     PROFILE IMAGE AREA
     ======================================================= */

  const imageArea =
    document.createElement(
      "div"
    );

  imageArea.className =
    "tutor-image-area";


  const image =
    document.createElement(
      "img"
    );


  /*
   * Use Tutor image when available.
   */

  image.src =
    tutor.profileImage ||
    createPlaceholderImage();


  image.alt =
    getTutorName(
      tutor
    ) +
    " profile";


  image.loading =
    "lazy";


  /*
   * If image fails, use placeholder.
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
     NAME / VERIFIED BADGE / ROLE
     ======================================================= */

  const overlay =
    document.createElement(
      "div"
    );

  overlay.className =
    "tutor-card-overlay";



  /* -------------------------------------------------------
     Name row
     ------------------------------------------------------- */

  const nameRow =
    document.createElement(
      "div"
    );

  nameRow.className =
    "tutor-name-row";



  /* -------------------------------------------------------
     Tutor name
     ------------------------------------------------------- */

  const name =
    document.createElement(
      "div"
    );

  name.className =
    "tutor-title";

  name.textContent =
    getTutorName(
      tutor
    );



  /* -------------------------------------------------------
     Verified badge
     -------------------------------------------------------

     Final appearance:

         Rahul Kumar  ✓

     No "APPROVED" text.
     ------------------------------------------------------- */

  const badge =
    document.createElement(
      "span"
    );

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


  nameRow.appendChild(
    name
  );

  nameRow.appendChild(
    badge
  );



  /* -------------------------------------------------------
     Tutor type
     ------------------------------------------------------- */

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



  /* =======================================================
     INFORMATION AREA
     ======================================================= */

  const information =
    document.createElement(
      "div"
    );

  information.className =
    "tutor-information";



  /* =======================================================
     EXPERIENCE
     ======================================================= */

  addDetailRow(
    information,
    "Experience",
    formatExperience(
      tutor.experience
    )
  );



  /* =======================================================
     QUALIFICATION
     ======================================================= */

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



  /* -------------------------------------------------------
     Course
     ------------------------------------------------------- */

  addDetailRow(
    qualificationBlock,
    "Course",
    cleanValue(
      tutor.graduationCourse
    )
  );



  /* -------------------------------------------------------
     Stream
     ------------------------------------------------------- */

  addDetailRow(
    qualificationBlock,
    "Stream",
    cleanValue(
      tutor.graduationSubject
    )
  );



  /* -------------------------------------------------------
     College
     ------------------------------------------------------- */

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


  if (
    locationValue
  ) {

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



  /* =======================================================
     ADDITIONAL TUTOR INFORMATION
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
     COMPLETE CARD
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
   11. GET TUTOR NAME
   ========================================================= */

function getTutorName(
  tutor
) {

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
    cleanValue(
      tutor.name
    ) ||
    "Professional Tutor"
  );

}



/* =========================================================
   12. DETAIL ROW
   =========================================================

   IMPORTANT:

   There is NO dotted separator.

   Final appearance:

       EXPERIENCE       3 Years

   ========================================================= */

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



/* =========================================================
   13. ADDITIONAL TAG BLOCK
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


  if (
    !values.length
  ) {

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
    .slice(
      0,
      12
    )
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



/* =========================================================
   14. EXPERIENCE FORMAT
   ========================================================= */

function formatExperience(
  value
) {

  const experience =
    cleanValue(
      value
    );


  if (
    !experience
  ) {

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



/* =========================================================
   15. SPLIT MULTIPLE VALUES
   ========================================================= */

function splitValues(
  value
) {

  if (
    value === undefined ||
    value === null
  ) {

    return [];

  }


  return String(
    value
  )
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



/* =========================================================
   16. CLEAN VALUE
   ========================================================= */

function cleanValue(
  value
) {

  if (
    value === undefined ||
    value === null
  ) {

    return "";

  }


  return String(
    value
  ).trim();

}



/* =========================================================
   17. NEXT TUTOR
   ========================================================= */

function showNextTutor() {

  if (
    tutors.length < 2
  ) {

    return;

  }


  currentTutorIndex =
    circularIndex(
      currentTutorIndex + 1
    );


  renderTutorCarousel();

  restartRotation();

}



/* =========================================================
   18. PREVIOUS TUTOR
   ========================================================= */

function showPreviousTutor() {

  if (
    tutors.length < 2
  ) {

    return;

  }


  currentTutorIndex =
    circularIndex(
      currentTutorIndex - 1
    );


  renderTutorCarousel();

  restartRotation();

}



/* =========================================================
   19. CREATE NAVIGATION DOTS
   ========================================================= */

function createDots() {

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
        (
          index + 1
        )
      );



      /* ---------------------------------------------------
         Mouse click
         --------------------------------------------------- */

      dot.addEventListener(
        "click",
        function () {

          currentTutorIndex =
            index;

          renderTutorCarousel();

          restartRotation();

        }
      );



      /* ---------------------------------------------------
         Keyboard support
         --------------------------------------------------- */

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


      tutorDots.appendChild(
        dot
      );

    }
  );

}



/* =========================================================
   20. UPDATE ACTIVE DOT
   ========================================================= */

function updateDots() {

  if (!tutorDots) {

    return;

  }


  const dots =
    tutorDots.querySelectorAll(
      ".tutor-dot"
    );


  dots.forEach(
    function (
      dot,
      index
    ) {

      dot.classList.toggle(
        "active",
        index ===
        currentTutorIndex
      );

    }
  );

}



/* =========================================================
   21. AUTOMATIC ROTATION
   ========================================================= */

function startRotation() {

  stopRotation();


  if (
    tutors.length <= 1
  ) {

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



/* =========================================================
   22. RESTART ROTATION
   ========================================================= */

function restartRotation() {

  startRotation();

}



/* =========================================================
   23. STOP ROTATION
   ========================================================= */

function stopRotation() {

  if (
    rotationTimer
  ) {

    clearInterval(
      rotationTimer
    );

    rotationTimer =
      null;

  }

}



/* =========================================================
   24. PLACEHOLDER IMAGE
   ========================================================= */

function createPlaceholderImage() {

  /*
   * Dark SVG placeholder.
   *
   * No external image is required.
   */

  return (
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(`
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 600 500"
      >

        <rect
          width="600"
          height="500"
          fill="#111111"
        />

        <circle
          cx="300"
          cy="185"
          r="70"
          fill="#202020"
        />

        <path
          d="M145 440c15-105 80-155 155-155s140 50 155 155"
          fill="#181818"
        />

      </svg>
    `)
  );

}
