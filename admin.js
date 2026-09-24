"use strict";

/************************************************************
 * URBANTUTORSITE - ADMIN PANEL (front-end)
 *
 * TUITIONS  one card per Demo ID (collapsed; tap to open):
 *           student's full details, the requirement (editable),
 *           assign a tutor by Tutor ID / mobile, terminate /
 *           reopen, and - stacked underneath - one card per tutor
 *           (collapsed; tap to open) with the tutor's full details
 *           and: demo date + time, price / duration / percentage,
 *           parent + tutor Accepted / Rejected, classes completed.
 * TUTORS    every column of every tutor, editable.
 * STUDENTS  every column of every student, editable.
 *
 * API ACTIONS (API Router.gs -> Admin Panel.gs)
 *   adminLogin  adminLogout  adminGetOverview
 *   adminUpdateRecord  adminUpdateTuition  adminUpdateDemoRow
 *   adminAssignTutor  adminSetTerminated
 *
 * The admin token lives in sessionStorage only: closing the tab
 * signs the admin out.
 ************************************************************/

const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwnhZnXpGVegX3kQtggtRjTej1JrsgfUdDyPrtMmuxh-IR_I8EGudmGAgLscda2y3nxLg/exec";

const ADMIN_TOKEN_KEY = "urbantutorsite_admin_token";

const LINK_FIELDS = ["Identity Proof", "Profile Image"];


/************************************************************
 * HELPERS
 ************************************************************/

const $ = id => document.getElementById(id);

function showPage(name) {
  ["login", "loading", "panel"].forEach(n =>
    $(n + "Page").classList.toggle("hidden", n !== name)
  );
}

function esc(value) {
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
  toastTimer = setTimeout(() => el.classList.remove("show"), 3800);
}

const lower = v => String(v == null ? "" : v).trim().toLowerCase();
const isAny = v => lower(v) === "any";
const mediumText = v => isAny(v) ? "Online | Offline" : (v || "");
const genderText = v => isAny(v) ? "Male | Female" : (v || "");

function mobileKey(value) {
  const d = String(value == null ? "" : value).replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

function statusGroup(status) {
  const s = lower(status);
  if (s === "verified") return "verified";
  if (s === "rejected") return "rejected";
  return "pending";
}

function initials(name, fallback) {
  return String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(p => p[0].toUpperCase()).join("") || fallback;
}

// "25/09/2026" -> "2026-09-25"
function toDateInput(text) {
  const m = String(text || "").trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const iso = String(text || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
}

// "11:00 AM" -> "11:00"
function toTimeInput(text) {
  const m = String(text || "").trim().match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  if (!m) return "";
  let h = parseInt(m[1], 10);
  const mer = m[3] ? m[3].toUpperCase() : "";
  if (mer === "PM" && h < 12) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function matches(query, parts) {
  const q = lower(query);
  if (!q) return true;
  return parts.some(p => lower(p).includes(q));
}


/************************************************************
 * STATE
 ************************************************************/

const STATE = {
  data: {
    tutors: { headers: [], readOnly: [], rows: [] },
    students: { headers: [], readOnly: [], rows: [] },
    demos: [],
    verificationValues: []
  },
  tab: "tuitions",
  tutorFilter: "all",
  tuitionFilter: "all",
  open: new Set(),      // keys of expanded cards
  editing: new Set()    // keys of records in edit mode
};

let TUTOR_BY_MOBILE = {};
let STUDENT_BY_ID = {};

function indexData() {

  TUTOR_BY_MOBILE = {};
  STUDENT_BY_ID = {};

  STATE.data.tutors.rows.forEach(r => {
    const key = mobileKey(r.values["Mobile Number"]);
    if (key) TUTOR_BY_MOBILE[key] = r;
  });

  STATE.data.students.rows.forEach(r => { STUDENT_BY_ID[r.id] = r; });

}


/************************************************************
 * START
 ************************************************************/

(function init() {

  wireEvents();

  if (getToken()) loadOverview();
  else showLogin();

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
      return false;
    }

    STATE.data = {
      tutors: result.tutors || { headers: [], readOnly: [], rows: [] },
      students: result.students || { headers: [], readOnly: [], rows: [] },
      demos: result.demos || [],
      verificationValues: result.verificationValues || ["Verified", "Rejected", "Pending for Verification"]
    };

    indexData();
    renderAll();
    showPage("panel");

    return true;

  } catch (error) {
    if (error.message === "not-admin") return false;
    console.error(error);
    if (quiet) toast("Unable to connect to the server.", true);
    else showLogin("Unable to connect to the server. Please try again.");
    return false;
  }

}

// Saves, then reloads everything so every card shows the sheet's truth.
async function save(payload, button) {

  const label = button ? button.textContent : "";

  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }

  try {

    const result = await adminCall(payload);

    if (!result.success) {
      toast(result.message || "Unable to save.", true);
      return false;
    }

    await loadOverview(true);
    toast(result.message || "Saved.");
    return true;

  } catch (error) {
    if (error.message !== "not-admin") toast("Unable to connect to the server.", true);
    return false;
  } finally {
    if (button && document.body.contains(button)) {
      button.disabled = false;
      button.textContent = label;
    }
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

  $("refreshButton").addEventListener("click", async () => {
    if (await loadOverview(true)) toast("Updated.");
  });

  $("mainTabs").addEventListener("click", (event) => {
    const tab = event.target.closest(".admin-tab");
    if (!tab) return;
    STATE.tab = tab.dataset.tab;
    $("mainTabs").querySelectorAll(".admin-tab").forEach(t => t.classList.toggle("active", t === tab));
    ["tuitions", "tutors", "students"].forEach(name =>
      $("tab-" + name).classList.toggle("hidden", name !== STATE.tab)
    );
  });

  chipGroup("tutorFilter", v => { STATE.tutorFilter = v; renderTutors(); });
  chipGroup("tuitionFilter", v => { STATE.tuitionFilter = v; renderTuitions(); });

  $("tutorSearch").addEventListener("input", renderTutors);
  $("tuitionSearch").addEventListener("input", renderTuitions);
  $("studentSearch").addEventListener("input", renderStudents);

  ["tuitionList", "tutorList", "studentList"].forEach(id =>
    $(id).addEventListener("click", onListClick)
  );

}

function chipGroup(id, onChange) {
  $(id).addEventListener("click", (event) => {
    const chip = event.target.closest(".admin-chip");
    if (!chip) return;
    $(id).querySelectorAll(".admin-chip").forEach(c => c.classList.toggle("active", c === chip));
    onChange(chip.dataset.value);
  });
}

function rerenderCurrent() {
  if (STATE.tab === "tuitions") renderTuitions();
  if (STATE.tab === "tutors") renderTutors();
  if (STATE.tab === "students") renderStudents();
}

async function onListClick(event) {

  const actionEl = event.target.closest("[data-action]");

  // Tapping a card's head opens / closes it.
  if (!actionEl) {
    const head = event.target.closest("[data-toggle]");
    if (!head) return;
    const key = head.dataset.toggle;
    const card = head.closest(".admin-card");
    const opening = !STATE.open.has(key);
    if (opening) STATE.open.add(key); else STATE.open.delete(key);
    // Show / hide only - never re-render, so anything typed in another
    // open card is kept.
    card.classList.toggle("is-open", opening);
    return;
  }

  const action = actionEl.dataset.action;
  const box = actionEl.closest("[data-box]");

  switch (action) {

    case "edit":
      STATE.editing.add(actionEl.dataset.key);
      rerenderCurrent();
      break;

    case "cancel":
      STATE.editing.delete(actionEl.dataset.key);
      rerenderCurrent();
      break;

    case "save-record":
      await saveRecord(box, actionEl);
      break;

    case "save-tuition":
      await saveTuition(box, actionEl);
      break;

    case "assign":
      await assignTutor(box, actionEl);
      break;

    case "terminate":
    case "reopen": {
      const value = action === "terminate";
      const demoId = box.dataset.demo;
      const ok = window.confirm(value
        ? `Terminate ${demoId}? It will be removed from Tuitions Available and all Accept / Reject buttons will be switched off.`
        : `Reopen ${demoId}?`);
      if (ok) await save({ action: "adminSetTerminated", demoId, value }, actionEl);
      break;
    }

    case "save-row":
      await saveDemoRow(box, actionEl);
      break;

  }

}


/************************************************************
 * SAVE HANDLERS
 ************************************************************/

async function saveRecord(box, button) {

  const kind = box.dataset.kind;
  const rowNumber = Number(box.dataset.row);
  const id = box.dataset.id;
  const key = box.dataset.key;

  const record = STATE.data[kind].rows.find(r => r.rowNumber === rowNumber && r.id === id);

  if (!record) {
    toast("That record has changed. Refresh and try again.", true);
    return;
  }

  const changes = {};

  box.querySelectorAll("[data-field]").forEach(input => {
    const field = input.dataset.field;
    const value = input.value.trim();
    if (value !== String(record.values[field] || "").trim()) changes[field] = value;
  });

  if (!Object.keys(changes).length) {
    STATE.editing.delete(key);
    rerenderCurrent();
    toast("Nothing changed.");
    return;
  }

  const ok = await save({ action: "adminUpdateRecord", kind, rowNumber, id, changes }, button);

  if (ok) {
    STATE.editing.delete(key);
    rerenderCurrent();
  }

}

async function saveTuition(box, button) {

  const demoId = box.dataset.demo;
  const changes = {};

  box.querySelectorAll("[data-tfield]").forEach(input => {
    changes[input.dataset.tfield] = input.value.trim();
  });

  if (!changes["Subject"]) {
    toast("Subject cannot be empty.", true);
    return;
  }

  const ok = await save({ action: "adminUpdateTuition", demoId, changes }, button);

  if (ok) {
    STATE.editing.delete("tuition:" + demoId);
    rerenderCurrent();
  }

}

async function assignTutor(box, button) {

  const input = box.querySelector("[data-assign]");
  const tutor = input.value.trim();

  if (!tutor) {
    toast("Enter a Tutor ID or mobile number.", true);
    input.focus();
    return;
  }

  const ok = await save({ action: "adminAssignTutor", demoId: box.dataset.demo, tutor }, button);

  if (ok) input.value = "";

}

async function saveDemoRow(box, button) {

  const rowNumber = Number(box.dataset.row);
  const demoId = box.dataset.demo;

  const date = box.querySelector("[data-rfield='date']").value;
  const time = box.querySelector("[data-rfield='time']").value;

  if ((date && !time) || (!date && time)) {
    toast("Choose both the demo date and time, or clear both.", true);
    return;
  }

  const parent = (box.querySelector(`input[name="parent-${rowNumber}"]:checked`) || {}).value || "pending";
  const tutor = (box.querySelector(`input[name="tutor-${rowNumber}"]:checked`) || {}).value || "pending";
  const completed = box.querySelector("[data-rfield='completed']").checked;

  if (completed && !(parent === "accepted" && tutor === "accepted")) {
    if (!window.confirm("Classes Completed is ticked but parent and tutor have not both accepted. Save anyway?")) return;
  }

  const changes = {
    "Demo Date": date,
    "Demo Time": time,
    "Price": box.querySelector("[data-rfield='price']").value.trim(),
    "Duration": box.querySelector("[data-rfield='duration']").value.trim(),
    "Percentage": box.querySelector("[data-rfield='percentage']").value.trim(),
    "Parent Accepted": parent === "accepted",
    "Parent Rejected": parent === "rejected",
    "Tutor Accepted": tutor === "accepted",
    "Tutor Rejected": tutor === "rejected",
    "Classes Completed": completed
  };

  await save({ action: "adminUpdateDemoRow", rowNumber, demoId, changes }, button);

}


/************************************************************
 * STATES
 ************************************************************/

function rowState(row) {
  if (row.terminated) return "terminated";
  if (!row.hasTutor) return "open";
  if (row.parentRejected || row.tutorRejected) return "declined";
  if (row.classesCompleted) return "completed";
  if (row.parentAccepted && row.tutorAccepted && (row.demoDate || row.demoTime)) return "running";
  if (row.parentAccepted || row.tutorAccepted) return (row.demoDate || row.demoTime) ? "processing" : "schedule";
  if (row.demoDate || row.demoTime) return "scheduled";
  return "schedule";
}

const ROW_LABELS = {
  open: "Open", schedule: "Needs demo", scheduled: "Demo scheduled",
  processing: "Processing", running: "Running", completed: "Completed",
  declined: "Declined", terminated: "Terminated"
};

function groupState(group) {
  const states = group.rows.map(rowState);
  if (states.includes("terminated")) return "terminated";
  if (states.includes("completed")) return "completed";
  if (states.includes("running")) return "running";
  if (states.includes("scheduled") || states.includes("processing")) return "scheduled";
  if (states.includes("schedule")) return "schedule";
  return "new";
}

const GROUP_LABELS = {
  new: "New", schedule: "To schedule", scheduled: "Demo scheduled",
  running: "Running", completed: "Completed", terminated: "Terminated"
};


/************************************************************
 * RENDER
 ************************************************************/

function renderAll() {
  renderStats();
  renderTuitions();
  renderTutors();
  renderStudents();
}

function demoGroups() {

  const groups = {};
  const order = [];

  (STATE.data.demos || []).forEach(row => {
    if (!groups[row.demoId]) {
      groups[row.demoId] = { demoId: row.demoId, rows: [], first: row };
      order.push(row.demoId);
    }
    groups[row.demoId].rows.push(row);
  });

  return order.map(id => groups[id]);

}

function renderStats() {

  const groups = demoGroups();
  const tutors = STATE.data.tutors.rows;

  const count = s => groups.filter(g => groupState(g) === s).length;

  const stats = [
    ["New tuitions", count("new"), "lime"],
    ["To schedule", count("schedule"), "violet"],
    ["Running", count("running"), "green"],
    ["Tutors pending", tutors.filter(t => statusGroup(t.values["Verification Status"]) === "pending").length, "amber"]
  ];

  $("adminStats").innerHTML = stats.map(([label, value, tone]) => `
    <div class="admin-stat" data-tone="${tone}">
      <div class="admin-stat-value">${esc(value)}</div>
      <div class="admin-stat-label">${esc(label)}</div>
    </div>
  `).join("");

}


/* ---------------- generic record (tutor / student) ---------------- */

function fieldsView(kind, record) {

  const data = STATE.data[kind];

  return `
    <dl class="admin-facts">
      ${data.headers.map(h => {
        const value = record.values[h] || "";
        if (!value) return "";
        const shown = LINK_FIELDS.includes(h) && /^https?:\/\//i.test(value)
          ? `<a href="${esc(value)}" target="_blank" rel="noopener">Open</a>`
          : esc(value);
        return `<div><dt>${esc(h)}</dt><dd>${shown}</dd></div>`;
      }).join("")}
    </dl>
  `;

}

function fieldsForm(kind, record) {

  const data = STATE.data[kind];
  const readOnly = (data.readOnly || []).map(lower);

  return `
    <div class="admin-form">
      ${data.headers.map(h => {

        const value = record.values[h] || "";

        if (readOnly.includes(lower(h))) {
          return `<div class="admin-field is-readonly"><span>${esc(h)}</span><p>${esc(value) || "—"}</p></div>`;
        }

        if (lower(h) === "verification status") {
          const values = STATE.data.verificationValues;
          const current = values.find(v => lower(v) === lower(value)) || "Pending for Verification";
          return `
            <label class="admin-field">
              <span>${esc(h)}</span>
              <select data-field="${esc(h)}">
                ${values.map(v => `<option${v === current ? " selected" : ""}>${esc(v)}</option>`).join("")}
              </select>
            </label>`;
        }

        const long = value.length > 60 || /address|subject you teach|classes you teach|boards you teach|languages|special/i.test(h);

        return `
          <label class="admin-field${long ? " wide" : ""}">
            <span>${esc(h)}</span>
            ${long
              ? `<textarea data-field="${esc(h)}" rows="2">${esc(value)}</textarea>`
              : `<input data-field="${esc(h)}" type="text" value="${esc(value)}">`}
          </label>`;

      }).join("")}
    </div>
  `;

}

function recordCard(kind, record, opts) {

  const key = `${kind}:${record.id}`;
  const open = STATE.open.has(key);
  const editing = STATE.editing.has(key);

  return `
    <article class="admin-card${open ? " is-open" : ""}" data-tone="${opts.tone || ""}"
      data-box data-kind="${kind}" data-row="${record.rowNumber}" data-id="${esc(record.id)}" data-key="${esc(key)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        <div class="admin-avatar">${esc(initials(opts.name, kind === "tutors" ? "T" : "S"))}</div>
        <div class="admin-card-title">
          <strong>${esc(opts.name || record.id)}</strong>
          <small>${esc(opts.sub)}</small>
        </div>
        ${opts.pill ? `<span class="admin-pill" data-tone="${opts.tone}">${esc(opts.pill)}</span>` : ""}
        <span class="admin-caret" aria-hidden="true"></span>
      </div>

      
        <div class="admin-card-body">
          ${editing ? fieldsForm(kind, record) : fieldsView(kind, record)}
          ${opts.extra || ""}
          <div class="admin-actions">
            ${editing
              ? `<button class="admin-primary small" data-action="save-record" type="button">Save changes</button>
                 <button class="admin-ghost small" data-action="cancel" data-key="${esc(key)}" type="button">Cancel</button>`
              : `<button class="admin-ghost small" data-action="edit" data-key="${esc(key)}" type="button">Edit details</button>`}
          </div>
          ${editing && kind === "students" ? `<p class="admin-note">Changing the Email moves this student to that login. Brothers / sisters share one Email and Phone.</p>` : ""}
          ${editing && kind === "tutors" ? `<p class="admin-note">Changing the Mobile Number also moves this tutor's tuitions to the new number.</p>` : ""}
        </div>

    </article>
  `;

}

function renderTutors() {

  const rows = STATE.data.tutors.rows
    .filter(r => STATE.tutorFilter === "all" || statusGroup(r.values["Verification Status"]) === STATE.tutorFilter)
    .filter(r => matches($("tutorSearch").value, [r.id, r.values["Full Name"], r.values["Mobile Number"],
      r.values["City"], r.values["Subject You Teach"], r.values["E-mail Address"]]))
    .slice()
    .sort((a, b) => {
      const order = { pending: 0, rejected: 1, verified: 2 };
      return (order[statusGroup(a.values["Verification Status"])] - order[statusGroup(b.values["Verification Status"])]) ||
        (b.rowNumber - a.rowNumber);
    });

  $("tutorList").innerHTML = rows.length ? rows.map(r => {
    const status = r.values["Verification Status"] || "Pending for Verification";
    return recordCard("tutors", r, {
      name: r.values["Full Name"],
      sub: [r.id, r.values["Mobile Number"], r.values["City"]].filter(Boolean).join(" · "),
      pill: status,
      tone: statusGroup(status)
    });
  }).join("") : empty("No tutors match.");

}

function renderStudents() {

  const rows = STATE.data.students.rows
    .filter(r => matches($("studentSearch").value, [r.id, r.values["Student Name"], r.values["Parents Name"],
      r.values["Phone"], r.values["School"], r.values["City"], r.values["Email"]]))
    .slice()
    .reverse();

  const groups = demoGroups();

  $("studentList").innerHTML = rows.length ? rows.map(r => {

    const mine = groups.filter(g => g.first.studentId === r.id);

    const extra = mine.length ? `
      <div class="admin-mini-list">
        <span class="admin-mini-title">Tuitions</span>
        ${mine.map(g => `<span class="admin-pill" data-tone="${groupState(g)}">${esc(g.first.subject)} · ${esc(GROUP_LABELS[groupState(g)])}</span>`).join("")}
      </div>` : "";

    return recordCard("students", r, {
      name: r.values["Student Name"],
      sub: [r.id, r.values["Parents Name"] ? `(${r.values["Parents Name"]})` : "", r.values["Class"]].filter(Boolean).join(" · "),
      extra
    });

  }).join("") : empty("No students match.");

}


/* ---------------- tuitions ---------------- */

function renderTuitions() {

  const query = $("tuitionSearch").value;
  const filter = STATE.tuitionFilter;

  const list = demoGroups().filter(g => {

    const student = STUDENT_BY_ID[g.first.studentId];
    const tutorNames = g.rows.map(r => {
      const t = TUTOR_BY_MOBILE[r.mobileKey];
      return t ? `${t.values["Full Name"]} ${t.id}` : "";
    });

    if (!matches(query, [g.demoId, g.first.subject, g.first.studentId,
      student && student.values["Student Name"], student && student.values["City"], ...tutorNames])) return false;

    return filter === "all" || groupState(g) === filter;

  }).reverse();

  $("tuitionList").innerHTML = list.length ? list.map(tuitionStack).join("") : empty("No tuitions match.");

}

function tuitionStack(g) {

  const key = "tuition:" + g.demoId;
  const open = STATE.open.has(key);
  const editing = STATE.editing.has(key);
  const state = groupState(g);
  const f = g.first;
  const student = STUDENT_BY_ID[f.studentId];
  const studentName = student ? student.values["Student Name"] : f.studentId;
  const tutorRows = g.rows.filter(r => r.hasTutor);
  const terminated = state === "terminated";

  const head = `
    <article class="admin-card tuition-card${open ? " is-open" : ""}" data-box data-demo="${esc(g.demoId)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        <div class="admin-card-title">
          <strong>${esc(f.subject || "Subject")} <span class="muted">· ${esc(g.demoId)}</span></strong>
          <small>${esc(studentName)}${student && student.values["Class"] ? " · " + esc(student.values["Class"]) : ""}${student && student.values["City"] ? " · " + esc(student.values["City"]) : ""} · ${tutorRows.length} tutor${tutorRows.length === 1 ? "" : "s"}</small>
        </div>
        <span class="admin-pill" data-tone="${state}">${esc(GROUP_LABELS[state])}</span>
        <span class="admin-caret" aria-hidden="true"></span>
      </div>

      
        <div class="admin-card-body">

          <h3 class="admin-section-title">Tuition</h3>
          ${editing ? tuitionForm(f) : `
            <dl class="admin-facts">
              ${fact("Demo ID", g.demoId)}
              ${fact("Subject", f.subject)}
              ${fact("Medium", mediumText(f.medium))}
              ${fact("Preferred tutor", genderText(f.preferredTutor))}
              ${fact("Preferred timing", f.preferredTiming)}
              ${fact("Posted on", f.postedOn)}
            </dl>`}

          <div class="admin-actions">
            ${editing
              ? `<button class="admin-primary small" data-action="save-tuition" type="button">Save tuition</button>
                 <button class="admin-ghost small" data-action="cancel" data-key="${esc(key)}" type="button">Cancel</button>`
              : `<button class="admin-ghost small" data-action="edit" data-key="${esc(key)}" type="button">Edit tuition</button>`}
            ${terminated
              ? `<button class="admin-ghost small" data-action="reopen" type="button">Reopen tuition</button>`
              : `<button class="admin-ghost small admin-danger" data-action="terminate" type="button">Terminate tuition</button>`}
          </div>

          <h3 class="admin-section-title">Student</h3>
          ${student ? fieldsView("students", student) : `<p class="admin-note">Student ${esc(f.studentId)} was not found in the Students sheet.</p>`}

          ${terminated ? "" : `
            <h3 class="admin-section-title">Assign a tutor</h3>
            <div class="admin-assign">
              <input data-assign type="text" placeholder="Tutor ID or mobile number" autocomplete="off">
              <button class="admin-primary small" data-action="assign" type="button">Assign</button>
            </div>`}

        </div>

    </article>
  `;

  const tutorCards = tutorRows
    .slice()
    .sort((a, b) => tutorOrder(rowState(a)) - tutorOrder(rowState(b)))
    .map(r => tutorRowCard(r, terminated))
    .join("");

  return `<div class="admin-stack${tutorRows.length ? " has-tutors" : ""}">${head}${tutorCards}</div>`;

}

function tutorOrder(state) {
  return { running: 0, completed: 1, processing: 2, scheduled: 3, schedule: 4, declined: 5, terminated: 6 }[state] ?? 9;
}

function tuitionForm(f) {

  const select = (field, options, value) => `
    <label class="admin-field">
      <span>${esc(field)}</span>
      <select data-tfield="${esc(field)}">
        ${options.map(o => `<option${lower(o) === lower(value) ? " selected" : ""}>${esc(o)}</option>`).join("")}
      </select>
    </label>`;

  return `
    <div class="admin-form">
      <label class="admin-field">
        <span>Subject</span>
        <input data-tfield="Subject" type="text" value="${esc(f.subject)}">
      </label>
      ${select("Preferred Tutor", ["Any", "Male", "Female"], f.preferredTutor || "Any")}
      ${select("Medium", ["Any", "Online", "Offline"], f.medium || "Any")}
      <label class="admin-field wide">
        <span>Preferred Timing</span>
        <input data-tfield="Preferred Timing" type="text" value="${esc(f.preferredTiming)}" placeholder="8 AM, 5 PM">
      </label>
    </div>
  `;

}

function tutorRowCard(row, terminated) {

  const tutor = TUTOR_BY_MOBILE[row.mobileKey];
  const key = `row:${row.rowNumber}:${row.demoId}`;
  const open = STATE.open.has(key);
  const state = rowState(row);
  const name = tutor ? tutor.values["Full Name"] : "Unknown tutor";
  const gender = tutor ? tutor.values["Gender"] : "";
  const verification = tutor ? tutor.values["Verification Status"] : "";

  const parent = row.parentAccepted ? "accepted" : row.parentRejected ? "rejected" : "pending";
  const tut = row.tutorAccepted ? "accepted" : row.tutorRejected ? "rejected" : "pending";

  const segmented = (who, value) => `
    <div class="admin-seg" role="radiogroup" aria-label="${who === "parent" ? "Parent" : "Tutor"}">
      ${["pending", "accepted", "rejected"].map(v => `
        <label>
          <input type="radio" name="${who}-${row.rowNumber}" value="${v}"${v === value ? " checked" : ""}${terminated ? " disabled" : ""}>
          <span data-v="${v}">${v === "pending" ? "Pending" : v === "accepted" ? "Accepted" : "Rejected"}</span>
        </label>`).join("")}
    </div>`;

  return `
    <article class="admin-card tutor-row-card${open ? " is-open" : ""}" data-tone="${state}"
      data-box data-row="${row.rowNumber}" data-demo="${esc(row.demoId)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        <div class="admin-avatar">${esc(initials(name, "T"))}</div>
        <div class="admin-card-title">
          <strong>${esc(name)}</strong>
          <small>${esc(gender)}${tutor ? " · " + esc(tutor.id) : " · " + esc(row.mobile)}${lower(verification) === "verified" ? "" : ` · <span class="warn">${esc(verification || "Not verified")}</span>`}</small>
        </div>
        <span class="admin-pill" data-tone="${state}">${esc(ROW_LABELS[state])}</span>
        <span class="admin-caret" aria-hidden="true"></span>
      </div>

      
        <div class="admin-card-body">

          <h3 class="admin-section-title">Tutor</h3>
          ${tutor ? fieldsView("tutors", tutor) : `<p class="admin-note">No tutor in the Tutors sheet has mobile ${esc(row.mobile)}.</p>`}

          <h3 class="admin-section-title">Demo</h3>
          <div class="admin-form">
            <label class="admin-field"><span>Demo date</span><input data-rfield="date" type="date" value="${esc(toDateInput(row.demoDate))}"${terminated ? " disabled" : ""}></label>
            <label class="admin-field"><span>Demo time</span><input data-rfield="time" type="time" value="${esc(toTimeInput(row.demoTime))}"${terminated ? " disabled" : ""}></label>
            <label class="admin-field"><span>Price</span><input data-rfield="price" type="text" value="${esc(row.price)}"${terminated ? " disabled" : ""}></label>
            <label class="admin-field"><span>Duration</span><input data-rfield="duration" type="text" value="${esc(row.duration)}"${terminated ? " disabled" : ""}></label>
            <label class="admin-field"><span>Percentage</span><input data-rfield="percentage" type="text" value="${esc(row.percentage)}"${terminated ? " disabled" : ""}></label>
          </div>

          <h3 class="admin-section-title">Parent</h3>
          ${segmented("parent", parent)}

          <h3 class="admin-section-title">Tutor</h3>
          ${segmented("tutor", tut)}

          <label class="admin-check">
            <input data-rfield="completed" type="checkbox"${row.classesCompleted ? " checked" : ""}${terminated ? " disabled" : ""}>
            <span>Classes completed</span>
          </label>

          ${terminated
            ? `<p class="admin-note">This tuition is terminated. Reopen it to make changes.</p>`
            : `<div class="admin-actions">
                 <button class="admin-primary small" data-action="save-row" type="button">Save</button>
               </div>`}

        </div>

    </article>
  `;

}

function fact(label, value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

function empty(text) {
  return `<div class="admin-empty">${esc(text)}</div>`;
}
