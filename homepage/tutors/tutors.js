"use strict";


/* =====================================================
   TUTORS COMPONENT JAVASCRIPT
   File:
   homepage/tutors/tutors.js

   =====================================================
   PURPOSE
   -----------------------------------------------------
   This file controls ONLY the Tutors component.

   It handles:

   1. Tutor API
   2. Tutor card creation
   3. Responsive number of cards
   4. Smooth carousel
   5. Previous / Next buttons
   6. Automatic rotation
   7. Mobile swipe
   8. Loading state
   9. Empty state
   10. Resize handling

   IMPORTANT
   -----------------------------------------------------
   The component exposes:

       window.TutorsComponent.init()

   Your index.html calls this AFTER tutors.html has
   been loaded.

   ===================================================== */


(function () {


  /* ===================================================
     01. CONFIGURATION
     =================================================== */


  /*
   * Google Apps Script Web App.
   *
   * This is the same API endpoint used by your
   * existing tutor system.
   */

  const WEB_APP_URL =
    "https://script.google.com/macros/s/AKfycbzuQGM24P9Lf6wySxhnDMGY1dwYP_6oEhVKXyn77ZS1Ou2icNEkYShyYnF6NxS8toExuw/exec";


  /*
   * Automatic carousel rotation time.
   */

  const AUTO_ROTATE_MS = 6000;



  /* ===================================================
     02. COMPONENT STATE
     =================================================== */


  /*
   * All tutors received from the API.
   */

  let tutors = [];


  /*
   * Logical index of the currently selected tutor.
   */

  let currentIndex = 0;


  /*
   * Number of cards visible on the current screen.
   */

  let visibleCount = 1;


  /*
   * Physical position of the carousel track.
   *
   * This includes cloned cards used for seamless looping.
   */

  let trackIndex = 0;


  /*
   * Automatic rotation timer.
   */

  let rotationTimer = null;


  /*
   * Resize debounce timer.
   */

  let resizeTimer = null;


  /*
   * Prevent duplicate initialization.
   */

  let initialized = false;


  /*
   * Prevent multiple clicks while animation is running.
   */

  let isAnimating = false;



  /* ===================================================
     03. DOM REFERENCES
     ===================================================

     IMPORTANT:
     -----------------------------------------------------
     These elements are collected inside init().

     tutors.html is loaded dynamically, therefore these
     elements do not exist when tutors.js is first loaded.
     =================================================== */


  let section;
  let viewport;
  let track;
  let loading;
  let emptyState;
  let controls;
  let dotsContainer;
  let previousButton;
  let nextButton;



  /* ===================================================
     04. INITIALIZE COMPONENT
     =================================================== */


  async function init() {


    /*
     * Prevent accidental double initialization.
     */

    if (initialized) {

      return;

    }


    /*
     * Find Tutors HTML elements.
     */

    section =
      document.getElementById(
        "tutorsSection"
      );


    viewport =
      document.querySelector(
        ".tutor-viewport"
      );


    track =
      document.getElementById(
        "tutorTrack"
      );


    loading =
      document.getElementById(
        "tutorLoading"
      );


    emptyState =
      document.getElementById(
        "tutorEmpty"
      );


    controls =
      document.getElementById(
        "tutorControls"
      );


    dotsContainer =
      document.getElementById(
        "tutorDots"
      );


    previousButton =
      document.getElementById(
        "previousTutor"
      );


    nextButton =
      document.getElementById(
        "nextTutor"
      );



    /*
     * Make sure the essential HTML exists.
     */

    if (
      !section ||
      !viewport ||
      !track
    ) {

      console.error(
        "Tutors component: required HTML is missing."
      );

      return;

    }


    initialized = true;


    /*
     * Attach all events.
     */

    bindEvents();


    /*
     * Determine how many cards should be visible.
     */

    updateVisibleCount();


    /*
     * Load tutors from API.
     */

    await loadTutors();

  }



  /* ===================================================
     05. EVENT HANDLERS
     =================================================== */


  function bindEvents() {


    /* -------------------------------------------------
       Previous button
       ------------------------------------------------- */

    if (previousButton) {

      previousButton.addEventListener(
        "click",
        function () {

          movePrevious();

        }
      );

    }



    /* -------------------------------------------------
       Next button
       ------------------------------------------------- */

    if (nextButton) {

      nextButton.addEventListener(
        "click",
        function () {

          moveNext();

        }
      );

    }



    /* -------------------------------------------------
       Responsive resize
       -------------------------------------------------

       We wait 180ms after resizing before recalculating.
       This prevents unnecessary rebuilding while the
       browser is changing dimensions.
       ------------------------------------------------- */

    window.addEventListener(
      "resize",
      function () {


        clearTimeout(
          resizeTimer
        );


        resizeTimer =
          setTimeout(
            function () {


              if (!tutors.length) {

                return;

              }


              const oldVisibleCount =
                visibleCount;


              updateVisibleCount();


              /*
               * Only rebuild if the number of visible
               * cards actually changed.
               */

              if (
                oldVisibleCount !==
                visibleCount
              ) {

                currentIndex =
                  Math.min(
                    currentIndex,
                    Math.max(
                      0,
                      tutors.length - 1
                    )
                  );


                buildCarousel(
                  false
                );

              } else {

                positionTrack(
                  false
                );

              }


            },
            180
          );

      }
    );



    /* -------------------------------------------------
       Pause automatic rotation when user is hovering.
       ------------------------------------------------- */

    section.addEventListener(
      "mouseenter",
      stopRotation
    );


    section.addEventListener(
      "mouseleave",
      startRotation
    );



    /* -------------------------------------------------
       Mobile swipe support
       ------------------------------------------------- */

    let touchStartX = 0;

    let touchStartY = 0;


    viewport.addEventListener(
      "touchstart",
      function (event) {


        const touch =
          event.changedTouches[0];


        touchStartX =
          touch.clientX;


        touchStartY =
          touch.clientY;


      },
      {
        passive: true
      }
    );


    viewport.addEventListener(
      "touchend",
      function (event) {


        const touch =
          event.changedTouches[0];


        const deltaX =
          touch.clientX -
          touchStartX;


        const deltaY =
          touch.clientY -
          touchStartY;


        /*
         * Ignore vertical scrolling.
         */

        if (
          Math.abs(deltaX) < 45 ||
          Math.abs(deltaX) <
            Math.abs(deltaY)
        ) {

          return;

        }


        if (deltaX < 0) {

          moveNext();

        } else {

          movePrevious();

        }


      },
      {
        passive: true
      }
    );

  }



  /* ===================================================
     06. LOAD TUTORS
     =================================================== */


  async function loadTutors() {


    /*
     * Show loading state while API request is running.
     */

    showLoading();


    try {


      const response =
        await fetch(
          WEB_APP_URL +
          "?action=getTutors",
          {
            method: "GET",
            cache: "no-store"
          }
        );


      /*
       * HTTP error.
       */

      if (!response.ok) {

        throw new Error(
          "HTTP " +
          response.status
        );

      }


      const result =
        await response.json();


      /*
       * API returned an unsuccessful result.
       */

      if (!result.success) {

        throw new Error(
          result.message ||
          "Unable to load tutors."
        );

      }


      /*
       * Keep only valid tutor objects.
       */

      tutors =
        Array.isArray(
          result.tutors
        )
          ? result.tutors.filter(
              isUsableTutor
            )
          : [];


      /*
       * Loading is now finished.
       */

      hideLoading();



      /* ------------------------------------------------
         No tutors
         ------------------------------------------------ */

      if (!tutors.length) {

        showEmptyState();

        return;

      }



      /* ------------------------------------------------
         Tutors available
         ------------------------------------------------ */

      hideEmptyState();


      currentIndex = 0;


      updateVisibleCount();


      /*
       * Build the carousel ONCE.
       */

      buildCarousel(
        false
      );


      /*
       * Start automatic movement.
       */

      startRotation();


    } catch (error) {


      console.error(
        "Tutors component failed to load:",
        error
      );


      hideLoading();


      showErrorState();


      stopRotation();

    }

  }



  /* ===================================================
     07. RESPONSIVE CARD COUNT
     ===================================================

     Screen width:

     >= 1200px  → 5 cards

     950-1199   → 4 cards

     700-949    → 3 cards

     480-699    → 2 cards

     < 480      → 1 card
     =================================================== */


  function getVisibleCount() {


    if (
      window.innerWidth >=
      1200
    ) {

      return Math.min(
        5,
        tutors.length
      );

    }


    if (
      window.innerWidth >=
      950
    ) {

      return Math.min(
        4,
        tutors.length
      );

    }


    if (
      window.innerWidth >=
      700
    ) {

      return Math.min(
        3,
        tutors.length
      );

    }


    if (
      window.innerWidth >=
      480
    ) {

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



  function updateVisibleCount() {

    visibleCount =
      getVisibleCount();

  }



  /* ===================================================
     08. BUILD CAROUSEL
     ===================================================

     IMPORTANT:

     We use cloned cards at the beginning and end.

     Example:

     [clone] [clone] [real] [real] [real] [clone] [clone]

     This allows the carousel to move continuously without
     rebuilding the DOM during normal navigation.

     This is the main solution for the flickering problem.
     =================================================== */


  function buildCarousel(
    animate
  ) {


    if (!tutors.length) {

      return;

    }


    visibleCount =
      Math.max(
        1,
        Math.min(
          visibleCount,
          tutors.length
        )
      );


    /*
     * Create clones.
     */

    const beforeClones =
      getLastItems(
        visibleCount
      );


    const afterClones =
      getFirstItems(
        visibleCount
      );


    /*
     * Clear track only when initially building or
     * when screen size changes.
     */

    track.innerHTML = "";



    /* -------------------------------------------------
       Add cards before the real cards.
       ------------------------------------------------- */

    beforeClones.forEach(
      function (tutor) {

        track.appendChild(
          createTutorCard(
            tutor,
            true
          )
        );

      }
    );



    /* -------------------------------------------------
       Add REAL tutor cards.
       ------------------------------------------------- */

    tutors.forEach(
      function (tutor) {

        track.appendChild(
          createTutorCard(
            tutor,
            false
          )
        );

      }
    );



    /* -------------------------------------------------
       Add cards after the real cards.
       ------------------------------------------------- */

    afterClones.forEach(
      function (tutor) {

        track.appendChild(
          createTutorCard(
            tutor,
            true
          )
        );

      }
    );



    /*
     * Start at first REAL tutor.
     */

    trackIndex =
      visibleCount;


    /*
     * Build navigation dots.
     */

    createDots();


    /*
     * Position the track.
     */

    positionTrack(
      animate
    );


    /*
     * Update navigation buttons.
     */

    updateControls();

  }



  /* ===================================================
     09. CREATE TUTOR CARD
     =================================================== */


  function createTutorCard(
    tutor,
    isClone
  ) {


    /*
     * Main card.
     */

    const card =
      document.createElement(
        "article"
      );


    card.className =
      "tutor-card";


    /*
     * Cloned cards are hidden from screen readers.
     */

    if (isClone) {

      card.setAttribute(
        "aria-hidden",
        "true"
      );

    }



    /* =================================================
       IDENTITY AREA
       ================================================= */

    const identity =
      document.createElement(
        "div"
      );


    identity.className =
      "tutor-identity";



    /*
     * Profile image.
     */

    const profileImage =
      cleanValue(
        tutor.profileImage
      );


    if (profileImage) {


      const image =
        document.createElement(
          "img"
        );


      image.className =
        "tutor-avatar";


      image.src =
        profileImage;


      image.alt =
        getTutorName(
          tutor
        ) +
        " profile";


      image.loading =
        "lazy";


      /*
       * If image fails, replace it with the
       * neutral avatar.
       */

      image.addEventListener(
        "error",
        function () {

          image.remove();

          addAvatarPlaceholder(
            identity
          );

        },
        {
          once: true
        }
      );


      identity.appendChild(
        image
      );


    } else {


      addAvatarPlaceholder(
        identity
      );

    }



    /* -------------------------------------------------
       Tutor name
       ------------------------------------------------- */

    const name =
      document.createElement(
        "div"
      );


    name.className =
      "tutor-name";


    name.textContent =
      getTutorName(
        tutor
      );


    identity.appendChild(
      name
    );



    /* -------------------------------------------------
       Tutor type
       ------------------------------------------------- */

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


    identity.appendChild(
      role
    );



    /* =================================================
       INFORMATION AREA
       ================================================= */

    const information =
      document.createElement(
        "div"
      );


    information.className =
      "tutor-information";



    /* -------------------------------------------------
       Experience
       ------------------------------------------------- */

    addDetailBox(
      information,
      "Experience",
      formatExperience(
        tutor.experience
      )
    );



    /* -------------------------------------------------
       Qualification heading
       ------------------------------------------------- */

    addSubheading(
      information,
      "Qualification (Graduation)"
    );



    /* -------------------------------------------------
       Course
       ------------------------------------------------- */

    addDetailBox(
      information,
      "Course",
      cleanValue(
        tutor.graduationCourse
      ) ||
      "—"
    );



    /* -------------------------------------------------
       Stream
       ------------------------------------------------- */

    addDetailBox(
      information,
      "Stream",
      cleanValue(
        tutor.graduationSubject
      ) ||
      "—"
    );



    /* -------------------------------------------------
       College
       ------------------------------------------------- */

    addDetailBox(
      information,
      "College",
      cleanValue(
        tutor.graduationUniversity
      ) ||
      cleanValue(
        tutor.graduationCollege
      ) ||
      "—"
    );



    /* -------------------------------------------------
       Location
       ------------------------------------------------- */

    const location =
      cleanValue(
        tutor.location
      ) ||
      cleanValue(
        tutor.city
      );


    if (location) {

      addDetailBox(
        information,
        "Location",
        location
      );

    }



    /* -------------------------------------------------
       Add card sections
       ------------------------------------------------- */

    card.appendChild(
      identity
    );


    card.appendChild(
      information
    );


    return card;

  }



  /* ===================================================
     10. AVATAR PLACEHOLDER
     =================================================== */


  function addAvatarPlaceholder(
    container
  ) {


    const placeholder =
      document.createElement(
        "span"
      );


    placeholder.className =
      "tutor-avatar-placeholder";


    placeholder.setAttribute(
      "aria-hidden",
      "true"
    );


    container.appendChild(
      placeholder
    );

  }



  /* ===================================================
     11. QUALIFICATION HEADING
     =================================================== */


  function addSubheading(
    container,
    text
  ) {


    const heading =
      document.createElement(
        "div"
      );


    heading.className =
      "tutor-subheading";


    heading.textContent =
      text;


    container.appendChild(
      heading
    );

  }



  /* ===================================================
     12. DETAIL BOX
     =================================================== */


  function addDetailBox(
    container,
    labelText,
    valueText
  ) {


    const box =
      document.createElement(
        "div"
      );


    box.className =
      "tutor-detail-box";



    const label =
      document.createElement(
        "span"
      );


    label.className =
      "tutor-detail-label";


    label.textContent =
      labelText;



    const value =
      document.createElement(
        "span"
      );


    value.className =
      "tutor-detail-value";


    value.textContent =
      valueText ||
      "—";



    box.appendChild(
      label
    );


    box.appendChild(
      value
    );


    container.appendChild(
      box
    );

  }



  /* ===================================================
     13. POSITION TRACK
     =================================================== */


  function positionTrack(
    animate
  ) {


    if (!track) {

      return;

    }


    if (!animate) {

      track.classList.add(
        "no-transition"
      );

    } else {

      track.classList.remove(
        "no-transition"
      );

    }


    /*
     * Calculate the actual rendered width of one card.
     */

    const step =
      getCardStep();


    /*
     * Move the track.
     */

    track.style.transform =
      "translate3d(" +
      (-trackIndex * step) +
      "px, 0, 0)";



    /*
     * Re-enable transition after an instant jump.
     */

    if (!animate) {

      requestAnimationFrame(
        function () {

          requestAnimationFrame(
            function () {

              track.classList.remove(
                "no-transition"
              );

            }
          );

        }
      );

    }

  }



  /* ===================================================
     14. GET CARD STEP
     =================================================== */


  function getCardStep() {


    const firstCard =
      track
        ? track.querySelector(
            ".tutor-card"
          )
        : null;


    if (!firstCard) {

      return 0;

    }


    const cardWidth =
      firstCard.getBoundingClientRect()
        .width;


    const trackStyle =
      window.getComputedStyle(
        track
      );


    const gap =
      parseFloat(
        trackStyle.columnGap ||
        trackStyle.gap
      ) ||
      0;


    return (
      cardWidth +
      gap
    );

  }



  /* ===================================================
     15. NEXT TUTOR
     =================================================== */


  function moveNext() {


    /*
     * If all tutors already fit on screen,
     * there is nothing to rotate.
     */

    if (
      tutors.length <=
      visibleCount
    ) {

      return;

    }


    /*
     * Do not allow another movement while the current
     * transition is still running.
     */

    if (isAnimating) {

      return;

    }


    stopRotation();


    isAnimating = true;


    trackIndex += 1;


    currentIndex =
      (
        currentIndex + 1
      ) %
      tutors.length;


    track.classList.remove(
      "no-transition"
    );


    positionTrack(
      true
    );


    updateDots();



    /*
     * Once the movement finishes, check whether we have
     * reached the cloned section.
     */

    track.addEventListener(
      "transitionend",
      finishForwardLoop,
      {
        once: true
      }
    );

  }



  /* ===================================================
     16. FINISH FORWARD LOOP
     =================================================== */


  function finishForwardLoop(
    event
  ) {


    if (
      event.propertyName !==
      "transform"
    ) {

      return;

    }


    /*
     * If the carousel has entered the end clones,
     * silently return to the corresponding real cards.
     */

    if (
      trackIndex >=
      tutors.length +
      visibleCount
    ) {

      trackIndex =
        visibleCount;


      positionTrack(
        false
      );

    }


    isAnimating =
      false;


    startRotation();

  }



  /* ===================================================
     17. PREVIOUS TUTOR
     =================================================== */


  function movePrevious() {


    if (
      tutors.length <=
      visibleCount
    ) {

      return;

    }


    if (isAnimating) {

      return;

    }


    stopRotation();


    isAnimating = true;



    /*
     * If we are at the first real card, jump silently
     * to the corresponding end-clone position.
     */

    if (
      trackIndex <=
      visibleCount
    ) {


      trackIndex =
        tutors.length +
        visibleCount;


      positionTrack(
        false
      );


      requestAnimationFrame(
        function () {

          requestAnimationFrame(
            function () {


              trackIndex -= 1;


              currentIndex =
                (
                  currentIndex -
                  1 +
                  tutors.length
                ) %
                tutors.length;


              track.classList.remove(
                "no-transition"
              );


              positionTrack(
                true
              );


              updateDots();


              track.addEventListener(
                "transitionend",
                finishBackwardLoop,
                {
                  once: true
                }
              );

            }
          );

        }
      );


      return;

    }



    /*
     * Normal previous movement.
     */

    trackIndex -= 1;


    currentIndex =
      (
        currentIndex -
        1 +
        tutors.length
      ) %
      tutors.length;


    track.classList.remove(
      "no-transition"
    );


    positionTrack(
      true
    );


    updateDots();


    track.addEventListener(
      "transitionend",
      finishBackwardLoop,
      {
        once: true
      }
    );

  }



  /* ===================================================
     18. FINISH BACKWARD LOOP
     =================================================== */


  function finishBackwardLoop(
    event
  ) {


    if (
      event.propertyName !==
      "transform"
    ) {

      return;

    }


    isAnimating =
      false;


    startRotation();

  }



  /* ===================================================
     19. CREATE NAVIGATION DOTS
     =================================================== */


  function createDots() {


    if (!dotsContainer) {

      return;

    }


    dotsContainer.innerHTML =
      "";


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
          "role",
          "tab"
        );


        dot.setAttribute(
          "aria-label",
          "Show tutor " +
          (index + 1)
        );



        dot.addEventListener(
          "click",
          function () {


            if (
              isAnimating ||
              index ===
              currentIndex
            ) {

              return;

            }


            stopRotation();


            isAnimating =
              true;


            currentIndex =
              index;


            trackIndex =
              visibleCount +
              index;


            positionTrack(
              true
            );


            updateDots();


            track.addEventListener(
              "transitionend",
              function onEnd(
                event
              ) {


                if (
                  event.propertyName !==
                  "transform"
                ) {

                  return;

                }


                isAnimating =
                  false;


                startRotation();

              },
              {
                once: true
              }
            );

          }
        );


        dotsContainer.appendChild(
          dot
        );

      }
    );


    updateDots();

  }



  /* ===================================================
     20. UPDATE DOTS
     =================================================== */


  function updateDots() {


    if (!dotsContainer) {

      return;

    }


    dotsContainer
      .querySelectorAll(
        ".tutor-dot"
      )
      .forEach(
        function (
          dot,
          index
        ) {


          const active =
            index ===
            currentIndex;


          dot.classList.toggle(
            "active",
            active
          );


          dot.setAttribute(
            "aria-selected",
            String(active)
          );

        }
      );

  }



  /* ===================================================
     21. AUTOMATIC ROTATION
     =================================================== */


  function startRotation() {


    clearInterval(
      rotationTimer
    );


    /*
     * If all tutors fit on screen, automatic rotation
     * is unnecessary.
     */

    if (
      tutors.length <=
      visibleCount
    ) {

      return;

    }


    rotationTimer =
      setInterval(
        function () {


          if (!isAnimating) {

            moveNext();

          }


        },
        AUTO_ROTATE_MS
      );

  }



  /* ===================================================
     22. STOP ROTATION
     =================================================== */


  function stopRotation() {


    clearInterval(
      rotationTimer
    );


    rotationTimer =
      null;

  }



  /* ===================================================
     23. LOADING STATE
     =================================================== */


  function showLoading() {


    if (loading) {

      loading.hidden =
        false;

    }


    if (emptyState) {

      emptyState.hidden =
        true;

    }


    if (track) {

      track.hidden =
        true;

    }


    if (controls) {

      controls.hidden =
        true;

    }

  }



  function hideLoading() {


    if (loading) {

      loading.hidden =
        true;

    }

  }



  /* ===================================================
     24. EMPTY STATE
     =================================================== */


  function showEmptyState() {


    if (track) {

      track.hidden =
        true;

      track.innerHTML =
        "";

    }


    if (emptyState) {

      emptyState.hidden =
        false;

    }


    if (controls) {

      controls.hidden =
        true;

    }


    if (previousButton) {

      previousButton.disabled =
        true;

    }


    if (nextButton) {

      nextButton.disabled =
        true;

    }

  }



  function hideEmptyState() {


    if (emptyState) {

      emptyState.hidden =
        true;

    }


    if (track) {

      track.hidden =
        false;

    }

  }



  /* ===================================================
     25. ERROR STATE
     =================================================== */


  function showErrorState() {


    if (track) {

      track.hidden =
        true;

      track.innerHTML =
        "";

    }


    if (emptyState) {


      emptyState.hidden =
        false;


      emptyState.innerHTML =
        `
          <div
            class="tutor-empty-icon"
            aria-hidden="true"
          >
            !
          </div>

          <h3>
            Unable to load tutors
          </h3>

          <p>
            Please refresh the page and try again.
          </p>
        `;

    }


    if (controls) {

      controls.hidden =
        true;

    }


    if (previousButton) {

      previousButton.disabled =
        true;

    }


    if (nextButton) {

      nextButton.disabled =
        true;

    }

  }



  /* ===================================================
     26. UPDATE CAROUSEL CONTROLS
     =================================================== */


  function updateControls() {


    const shouldShow =
      tutors.length >
      visibleCount;


    if (controls) {

      controls.hidden =
        !shouldShow;

    }


    if (previousButton) {

      previousButton.disabled =
        !shouldShow;

    }


    if (nextButton) {

      nextButton.disabled =
        !shouldShow;

    }

  }



  /* ===================================================
     27. DATA HELPERS
     =================================================== */


  function isUsableTutor(
    tutor
  ) {


    return (
      !!tutor &&
      typeof tutor ===
        "object"
    );

  }



  function getFirstItems(
    count
  ) {


    return tutors.slice(
      0,
      count
    );

  }



  function getLastItems(
    count
  ) {


    return tutors.slice(
      -count
    );

  }



  /* ===================================================
     28. TUTOR NAME
     =================================================== */


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
        .filter(Boolean)
        .join(" ");


    return (
      fullName ||
      cleanValue(
        tutor.name
      ) ||
      "Professional Tutor"
    );

  }



  /* ===================================================
     29. EXPERIENCE
     =================================================== */


  function formatExperience(
    value
  ) {


    const experience =
      cleanValue(
        value
      );


    if (!experience) {

      return "—";

    }


    return experience
      .toLowerCase()
      .includes("year")

      ? experience

      : experience +
        " Years";

  }



  /* ===================================================
     30. CLEAN VALUE
     =================================================== */


  function cleanValue(
    value
  ) {


    if (
      value ===
        undefined ||
      value ===
        null
    ) {

      return "";

    }


    return String(
      value
    ).trim();

  }



  /* ===================================================
     31. PUBLIC COMPONENT API
     ===================================================

     This is what index.html uses:

         window.TutorsComponent.init()

     =================================================== */


  window.TutorsComponent = {

    init: init

  };


})();
