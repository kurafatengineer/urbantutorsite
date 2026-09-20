/* =========================================================
   MEET OUR STUDENTS  (students.js)

   Shows ONLY public student information. Never render:
   email, phone, whatsapp, address, pinCode, timestamp,
   sessionToken.

   HOW IT STARTS
   ---------------------------------------------------------
   The script starts itself as soon as #studentsSection
   exists on the page, whether students.html is written
   directly into index.html or loaded later with fetch().

   You can also start it manually:

       window.StudentsComponent.init()
   ========================================================= */

(function () {
  "use strict";


  /* =======================================================
     01. CONFIGURATION
     ======================================================= */

  /*
   * IMPORTANT: paste the Web App URL of the STUDENT
   * DIRECTORY script (students.gs) here.
   *
   * Do NOT use the login / registration Web App URL.
   * That script does not know "getPublicStudents", so it
   * answers with no students and the section stays empty.
   */

  const STUDENTS_API_URL = "https://script.google.com/macros/s/AKfycbyQ2ZkRBjB8zvJ8w_JvhUl6MZQlpkeLwAJ98DTH16ry9dbmBp4PR-eo7uPOuJlWhCfu/exec";

  /*
   * Which toggle shows this section?
   *
   *   "tutor"   -> students are shown when the "Tutor"
   *                toggle is active (a tutor looks for
   *                students). Matches your home page,
   *                where "Student" mode shows tutors.
   *   "student" -> students are shown when the "Student"
   *                toggle is active.
   */

  const SHOW_STUDENTS_WHEN = "tutor";

  const STUDENT_DESKTOP_COUNT = 3;
  const STUDENT_TABLET_COUNT = 2;
  const STUDENT_MOBILE_COUNT = 1;

  /* Automatic rotation in ms. 0 turns it off. */
  const STUDENT_ROTATION_DELAY = 7000;


  /* =======================================================
     02. STATE
     ======================================================= */

  let initialized = false;
  let publicStudents = [];
  let studentPage = 0;
  let rotationTimer = null;
  let resizeTimer = null;

  let studentsSection;
  let studentLoading;
  let studentGrid;
  let noStudents;
  let emptyTitle;
  let emptyText;
  let studentControls;
  let studentCounter;
  let studentDots;
  let previousStudent;
  let nextStudent;


  /* =======================================================
     03. START-UP
     ======================================================= */

  function init() {

    if (initialized) {
      return true;
    }

    studentsSection = document.getElementById("studentsSection");
    studentLoading = document.getElementById("studentLoading");
    studentGrid = document.getElementById("studentGrid");
    noStudents = document.getElementById("noStudents");
    emptyTitle = document.getElementById("studentEmptyTitle");
    emptyText = document.getElementById("studentEmptyText");
    studentControls = document.getElementById("studentControls");
    studentCounter = document.getElementById("studentCounter");
    studentDots = document.getElementById("studentDots");
    previousStudent = document.getElementById("previousStudent");
    nextStudent = document.getElementById("nextStudent");

    /* HTML is not on the page yet. */

    if (!studentsSection || !studentGrid) {
      return false;
    }

    initialized = true;

    setupControls();
    setupModeSwitching();
    applyCurrentMode();
    loadPublicStudents();

    return true;
  }


  /*
   * Start automatically. If the HTML is added to the page
   * later (fetch / include), wait until it appears.
   */

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


  /* =======================================================
     04. STUDENT / TUTOR SWITCHING
     =======================================================

     Click handling is delegated from the document, so it
     works even if the toggle buttons or the tutors section
     are added to the page after this script runs.
     ======================================================= */

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

    setVisible(studentsSection, showStudentsNow);
    setVisible(document.getElementById("tutorsSection"), !showStudentsNow);

    if (showStudentsNow) {
      startRotation();
    } else {
      stopRotation();
    }
  }

  /*
   * On start-up, follow whichever toggle is already active.
   * If we can't tell, leave the page exactly as it is.
   */

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


  /* =======================================================
     05. CONTROLS
     ======================================================= */

  function setupControls() {

    if (previousStudent) {
      previousStudent.addEventListener("click", showPreviousStudentPage);
    }

    if (nextStudent) {
      nextStudent.addEventListener("click", showNextStudentPage);
    }

    /* Pause automatic movement while the user interacts. */

    studentGrid.addEventListener("mouseenter", stopRotation);
    studentGrid.addEventListener("mouseleave", startRotation);

    studentGrid.addEventListener("touchstart", stopRotation, { passive: true });

    studentGrid.addEventListener("touchend", function () {
      setTimeout(startRotation, 1200);
    }, { passive: true });

    window.addEventListener("resize", function () {

      clearTimeout(resizeTimer);

      resizeTimer = setTimeout(handleResize, 180);
    });
  }


  /* =======================================================
     06. LOAD STUDENTS
     ======================================================= */

  async function loadPublicStudents() {

    showLoading();

    if (
      !STUDENTS_API_URL ||
      STUDENTS_API_URL.indexOf("PASTE_YOUR") !== -1
    ) {

      console.warn(
        "Students: STUDENTS_API_URL is not set. Paste the Web App " +
        "URL of students.gs into students.js."
      );

      showMessage(
        "Student directory not connected",
        "The student directory address has not been added yet."
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
       * The login / registration script answers with
       * success:true but no "students" list. Catch that here
       * so the mistake is obvious in the console.
       */

      if (!Array.isArray(result.students)) {
        throw new Error(
          "The response has no 'students' list. STUDENTS_API_URL must " +
          "be the Web App URL of students.gs (the student directory), " +
          "not the login Web App."
        );
      }

      publicStudents = result.students;
      studentPage = 0;

      if (!publicStudents.length) {

        showMessage(
          "Students coming soon",
          "Student profiles will appear here once students register on UrbanTutorSite."
        );

        return;
      }

      hideLoading();
      hideMessage();
      renderStudentCarousel();
      startRotation();

    } catch (error) {

      console.error("Student loading failed:", error);

      showMessage(
        "Unable to load students",
        "Please refresh the page and try again."
      );
    }
  }


  /* =======================================================
     07. PAGING
     ======================================================= */

  function getCardsPerPage() {

    const width = window.innerWidth;

    if (width <= 650) {
      return STUDENT_MOBILE_COUNT;
    }

    if (width <= 900) {
      return STUDENT_TABLET_COUNT;
    }

    return STUDENT_DESKTOP_COUNT;
  }

  function getPageCount() {
    return Math.max(
      1,
      Math.ceil(publicStudents.length / getCardsPerPage())
    );
  }

  function getCurrentPageStudents() {

    const perPage = getCardsPerPage();
    const start = studentPage * perPage;

    return publicStudents.slice(start, start + perPage);
  }


  /* =======================================================
     08. RENDER
     ======================================================= */

  function renderStudentCarousel() {

    if (!studentGrid) {
      return;
    }

    const pageCount = getPageCount();

    /* A resize can make the current page invalid. */

    if (studentPage >= pageCount) {
      studentPage = pageCount - 1;
    }

    const visibleStudents = getCurrentPageStudents();
    const perPage = getCardsPerPage();

    studentGrid.innerHTML = "";

    studentGrid.classList.remove("student-grid-one", "student-grid-two");

    if (visibleStudents.length === 1) {
      studentGrid.classList.add("student-grid-one");
    }

    if (visibleStudents.length === 2) {
      studentGrid.classList.add("student-grid-two");
    }

    visibleStudents.forEach(function (student, index) {
      studentGrid.appendChild(createStudentCard(student, index));
    });

    if (studentCounter) {

      const start = studentPage * perPage + 1;

      const end = Math.min(
        (studentPage + 1) * perPage,
        publicStudents.length
      );

      studentCounter.textContent =
        start + "–" + end + " / " + publicStudents.length;
    }

    renderDots();
    updateControls();
  }


  /* =======================================================
     09. STUDENT CARD
     ======================================================= */

  function createStudentCard(student, index) {

    const card = document.createElement("article");

    card.className = "student-card";
    card.style.animationDelay = (index * 70) + "ms";

    const identity = document.createElement("div");

    identity.className = "student-identity";

    const avatar = document.createElement("div");

    avatar.className = "student-avatar";
    avatar.setAttribute("aria-hidden", "true");

    identity.appendChild(avatar);

    const name = document.createElement("h3");

    name.className = "student-name";
    name.textContent = safeValue(student.name, "Student");

    identity.appendChild(name);

    const role = document.createElement("div");

    role.className = "student-role";
    role.textContent = "Student";

    identity.appendChild(role);

    card.appendChild(identity);

    const information = document.createElement("div");

    information.className = "student-information";

    /* PUBLIC fields only. */

    addDetail(information, "Class", student.className);
    addDetail(information, "School", student.school);
    addDetail(information, "Board", student.board);
    addDetail(information, "Subjects", student.subjects);
    addDetail(information, "Preferred Tutor", student.preferredTutor);
    addDetail(information, "Preferred Timing", student.preferredTiming);
    addDetail(information, "City", student.city);

    card.appendChild(information);

    return card;
  }

  function addDetail(container, label, value) {

    const text = safeValue(value, "");

    /* Don't create empty rows. */

    if (!text) {
      return;
    }

    const row = document.createElement("div");

    row.className = "student-detail";

    const labelElement = document.createElement("span");

    labelElement.className = "student-detail-label";
    labelElement.textContent = label;

    const valueElement = document.createElement("span");

    valueElement.className = "student-detail-value";
    valueElement.textContent = text;

    row.appendChild(labelElement);
    row.appendChild(valueElement);

    container.appendChild(row);
  }

  function safeValue(value, fallback) {

    const text = String(value == null ? "" : value).trim();

    return text || fallback || "";
  }


  /* =======================================================
     10. DOTS AND BUTTONS
     ======================================================= */

  function renderDots() {

    if (!studentDots) {
      return;
    }

    const pageCount = getPageCount();

    studentDots.innerHTML = "";

    if (pageCount <= 1) {
      return;
    }

    for (let i = 0; i < pageCount; i++) {

      const dot = document.createElement("button");

      dot.type = "button";
      dot.className = "student-dot";

      if (i === studentPage) {
        dot.classList.add("active");
      }

      dot.setAttribute("aria-label", "Show student group " + (i + 1));

      dot.addEventListener("click", function () {

        studentPage = i;

        renderStudentCarousel();
        restartRotation();
      });

      studentDots.appendChild(dot);
    }
  }

  function updateControls() {

    if (!studentControls) {
      return;
    }

    studentControls.classList.toggle("hidden", getPageCount() <= 1);
  }

  function showNextStudentPage() {

    const pageCount = getPageCount();

    if (pageCount <= 1) {
      return;
    }

    studentPage = (studentPage + 1) % pageCount;

    renderStudentCarousel();
    restartRotation();
  }

  function showPreviousStudentPage() {

    const pageCount = getPageCount();

    if (pageCount <= 1) {
      return;
    }

    studentPage = (studentPage - 1 + pageCount) % pageCount;

    renderStudentCarousel();
    restartRotation();
  }


  /* =======================================================
     11. AUTOMATIC ROTATION
     ======================================================= */

  function startRotation() {

    stopRotation();

    if (STUDENT_ROTATION_DELAY <= 0) {
      return;
    }

    if (publicStudents.length <= getCardsPerPage()) {
      return;
    }

    /* Not while the Students section is hidden. */

    if (
      !studentsSection ||
      studentsSection.hidden ||
      studentsSection.classList.contains("hidden")
    ) {
      return;
    }

    rotationTimer = setInterval(
      showNextStudentPage,
      STUDENT_ROTATION_DELAY
    );
  }

  function stopRotation() {

    if (rotationTimer) {
      clearInterval(rotationTimer);
      rotationTimer = null;
    }
  }

  function restartRotation() {
    stopRotation();
    startRotation();
  }


  /* =======================================================
     12. LOADING / MESSAGE STATES
     ======================================================= */

  function showLoading() {

    if (studentLoading) {
      studentLoading.classList.remove("hidden");
    }

    if (studentGrid) {
      studentGrid.classList.add("hidden");
    }

    if (studentControls) {
      studentControls.classList.add("hidden");
    }

    if (noStudents) {
      noStudents.classList.add("hidden");
    }
  }

  function hideLoading() {

    if (studentLoading) {
      studentLoading.classList.add("hidden");
    }

    if (studentGrid) {
      studentGrid.classList.remove("hidden");
    }
  }

  /* One panel used for "coming soon", "not connected" and errors. */

  function showMessage(title, text) {

    if (studentLoading) {
      studentLoading.classList.add("hidden");
    }

    if (studentGrid) {
      studentGrid.classList.add("hidden");
    }

    if (studentControls) {
      studentControls.classList.add("hidden");
    }

    if (emptyTitle) {
      emptyTitle.textContent = title;
    }

    if (emptyText) {
      emptyText.textContent = text;
    }

    if (noStudents) {
      noStudents.classList.remove("hidden");
    }

    if (studentCounter) {
      studentCounter.textContent = "0 / 0";
    }

    stopRotation();
  }

  function hideMessage() {

    if (noStudents) {
      noStudents.classList.add("hidden");
    }
  }


  /* =======================================================
     13. RESIZE
     ======================================================= */

  function handleResize() {

    if (!publicStudents.length) {
      return;
    }

    renderStudentCarousel();
    restartRotation();
  }


  /* =======================================================
     14. PUBLIC API
     ======================================================= */

  window.StudentsComponent = {
    init: init,
    show: function () { applyMode(SHOW_STUDENTS_WHEN); },
    hide: function () {
      setVisible(studentsSection, false);
      stopRotation();
    }
  };

})();
