"use strict";

/************************************************************
 * URBANTUTORSITE - STUDENT PROFILE (front-end)
 *
 * The Student equivalent of tutorprofile.js, with the same
 * page structure (profile card + stats, filter tabs, class
 * cards) and the same look (tutorprofile.css is reused).
 *
 * ONE ACCOUNT -> MANY STUDENTS
 *   A parent logs in with one email. Every student registered
 *   on that email (each with their own Student ID, all sharing
 *   the same mobile number) is returned by the server. The
 *   switcher at the top moves between them, and "Add student"
 *   registers another child on the same account.
 *
 * Guards itself: no valid session -> error page with a link
 * back to student.html. The session is the one student.js
 * saves after a successful OTP ("urbantutorsite_student_session").
 *
 * API ACTIONS USED (see API Router.gs / Student Session.gs)
 *   getStudentProfile    addStudent    logoutStudent
 *   respondToDemo        (Accept / Reject on a tutor card)
 *   addTuition           ("Apply for new tuition" button)
 *
 * FIELDS THE BACKEND SENDS PER TUITION (one card per Demo ID)
 *   demoId, subject, medium, preferredTutor, preferredTiming,
 *   postedOn, timestampMs,
 *   status  <- "Finding Tutor", "Tutors Applied",
 *              "Demo Scheduled", "Processing", "Running",
 *              "Completed"
 *   tutorsApplied, demoDate, parentAccepted, tutorAccepted,
 *   price, duration, classes,
 *   tutors  <- one entry per tutor who applied:
 *              { tutorId, fullName, gender, degree, experience,
 *                status, demoDate, parentAccepted, parentRejected,
 *                tutorAccepted, tutorRejected, canAccept, canReject }
 *
 * PRIVACY: no email or mobile number (the parent's or the
 * tutor's) is sent to or shown on this page.
 ************************************************************/

const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwnhZnXpGVegX3kQtggtRjTej1JrsgfUdDyPrtMmuxh-IR_I8EGudmGAgLscda2y3nxLg/exec";

const STUDENT_SESSION_KEY = "urbantutorsite_student_session";
const SELECTED_STUDENT_KEY = "urbantutorsite_selected_student";

const TIMING_OPTIONS = [
  "8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM",
  "3 PM", "4 PM", "5 PM", "6 PM", "7 PM", "8 PM", "9 PM"
];


/************************************************************
 * SMALL HELPERS
 ************************************************************/

const $ = id => document.getElementById(id);

function showPage(name) {
  ["loading", "profile", "error"].forEach(n =>
    $(n + "Page").classList.toggle("hidden", n !== name)
  );
}

function escapeHTML(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getStudentSession() {
  try {
    const raw = localStorage.getItem(STUDENT_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    localStorage.removeItem(STUDENT_SESSION_KEY);
    return null;
  }
}

function clearStudentSession() {
  localStorage.removeItem(STUDENT_SESSION_KEY);
  try {
    if (sessionStorage.getItem("urbantutorsite_last_login") === "student") {
      sessionStorage.removeItem("urbantutorsite_last_login");
    }
  } catch (ignore) {}
}

function readSelected() {
  try { return localStorage.getItem(SELECTED_STUDENT_KEY) || ""; } catch (e) { return ""; }
}

function writeSelected(id) {
  try { localStorage.setItem(SELECTED_STUDENT_KEY, id || ""); } catch (e) {}
}

function initialsOf(name, fallback) {
  return String(name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join("") || fallback;
}

async function apiRequest(payload, timeoutMs = 45000) {

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {

    const response = await fetch(WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const raw = await response.text();

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    try {
      return JSON.parse(raw);
    } catch (parseError) {
      throw new Error("Invalid server response.");
    }

  } finally {
    clearTimeout(timer);
  }

}


/************************************************************
 * ICONS  (same set as tutorprofile.js, plus phone)
 ************************************************************/

const ICONS = {
  student: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  cap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg>',
  atom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><ellipse cx="12" cy="12" rx="10" ry="4.2"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)"/></svg>',
  flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6L4 19a1 1 0 0 0 1 3h14a1 1 0 0 0 1-3l-5-11V2"/><line x1="7" y1="2" x2="17" y2="2"/><line x1="7" y1="15" x2="17" y2="15"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 4 13c0-6 8-11 16-11 0 8-5 16-11 16-1.5 0-2.5-.5-3.5-1Z"/><path d="M4 20 12 12"/></svg>',
  ruler: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16.24 3.56 4.2 4.2a1 1 0 0 1 0 1.42l-11.46 11.46a1 1 0 0 1-1.42 0l-4.2-4.2a1 1 0 0 1 0-1.42L14.82 3.56a1 1 0 0 1 1.42 0Z"/><path d="m9 8 1 1"/><path d="m12 5 1 1"/><path d="m6 11 1 1"/><path d="m15 2 1 1"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>'
};
ICONS.user2 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M12 12v9"/><path d="M8 17h8"/></svg>';
ICONS.phone = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/></svg>';


/************************************************************
 * STATE
 ************************************************************/

const STATE = {
  account: {},
  students: [],
  selectedId: "",
  filter: "all",
  expanded: new Set()   // keys of the cards the parent has opened; empty = all collapsed
};


/************************************************************
 * LOAD PROFILE
 ************************************************************/

(async function init() {

  wireStaticEvents();

  const session = getStudentSession();

  if (!session || !session.sessionToken) {
    showError("You are not logged in.");
    return;
  }

  await loadProfile();

})();

async function loadProfile(selectAfter) {

  const session = getStudentSession();

  if (!session || !session.sessionToken) {
    showError("You are not logged in.");
    return;
  }

  try {

    const result = await apiRequest({
      action: "getStudentProfile",
      sessionToken: session.sessionToken
    });

    if (!result.success) {
      clearStudentSession();
      showError(result.message || "Your session has expired. Please log in again.");
      return;
    }

    STATE.account = result.account || {};
    STATE.students = result.students || [];

    // The tuition card only has these states: "Finding Tutor" until a
    // tutor is confirmed by BOTH sides, then "Running", then
    // "Completed" (or "Rejected" when every applicant was turned down). Everything in between (applied, demo scheduled,
    // waiting for approval) is shown on the tutor cards instead.
    STATE.students.forEach(st => (st.tuitions || []).forEach(t => {
      t.detailStatus = t.status;
      const key = String(t.status || "").toLowerCase();
      if (key === "running" || key === "completed") return;
      // Every tutor who applied has been rejected -> "Rejected"
      // (it goes back to "Finding Tutor" as soon as a new tutor applies).
      t.status = ((Number(t.tutorsApplied) || 0) === 0 && (Number(t.declinedCount) || 0) > 0)
        ? "Rejected"
        : "Finding Tutor";
    }));

    const wanted = selectAfter || urlStudentId() || readSelected();
    const exists = STATE.students.some(s => s.studentId === wanted);

    STATE.selectedId = exists
      ? wanted
      : (STATE.students[0] ? STATE.students[0].studentId : "");

    renderAll();
    showPage("profile");

  } catch (error) {
    console.error(error);
    showError("Unable to connect to the server. Please try again.");
  }

}

function urlStudentId() {
  try {
    return new URLSearchParams(window.location.search).get("student") || "";
  } catch (e) {
    return "";
  }
}

function showError(message) {
  $("errorMessage").textContent = message;
  showPage("error");
}

function selectedStudent() {
  return STATE.students.find(s => s.studentId === STATE.selectedId) || null;
}

function renderAll() {
  renderSwitcher();
  renderProfile(selectedStudent());
  renderClasses();
}


/************************************************************
 * STUDENT SWITCHER  (all Student IDs on this account)
 ************************************************************/

function renderSwitcher() {

  const account = STATE.account;

  // Privacy: only the parent's name is shown - never the
  // account's email or mobile number.
  $("accountLine").textContent =
    account.parentsName ? `Parent: ${account.parentsName}` : "";

  const pills = STATE.students.map(s => `
    <button
      class="student-pill"
      type="button"
      role="tab"
      data-student-id="${escapeHTML(s.studentId)}"
      aria-selected="${s.studentId === STATE.selectedId ? "true" : "false"}"
    >
      <span class="student-pill-avatar" aria-hidden="true">${escapeHTML(initialsOf(s.studentName, "S"))}</span>
      <span>
        <strong>${escapeHTML(s.studentName || "Student")}</strong>
        <small>${escapeHTML(s.studentId)}</small>
      </span>
    </button>
  `).join("");

  $("studentTabs").innerHTML = pills + `
    <button class="student-pill add-pill" type="button" id="addStudentButton">
      + Add student
    </button>
  `;

}


/************************************************************
 * RENDER PROFILE HEADER  (the selected student)
 ************************************************************/

function renderProfile(student) {

  if (!student) {
    $("profileName").textContent = "No students yet";
    $("profileAvatarInitials").textContent = "S";
    $("profileKicker").textContent = "Student Profile";
    ["profileClass", "profileBoard", "profileCity"].forEach(id => $(id).classList.add("hidden"));
    $("profileStats").innerHTML = "";
    $("applyTuitionButton").classList.add("hidden");
    return;
  }

  $("applyTuitionButton").classList.remove("hidden");

  const name = student.studentName || "Student";

  $("profileName").textContent = name;
  $("profileAvatarInitials").textContent = initialsOf(name, "S");
  $("profileKicker").textContent = student.studentId || "Student Profile";

  setChip("profileClass", student.className);
  setChip("profileBoard", student.board);
  setChip("profileCity", student.city);

  // Location on its own line, School directly below it.
  $("profileStats").innerHTML = [
    stat(student.city || student.pinCode || "—", "Location", "purple"),
    stat(student.school || "—", "School", "green")
  ].join("");

}

function setChip(id, value) {
  $(id).textContent = value || "";
  $(id).classList.toggle("hidden", !value);
}

function stat(value, label, accent) {
  return `
    <div class="stat" data-accent="${accent}">
      <div class="stat-rail"><span>${escapeHTML(label)}</span></div>
      <div>
        <div class="stat-value">${escapeHTML(value)}</div>
        <div class="stat-label">${escapeHTML(label)}</div>
      </div>
    </div>
  `;
}


/************************************************************
 * TUITION CARDS  +  FILTER TABS
 ************************************************************/

function classifyItem(item) {
  const s = String(item.status || "").toLowerCase();
  if (s === "completed") return "completed";
  if (s === "running") return "running";
  if (s === "processing") return "processing";
  if (s === "demo scheduled") return "demo";
  return "searching"; // "Finding Tutor" / "Tutors Applied"
}

// Filter tab a tutor card belongs to (the tuition card itself stays
// "Finding Tutor" until a tutor is confirmed).
function tutorGroup(tutor) {
  const s = String(tutor.status || "").toLowerCase();
  if (s === "demo scheduled") return "demo";
  if (s === "processing") return "processing";
  return "";
}

// Order of tuitions, top to bottom:
//   0 Demo Scheduled (a tutor has a demo scheduled / awaiting approval)
//   1 Finding Tutor
//   2 Running
//   3 Completed
//   4 Rejected
// and inside each group: latest to oldest.
function tuitionRank(item) {

  const s = String(item.status || "").toLowerCase();

  if (s === "running") return 2;
  if (s === "completed") return 3;
  if (s === "rejected") return 4;

  return (item.tutors || []).some(t => tutorGroup(t)) ? 0 : 1;

}

function sortClasses(items) {

  return items.slice().sort((a, b) => {

    const groupDiff = tuitionRank(a) - tuitionRank(b);

    if (groupDiff) return groupDiff;

    return (Number(b.timestampMs) || 0) - (Number(a.timestampMs) || 0) ||
      (String(b.demoId) > String(a.demoId) ? 1 : -1);

  });

}

function renderClasses() {

  const student = selectedStudent();
  const classes = (student && student.tuitions) || [];
  const filter = STATE.filter;

  const list = $("classesList");
  const empty = $("classesEmpty");
  const filterEmpty = $("filterEmpty");

  if (!classes.length) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    filterEmpty.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");

  const filtered = filter && filter !== "all"
    ? classes.filter(item =>
        classifyItem(item) === filter ||
        (item.tutors || []).some(t => tutorGroup(t) === filter))
    : classes;

  if (!filtered.length) {
    list.innerHTML = "";
    filterEmpty.classList.remove("hidden");
    return;
  }

  filterEmpty.classList.add("hidden");

  list.innerHTML = sortClasses(filtered)
    .map(item => renderClassCard(item, student))
    .join("");

  fitHeadText();

}

// Cards are collapsed by default. A click anywhere on a card opens it,
// and a click anywhere on an open card closes it again (Accept / Reject
// keep their own job while enabled, and selecting text never collapses a card).
//
// Only ONE tuition - its own card plus its tutor cards - can be open at
// a time: opening a card closes every card that belongs to another
// tuition.
function toggleCard(target, force) {

  const card = target.closest && target.closest("[data-card]");

  if (!card) return;

  // An enabled Accept / Reject does its own job. A disabled one is just
  // part of the card (it has pointer-events: none, so the click lands
  // on the card) and collapses it like any other spot.
  if (target.closest("button:not(:disabled)")) return;

  if (!force) {
    const selected = window.getSelection ? String(window.getSelection()) : "";
    if (selected.trim()) return;
  }

  const group = card.dataset.group;
  const collapsed = card.classList.contains("is-collapsed");

  if (collapsed) {

    // close everything that belongs to a different tuition
    $("classesList").querySelectorAll("[data-card]").forEach(other => {
      if (other.dataset.group !== group && !other.classList.contains("is-collapsed")) {
        other.classList.add("is-collapsed");
        other.setAttribute("aria-expanded", "false");
      }
    });

    Array.from(STATE.expanded).forEach(key => {
      if (key.split(":")[1] !== group) STATE.expanded.delete(key);
    });

    STATE.expanded.add(card.dataset.card);

  } else {

    STATE.expanded.delete(card.dataset.card);

  }

  card.classList.toggle("is-collapsed", !collapsed);
  card.setAttribute("aria-expanded", collapsed ? "true" : "false");

  fitHeadText();

}

// First-layer text of an open tutor card stays on ONE line: if it does
// not fit, the font size is reduced until it does.
function fitHeadText() {

  const list = $("classesList");

  if (!list || !list.querySelectorAll) return;

  list
    .querySelectorAll(".tutor-card:not(.is-collapsed) .tutor-head-row, .tutor-card:not(.is-collapsed) .tutor-head-note")
    .forEach(el => {

      el.style.fontSize = "";

      let size = parseFloat(window.getComputedStyle(el).fontSize) || 12;

      while (el.scrollWidth > el.clientWidth + 0.5 && size > 8) {
        size -= 0.5;
        el.style.fontSize = size + "px";
      }

    });

}

function joinAddress(address, city) {

  const a = String(address || "").trim();
  const c = String(city || "").trim();

  if (!a) return c;
  if (!c || a.toLowerCase().includes(c.toLowerCase())) return a;

  return `${a}, ${c}`;

}

function isTicked(value) {
  return value === true || /^(true|yes|y|1)$/i.test(String(value == null ? "" : value).trim());
}

// Same parsing as tutorprofile.js: "25 September 2026, 11:00 AM".
function formatDemoDateTime(value) {

  if (!value) return "";

  const date = new Date(value);

  if (isNaN(date.getTime())) return "";

  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  const day = String(date.getDate()).padStart(2, "0");
  const text = `${day} ${months[date.getMonth()]} ${date.getFullYear()}`;

  const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;

  if (!hasTime) return text;

  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return `${text}, ${time}`;

}

// Third layer of the card: one centred line per status,
// written from the parent's side.
function statusMessage(item) {

  switch (String(item.status || "").toLowerCase()) {

    case "finding tutor":
      return { text: "We are finding the right tutor for you" };

    case "rejected":
      return { text: "The tutors who applied were rejected, we are finding another tutor for you" };

    case "tutors applied": {
      const n = Number(item.tutorsApplied) || 0;
      return {
        text: n === 1
          ? "1 tutor has applied, we will schedule your demo soon"
          : `${n} tutors have applied, we will schedule your demo soon`
      };
    }

    case "demo scheduled": {
      const when = formatDemoDateTime(item.demoDate);
      return when
        ? { text: when, icon: ICONS.calendar, strong: true }
        : { text: "We will soon schedule your demo" };
    }

    case "processing":
      if (isTicked(item.parentAccepted) && !isTicked(item.tutorAccepted)) {
        return { text: "You have approved, waiting for the tutor's approval" };
      }
      return { text: "The tutor has approved, waiting for your approval" };

    case "running":
      return { text: "This class is running" };

    case "completed":
      return { text: "This class has been completed" };

    default:
      return { text: "" };

  }

}

function timingChips(value) {

  const parts = String(value || "")
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);

  if (!parts.length) return "";

  return `
    <div class="class-row-bottom">
      <div class="timing-col timing-col-full">
        <div class="timing-chips" aria-label="Preferred timing">
          <span class="timing-icon">${ICONS.clock}</span>
          ${parts.map(part => {
            const pm = /pm/i.test(part);
            return `<span class="timing-chip ${pm ? "pm" : "am"}">${pm ? ICONS.moon : ICONS.sun}${escapeHTML(part)}</span>`;
          }).join("")}
        </div>
      </div>
    </div>
  `;

}

// "Any" is shown as the two real options, anything else as chosen.
function isAny(value) {
  return /^any$/i.test(String(value == null ? "" : value).trim());
}

function mediumText(value) {
  const v = String(value == null ? "" : value).trim();
  return isAny(v) ? "Online | Offline" : v;
}

function preferredTutorText(value) {
  const v = String(value == null ? "" : value).trim();
  if (!v) return "";
  return isAny(v) ? "Male | Female" : `${v} tutor`;
}

function renderClassCard(item, student) {

  const statusClass = "status-" + String(item.status || "")
    .toLowerCase()
    .replace(/\s+/g, "-");

  const tutors = Array.isArray(item.tutors) ? item.tutors : [];

  const cardKey = `d:${item.demoId}`;
  const cardOpen = STATE.expanded.has(cardKey);

  // Second layer, 2 per row. (The tutor's own details now live on
  // the tutor cards stacked underneath this card.)
  const details = [
    [ICONS.globe, "Medium", mediumText(item.medium)],
    [ICONS.student, "Preferred tutor", preferredTutorText(item.preferredTutor)],
    [ICONS.file, "Fee", item.price ? `₹${item.price}` : ""],
    [ICONS.clock, "Duration", item.duration]
  ].filter(triple => triple[2] !== undefined && triple[2] !== null && String(triple[2]).trim() !== "");

  // Last row: the student's location (small) + PIN (bold).
  const locationText = joinAddress(student && student.address, student && student.city);
  const pinText = String((student && student.pinCode) || "").trim();

  const locationRow = (locationText || pinText) ? `
    <div class="class-detail class-detail-location" title="Location" aria-label="Location: ${escapeHTML([locationText, pinText].filter(Boolean).join(" - "))}">
      <span class="class-detail-icon">${ICONS.pin}</span>
      <span class="class-detail-value">${locationText ? `<span class="location-address">${escapeHTML(locationText)}</span>` : ""}${locationText && pinText ? `<span class="location-sep"> - </span>` : ""}${pinText ? `<span class="location-pin">${escapeHTML(pinText)}</span>` : ""}</span>
    </div>
  ` : "";

  // Fourth layer: while nobody is actively applied it stays here;
  // once tutors have applied, each tutor card carries its own line.
  const message = (Number(item.tutorsApplied) || 0) === 0
    ? statusMessage(item)
    : { text: "" };

  const messageRow = message.text ? `
    <div class="class-row-bottom class-row-message">
      <div class="class-status-message ${message.strong ? "strong" : ""}">
        ${message.icon || ""}
        <span>${escapeHTML(message.text)}</span>
      </div>
    </div>
  ` : "";

  const studentCard = `
    <div class="class-card${tutors.length ? " has-tutors" : ""}${cardOpen ? "" : " is-collapsed"}"
         data-card="${escapeHTML(cardKey)}" data-group="${escapeHTML(item.demoId)}" tabindex="0" aria-expanded="${cardOpen ? "true" : "false"}">
      <div class="class-spine ${statusClass}">
        ${item.demoId ? `<span class="class-spine-id">${escapeHTML(item.demoId)}</span><span class="class-spine-label">Demo ID</span>` : ""}
      </div>
      <div class="class-body">

        <div class="class-row-top">
          <span class="status-badge subject-badge">${escapeHTML(item.subject || "Subject")}</span>
          <span class="status-badge ${statusClass}">${escapeHTML(item.status || "")}</span>
        </div>

        ${(details.length || locationRow) ? `
          <div class="class-detail-grid">
            ${details.map(([icon, label, value]) => `
              <div class="class-detail" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}: ${escapeHTML(value)}">
                <span class="class-detail-icon">${icon}</span>
                <span class="class-detail-value">${escapeHTML(value)}</span>
              </div>
            `).join("")}
            ${locationRow}
          </div>
        ` : ""}

        ${timingChips(item.preferredTiming)}

        ${messageRow}

      </div>
    </div>
  `;

  if (!tutors.length) return studentCard;

  return `
    <div class="tuition-stack">
      ${studentCard}
      ${sortTutors(tutors).map(tutor => renderTutorCard(tutor, item)).join("")}
    </div>
  `;

}


/************************************************************
 * TUTOR CARD  (stacked under the tuition card it applied to)
 *
 *   spine   Tutor ID
 *   layer 1 Name / Gender / Degree / Experience
 *   layer 2 status text (+ demo date & time)
 *   layer 3 Accept / Reject
 ************************************************************/

// THIRD LAYER of a tutor card - only ever one of two things:
//   - "This tutor has applied, we will schedule your demo soon"
//   - the demo's date and time
// (plus, for a rejected tutor, who rejected: "You have rejected this
// tutor" / "Rejected by the Tutor"). Every other message lives in the first layer (tutorHead below).
function tutorStatusMessage(tutor) {

  const status = String(tutor.status || "").toLowerCase();

  if (status === "applied") {
    return { text: "This tutor has applied, we will schedule your demo soon" };
  }

  if (status === "declined") {
    return {
      text: isTicked(tutor.parentRejected)
        ? "You have rejected this tutor"
        : "Rejected by the Tutor"
    };
  }

  const when = formatDemoDateTime(tutor.demoDate);

  return when
    ? { text: when, icon: ICONS.calendar, strong: true }
    : { text: "" };

}

// FIRST LAYER of a tutor card: title (+ badge) and, when there is
// something to tell the parent, one small note line. Colour applies
// to THIS card only.
//   applied              -> "Applied by"
//   demo scheduled       -> "Demo Scheduled"
//   one side approved    -> only "You have approved, waiting for the
//                           tutor's approval" (or the tutor's version)
//   approved by both     -> "Your Tutor"  + Running badge
//   completed            -> "Your Tutor"  + Completed badge
//   rejected             -> "Applied by"  + Rejected badge
function tutorHead(tutor) {

  switch (String(tutor.status || "").toLowerCase()) {

    case "demo scheduled":
      return { title: "Demo Scheduled", badge: "", note: "", cls: "status-demo-scheduled" };

    case "processing":
      // Only the waiting message - no "Demo Scheduled" title.
      return {
        title: "",
        badge: "",
        note: isTicked(tutor.parentAccepted) && !isTicked(tutor.tutorAccepted)
          ? "You have approved, waiting for the tutor's approval"
          : "The tutor has approved, waiting for your approval",
        cls: "status-demo-scheduled"
      };

    case "running":
      return { title: "Your Tutor", badge: "Running", note: "", cls: "status-running" };

    case "completed":
      return { title: "Your Tutor", badge: "Completed", note: "", cls: "status-completed" };

    case "declined":
      return { title: "Applied by", badge: "Rejected", note: "", cls: "status-declined" };

    default:
      return { title: "Applied by", badge: "", note: "", cls: "status-applied" };

  }

}

// Running, Completed, Demo Scheduled, Applied, Rejected
const TUTOR_ORDER = { running: 0, completed: 1, processing: 2, "demo scheduled": 2, applied: 3, declined: 4 };

function sortTutors(tutors) {

  return tutors
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const ra = TUTOR_ORDER[String(a.t.status || "").toLowerCase()];
      const rb = TUTOR_ORDER[String(b.t.status || "").toLowerCase()];
      return ((ra === undefined ? 9 : ra) - (rb === undefined ? 9 : rb)) || (a.i - b.i);
    })
    .map(x => x.t);

}

function renderTutorCard(tutor, item) {

  const head = tutorHead(tutor);

  const key = `t:${item.demoId}:${tutor.tutorId}`;
  const open = STATE.expanded.has(key);

  const exp = String(tutor.experience || "").trim();
  const expNumber = Number(exp);

  const info = [
    [ICONS.student, "Name", tutor.fullName],
    [ICONS.user2, "Gender", tutor.gender],
    [ICONS.cap, "Degree", tutor.degree],
    [ICONS.clock, "Experience", exp ? (isNaN(expNumber) ? exp : `${exp} ${expNumber === 1 ? "yr" : "yrs"}`) : ""]
  ].filter(row => row[2] !== undefined && row[2] !== null && String(row[2]).trim() !== "");

  const message = tutorStatusMessage(tutor);

  const acceptedByMe = isTicked(tutor.parentAccepted);
  const rejectedByMe = isTicked(tutor.parentRejected);

  // Always shown; the server switches them off (canAccept / canReject)
  // once an answer is given or another tutor is confirmed.
  const showButtons = true;

  const acceptTitle = tutor.canAccept
    ? "Accept this tutor"
    : (acceptedByMe ? "You accepted this tutor" : "Accept is not available right now");

  const data = `data-demo="${escapeHTML(item.demoId)}" data-tutor="${escapeHTML(tutor.tutorId)}"`;

  return `
    <div class="class-card tutor-card tone-${head.cls.slice(7)}${open ? "" : " is-collapsed"}"
         data-card="${escapeHTML(key)}" data-group="${escapeHTML(item.demoId)}" tabindex="0" aria-expanded="${open ? "true" : "false"}">
      <div class="class-spine ${head.cls}">
        ${tutor.tutorId ? `<span class="class-spine-id">${escapeHTML(tutor.tutorId)}</span><span class="class-spine-label">Tutor ID</span>` : ""}
      </div>
      <div class="class-body">

        <div class="tutor-mini">
          <span class="tutor-mini-name">${escapeHTML(tutor.fullName || "Tutor")}</span>
          <span class="tutor-mini-gender">${escapeHTML(tutor.gender || "")}</span>
        </div>

        <div class="tutor-head ${head.cls}">
          ${(head.title || head.badge) ? `<div class="tutor-head-row${(head.title && head.badge) ? " two" : ""}">
            <span class="tutor-head-title">${escapeHTML(head.title)}</span>
            ${head.badge ? `<span class="tutor-head-badge">${escapeHTML(head.badge)}</span>` : ""}
          </div>` : ""}
          ${head.note ? `<div class="tutor-head-note">${escapeHTML(head.note)}</div>` : ""}
        </div>

        ${info.length ? `
          <div class="class-detail-grid tutor-info-grid">
            ${info.map(([icon, label, value]) => `
              <div class="class-detail" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}: ${escapeHTML(value)}">
                <span class="class-detail-icon">${icon}</span>
                <span class="class-detail-value">${escapeHTML(value)}</span>
              </div>
            `).join("")}
          </div>
        ` : ""}

        ${message.text ? `
          <div class="class-row-bottom class-row-message">
            <div class="class-status-message ${message.strong ? "strong" : ""}">
              ${message.icon || ""}
              <span>${escapeHTML(message.text)}</span>
            </div>
          </div>
        ` : ""}

        ${showButtons ? `
          <div class="tutor-actions">
            <button type="button" class="tutor-btn tutor-btn-accept${acceptedByMe ? " chosen" : ""}"
              data-respond="accept" ${data}
              title="${escapeHTML(acceptTitle)}"
              ${tutor.canAccept ? "" : "disabled"}>Accept</button>
            <button type="button" class="tutor-btn tutor-btn-reject${rejectedByMe ? " chosen" : ""}"
              data-respond="reject" ${data}
              title="${rejectedByMe ? "You rejected this tutor" : "Reject this tutor"}"
              ${tutor.canReject ? "" : "disabled"}>Reject</button>
          </div>
        ` : ""}

      </div>
    </div>
  `;

}


/************************************************************
 * ACCEPT / REJECT  (parent's answer for one tutor)
 ************************************************************/

let toastTimer = null;
let fitTimer = null;

function showToast(text, isError) {

  let el = $("profileToast");

  if (!el) {
    el = document.createElement("div");
    el.id = "profileToast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }

  el.textContent = text;
  el.className = "profile-toast show" + (isError ? " error" : "");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4000);

}

async function respondToTutor(button) {

  const decision = button.dataset.respond;
  const demoId = button.dataset.demo;
  const tutorId = button.dataset.tutor;

  const question = decision === "accept"
    ? "Accept this tutor for the tuition?"
    : "Reject this tutor? This cannot be undone here.";

  if (!window.confirm(question)) return;

  const session = getStudentSession();

  if (!session || !session.sessionToken) {
    showError("You are not logged in.");
    return;
  }

  const buttons = button.closest(".tutor-actions").querySelectorAll("button");
  buttons.forEach(b => { b.disabled = true; });

  const label = button.textContent;
  button.textContent = "Saving...";

  try {

    const result = await apiRequest({
      action: "respondToDemo",
      sessionToken: session.sessionToken,
      demoId,
      tutorId,
      decision
    });

    if (!result.success) {
      showToast(result.message || "Your response could not be saved.", true);
      button.textContent = label;
      buttons.forEach(b => { b.disabled = false; });
      return;
    }

    await loadProfile(STATE.selectedId);

    showToast(result.message || "Saved.");

  } catch (error) {

    console.error(error);
    showToast("Unable to connect to the server. Please try again.", true);
    button.textContent = label;
    buttons.forEach(b => { b.disabled = false; });

  }

}


/************************************************************
 * EVENTS
 ************************************************************/

function wireStaticEvents() {

  // Switch student / open "Add student"
  $("studentTabs").addEventListener("click", (event) => {

    if (event.target.closest("#addStudentButton")) {
      openAddStudent();
      return;
    }

    const pill = event.target.closest("[data-student-id]");

    if (!pill) return;

    STATE.selectedId = pill.dataset.studentId;
    writeSelected(STATE.selectedId);

    renderAll();

  });

  // Filter tabs
  $("filterTabs").addEventListener("click", (event) => {

    const btn = event.target.closest(".filter-tab");
    if (!btn) return;

    $("filterTabs").querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");

    STATE.filter = btn.dataset.filter;
    renderClasses();

  });

  // Accept / Reject on a tutor card
  $("classesList").addEventListener("click", (event) => {

    const button = event.target.closest("[data-respond]");

    if (button) {
      if (!button.disabled) respondToTutor(button);
      return;
    }

    toggleCard(event.target);

  });

  $("classesList").addEventListener("keydown", (event) => {

    if (event.key !== "Enter" && event.key !== " ") return;

    const card = event.target.closest && event.target.closest("[data-card]");

    if (!card || event.target !== card) return;

    event.preventDefault();
    toggleCard(card, true);

  });

  window.addEventListener("resize", () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitHeadText, 120);
  });

  // Logout
  $("logoutButton").addEventListener("click", logout);

  // Apply for new tuition (button at the bottom of the profile card)
  $("applyTuitionButton").addEventListener("click", openNewTuition);

  $("newTimings").innerHTML = TIMING_OPTIONS.map(t => `
    <label><input type="checkbox" name="newTiming" value="${t}"><span>${t}</span></label>
  `).join("");

  $("closeNewTuition").addEventListener("click", closeNewTuition);

  $("newTuitionModal").addEventListener("click", (event) => {
    if (event.target.hasAttribute("data-close-new")) closeNewTuition();
  });

  $("newTuitionForm").addEventListener("submit", submitNewTuition);

  // Add student modal
  $("addTimings").innerHTML = TIMING_OPTIONS.map(t => `
    <label><input type="checkbox" name="addTiming" value="${t}"><span>${t}</span></label>
  `).join("");

  $("closeAddStudent").addEventListener("click", closeAddStudent);

  $("addStudentModal").addEventListener("click", (event) => {
    if (event.target.hasAttribute("data-close-add")) closeAddStudent();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("addStudentModal").classList.contains("hidden")) {
      closeAddStudent();
    }
    if (event.key === "Escape" && !$("newTuitionModal").classList.contains("hidden")) {
      closeNewTuition();
    }
  });

  $("addSameAddress").addEventListener("change", toggleAddressFields);

  $("addPin").addEventListener("input", () => {
    $("addPin").value = $("addPin").value.replace(/\D/g, "").slice(0, 6);
  });

  $("addStudentForm").addEventListener("submit", submitAddStudent);

}


/************************************************************
 * ADD STUDENT  (sibling on the same email + mobile number)
 ************************************************************/

function openAddStudent() {

  $("addStudentForm").reset();
  $("addStudentMessage").textContent = "";
  toggleAddressFields();

  $("addStudentModal").classList.remove("hidden");
  $("addStudentModal").setAttribute("aria-hidden", "false");
  document.body.classList.add("add-modal-open");

  setTimeout(() => $("addStudentName").focus(), 50);

}

function closeAddStudent() {

  $("addStudentModal").classList.add("hidden");
  $("addStudentModal").setAttribute("aria-hidden", "true");
  document.body.classList.remove("add-modal-open");

}

function toggleAddressFields() {

  const show = !$("addSameAddress").checked;

  document.querySelectorAll("[data-address]").forEach(node => {
    node.classList.toggle("hidden", !show);
  });

}

function radioValue(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : "";
}

function clean(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

async function submitAddStudent(event) {

  event.preventDefault();

  const message = $("addStudentMessage");
  message.textContent = "";

  const student = {
    studentName: clean($("addStudentName").value),
    gender: radioValue("addGender"),
    school: clean($("addSchool").value),
    className: clean($("addClass").value),
    board: clean($("addBoard").value),
    subjects: clean($("addSubjects").value),
    preferredTutor: radioValue("addTutor"),
    medium: radioValue("addMedium"),
    preferredTiming: Array.from(document.querySelectorAll('input[name="addTiming"]:checked'))
      .map(input => input.value)
      .join(", ")
  };

  const sameAddress = $("addSameAddress").checked;

  if (!sameAddress) {
    student.address = clean($("addAddress").value);
    student.city = clean($("addCity").value);
    student.pinCode = clean($("addPin").value);
  }

  const problem =
    student.studentName.length < 2 ? ["addStudentName", "Enter the student's name."] :
    !student.gender ? [null, "Select the student's gender."] :
    student.school.length < 2 ? ["addSchool", "Enter the school or college."] :
    !student.className ? ["addClass", "Enter the class or stream."] :
    !student.board ? ["addBoard", "Enter the board or university."] :
    student.subjects.length < 2 ? ["addSubjects", "Enter at least one subject."] :
    !student.preferredTiming ? [null, "Select at least one preferred timing."] :
    (!sameAddress && student.address.length < 3) ? ["addAddress", "Enter the address."] :
    (!sameAddress && student.city.length < 2) ? ["addCity", "Enter the city."] :
    (!sameAddress && !/^\d{6}$/.test(student.pinCode)) ? ["addPin", "PIN code must be 6 digits."] :
    null;

  if (problem) {
    message.textContent = problem[1];
    if (problem[0]) $(problem[0]).focus();
    return;
  }

  const session = getStudentSession();

  if (!session || !session.sessionToken) {
    closeAddStudent();
    showError("You are not logged in.");
    return;
  }

  const button = $("addStudentSubmit");
  button.disabled = true;
  button.textContent = "Adding student...";

  try {

    const result = await apiRequest({
      action: "addStudent",
      sessionToken: session.sessionToken,
      student: student
    });

    if (!result.success) {
      message.textContent = result.message || "The student could not be added.";
      return;
    }

    closeAddStudent();

    writeSelected(result.studentId);

    STATE.filter = "all";
    $("filterTabs").querySelectorAll(".filter-tab").forEach(t =>
      t.classList.toggle("active", t.dataset.filter === "all")
    );

    await loadProfile(result.studentId);

  } catch (error) {
    console.error(error);
    message.textContent = "Unable to connect to the server. Please try again.";
  } finally {
    button.disabled = false;
    button.textContent = "Add student";
  }

}


/************************************************************
 * APPLY FOR NEW TUITION  (for the selected student)
 ************************************************************/

function openNewTuition() {

  const student = selectedStudent();

  if (!student) return;

  $("newTuitionForm").reset();
  $("newTuitionMessage").textContent = "";
  $("newTuitionFor").textContent =
    `${student.studentName || "Student"} · ${student.studentId}`;

  $("newTuitionModal").classList.remove("hidden");
  $("newTuitionModal").setAttribute("aria-hidden", "false");
  document.body.classList.add("add-modal-open");

  setTimeout(() => $("newSubjects").focus(), 50);

}

function closeNewTuition() {

  $("newTuitionModal").classList.add("hidden");
  $("newTuitionModal").setAttribute("aria-hidden", "true");
  document.body.classList.remove("add-modal-open");

}

async function submitNewTuition(event) {

  event.preventDefault();

  const message = $("newTuitionMessage");
  message.textContent = "";

  const student = selectedStudent();

  if (!student) return;

  const tuition = {
    subjects: clean($("newSubjects").value),
    preferredTutor: radioValue("newTutor") || "Any",
    medium: radioValue("newMedium") || "Any",
    preferredTiming: Array.from(document.querySelectorAll('input[name="newTiming"]:checked'))
      .map(input => input.value)
      .join(", ")
  };

  if (tuition.subjects.length < 2) {
    message.textContent = "Enter at least one subject.";
    $("newSubjects").focus();
    return;
  }

  if (!tuition.preferredTiming) {
    message.textContent = "Select at least one preferred timing.";
    return;
  }

  const session = getStudentSession();

  if (!session || !session.sessionToken) {
    closeNewTuition();
    showError("You are not logged in.");
    return;
  }

  const button = $("newTuitionSubmit");
  button.disabled = true;
  button.textContent = "Posting...";

  try {

    const result = await apiRequest({
      action: "addTuition",
      sessionToken: session.sessionToken,
      studentId: student.studentId,
      tuition
    });

    if (!result.success) {
      message.textContent = result.message || "The tuition could not be added.";
      return;
    }

    closeNewTuition();

    STATE.filter = "all";
    $("filterTabs").querySelectorAll(".filter-tab").forEach(t =>
      t.classList.toggle("active", t.dataset.filter === "all")
    );

    await loadProfile(student.studentId);

    showToast(result.message || "Your tuition request has been posted.");

  } catch (error) {
    console.error(error);
    message.textContent = "Unable to connect to the server. Please try again.";
  } finally {
    button.disabled = false;
    button.textContent = "Post tuition request";
  }

}


/************************************************************
 * LOGOUT
 ************************************************************/

async function logout() {

  const button = $("logoutButton");
  button.disabled = true;
  button.textContent = "Logging out...";

  const session = getStudentSession();

  if (session && session.sessionToken) {
    try {
      await apiRequest({
        action: "logoutStudent",
        sessionToken: session.sessionToken
      });
    } catch (error) {
      console.error(error);
    }
  }

  clearStudentSession();

  try { localStorage.removeItem(SELECTED_STUDENT_KEY); } catch (e) {}

  window.location.href = "index.html";

}
