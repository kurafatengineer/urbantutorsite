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
    renderClasses(result.classes || []);

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

  $("profileAvatarInitials").textContent = initials || "T";

  if (profile.profileImage) {
    const img = $("profileAvatarImg");
    img.src = profile.profileImage;
    img.classList.remove("hidden");
    $("profileAvatarInitials").classList.add("hidden");
  }

  $("profileRegisterAs").textContent = profile.registerAs || "Tutor";
  $("profileCity").textContent = profile.city || "";
  $("profileCity").classList.toggle("hidden", !profile.city);

  const statusEl = $("profileStatus");
  const status = (profile.verificationStatus || "Pending");
  statusEl.textContent = status;
  statusEl.className = "chip " + statusChipClass(status);

  $("profileStats").innerHTML = [
    stat(profile.experience ? `${profile.experience} yrs` : "—", "Experience"),
    stat(profile.subjectsTeach || "—", "Subjects"),
    stat(String((profile.classesTeach || "").split(",").filter(Boolean).length || "—"), "Classes You Teach"),
    stat(profile.location || profile.city || "—", "Teaching Location")
  ].join("");

}

function statusChipClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "verified") return "chip-verified";
  if (s === "rejected") return "chip-rejected";
  return "chip-pending";
}

function stat(value, label) {
  return `
    <div class="stat">
      <div class="stat-value">${escapeHTML(value)}</div>
      <div class="stat-label">${escapeHTML(label)}</div>
    </div>
  `;
}


/************************************************************
 * RENDER DEMO / CLASS STATUS LIST
 ************************************************************/

function renderClasses(classes) {

  const list = $("classesList");
  const empty = $("classesEmpty");

  if (!classes.length) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  list.innerHTML = classes.map(renderClassCard).join("");

}

function renderClassCard(item) {

  const statusClass = "status-" + String(item.status || "")
    .toLowerCase()
    .replace(/\s+/g, "-");

  const details = [
    ["Student", item.studentName],
    ["Class", item.className],
    ["Board", item.board],
    ["Medium", item.medium],
    ["Preferred Timing", item.preferredTiming],
    ["Demo Date", item.demoDate],
    ["Duration", item.duration],
    ["Classes Completed", item.classesCompleted]
  ].filter(pair => pair[1] !== undefined && pair[1] !== null && String(pair[1]).trim() !== "");

  return `
    <div class="class-card">
      <div class="class-card-top">
        <div class="class-subject">${escapeHTML(item.subject || "Subject")}</div>
        <span class="status-badge ${statusClass}">${escapeHTML(item.status || "")}</span>
      </div>
      <div class="class-detail-grid">
        ${details.map(([label, value]) => `
          <div class="class-detail">
            <span>${escapeHTML(label)}</span>
            ${escapeHTML(value)}
          </div>
        `).join("")}
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
