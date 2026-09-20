
"use strict";

/*
 * =========================================================
 * MEET OUR STUDENTS
 * =========================================================
 *
 * This component is completely independent from the tutor
 * carousel.
 *
 * IMPORTANT:
 *
 * Only PUBLIC student information is rendered.
 *
 * NEVER render:
 *   email
 *   phone
 *   whatsapp
 *   address
 *   pinCode
 *   timestamp
 *   sessionToken
 *
 * =========================================================
 */


/* =========================================================
   CONFIGURATION
   ========================================================= */

/*
 * After deploying students.gs as a Web App,
 * paste its Web App URL here.
 *
 * Example:
 *
 * const STUDENTS_API_URL =
 *   "https://script.google.com/macros/s/XXXX/exec";
 */

const STUDENTS_API_URL =
  "https://script.google.com/macros/s/AKfycbyQ2ZkRBjB8zvJ8w_JvhUl6MZQlpkeLwAJ98DTH16ry9dbmBp4PR-eo7uPOuJlWhCfu/exec";


/*
 * Number of cards shown at one time.
 *
 * Desktop  = 3
 * Tablet   = 2
 * Mobile   = 1
 */

const STUDENT_DESKTOP_COUNT = 3;
const STUDENT_TABLET_COUNT = 2;
const STUDENT_MOBILE_COUNT = 1;


/*
 * Automatic rotation.
 *
 * 0 means automatic rotation is disabled.
 *
 * 7000 = 7 seconds.
 */

const STUDENT_ROTATION_DELAY = 7000;


/* =========================================================
   STATE
   ========================================================= */

let publicStudents = [];

let studentPage = 0;

let studentRotationTimer = null;

let studentResizeTimer = null;


/* =========================================================
   ELEMENTS
   ========================================================= */

const studentsSection =
  document.getElementById(
    "studentsSection"
  );

const studentLoading =
  document.getElementById(
    "studentLoading"
  );

const studentGrid =
  document.getElementById(
    "studentGrid"
  );

const noStudents =
  document.getElementById(
    "noStudents"
  );

const studentControls =
  document.getElementById(
    "studentControls"
  );

const studentCounter =
  document.getElementById(
    "studentCounter"
  );

const studentDots =
  document.getElementById(
    "studentDots"
  );

const previousStudent =
  document.getElementById(
    "previousStudent"
  );

const nextStudent =
  document.getElementById(
    "nextStudent"
  );

const studentButton =
  document.getElementById(
    "studentButton"
  );

const tutorButton =
  document.getElementById(
    "tutorButton"
  );

const tutorsSection =
  document.getElementById(
    "tutorsSection"
  );


/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  initializeStudents
);


function initializeStudents() {

  /*
   * The section is initially visible because
   * Student is the default selected mode.
   */

  setupUserTypeSwitching();

  setupStudentControls();

  handleStudentResize();

  loadPublicStudents();

}


/* =========================================================
   STUDENT / TUTOR SWITCHING
   ========================================================= */

function setupUserTypeSwitching() {

  if (studentButton) {

    studentButton.addEventListener(
      "click",
      function () {

        showStudents();

      }
    );

  }


  if (tutorButton) {

    tutorButton.addEventListener(
      "click",
      function () {

        showTutors();

      }
    );

  }

}


/*
 * Show Meet our Students.
 */

function showStudents() {

  if (studentsSection) {

    studentsSection.classList.remove(
      "hidden"
    );

  }


  if (tutorsSection) {

    tutorsSection.classList.add(
      "hidden"
    );

  }


  /*
   * Stop student automatic rotation when
   * section is not visible.
   */

  startStudentRotation();

}


/*
 * Show Meet our Tutors.
 */

function showTutors() {

  if (studentsSection) {

    studentsSection.classList.add(
      "hidden"
    );

  }


  if (tutorsSection) {

    tutorsSection.classList.remove(
      "hidden"
    );

  }


  stopStudentRotation();

}


/* =========================================================
   CONTROLS
   ========================================================= */

function setupStudentControls() {

  if (previousStudent) {

    previousStudent.addEventListener(
      "click",
      function () {

        showPreviousStudentPage();

      }
    );

  }


  if (nextStudent) {

    nextStudent.addEventListener(
      "click",
      function () {

        showNextStudentPage();

      }
    );

  }


  /*
   * Pause automatic movement while the user
   * interacts with the cards.
   */

  if (studentGrid) {

    studentGrid.addEventListener(
      "mouseenter",
      stopStudentRotation
    );

    studentGrid.addEventListener(
      "mouseleave",
      startStudentRotation
    );

    studentGrid.addEventListener(
      "touchstart",
      stopStudentRotation,
      { passive: true }
    );

    studentGrid.addEventListener(
      "touchend",
      function () {

        setTimeout(
          startStudentRotation,
          1200
        );

      },
      { passive: true }
    );

  }

}


/* =========================================================
   LOAD STUDENTS
   ========================================================= */

async function loadPublicStudents() {

  showStudentLoading();


  /*
   * Prevent accidental fetch to placeholder URL.
   */

  if (
    !STUDENTS_API_URL ||
    STUDENTS_API_URL.includes(
      "PASTE_YOUR"
    )
  ) {

    console.warn(
      "Student API URL has not been configured."
    );

    showNoStudents();

    return;

  }


  try {

    const response =
      await fetch(
        STUDENTS_API_URL +
        "?action=getPublicStudents",
        {
          method: "GET",
          cache: "no-store"
        }
      );


    if (!response.ok) {

      throw new Error(
        "HTTP " +
        response.status
      );

    }


    const result =
      await response.json();


    if (!result.success) {

      throw new Error(
        result.message ||
        "Unable to load students."
      );

    }


    publicStudents =
      Array.isArray(result.students)
        ? result.students
        : [];


    /*
     * Start from the first page.
     */

    studentPage = 0;


    if (!publicStudents.length) {

      showNoStudents();

      return;

    }


    hideStudentLoading();

    hideNoStudents();

    renderStudentCarousel();

    startStudentRotation();


  } catch (error) {

    console.error(
      "Student loading failed:",
      error
    );

    showNoStudents();

  }

}


/* =========================================================
   RESPONSIVE CARD COUNT
   ========================================================= */

function getStudentCardsPerPage() {

  const width =
    window.innerWidth;


  if (width <= 650) {

    return STUDENT_MOBILE_COUNT;

  }


  if (width <= 900) {

    return STUDENT_TABLET_COUNT;

  }


  return STUDENT_DESKTOP_COUNT;

}


/* =========================================================
   PAGE COUNT
   ========================================================= */

function getStudentPageCount() {

  const perPage =
    getStudentCardsPerPage();


  return Math.max(
    1,
    Math.ceil(
      publicStudents.length /
      perPage
    )
  );

}


/* =========================================================
   CURRENT PAGE
   ========================================================= */

function getCurrentStudentPage() {

  const perPage =
    getStudentCardsPerPage();


  const start =
    studentPage *
    perPage;


  return publicStudents.slice(
    start,
    start + perPage
  );

}


/* =========================================================
   RENDER
   ========================================================= */

function renderStudentCarousel() {

  if (!studentGrid) return;


  const visibleStudents =
    getCurrentStudentPage();


  const pageCount =
    getStudentPageCount();


  /*
   * Safety:
   *
   * If changing screen size makes the current
   * page invalid, move back to the last page.
   */

  if (
    studentPage >= pageCount
  ) {

    studentPage =
      pageCount - 1;

    return renderStudentCarousel();

  }


  /*
   * Clear the previous cards.
   *
   * The cards themselves are recreated.
   *
   * There is no transform-based carousel movement,
   * which prevents flickering/distortion.
   */

  studentGrid.innerHTML = "";


  /*
   * Reset grid layout classes.
   */

  studentGrid.classList.remove(
    "student-grid-one",
    "student-grid-two"
  );


  if (
    visibleStudents.length === 1
  ) {

    studentGrid.classList.add(
      "student-grid-one"
    );

  }


  if (
    visibleStudents.length === 2
  ) {

    studentGrid.classList.add(
      "student-grid-two"
    );

  }


  /*
   * Create cards.
   */

  visibleStudents.forEach(
    function (student, index) {

      const card =
        createStudentCard(
          student,
          index
        );


      studentGrid.appendChild(
        card
      );

    }
  );


  /*
   * Counter.
   */

  if (studentCounter) {

    const start =
      studentPage *
      getStudentCardsPerPage() +
      1;

    const end =
      Math.min(
        (
          studentPage + 1
        ) *
        getStudentCardsPerPage(),
        publicStudents.length
      );


    studentCounter.textContent =
      start +
      "–" +
      end +
      " / " +
      publicStudents.length;

  }


  renderStudentDots();

  updateStudentControls();

}


/* =========================================================
   CREATE STUDENT CARD
   ========================================================= */

function createStudentCard(
  student,
  index
) {

  const card =
    document.createElement(
      "article"
    );


  card.className =
    "student-card";


  /*
   * Small stagger makes cards enter smoothly
   * without causing layout distortion.
   */

  card.style.animationDelay =
    (
      index * 70
    ) +
    "ms";


  const identity =
    document.createElement(
      "div"
    );


  identity.className =
    "student-identity";


  const avatar =
    document.createElement(
      "div"
    );


  avatar.className =
    "student-avatar";


  identity.appendChild(
    avatar
  );


  const name =
    document.createElement(
      "h3"
    );


  name.className =
    "student-name";


  name.textContent =
    safeStudentValue(
      student.name,
      "Student"
    );


  identity.appendChild(
    name
  );


  const role =
    document.createElement(
      "div"
    );


  role.className =
    "student-role";


  role.textContent =
    "Student";


  identity.appendChild(
    role
  );


  card.appendChild(
    identity
  );


  /*
   * Information.
   */

  const information =
    document.createElement(
      "div"
    );


  information.className =
    "student-information";


  /*
   * PUBLIC fields ONLY.
   */

  addStudentDetail(
    information,
    "Class",
    student.className
  );


  addStudentDetail(
    information,
    "School",
    student.school,
    true
  );


  addStudentDetail(
    information,
    "Board",
    student.board
  );


  addStudentDetail(
    information,
    "Subjects",
    student.subjects,
    true
  );


  addStudentDetail(
    information,
    "Preferred Tutor",
    student.preferredTutor,
    true
  );


  addStudentDetail(
    information,
    "Preferred Timing",
    student.preferredTiming,
    true
  );


  addStudentDetail(
    information,
    "City",
    student.city
  );


  card.appendChild(
    information
  );


  return card;

}


/* =========================================================
   ADD INFORMATION ROW
   ========================================================= */

function addStudentDetail(
  container,
  label,
  value,
  wrap
) {

  const cleanValue =
    safeStudentValue(
      value,
      ""
    );


  /*
   * Don't create empty rows.
   */

  if (!cleanValue) {

    return;

  }


  const row =
    document.createElement(
      "div"
    );


  row.className =
    "student-detail";


  const labelElement =
    document.createElement(
      "span"
    );


  labelElement.className =
    "student-detail-label";


  labelElement.textContent =
    label;


  const valueElement =
    document.createElement(
      "span"
    );


  valueElement.className =
    "student-detail-value";


  if (wrap) {

    valueElement.classList.add(
      "wrap"
    );

  }


  valueElement.textContent =
    cleanValue;


  row.appendChild(
    labelElement
  );


  row.appendChild(
    valueElement
  );


  container.appendChild(
    row
  );

}


/* =========================================================
   SAFE VALUE
   ========================================================= */

function safeStudentValue(
  value,
  fallback
) {

  const text =
    String(
      value ?? ""
    ).trim();


  return text ||
    fallback ||
    "";

}


/* =========================================================
   DOTS
   ========================================================= */

function renderStudentDots() {

  if (!studentDots) return;


  const pageCount =
    getStudentPageCount();


  studentDots.innerHTML =
    "";


  if (pageCount <= 1) {

    return;

  }


  for (
    let i = 0;
    i < pageCount;
    i++
  ) {

    const dot =
      document.createElement(
        "button"
      );


    dot.type =
      "button";


    dot.className =
      "student-dot";


    if (
      i === studentPage
    ) {

      dot.classList.add(
        "active"
      );

    }


    dot.setAttribute(
      "aria-label",
      "Show student group " +
      (i + 1)
    );


    dot.addEventListener(
      "click",
      function () {

        studentPage = i;

        renderStudentCarousel();

        restartStudentRotation();

      }
    );


    studentDots.appendChild(
      dot
    );

  }

}


/* =========================================================
   CONTROLS
   ========================================================= */

function updateStudentControls() {

  const pageCount =
    getStudentPageCount();


  if (!studentControls) {

    return;

  }


  if (pageCount <= 1) {

    studentControls.classList.add(
      "hidden"
    );

    return;

  }


  studentControls.classList.remove(
    "hidden"
  );

}


/* =========================================================
   NEXT
   ========================================================= */

function showNextStudentPage() {

  const pageCount =
    getStudentPageCount();


  if (pageCount <= 1) {

    return;

  }


  studentPage =
    (
      studentPage + 1
    ) %
    pageCount;


  renderStudentCarousel();

  restartStudentRotation();

}


/* =========================================================
   PREVIOUS
   ========================================================= */

function showPreviousStudentPage() {

  const pageCount =
    getStudentPageCount();


  if (pageCount <= 1) {

    return;

  }


  studentPage =
    (
      studentPage - 1 + pageCount
    ) %
    pageCount;


  renderStudentCarousel();

  restartStudentRotation();

}


/* =========================================================
   AUTOMATIC ROTATION
   ========================================================= */

function startStudentRotation() {

  stopStudentRotation();


  if (
    STUDENT_ROTATION_DELAY <= 0
  ) {

    return;

  }


  if (
    publicStudents.length <=
    getStudentCardsPerPage()
  ) {

    return;

  }


  /*
   * Don't rotate while Tutor mode is active.
   */

  if (
    studentsSection &&
    studentsSection.classList.contains(
      "hidden"
    )
  ) {

    return;

  }


  studentRotationTimer =
    setInterval(
      function () {

        showNextStudentPage();

      },
      STUDENT_ROTATION_DELAY
    );

}


function stopStudentRotation() {

  if (studentRotationTimer) {

    clearInterval(
      studentRotationTimer
    );

    studentRotationTimer =
      null;

  }

}


function restartStudentRotation() {

  stopStudentRotation();

  startStudentRotation();

}


/* =========================================================
   LOADING / EMPTY STATES
   ========================================================= */

function showStudentLoading() {

  if (studentLoading) {

    studentLoading.classList.remove(
      "hidden"
    );

  }


  if (studentGrid) {

    studentGrid.classList.add(
      "hidden"
    );

  }


  if (studentControls) {

    studentControls.classList.add(
      "hidden"
    );

  }


  if (noStudents) {

    noStudents.classList.add(
      "hidden"
    );

  }

}


function hideStudentLoading() {

  if (studentLoading) {

    studentLoading.classList.add(
      "hidden"
    );

  }


  if (studentGrid) {

    studentGrid.classList.remove(
      "hidden"
    );

  }

}


function showNoStudents() {

  if (studentLoading) {

    studentLoading.classList.add(
      "hidden"
    );

  }


  if (studentGrid) {

    studentGrid.classList.add(
      "hidden"
    );

  }


  if (studentControls) {

    studentControls.classList.add(
      "hidden"
    );

  }


  if (noStudents) {

    noStudents.classList.remove(
      "hidden"
    );

  }


  if (studentCounter) {

    studentCounter.textContent =
      "0 / 0";

  }

}


function hideNoStudents() {

  if (noStudents) {

    noStudents.classList.add(
      "hidden"
    );

  }

}


/* =========================================================
   RESIZE
   ========================================================= */

window.addEventListener(
  "resize",
  function () {

    clearTimeout(
      studentResizeTimer
    );


    studentResizeTimer =
      setTimeout(
        function () {

          handleStudentResize();

        },
        180
      );

  }
);


function handleStudentResize() {

  if (
    !publicStudents.length
  ) {

    return;

  }


  const pageCount =
    getStudentPageCount();


  if (
    studentPage >= pageCount
  ) {

    studentPage =
      pageCount - 1;

  }


  renderStudentCarousel();

}
