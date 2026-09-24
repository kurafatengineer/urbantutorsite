"use strict";

/************************************************************
 * URBANTUTORSITE - TUTOR PROFILE (front-end)
 *
 * Guards itself: no valid session -> sent back to
 * tutorregistration.html. Valid session -> calls
 * "get_tutor_profile" and renders ONLY the data that comes back
 * for this tutor (see supabase-setup-3-register-profile.sql for how
 * privacy is enforced server-side via RLS and auth checks).
 *
 * RPC FUNCTIONS USED (see supabase-setup-3/4-*.sql)
 *   get_tutor_profile      (window.sbCall)
 *   respond_to_demo_tutor  (window.sbCall)
 *   signOut                (window.sb.auth.signOut)
 *
 * FIELDS THE BACKEND (get_tutor_profile RPC) MUST SEND PER CLASS:
 *   demoId          <- "Demo ID" header on the Demos sheet
 *   demoDate        <- merged from the "Demo Date" + "Demo Time"
 *                       headers on the Demos sheet,
 *                       shown in the "Today / 11:00 AM" badge
 *   status          <- one of: "Applied", "Demo Scheduled",
 *                       "Processing", "Running", "Completed",
 *                       "Declined"
 *   tutorAccepted, parentAccepted, tutorRejected, parentRejected
 *                   <- raw checkbox values, used for the third
 *                       layer's message
 *   timestampMs, rowNumber <- for latest-to-oldest sorting
 *   address, city, pinCode <- third row of the middle layer
 *   subject, studentName, className, board, medium, duration
 *   — unchanged from before.
 *   preferredTutor           <- shown next to Medium
 *   canAccept, canReject     <- switch the Accept / Reject buttons
 *
 * CARDS: collapsed by default (Subject left, Medium right); a tap
 * anywhere on a card opens / closes it, and only one card is open at
 * a time - same behaviour as the Student Profile.
 ************************************************************/

const TUTOR_SESSION_KEY = "urbantutorsite_tutor_session";


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

function getTutorSession() {
  try {
    const raw = localStorage.getItem(TUTOR_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    localStorage.removeItem(TUTOR_SESSION_KEY);
    return null;
  }
}

function clearTutorSession() {
  localStorage.removeItem(TUTOR_SESSION_KEY);
}

async function hasSession() {
  try {
    const { data: { session } } = await window.sb.auth.getSession();
    return !!session;
  } catch (error) {
    console.error("Session check error:", error);
    return false;
  }
}


/************************************************************
 * ICONS  (inline SVG strings, coloured via currentColor)
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
  user2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M12 12v9"/><path d="M8 17h8"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>'
};


/************************************************************
 * LOAD PROFILE
 ************************************************************/

(async function init() {

  wireClassEvents();

  await loadProfile();

})();

async function loadProfile() {

  if (!(await hasSession())) {
    showError("You are not logged in.");
    return;
  }

  try {

    const result = await window.sbCall("get_tutor_profile", {});

    if (!result || !result.success) {
      clearTutorSession();
      showError((result && result.message) || "Your session has expired. Please log in again.");
      return;
    }

    renderProfile(result.profile || {}, result.classes || []);
    initClasses(result.classes || []);

    showPage("profile");

  } catch (error) {
    console.error(error);
    showError("Unable to connect to the server. Please try again.");
  }

}

function showError(message) {
  $("errorMessage").textContent = message;
  showPage("error");
}


/************************************************************
 * RENDER PROFILE HEADER
 ************************************************************/

function renderProfile(profile, classes) {

  const fullName = profile.fullName || "Tutor";

  $("profileName").textContent = fullName;

  // Header avatar shows this tutor's initials.
  if (window.UrbanSession) window.UrbanSession.rememberName("tutor", fullName);

  const initials = fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join("");

  // Always show the name-letter avatar — never a photo, even
  // if profile.profileImage exists.
  $("profileAvatarInitials").textContent = initials || "T";

  $("profileKicker").textContent = profile.tutorId
    ? profile.tutorId
    : "Tutor Profile";

  $("profileRegisterAs").textContent = profile.registerAs || "Tutor";
  $("profileCity").textContent = profile.city || "";
  $("profileCity").classList.toggle("hidden", !profile.city);

  // Every tutor action waits for a Verified profile.
  const verified = String(profile.verificationStatus || "").trim().toLowerCase() === "verified";
  $("verifyNotice")?.classList.toggle("hidden", verified);

  if (!verified && String(profile.verificationStatus || "").trim().toLowerCase() === "rejected") {
    $("verifyNotice").textContent =
      "Your profile verification was rejected. Please contact us to update your details.";
  }

  const statusEl = $("profileStatus");
  const status = (profile.verificationStatus || "Pending for Verification");
  statusEl.textContent = status;
  statusEl.className = "chip " + statusChipClass(status);

  const activeClassCount = (classes || []).filter(item => {
    const s = String(item.status || "").toLowerCase();
    return s === "completed" || s === "running";
  }).length;

  $("profileStats").innerHTML = [
    stat(profile.experience ? `${profile.experience} ${Number(profile.experience) === 1 ? "Year" : "Years"}` : "—", "Experience", "green"),
    stat(profile.subjectsTeach || "—", "Teaches", "blue"),
    stat(String(activeClassCount || "—"), "Classes", "gold"),
    stat(profile.location || profile.city || "—", "Location", "purple")
  ].join("");

}

function statusChipClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "verified") return "chip-verified";
  if (s === "rejected") return "chip-rejected";
  return "chip-pending";
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
 * SUBJECT PILL
 ************************************************************/

// The subject pill is always a plain black chip (see
// .subject-badge in tutorprofile.css) — no colour keyed to the
// subject text, and no borrowed status colour. That keeps it
// visually distinct from every status pill (including
// "Completed") with zero risk of ever landing on the same
// colour as one.


/************************************************************
 * DATE / TIME HELPERS
 ************************************************************/






/************************************************************
 * RENDER DEMO / CLASS STATUS LIST  +  FILTER TABS
 ************************************************************/

let ALL_CLASSES = [];
let CURRENT_FILTER = "all";
let OPEN_CARD = "";   // the one open card (Demo ID); "" = all collapsed

function classifyItem(item) {
  const s = String(item.status || "").toLowerCase();
  if (s === "completed") return "completed";
  if (s === "running") return "running";
  if (s === "declined") return "declined";
  if (s === "processing") return "processing";
  if (s === "demo scheduled") return "demo";
  return "applied"; // "Applied" (the starting status)
}

// Card order: by status group in this order, then latest to
// oldest within each group.
const STATUS_ORDER = ["applied", "demo", "processing", "running", "completed", "declined"];

function sortClasses(items) {

  return items.slice().sort((a, b) => {

    const groupDiff =
      STATUS_ORDER.indexOf(classifyItem(a)) - STATUS_ORDER.indexOf(classifyItem(b));

    if (groupDiff) return groupDiff;

    const timeDiff = (Number(b.timestampMs) || 0) - (Number(a.timestampMs) || 0);

    if (timeDiff) return timeDiff;

    return (Number(b.rowNumber) || 0) - (Number(a.rowNumber) || 0);

  });

}

function initClasses(classes) {

  ALL_CLASSES = classes;

  renderClasses(ALL_CLASSES, CURRENT_FILTER);

}

// Wired once: filter tabs, open / close cards, Accept / Reject.
function wireClassEvents() {

  $("filterTabs").addEventListener("click", (event) => {
    const btn = event.target.closest(".filter-tab");
    if (!btn) return;

    $("filterTabs").querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");

    CURRENT_FILTER = btn.dataset.filter;
    renderClasses(ALL_CLASSES, CURRENT_FILTER);
  });

  $("classesList").addEventListener("click", (event) => {

    const button = event.target.closest("[data-respond]");

    if (button) {
      if (!button.disabled) respondToTuition(button);
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

}

// Cards are collapsed by default. A tap anywhere on a card opens it,
// a tap anywhere on an open card closes it (an enabled Accept / Reject
// keeps its own job; selecting text never collapses a card). Only one
// card is open at a time.
function toggleCard(target, force) {

  const card = target.closest && target.closest("[data-card]");

  if (!card) return;

  if (target.closest("button:not(:disabled)")) return;

  if (!force) {
    const selected = window.getSelection ? String(window.getSelection()) : "";
    if (selected.trim()) return;
  }

  const collapsed = card.classList.contains("is-collapsed");

  if (collapsed) {
    $("classesList").querySelectorAll("[data-card]").forEach(other => {
      if (other !== card && !other.classList.contains("is-collapsed")) {
        other.classList.add("is-collapsed");
        other.setAttribute("aria-expanded", "false");
      }
    });
  }

  card.classList.toggle("is-collapsed", !collapsed);
  card.setAttribute("aria-expanded", collapsed ? "true" : "false");

  OPEN_CARD = collapsed ? card.dataset.card : "";

}

function renderClasses(classes, filter) {

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
    ? classes.filter(item => classifyItem(item) === filter)
    : classes;

  if (!filtered.length) {
    list.innerHTML = "";
    filterEmpty.classList.remove("hidden");
    return;
  }

  filterEmpty.classList.add("hidden");

  list.innerHTML = sortClasses(filtered).map(renderClassCard).join("");

}

// Address with the city added at the end if the address doesn't
// already mention it (same as the Tuitions Available page).
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

// "25 September 2026, 11:00 AM" (time left off if there isn't one).
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

// Third layer of the card: one centred line per status.
function statusMessage(item) {

  const group = classifyItem(item);

  switch (group) {

    case "applied":
      return { text: "We will soon schedule your demo" };

    case "demo": {
      const when = formatDemoDateTime(item.demoDate);
      return when
        ? { text: when, icon: ICONS.calendar, strong: true }
        : { text: "We will soon schedule your demo" };
    }

    case "processing":
      if (isTicked(item.tutorAccepted) && !isTicked(item.parentAccepted)) {
        return { text: "Waiting for parents' approval" };
      }
      return { text: "Parents have approved, waiting for your approval" };

    case "running":
      return { text: "This class is running" };

    case "completed":
      return { text: "You have completed this class" };

    case "declined":
      if (item.terminated) {
        return { text: "This tuition has been closed by the office" };
      }
      if (isTicked(item.tutorRejected) && isTicked(item.parentRejected)) {
        return { text: "Rejected by you and the parents" };
      }
      if (isTicked(item.tutorRejected)) {
        return { text: "Rejected by you" };
      }
      return { text: "Rejected by the parents" };

    default:
      return { text: "" };

  }

}

function renderClassCard(item) {

  const statusClass = "status-" + String(item.status || "")
    .toLowerCase()
    .replace(/\s+/g, "-");

  // First two rows of the middle layer, 2 per row:
  // Student, Class, Gender (preferred tutor), Medium.
  // "Any" is shown as both real options.
  const details = [
    [ICONS.student, "Student", item.studentName],
    [ICONS.cap, "Class", item.className],
    [ICONS.user2, "Gender", genderText(item.preferredTutor)],
    [ICONS.globe, "Medium", mediumText(item.medium)]
  ].filter(triple => triple[2] !== undefined && triple[2] !== null && String(triple[2]).trim() !== "");

  const key = String(item.demoId || item.rowNumber || "");
  const open = OPEN_CARD !== "" && OPEN_CARD === key;

  // Fourth layer: Accept | Reject, 50% each (same as the Student
  // Profile). Always shown; greyed out when they don't apply.
  const acceptedByMe = isTicked(item.tutorAccepted);
  const rejectedByMe = isTicked(item.tutorRejected);

  const actionsRow = item.demoId ? `
    <div class="tutor-actions">
      <button type="button" class="tutor-btn tutor-btn-accept${acceptedByMe ? " chosen" : ""}"
        data-respond="accept" data-demo="${escapeHTML(item.demoId)}"
        title="${escapeHTML(item.canAccept ? "Accept this tuition" : (acceptedByMe ? "You accepted this tuition" : "Accept is not available right now"))}"
        ${item.canAccept ? "" : "disabled"}>Accept</button>
      <button type="button" class="tutor-btn tutor-btn-reject${rejectedByMe ? " chosen" : ""}"
        data-respond="reject" data-demo="${escapeHTML(item.demoId)}"
        title="${escapeHTML(rejectedByMe ? "You rejected this tuition" : "Reject this tuition")}"
        ${item.canReject ? "" : "disabled"}>Reject</button>
    </div>
  ` : "";

  // Third row: the WHOLE line - location (small) + PIN (bold).
  const locationText = joinAddress(item.address, item.city);
  const pinText = String(item.pinCode || "").trim();

  const locationRow = (locationText || pinText) ? `
    <div class="class-detail class-detail-location" title="Location" aria-label="Location: ${escapeHTML([locationText, pinText].filter(Boolean).join(" - "))}">
      <span class="class-detail-icon">${ICONS.pin}</span>
      <span class="class-detail-value">${locationText ? `<span class="location-address">${escapeHTML(locationText)}</span>` : ""}${locationText && pinText ? `<span class="location-sep"> - </span>` : ""}${pinText ? `<span class="location-pin">${escapeHTML(pinText)}</span>` : ""}</span>
    </div>
  ` : "";

  const message = statusMessage(item);

  const bottomRow = message.text ? `
    <div class="class-row-bottom class-row-message">
      <div class="class-status-message ${message.strong ? "strong" : ""}">
        ${message.icon || ""}
        <span>${escapeHTML(message.text)}</span>
      </div>
    </div>
  ` : "";

  return `
    <div class="class-card tone-${statusClass.slice(7)}${open ? "" : " is-collapsed"}"
         data-card="${escapeHTML(key)}" tabindex="0" aria-expanded="${open ? "true" : "false"}">
      <div class="class-spine ${statusClass}">
        ${item.demoId ? `<span class="class-spine-id">${escapeHTML(item.demoId)}</span><span class="class-spine-label">Demo ID</span>` : ""}
      </div>
      <div class="class-body">

        <div class="class-mini class-row-top">
          <span class="status-badge subject-badge">${escapeHTML(item.subject || "Subject")}</span>
          ${item.medium ? `<span class="status-badge ${statusClass}">${escapeHTML(mediumText(item.medium))}</span>` : ""}
        </div>

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

        ${bottomRow}

        ${actionsRow}

      </div>
    </div>
  `;

}


/************************************************************
 * "ANY" -> BOTH OPTIONS
 ************************************************************/

function isAny(value) {
  return /^any$/i.test(String(value == null ? "" : value).trim());
}

function mediumText(value) {
  const v = String(value == null ? "" : value).trim();
  return isAny(v) ? "Online | Offline" : v;
}

function genderText(value) {
  const v = String(value == null ? "" : value).trim();
  return isAny(v) ? "Male | Female" : v;
}


/************************************************************
 * ACCEPT / REJECT  (tutor's answer for one tuition)
 ************************************************************/

let toastTimer = null;

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

async function respondToTuition(button) {

  const decision = button.dataset.respond;
  const demoId = button.dataset.demo;

  const question = decision === "accept"
    ? "Accept this tuition?"
    : "Reject this tuition? This cannot be undone here.";

  if (!window.confirm(question)) return;

  if (!(await hasSession())) {
    showError("You are not logged in.");
    return;
  }

  const buttons = button.closest(".tutor-actions").querySelectorAll("button");
  buttons.forEach(b => { b.disabled = true; });

  const label = button.textContent;
  button.textContent = "Saving...";

  try {

    const result = await window.sbCall("respond_to_demo_tutor", {
      p_demo_id: demoId,
      p_decision: decision
    });

    if (!result || !result.success) {
      showToast((result && result.message) || "Your response could not be saved.", true);
      button.textContent = label;
      buttons.forEach(b => { b.disabled = false; });
      return;
    }

    await loadProfile();

    showToast(result.message || "Saved.");

  } catch (error) {

    console.error(error);
    showToast("Unable to connect to the server. Please try again.", true);
    button.textContent = label;
    buttons.forEach(b => { b.disabled = false; });

  }

}


/************************************************************
 * LOGOUT
 ************************************************************/

$("logoutButton")?.addEventListener("click", async () => {

  try {
    await window.sb.auth.signOut();
  } catch (error) {
    console.error(error);
  }

  clearTutorSession();

  window.location.href = "index.html";

});
