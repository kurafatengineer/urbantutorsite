"use strict";

/************************************************************
 * URBANTUTORSITE - TUITIONS AVAILABLE (front-end)
 *
 * Anyone can VIEW this page (no login needed) - same pattern
 * as the homepage "Meet our Tutors" / "Meet our Students"
 * carousels. Only APPLYING requires a logged-in tutor session.
 *
 * API ACTIONS USED (see API Router.gs / Tutor Advertisement.gs)
 *   getAvailableTuitions   (GET or POST, no session needed)
 *   applyForTuition        (POST, needs sessionToken)
 *
 * FILTERS ARE "SMART" / CASCADING:
 *   Each dropdown's option list is rebuilt from whatever the
 *   OTHER selected filters still allow - e.g. pick a Subject
 *   and the Board/City/Medium lists narrow to only what's
 *   actually available for that subject. Every list stays
 *   sorted A-Z.
 ************************************************************/

const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwnhZnXpGVegX3kQtggtRjTej1JrsgfUdDyPrtMmuxh-IR_I8EGudmGAgLscda2y3nxLg/exec";

const TUTOR_SESSION_KEY = "urbantutorsite_tutor_session";

// Each filter select id -> the tuition field it filters on.
// Filters shown: Subject, Class, Medium, PIN Code, City.
// (Board and Sort by were removed - list is always newest first.)
const FILTER_FIELDS = {
  subjectFilter: "subject",
  classFilter: "className",
  mediumFilter: "medium",
  pinFilter: "pinCode",
  cityFilter: "city"
};


/************************************************************
 * SMALL HELPERS
 ************************************************************/

const $ = id => document.getElementById(id);

function showPage(name) {
  ["loading", "tuitions", "error"].forEach(n =>
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

function showToast(message, isError) {

  const toast = $("applyToast");

  toast.textContent = message;
  toast.classList.toggle("error", !!isError);
  toast.classList.add("show");
  toast.classList.remove("hidden");

  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);

}


/************************************************************
 * ICONS
 ************************************************************/

const ICONS = {
  student: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  cap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
};


/************************************************************
 * STATE
 ************************************************************/

let allTuitions = [];
let appliedDemoIds = new Set();


/************************************************************
 * LOAD
 ************************************************************/

(async function init() {

  try {

    const result = await apiRequest(buildListRequest());

    if (!result.success) {
      showError(result.message || "Unable to load open tuitions.");
      return;
    }

    applyListResult(result);

    showPage("tuitions");

  } catch (error) {
    console.error(error);
    showError("Unable to connect to the server. Please try again.");
  }

})();

/*
 * getAvailableTuitions is public, but if a tutor is logged in we
 * also send the session token (POST body, never a URL) so the
 * server can return the Demo IDs this tutor has already applied
 * for - those cards are then shown with a disabled button.
 */
function buildListRequest() {

  const payload = { action: "getAvailableTuitions" };
  const session = getTutorSession();

  if (session && session.sessionToken) {
    payload.sessionToken = session.sessionToken;
  }

  return payload;

}

function applyListResult(result) {

  allTuitions = result.tuitions || [];

  // Merge (never drop) - keeps anything applied for in this visit
  // disabled even if the server list comes back a moment later.
  (result.appliedDemoIds || []).forEach(id => appliedDemoIds.add(String(id)));

  refreshFilterOptions();
  render();

}

function showError(message) {
  $("errorMessage").textContent = message;
  showPage("error");
}

$("retryButton")?.addEventListener("click", () => window.location.reload());


/************************************************************
 * CURRENT SELECTIONS
 ************************************************************/

function getSelections() {

  const selections = {};

  Object.entries(FILTER_FIELDS).forEach(([id, field]) => {
    selections[field] = $(id).value;
  });

  return selections;

}


/************************************************************
 * CASCADING ("SMART") FILTER OPTIONS
 *
 * Each select's option list is built from tuitions that match
 * every OTHER currently-selected filter (never its own current
 * value) - so picking one filter narrows what the rest can
 * offer, in both directions. Always sorted A-Z.
 ************************************************************/

function refreshFilterOptions() {

  const selections = getSelections();

  Object.entries(FILTER_FIELDS).forEach(([id, field]) => {

    const otherCriteria = { ...selections };
    delete otherCriteria[field];

    const matching = allTuitions.filter(item =>
      Object.entries(otherCriteria).every(
        ([otherField, value]) => !value || item[otherField] === value
      )
    );

    const values = Array.from(
      new Set(
        matching
          .map(item => String(item[field] || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    fillSelect(id, values, selections[field]);

  });

}

function fillSelect(id, values, currentValue) {

  const select = $(id);
  const placeholder = select.options[0]; // "All subjects" / "All boards" / ...

  select.innerHTML = placeholder.outerHTML +
    values.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join("");

  // Keep the current selection only if it's still a valid option
  // given the other filters - otherwise fall back to "All".
  select.value = values.includes(currentValue) ? currentValue : "";

  // If the current filter narrowed itself down to nothing else
  // to choose from, there's nothing useful to pick - disable it.
  select.disabled = values.length === 0;

}

Object.keys(FILTER_FIELDS).forEach(id => {
  $(id)?.addEventListener("change", () => {
    refreshFilterOptions();
    render();
  });
});


$("clearFilters")?.addEventListener("click", () => {

  Object.keys(FILTER_FIELDS).forEach(id => { $(id).value = ""; });

  refreshFilterOptions();
  render();

});


/************************************************************
 * RENDER
 ************************************************************/

function render() {

  const selections = getSelections();

  let filtered = allTuitions.filter(item =>
    Object.entries(selections).every(
      ([field, value]) => !value || item[field] === value
    )
  );

  filtered = sortTuitions(filtered, "newest");

  const list = $("tuitionsList");
  const empty = $("tuitionsEmpty");
  const count = $("tuitionsCount");

  count.textContent = filtered.length
    ? `${filtered.length} open tuition${filtered.length === 1 ? "" : "s"}`
    : "";

  if (!filtered.length) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  list.innerHTML = filtered.map(renderTuitionCard).join("");

  list.querySelectorAll("[data-apply]").forEach(button => {
    button.addEventListener("click", () => applyForTuition(button.dataset.apply, button));
  });

}

function sortTuitions(items, sortBy) {

  const copy = items.slice();

  switch (sortBy) {

    case "oldest":
      return copy.sort((a, b) => toTime(a.postedOn) - toTime(b.postedOn));

    case "subject":
      return copy.sort((a, b) => String(a.subject || "").localeCompare(String(b.subject || "")));

    case "city":
      return copy.sort((a, b) => String(a.city || "").localeCompare(String(b.city || "")));

    case "pin":
      return copy.sort((a, b) => String(a.pinCode || "").localeCompare(String(b.pinCode || ""), undefined, { numeric: true }));

    case "newest":
    default:
      return copy.sort((a, b) => toTime(b.postedOn) - toTime(a.postedOn));

  }

}

function toTime(value) {
  const t = new Date(value).getTime();
  return isNaN(t) ? 0 : t;
}


/************************************************************
 * CARD
 * Same markup/classes as the "My Classes" card on the Tutor
 * Profile page (.class-card / .class-spine / .class-body /
 * .class-row-top / .class-detail-grid / .class-row-bottom),
 * with the content this page needs:
 *   - Top layer: subject only (bold), no status text
 *   - Middle layer: Class, Medium, Preferred Tutor, PIN Code,
 *     then Address (with City) on its own full-width line
 *   - Bottom layer: Apply button only (disabled if this tutor
 *     has already applied for that Demo ID)
 ************************************************************/

// "Both" (Medium) / "Any" (Preferred Tutor) mean "no preference",
// shown as both options separated by " | " rather than the raw
// sheet value.
function formatMedium(value) {

  const v = String(value || "").trim();

  if (/^(both|any)$/i.test(v)) {
    return "Online | Offline";
  }

  return v;

}

function formatPreferredTutor(value) {

  const v = String(value || "").trim();

  if (/^(both|any)$/i.test(v)) {
    return "Male | Female";
  }

  return v;

}

// Address line, with the city added at the end if the address
// doesn't already mention it.
function joinAddress(address, city) {

  const a = String(address || "").trim();
  const c = String(city || "").trim();

  if (!a) return c;
  if (!c || a.toLowerCase().includes(c.toLowerCase())) return a;

  return `${a}, ${c}`;

}

function renderTuitionCard(item) {

  const details = [
    [ICONS.cap, "Class", item.className],
    [ICONS.globe, "Medium", formatMedium(item.medium)],
    [ICONS.student, "Preferred Tutor", formatPreferredTutor(item.preferredTutor)],
    [ICONS.pin, "PIN Code", item.pinCode],
    [ICONS.home, "Address", joinAddress(item.address, item.city)]
  ].filter(triple => triple[2] !== undefined && triple[2] !== null && String(triple[2]).trim() !== "");

  const applied = appliedDemoIds.has(String(item.demoId));

  return `
    <div class="class-card" data-demo-id="${escapeHTML(item.demoId)}">
      <div class="class-spine">
        ${item.demoId ? `<span class="class-spine-id">${escapeHTML(item.demoId)}</span><span class="class-spine-label">Demo ID</span>` : ""}
      </div>
      <div class="class-body">

        <div class="class-row-top">
          <span class="status-badge subject-badge">${escapeHTML(item.subject || "Subject")}</span>
        </div>

        ${details.length ? `
          <div class="class-detail-grid">
            ${details.map(([icon, label, value]) => `
              <div class="class-detail${label === "Address" ? " class-detail-full" : ""}" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}: ${escapeHTML(value)}">
                <span class="class-detail-icon">${icon}</span>
                <span class="class-detail-value">${escapeHTML(value)}</span>
              </div>
            `).join("")}
          </div>
        ` : ""}

        <div class="class-row-bottom">
          <button
            class="apply-button ${applied ? "applied" : ""}"
            type="button"
            data-apply="${escapeHTML(item.demoId)}"
            ${applied ? 'disabled aria-disabled="true"' : ""}
          >${applied ? "Already Applied" : "Apply"}</button>
        </div>

      </div>
    </div>
  `;

}


/************************************************************
 * APPLY
 ************************************************************/

async function applyForTuition(demoId, button) {

  const session = getTutorSession();

  if (!session || !session.sessionToken) {
    window.location.href = "tutorregistration.html";
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Applying…";

  try {

    const result = await apiRequest({
      action: "applyForTuition",
      sessionToken: session.sessionToken,
      demoId: demoId
    });

    if (!result.success) {

      // This tutor had already applied for this Demo ID -
      // just lock the button.
      if (result.alreadyApplied) {
        appliedDemoIds.add(String(demoId));
        render();
        showToast(result.message || "You have already applied for this tuition.", true);
        return;
      }

      showToast(result.message || "Unable to apply for this tuition.", true);
      button.disabled = false;
      button.textContent = originalText;

      refreshList();
      return;

    }

    // The server re-opens the same requirement under the SAME
    // Demo ID for other tutors, so the card stays on the page -
    // just disabled for this tutor.
    appliedDemoIds.add(String(demoId));
    render();
    showToast(result.message || "Application sent for this tuition.");

    refreshList();

  } catch (error) {

    console.error(error);
    showToast("Unable to connect to the server. Please try again.", true);
    button.disabled = false;
    button.textContent = originalText;

  }

}

async function refreshList() {

  try {

    const result = await apiRequest(buildListRequest());

    if (result.success) {
      applyListResult(result);
    }

  } catch (error) {
    console.error(error);
  }

}
