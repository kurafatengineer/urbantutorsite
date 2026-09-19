"use strict";


/* =========================================================
   OUR TUTORS COMPONENT
   =========================================================

   This JavaScript controls ONLY the Tutors component.

   Responsibilities:

   1. Load tutors from Google Apps Script
   2. Display tutor cards
   3. Create Twitter/X-style verification badge
   4. Automatically calculate cards according to screen width
   5. Handle next / previous navigation
   6. Handle pagination dots
   7. Handle automatic rotation
   8. Provide smooth cross-fade transitions
   9. Handle loading and empty states

   IMPORTANT:

   The component is initialized through:

       window.TutorsComponent.init();

   This is required because tutors.html is loaded dynamically
   by the homepage loader.

   ========================================================= */



/* =========================================================
   CONFIGURATION
   ========================================================= */

/*
 * Google Apps Script Web App.
 *
 * The existing API endpoint is preserved.
 */

const TUTORS_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbzuQGM24P9Lf6wySxhnDMGY1dwYP_6oEhVKXyn77ZS1Ou2icNEkYShyYnF6NxS8toExuw/exec";



/* =========================================================
   COMPONENT STATE
   ========================================================= */

let tutorsData = [];

let currentTutorIndex = 0;

let rotationTimer = null;

let resizeTimer = null;

let initialized = false;

let isTransitioning = false;



/* =========================================================
   COMPONENT OBJECT
   =========================================================
   
   The homepage loader calls:

       TutorsComponent.init()

   ========================================================= */

window.TutorsComponent = {

  init: function () {

    /*
     * Prevent accidental double initialization.
     */

    if (initialized) {
      return;
    }

    initialized = true;

    setupTutorsComponent();

  }

};



/* =========================================================
   INITIALIZE COMPONENT
   ========================================================= */

function setupTutorsComponent() {

  /*
   * Find elements AFTER tutors.html has been inserted
   * into the homepage.
   */

  const tutorGrid =
    document.getElementById("tutorGrid");

  const tutorLoading =
    document.getElementById("tutorLoading");

  const tutorEmpty =
    document.getElementById("tutorEmpty");

  const tutorControls =
    document.getElementById("tutorControls");

  const previousTutor =
    document.getElementById("previousTutor");

  const nextTutor =
    document.getElementById("nextTutor");

  const tutorDots =
    document.getElementById("tutorDots");


  /*
   * If the HTML is not available, stop safely.
   */

  if (
    !tutorGrid ||
    !tutorLoading ||
    !tutorEmpty
  ) {

    console.error(
      "Tutors component HTML was not found."
    );

    return;

  }


  /* ---------------------------------------------------------
     Store references
     --------------------------------------------------------- */

  const elements = {

    grid: tutorGrid,

    loading: tutorLoading,

    empty: tutorEmpty,

    controls: tutorControls,

    previous: previousTutor,

    next: nextTutor,

    dots: tutorDots

  };


  /*
   * Save references for other functions.
   */

  window.__UrbanTutorsElements = elements;



  /* ---------------------------------------------------------
     Previous button
     --------------------------------------------------------- */

  if (previousTutor) {

    previousTutor.addEventListener(
      "click",
      function () {

        showPreviousTutor(elements);

      }
    );

  }



  /* ---------------------------------------------------------
     Next button
     --------------------------------------------------------- */

  if (nextTutor) {

    nextTutor.addEventListener(
      "click",
      function () {

        showNextTutor(elements);

      }
    );

  }



  /* ---------------------------------------------------------
     Responsive resize
     --------------------------------------------------------- */

  window.addEventListener(
    "resize",
    function () {

      clearTimeout(resizeTimer);

      resizeTimer = setTimeout(
        function () {

          /*
           * Only redraw if tutors have already loaded.
           */

          if (tutorsData.length) {

            renderTutorCarousel(
              elements,
              false
            );

          }

        },
        180
      );

    }
  );



  /* ---------------------------------------------------------
     Start loading tutors
     --------------------------------------------------------- */

  loadTutors(elements);

}



/* =========================================================
   LOAD TUTORS FROM API
   ========================================================= */

async function loadTutors(elements) {

  /*
   * Show loading state.
   */

  showLoading(elements);


  try {

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
        "HTTP error " + response.status
      );

    }


    /*
     * Convert response to JSON.
     */

    const result =
      await response.json();


    /*
     * Check API response.
     */

    if (!result.success) {

      throw new Error(
        result.message ||
        "Unable to load tutors."
      );

    }


    /*
     * Make sure tutors is actually an array.
     */

    tutorsData =
      Array.isArray(result.tutors)
        ? result.tutors
        : [];


    /*
     * No tutors available.
     */

    if (!tutorsData.length) {

      showEmpty(elements);

      return;

    }


    /*
     * Start from first tutor.
     */

    currentTutorIndex = 0;


    /*
     * Create pagination dots.
     */

    createTutorDots(elements);


    /*
     * Display tutors.
     */

    renderTutorCarousel(
      elements,
      false
    );


    /*
     * Start automatic rotation.
     */

    startRotation(elements);


  } catch (error) {

    console.error(
      "Tutor loading error:",
      error
    );


    /*
     * If API fails, use the empty state instead
     * of showing multiple broken/empty cards.
     */

    showEmpty(elements);

  }

}



/* =========================================================
   LOADING STATE
   ========================================================= */

function showLoading(elements) {

  elements.loading.hidden = false;

  elements.empty.hidden = true;

  elements.grid.style.display = "none";

  if (elements.controls) {

    elements.controls.hidden = true;

  }

}



/* =========================================================
   EMPTY STATE
   ========================================================= */

function showEmpty(elements) {

  elements.loading.hidden = true;

  elements.grid.style.display = "none";

  elements.empty.hidden = false;

  if (elements.controls) {

    elements.controls.hidden = true;

  }

}



/* =========================================================
   GET NUMBER OF CARDS THAT FIT
   =========================================================

   This is intentionally based on the actual available
   width rather than fixed "3 cards".

   Approximate minimum card width:

       250px

   Therefore:

   Large screen  -> 4 or more
   Laptop        -> 3 / 4
   Tablet        -> 2 / 3
   Mobile        -> 1

   ========================================================= */

function getCardsPerPage(elements) {

  const width =
    elements.grid.clientWidth ||
    window.innerWidth;


  /*
   * Minimum comfortable card width.
   */

  const minimumCardWidth = 250;


  /*
   * Space between cards.
   */

  const gap = 18;


  /*
   * Calculate how many cards fit.
   */

  let count =
    Math.floor(
      (width + gap) /
      (minimumCardWidth + gap)
    );


  /*
   * At least one card.
   */

  count =
    Math.max(1, count);


  /*
   * Never display more cards than available.
   */

  count =
    Math.min(
      count,
      tutorsData.length
    );


  return count;

}



/* =========================================================
   GET VISIBLE TUTORS
   ========================================================= */

function getVisibleTutors(elements) {

  const count =
    getCardsPerPage(elements);


  const visibleTutors = [];


  /*
   * Circular carousel.
   *
   * Example with 5 tutors and 3 visible:
   *
   * 1 2 3
   * 2 3 4
   * 3 4 5
   * 4 5 1
   * 5 1 2
   *
   * This means the carousel never shows blank space.
   */

  for (
    let offset = 0;
    offset < count;
    offset++
  ) {

    const index =
      circularIndex(
        currentTutorIndex + offset
      );


    visibleTutors.push(
      tutorsData[index]
    );

  }


  return visibleTutors;

}



/* =========================================================
   CIRCULAR INDEX
   ========================================================= */

function circularIndex(index) {

  const total =
    tutorsData.length;


  if (!total) {
    return 0;
  }


  return (
    (index % total) +
    total
  ) % total;

}



/* =========================================================
   RENDER CAROUSEL
   =========================================================

   IMPORTANT:

   The old page is NOT immediately deleted.

   Instead:

       Old page
          ↓
       New page added
          ↓
       New page fades in
          ↓
       Old page fades out
          ↓
       Old page removed

   This is what prevents flicker.

   ========================================================= */

function renderTutorCarousel(
  elements,
  animate = true
) {

  if (!tutorsData.length) {
    return;
  }


  /*
   * Prevent multiple transitions at exactly
   * the same moment.
   */

  if (isTransitioning) {
    return;
  }


  isTransitioning = true;


  /*
   * Calculate number of cards.
   */

  const cardsPerPage =
    getCardsPerPage(elements);


  /*
   * Tell CSS how many columns to create.
   */

  elements.grid.style.setProperty(
    "--cards-per-page",
    cardsPerPage
  );


  /*
   * Create new page.
   */

  const newPage =
    document.createElement("div");


  newPage.className =
    "tutor-page";


  /*
   * Create visible tutor cards.
   */

  const visibleTutors =
    getVisibleTutors(elements);


  visibleTutors.forEach(
    function (tutor) {

      newPage.appendChild(
        createTutorCard(tutor)
      );

    }
  );


  /*
   * Find current active page.
   */

  const oldPage =
    elements.grid.querySelector(
      ".tutor-page.active"
    );


  /*
   * Add new page to DOM.
   */

  elements.grid.appendChild(
    newPage
  );


  /*
   * Make new page visible.
   */

  requestAnimationFrame(
    function () {

      newPage.classList.add("active");


      /*
       * Fade old page away.
       */

      if (oldPage) {

        oldPage.classList.add(
          "previous"
        );

      }


      /*
       * If animation is disabled,
       * complete immediately.
       */

      if (!animate) {

        if (oldPage) {
          oldPage.remove();
        }

        isTransitioning = false;

        updateTutorControls(elements);

        return;

      }


      /*
       * Remove old page after transition.
       */

      setTimeout(
        function () {

          if (oldPage) {
            oldPage.remove();
          }


          isTransitioning = false;


          /*
           * Update arrows/dots.
           */

          updateTutorControls(elements);

        },
        440
      );

    }
  );



  /*
   * Show the grid.
   */

  elements.loading.hidden = true;

  elements.empty.hidden = true;

  elements.grid.style.display = "block";


  /*
   * Show controls only when there are
   * more tutors than visible cards.
   */

  if (elements.controls) {

    elements.controls.hidden =
      tutorsData.length <= cardsPerPage;

  }


  /*
   * Update dots immediately.
   */

  updateTutorControls(elements);

}



/* =========================================================
   CREATE TUTOR CARD
   ========================================================= */

function createTutorCard(tutor) {

  /*
   * Main card.
   */

  const card =
    document.createElement("article");


  card.className =
    "tutor-card";



  /* =======================================================
     PROFILE AREA
     ======================================================= */

  const profileArea =
    document.createElement("div");


  profileArea.className =
    "tutor-profile-area";



  /* -------------------------------------------------------
     Profile image
     ------------------------------------------------------- */

  const image =
    document.createElement("img");


  image.className =
    "tutor-profile-image";


  image.src =
    cleanValue(tutor.profileImage) ||
    createPlaceholderImage();


  image.alt =
    getTutorName(tutor) +
    " profile photo";


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
    { once: true }
  );



  /* =======================================================
     IDENTITY
     ======================================================= */

  const identity =
    document.createElement("div");


  identity.className =
    "tutor-identity";



  /* -------------------------------------------------------
     Name row
     ------------------------------------------------------- */

  const nameRow =
    document.createElement("div");


  nameRow.className =
    "tutor-name-row";



  /* -------------------------------------------------------
     Tutor name
     ------------------------------------------------------- */

  const name =
    document.createElement("span");


  name.className =
    "tutor-name";


  name.textContent =
    getTutorName(tutor);



  /* -------------------------------------------------------
     Twitter/X-style verification badge
     ------------------------------------------------------- */

  const verifiedBadge =
    createVerifiedBadge();


  nameRow.appendChild(name);

  nameRow.appendChild(
    verifiedBadge
  );



  /* -------------------------------------------------------
     Tutor role
     ------------------------------------------------------- */

  const role =
    document.createElement("div");


  role.className =
    "tutor-role";


  role.textContent =
    cleanValue(
      tutor.registerAs
    ) || "Tutor";



  /* -------------------------------------------------------
     Put identity together
     ------------------------------------------------------- */

  identity.appendChild(nameRow);

  identity.appendChild(role);



  /*
   * Put image and identity into profile area.
   */

  profileArea.appendChild(image);

  profileArea.appendChild(identity);



  /* =======================================================
     INFORMATION AREA
     ======================================================= */

  const information =
    document.createElement("div");


  information.className =
    "tutor-information";



  /* -------------------------------------------------------
     Experience
     ------------------------------------------------------- */

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

  const qualification =
    document.createElement("div");


  qualification.className =
    "tutor-qualification";



  const qualificationTitle =
    document.createElement("div");


  qualificationTitle.className =
    "tutor-qualification-title";


  qualificationTitle.textContent =
    "QUALIFICATION (GRADUATION)";


  qualification.appendChild(
    qualificationTitle
  );



  /* Course */

  addDetailRow(
    qualification,
    "Course",
    cleanValue(
      tutor.graduationCourse
    )
  );


  /* Stream */

  addDetailRow(
    qualification,
    "Stream",
    cleanValue(
      tutor.graduationSubject
    )
  );


  /* College */

  addDetailRow(
    qualification,
    "College",
    cleanValue(
      tutor.graduationUniversity
    )
  );


  information.appendChild(
    qualification
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

    const location =
      document.createElement("div");


    location.className =
      "tutor-location";


    addDetailRow(
      location,
      "Location",
      locationValue
    );


    information.appendChild(
      location
    );

  }



  /* =======================================================
     FINAL CARD
     ======================================================= */

  card.appendChild(
    profileArea
  );


  card.appendChild(
    information
  );


  return card;

}



/* =========================================================
   VERIFIED BADGE
   =========================================================

   Creates a blue circular verification badge with
   a white check.

   This is intentionally created using inline SVG so:

   - No external image is required
   - It stays sharp on HD screens
   - It scales correctly
   - It does not depend on a font

   ========================================================= */

function createVerifiedBadge() {

  const badge =
    document.createElement("span");


  badge.className =
    "tutor-verified-badge";


  badge.setAttribute(
    "aria-label",
    "Verified tutor"
  );


  badge.setAttribute(
    "title",
    "Verified tutor"
  );


  /*
   * Twitter/X-style blue verification badge.
   */

  badge.innerHTML = `

    <svg
      viewBox="0 0 22 22"
      aria-hidden="true"
      focusable="false"
    >

      <!-- Blue verified badge shape -->

      <path
        fill="#1D9BF0"
        d="
          M20.396 11c0 1.19-.684 2.22-1.684
          2.726.17 1.108-.15 2.29-1.08
          3.22-.93.93-2.112 1.25-3.22
          1.08C13.906 19.026 12.19
          19.708 11 19.708s-2.906-.682
          -3.412-1.682c-1.108.17-2.29-.15
          -3.22-1.08-.93-.93-1.25-2.112
          -1.08-3.22C2.288 13.22 1.604
          12.19 1.604 11s.684-2.22
          1.684-2.726c-.17-1.108.15-2.29
          1.08-3.22.93-.93 2.112-1.25
          3.22-1.08C8.094 2.974 9.81
          2.292 11 2.292s2.906.682
          3.412 1.682c1.108-.17 2.29.15
          3.22 1.08.93.93 1.25 2.112
          1.08 3.22C19.712 8.78
          20.396 9.81 20.396 11z
        "
      />

      <!-- White check -->

      <path
        fill="#ffffff"
        d="
          M9.15 14.25
          6.35 11.45
          7.55 10.25
          9.15 11.85
          14.45 6.55
          15.65 7.75
          z
        "
      />

    </svg>

  `;


  return badge;

}



/* =========================================================
   DETAIL ROW
   =========================================================

   IMPORTANT:
   No dotted separator is created here.

   Old:
       EXPERIENCE ........ 3 Years

   New:
       EXPERIENCE          3 Years

   ========================================================= */

function addDetailRow(
  container,
  labelText,
  valueText
) {

  const row =
    document.createElement("div");


  row.className =
    "tutor-detail-row";


  /* Label */

  const label =
    document.createElement("span");


  label.className =
    "tutor-detail-label";


  label.textContent =
    labelText;



  /* Value */

  const value =
    document.createElement("span");


  value.className =
    "tutor-detail-value";


  value.textContent =
    valueText || "—";



  row.appendChild(label);

  row.appendChild(value);


  container.appendChild(row);

}



/* =========================================================
   TUTOR NAME
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


  const fullName =
    [
      firstName,
      lastName
    ]
      .filter(Boolean)
      .join(" ");


  return (
    fullName ||
    cleanValue(tutor.name) ||
    "Professional Tutor"
  );

}



/* =========================================================
   EXPERIENCE FORMAT
   ========================================================= */

function formatExperience(value) {

  const experience =
    cleanValue(value);


  if (!experience) {

    return "—";

  }


  if (
    experience
      .toLowerCase()
      .includes("year")
  ) {

    return experience;

  }


  return (
    experience +
    " Years"
  );

}



/* =========================================================
   CLEAN VALUE
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
   NEXT TUTOR
   ========================================================= */

function showNextTutor(elements) {

  if (
    tutorsData.length <=
    getCardsPerPage(elements)
  ) {

    return;

  }


  currentTutorIndex =
    circularIndex(
      currentTutorIndex + 1
    );


  renderTutorCarousel(
    elements,
    true
  );


  restartRotation(elements);

}



/* =========================================================
   PREVIOUS TUTOR
   ========================================================= */

function showPreviousTutor(elements) {

  if (
    tutorsData.length <=
    getCardsPerPage(elements)
  ) {

    return;

  }


  currentTutorIndex =
    circularIndex(
      currentTutorIndex - 1
    );


  renderTutorCarousel(
    elements,
    true
  );


  restartRotation(elements);

}



/* =========================================================
   CREATE PAGINATION DOTS
   ========================================================= */

function createTutorDots(elements) {

  if (!elements.dots) {

    return;

  }


  elements.dots.innerHTML = "";


  tutorsData.forEach(
    function (_, index) {

      const dot =
        document.createElement("button");


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

          currentTutorIndex =
            index;


          renderTutorCarousel(
            elements,
            true
          );


          restartRotation(
            elements
          );

        }
      );


      elements.dots.appendChild(
        dot
      );

    }
  );

}



/* =========================================================
   UPDATE CONTROLS
   ========================================================= */

function updateTutorControls(elements) {

  if (!elements.dots) {

    return;

  }


  const dots =
    elements.dots.querySelectorAll(
      ".tutor-dot"
    );


  dots.forEach(
    function (dot, index) {

      dot.classList.toggle(
        "active",
        index ===
        currentTutorIndex
      );

    }
  );


  /*
   * Hide controls if all tutors already fit
   * on the screen.
   */

  if (elements.controls) {

    const cardsPerPage =
      getCardsPerPage(elements);


    elements.controls.hidden =
      tutorsData.length <=
      cardsPerPage;

  }

}



/* =========================================================
   AUTOMATIC ROTATION
   ========================================================= */

function startRotation(elements) {

  clearInterval(
    rotationTimer
  );


  /*
   * If all tutors fit on the screen,
   * there is nothing to rotate.
   */

  if (
    tutorsData.length <=
    getCardsPerPage(elements)
  ) {

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


        renderTutorCarousel(
          elements,
          true
        );

      },
      6000
    );

}



/* =========================================================
   RESTART ROTATION
   ========================================================= */

function restartRotation(elements) {

  startRotation(elements);

}



/* =========================================================
   PLACEHOLDER IMAGE
   ========================================================= */

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
          cy="220"
          r="90"
          fill="#202020"
        />

        <path
          d="
            M145 500
            C160 390 220 350
            300 350
            C380 350 440 390
            455 500
            Z
          "
          fill="#202020"
        />

      </svg>

    `)
  );

}
