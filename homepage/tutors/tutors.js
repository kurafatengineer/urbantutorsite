"use strict";

/* =====================================================
   TUTORS COMPONENT JAVASCRIPT
   File: homepage/tutors/tutors.js

   Handles: tutor API, card creation, responsive card
   count, seamless carousel, prev/next, auto rotation,
   swipe, loading / empty / error states, resize.

   Public API (called by index.html after tutors.html
   has been loaded):

       window.TutorsComponent.init()
   ===================================================== */

(function () {

  /* ===================================================
     01. CONFIGURATION
     =================================================== */

  const WEB_APP_URL =
    "https://script.google.com/macros/s/AKfycbzuQGM24P9Lf6wySxhnDMGY1dwYP_6oEhVKXyn77ZS1Ou2icNEkYShyYnF6NxS8toExuw/exec";

  const AUTO_ROTATE_MS = 6000;


  /* ===================================================
     02. COMPONENT STATE
     =================================================== */

  let tutors = [];          // all tutors from the API
  let currentIndex = 0;     // logical index of selected tutor
  let visibleCount = 1;     // cards visible on this screen
  let trackIndex = 0;       // physical position (includes clones)
  let rotationTimer = null;
  let resizeTimer = null;
  let initialized = false;
  let isAnimating = false;


  /* ===================================================
     03. DOM REFERENCES (collected inside init)
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

    if (initialized) {
      return;
    }

    section = document.getElementById("tutorsSection");
    viewport = document.querySelector(".tutor-viewport");
    track = document.getElementById("tutorTrack");
    loading = document.getElementById("tutorLoading");
    emptyState = document.getElementById("tutorEmpty");
    controls = document.getElementById("tutorControls");
    dotsContainer = document.getElementById("tutorDots");
    previousButton = document.getElementById("previousTutor");
    nextButton = document.getElementById("nextTutor");

    if (!section || !viewport || !track) {
      console.error("Tutors component: required HTML is missing.");
      return;
    }

    initialized = true;

    bindEvents();
    updateVisibleCount();

    await loadTutors();
  }


  /* ===================================================
     05. EVENT HANDLERS
     =================================================== */

  function bindEvents() {

    if (previousButton) {
      previousButton.addEventListener("click", movePrevious);
    }

    if (nextButton) {
      nextButton.addEventListener("click", moveNext);
    }


    /* Resize: wait 180ms so we don't rebuild while dragging. */

    window.addEventListener("resize", function () {

      clearTimeout(resizeTimer);

      resizeTimer = setTimeout(function () {

        if (!tutors.length) {
          return;
        }

        const oldVisibleCount = visibleCount;

        updateVisibleCount();

        if (oldVisibleCount !== visibleCount) {

          currentIndex = Math.min(
            currentIndex,
            Math.max(0, tutors.length - 1)
          );

          buildCarousel(false);

        } else {

          positionTrack(false);
        }

      }, 180);
    });


    /* Pause automatic rotation while hovering. */

    section.addEventListener("mouseenter", stopRotation);
    section.addEventListener("mouseleave", startRotation);


    /* Mobile swipe. */

    let touchStartX = 0;
    let touchStartY = 0;

    viewport.addEventListener("touchstart", function (event) {

      const touch = event.changedTouches[0];

      touchStartX = touch.clientX;
      touchStartY = touch.clientY;

    }, { passive: true });

    viewport.addEventListener("touchend", function (event) {

      const touch = event.changedTouches[0];

      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;

      /* Ignore vertical scrolling and tiny movements. */

      if (Math.abs(deltaX) < 45 || Math.abs(deltaX) < Math.abs(deltaY)) {
        return;
      }

      if (deltaX < 0) {
        moveNext();
      } else {
        movePrevious();
      }

    }, { passive: true });
  }


  /* ===================================================
     06. LOAD TUTORS
     =================================================== */

  async function loadTutors() {

    showLoading();

    try {

      const response = await fetch(
        WEB_APP_URL + "?action=getTutors",
        { method: "GET", cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Unable to load tutors.");
      }

      tutors = Array.isArray(result.tutors)
        ? result.tutors.filter(isUsableTutor)
        : [];

      hideLoading();

      if (!tutors.length) {
        showEmptyState();
        return;
      }

      hideEmptyState();

      currentIndex = 0;

      updateVisibleCount();
      buildCarousel(false);
      startRotation();

    } catch (error) {

      console.error("Tutors component failed to load:", error);

      hideLoading();
      showErrorState();
      stopRotation();
    }
  }


  /* ===================================================
     07. RESPONSIVE CARD COUNT

     >= 1200px  -> 5 cards
     950-1199   -> 4 cards
     700-949    -> 3 cards
     480-699    -> 2 cards
     < 480      -> 1 card
     =================================================== */

  function getVisibleCount() {

    const width = window.innerWidth;

    let count = 1;

    if (width >= 1200) {
      count = 5;
    } else if (width >= 950) {
      count = 4;
    } else if (width >= 700) {
      count = 3;
    } else if (width >= 480) {
      count = 2;
    }

    return Math.min(count, tutors.length);
  }

  function updateVisibleCount() {
    visibleCount = getVisibleCount();
  }


  /* ===================================================
     08. BUILD CAROUSEL

     Clones at both ends give a seamless loop without
     rebuilding the DOM while navigating:

     [clone][clone][real][real][real][clone][clone]
     =================================================== */

  function buildCarousel(animate) {

    if (!tutors.length) {
      return;
    }

    visibleCount = Math.max(1, Math.min(visibleCount, tutors.length));

    const beforeClones = getLastItems(visibleCount);
    const afterClones = getFirstItems(visibleCount);

    track.innerHTML = "";

    beforeClones.forEach(function (tutor) {
      track.appendChild(createTutorCard(tutor, true));
    });

    tutors.forEach(function (tutor) {
      track.appendChild(createTutorCard(tutor, false));
    });

    afterClones.forEach(function (tutor) {
      track.appendChild(createTutorCard(tutor, true));
    });

    /*
     * FIX: keep the selected tutor after a resize
     * (previously it always jumped back to tutor 1 while
     * the dots still highlighted the old one).
     */

    trackIndex = visibleCount + currentIndex;

    /* FIX: a rebuild must never leave the carousel locked. */

    isAnimating = false;

    createDots();
    positionTrack(animate);
    updateControls();
  }


  /* ===================================================
     09. CREATE TUTOR CARD
     =================================================== */

  function createTutorCard(tutor, isClone) {

    const card = document.createElement("article");

    card.className = "tutor-card";

    if (isClone) {
      card.setAttribute("aria-hidden", "true");
    }


    /* ---------- Identity area ---------- */

    const identity = document.createElement("div");

    identity.className = "tutor-identity";

    const profileImage = cleanValue(tutor.profileImage);

    if (profileImage) {

      const image = document.createElement("img");

      image.className = "tutor-avatar";
      image.src = profileImage;
      image.alt = getTutorName(tutor) + " profile";
      image.loading = "lazy";

      image.addEventListener("error", function () {
        image.remove();
        addAvatarPlaceholder(identity);
      }, { once: true });

      identity.appendChild(image);

    } else {

      addAvatarPlaceholder(identity);
    }

    const name = document.createElement("div");

    name.className = "tutor-name";
    name.textContent = getTutorName(tutor);

    identity.appendChild(name);

    const role = document.createElement("div");

    role.className = "tutor-role";
    role.textContent = cleanValue(tutor.registerAs) || "Tutor";

    identity.appendChild(role);


    /* ---------- Information area ---------- */

    const information = document.createElement("div");

    information.className = "tutor-information";

    addDetailBox(
      information,
      "Experience",
      formatExperience(tutor.experience)
    );

    addSubheading(information, "Qualification (Graduation)");

    addDetailBox(
      information,
      "Course",
      cleanValue(tutor.graduationCourse) || "—"
    );

    addDetailBox(
      information,
      "Stream",
      cleanValue(tutor.graduationSubject) || "—"
    );

    addDetailBox(
      information,
      "College",
      cleanValue(tutor.graduationUniversity) ||
        cleanValue(tutor.graduationCollege) ||
        "—"
    );

    const location =
      cleanValue(tutor.location) ||
      cleanValue(tutor.city);

    if (location) {
      addDetailBox(information, "Location", location);
    }

    card.appendChild(identity);
    card.appendChild(information);

    return card;
  }


  /* ===================================================
     10. AVATAR PLACEHOLDER
     =================================================== */

  function addAvatarPlaceholder(container) {

    const placeholder = document.createElement("span");

    placeholder.className = "tutor-avatar-placeholder";
    placeholder.setAttribute("aria-hidden", "true");

    container.appendChild(placeholder);
  }


  /* ===================================================
     11. QUALIFICATION HEADING
     =================================================== */

  function addSubheading(container, text) {

    const heading = document.createElement("div");

    heading.className = "tutor-subheading";
    heading.textContent = text;

    container.appendChild(heading);
  }


  /* ===================================================
     12. DETAIL BOX
     =================================================== */

  function addDetailBox(container, labelText, valueText) {

    const box = document.createElement("div");

    box.className = "tutor-detail-box";

    const label = document.createElement("span");

    label.className = "tutor-detail-label";
    label.textContent = labelText;

    const value = document.createElement("span");

    value.className = "tutor-detail-value";
    value.textContent = valueText || "—";

    box.appendChild(label);
    box.appendChild(value);

    container.appendChild(box);
  }


  /* ===================================================
     13. POSITION TRACK
     =================================================== */

  function positionTrack(animate) {

    if (!track) {
      return;
    }

    if (!animate) {
      track.classList.add("no-transition");
    } else {
      track.classList.remove("no-transition");
    }

    const step = getCardStep();

    track.style.transform =
      "translate3d(" + (-trackIndex * step) + "px, 0, 0)";

    /* Re-enable the transition after an instant jump. */

    if (!animate) {

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          track.classList.remove("no-transition");
        });
      });
    }
  }


  /* ===================================================
     14. GET CARD STEP (card width + gap)
     =================================================== */

  function getCardStep() {

    const firstCard = track
      ? track.querySelector(".tutor-card")
      : null;

    if (!firstCard) {
      return 0;
    }

    const cardWidth = firstCard.getBoundingClientRect().width;
    const trackStyle = window.getComputedStyle(track);

    const gap =
      parseFloat(trackStyle.columnGap || trackStyle.gap) || 0;

    return cardWidth + gap;
  }


  /* ===================================================
     15. NEXT TUTOR
     =================================================== */

  function moveNext() {

    if (tutors.length <= visibleCount) {
      return;
    }

    if (isAnimating) {
      return;
    }

    stopRotation();

    isAnimating = true;

    trackIndex += 1;

    currentIndex = (currentIndex + 1) % tutors.length;

    track.classList.remove("no-transition");

    positionTrack(true);
    updateDots();

    track.addEventListener(
      "transitionend",
      finishForwardLoop,
      { once: true }
    );
  }


  /* ===================================================
     16. FINISH FORWARD LOOP
     =================================================== */

  function finishForwardLoop(event) {

    if (event.propertyName !== "transform") {
      return;
    }

    /* Entered the end clones: silently return to real cards. */

    if (trackIndex >= tutors.length + visibleCount) {

      trackIndex = visibleCount;

      positionTrack(false);
    }

    isAnimating = false;

    startRotation();
  }


  /* ===================================================
     17. PREVIOUS TUTOR
     =================================================== */

  function movePrevious() {

    if (tutors.length <= visibleCount) {
      return;
    }

    if (isAnimating) {
      return;
    }

    stopRotation();

    isAnimating = true;

    /* At the first real card: jump silently to the clones. */

    if (trackIndex <= visibleCount) {

      trackIndex = tutors.length + visibleCount;

      positionTrack(false);

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {

          trackIndex -= 1;

          currentIndex =
            (currentIndex - 1 + tutors.length) % tutors.length;

          track.classList.remove("no-transition");

          positionTrack(true);
          updateDots();

          track.addEventListener(
            "transitionend",
            finishBackwardLoop,
            { once: true }
          );

        });
      });

      return;
    }

    /* Normal previous movement. */

    trackIndex -= 1;

    currentIndex =
      (currentIndex - 1 + tutors.length) % tutors.length;

    track.classList.remove("no-transition");

    positionTrack(true);
    updateDots();

    track.addEventListener(
      "transitionend",
      finishBackwardLoop,
      { once: true }
    );
  }


  /* ===================================================
     18. FINISH BACKWARD LOOP
     =================================================== */

  function finishBackwardLoop(event) {

    if (event.propertyName !== "transform") {
      return;
    }

    isAnimating = false;

    startRotation();
  }


  /* ===================================================
     19. CREATE NAVIGATION DOTS
     =================================================== */

  function createDots() {

    if (!dotsContainer) {
      return;
    }

    dotsContainer.innerHTML = "";

    tutors.forEach(function (_, index) {

      const dot = document.createElement("button");

      dot.type = "button";
      dot.className = "tutor-dot";

      dot.setAttribute("role", "tab");
      dot.setAttribute("aria-label", "Show tutor " + (index + 1));

      dot.addEventListener("click", function () {

        if (isAnimating || index === currentIndex) {
          return;
        }

        stopRotation();

        isAnimating = true;

        currentIndex = index;
        trackIndex = visibleCount + index;

        positionTrack(true);
        updateDots();

        track.addEventListener("transitionend", function onEnd(event) {

          if (event.propertyName !== "transform") {
            return;
          }

          isAnimating = false;

          startRotation();

        }, { once: true });
      });

      dotsContainer.appendChild(dot);
    });

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
      .querySelectorAll(".tutor-dot")
      .forEach(function (dot, index) {

        const active = index === currentIndex;

        dot.classList.toggle("active", active);
        dot.setAttribute("aria-selected", String(active));
      });
  }


  /* ===================================================
     21. AUTOMATIC ROTATION
     =================================================== */

  function startRotation() {

    clearInterval(rotationTimer);

    /* Nothing to rotate if every tutor already fits. */

    if (tutors.length <= visibleCount) {
      return;
    }

    rotationTimer = setInterval(function () {

      if (!isAnimating) {
        moveNext();
      }

    }, AUTO_ROTATE_MS);
  }


  /* ===================================================
     22. STOP ROTATION
     =================================================== */

  function stopRotation() {

    clearInterval(rotationTimer);

    rotationTimer = null;
  }


  /* ===================================================
     23. LOADING STATE
     =================================================== */

  function showLoading() {

    if (loading) {
      loading.hidden = false;
    }

    if (emptyState) {
      emptyState.hidden = true;
    }

    if (track) {
      track.hidden = true;
    }

    if (controls) {
      controls.hidden = true;
    }
  }

  function hideLoading() {

    if (loading) {
      loading.hidden = true;
    }
  }


  /* ===================================================
     24. EMPTY STATE
     =================================================== */

  function showEmptyState() {

    if (track) {
      track.hidden = true;
      track.innerHTML = "";
    }

    if (emptyState) {
      emptyState.hidden = false;
    }

    if (controls) {
      controls.hidden = true;
    }

    if (previousButton) {
      previousButton.disabled = true;
    }

    if (nextButton) {
      nextButton.disabled = true;
    }
  }

  function hideEmptyState() {

    if (emptyState) {
      emptyState.hidden = true;
    }

    if (track) {
      track.hidden = false;
    }
  }


  /* ===================================================
     25. ERROR STATE
     =================================================== */

  function showErrorState() {

    if (track) {
      track.hidden = true;
      track.innerHTML = "";
    }

    if (emptyState) {

      emptyState.hidden = false;

      emptyState.innerHTML =
        '<div class="tutor-empty-icon" aria-hidden="true">!</div>' +
        "<h3>Unable to load tutors</h3>" +
        "<p>Please refresh the page and try again.</p>";
    }

    if (controls) {
      controls.hidden = true;
    }

    if (previousButton) {
      previousButton.disabled = true;
    }

    if (nextButton) {
      nextButton.disabled = true;
    }
  }


  /* ===================================================
     26. UPDATE CAROUSEL CONTROLS
     =================================================== */

  function updateControls() {

    const shouldShow = tutors.length > visibleCount;

    if (controls) {
      controls.hidden = !shouldShow;
    }

    if (previousButton) {
      previousButton.disabled = !shouldShow;
    }

    if (nextButton) {
      nextButton.disabled = !shouldShow;
    }
  }


  /* ===================================================
     27. DATA HELPERS
     =================================================== */

  function isUsableTutor(tutor) {
    return !!tutor && typeof tutor === "object";
  }

  function getFirstItems(count) {
    return tutors.slice(0, count);
  }

  function getLastItems(count) {
    return tutors.slice(-count);
  }


  /* ===================================================
     28. TUTOR NAME
     =================================================== */

  function getTutorName(tutor) {

    const fullName = [
      cleanValue(tutor.firstName),
      cleanValue(tutor.lastName)
    ]
      .filter(Boolean)
      .join(" ");

    return fullName || cleanValue(tutor.name) || "Professional Tutor";
  }


  /* ===================================================
     29. EXPERIENCE
     =================================================== */

  function formatExperience(value) {

    const experience = cleanValue(value);

    if (!experience) {
      return "—";
    }

    return experience.toLowerCase().includes("year")
      ? experience
      : experience + " Years";
  }


  /* ===================================================
     30. CLEAN VALUE
     =================================================== */

  function cleanValue(value) {

    if (value === undefined || value === null) {
      return "";
    }

    return String(value).trim();
  }


  /* ===================================================
     31. PUBLIC COMPONENT API
     =================================================== */

  window.TutorsComponent = {
    init: init
  };

})();
