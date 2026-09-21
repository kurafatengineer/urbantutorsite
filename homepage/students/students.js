"use strict";

/* =====================================================
   STUDENTS COMPONENT JAVASCRIPT
   File: homepage/students/students.js

   Same carousel as tutors.js. Shows ONLY:
   Class, Board, Subjects and City.

   Never rendered: email, phone, whatsapp, address,
   pinCode, timestamp, sessionToken.

   Starts itself as soon as #studentsSection exists
   (works with plain HTML or with fetch() includes).
   Manual start:  window.StudentsComponent.init()
   ===================================================== */

(function () {

  /* ===================================================
     01. CONFIGURATION
     =================================================== */

  /* Web App URL of the STUDENT DIRECTORY script (students.gs). */

  const STUDENTS_API_URL =
    "https://script.google.com/macros/s/AKfycbwnhZnXpGVegX3kQtggtRjTej1JrsgfUdDyPrtMmuxh-IR_I8EGudmGAgLscda2y3nxLg/exec";

  /*
   * Which toggle shows this section?
   *   "tutor"   -> students show when the "Tutor" toggle is active
   *   "student" -> students show when the "Student" toggle is active
   */

  const SHOW_STUDENTS_WHEN = "tutor";

  const AUTO_ROTATE_MS = 6000;


  /* ===================================================
     02. COMPONENT STATE
     =================================================== */

  let students = [];
  let currentIndex = 0;
  let visibleCount = 1;
  let trackIndex = 0;
  let rotationTimer = null;
  let resizeTimer = null;
  let initialized = false;
  let isAnimating = false;


  /* ===================================================
     03. DOM REFERENCES
     =================================================== */

  let section;
  let viewport;
  let track;
  let loading;
  let emptyState;
  let emptyIcon;
  let emptyTitle;
  let emptyText;
  let controls;
  let dotsContainer;
  let previousButton;
  let nextButton;


  /* ===================================================
     04. INITIALIZE COMPONENT
     =================================================== */

  function init() {

    if (initialized) {
      return true;
    }

    section = document.getElementById("studentsSection");
    viewport = document.querySelector(".student-viewport");
    track = document.getElementById("studentTrack");
    loading = document.getElementById("studentLoading");
    emptyState = document.getElementById("studentEmpty");
    emptyIcon = document.getElementById("studentEmptyIcon");
    emptyTitle = document.getElementById("studentEmptyTitle");
    emptyText = document.getElementById("studentEmptyText");
    controls = document.getElementById("studentControls");
    dotsContainer = document.getElementById("studentDots");
    previousButton = document.getElementById("previousStudent");
    nextButton = document.getElementById("nextStudent");

    /* HTML is not on the page yet. */

    if (!section || !viewport || !track) {
      return false;
    }

    initialized = true;

    bindEvents();
    setupModeSwitching();
    applyCurrentMode();
    updateVisibleCount();
    loadStudents();

    return true;
  }

  function autoStart() {

    if (init()) {
      return;
    }

    const observer = new MutationObserver(function () {

      if (document.getElementById("studentsSection")) {

        observer.disconnect();

        init();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoStart);
  } else {
    autoStart();
  }


  /* ===================================================
     05. STUDENT / TUTOR SWITCHING
     =================================================== */

  function setupModeSwitching() {

    document.addEventListener("click", function (event) {

      if (!event.target || !event.target.closest) {
        return;
      }

      if (event.target.closest("#studentButton")) {
        applyMode("student");
      } else if (event.target.closest("#tutorButton")) {
        applyMode("tutor");
      }
    });
  }

  function applyMode(mode) {

    const showStudentsNow = mode === SHOW_STUDENTS_WHEN;

    setVisible(section, showStudentsNow);
    setVisible(document.getElementById("tutorsSection"), !showStudentsNow);

    if (showStudentsNow) {

      /*
       * The section may have been hidden while cards were built,
       * so card widths were 0. Measure again now it is visible.
       */

      requestAnimationFrame(function () {

        if (students.length) {
          positionTrack(false);
        }

        startRotation();
      });

    } else {
      stopRotation();
    }
  }

  function applyCurrentMode() {

    const studentToggle = document.getElementById("studentButton");
    const tutorToggle = document.getElementById("tutorButton");

    if (isActive(studentToggle)) {
      applyMode("student");
    } else if (isActive(tutorToggle)) {
      applyMode("tutor");
    }
  }

  function isActive(button) {

    if (!button) {
      return false;
    }

    return (
      button.classList.contains("active") ||
      button.classList.contains("selected") ||
      button.getAttribute("aria-pressed") === "true" ||
      button.getAttribute("aria-selected") === "true"
    );
  }

  function setVisible(element, visible) {

    if (!element) {
      return;
    }

    element.classList.toggle("hidden", !visible);
    element.hidden = !visible;
  }

  function isSectionHidden() {

    return (
      !section ||
      section.hidden ||
      section.classList.contains("hidden")
    );
  }


  /* ===================================================
     06. EVENT HANDLERS
     =================================================== */

  function bindEvents() {

    if (previousButton) {
      previousButton.addEventListener("click", movePrevious);
    }

    if (nextButton) {
      nextButton.addEventListener("click", moveNext);
    }

    window.addEventListener("resize", function () {

      clearTimeout(resizeTimer);

      resizeTimer = setTimeout(function () {

        if (!students.length) {
          return;
        }

        const oldVisibleCount = visibleCount;

        updateVisibleCount();

        if (oldVisibleCount !== visibleCount) {

          currentIndex = Math.min(
            currentIndex,
            Math.max(0, students.length - 1)
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
     07. LOAD STUDENTS
     =================================================== */

  async function loadStudents() {

    showLoading();

    if (
      !STUDENTS_API_URL ||
      STUDENTS_API_URL.indexOf("PASTE_YOUR") !== -1
    ) {

      console.warn(
        "Students: STUDENTS_API_URL is not set. Paste the Web App " +
        "URL of students.gs into students.js."
      );

      hideLoading();

      showMessage(
        "Student directory not connected",
        "The student directory address has not been added yet.",
        "!"
      );

      return;
    }

    try {

      const response = await fetch(
        STUDENTS_API_URL + "?action=getPublicStudents",
        { method: "GET", cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Unable to load students.");
      }

      /*
       * The login / registration script answers with success:true
       * but no "students" list. Catch that so the mistake is obvious.
       */

      if (!Array.isArray(result.students)) {
        throw new Error(
          "The response has no 'students' list. STUDENTS_API_URL must " +
          "be the Web App URL of students.gs (the student directory), " +
          "not the login Web App."
        );
      }

      students = result.students.filter(isUsableStudent);

      hideLoading();

      if (!students.length) {

        showMessage(
          "Students coming soon",
          "Student profiles will appear here once students register on UrbanTutorSite.",
          "—"
        );

        return;
      }

      hideMessage();

      currentIndex = 0;

      updateVisibleCount();
      buildCarousel(false);
      startRotation();

    } catch (error) {

      console.error("Students component failed to load:", error);

      hideLoading();

      showMessage(
        "Unable to load students",
        "Please refresh the page and try again.",
        "!"
      );

      stopRotation();
    }
  }


  /* ===================================================
     08. RESPONSIVE CARD COUNT

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

    return Math.max(1, Math.min(count, students.length || 1));
  }

  function updateVisibleCount() {
    visibleCount = getVisibleCount();
  }


  /* ===================================================
     09. BUILD CAROUSEL

     Clones at both ends give a seamless loop:

     [clone][clone][real][real][real][clone][clone]
     =================================================== */

  function buildCarousel(animate) {

    if (!students.length) {
      return;
    }

    visibleCount = Math.max(1, Math.min(visibleCount, students.length));

    const beforeClones = students.slice(-visibleCount);
    const afterClones = students.slice(0, visibleCount);

    track.innerHTML = "";

    /* Clones only matter when there is something to scroll. */

    const needsLoop = students.length > visibleCount;

    if (needsLoop) {
      beforeClones.forEach(function (student) {
        track.appendChild(createStudentCard(student, true));
      });
    }

    students.forEach(function (student) {
      track.appendChild(createStudentCard(student, false));
    });

    if (needsLoop) {
      afterClones.forEach(function (student) {
        track.appendChild(createStudentCard(student, true));
      });
    }

    trackIndex = (needsLoop ? visibleCount : 0) + currentIndex;

    isAnimating = false;

    createDots();
    positionTrack(animate);
    updateControls();
  }


  /* ===================================================
     10. CREATE STUDENT CARD
     =================================================== */

  function createStudentCard(student, isClone) {

    const card = document.createElement("article");

    card.className = "student-card";

    if (isClone) {
      card.setAttribute("aria-hidden", "true");
    }

    /* ---------- Identity area ---------- */

    const identity = document.createElement("div");

    identity.className = "student-identity";

    addAvatarPlaceholder(identity);

    const name = document.createElement("div");

    name.className = "student-name";
    name.textContent = getStudentName(student);

    identity.appendChild(name);

    const role = document.createElement("div");

    role.className = "student-role";
    role.textContent = cleanValue(student.className) || "Student";

    identity.appendChild(role);

    /* ---------- Information area (public fields only) ---------- */

    const information = document.createElement("div");

    information.className = "student-information";

    addDetailBox(information, "Board", cleanValue(student.board));
    addDetailBox(information, "Subjects", cleanValue(student.subjects));
    addDetailBox(information, "City", cleanValue(student.city));

    card.appendChild(identity);
    card.appendChild(information);

    return card;
  }

  function addAvatarPlaceholder(container) {

    const placeholder = document.createElement("span");

    placeholder.className = "student-avatar-placeholder";
    placeholder.setAttribute("aria-hidden", "true");

    container.appendChild(placeholder);
  }

  function addDetailBox(container, labelText, valueText) {

    const box = document.createElement("div");

    box.className = "student-detail-box";

    const label = document.createElement("span");

    label.className = "student-detail-label";
    label.textContent = labelText;

    const value = document.createElement("span");

    value.className = "student-detail-value";
    value.textContent = valueText || "—";

    box.appendChild(label);
    box.appendChild(value);

    container.appendChild(box);
  }


  /* ===================================================
     11. POSITION TRACK
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

    if (!animate) {

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          track.classList.remove("no-transition");
        });
      });
    }
  }

  function getCardStep() {

    const firstCard = track
      ? track.querySelector(".student-card")
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
     12. NEXT / PREVIOUS
     =================================================== */

  function canMove() {

    /*
     * Do not move while hidden: no transition would run,
     * so the carousel would stay locked.
     */

    return (
      students.length > visibleCount &&
      !isAnimating &&
      !isSectionHidden()
    );
  }

  function moveNext() {

    if (!canMove()) {
      return;
    }

    stopRotation();

    isAnimating = true;

    trackIndex += 1;

    currentIndex = (currentIndex + 1) % students.length;

    track.classList.remove("no-transition");

    positionTrack(true);
    updateDots();

    track.addEventListener(
      "transitionend",
      finishForwardLoop,
      { once: true }
    );
  }

  function finishForwardLoop(event) {

    if (event.propertyName !== "transform") {

      /* Wait for the transform transition instead. */

      track.addEventListener(
        "transitionend",
        finishForwardLoop,
        { once: true }
      );

      return;
    }

    /* Entered the end clones: silently return to real cards. */

    if (trackIndex >= students.length + visibleCount) {

      trackIndex = visibleCount;

      positionTrack(false);
    }

    isAnimating = false;

    startRotation();
  }

  function movePrevious() {

    if (!canMove()) {
      return;
    }

    stopRotation();

    isAnimating = true;

    /* At the first real card: jump silently to the clones. */

    if (trackIndex <= visibleCount) {

      trackIndex = students.length + visibleCount;

      positionTrack(false);

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {

          trackIndex -= 1;

          currentIndex =
            (currentIndex - 1 + students.length) % students.length;

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

    trackIndex -= 1;

    currentIndex =
      (currentIndex - 1 + students.length) % students.length;

    track.classList.remove("no-transition");

    positionTrack(true);
    updateDots();

    track.addEventListener(
      "transitionend",
      finishBackwardLoop,
      { once: true }
    );
  }

  function finishBackwardLoop(event) {

    if (event.propertyName !== "transform") {

      track.addEventListener(
        "transitionend",
        finishBackwardLoop,
        { once: true }
      );

      return;
    }

    isAnimating = false;

    startRotation();
  }


  /* ===================================================
     13. NAVIGATION DOTS
     =================================================== */

  function createDots() {

    if (!dotsContainer) {
      return;
    }

    dotsContainer.innerHTML = "";

    students.forEach(function (_, index) {

      const dot = document.createElement("button");

      dot.type = "button";
      dot.className = "student-dot";

      dot.setAttribute("role", "tab");
      dot.setAttribute("aria-label", "Show student " + (index + 1));

      dot.addEventListener("click", function () {

        if (isAnimating || index === currentIndex || isSectionHidden()) {
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
            track.addEventListener("transitionend", onEnd, { once: true });
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

  function updateDots() {

    if (!dotsContainer) {
      return;
    }

    dotsContainer
      .querySelectorAll(".student-dot")
      .forEach(function (dot, index) {

        const active = index === currentIndex;

        dot.classList.toggle("active", active);
        dot.setAttribute("aria-selected", String(active));
      });
  }


  /* ===================================================
     14. AUTOMATIC ROTATION
     =================================================== */

  function startRotation() {

    clearInterval(rotationTimer);

    rotationTimer = null;

    if (students.length <= visibleCount || isSectionHidden()) {
      return;
    }

    rotationTimer = setInterval(function () {

      if (!isAnimating && !isSectionHidden()) {
        moveNext();
      }

    }, AUTO_ROTATE_MS);
  }

  function stopRotation() {

    clearInterval(rotationTimer);

    rotationTimer = null;
  }


  /* ===================================================
     15. LOADING / EMPTY / ERROR STATES
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

  /* One panel used for "coming soon", "not connected" and errors. */

  function showMessage(title, text, icon) {

    if (track) {
      track.hidden = true;
      track.innerHTML = "";
    }

    if (emptyIcon) {
      emptyIcon.textContent = icon || "—";
    }

    if (emptyTitle) {
      emptyTitle.textContent = title;
    }

    if (emptyText) {
      emptyText.textContent = text;
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

    stopRotation();
  }

  function hideMessage() {

    if (emptyState) {
      emptyState.hidden = true;
    }

    if (track) {
      track.hidden = false;
    }
  }

  function updateControls() {

    const shouldShow = students.length > visibleCount;

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
     16. DATA HELPERS
     =================================================== */

  function isUsableStudent(student) {
    return !!student && typeof student === "object";
  }

  function getStudentName(student) {

    const fullName = [
      cleanValue(student.firstName),
      cleanValue(student.lastName)
    ]
      .filter(Boolean)
      .join(" ");

    return fullName || cleanValue(student.name) || "Student";
  }

  function cleanValue(value) {

    if (value === undefined || value === null) {
      return "";
    }

    return String(value).trim();
  }


  /* ===================================================
     17. PUBLIC COMPONENT API
     =================================================== */

  window.StudentsComponent = {
    init: init,
    show: function () { applyMode(SHOW_STUDENTS_WHEN); },
    hide: function () {
      setVisible(section, false);
      stopRotation();
    }
  };

})();
