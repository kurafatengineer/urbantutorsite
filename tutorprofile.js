"use strict";

/************************************************************
 * URBANTUTORSITE - TUTOR PROFILE (front-end)
 *
 * Guards itself: no valid session -> sent back to
 * tutorregistration.html. Valid session -> calls
 * "getTutorProfile" and renders ONLY the data that comes back
 * for this tutor (see Tutor Session.gs for how privacy is
 * enforced server-side).
 *
 * API ACTIONS USED (see API Router.gs / Tutor Session.gs)
 *   getTutorProfile      logoutTutor
 *
 * FIELDS THE BACKEND (Tutor Session.gs) MUST SEND PER CLASS:
 *   demoId          <- "Demo ID" header on the Demos sheet
 *   demoDate        <- "Demo Schedule" header on the Demos sheet
 *                       (the actual scheduled date/time, shown
 *                       in the "Today / 11:00 AM" badge)
 *   preferredTiming <- the tutor's general availability slots,
 *                       e.g. "11:00 AM, 6:00 PM" (shown as the
 *                       sun/moon chips at the bottom of a card)
 *   subject, status, studentName, className, board, medium,
 *   duration — unchanged from before.
 ************************************************************/

const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwnhZnXpGVegX3kQtggtRjTej1JrsgfUdDyPrtMmuxh-IR_I8EGudmGAgLscda2y3nxLg/exec";

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
 * ICONS  (inline SVG strings, coloured via currentColor)
 ************************************************************/

const ICONS = {
  student: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  cap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/></svg>',
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


/************************************************************
 * LOAD PROFILE
 ************************************************************/

(async function init() {

  const session = getTutorSession();

  if (!session || !session.sessionToken) {
    showError("You are not logged in.");
    return;
  }

  try {

    const result = await apiRequest({
      action: "getTutorProfile",
      sessionToken: session.sessionToken
    });

    if (!result.success) {
      clearTutorSession();
      showError(result.message || "Your session has expired. Please log in again.");
      return;
    }

    renderProfile(result.profile || {});
    initClasses(result.classes || []);

    showPage("profile");

  } catch (error) {
    console.error(error);
    showError("Unable to connect to the server. Please try again.");
  }

})();

function showError(message) {
  $("errorMessage").textContent = message;
  showPage("error");
}


/************************************************************
 * RENDER PROFILE HEADER
 ************************************************************/

function renderProfile(profile) {

  const fullName = profile.fullName || "Tutor";

  $("profileName").textContent = fullName;

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

  const statusEl = $("profileStatus");
  const status = (profile.verificationStatus || "Pending");
  statusEl.textContent = status;
  statusEl.className = "chip " + statusChipClass(status);

  $("profileStats").innerHTML = [
    stat(profile.experience ? `${profile.experience} ${Number(profile.experience) === 1 ? "Year" : "Years"}` : "—", "Experience", "green"),
    stat(profile.subjectsTeach || "—", "Teaches", "blue"),
    stat(String((profile.classesTeach || "").split(",").filter(Boolean).length || "—"), "Classes", "gold"),
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
 * SUBJECT -> ICON + ACCENT COLOUR
 ************************************************************/

// NOTE: "violet" is deliberately never used here — it is the
// exact accent the "Demo Scheduled" status pill uses (see
// .status-demo-scheduled in tutorprofile.css), so a subject
// using it would render in an identical colour to that status
// pill sitting right next to it on the same row.
const SUBJECT_VISUALS = [
  { test: /phys/i,                          icon: "atom",  accent: "indigo"  },
  { test: /chem/i,                          icon: "flask", accent: "emerald" },
  { test: /bio/i,                           icon: "leaf",  accent: "success" },
  { test: /math/i,                          icon: "ruler", accent: "info"    },
  { test: /comp(uter)?|coding|programming/i,icon: "code",  accent: "cyan"    },
  { test: /social|history|geo|civics/i,     icon: "globe", accent: "orange"  },
  { test: /eng(lish)?/i,                    icon: "book",  accent: "rose"    },
  { test: /hindi|sanskrit|language/i,       icon: "book",  accent: "amber"   }
];

const FALLBACK_ACCENTS = ["indigo", "emerald", "info", "amber", "cyan", "rose", "orange", "success"];

function subjectVisual(subject) {

  const text = String(subject || "");

  const match = SUBJECT_VISUALS.find(entry => entry.test.test(text));

  if (match) return match;

  // Deterministic fallback so the same subject always gets the
  // same colour, without needing every subject listed above.
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) % FALLBACK_ACCENTS.length;
  }

  return { icon: "cap", accent: FALLBACK_ACCENTS[hash] || "info" };

}


/************************************************************
 * DATE / TIME HELPERS
 ************************************************************/

function parseWhen(value) {

  if (!value) return null;

  const date = new Date(value);

  if (isNaN(date.getTime())) return null;

  const now = new Date();

  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  let day;
  if (isSameDay(date, now)) {
    day = "Today";
  } else if (isSameDay(date, tomorrow)) {
    day = "Tomorrow";
  } else {
    day = date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  const hasTime = /\d{1,2}:\d{2}/.test(String(value)) || date.getHours() || date.getMinutes();

  const time = hasTime
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";

  return { day, time };

}

function timingChips(preferredTiming) {

  if (!preferredTiming) return [];

  return String(preferredTiming)
    .split(",")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => ({ label: part, pm: /pm/i.test(part) && !/am/i.test(part) }));

}


/************************************************************
 * RENDER DEMO / CLASS STATUS LIST  +  FILTER TABS
 ************************************************************/

let ALL_CLASSES = [];

function classifyItem(item) {
  const s = String(item.status || "").toLowerCase();
  if (s === "completed") return "completed";
  if (s === "running") return "class";
  return "demo"; // demo-scheduled, awaiting-confirmation, declined, etc.
}

function initClasses(classes) {

  ALL_CLASSES = classes;

  $("filterTabs").addEventListener("click", (event) => {
    const btn = event.target.closest(".filter-tab");
    if (!btn) return;

    $("filterTabs").querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");

    renderClasses(ALL_CLASSES, btn.dataset.filter);
  });

  renderClasses(ALL_CLASSES, "all");

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

  list.innerHTML = filtered.map(renderClassCard).join("");

}

function renderClassCard(item) {

  const statusClass = "status-" + String(item.status || "")
    .toLowerCase()
    .replace(/\s+/g, "-");

  const visual = subjectVisual(item.subject);

  // Only these four, icon-only, 2x2 — no label text.
  const details = [
    [ICONS.student, "Student", item.studentName],
    [ICONS.cap, "Class", item.className],
    [ICONS.file, "Board", item.board],
    [ICONS.globe, "Medium", item.medium]
  ].filter(triple => triple[2] !== undefined && triple[2] !== null && String(triple[2]).trim() !== "");

  const when = parseWhen(item.demoDate);

  const chips = timingChips(item.preferredTiming);

  return `
    <div class="class-card">
      <div class="class-spine ${statusClass}">
        ${item.demoId ? `<span class="class-spine-id">${escapeHTML(item.demoId)}</span><span class="class-spine-label">Demo ID</span>` : ""}
      </div>
      <div class="class-body">

        <div class="class-row-top">
          <span class="status-badge subject-badge" style="background: var(--${visual.accent}-dim, var(--surface-2)); color: var(--${visual.accent}, var(--muted)); border-color: var(--${visual.accent}-line, var(--border-light));">${escapeHTML(item.subject || "Subject")}</span>
          <span class="status-badge ${statusClass}">${escapeHTML(item.status || "")}</span>
        </div>

        ${details.length ? `
          <div class="class-detail-grid">
            ${details.map(([icon, label, value]) => `
              <div class="class-detail" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}: ${escapeHTML(value)}">
                <span class="class-detail-icon">${icon}</span>
                <span class="class-detail-value">${escapeHTML(value)}</span>
              </div>
            `).join("")}
          </div>
        ` : ""}

        ${(chips.length || when) ? `
          <div class="class-row-bottom">
            ${chips.length ? `
              <div class="timing-chips">
                <span class="timing-icon">${ICONS.clock}</span>
                ${chips.map(chip => `
                  <span class="timing-chip ${chip.pm ? "pm" : "am"}">
                    ${chip.pm ? ICONS.moon : ICONS.sun}
                    ${escapeHTML(chip.label)}
                  </span>
                `).join("")}
              </div>
            ` : "<span></span>"}
            ${when ? `
              <div class="class-when">
                ${ICONS.calendar}
                <div>
                  <div class="class-when-day">${escapeHTML(when.day)}</div>
                  ${when.time ? `<div class="class-when-time">${escapeHTML(when.time)}</div>` : ""}
                </div>
              </div>
            ` : ""}
          </div>
        ` : ""}

      </div>
    </div>
  `;

}


/************************************************************
 * LOGOUT
 ************************************************************/

$("logoutButton")?.addEventListener("click", async () => {

  const session = getTutorSession();

  if (session && session.sessionToken) {
    try {
      await apiRequest({
        action: "logoutTutor",
        sessionToken: session.sessionToken
      });
    } catch (error) {
      console.error(error);
    }
  }

  clearTutorSession();

  window.location.href = "index.html";

});
