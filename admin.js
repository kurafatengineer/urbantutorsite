"use strict";

/************************************************************
 * URBANTUTORSITE - ADMIN PANEL (front-end)
 *
 * API ACTIONS USED (see API Router.gs / Admin Panel.gs)
 *   adminLogin  adminLogout  adminGetOverview
 *   adminSetTutorStatus  adminScheduleDemo  adminSetClassesCompleted
 *
 * The admin token lives in sessionStorage only: closing the
 * browser tab signs the admin out.
 ************************************************************/

const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwnhZnXpGVegX3kQtggtRjTej1JrsgfUdDyPrtMmuxh-IR_I8EGudmGAgLscda2y3nxLg/exec";

const ADMIN_TOKEN_KEY = "urbantutorsite_admin_token";


/************************************************************
 * HELPERS
 ************************************************************/

const $ = id => document.getElementById(id);

function showPage(name) {
  ["login", "loading", "panel"].forEach(n =>
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

function getToken() {
  try { return sessionStorage.getItem(ADMIN_TOKEN_KEY) || ""; } catch (e) { return ""; }
}

function setToken(token) {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch (e) {}
}

async function apiRequest(payload, timeoutMs = 60000) {

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

    return JSON.parse(raw);

  } finally {
    clearTimeout(timer);
  }

}

// Admin call: adds the token, sends an expired session back to login.
async function adminCall(payload) {

  const result = await apiRequest({ ...payload, adminToken: getToken() });

  if (result && result.notAdmin) {
    setToken("");
    showLogin(result.message);
    throw new Error("not-admin");
  }

  return result;

}

let toastTimer = null;

function toast(text, isError) {
  const el = $("adminToast");
  el.textContent = text;
  el.className = "admin-toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

function isTicked(value) {
  return value === true || /^(true|yes|y|1)$/i.test(String(value == null ? "" : value).trim());
}

function lower(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function isAny(value) {
  return lower(value) === "any";
}

function mediumText(value) {
  return isAny(value) ? "Online | Offline" : (value || "");
}

function genderText(value) {
  return isAny(value) ? "Male | Female" : (value || "");
}

function statusGroup(status) {
  const s = lower(status);
  if (s === "verified") return "verified";
  if (s === "rejected") return "rejected";
  return "pending";
}

// "25/09/2026" -> "2026-09-25" for <input type="date">
function toDateInput(text) {
  const m = String(text || "").trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const iso = String(text || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
}

// "11:00 AM" / "11:00:00" -> "11:00" for <input type="time">
function toTimeInput(text) {
  const m = String(text || "").trim().match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  if (!m) return "";
  let h = parseInt(m[1], 10);
  const mer = m[3] ? m[3].toUpperCase() : "";
  if (mer === "PM" && h < 12) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}


/************************************************************
 * STATE
 ************************************************************/

const STATE = {
  data: { tutors: [], students: [], demos: [], verificationValues: [] },
  tab: "tutors",
  tutorFilter: "all",
  tuitionFilter: "all"
};


/************************************************************
 * START
 ************************************************************/

(function init() {

  wireEvents();

  if (getToken()) {
    loadOverview();
  } else {
    showLogin();
  }

})();

function showLogin(message) {
  $("loginMessage").textContent = message || "";
  $("adminPassword").value = "";
  showPage("login");
  setTimeout(() => $("adminPassword").focus(), 50);
}

async function loadOverview(quiet) {

  if (!quiet) showPage("loading");

  try {

    const result = await adminCall({ action: "adminGetOverview" });

    if (!result.success) {
      if (quiet) toast(result.message || "Unable to load data.", true);
      else showLogin(result.message || "Unable to load data.");
      return;
    }

    STATE.data = result;

    renderAll();
    showPage("panel");

  } catch (error) {
    if (error.message === "not-admin") return;
    console.error(error);
    if (quiet) toast("Unable to connect to the server.", true);
    else showLogin("Unable to connect to the server. Please try again.");
  }

}


/************************************************************
 * EVENTS
 ************************************************************/

function wireEvents() {

  $("loginForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    const password = $("adminPassword").value;

    if (!password) {
      $("loginMessage").textContent = "Enter the admin password.";
      return;
    }

    const button = $("loginButton");
    button.disabled = true;
    button.textContent = "Checking...";
    $("loginMessage").textContent = "";

    try {

      const result = await apiRequest({ action: "adminLogin", password });

      if (!result.success) {
        $("loginMessage").textContent = result.message || "Wrong password.";
        return;
      }

      setToken(result.adminToken);
      await loadOverview();

    } catch (error) {
      console.error(error);
      $("loginMessage").textContent = "Unable to connect to the server. Please try again.";
    } finally {
      button.disabled = false;
      button.textContent = "Log in";
    }

  });

  $("logoutButton").addEventListener("click", async () => {
    const token = getToken();
    setToken("");
    try { if (token) await apiRequest({ action: "adminLogout", adminToken: token }); } catch (e) {}
    showLogin();
  });

  $("refreshButton").addEventListener("click", () => loadOverview(true).then(() => toast("Updated.")));

  $("mainTabs").addEventListener("click", (event) => {
    const tab = event.target.closest(".admin-tab");
    if (!tab) return;
    STATE.tab = tab.dataset.tab;
    $("mainTabs").querySelectorAll(".admin-tab").forEach(t => t.classList.toggle("active", t === tab));
    ["tutors", "tuitions", "students"].forEach(name =>
      $("tab-" + name).classList.toggle("hidden", name !== STATE.tab)
    );
  });

  chipGroup("tutorFilter", value => { STATE.tutorFilter = value; renderTutors(); });
  chipGroup("tuitionFilter", value => { STATE.tuitionFilter = value; renderTuitions(); });

  $("tutorSearch").addEventListener("input", renderTutors);
  $("tuitionSearch").addEventListener("input", renderTuitions);
  $("studentSearch").addEventListener("input", renderStudents);

  // Tutor verification status
  $("tutorList").addEventListener("change", async (event) => {

    const select = event.target.closest("select[data-tutor]");
    if (!select) return;

    const tutorId = select.dataset.tutor;
    const status = select.value;
    const previous = select.dataset.current;

    select.disabled = true;

    try {

      const result = await adminCall({ action: "adminSetTutorStatus", tutorId, status });

      if (!result.success) {
        select.value = previous;
        toast(result.message || "Unable to update.", true);
        return;
      }

      const tutor = STATE.data.tutors.find(t => t.tutorId === tutorId);
      if (tutor) tutor.verificationStatus = status;

      renderStats();
      renderTutors();
      toast(result.message || "Saved.");

    } catch (error) {
      if (error.message !== "not-admin") {
        select.value = previous;
        toast("Unable to connect to the server.", true);
      }
    } finally {
      select.disabled = false;
    }

  });

  // Schedule / clear / completed
  $("tuitionList").addEventListener("click", async (event) => {

    const button = event.target.closest("[data-act]");
    if (!button) return;

    const row = button.closest("[data-row]");
    const rowNumber = Number(row.dataset.row);
    const demoId = row.dataset.demo;
    const act = button.dataset.act;

    let payload;

    if (act === "save" || act === "clear") {

      const date = act === "clear" ? "" : row.querySelector("input[type=date]").value;
      const time = act === "clear" ? "" : row.querySelector("input[type=time]").value;

      if (act === "save" && (!date || !time)) {
        toast("Choose both the demo date and time.", true);
        return;
      }

      if (act === "clear" && !window.confirm("Clear this demo's date and time?")) return;

      payload = { action: "adminScheduleDemo", rowNumber, demoId, date, time };

    } else if (act === "complete" || act === "uncomplete") {

      const value = act === "complete";

      if (!window.confirm(value ? "Mark these classes as completed?" : "Remove the completed tick?")) return;

      payload = { action: "adminSetClassesCompleted", rowNumber, demoId, value };

    } else {
      return;
    }

    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Saving...";

    try {

      const result = await adminCall(payload);

      if (!result.success) {
        toast(result.message || "Unable to save.", true);
        return;
      }

      toast(result.message || "Saved.");
      await loadOverview(true);

    } catch (error) {
      if (error.message !== "not-admin") toast("Unable to connect to the server.", true);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }

  });

}

function chipGroup(id, onChange) {
  $(id).addEventListener("click", (event) => {
    const chip = event.target.closest(".admin-chip");
    if (!chip) return;
    $(id).querySelectorAll(".admin-chip").forEach(c => c.classList.toggle("active", c === chip));
    onChange(chip.dataset.value);
  });
}


/************************************************************
 * RENDER
 ************************************************************/

function renderAll() {
  renderStats();
  renderTutors();
  renderTuitions();
  renderStudents();
}

function tuitionRowState(row) {
  if (!row.hasTutor) return "open";
  if (row.parentRejected || row.tutorRejected) return "declined";
  if (row.classesCompleted) return "completed";
  if (row.parentAccepted && row.tutorAccepted && (row.demoDate || row.demoTime)) return "running";
  if (row.demoDate || row.demoTime) return "scheduled";
  return "schedule";
}

function renderStats() {

  const tutors = STATE.data.tutors || [];
  const demos = STATE.data.demos || [];

  const pending = tutors.filter(t => statusGroup(t.verificationStatus) === "pending").length;
  const toSchedule = demos.filter(r => tuitionRowState(r) === "schedule").length;
  const running = demos.filter(r => tuitionRowState(r) === "running").length;

  const stats = [
    ["Tutors pending", pending, "amber"],
    ["Demos to schedule", toSchedule, "violet"],
    ["Running classes", running, "green"],
    ["Students", (STATE.data.students || []).length, "lime"]
  ];

  $("adminStats").innerHTML = stats.map(([label, value, tone]) => `
    <div class="admin-stat" data-tone="${tone}">
      <div class="admin-stat-value">${escapeHTML(value)}</div>
      <div class="admin-stat-label">${escapeHTML(label)}</div>
    </div>
  `).join("");

}

function matches(query, parts) {
  const q = lower(query);
  if (!q) return true;
  return parts.some(p => lower(p).includes(q));
}

function renderTutors() {

  const list = (STATE.data.tutors || [])
    .filter(t => STATE.tutorFilter === "all" || statusGroup(t.verificationStatus) === STATE.tutorFilter)
    .filter(t => matches($("tutorSearch").value, [t.tutorId, t.fullName, t.city, t.subjects, t.email, t.mobile]))
    .sort((a, b) => {
      const order = { pending: 0, rejected: 1, verified: 2 };
      return (order[statusGroup(a.verificationStatus)] - order[statusGroup(b.verificationStatus)]) ||
        String(b.registeredAt).localeCompare(String(a.registeredAt));
    });

  const values = STATE.data.verificationValues && STATE.data.verificationValues.length
    ? STATE.data.verificationValues
    : ["Verified", "Rejected", "Pending for Verification"];

  $("tutorList").innerHTML = list.length ? list.map(t => {

    const group = statusGroup(t.verificationStatus);
    const current = values.find(v => lower(v) === lower(t.verificationStatus)) || "Pending for Verification";

    return `
      <article class="admin-card" data-tone="${group}">
        <div class="admin-card-head">
          <div class="admin-avatar">${escapeHTML(initials(t.fullName, "T"))}</div>
          <div class="admin-card-title">
            <strong>${escapeHTML(t.fullName || "Tutor")}</strong>
            <small>${escapeHTML(t.tutorId)}${t.registerAs ? " · " + escapeHTML(t.registerAs) : ""}</small>
          </div>
          <span class="admin-pill" data-tone="${group}">${escapeHTML(current)}</span>
        </div>

        <dl class="admin-facts">
          ${fact("Gender", t.gender)}
          ${fact("Degree", t.degree)}
          ${fact("Experience", t.experience ? t.experience + " yrs" : "")}
          ${fact("City", [t.city, t.pinCode].filter(Boolean).join(" - "))}
          ${fact("Subjects", t.subjects)}
          ${fact("Classes", t.classes)}
          ${fact("Mobile", t.mobile)}
          ${fact("Email", t.email)}
        </dl>

        <div class="admin-card-foot">
          <div class="admin-links">
            ${t.identityProof ? `<a href="${escapeHTML(t.identityProof)}" target="_blank" rel="noopener">Identity proof</a>` : ""}
            ${t.profileImage ? `<a href="${escapeHTML(t.profileImage)}" target="_blank" rel="noopener">Photo</a>` : ""}
          </div>
          <label class="admin-select">
            <span class="sr-only">Verification status</span>
            <select data-tutor="${escapeHTML(t.tutorId)}" data-current="${escapeHTML(current)}">
              ${values.map(v => `<option value="${escapeHTML(v)}"${v === current ? " selected" : ""}>${escapeHTML(v)}</option>`).join("")}
            </select>
          </label>
        </div>
      </article>
    `;

  }).join("") : empty("No tutors match.");

}

function renderTuitions() {

  const demos = STATE.data.demos || [];
  const students = {};
  (STATE.data.students || []).forEach(s => { students[s.studentId] = s; });

  // group by Demo ID
  const groups = {};
  const order = [];

  demos.forEach(row => {
    if (!groups[row.demoId]) {
      groups[row.demoId] = { demoId: row.demoId, rows: [], first: row };
      order.push(row.demoId);
    }
    groups[row.demoId].rows.push(row);
  });

  const query = $("tuitionSearch").value;
  const filter = STATE.tuitionFilter;

  const list = order.map(id => groups[id]).filter(g => {

    const f = g.first;

    if (!matches(query, [g.demoId, f.studentName, f.studentId, f.subject, f.city,
      ...g.rows.map(r => r.tutorName), ...g.rows.map(r => r.tutorId)])) return false;

    if (filter === "all") return true;

    return g.rows.some(r => tuitionRowState(r) === filter);

  }).reverse(); // newest Demo IDs first

  $("tuitionList").innerHTML = list.length ? list.map(g => {

    const f = g.first;
    const tutorRows = g.rows.filter(r => r.hasTutor);

    return `
      <article class="admin-card">
        <div class="admin-card-head">
          <div class="admin-card-title">
            <strong>${escapeHTML(f.subject || "Subject")} <span class="muted">· ${escapeHTML(g.demoId)}</span></strong>
            <small>${escapeHTML(f.studentName || f.studentId)}${f.className ? " · " + escapeHTML(f.className) : ""}${f.city ? " · " + escapeHTML(f.city) : ""}</small>
          </div>
        </div>

        <dl class="admin-facts">
          ${fact("Medium", mediumText(f.medium))}
          ${fact("Tutor", genderText(f.preferredTutor))}
          ${fact("Timing", f.preferredTiming)}
          ${fact("Applied", tutorRows.length ? String(tutorRows.length) : "None yet")}
        </dl>

        ${tutorRows.length ? `<div class="admin-rows">${tutorRows.map(tutorRow).join("")}</div>` : ""}
      </article>
    `;

  }).join("") : empty("No tuitions match.");

}

function tutorRow(row) {

  const state = tuitionRowState(row);

  const labels = {
    schedule: "Needs demo",
    scheduled: "Demo scheduled",
    running: "Running",
    completed: "Completed",
    declined: "Declined"
  };

  const flags = [
    row.parentAccepted ? "Parent ✓" : "",
    row.tutorAccepted ? "Tutor ✓" : "",
    row.parentRejected ? "Parent ✕" : "",
    row.tutorRejected ? "Tutor ✕" : ""
  ].filter(Boolean).join("  ");

  const verified = lower(row.tutorVerification) === "verified";

  return `
    <div class="admin-row" data-row="${row.rowNumber}" data-demo="${escapeHTML(row.demoId)}" data-tone="${state}">
      <div class="admin-row-head">
        <div class="admin-card-title">
          <strong>${escapeHTML(row.tutorName || "Tutor")}</strong>
          <small>${escapeHTML(row.tutorId || "")}${verified ? "" : ` · <span class="warn">${escapeHTML(row.tutorVerification || "Not verified")}</span>`}</small>
        </div>
        <span class="admin-pill" data-tone="${state}">${escapeHTML(labels[state] || "")}</span>
      </div>

      ${flags ? `<p class="admin-flags">${escapeHTML(flags)}</p>` : ""}

      ${state !== "declined" ? `
        <div class="admin-schedule">
          <input type="date" value="${escapeHTML(toDateInput(row.demoDate))}" aria-label="Demo date">
          <input type="time" value="${escapeHTML(toTimeInput(row.demoTime))}" aria-label="Demo time">
        </div>
        <div class="admin-row-actions">
          <button class="admin-primary small" data-act="save" type="button">${row.demoDate ? "Update demo" : "Schedule demo"}</button>
          ${row.demoDate || row.demoTime ? `<button class="admin-ghost small" data-act="clear" type="button">Clear</button>` : ""}
          ${state === "running" ? `<button class="admin-ghost small" data-act="complete" type="button">Mark completed</button>` : ""}
          ${state === "completed" ? `<button class="admin-ghost small" data-act="uncomplete" type="button">Undo completed</button>` : ""}
        </div>
      ` : ""}
    </div>
  `;

}

function renderStudents() {

  const list = (STATE.data.students || [])
    .filter(s => matches($("studentSearch").value, [s.studentId, s.studentName, s.parentsName, s.school, s.city, s.phone, s.email]))
    .slice()
    .reverse();

  $("studentList").innerHTML = list.length ? list.map(s => `
    <article class="admin-card">
      <div class="admin-card-head">
        <div class="admin-avatar">${escapeHTML(initials(s.studentName, "S"))}</div>
        <div class="admin-card-title">
          <strong>${escapeHTML(s.studentName || "Student")}</strong>
          <small>${escapeHTML(s.studentId)}${s.parentsName ? " · (" + escapeHTML(s.parentsName) + ")" : ""}</small>
        </div>
      </div>
      <dl class="admin-facts">
        ${fact("Gender", s.gender)}
        ${fact("Class", s.className)}
        ${fact("Board", s.board)}
        ${fact("School", s.school)}
        ${fact("City", [s.city, s.pinCode].filter(Boolean).join(" - "))}
        ${fact("Phone", s.phone)}
        ${fact("Email", s.email)}
      </dl>
    </article>
  `).join("") : empty("No students match.");

}

function fact(label, value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  return `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`;
}

function empty(text) {
  return `<div class="admin-empty">${escapeHTML(text)}</div>`;
}

function initials(name, fallback) {
  return String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(p => p[0].toUpperCase()).join("") || fallback;
}
