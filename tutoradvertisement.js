"use strict";

/************************************************************
 * URBANTUTORSITE - TUITIONS AVAILABLE (front-end)
 *
 * Anyone can VIEW this page (no login needed) - same pattern
 * as the homepage "Meet our Tutors" / "Meet our Students"
 * carousels. Only APPLYING requires a logged-in tutor session.
 *
 * RPC FUNCTIONS USED (see supabase-setup-4-apply-accept.sql)
 *   get_available_tuitions  (window.sbCall, no session needed)
 *   apply_for_tuition       (window.sbCall, needs Supabase session)
 *
 * FILTERS ARE "SMART" / CASCADING:
 *   Each dropdown's option list is rebuilt from whatever the
 *   OTHER selected filters still allow - e.g. pick a Subject
 *   and the Board/City/Medium lists narrow to only what's
 *   actually available for that subject. Every list stays
 *   sorted A-Z.
 ************************************************************/

const TUTOR_SESSION_KEY = "urbantutorsite_tutor_session";

// Each filter select id -> the tuition field it filters on.
// Filters shown: Subject, Class, Board, Medium, PIN Code, City.
// (Sort by was removed - see sortTuitions() for the fixed order.)
const FILTER_FIELDS = {
  subjectFilter: "subject",
  classFilter: "className",
  boardFilter: "board",
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

async function hasSession() {
  try {
    const { data: { session } } = await window.sb.auth.getSession();
    return !!session;
  } catch (error) {
    console.error("Session check error:", error);
    return false;
  }
}

// Embedded on the homepage (see index.html)?
const EMBEDDED = document.documentElement.classList.contains("embed");

// false = a tutor is logged in but NOT verified yet -> Apply locked.
let tutorVerified = null;

function showToast(message, isError) {

  // Inside the homepage frame the toast would sit at the bottom of a
  // tall frame, off screen - let the homepage show it instead.
  if (EMBEDDED && window.parent !== window) {
    window.parent.postMessage({ type: "urbantutor-embed-toast", message: message, isError: !!isError }, "*");
    return;
  }

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

    const result = await window.sbCall("get_available_tuitions", {});

    if (!result || !result.success) {
      showError((result && result.message) || "Unable to load open tuitions.");
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
 * get_available_tuitions is public via RLS - if a tutor is logged in,
 * the server will return the Demo IDs this tutor has already applied
 * for, which are then shown with a disabled button. Session is checked
 * via window.sb.auth.getSession() in the RPC function.
 */

function applyListResult(result) {

  allTuitions = result.tuitions || [];

  // Every tutor action needs a VERIFIED profile (checked again on
  // the server when Apply is pressed).
  // Only a logged-in TUTOR has a verification status. Visitors and
  // students get null: no notice, and "Apply" leads to the tutor login.
  tutorVerified = result.loggedInTutor ? !!result.tutorVerified : null;
  $("verifyNotice")?.classList.toggle("hidden", tutorVerified !== false);

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
    ? `${filtered.length} Open Tuition${filtered.length === 1 ? "" : "s"}`
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

  focusLinkedTuition();

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
      // Logged-in tutor: tuitions they've applied for (still open,
      // not yet assigned) come first, then everything else - each
      // group newest to oldest.
      return copy.sort((a, b) => {
        const aApplied = appliedDemoIds.has(String(a.demoId)) ? 1 : 0;
        const bApplied = appliedDemoIds.has(String(b.demoId)) ? 1 : 0;
        if (aApplied !== bApplied) return bApplied - aApplied;
        return toTime(b.postedOn) - toTime(a.postedOn);
      });

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
 *   - Middle layer: Class | Board, Gender | Medium,
 *     Location (address + city) - PIN Code, full width
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

  // Middle layer, 2 per row, always in this order:
  //   Class     | Board
  //   Gender    | Medium
  //   Location (address + city, small) - PIN Code (bold)  <- full width
  // Empty values show "—" so every card keeps the same layout.
  const details = [
    [ICONS.cap, "Class", item.className],
    [ICONS.file, "Board", item.board],
    [ICONS.student, "Gender", formatPreferredTutor(item.preferredTutor)],
    [ICONS.globe, "Medium", formatMedium(item.medium)],
  ].map(([icon, label, value]) => [icon, label, String(value == null ? "" : value).trim() || "—"]);

  const locationText = joinAddress(item.address, item.city);
  const pinText = String(item.pinCode || "").trim();

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
              <div class="class-detail" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}: ${escapeHTML(value)}">
                <span class="class-detail-icon">${icon}</span>
                <span class="class-detail-value">${escapeHTML(value)}</span>
              </div>
            `).join("")}
            <div class="class-detail class-detail-location" title="Location" aria-label="Location: ${escapeHTML([locationText, pinText].filter(Boolean).join(" - ") || "—")}">
              <span class="class-detail-icon">${ICONS.pin}</span>
              <span class="class-detail-value">${locationText ? `<span class="location-address">${escapeHTML(locationText)}</span>` : ""}${locationText && pinText ? `<span class="location-sep"> - </span>` : ""}${pinText ? `<span class="location-pin">${escapeHTML(pinText)}</span>` : ""}${!locationText && !pinText ? "—" : ""}</span>
            </div>
          </div>
        ` : ""}

        <div class="class-row-bottom">
          <button
            class="apply-button ${applied ? "applied" : ""}"
            type="button"
            data-apply="${escapeHTML(item.demoId)}"
            ${applied || tutorVerified === false ? 'disabled aria-disabled="true"' : ""}
          >${applied ? "Already Applied" : (tutorVerified === false ? "Verification Pending" : "Apply")}</button>
        </div>

      </div>
    </div>
  `;

}


/************************************************************
 * APPLY
 ************************************************************/

async function applyForTuition(demoId, button) {

  if (!(await hasSession())) {
    // Leave the homepage frame too, not just the frame.
    (EMBEDDED ? window.top : window).location.href = "tutorregistration.html";
    return;
  }

  if (tutorVerified === false) {
    showToast("Your profile is not verified yet. You can apply once it is verified.", true);
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Applying…";

  try {

    const result = await window.sbCall("apply_for_tuition", {
      p_demo_id: demoId
    });

    if (!result || !result.success) {

      // This tutor had already applied for this Demo ID -
      // just lock the button.
      if (result && result.notVerified) {
        tutorVerified = false;
        $("verifyNotice")?.classList.remove("hidden");
        render();
        showToast(result.message || "Your profile is not verified yet.", true);
        return;
      }

      if (result && result.alreadyApplied) {
        appliedDemoIds.add(String(demoId));
        render();
        showToast(result.message || "You have already applied for this tuition.", true);
        return;
      }

      showToast((result && result.message) || "Unable to apply for this tuition.", true);
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

    const result = await window.sbCall("get_available_tuitions", {});

    if (result && result.success) {
      applyListResult(result);
    }

  } catch (error) {
    console.error(error);
  }

}



/************************************************************
 * EMBEDDED ON THE HOMEPAGE: report height to the homepage
 ************************************************************/

if (EMBEDDED && window.parent !== window) {

  const reportHeight = () => {
    window.parent.postMessage({
      type: "urbantutor-embed-height",
      height: document.documentElement.scrollHeight
    }, "*");
  };

  if ("ResizeObserver" in window) {
    new ResizeObserver(reportHeight).observe(document.body);
  }

  window.addEventListener("load", reportHeight);
  window.addEventListener("resize", reportHeight);

  reportHeight();

}



/************************************************************
 * LINK FROM THE TUTOR HOMEPAGE: tutoradvertisement.html#<DemoID>
 * scrolls to that tuition card and highlights it (once).
 ************************************************************/

let linkedTuitionDone = false;

function focusLinkedTuition() {

  if (linkedTuitionDone) return;

  const id = decodeURIComponent((location.hash || "").slice(1));

  if (!id) return;

  const card = Array.from(document.querySelectorAll("[data-demo-id]"))
    .find(el => el.getAttribute("data-demo-id") === id);

  if (!card) return;

  linkedTuitionDone = true;

  setTimeout(() => {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("is-linked");
    setTimeout(() => card.classList.remove("is-linked"), 2600);
  }, 150);

}
