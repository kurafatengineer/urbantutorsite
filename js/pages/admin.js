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
 * SERVER: the Supabase Edge Function "admin"
 *   (supabase/functions/admin/index.ts). Login is your own email +
 *   a one-time code (the same Supabase Auth flow students/tutors
 *   use elsewhere on the site) - there is no shared password
 *   anymore. The function looks your email up in admin_users to
 *   find your role, and only allows the actions your role permits:
 *   adminGetOverview  adminUpdateRecord  adminUpdateTuition
 *   adminUpdateDemoRow  adminAssignTutor  adminSetTerminated  adminDeleteTuition
 *   adminAddPayment  adminUpdatePayment  adminDeletePayment
 *   adminListEmployees  adminAddEmployee  adminUpdateEmployee
 *   adminBootstrapSuperAdmin (only while no admin account exists yet)
 *
 * Your session comes from window.sb (js/supabase-client.js) and is
 * sent as an Authorization: Bearer <token> header on every request.
 ************************************************************/

const WEB_APP_URL =
  "https://zbvtdcqoouwyrcxkzjfv.supabase.co/functions/v1/admin";

const LINK_FIELDS = ["Identity Proof", "Profile Image"];

// Chip search (see wireChipSearch/renderSearchChips below): declared
// here, before wireEvents() runs, because wireEvents() calls
// wireChipSearch() synchronously during page init - a `const`
// declared further down the file would still be in its temporal
// dead zone at that point and throw, which silently aborted all of
// init() (including ever calling showPage()), leaving the page
// stuck on the loading screen.
const SEARCH_CHIPS = {}; // input id -> array of committed filter words

// Record a Payment's typed-into lookup boxes (see wirePaymentLookups) -
// also needed by wireEvents() during init, so declared up here.
const PAYMENT_STUDENT_BOXES = ["paymentStudentMobile", "paymentStudentName", "paymentStuId", "paymentStuWhatsapp", "paymentParentName"];
const PAYMENT_TUTOR_BOXES = ["paymentTutorMobile", "paymentTutorName"];
const PAYMENT_PARTY_BOXES = ["paymentSubId", "paymentSubMobile", "paymentSubName"];

const ROLE_LABELS = {
  super_admin: "Super Admin",
  tuition_coordinator: "Tuition Coordinator",
  verification_staff: "Verification Staff",
  accounts_finance: "Accounts / Finance",
  tutor_relations: "Tutor Relations",
};

/* =====================================================================
   WHO AM I + SMALL HELPERS
   What the logged-in employee is allowed to do, plus tiny shared helpers
   (safe text, money text, numbers). Used by every section below.
   ===================================================================== */

// Each employee has their own list of permissions (see the Employees
// tab); the server sends the effective list with the overview.
function myPerms() {
  const list = (STATE.me && STATE.me.permissions) || [];
  const has = k => list.includes(k);
  return {
    tuitions: has("tuitions_view"),
    tutorsView: has("tutors_view"), tutorsEdit: has("tutors_edit"), tutorsVerify: has("tutors_verify"),
    students: has("students_view"), studentsEdit: has("students_edit"),
    studentsMute: has("students_mute"), studentsBlock: has("students_block"),
    payments: has("payments_view"), paymentsAdd: has("payments_add"),
    paymentsEdit: has("payments_edit"), paymentsDelete: has("payments_delete"),
    subscriptionsAdd: has("subscriptions_add"), subscriptionsEdit: has("subscriptions_edit"),
    studentsAdd: has("students_add"), tuitionsAdd: has("tuitions_add"), tuitionsDelete: has("tuitions_delete"),
    employees: has("employees_manage")
  };
}


/************************************************************
 * HELPERS
 ************************************************************/

const $ = id => document.getElementById(id);

function showPage(name) {
  ["login", "loading", "panel"].forEach(n =>
    $(n + "Page").classList.toggle("hidden", n !== name)
  );
  if (name === "panel") showNotice("");
}

// The light red line under the header: why the person was logged out.
function showNotice(text) {
  const el = $("adminNotice");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
}

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Money text, Indian style: 1500 -> "₹1,500".
// rupeesRounded() does the same but first rounds to a whole rupee (graphs).
function rupees(n) {
  return "₹" + Number(n || 0).toLocaleString("en-IN");
}

function rupeesRounded(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

// Strips currency symbols/commas etc. off a display value like "₹1,200"
// and returns a plain number, or 0 if there's nothing usable in it.
function num(value) {
  const n = Number(String(value == null ? "" : value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/* =====================================================================
   TALKING TO THE SERVER
   Every button that saves or loads data goes through these functions.
   adminCall() sends the request with the employee's login token; if the
   server says "not an admin" the person is logged out automatically.
   ===================================================================== */

async function getAccessToken() {
  try {
    // a Student / Tutor login must not open the Admin panel, even for the same email
    if (!(await window.UrbanPortal.allows("admin"))) return "";
    const { data } = await window.sb.auth.getSession();
    return (data && data.session && data.session.access_token) || "";
  } catch (e) {
    return "";
  }
}

// The server (a Supabase Edge Function) goes to sleep when unused, and
// the first request that wakes it can fail. So a failed request (no
// connection or a server error) is tried once more after a short pause.
// Every admin action is safe to repeat.
async function apiRequest(payload, timeoutMs = 60000, token = "") {

  try {
    return await apiRequestOnce(payload, timeoutMs, token);
  } catch (error) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return apiRequestOnce(payload, timeoutMs, token);
  }

}

async function apiRequestOnce(payload, timeoutMs, token = "") {

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {

    const headers = { "Content-Type": "text/plain;charset=utf-8" };
    if (token) headers["Authorization"] = "Bearer " + token;

    const response = await fetch(WEB_APP_URL, {
      method: "POST",
      headers,
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

  const token = await getAccessToken();
  const result = await apiRequest(payload, 60000, token);

  if (result && result.notAdmin) {
    const wasOpen = panelIsOpen();
    await window.sb.auth.signOut().catch(() => {});
    STATE.me = null;
    if (wasOpen || result.outsideHours) {
      showEmailStep("");
      showNotice(result.message);
    } else {
      showEmailStep(result.message);
    }
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
const mediumText = v => isAny(v) ? "Online | Home" : String(v || "").replace(/^offline$/i, "Home");
const genderText = v => isAny(v) ? "Male | Female" : (v || "");

/* =====================================================================
   DATA PREPARATION
   Builds quick lookup tables (by Demo ID, Student ID, Tutor ID) from the
   data the server sent, so cards can show linked details without searching.
   ===================================================================== */

// A tutor row's join key: the server sends an opaque one when contact
// numbers are hidden for this employee, otherwise it's the number itself.
function tutorKey(row) {
  return (row && row.mobileKey) || mobileKey(row && row.values && row.values["Mobile Number"]);
}

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
  me: null,             // { email, fullName, role }
  settings: null,       // { mailsEnabled } - office-wide switches
  payments: [],
  subscriptions: [],
  employees: [],
  permInfo: null,       // { groups, presets, parents } - the permission checklist, sent to employee managers
  directory: { demos: [], students: [], tutors: [] },
  tab: "tuitions",
  tutorFilter: "all",
  tuitionFilter: "all",
  ledgerFilter: "all",
  graphFilter: "all",   // which purpose the graph is scoped to
  graphPeriod: "365",   // days of history the chart covers ("0" = all time)
  open: new Set(),      // keys of expanded cards
  editing: new Set(),   // keys of records in edit mode
  studentOpen: new Set(), // keys of tuition cards whose nested Student section is expanded
  quickOpen: new Set()  // keys opened via the status rail: only the relevant fields + Save
};

let TUTOR_BY_MOBILE = {};
let TUTOR_BY_ID = {};
let STUDENT_BY_ID = {};
let DIR_DEMO_BY_ID = {};
let DIR_STUDENT_BY_ID = {};
let DIR_TUTOR_BY_ID = {};

function indexData() {

  TUTOR_BY_MOBILE = {};
  TUTOR_BY_ID = {};
  STUDENT_BY_ID = {};

  STATE.data.tutors.rows.forEach(r => {
    const key = tutorKey(r);
    if (key) TUTOR_BY_MOBILE[key] = r;
    TUTOR_BY_ID[r.id] = r;
  });

  STATE.data.students.rows.forEach(r => { STUDENT_BY_ID[r.id] = r; });

  DIR_DEMO_BY_ID = {};
  DIR_STUDENT_BY_ID = {};
  DIR_TUTOR_BY_ID = {};

  (STATE.directory.demos || []).forEach(d => { DIR_DEMO_BY_ID[d.demoId] = d; });
  (STATE.directory.students || []).forEach(s => { DIR_STUDENT_BY_ID[s.id] = s; });
  (STATE.directory.tutors || []).forEach(t => { DIR_TUTOR_BY_ID[t.id] = t; });

}


/************************************************************
 * START
 ************************************************************/

(async function init() {

  wireEvents();

  // Wake the server up now, while the person is opening the page.
  apiRequestOnce({ action: "adminGetOverview" }, 20000).catch(() => {});

  const { data } = await window.sb.auth.getSession();

  if (data && data.session && await window.UrbanPortal.allows("admin")) {
    // A session left behind for more than 30 minutes without any
    // activity is ended instead of resumed.
    if (lastActiveAt() && Date.now() - lastActiveAt() > IDLE_LIMIT_MS) {
      await forceLogout("You were logged out after 30 minutes of inactivity.");
    } else {
      markActive(true);
      await loadOverview();
    }
  } else showEmailStep();

  startIdleWatch();

})();

/************************************************************
 * AUTO LOG-OUT - 30 minutes without any activity
 ************************************************************/

const IDLE_LIMIT_MS = 30 * 60 * 1000;
const ACTIVE_KEY = "admin_last_active";
let lastMarked = 0;

/* =====================================================================
   AUTO LOGOUT + LOGIN SCREEN
   Idle timeout, the email -> 6-digit code login steps, and the one-time
   "first Super Admin" setup screen.
   ===================================================================== */

function lastActiveAt() {
  try { return Number(localStorage.getItem(ACTIVE_KEY)) || 0; } catch (e) { return 0; }
}

// Written to localStorage so several tabs (and a reopened tab) share it.
function markActive(force) {
  const now = Date.now();
  if (!force && now - lastMarked < 5000) return;
  lastMarked = now;
  try { localStorage.setItem(ACTIVE_KEY, String(now)); } catch (e) {}
}

async function forceLogout(message) {
  // so the Employees section shows them logged out straight away
  try { await apiRequest({ action: "adminSession", event: "logout" }, 5000, await getAccessToken()); } catch (e) {}
  try { await window.sb.auth.signOut(); } catch (e) {}
  STATE.me = null;
  if (window.setAdminHeaderInitials) window.setAdminHeaderInitials("");
  showEmailStep("");
  showNotice(message);
}

function panelIsOpen() {
  return !$("panelPage").classList.contains("hidden");
}

async function logoutIfIdle() {
  if (!panelIsOpen()) return;
  if (Date.now() - lastActiveAt() > IDLE_LIMIT_MS) {
    await forceLogout("You were logged out after 30 minutes of inactivity.");
  }
}

function startIdleWatch() {
  ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"].forEach(name =>
    document.addEventListener(name, () => { if (panelIsOpen()) markActive(false); }, { passive: true, capture: true })
  );
  document.addEventListener("visibilitychange", () => { if (!document.hidden) logoutIfIdle(); });
  setInterval(logoutIfIdle, 30000);
  setInterval(presencePing, 60000);
}

/* PRESENCE - every minute while the panel is open: "I'm here" (+ "and
   working" if the mouse / keyboard was used since the last ping). Also
   refreshes the Employees section's online / working signs, and ends
   the session once the employee's login hours are over. */
var lastPingAt = 0;
async function presencePing() {
  if (!panelIsOpen() || document.hidden) return;
  const active = lastActiveAt() > lastPingAt;
  lastPingAt = Date.now();
  try {
    const result = await adminCall({ action: "adminPing", active });
    if (result && result.employees) {
      STATE.employees = result.employees;
      const editingEmployee = [...STATE.editing].some(k => k.startsWith("employee:"));
      if (STATE.tab === "employees" && !editingEmployee) renderEmployees();
    }
  } catch (e) { /* not-admin is handled inside adminCall */ }
}

let pendingEmail = "";
// Asks the server to email a login code. Returns { ok, message }.
// The server ("adminSendCode") decides whether this email may get a code and
// always answers the same way, so this page never reveals which emails belong
// to office staff.
async function requestLoginCode(email) {

  try {
    const result = await apiRequest({ action: "adminSendCode", email }, 20000);
    if (result && result.success) return { ok: true };
    if (result && result.message) return { ok: false, message: result.message };
  } catch (error) {
    console.error("adminSendCode failed", error);
  }

  return { ok: false, message: "Unable to send the code right now. Please try again." };

}

let resendTimer = null;

function showEmailStep(message) {
  $("emailStepForm").classList.remove("hidden");
  $("otpStepForm").classList.add("hidden");
  $("bootstrapStepForm").classList.add("hidden");
  $("emailMessage").textContent = message || "";
  showPage("login");
  setTimeout(() => $("adminEmail").focus(), 50);
}

function showOtpStep(email) {
  $("otpEmailDisplay").textContent = email;
  $("emailStepForm").classList.add("hidden");
  $("otpStepForm").classList.remove("hidden");
  $("bootstrapStepForm").classList.add("hidden");
  resetOtpBoxes();
  $("otpMessage").textContent = "";
  showPage("login");
  setTimeout(() => otpBoxes()[0].focus(), 50);
}

// ---- six-block code entry: one digit per block, auto-verifies on the 6th ----

function otpBoxes() { return [...document.querySelectorAll("#otpBoxes .otp-box")]; }
let verifyingOtp = false;

function resetOtpBoxes(wrong) {
  otpBoxes().forEach(box => { box.value = ""; box.classList.toggle("is-wrong", !!wrong); });
}

function otpCode() {
  return otpBoxes().map(box => box.value).join("");
}

// A wrong code isn't explained: the blocks just empty and turn red until
// the next digit is typed.
async function verifyOtpCode() {

  const code = otpCode();
  if (verifyingOtp || !/^\d{6}$/.test(code)) return;

  verifyingOtp = true;
  otpBoxes().forEach(box => { box.disabled = true; });
  $("otpMessage").textContent = "";

  try {

    const { error } = await window.sb.auth.verifyOtp({ email: pendingEmail, token: code, type: "email" });

    if (error) {
      resetOtpBoxes(true);
      return;
    }

    // this login was made at the ADMIN door (see js/portal.js)
    await window.UrbanPortal.set("admin");

    markActive(true);
    await loadOverview();

  } catch (error) {
    console.error(error);
    $("otpMessage").textContent = "Unable to connect to the server. Please try again.";
    resetOtpBoxes();
  } finally {
    verifyingOtp = false;
    otpBoxes().forEach(box => { box.disabled = false; });
    if (!$("otpStepForm").classList.contains("hidden")) otpBoxes()[0].focus();
  }

}

function wireOtpBoxes() {

  const boxes = otpBoxes();

  boxes.forEach((box, i) => {

    box.addEventListener("input", () => {
      const digits = box.value.replace(/\D/g, "");
      box.value = digits.slice(-1);
      boxes.forEach(b => b.classList.remove("is-wrong"));
      if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
      if (otpCode().length === 6) verifyOtpCode();
    });

    box.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !box.value && i > 0) {
        boxes[i - 1].value = "";
        boxes[i - 1].focus();
        event.preventDefault();
      } else if (event.key === "ArrowLeft" && i > 0) {
        boxes[i - 1].focus();
      } else if (event.key === "ArrowRight" && i < boxes.length - 1) {
        boxes[i + 1].focus();
      }
    });

    box.addEventListener("focus", () => box.select());

    // Pasting (or an SMS auto-fill) a whole code fills every block.
    box.addEventListener("paste", (event) => {
      const digits = ((event.clipboardData || window.clipboardData).getData("text") || "").replace(/\D/g, "").slice(0, 6);
      if (!digits) return;
      event.preventDefault();
      boxes.forEach((b, k) => { b.value = digits[k] || ""; b.classList.remove("is-wrong"); });
      boxes[Math.min(digits.length, 5)].focus();
      if (digits.length === 6) verifyOtpCode();
    });

  });

}

function showBootstrapStep() {
  $("emailStepForm").classList.add("hidden");
  $("otpStepForm").classList.add("hidden");
  $("bootstrapStepForm").classList.remove("hidden");
  $("bootstrapMessage").textContent = "";
  showPage("login");
}

function startResendTimer(seconds) {
  clearInterval(resendTimer);
  let remaining = seconds;
  updateResendLabel(remaining);
  resendTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) { clearInterval(resendTimer); resendTimer = null; }
    updateResendLabel(remaining);
  }, 1000);
}

function updateResendLabel(remaining) {
  const btn = $("resendCodeButton");
  btn.disabled = remaining > 0;
  btn.textContent = remaining > 0 ? `Resend in ${remaining}s` : "Resend Code";
}

/* =====================================================================
   PANEL START-UP
   Shows/hides tabs by role, loads all data (loadOverview) and wires every
   button and form (wireEvents).
   ===================================================================== */

function applyRoleUI() {

  const perms = myPerms();

  const visibility = {
    tuitions: perms.tuitions,
    tutors: perms.tutorsView,
    students: perms.students,
    payments: perms.payments,
    subscriptions: perms.payments,
    ledger: perms.payments,
    employees: perms.employees,
    graph: perms.payments
  };

  let firstVisible = null;

  ["tuitions", "tutors", "students", "payments", "subscriptions", "ledger", "employees", "graph"].forEach(name => {
    const tabButton = document.querySelector(`.admin-tab[data-tab="${name}"]`);
    if (tabButton) tabButton.classList.toggle("hidden", !visibility[name]);
    if (visibility[name] && !firstVisible) firstVisible = name;
  });

  $("addPaymentButton").classList.toggle("hidden", !perms.paymentsAdd);
  $("addSubscriptionButton").classList.toggle("hidden", !perms.subscriptionsAdd);
  $("addStudentButton").classList.toggle("hidden", !perms.studentsAdd);
  $("applyTuitionButton").classList.toggle("hidden", !perms.tuitionsAdd);
  $("studentActionsRow").classList.toggle("hidden", !perms.studentsAdd && !perms.tuitionsAdd);

  if (!visibility[STATE.tab]) STATE.tab = firstVisible || "tuitions";

  if (window.setAdminHeaderInitials) window.setAdminHeaderInitials(STATE.me && STATE.me.fullName);

  $("adminMe").innerHTML = (STATE.me && STATE.me.fullName)
    ? `<span class="admin-me-name">${esc(STATE.me.fullName)}</span><span class="admin-role-pill" data-role="${esc(STATE.me.role)}">${esc(ROLE_LABELS[STATE.me.role] || STATE.me.role)}</span>`
    : "";

  renderMailToggle();

  applyActiveTab();

}

/* =====================================================================
   HEADER SWITCHES
   - Emails On / Off:
       Super Admin -> the switch for the WHOLE SITE: Off stops every
         notification email (Admin Panel, students, tutors); only login
         codes (OTP) still go out.
       Other employees -> their OWN switch: Off stops the emails for the
         updates THEY make. Needs the "Switch off emails" permission;
         without it (or while the Super Admin has all emails off) the
         button shows but is disabled.
   - Dark / Light mode: only how this Admin Panel looks, saved on this
     device (the <head> of admin.html applies it before the page draws).
   ===================================================================== */

const THEME_KEY = "urbanAdminTheme";

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f4f5f7" : "#050505");
  const button = $("themeToggle");
  if (button) {
    const next = theme === "light" ? "Dark" : "Light";
    button.querySelector(".admin-switch-text").textContent = next + " Mode";
    button.setAttribute("aria-label", "Switch to " + next.toLowerCase() + " mode");
    button.title = "Switch the Admin Panel to " + next.toLowerCase() + " mode";
  }
}

function renderMailToggle() {
  const button = $("mailToggle");
  if (!button) return;
  const known = !!(STATE.me && STATE.settings && typeof STATE.settings.mailsEnabled === "boolean");
  button.classList.toggle("hidden", !known);
  if (!known) return;
  const on = STATE.settings.mailsEnabled;
  const canChange = !!STATE.settings.canToggleMails;
  button.dataset.on = String(on);
  button.setAttribute("aria-pressed", String(on));
  button.querySelector(".admin-switch-text").textContent = on ? "Emails On" : "Emails Off";
  button.disabled = !canChange;
  const site = STATE.settings.scope === "site";
  button.title = site
    ? (on ? "Emails are on for the whole site. Click to switch OFF every notification email (login codes still go out)."
          : "All notification emails are off for the whole site. Click to switch them back on.")
    : STATE.settings.siteOff
      ? "The Super Admin has switched off all emails."
      : canChange
        ? (on ? "Your updates email students and tutors. Click to stop emails for your updates."
              : "Your updates send no email. Click to start these emails again.")
        : "Your updates email students and tutors. You don't have permission to switch this off.";
}

// The "are you sure?" box: title, justified text, Cancel (left) / OK (right).
// Resolves true for OK; Cancel, Esc or a tap outside the box give false.
// okText renames the OK button (Block, Unblock, ...).
function askConfirm({ title, lines, okText }) {
  const box = $("adminConfirm");
  $("adminConfirmTitle").textContent = title;
  $("adminConfirmText").innerHTML = lines.map(l => `<p>${esc(l)}</p>`).join("");
  box.querySelector('[data-confirm="ok"]').textContent = okText || "OK";
  box.classList.remove("hidden");
  box.setAttribute("aria-hidden", "false");
  const cancelButton = box.querySelector('[data-confirm="cancel"].admin-ghost');
  cancelButton.focus();
  return new Promise(resolve => {
    const finish = (answer) => {
      box.classList.add("hidden");
      box.setAttribute("aria-hidden", "true");
      box.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey, true);
      resolve(answer);
    };
    const onClick = (event) => {
      const el = event.target.closest("[data-confirm]");
      if (el) finish(el.dataset.confirm === "ok");
    };
    const onKey = (event) => {
      if (event.key === "Escape") { event.stopPropagation(); finish(false); }
    };
    box.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey, true);
  });
}

function wireHeaderSwitches() {

  applyTheme(currentTheme());

  $("themeToggle").addEventListener("click", () => {
    const next = currentTheme() === "light" ? "dark" : "light";
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    applyTheme(next);
  });

  $("mailToggle").addEventListener("click", async () => {
    const button = $("mailToggle");
    if (button.disabled || !STATE.settings || !STATE.settings.canToggleMails) return;
    const turnOn = !STATE.settings.mailsEnabled;
    const site = STATE.settings.scope === "site";
    const ok = await askConfirm(site
      ? (turnOn
        ? { title: "Turn emails ON?",
            lines: ["Notification emails will go out again across the whole site - Admin Panel updates and students' / tutors' own actions."] }
        : { title: "Turn ALL emails OFF?",
            lines: ["No notification email will go out from anywhere on the site - not for any employee's updates in the Admin Panel, and not for anything students or tutors do.",
                    "Only login codes (OTP) still go out. Employees' own switches stay as they are."] })
      : turnOn
      ? { title: "Turn emails ON?",
          lines: ["The updates you make in the Admin Panel will email students and tutors again."] }
      : { title: "Turn emails OFF?",
          lines: ["The updates YOU make in the Admin Panel will NOT email students or tutors until you turn this back on.",
                  "Other employees' updates, login codes and emails caused by students / tutors still go out."] });
    if (!ok) return;
    button.disabled = true;
    button.classList.add("is-loading");
    try {
      const result = await adminCall({ action: "adminSetMails", enabled: turnOn });
      if (result && result.success) {
        STATE.settings = Object.assign({}, STATE.settings, { mailsEnabled: !!result.mailsEnabled });
        toast(result.message || (turnOn ? "Emails are ON." : "Emails are OFF."));
      } else {
        toast((result && result.message) || "Unable to change the email setting.", true);
      }
    } catch (error) {
      if (error.message !== "not-admin") toast("Unable to connect to the server.", true);
    } finally {
      button.classList.remove("is-loading");
      renderMailToggle();
    }
  });

}

function applyActiveTab() {
  document.querySelectorAll(".admin-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === STATE.tab));
  ["tuitions", "tutors", "students", "payments", "subscriptions", "ledger", "employees", "graph"].forEach(n => {
    const sec = $("tab-" + n);
    if (sec) sec.classList.toggle("hidden", n !== STATE.tab);
  });
  if (STATE.tab === "students" && typeof fitStudentColumns === "function") requestAnimationFrame(fitStudentColumns);
}

async function loadOverview(quiet) {

  if (!quiet) showPage("loading");

  try {

    const result = await adminCall({ action: "adminGetOverview" });

    if (result && result.bootstrapNeeded) {
      showBootstrapStep();
      return false;
    }

    if (!result.success) {
      if (quiet) toast(result.message || "Unable to load data.", true);
      else showEmailStep(result.message || "Unable to load data.");
      return false;
    }

    STATE.data = {
      tutors: result.tutors || { headers: [], readOnly: [], rows: [] },
      students: result.students || { headers: [], readOnly: [], rows: [] },
      demos: result.demos || [],
      verificationValues: result.verificationValues || ["Verified", "Rejected", "Pending for Verification"]
    };
    STATE.me = result.me || null;
    STATE.settings = result.settings || null;
    STATE.payments = result.payments || [];
    STATE.subscriptions = result.subscriptions || [];
    STATE.employees = result.employees || [];
    STATE.permInfo = result.permissionInfo || null;
    STATE.directory = result.directory || { demos: [], students: [], tutors: [] };

    indexData();
    applyRoleUI();
    renderAll();
    showPage("panel");

    return true;

  } catch (error) {
    if (error.message === "not-admin") return false;
    console.error(error);
    if (quiet) toast("Unable to connect to the server.", true);
    else showEmailStep("Unable to connect to the server. Please try again.");
    return false;
  }

}

// Saves, then reloads everything so every card shows what is saved.
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

  // The Class card starts collapsed and opens on tap like any other
  // card, but - unlike the others - also closes itself the moment you
  // click anywhere outside it, since it's easy to lose track of an open
  // one sitting above the Tuition card it belongs to.
  // (A click whose button was just redrawn - e.g. a calendar day - is no
  // longer on the page and doesn't count as outside; a card being edited
  // never closes this way, so its unsaved changes aren't lost.)
  document.addEventListener("click", (event) => {
    if (!event.target.isConnected || event.target.closest(".class-card")) return;
    let changed = false;
    STATE.open.forEach(k => {
      if (k.startsWith("class:") && !STATE.editing.has(k)) { STATE.open.delete(k); changed = true; }
    });
    if (changed) rerenderCurrent();
  });

  // Payment To (Student side) and Payment From (Tutor side) describe
  // the same money movement from two ends, so picking one sets the
  // other rather than leaving it to drift out of sync: Tutor collecting
  // straight from the parent, or the Agency handling both ends itself.
  document.addEventListener("change", (event) => {
    const to = event.target.closest('[data-cfield="Student Payment To"]');
    if (!to) return;
    const card = to.closest("[data-box]");
    const from = card && card.querySelector('[data-cfield="Tutor Payment From"]');
    if (!from) return;
    if (to.value === "Tutor") from.value = "Parents";
    else if (to.value === "Agency") from.value = "Agency";
  });

  $("emailStepForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    const email = $("adminEmail").value.trim().toLowerCase();

    if (!email) {
      $("emailMessage").textContent = "Enter your work email.";
      return;
    }

    const button = $("sendCodeButton");
    button.disabled = true;
    button.textContent = "Sending...";
    $("emailMessage").textContent = "";

    try {

      // The server decides whether this email may get a code, and always
      // answers the same way, so this page can't be used to find out which
      // emails belong to office staff.
      const sent = await requestLoginCode(email);

      if (!sent.ok) {
        $("emailMessage").textContent = sent.message;
        return;
      }

      pendingEmail = email;
      showOtpStep(email);
      startResendTimer(60);

    } catch (error) {
      console.error(error);
      $("emailMessage").textContent = "Unable to connect to the server. Please try again.";
    } finally {
      button.disabled = false;
      button.textContent = "Send code";
    }

  });

  wireOtpBoxes();

  // no Verify button - the sixth digit does it; Enter just does nothing
  $("otpStepForm").addEventListener("submit", (event) => event.preventDefault());

  $("otpBackButton").addEventListener("click", () => {
    clearInterval(resendTimer);
    showEmailStep();
  });

  $("resendCodeButton").addEventListener("click", async () => {
    const button = $("resendCodeButton");
    button.disabled = true;
    try {
      const sent = await requestLoginCode(pendingEmail);
      if (!sent.ok) $("otpMessage").textContent = sent.message;
      else { startResendTimer(60); toast("Code resent."); }
    } catch (error) {
      $("otpMessage").textContent = "Unable to connect to the server.";
    }
  });

  $("bootstrapStepForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    const fullName = $("bootstrapName").value.trim();

    if (!fullName) {
      $("bootstrapMessage").textContent = "Enter your name.";
      return;
    }

    const button = $("bootstrapButton");
    button.disabled = true;
    button.textContent = "Creating...";
    $("bootstrapMessage").textContent = "";

    try {

      const result = await adminCall({ action: "adminBootstrapSuperAdmin", fullName });

      if (!result.success) {
        $("bootstrapMessage").textContent = result.message || "Unable to create the account.";
        return;
      }

      toast(result.message || "Account created.");
      await loadOverview();

    } catch (error) {
      if (error.message !== "not-admin") $("bootstrapMessage").textContent = "Unable to connect to the server.";
    } finally {
      button.disabled = false;
      button.textContent = "Create Super Admin account";
    }

  });

  $("logoutButton").addEventListener("click", async () => {
    await forceLogout();
  });

  wireHeaderSwitches();

  $("refreshButton").addEventListener("click", async () => {
    const button = $("refreshButton");
    if (button.classList.contains("is-loading")) return;
    button.classList.add("is-loading");
    button.disabled = true;
    try {
      if (await loadOverview(true)) toast("Updated.");
    } finally {
      button.classList.remove("is-loading");
      button.disabled = false;
    }
  });

  $("mainTabs").addEventListener("click", (event) => {
    const tab = event.target.closest(".admin-tab");
    if (!tab) return;
    resetFilter(tab.dataset.tab);
    showTab(tab.dataset.tab);
  });

  chipGroup("tutorFilter", v => { collapseAll(); STATE.tutorFilter = v; renderTutors(); });
  chipGroup("tuitionFilter", v => { collapseAll(); STATE.tuitionFilter = v; renderTuitions(); });
  chipGroup("ledgerFilter", v => { STATE.ledgerFilter = v; renderLedger(); });
  chipGroup("graphFilter", v => { STATE.graphFilter = v; renderGraph(); });
  chipGroup("graphPeriod", v => { STATE.graphPeriod = v; renderGraph(); });

  // The 8 count tiles work as shortcuts to their filter.
  $("adminStats").addEventListener("click", (event) => {
    const tile = event.target.closest("[data-go]");
    if (tile) goToFilter(tile.dataset.go, tile.dataset.filter);
  });

  $("tutorSearch").addEventListener("input", renderTutors);
  $("tuitionSearch").addEventListener("input", renderTuitions);
  $("studentSearch").addEventListener("input", renderStudents);
  $("paymentSearch").addEventListener("input", renderPayments);
  $("subscriptionSearch").addEventListener("input", renderSubscriptions);
  $("ledgerSearch").addEventListener("input", renderLedger);

  wireChipSearch("tutorSearch", renderTutors);
  wireChipSearch("tuitionSearch", renderTuitions);
  wireChipSearch("studentSearch", renderStudents);
  wireChipSearch("paymentSearch", renderPayments);
  wireChipSearch("subscriptionSearch", renderSubscriptions);
  wireChipSearch("ledgerSearch", renderLedger);

  ["tuitionList", "tutorList", "studentList", "paymentList", "employeeList", "subscriptionList", "ledgerList"].forEach(id =>
    $(id).addEventListener("click", onListClick)
  );

  $("tuitionList").addEventListener("input", onAssignInput);

  document.addEventListener("click", collapseOnOutsideClick, true);

  wirePaymentForm();
  wireIdleForms();
  wirePaymentIdSuggestions();
  wirePaymentLookups();
  wireSubscriptionForm();
  wireSubscriptionIdSuggestion();
  watchSuggestionLists();
  wirePickList("paymentTransactionType");
  wirePickList("subscriptionPartyType");
  wireEmployeeForm();

  wireStudentForms();

}

// Fields that only appear for a Student/Tutor Subscription payment.
const PAYMENT_SUB_ONLY_FIELD_IDS = [
  "paymentSubPlanField", "paymentSubCycleField", "paymentSubStatusField",
  "paymentSubStartDateField", "paymentSubNextDueField"
];

// ID/Mobile/Name for the one party a Subscription or Agency Charge
// payment is against - whichever side is actually paying, never both
// at once.
const PAYMENT_PARTY_FIELD_IDS = ["paymentSubIdField", "paymentSubMobileField", "paymentSubNameField"];

// The Amount/Dues/Paying Now/Remaining group is shared by both a
// Subscription payment and an Agency Charge payment - anywhere the
// admin is clearing a Dues figure by typing in how much is being paid
// now.
const PAYMENT_AMOUNT_FIELD_IDS = [
  "paymentSubAmountField", "paymentSubDuesField", "paymentPayingNowField", "paymentRemainingField"
];

// Every transaction type is laid out in rows of 3 (see PAYMENT_LAYOUT).
// Rather than a second copy of these fields (ids must be unique), the
// same DOM nodes are physically relocated into the row containers for
// the picked mode, after first going back to their original spot.
//
// Listed in true original document order, since restoring depends on
// each field's original *next sibling* still being a valid anchor -
// walking that chain back-to-front (see layoutGroupedFields)
// guarantees every field lands back exactly where it started, even
// though the fields it's chained to may themselves still be mid-move.
const AGENCY_LAYOUT_DOC_ORDER = [
  "paymentTransactionTypeField",
  "paymentSubNameField", "paymentSubMobileField", "paymentSubIdField",
  "paymentSubPlanField", "paymentSubCycleField", "paymentSubStatusField",
  "paymentSubStartDateField", "paymentSubNextDueField",
  "paymentDemoIdField", "paymentTutorIdField",
  "paymentDateField", "paymentModeField",
  "paymentSubAmountField", "paymentSubDuesField", "paymentPayingNowField", "paymentRemainingField",
  "paymentNotesField"
];

const ROW_TOP = ["agencySlotTop", ["paymentTransactionTypeField", "paymentModeField", "paymentDateField"]];
const ROW_DEMO = ["agencySlotDemo", ["paymentDemoIdField", "paymentStudentMobileField", "paymentStudentNameField"]];
const ROW_STUDENT = ["slotStudent", ["paymentStuIdField", "paymentStuWhatsappField", "paymentParentNameField"]];
const ROW_TUTOR = ["slotTutor", ["paymentTutorIdField", "paymentTutorMobileField", "paymentTutorNameField"]];
const ROW_PARTY = ["agencySlotParty", ["paymentSubIdField", "paymentSubMobileField", "paymentSubNameField"]];
const ROW_AMOUNT = ["agencySlotAmount", ["paymentSubAmountField", "paymentSubDuesField", "paymentPayingNowField"]];
// Remaining always sits in the last column, right under Paying Now.
const ROW_NOTES = ["agencySlotNotes", ["paymentNotesField", "paymentNextDateField", "paymentRemainingField"]];
const ROW_SUB_PLAN = ["slotSubPlan", ["paymentSubPlanField", "paymentSubCycleField", "paymentSubStatusField"]];
const ROW_SUB_DATES = ["slotSubDates", ["paymentSubStartDateField", "paymentSubNextDueField", "paymentRemainingField"]];
const ROW_SUB_NOTES = ["slotSubNotes", ["paymentNotesField"]];

// Rows per transaction type, top to bottom: [row container, its fields].
const SUBSCRIPTION_ROWS = [ROW_TOP, ROW_PARTY, ROW_SUB_PLAN, ROW_AMOUNT, ROW_SUB_DATES, ROW_SUB_NOTES];
const AGENCY_ROWS = [ROW_TOP, ROW_DEMO, ROW_PARTY, ROW_AMOUNT, ROW_NOTES];
const PAYMENT_LAYOUT = {
  "student-subscription": SUBSCRIPTION_ROWS,
  "tutor-subscription": SUBSCRIPTION_ROWS,
  "student-agency-charge": AGENCY_ROWS,
  "tutor-agency-charge": AGENCY_ROWS,
  "collection": [ROW_TOP, ROW_DEMO, ROW_STUDENT, ROW_TUTOR, ROW_AMOUNT, ROW_NOTES],
  "payout": [ROW_TOP, ROW_TUTOR, ROW_DEMO, ROW_STUDENT, ROW_AMOUNT, ROW_NOTES]
};
const PAYMENT_ROW_IDS = [ROW_TOP, ROW_DEMO, ROW_STUDENT, ROW_TUTOR, ROW_PARTY, ROW_AMOUNT, ROW_NOTES, ROW_SUB_PLAN, ROW_SUB_DATES, ROW_SUB_NOTES]
  .map(([id]) => id);

/* =====================================================================
   NEW PAYMENT / NEW SUBSCRIPTION FORMS
   Everything that fills in, validates and submits the two forms:
   amounts, dues, next payment date, and the live ID suggestion lists.
   ===================================================================== */

// The types that end in Notes | Remaining | Next Payment Date.
function usesNextPaymentDate(mode) {
  return (PAYMENT_LAYOUT[mode] || []).includes(ROW_NOTES);
}

let agencyLayoutOriginalPos = null;

function layoutGroupedFields(mode) {

  if (!agencyLayoutOriginalPos) {
    agencyLayoutOriginalPos = new Map();
    AGENCY_LAYOUT_DOC_ORDER.forEach(id => {
      const el = $(id);
      agencyLayoutOriginalPos.set(id, { parent: el.parentNode, next: el.nextSibling });
    });
  }

  // Everything back to where it started first (reverse document order:
  // each field is reinserted right before its own original next-sibling,
  // so one chained to a later field still lands right once that later
  // field's own restore has run), then into this mode's rows.
  [...AGENCY_LAYOUT_DOC_ORDER].reverse().forEach(id => {
    const pos = agencyLayoutOriginalPos.get(id);
    pos.parent.insertBefore($(id), pos.next);
  });

  const rows = PAYMENT_LAYOUT[mode] || [];
  rows.forEach(([slotId, fieldIds]) => fieldIds.forEach(id => $(slotId).appendChild($(id))));

  const shown = rows.map(([id]) => id);
  PAYMENT_ROW_IDS.forEach(id => $(id).classList.toggle("hidden", !shown.includes(id)));
  shown.slice(1).reduce((prev, id) => { prev.after($(id)); return $(id); }, $(shown[0] || PAYMENT_ROW_IDS[0]));

}

// Shows/hides the fields for whichever transaction kind is picked:
// Student/Tutor Subscription, Student/Tutor Agency Charge, Collection
// (from a parent) or Payout (agency paying a tutor out of what it
// collected).
function applyPaymentTransactionType() {

  const mode = $("paymentTransactionType").value;
  const isPayout = mode === "payout";
  const isSub = mode === "student-subscription" || mode === "tutor-subscription";
  const isAgencyCharge = mode === "student-agency-charge" || mode === "tutor-agency-charge";
  const isCollection = mode === "collection";
  // Collection and Payout are laid out like an Agency Charge: fixed rows,
  // with Amount/Dues/Paying Now/Remaining worked out from the Tuition.
  const isGrouped = isAgencyCharge || isCollection || isPayout;

  layoutGroupedFields(mode);

  ["paymentTypeField", "collectedByField", "ourCutField", "paymentAmountField"]
    .forEach(id => $(id).classList.add("hidden"));

  // A Subscription payment is always against one single party (see
  // PAYMENT_PARTY_FIELD_IDS below), never a Demo ID/Tutor ID pair.
  $("paymentDemoIdField").classList.toggle("hidden", isSub);
  $("paymentTutorIdField").classList.toggle("hidden", isSub || isAgencyCharge);
  // The tutor on a Collection is whoever is taking that Tuition - filled
  // in from the Demo ID, not typed.
  $("paymentTutorId").readOnly = isCollection;

  // Received By is still sent (it's pre-filled with the admin's name),
  // just no longer shown.
  $("paymentReceivedByField").classList.add("hidden");
  PAYMENT_SUB_ONLY_FIELD_IDS.forEach(id => $(id).classList.toggle("hidden", !isSub));
  PAYMENT_PARTY_FIELD_IDS.forEach(id => $(id).classList.toggle("hidden", !isSub && !isAgencyCharge));
  PAYMENT_AMOUNT_FIELD_IDS.forEach(id => $(id).classList.toggle("hidden", !isSub && !isGrouped));
  // For a Subscription the Student/Tutor ID is typed straight in (with
  // suggestions); for an Agency Charge it's filled in from the Demo ID.
  setPaymentLookupEditable();

  if (isSub) {
    $("paymentSubIdLabel").textContent = mode === "student-subscription" ? "Student ID" : "Tutor ID";
  } else if (isAgencyCharge) {
    $("paymentSubIdLabel").textContent = mode === "student-agency-charge" ? "Student ID" : "Tutor ID";
  }
  // A Student Agency Charge is paid by the parent, so that row names them.
  $("paymentSubNameLabel").textContent = mode === "student-agency-charge" ? "Parent Name" : "Name";
  updateNextPaymentDate();

}

function clearPaymentSubFields() {
  ["paymentSubName", "paymentSubMobile", "paymentSubId", "paymentSubPlan", "paymentSubAmount",
   "paymentSubDues", "paymentPayingNow", "paymentRemaining", "paymentSubCycle", "paymentSubStatus",
   "paymentSubStartDate", "paymentSubNextDue", "paymentStudentMobile", "paymentStudentName",
   "paymentNextDate", "paymentStuId", "paymentStuWhatsapp", "paymentParentName",
   "paymentTutorMobile", "paymentTutorName"].forEach(id => { $(id).value = ""; });
}

function updatePaymentRemaining() {
  const dues = Number(String($("paymentSubDues").value).replace(/[^\d.-]/g, "")) || 0;
  let payingNow = Number($("paymentPayingNow").value) || 0;
  if (payingNow > dues && $("paymentType").value !== "advance") {
    payingNow = dues;
    $("paymentPayingNow").value = dues;
  }
  $("paymentRemaining").value = "₹" + Math.max(dues - payingNow, 0).toLocaleString("en-IN");
  $("paymentSubNextDueField").classList.toggle("needs-reminder", dues - payingNow > 0);
  updateNextPaymentDate();
}

// A grouped-layout payment (Agency Charge, Collection, Payout) that
// doesn't clear the dues highlights Next Payment Date (always shown,
// left blank) as a nudge to set a follow-up.
function agencyChargeLeftAfterPayment() {
  if (!usesNextPaymentDate($("paymentTransactionType").value)) return 0;
  const dues = Number(String($("paymentSubDues").value).replace(/[^\d.-]/g, "")) || 0;
  return Math.max(dues - (Number($("paymentPayingNow").value) || 0), 0);
}

function updateNextPaymentDate() {
  $("paymentNextDateField").classList.toggle("needs-reminder", agencyChargeLeftAfterPayment() > 0);
}

// The subscription's current billing cycle "starts" from whichever
// payment first landed within the trailing 12 months - so a payment
// today with nothing paid in the last year begins a fresh cycle
// (today), while one still inside last year's cycle keeps that
// cycle's own first-payment date.
function subscriptionCycleStartDate(sub) {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = oneYearBefore(today);
  const paidDates = (STATE.payments || [])
    .filter(p => p.subscription_id === sub.id && p.transaction_type !== "payout" && p.payment_date >= cutoff)
    .map(p => p.payment_date)
    .sort();
  return paidDates.length ? paidDates[0] : today;
}

function oneYearBefore(dateText) {
  const d = new Date(dateText || Date.now());
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

// Fills the whole subscription block from a resolved student/tutor -
// used both by the search-and-pick flow and by "Record a Payment for
// this Subscription". Returns false (and toasts) if they somehow have
// no subscription yet.
function fillPaymentSubscriptionFields(partyType, partyId) {

  const sub = subscriptionFor(partyType, partyId);

  if (!sub) {
    toast(`No subscription found for ${partyId}.`, true);
    return false;
  }

  const dir = partyType === "student" ? DIR_STUDENT_BY_ID : DIR_TUTOR_BY_ID;
  const party = dir[partyId] || null;

  const amount = Number(sub.amount || 0);
  const paid = subscriptionPaidAmount(sub.id);
  const dues = Math.max(amount - paid, 0);
  const cycleStart = subscriptionCycleStartDate(sub);

  $("paymentSubscriptionId").value = sub.id;
  $("paymentSubName").value = (party && party.name) || partyId;
  $("paymentSubMobile").value = (party && party.mobile) || "";
  $("paymentSubId").value = partyId;
  $("paymentSubPlan").value = sub.plan_name || "";
  $("paymentSubAmount").value = "₹" + amount.toLocaleString("en-IN");
  $("paymentSubDues").value = "₹" + dues.toLocaleString("en-IN");
  $("paymentPayingNow").max = dues || amount;
  $("paymentPayingNow").value = dues || amount;
  $("paymentSubCycle").value = sub.billing_cycle || "";
  $("paymentSubStatus").value = SUBSCRIPTION_STATUS_LABELS[sub.status] || sub.status;
  $("paymentSubStartDate").value = cycleStart;
  $("paymentSubNextDue").value = subscriptionNextDue(sub);
  $("paymentSubNextDueField").classList.toggle("needs-reminder", dues > 0);
  updatePaymentRemaining();

  return true;

}

function paymentModeValue() {
  const checked = document.querySelector('input[name="paymentModeChoice"]:checked');
  return checked ? checked.value : "Online";
}

function resetPaymentForm() {
  $("paymentDemoId").value = "";
  $("paymentSubscriptionId").value = "";
  $("paymentForSubscription").classList.add("hidden");
  $("paymentDemoIdField").classList.remove("hidden");
  $("paymentTransactionType").value = "collection";
  $("paymentAmount").value = "";
  $("paymentDate").value = new Date().toISOString().slice(0, 10);
  $("paymentType").value = "regular";
  $("paymentCollectedBy").value = "agency";
  $("paymentModeOnline").checked = true;
  $("paymentOurCut").value = "";
  $("paymentTutorId").value = "";
  $("paymentReceivedBy").value = (STATE.me && STATE.me.fullName) || "";
  $("paymentNotes").value = "";
  clearPaymentSubFields();
  updateIdDetail($("paymentDemoDetail"), null);
  updateIdDetail($("paymentTutorDetail"), null);
  hidePaymentSuggestions();
  applyPaymentTransactionType();
}

// Opens the payment form pre-filled for one subscription's renewal.
function openPaymentFormForSubscription(sub) {
  if (STATE.tab !== "payments") showTab("payments");
  resetPaymentForm();
  $("paymentTransactionType").value = sub.student_id ? "student-subscription" : "tutor-subscription";
  $("paymentForSubscription").classList.remove("hidden");
  $("paymentForSubscription").textContent = `For subscription: ${sub.plan_name} (₹${Number(sub.amount).toLocaleString("en-IN")} / ${sub.billing_cycle})`;
  applyPaymentTransactionType();
  fillPaymentSubscriptionFields(sub.student_id ? "student" : "tutor", sub.student_id || sub.tutor_id);

  $("paymentForm").classList.remove("hidden");
  $("paymentForm").scrollIntoView({ behavior: "smooth", block: "center" });
}

// Fills the one party's ID/Mobile/Name (Student for a Student Agency
// Charge, Tutor for a Tutor Agency Charge) and the shared Amount/Dues/
// Paying Now group from the typed Demo ID's own Tuition - same numbers
// as its Class card. Tutor ID still gets set (hidden) since the payload
// needs it.
function refreshAgencyChargeFromDemo() {
  const mode = $("paymentTransactionType").value;
  if (mode === "collection" || mode === "payout") return refreshTuitionPaymentFields(mode);
  if (mode !== "student-agency-charge" && mode !== "tutor-agency-charge") return;
  const g = demoGroups().find(x => x.demoId === $("paymentDemoId").value.trim());
  const activeRow = g ? activeRowFor(g) : null;
  if (!activeRow) {
    clearPaymentSubFields();
    $("paymentTutorId").value = "";
    return;
  }
  fillPaymentAgencyChargeFields(g, activeRow, mode === "tutor-agency-charge" ? "tutor" : "student");
}

// Collection (from the parent) or Payout (to the tutor) against one
// Tuition: the Student's and Tutor's own rows filled from the Demo ID
// (Collection) or Tutor ID + Demo ID (Payout - a tutor teaching just one
// Tuition gets its Demo ID filled in too), and Amount/Dues/Paying Now
// from that Tuition's own fee, same numbers as its Class card.
function refreshTuitionPaymentFields(mode) {

  const isPayout = mode === "payout";
  let demoId = $("paymentDemoId").value.trim();
  const typedTutor = $("paymentTutorId").value.trim();

  if (isPayout && !demoId && DIR_TUTOR_BY_ID[typedTutor]) {
    const own = demoGroups().filter(x => { const r = activeRowFor(x); return r && r.tutorId === typedTutor; });
    if (own.length === 1) {
      demoId = own[0].demoId;
      $("paymentDemoId").value = demoId;
      updateIdDetail($("paymentDemoDetail"), DIR_STUDENT_BY_ID[own[0].first.studentId] || null);
    }
  }

  const g = demoGroups().find(x => x.demoId === demoId);
  const activeRow = g ? activeRowFor(g) : null;
  if (!isPayout && activeRow) $("paymentTutorId").value = activeRow.tutorId;
  if (!isPayout && !activeRow) $("paymentTutorId").value = "";
  const tutorId = $("paymentTutorId").value.trim();

  const student = g ? (DIR_STUDENT_BY_ID[g.first.studentId] || null) : null;
  const tutor = DIR_TUTOR_BY_ID[tutorId] || null;
  $("paymentStudentMobile").value = (student && student.mobile) || "";
  $("paymentStudentName").value = (student && student.name) || "";
  $("paymentStuId").value = g ? g.first.studentId : "";
  $("paymentStuWhatsapp").value = (student && (student.whatsapp || student.mobile)) || "";
  $("paymentParentName").value = (student && student.parentsName) || "";
  $("paymentTutorMobile").value = (tutor && tutor.mobile) || "";
  $("paymentTutorName").value = (tutor && tutor.name) || "";

  // Money only once the Tuition and (for a Payout) the tutor taking it line up.
  const matches = activeRow && (!isPayout || activeRow.tutorId === tutorId);
  if (!matches) {
    ["paymentSubAmount", "paymentSubDues", "paymentPayingNow", "paymentRemaining"].forEach(id => { $(id).value = ""; });
    updateNextPaymentDate();
    return;
  }
  const m = classMoney(g, activeRow);
  const total = isPayout ? m.tutorTotalAmount : m.studentTotalAmount;
  const dues = isPayout ? m.tutorDues : m.studentDues;
  $("paymentSubAmount").value = "₹" + total.toLocaleString("en-IN");
  $("paymentSubDues").value = "₹" + dues.toLocaleString("en-IN");
  $("paymentPayingNow").max = dues;
  $("paymentPayingNow").value = dues;
  updatePaymentRemaining();

}

function fillPaymentAgencyChargeFields(g, activeRow, side) {

  const m = classMoney(g, activeRow);
  const charge = side === "tutor" ? m.tutorAgencyCharge : m.studentAgencyCharge;
  const dues = side === "tutor" ? m.tutorAgencyDue : m.studentAgencyDue;
  const party = side === "tutor" ? (DIR_TUTOR_BY_ID[activeRow.tutorId] || null) : (DIR_STUDENT_BY_ID[g.first.studentId] || null);

  $("paymentTutorId").value = activeRow.tutorId;

  const studentDir = DIR_STUDENT_BY_ID[g.first.studentId] || null;
  $("paymentStudentMobile").value = (studentDir && studentDir.mobile) || "";
  $("paymentStudentName").value = (studentDir && studentDir.name) || "";

  $("paymentSubId").value = side === "tutor" ? activeRow.tutorId : g.first.studentId;
  $("paymentSubMobile").value = (party && party.mobile) || "";
  $("paymentSubName").value = side === "tutor"
    ? ((party && party.name) || "")
    : ((studentDir && studentDir.parentsName) || "");

  $("paymentSubAmount").value = "₹" + charge.toLocaleString("en-IN");
  $("paymentSubDues").value = "₹" + dues.toLocaleString("en-IN");
  $("paymentPayingNow").max = dues;
  $("paymentPayingNow").value = dues;
  updatePaymentRemaining();

}

// Tapping a Class card figure: the Payments form opened on the matching
// transaction type - Agency Charge (Student/Tutor), Collection (Parent)
// for the Student's Total Amount/Payment, Payout (Tutor) for the
// Tutor's - each with its Tuition's details filled in. with this Tuition's Demo/Tutor ID
// (and, for a plain Collection/Payout, its dues as the amount) filled in.
function openPaymentFormForClass(kind, g, activeRow) {

  const m = classMoney(g, activeRow);
  const dues = {
    "student-agency": m.studentAgencyDue, "tutor-agency": m.tutorAgencyDue,
    "student-payment": m.studentDues, "tutor-payment": m.tutorDues
  }[kind];
  // Advance can be recorded even with nothing due; everything else
  // only while dues remain.
  const isAdvance = kind === "student-advance" || kind === "tutor-advance";
  if (!isAdvance && !(dues > 0)) {
    toast("No dues left for this.");
    return;
  }
  const types = {
    "student-agency": "student-agency-charge", "tutor-agency": "tutor-agency-charge",
    "student-payment": "collection", "tutor-payment": "payout",
    "student-advance": "collection", "tutor-advance": "payout"
  };

  showTab("payments");
  resetPaymentForm();
  $("paymentTransactionType").value = types[kind];
  applyPaymentTransactionType();

  if (kind === "tutor-payment" || kind === "tutor-advance") $("paymentTutorId").value = activeRow.tutorId;
  $("paymentDemoId").value = g.demoId;
  $("paymentDemoId").dispatchEvent(new Event("input", { bubbles: true }));
  if (isAdvance) {
    $("paymentType").value = "advance";
    $("paymentPayingNow").value = "";
    updatePaymentRemaining();
  }
  updateIdDetail($("paymentTutorDetail"), DIR_TUTOR_BY_ID[activeRow.tutorId] || null);
  document.querySelectorAll("#paymentForm .admin-suggest").forEach(el => el.classList.add("hidden"));

  $("paymentForm").classList.remove("hidden");
  $("paymentForm").scrollIntoView({ behavior: "smooth", block: "center" });

}

/* ---- "+ Record a Payment" / "+ Create a Subscription" left untouched ----
   If the form is opened but nothing is typed or changed in it, going to
   another section or clicking anywhere outside it simply closes it again.
   (Once something has been typed it stays open until Save / Cancel.)
   While the New Subscription form is open, the list below it is hidden. */

function closeIdleForms() {
  ["paymentForm", "subscriptionForm"].forEach(id => {
    const form = $(id);
    const st = (STATE.idleForms || {})[id];
    if (form && !form.classList.contains("hidden") && st && !st.dirty) form.classList.add("hidden");
  });
}

function wireIdleForms() {

  // (kept on STATE: init runs this before the rest of the file has loaded)
  STATE.idleForms = {};   // form id -> { openedAt, dirty, isOpen }
  const idleForms = STATE.idleForms;

  ["paymentForm", "subscriptionForm", "employeeForm"].forEach(id => {
    const form = $(id);
    idleForms[id] = { openedAt: 0, dirty: false };

    // a person typing / picking something makes it "in use"
    const touch = (event) => { if (event.isTrusted) idleForms[id].dirty = true; };
    form.addEventListener("input", touch);
    form.addEventListener("change", touch);

    // every way of opening or closing it goes through its "hidden" class
    new MutationObserver(() => {
      const open = !form.classList.contains("hidden");
      if (open && !idleForms[id].isOpen) idleForms[id] = { openedAt: performance.now(), dirty: false, isOpen: true };
      if (!open) idleForms[id].isOpen = false;
      if (id === "subscriptionForm") {
        $("subscriptionHeader").classList.toggle("hidden", open);
        $("subscriptionList").classList.toggle("hidden", open);
      }
    }).observe(form, { attributes: true, attributeFilter: ["class"] });
  });

  document.addEventListener("click", (event) => {
    ["paymentForm", "subscriptionForm", "employeeForm"].forEach(id => {
      const form = $(id);
      const st = idleForms[id];
      if (form.classList.contains("hidden") || st.dirty) return;
      // the same click that opened it (button, card figure...) doesn't count
      if (performance.now() - st.openedAt < 400) return;
      if (form.contains(event.target)) return;
      if (event.target.closest("#addPaymentButton, #addSubscriptionButton, #addEmployeeButton")) return;
      form.classList.add("hidden");
    });
  });

}

function wirePaymentForm() {

  $("addPaymentButton").addEventListener("click", () => {
    const form = $("paymentForm");
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) {
      resetPaymentForm();
      $("paymentDemoId").focus();
    }
  });

  $("cancelPaymentButton").addEventListener("click", () => $("paymentForm").classList.add("hidden"));

  $("paymentTransactionType").addEventListener("change", () => {
    $("paymentSubscriptionId").value = "";
    clearPaymentSubFields();
    $("paymentForSubscription").classList.add("hidden");
    applyPaymentTransactionType();
    refreshAgencyChargeFromDemo();
  });

  $("paymentPayingNow").addEventListener("input", updatePaymentRemaining);

  $("paymentForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    const mode = $("paymentTransactionType").value;
    const isPayout = mode === "payout";
    const isSub = mode === "student-subscription" || mode === "tutor-subscription";
    const isAgencyCharge = mode === "student-agency-charge" || mode === "tutor-agency-charge";
    const demoId = $("paymentDemoId").value.trim();
    const subscriptionId = $("paymentSubscriptionId").value;
    const tutorId = $("paymentTutorId").value.trim();

    if (isSub && !subscriptionId) {
      toast("Enter a Student/Tutor ID that has a subscription.", true);
      return;
    }

    if (isPayout && !tutorId) {
      toast("Enter which Tutor ID is being paid.", true);
      return;
    }

    if (isPayout && !demoId) {
      toast("Enter the Demo ID this payment is for.", true);
      return;
    }

    if (isAgencyCharge && !demoId) {
      toast("Enter the Demo ID.", true);
      return;
    }

    if (mode === "tutor-agency-charge" && !tutorId) {
      toast("Enter which Tutor ID this Agency Charge is against.", true);
      return;
    }

    if (!isPayout && !isSub && !isAgencyCharge && !demoId) {
      toast("Enter the Demo ID.", true);
      return;
    }

    const isGrouped = usesNextPaymentDate(mode);
    const usesPayingNow = isSub || isGrouped;
    const enteredAmount = Number(usesPayingNow ? $("paymentPayingNow").value : $("paymentAmount").value);
    if (!(enteredAmount > 0)) {
      toast(usesPayingNow ? "Enter the amount being paid now." : "Enter a valid amount.", true);
      return;
    }

    if (usesPayingNow) {
      const dues = Number(String($("paymentSubDues").value).replace(/[^\d.-]/g, "")) || 0;
      if (enteredAmount > dues && $("paymentType").value !== "advance") {
        toast(`Amount Paid can't be more than the Dues (₹${dues.toLocaleString("en-IN")}).`, true);
        return;
      }
    }

    const nextPaymentDate = isGrouped ? $("paymentNextDate").value : "";

    const payload = {
      action: "adminAddPayment",
      transactionType: isPayout ? "payout" : (isAgencyCharge ? "agency_charge" : "collection"),
      demoId: isSub ? undefined : demoId,
      subscriptionId: isSub ? subscriptionId : undefined,
      // A Student Agency Charge payment always has tutor_id null - it's
      // the student/parent paying, even though the Tutor ID field is
      // shown alongside it for context.
      tutorId: isSub ? undefined : (mode === "student-agency-charge" ? "" : tutorId),
      amount: usesPayingNow ? $("paymentPayingNow").value : $("paymentAmount").value,
      paymentType: isAgencyCharge ? "agency" : $("paymentType").value,
      collectedBy: $("paymentCollectedBy").value,
      ourCutAmount: $("paymentOurCut").value,
      paymentMode: paymentModeValue(),
      receivedBy: isSub ? $("paymentReceivedBy").value.trim() : undefined,
      paymentDate: $("paymentDate").value,
      nextPaymentDate: nextPaymentDate || undefined,
      notes: $("paymentNotes").value.trim()
    };

    const button = $("paymentForm").querySelector("button[type=submit]");
    const ok = await save(payload, button);

    if (ok) $("paymentForm").classList.add("hidden");

  });

}

// Subscriptions are always one of two fixed yearly plans - Student (₹500)
// or Tutor (₹1000) - though the amount can still be reduced or fully
// exempted for a particular case, so the field stays editable.
const SUBSCRIPTION_DEFAULTS = {
  student: { amount: 500, planName: "Student Yearly Subscription" },
  tutor: { amount: 1000, planName: "Tutor Yearly Subscription" }
};

function oneYearFrom(dateText) {
  const d = new Date(dateText || Date.now());
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function applySubscriptionDefaults() {
  const partyType = $("subscriptionPartyType").value;
  const defaults = SUBSCRIPTION_DEFAULTS[partyType] || SUBSCRIPTION_DEFAULTS.student;
  $("subscriptionPlanName").value = defaults.planName;
  $("subscriptionAmount").value = defaults.amount;
  $("subscriptionBillingCycle").value = "Yearly";
  $("subscriptionStartDate").value = new Date().toISOString().slice(0, 10);
  $("subscriptionNextDueDate").value = oneYearFrom($("subscriptionStartDate").value);
}

function wireSubscriptionForm() {

  $("subscriptionPartyType").addEventListener("change", () => {
    const isStudent = $("subscriptionPartyType").value === "student";
    $("subscriptionPartyIdLabel").textContent = isStudent ? "Student ID" : "Tutor ID";
    $("subscriptionPartyId").value = "";
    fillSubscriptionParty(null);
    document.querySelectorAll('#subscriptionForm .admin-suggest').forEach(el => el.classList.add("hidden"));
    applySubscriptionDefaults();
  });

  $("addSubscriptionButton").addEventListener("click", () => {
    const form = $("subscriptionForm");
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) {
      $("subscriptionPartyType").value = "student";
      $("subscriptionPartyIdLabel").textContent = "Student ID";
      $("subscriptionPartyId").value = "";
      $("subscriptionNotes").value = "";
      applySubscriptionDefaults();
      fillSubscriptionParty(null);
      document.querySelectorAll('#subscriptionForm .admin-suggest').forEach(el => el.classList.add("hidden"));
      $("subscriptionPartyId").focus();
    }
  });

  $("cancelSubscriptionButton").addEventListener("click", () => $("subscriptionForm").classList.add("hidden"));

  $("subscriptionForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    const partyType = $("subscriptionPartyType").value;
    const partyId = $("subscriptionPartyId").value.trim();

    if (!partyId) {
      toast(partyType === "student" ? "Enter the Student ID." : "Enter the Tutor ID.", true);
      return;
    }

    const existingSub = subscriptionFor(partyType, partyId);
    if (existingSub && existingSub.status !== "cancelled") {
      toast(`${partyId} already has a subscription. Record a payment against it instead of creating another.`, true);
      return;
    }

    const payload = {
      action: "adminAddSubscription",
      partyType,
      studentId: partyType === "student" ? partyId : undefined,
      tutorId: partyType === "tutor" ? partyId : undefined,
      planName: $("subscriptionPlanName").value.trim(),
      amount: $("subscriptionAmount").value,
      billingCycle: $("subscriptionBillingCycle").value.trim(),
      startDate: $("subscriptionStartDate").value,
      nextDueDate: $("subscriptionNextDueDate").value,
      notes: $("subscriptionNotes").value.trim()
    };

    const button = $("subscriptionForm").querySelector("button[type=submit]");
    const ok = await save(payload, button);

    if (ok) $("subscriptionForm").classList.add("hidden");

  });

}


/************************************************************
 * ADD A STUDENT  /  APPLY FOR NEW TUITION  (office does it for the student)
 *
 * Two pop-up forms with the very same look and choices as the Student
 * Profile page's "Add a Student" and "Apply For New Tuition" pop-ups
 * (style: css/student-forms.css). Add a Student also asks for the
 * parent / contact details the website's registration asks for, since
 * there is no student account to take them from. No OTP is needed - the
 * server ("adminAddStudent" / "adminAddTuition") saves it and emails the
 * student the usual "Tuition Request Posted" mail.
 ************************************************************/

function radioValue(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : "";
}

// The timing grid exactly like the Student Profile: 8 AM ... 9 PM + Other.
// "Other" switches the ready-made slots off and asks for the time in words.
function buildTimingGrid(prefix) {
  const TIMING_OPTIONS = ["8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM",
    "3 PM", "4 PM", "5 PM", "6 PM", "7 PM", "8 PM", "9 PM"];
  const grid = $(prefix + "Timings");
  grid.innerHTML = TIMING_OPTIONS.map(t =>
    `<label><input type="checkbox" name="${prefix}Timing" value="${t}"><span>${t}</span></label>`
  ).join("") + `<label><input type="checkbox" id="${prefix}TimingOther" value="Other"><span>Other</span></label>`;

  grid.addEventListener("change", (event) => {
    const box = event.target;
    if (box.id === prefix + "TimingOther") {
      if (box.checked) grid.querySelectorAll(`input[name="${prefix}Timing"]`).forEach(b => { b.checked = false; });
      $(prefix + "OtherTimingField").classList.toggle("hidden", !box.checked);
      if (box.checked) $(prefix + "OtherTiming").focus();
    } else if (box.checked) {
      $(prefix + "TimingOther").checked = false;
      $(prefix + "OtherTimingField").classList.add("hidden");
    }
  });
}

// what the website saves: "4 PM, 5 PM" - or the typed time when "Other" is on
function readTiming(prefix) {
  return $(prefix + "TimingOther").checked
    ? $(prefix + "OtherTiming").value.trim()
    : [...document.querySelectorAll(`input[name="${prefix}Timing"]:checked`)].map(i => i.value).join(", ");
}

function openFormModal(id) {
  const modal = $(id);
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("add-modal-open");
}

function closeFormModal(id) {
  const modal = $(id);
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  if (!document.querySelector(".add-modal:not(.hidden)")) document.body.classList.remove("add-modal-open");
}

// Add a Student: a student already on file with the same email, mobile
// number and parents' name - and then the same student name too - is the
// same child again (a brother / sister has a different name).
function duplicateStudent() {
  const norm = t => lower(String(t || "").trim().replace(/\s+/g, " "));
  const phone = taDigits($("saPhone").value).slice(-10);
  const email = norm($("saEmail").value);
  const parent = norm($("saParents").value);
  const name = norm($("saStudent").value);
  if (phone.length !== 10 || !email || !parent || !name) return null;
  return taStudentRows().find(r =>
    norm(taVal(r, "Email")) === email && taDigits(taVal(r, "Phone")).slice(-10) === phone &&
    norm(taVal(r, "Parents Name")) === parent && norm(taVal(r, "Student Name")) === name) || null;
}

function duplicateStudentText(row) {
  return `Already registered: ${row.id} has the same email, mobile number, parents' name and student name. Change the student's name if it's a different child.`;
}

// Red flag on Student Name and everything after it locked while it's a duplicate.
function showDuplicateStudent(row) {
  $("saStudentField").classList.toggle("is-dup", !!row);
  $("saStudentField").querySelector(".dup-flag").classList.toggle("hidden", !row);
  $("saDupNote").textContent = row ? duplicateStudentText(row) : "";
  $("saDupNote").classList.toggle("hidden", !row);
  const form = $("studentAddForm");
  const after = [...form.querySelectorAll("input, select, textarea, button")]
    .filter(el => !$("saStudentField").contains(el) &&
      ($("saStudentField").compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
  after.forEach(el => {
    if (row) { if (!el.disabled) { el.disabled = true; el.dataset.dupLocked = "1"; } }
    else if (el.dataset.dupLocked) { el.disabled = false; delete el.dataset.dupLocked; }
  });
  form.classList.toggle("is-dup-locked", !!row);
}

function resetFormModal(prefix, formId, messageId) {
  $(formId).reset();
  $(messageId).textContent = "";
  $(prefix + "OtherTimingField").classList.add("hidden");
}

// sends it to the server; a problem is shown under the form like on the website
async function submitForOffice(payload, button, messageEl, doneText) {

  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Saving...";
  messageEl.textContent = "";

  try {
    const result = await adminCall(payload);
    if (!result.success) {
      messageEl.textContent = result.message || "Unable to save.";
      return false;
    }
    await loadOverview(true);
    toast(doneText(result));
    return true;
  } catch (error) {
    if (error.message !== "not-admin") messageEl.textContent = "Unable to connect to the server.";
    return false;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }

}

function wireStudentForms() {

  buildTimingGrid("sa");
  buildTimingGrid("ta");

  // close: the ×, a tap outside the box, or Esc
  document.querySelectorAll(".add-modal [data-close-modal]").forEach(el =>
    el.addEventListener("click", () => closeFormModal(el.closest(".add-modal").id)));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".add-modal:not(.hidden)").forEach(m => closeFormModal(m.id));
  });

  // WhatsApp same as mobile (ticked) -> the WhatsApp box is not needed
  const syncWhatsapp = () => $("saWhatsappWrap").classList.toggle("hidden", $("saSameWhatsapp").checked);
  $("saSameWhatsapp").addEventListener("change", syncWhatsapp);

  // "Add a tuition requirement" (unticked) -> the tuition part stays closed
  const syncTuition = () => $("saTuitionBlock").classList.toggle("hidden", !$("saWantsTuition").checked);
  $("saWantsTuition").addEventListener("change", () => {
    syncTuition();
    if ($("saWantsTuition").checked) $("saSubjects").focus();
  });

  // numbers only in the mobile boxes
  ["saPhone", "saWhatsapp", "taMobile"].forEach(id =>
    $(id).addEventListener("input", () => { $(id).value = $(id).value.replace(/\D/g, "").slice(0, 10); }));

  /* ---- Add a Student ---- */

  $("addStudentButton").addEventListener("click", () => {
    resetFormModal("sa", "studentAddForm", "studentAddMessage");
    showDuplicateStudent(null);
    syncWhatsapp();
    syncTuition();
    openFormModal("studentAddModal");
    // the agency's email and the Terms tick come filled in (both can be changed)
    $("saPhone").focus();
  });

  // the same student again - flagged right away, the rest locked
  ["saEmail", "saPhone", "saParents", "saStudent"].forEach(id =>
    $(id).addEventListener("input", () => showDuplicateStudent(duplicateStudent())));

  $("studentAddForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    const v = id => $(id).value.trim();
    const phone = v("saPhone");
    const whatsapp = $("saSameWhatsapp").checked ? phone : v("saWhatsapp");
    const wantsTuition = $("saWantsTuition").checked;
    const subjects = wantsTuition ? v("saSubjects") : "";
    const timing = wantsTuition ? readTiming("sa") : "";

    // the same checks as the website's registration (tuition part optional)
    const problem =
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v("saEmail")) ? ["Enter a valid email address.", "saEmail"] :
      !/^\d{10}$/.test(phone) ? ["Enter a valid 10-digit mobile number.", "saPhone"] :
      !/^\d{10}$/.test(whatsapp) ? ["Enter a valid 10-digit WhatsApp number.", "saWhatsapp"] :
      v("saParents").length < 2 ? ["Please enter the parent's name.", "saParents"] :
      v("saStudent").length < 2 ? ["Please enter the student's name.", "saStudent"] :
      !radioValue("saGender") ? ["Select the student's gender.", ""] :
      !v("saClass") ? ["Please enter the class / course.", "saClass"] :
      v("saSchool").length < 2 ? ["Please enter the school / college.", "saSchool"] :
      !v("saBoard") ? ["Please enter the board / university.", "saBoard"] :
      v("saAddress").length < 3 ? ["Please enter the address.", "saAddress"] :
      v("saCity").length < 2 ? ["Please enter the city.", "saCity"] :
      !/^\d{6}$/.test(v("saPin")) ? ["Enter a valid 6-digit PIN code.", "saPin"] :
      (wantsTuition && subjects.length < 2) ? ["Enter at least one subject.", "saSubjects"] :
      (wantsTuition && !timing) ? [$("saTimingOther").checked ? "Enter the preferred time." : "Select at least one preferred timing.", $("saTimingOther").checked ? "saOtherTiming" : ""] :
      null;

    if (problem) {
      $("studentAddMessage").textContent = problem[0];
      if (problem[1]) $(problem[1]).focus();
      return;
    }

    const dup = duplicateStudent();
    if (dup) {
      showDuplicateStudent(dup);
      $("saStudent").focus();
      return;
    }

    const payload = {
      action: "adminAddStudent",
      p: {
        email: v("saEmail"), phone, whatsapp,
        parentsName: v("saParents"), studentName: v("saStudent"), gender: radioValue("saGender"),
        className: v("saClass"), school: v("saSchool"), board: v("saBoard"),
        address: v("saAddress"), city: v("saCity"), pinCode: v("saPin"),
        subjects,
        preferredTutor: wantsTuition ? (radioValue("saTutor") || "Any") : "Any",
        medium: wantsTuition ? (radioValue("saMedium") || "Any") : "Any",
        preferredTiming: subjects ? timing : "",
        termsAccepted: $("saTerms").checked
      }
    };

    const ok = await submitForOffice(payload, $("studentAddSubmit"), $("studentAddMessage"), result =>
      `Student ${result.studentId} added` + (result.demoIds && result.demoIds.length ? ` with tuition request ${result.demoIds.join(", ")}.` : "."));

    if (ok) closeFormModal("studentAddModal");

  });

  /* ---- Apply For New Tuition ---- */

  $("applyTuitionButton").addEventListener("click", () => {

    resetFormModal("ta", "tuitionApplyForm", "tuitionApplyMessage");
    taResetFinder();

    openFormModal("tuitionApplyModal");
    $("taMobile").focus();

  });

  $("tuitionApplyForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    // the student picked from the suggestions (or an exact Student ID typed in)
    const pick = taPicked || taStudentRows().find(r => lower(r.id) === lower($("taStudentId").value));

    const subjects = $("taSubjects").value.trim();
    const timing = readTiming("ta");

    // the same checks as the Student Profile's "Apply For New Tuition"
    const problem =
      !pick ? (taNumberIds
        ? ["More than one student uses this number - pick the Student ID or Name.", "taStudentId"]
        : ["Find the student by mobile number, Student ID or name, and pick one from the suggestions.", "taMobile"]) :
      subjects.length < 2 ? ["Enter at least one subject.", "taSubjects"] :
      !timing ? [$("taTimingOther").checked ? "Enter the preferred time." : "Select at least one preferred timing.", $("taTimingOther").checked ? "taOtherTiming" : ""] :
      null;

    if (problem) {
      $("tuitionApplyMessage").textContent = problem[0];
      if (problem[1]) $(problem[1]).focus();
      return;
    }

    const payload = {
      action: "adminAddTuition",
      p: {
        studentId: pick.id, subjects,
        preferredTutor: radioValue("taTutor") || "Any", medium: radioValue("taMedium") || "Any",
        preferredTiming: timing
      }
    };

    const ok = await submitForOffice(payload, $("tuitionApplySubmit"), $("tuitionApplyMessage"), result =>
      `Tuition request ${(result.demoIds || []).join(", ")} posted for ${pick.id}.`);

    if (ok) closeFormModal("tuitionApplyModal");

  });

  wireTuitionStudentFinder();

}

/* ---- Apply For New Tuition: find the student ----
   Three boxes on one line - Mobile Number, Student ID, Student Name.
   - Nothing is suggested on a plain click: suggestions start once some
     of it is typed (3+ digits for a number, 2+ letters for ID / name).
   - Each box suggests only its own thing: numbers (mobile or WhatsApp),
     Student IDs, or student names.
   - Picking a student fills all three. Picking a number that more than
     one student uses keeps the number and asks to pick which student
     (by Student ID or Name) from just those students.
   - Typing in a box again after a pick starts that search afresh. */

// (var / function, not let / const: init wires the forms before this part of the file has run)
var taPicked = null;        // the chosen student row
var taNumberIds = null;     // after picking a shared number: the IDs of the students using it

/* One suggestion row (every suggestion list in the panel looks the same):
   search icon | bold title + grey detail line ("a › b › c") | tag pill. */
const SUGGEST_ICON = `<svg class="sg-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;
function idTag(id) {
  const p = String(id || "").slice(0, 3).toUpperCase();
  return p === "SID" ? "Student" : p === "TID" ? "Tutor" : p === "DID" ? "Demo" : "";
}
function suggestItem({ title, sub = "", tag = "", attrs = "", disabled = false, note = "", icon = SUGGEST_ICON }) {
  const subText = (Array.isArray(sub) ? sub.filter(Boolean).join(" › ") : sub) || "";
  return `
    <button type="button" class="admin-suggest-item" ${attrs}${disabled ? " disabled" : ""}>
      ${icon}
      <span class="sg-text">
        <strong>${esc(title)}</strong>
        ${subText ? `<small>${esc(subText)}</small>` : ""}
        ${note ? `<em>${esc(note)}</em>` : ""}
      </span>
      ${tag ? `<i class="sg-tag">${esc(tag)}</i>` : ""}
    </button>`;
}

function taStudentRows() { return (STATE.data && STATE.data.students && STATE.data.students.rows) || []; }
function taVal(row, key) { return String((row.values && row.values[key]) || ""); }
function taDigits(v) { return String(v || "").replace(/\D/g, ""); }
function taNumbersOf(row) {
  return [taVal(row, "Phone"), taVal(row, "WhatsApp")].map(n => taDigits(n).slice(-10)).filter(n => n.length >= 3);
}
function taSuggestBox(kind) { return document.querySelector(`#tuitionApplyModal [data-find="${kind}"] [data-suggest]`); }
function taHideSuggestions() { document.querySelectorAll("#tuitionApplyModal [data-suggest]").forEach(el => el.classList.add("hidden")); }

// only the students a shared number narrowed it down to (or everyone)
function taPool() {
  const rows = taStudentRows();
  return taNumberIds ? rows.filter(r => taNumberIds.includes(String(r.id))) : rows;
}

function taShow(kind, html) {
  const box = taSuggestBox(kind);
  box.innerHTML = html || `<p class="admin-suggest-empty">No match found.</p>`;
  document.querySelectorAll("#tuitionApplyModal [data-suggest]").forEach(el => el.classList.toggle("hidden", el !== box));
}

function taSuggestNumbers(text) {
  const digits = taDigits(text);
  if (digits.length < 3) { taHideSuggestions(); return; }
  const count = {};
  taStudentRows().forEach(r => {
    [...new Set(taNumbersOf(r))].forEach(n => { if (n.includes(digits)) count[n] = (count[n] || 0) + 1; });
  });
  const numbers = Object.keys(count).slice(0, 8);
  taShow("mobile", numbers.map(n => suggestItem({
    title: n,
    sub: count[n] > 1 ? `${count[n]} students` : taVal(taStudentRows().find(r => taNumbersOf(r).includes(n)) || {}, "Student Name"),
    tag: "Mobile",
    attrs: `data-pick-number="${esc(n)}"`,
  })).join(""));
}

// Student IDs or names, from the pool. With a number already chosen an
// empty box lists that number's students straight away.
function taSuggestStudents(kind, text) {
  const q = lower(text);
  if (!taNumberIds && q.length < 2) { taHideSuggestions(); return; }
  const list = taPool().filter(r => !q || lower(kind === "id" ? r.id : taVal(r, "Student Name")).includes(q)).slice(0, 8);
  const names = list.map(r => lower(taVal(r, "Student Name")));
  taShow(kind, list.map((r, i) => {
    const name = taVal(r, "Student Name");
    // a name that appears twice gets its ID beside it, so the two can be told apart
    const twin = kind === "name" && names.indexOf(names[i]) !== names.lastIndexOf(names[i]);
    return suggestItem({
      title: kind === "id" ? r.id : name,
      sub: kind === "id"
        ? [name, taVal(r, "Class") && `Class ${taVal(r, "Class")}`]
        : [twin ? r.id : "", taVal(r, "Class") && `Class ${taVal(r, "Class")}`, taVal(r, "City")],
      tag: "Student",
      attrs: `data-pick-id="${esc(r.id)}"`,
    });
  }).join(""));
}

function taPick(row) {
  taPicked = row;
  if (!taNumberIds) {
    const number = taVal(row, "Phone") || taVal(row, "WhatsApp");
    // a hidden number (Hide Mobile Number permission) is shown as the server sent it
    $("taMobile").value = number.includes("*") ? number : taDigits(number).slice(-10);
  }
  $("taStudentId").value = row.id;
  $("taStudentName").value = taVal(row, "Student Name");
  taHideSuggestions();
  $("tuitionApplyMessage").textContent = "";
}

function taPickNumber(number) {
  const users = taStudentRows().filter(r => taNumbersOf(r).includes(number));
  $("taMobile").value = number;
  if (users.length === 1) { taNumberIds = null; taPick(users[0]); $("taMobile").value = number; return; }
  taPicked = null;
  taNumberIds = users.map(r => String(r.id));
  $("taStudentId").value = "";
  $("taStudentName").value = "";
  $("tuitionApplyMessage").textContent = `${users.length} students use this number - pick the Student ID or Name.`;
  $("taStudentId").focus();
  taSuggestStudents("id", "");
}

function taResetFinder() {
  taPicked = null;
  taNumberIds = null;
  taHideSuggestions();
}

function wireTuitionStudentFinder() {

  $("taMobile").addEventListener("input", () => {
    taPicked = null;
    taNumberIds = null;
    $("taStudentId").value = "";
    $("taStudentName").value = "";
    $("tuitionApplyMessage").textContent = "";
    taSuggestNumbers($("taMobile").value);
  });

  [["id", "taStudentId", "taStudentName"], ["name", "taStudentName", "taStudentId"]].forEach(([kind, id, otherId]) => {
    $(id).addEventListener("input", () => {
      if (taPicked) {
        taPicked = null;
        $(otherId).value = "";
        if (!taNumberIds) $("taMobile").value = "";
      }
      taSuggestStudents(kind, $(id).value.trim());
    });
    // no list on a plain click - except to choose among a shared number's students
    $(id).addEventListener("focus", () => { if (taNumberIds && !taPicked) taSuggestStudents(kind, $(id).value.trim()); });
  });

  $("tuitionApplyModal").addEventListener("click", (event) => {
    const number = event.target.closest("[data-pick-number]");
    if (number) { taPickNumber(number.dataset.pickNumber); return; }
    const pick = event.target.closest("[data-pick-id]");
    if (pick) {
      const row = taStudentRows().find(r => String(r.id) === pick.dataset.pickId);
      if (row) taPick(row);
      return;
    }
    if (!event.target.closest(".ta-find")) taHideSuggestions();
  });

}

/************************************************************
 * DEMO ID / TUTOR ID SEARCH SUGGESTIONS
 *
 * Backed by STATE.directory (id, name, mobile - fetched for every
 * role that can see Payments, even ones with no other tutor/student
 * data). Picking one, or just resolving an exact match by typing,
 * shows a name + mobile line under the field so it can be verified.
 * Once one side is set, the other side's suggestions narrow to only
 * what's actually linked to it.
 ************************************************************/

function updateIdDetail(el, item) {
  if (!el) return;
  if (!item) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<strong>${esc(item.name || "Unknown")}</strong> · ${esc(item.mobile || "No mobile on file")}`;
  el.classList.remove("hidden");
}

// True when the typed text is part of any of the names / IDs, or (3+
// digits) of any of the numbers.
function lookupHit(query, texts, numbers) {
  const q = lower(String(query || "").trim());
  const digits = String(query || "").replace(/\D/g, "");
  if (!q) return true;
  return texts.some(t => lower(t || "").includes(q)) ||
    (digits.length >= 3 && numbers.some(n => String(n || "").replace(/\D/g, "").includes(digits)));
}

function studentHit(query, student, extra = []) {
  const st = student || {};
  return lookupHit(query, [...extra, st.id, st.name, st.parentsName], [st.mobile, st.whatsapp]);
}

// tutorSide: also match the tutor(s) teaching it (a Tutor Agency Charge
// is looked up by the tutor's own details)
function paymentDemoSuggestions(query, tutorFilter, tutorSide = false) {
  // Payments are for classes actually running right now, not every
  // tuition ever posted.
  let list = (STATE.directory.demos || []).filter(d => d.running && !(DIR_STUDENT_BY_ID[d.studentId] || {}).blocked);
  if (tutorFilter) list = list.filter(d => d.tutorIds.includes(tutorFilter));
  list = list.filter(d => studentHit(query, DIR_STUDENT_BY_ID[d.studentId], [d.demoId, d.studentId]) ||
    (tutorSide && d.tutorIds.some(id => { const t = DIR_TUTOR_BY_ID[id] || {}; return lookupHit(query, [id, t.name], [t.mobile]); })));
  return list.slice(0, 8);
}

function paymentTutorSuggestions(query, demoFilter) {
  const q = lower(query);
  const digits = String(query || "").replace(/\D/g, "");
  // Only tutors who currently have a running class - not everyone
  // who has ever registered.
  let list = (STATE.directory.tutors || []).filter(t => t.activeNow);
  if (demoFilter) list = list.filter(t => t.demoIds.includes(demoFilter));
  if (q) {
    list = list.filter(t =>
      lower(t.id).includes(q) ||
      lower(t.name || "").includes(q) ||
      (digits.length >= 3 && String(t.mobile || "").replace(/\D/g, "").includes(digits))
    );
  }
  return list.slice(0, 8);
}

function studentOrTutorSuggestions(query, isStudent, opts = {}) {
  let list = isStudent ? (STATE.directory.students || []).filter(p => !p.blocked) : (STATE.directory.tutors || []);
  if (opts.excludeFullyPaid) {
    list = list.filter(p => {
      const sub = subscriptionFor(isStudent ? "student" : "tutor", p.id);
      return !sub || subscriptionPaidAmount(sub.id) < Number(sub.amount || 0);
    });
  }
  return list.filter(p => studentHit(query, p)).slice(0, 8);
}

// Renders a dropdown of {id/demoId, name, mobile} - "demo" items show
// the linked student's name/mobile; everything else shows its own.
// Every detail of one suggestion, in order: [tag, value]
function suggestionFields(item, kind) {
  if (kind === "demo") {
    const st = DIR_STUDENT_BY_ID[item.studentId] || {};
    const tutors = (item.tutorIds || []).map(id => [id, DIR_TUTOR_BY_ID[id] || {}]);
    return [["Demo ID", item.demoId], ["Student ID", item.studentId], ["Name", st.name], ["Parent", st.parentsName],
      ["Mobile", st.mobile], ["WhatsApp", st.whatsapp], ["Subject", item.subject],
      ...tutors.flatMap(([id, t]) => [["Tutor ID", id], ["Tutor", t.name], ["Tutor Mobile", t.mobile]])];
  }
  const isStudent = String(item.id || "").toUpperCase().startsWith("SID");
  return [[isStudent ? "Student ID" : "Tutor ID", item.id], ["Name", item.name], ["Parent", item.parentsName],
    ["Mobile", item.mobile], ["WhatsApp", item.whatsapp]];
}

// Renders a suggestion list. The bold line is whatever was typed - the
// WhatsApp number when a WhatsApp number is typed, the parent's name for
// a parent's name, the ID for an ID ... (prefer: the tag of the box being
// typed in, tried first) - with its tag on the right and the rest of the
// details underneath.
function renderIdSuggestions(container, items, kind, query, prefer) {
  if (!container) return;
  if (query !== undefined && !String(query).trim()) { container.classList.add("hidden"); return; }
  if (!items.length) {
    container.innerHTML = `<p class="admin-suggest-empty">No match found.</p>`;
    container.classList.remove("hidden");
    return;
  }
  const q = String(query || "").trim();
  const hit = ([, value]) => value && q && lookupHit(q, [value], [value]) && !(String(value).includes("*"));
  container.innerHTML = items.map(item => {
    const id = kind === "demo" ? item.demoId : item.id;
    const fields = suggestionFields(item, kind).filter(([, v]) => v);
    const preferred = prefer ? fields.filter(([tag]) => tag === prefer || (prefer === "ID" && / ID$/.test(tag) && tag !== "Demo ID")) : [];
    const main = preferred.find(hit) || fields.find(hit) || preferred[0] || fields[0] || ["", id];
    const rest = fields.filter(f => f !== main && f[1] !== main[1] && !/^Tutor (ID|Mobile)$/.test(f[0]));
    return suggestItem({
      title: main[1],
      sub: rest.slice(0, 4).map(f => f[1]),
      tag: main[0] === "Name" && kind === "demo" ? "Student" : main[0],
      attrs: `data-pick-id="${esc(id)}"`,
    });
  }).join("");
  container.classList.remove("hidden");
}

function wirePaymentIdSuggestions() {

  const demoInput = $("paymentDemoId");
  const tutorInput = $("paymentTutorId");
  const demoSuggest = document.querySelector('#paymentDemoIdField [data-suggest="demo"]');
  const tutorSuggest = document.querySelector('#paymentTutorIdField [data-suggest="tutor"]');
  const demoDetail = $("paymentDemoDetail");
  const tutorDetail = $("paymentTutorDetail");

  const exactTutorId = () => (DIR_TUTOR_BY_ID[tutorInput.value.trim()] ? tutorInput.value.trim() : "");
  const exactDemoId = () => (DIR_DEMO_BY_ID[demoInput.value.trim()] ? demoInput.value.trim() : "");

  // (no list on a plain click - only once something is typed)
  demoInput.addEventListener("input", () => {
    const text = demoInput.value.trim();
    const exact = DIR_DEMO_BY_ID[text];
    updateIdDetail(demoDetail, exact ? DIR_STUDENT_BY_ID[exact.studentId] : null);
    refreshAgencyChargeFromDemo();
    if (paymentPicking) return;
    const mode = $("paymentTransactionType").value;
    renderIdSuggestions(demoSuggest, paymentDemoSuggestions(text, exactTutorId(), mode === "tutor-agency-charge"), "demo", text, "Demo ID");
  });

  tutorInput.addEventListener("input", () => {
    const text = tutorInput.value.trim();
    const exact = DIR_TUTOR_BY_ID[text];
    updateIdDetail(tutorDetail, exact || null);
    refreshAgencyChargeFromDemo();
    if (paymentPicking) return;
    renderIdSuggestions(tutorSuggest, paymentTutorSuggestions(text, exactDemoId()), "tutor", text, "ID");
  });

  demoSuggest.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-pick-id]");
    if (pick) pickPaymentDemo(pick.dataset.pickId);
  });

  tutorSuggest.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-pick-id]");
    if (pick) pickPaymentTutor(pick.dataset.pickId);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#paymentDemoIdField")) demoSuggest.classList.add("hidden");
    if (!event.target.closest("#paymentTutorIdField")) tutorSuggest.classList.add("hidden");
  });

}

/* ---------------- Record a Payment: find by anything ----------------
   Besides the Demo ID / Tutor ID boxes, the student's (or tutor's) own
   boxes - Student ID, Name, Mobile, WhatsApp, Parent Name - can be typed
   into too. Suggestions show once something is typed; picking one fills
   in every other box. */

var paymentPicking = false;   // a pick is filling the boxes (no new lists)

// What a box looks up for the picked transaction: "demo" (a running
// class), "tutor", "student" / "tutor-sub" (a Subscription's party) -
// or null when it's only filled in, not typed into.
function paymentLookupKind(id) {
  const mode = $("paymentTransactionType").value;
  const isSub = mode === "student-subscription" || mode === "tutor-subscription";
  if (PAYMENT_PARTY_BOXES.includes(id)) {
    if (isSub) return mode === "student-subscription" ? "student" : "tutor-sub";
    return mode.endsWith("agency-charge") ? "demo" : null;
  }
  if (PAYMENT_TUTOR_BOXES.includes(id)) return mode === "payout" ? "tutor" : null;
  if (PAYMENT_STUDENT_BOXES.includes(id)) return isSub ? null : "demo";
  return null;
}

// the detail a Record a Payment box holds (its suggestions lead with it)
function paymentBoxTag(id) {
  const mode = $("paymentTransactionType").value;
  if (id === "paymentSubName") return mode === "student-agency-charge" ? "Parent" : (mode === "tutor-agency-charge" ? "Tutor" : "Name");
  if (id === "paymentSubId") return mode === "tutor-agency-charge" ? "Tutor ID" : "ID";
  if (id === "paymentSubMobile") return mode === "tutor-agency-charge" ? "Tutor Mobile" : "Mobile";
  if (mode === "payout" && (id === "paymentTutorName" || id === "paymentTutorMobile")) return id === "paymentTutorName" ? "Name" : "Mobile";
  return { paymentStudentMobile: "Mobile", paymentStudentName: "Name", paymentStuId: "Student ID",
           paymentStuWhatsapp: "WhatsApp", paymentParentName: "Parent", paymentTutorMobile: "Mobile", paymentTutorName: "Name" }[id] || "";
}

function setPaymentLookupEditable() {
  [...PAYMENT_STUDENT_BOXES, ...PAYMENT_TUTOR_BOXES, ...PAYMENT_PARTY_BOXES]
    .forEach(id => { $(id).readOnly = !paymentLookupKind(id); });
  hidePaymentSuggestions();
}

function hidePaymentSuggestions() {
  document.querySelectorAll("#paymentForm .admin-suggest").forEach(el => el.classList.add("hidden"));
}

function pickPaymentDemo(demoId) {
  paymentPicking = true;
  $("paymentDemoId").value = demoId;
  $("paymentDemoId").dispatchEvent(new Event("input", { bubbles: true }));
  paymentPicking = false;
  hidePaymentSuggestions();
}

function pickPaymentTutor(tutorId) {
  paymentPicking = true;
  $("paymentTutorId").value = tutorId;
  $("paymentTutorId").dispatchEvent(new Event("input", { bubbles: true }));
  paymentPicking = false;
  hidePaymentSuggestions();
}

function wirePaymentLookups() {

  [...PAYMENT_STUDENT_BOXES, ...PAYMENT_TUTOR_BOXES, ...PAYMENT_PARTY_BOXES].forEach(id => {

    const input = $(id);
    const suggest = input.closest(".admin-id-row").querySelector(".admin-suggest");

    input.addEventListener("input", () => {
      const kind = paymentLookupKind(id);
      if (input.readOnly || !kind) return;
      const text = input.value;

      // whatever an earlier pick filled in no longer applies
      if (kind === "demo") {
        if ($("paymentTransactionType").value === "payout") {
          $("paymentDemoId").value = "";
          updateIdDetail($("paymentDemoDetail"), null);
          [...PAYMENT_STUDENT_BOXES, "paymentSubAmount", "paymentSubDues", "paymentPayingNow", "paymentRemaining"]
            .forEach(box => { $(box).value = ""; });
        } else if ($("paymentDemoId").value) {
          $("paymentDemoId").value = "";
          updateIdDetail($("paymentDemoDetail"), null);
          refreshAgencyChargeFromDemo();
        }
      } else if (kind === "tutor") {
        if ($("paymentTutorId").value) {
          $("paymentTutorId").value = "";
          updateIdDetail($("paymentTutorDetail"), null);
          refreshAgencyChargeFromDemo();
        }
      } else {
        $("paymentSubscriptionId").value = "";
        clearPaymentSubFields();
      }
      input.value = text;
      hidePaymentSuggestions();

      const query = text.trim();
      const mode = $("paymentTransactionType").value;
      if (kind === "demo") {
        const tutorFilter = mode === "payout" && DIR_TUTOR_BY_ID[$("paymentTutorId").value.trim()] ? $("paymentTutorId").value.trim() : "";
        const tutorSide = mode === "tutor-agency-charge" && PAYMENT_PARTY_BOXES.includes(id);
        renderIdSuggestions(suggest, paymentDemoSuggestions(query, tutorFilter, tutorSide), "demo", query, paymentBoxTag(id));
      } else if (kind === "tutor") {
        const demoFilter = DIR_DEMO_BY_ID[$("paymentDemoId").value.trim()] ? $("paymentDemoId").value.trim() : "";
        renderIdSuggestions(suggest, paymentTutorSuggestions(query, demoFilter), "tutor", query, paymentBoxTag(id));
      } else {
        const isStudent = kind === "student";
        // an exact Student / Tutor ID fills its subscription straight away
        if (id === "paymentSubId" && (isStudent ? DIR_STUDENT_BY_ID : DIR_TUTOR_BY_ID)[query] &&
            subscriptionFor(isStudent ? "student" : "tutor", query)) {
          fillPaymentSubscriptionFields(isStudent ? "student" : "tutor", query);
          suggest.classList.add("hidden");
          return;
        }
        renderIdSuggestions(suggest, studentOrTutorSuggestions(query, isStudent, { excludeFullyPaid: true }), "party", query, paymentBoxTag(id));
      }
    });

    suggest.addEventListener("click", (event) => {
      const pick = event.target.closest("[data-pick-id]");
      if (!pick) return;
      const kind = paymentLookupKind(id);
      if (kind === "demo") pickPaymentDemo(pick.dataset.pickId);
      else if (kind === "tutor") pickPaymentTutor(pick.dataset.pickId);
      else {
        hidePaymentSuggestions();
        fillPaymentSubscriptionFields(kind === "student" ? "student" : "tutor", pick.dataset.pickId);
      }
    });

  });

  document.addEventListener("click", (event) => {
    document.querySelectorAll("#paymentForm .admin-id-row").forEach(row => {
      if (row.contains(event.target)) return;
      const box = row.querySelector(".admin-suggest");
      if (box) box.classList.add("hidden");
    });
  });

}

// New Subscription: the picked student's / tutor's Name and Mobile Number
function fillSubscriptionParty(item) {
  $("subscriptionPartyName").value = (item && item.name) || "";
  $("subscriptionPartyMobile").value = (item && item.mobile) || "";
}

// New Subscription: Student / Tutor ID, Name or Mobile Number - type in
// any one, pick from the suggestions, and the other two fill in.
function wireSubscriptionIdSuggestion() {

  const isStudent = () => $("subscriptionPartyType").value === "student";
  const dir = () => (isStudent() ? DIR_STUDENT_BY_ID : DIR_TUTOR_BY_ID);
  const boxes = ["subscriptionPartyId", "subscriptionPartyName", "subscriptionPartyMobile"];
  const hideAll = () => document.querySelectorAll("#subscriptionForm .admin-suggest").forEach(el => el.classList.add("hidden"));

  boxes.forEach(id => {
    const input = $(id);
    const suggest = input.closest(".admin-id-row").querySelector(".admin-suggest");

    input.addEventListener("input", () => {
      const text = input.value;
      const query = text.trim();
      if (id === "subscriptionPartyId") {
        fillSubscriptionParty(dir()[query] || null);
      } else {
        // a new name / number: the earlier pick no longer applies
        boxes.filter(other => other !== id).forEach(other => { $(other).value = ""; });
      }
      renderIdSuggestions(suggest, studentOrTutorSuggestions(query, isStudent()), "party", query,
        { subscriptionPartyId: "ID", subscriptionPartyName: "Name", subscriptionPartyMobile: "Mobile" }[id]);
    });

    suggest.addEventListener("click", (event) => {
      const pick = event.target.closest("[data-pick-id]");
      if (!pick) return;
      $("subscriptionPartyId").value = pick.dataset.pickId;
      fillSubscriptionParty(dir()[pick.dataset.pickId] || null);
      hideAll();
    });
  });

  document.addEventListener("click", (event) => {
    document.querySelectorAll("#subscriptionForm .admin-id-row").forEach(row => {
      if (!row.contains(event.target)) row.querySelector(".admin-suggest").classList.add("hidden");
    });
  });

}

/* A dropdown (Transaction: Student / Tutor Subscription ...) opens as the
   same list as the suggestions - title, grey detail line, tag pill - with
   the chosen one ticked. The <select> itself still holds the value. */
function wirePickList(selectId) {

  const select = $(selectId);
  const label = select.closest(".admin-float");
  const panel = document.createElement("div");
  panel.className = "admin-suggest admin-pick hidden";
  label.appendChild(panel);

  const open = () => {
    const tick = `<svg class="sg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;
    const dot = `<svg class="sg-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/></svg>`;
    panel.innerHTML = [...select.options].map(o => suggestItem({
      title: o.text.replace(/\s*\(.*\)$/, ""),
      sub: o.dataset.sub || "",
      tag: o.dataset.tag || "",
      icon: o.value === select.value ? tick : dot,
      attrs: `data-pick-value="${esc(o.value)}"${o.value === select.value ? ' data-on="1"' : ""}`,
    })).join("");
    panel.classList.remove("hidden");
  };
  const close = () => panel.classList.add("hidden");

  // the select itself takes no taps (CSS), so no browser list - on
  // phones too - just ours
  label.classList.add("has-pick");
  label.addEventListener("click", (event) => {
    if (panel.contains(event.target)) return;
    event.preventDefault();
    select.focus();
    panel.classList.contains("hidden") ? open() : close();
  });
  select.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " " || (event.altKey && event.key === "ArrowDown")) {
      event.preventDefault();
      open();
    } else if (event.key === "Escape") close();
  });

  panel.addEventListener("click", (event) => {
    event.preventDefault();
    const pick = event.target.closest("[data-pick-value]");
    if (!pick) return;
    close();
    if (select.value !== pick.dataset.pickValue) {
      select.value = pick.dataset.pickValue;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  document.addEventListener("click", (event) => { if (!label.contains(event.target)) close(); });

}

// ---- permission checklist (New Employee form + each employee's card) ----

/* =====================================================================
   EMPLOYEE PERMISSIONS FORM
   The permission tick-boxes (roles presets + Privacy options) shown in the
   New Employee form and on each employee card.
   ===================================================================== */

function permChecklistHtml(selected, disabled) {
  const info = STATE.permInfo;
  if (!info) return "";
  return info.groups.map(g => `
    <fieldset class="perm-group perm-group-${esc(g.id)}">
      <legend>${esc(g.label)}</legend>
      ${g.items.map(i => `
        <label class="perm-item">
          <input type="checkbox" data-perm="${esc(i.key)}"${selected.has(i.key) ? " checked" : ""}${disabled ? " disabled" : ""}>
          <span>${esc(i.label)}</span>
        </label>`).join("")}
    </fieldset>`).join("");
}

function permValues(container) {
  return [...container.querySelectorAll("input[data-perm]:checked")].map(i => i.dataset.perm);
}

// A Role just fills in its usual set of ticks; a Super Admin gets all of
// them, locked.
function applyPermPreset(container, role) {
  const preset = new Set((STATE.permInfo && STATE.permInfo.presets[role]) || []);
  container.querySelectorAll("input[data-perm]").forEach(i => {
    i.checked = preset.has(i.dataset.perm);
    i.disabled = role === "super_admin";
  });
}

// Ticking "Record payments" also ticks "View Payments"; un-ticking a
// view permission un-ticks everything that depends on it.
function onPermToggle(event) {
  const input = event.target.closest("input[data-perm]");
  const container = event.target.closest("[data-perms]");
  if (!input || !container || !STATE.permInfo) return;
  const parents = STATE.permInfo.parents;
  const find = key => container.querySelector(`input[data-perm="${key}"]`);
  if (input.checked && parents[input.dataset.perm]) find(parents[input.dataset.perm]).checked = true;
  if (!input.checked) {
    Object.keys(parents).forEach(child => { if (parents[child] === input.dataset.perm) find(child).checked = false; });
  }
}

function wireEmployeeForm() {

  const perms = $("employeePerms");
  perms.setAttribute("data-perms", "");
  perms.addEventListener("change", onPermToggle);

  const refreshPerms = () => {
    perms.innerHTML = permChecklistHtml(new Set());
    applyPermPreset(perms, $("employeeRole").value);
  };

  $("employeeRole").addEventListener("change", () => { applyPermPreset(perms, $("employeeRole").value); syncHoursRow(); });
  $("employeeHoursRow").addEventListener("input", onHoursInput);
  $("employeeList").addEventListener("input", onHoursInput);

  $("addEmployeeButton").addEventListener("click", () => {
    const form = $("employeeForm");
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) {
      $("employeeEmail").value = "";
      $("employeeName").value = "";
      $("employeeRole").value = "tuition_coordinator";
      $("employeeWorkHours").value = "9";
      $("employeeWorkStart").value = "09:00";
      $("employeeWorkEnd").value = "18:00";
      syncHoursRow();
      refreshPerms();
      $("employeeEmail").focus();
    }
  });

  $("cancelEmployeeButton").addEventListener("click", () => $("employeeForm").classList.add("hidden"));

  $("employeeForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    const email = $("employeeEmail").value.trim();
    const fullName = $("employeeName").value.trim();

    if (!email || !fullName) {
      toast("Enter an email and a name.", true);
      return;
    }

    const role = $("employeeRole").value;
    const payload = { action: "adminAddEmployee", email, fullName, role,
      workStart: $("employeeWorkStart").value, workEnd: $("employeeWorkEnd").value };
    if (role !== "super_admin") payload.permissions = permValues(perms);

    const button = $("employeeForm").querySelector("button[type=submit]");
    const ok = await save(payload, button);

    if (ok) $("employeeForm").classList.add("hidden");

  });

  // On an existing employee's card (edit mode): same ticks, and changing
  // their Role there refills them too.
  $("employeeList").addEventListener("change", (event) => {
    const box = event.target.closest("[data-box]");
    if (!box) return;
    if (event.target.dataset && event.target.dataset.efield === "role") {
      const area = box.querySelector("[data-perms]");
      if (area) applyPermPreset(area, roleKeyFromLabel(event.target.value));
      return;
    }
    onPermToggle(event);
  });

}

/* =====================================================================
   TABS, SCROLLING AND CARD OPEN/CLOSE
   Switching tabs, jumping from one card to a linked one, expanding cards.
   ===================================================================== */

// Choosing a tab always starts from the "All" filter.
function resetFilter(tab) {

  if (tab === "tuitions") {
    STATE.tuitionFilter = "all";
    $("tuitionFilter").querySelectorAll(".admin-chip").forEach(c => c.classList.toggle("active", c.dataset.value === "all"));
  }

  if (tab === "tutors") {
    STATE.tutorFilter = "all";
    $("tutorFilter").querySelectorAll(".admin-chip").forEach(c => c.classList.toggle("active", c.dataset.value === "all"));
  }

}

function showTab(name) {

  closeTutorStats();

  if (name !== STATE.tab) { collapseAll(); closeIdleForms(); }

  STATE.tab = name;

  applyActiveTab();

  rerenderCurrent();

}

// Tile click: open that tab with that filter (search cleared so the
// whole group shows). "today" has no chip of its own.
function goToFilter(tab, filter) {

  collapseAll();
  closeIdleForms();

  if (tab === "tuitions") {
    STATE.tuitionFilter = filter;
    $("tuitionSearch").value = "";
    clearSearchChips("tuitionSearch");
    $("tuitionFilter").querySelectorAll(".admin-chip").forEach(c => c.classList.toggle("active", c.dataset.value === filter));
  } else if (tab === "tutors") {
    STATE.tutorFilter = filter;
    $("tutorSearch").value = "";
    clearSearchChips("tutorSearch");
    $("tutorFilter").querySelectorAll(".admin-chip").forEach(c => c.classList.toggle("active", c.dataset.value === filter));
  }

  showTab(tab);

  $("mainTabs").scrollIntoView({ behavior: "smooth", block: "start" });

}

// A white band sweeping left to right across el, once, over 5s.
function waveHighlight(el) {
  el.classList.remove("admin-wave");
  void el.offsetWidth;
  el.classList.add("admin-wave");
  el.addEventListener("animationend", () => el.classList.remove("admin-wave"), { once: true });
}

// From a student's "Tuitions" pill: jump to the Tuitions tab with that
// one tuition opened, ignoring whatever filter/search was active there.
// highlight (a payment's ₹): leave it collapsed and wave-highlight
// instead - the whole Class card plus the one figure in it named
// ("student-payment", "tutor-agency", ...) when there is one, else the
// Tuition card.
function goToTuition(demoId, highlight) {

  collapseAll();
  STATE.tab = "tuitions";
  STATE.tuitionFilter = "all";
  $("tuitionSearch").value = "";
  clearSearchChips("tuitionSearch");
  $("tuitionFilter").querySelectorAll(".admin-chip").forEach(c => c.classList.toggle("active", c.dataset.value === "all"));
  if (!highlight) STATE.open.add("tuition:" + demoId);

  applyActiveTab();
  rerenderCurrent();

  requestAnimationFrame(() => {
    const demo = CSS.escape(demoId);
    const classCardEl = document.querySelector(`#tab-tuitions .class-card[data-demo="${demo}"]`);
    const part = highlight && highlight !== true && classCardEl
      ? classCardEl.querySelector(`[data-part="${CSS.escape(highlight)}"]`)
      : null;
    const target = part ? classCardEl : document.querySelector(`#tab-tuitions .tuition-card[data-demo="${demo}"]`);
    if (!target) return;
    revealOnPage(target);
    if (highlight) waveHighlight(target);
    if (part) waveHighlight(part);
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  });

}

// Same as goToTuition's highlight, for one Subscription or Tutor card:
// that tab's search (and Tutor filter) cleared so the card is shown,
// then wave-highlighted and scrolled into view, left collapsed.
function goToCard(tab, key) {

  const searchId = { subscriptions: "subscriptionSearch", tutors: "tutorSearch", students: "studentSearch", payments: "paymentSearch" }[tab];
  if (tab === "payments") $("paymentForm").classList.add("hidden");

  collapseAll();
  STATE.tab = tab;
  $(searchId).value = "";
  clearSearchChips(searchId);
  if (tab === "tutors") {
    STATE.tutorFilter = "all";
    $("tutorFilter").querySelectorAll(".admin-chip").forEach(c => c.classList.toggle("active", c.dataset.value === "all"));
  }
  applyActiveTab();
  rerenderCurrent();

  requestAnimationFrame(() => {
    const card = document.querySelector(`#tab-${tab} article[data-key="${CSS.escape(key)}"]`);
    if (!card) return;
    revealOnPage(card);
    waveHighlight(card);
    card.scrollIntoView({ behavior: "smooth", block: "center" });
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

// Only ONE card is open at a time. A tuition keeps its own tutor
// cards (same stack) open with it; every other card collapses.
// A card that collapses while in edit mode drops its unsaved edits
// and goes back to normal.
//
// Opening always shows the FULL card body and needs a real re-render
// (the DOM may currently hold the reduced "quick" body from a status-
// rail tap - see openQuickCard()). Closing is still a cheap show/hide,
// since a closed card's stale content doesn't matter until it reopens.
// A click anywhere outside an open card closes it - "outside" meaning
// outside its whole joined stack (a Tuition with its Class card and
// Tutor rows counts as one), and never a card that's being edited, so
// unsaved changes aren't lost. Runs in the capture phase, before the
// click's own handler, and only flips classes (no re-render).
function collapseOnOutsideClick(event) {

  if (!STATE.open.size) return;

  const target = event.target;
  let closed = false;

  document.querySelectorAll(".admin-card.is-open").forEach(card => {
    const head = card.querySelector(":scope > .admin-card-head[data-toggle]");
    const key = head && head.dataset.toggle;
    if (!key || !STATE.open.has(key) || STATE.editing.has(key)) return;
    const area = card.closest(".admin-stack") || card;
    if (area.contains(target)) return;
    STATE.open.delete(key);
    STATE.quickOpen.delete(key);
    card.classList.remove("is-open");
    closed = true;
  });

  return closed;

}

function toggleCard(head) {

  const key = head.dataset.toggle;
  const list = head.closest(".admin-stack-list");
  const stack = head.closest(".admin-stack");
  const opening = !STATE.open.has(key);

  if (opening) {

    const heads = Array.from(list.querySelectorAll("[data-toggle]"));

    Array.from(STATE.open).forEach(openKey => {
      const other = heads.find(h => h.dataset.toggle === openKey);
      if (!other || !stack || other.closest(".admin-stack") !== stack) STATE.open.delete(openKey);
    });

    STATE.open.add(key);
    STATE.quickOpen.delete(key);

    Array.from(STATE.editing).forEach(editKey => {
      if (!STATE.open.has(editKey)) STATE.editing.delete(editKey);
    });

    rerenderCurrent();
    return;

  }

  STATE.open.delete(key);
  STATE.quickOpen.delete(key);

  let editDropped = false;

  Array.from(STATE.editing).forEach(editKey => {
    if (!STATE.open.has(editKey)) {
      STATE.editing.delete(editKey);
      editDropped = true;
    }
  });

  if (editDropped) {
    rerenderCurrent();
    return;
  }

  // Show / hide only - no re-render, so typing in the open card is kept.
  list.querySelectorAll("[data-toggle]").forEach(h => {
    h.closest(".admin-card").classList.toggle("is-open", STATE.open.has(h.dataset.toggle));
  });

}

// Tapping the status rail (Finding Tutor / Schedule Demo / Demo Scheduled /
// Processing) opens the card straight to just the fields that status needs
// to move forward, plus Save - not the whole card.
function openQuickCard(head) {

  const key = head.dataset.toggle;
  const list = head.closest(".admin-stack-list");
  const stack = head.closest(".admin-stack");
  const heads = Array.from(list.querySelectorAll("[data-toggle]"));

  Array.from(STATE.open).forEach(openKey => {
    const other = heads.find(h => h.dataset.toggle === openKey);
    if (!other || !stack || other.closest(".admin-stack") !== stack) STATE.open.delete(openKey);
  });

  STATE.open.add(key);
  STATE.quickOpen.add(key);

  Array.from(STATE.editing).forEach(editKey => {
    if (!STATE.open.has(editKey)) STATE.editing.delete(editKey);
  });

  rerenderCurrent();

}

// Filter / tab change: everything collapses, unsaved edits are dropped.
function collapseAll() {
  STATE.open.clear();
  STATE.editing.clear();
  STATE.quickOpen.clear();
}

function rerenderCurrent() {
  if (STATE.tab === "tuitions") renderTuitions();
  if (STATE.tab === "tutors") renderTutors();
  if (STATE.tab === "students") renderStudents();
  if (STATE.tab === "payments") renderPayments();
  if (STATE.tab === "subscriptions") renderSubscriptions();
  if (STATE.tab === "ledger") renderLedger();
  if (STATE.tab === "employees") renderEmployees();
  if (STATE.tab === "graph") renderGraph();
}

/* =====================================================================
   BUTTON CLICKS ON CARDS
   One central click handler: Edit, Save, Cancel, Delete, Terminate,
   Accept/Reject, etc. all start here and call the save functions below.
   ===================================================================== */

async function onListClick(event) {

  if (onSuggestPick(event)) return;

  const actionEl = event.target.closest("[data-action]");

  // Tapping a card's head opens / closes it.
  if (!actionEl) {
    const head = event.target.closest("[data-toggle]");
    if (!head) return;
    toggleCard(head);
    return;
  }

  const action = actionEl.dataset.action;
  const box = actionEl.closest("[data-box]");

  switch (action) {

    case "go-to-tuition":
      goToTuition(actionEl.dataset.demo, actionEl.dataset.part || actionEl.dataset.highlight === "1");
      break;

    case "go-to-card":
      goToCard(actionEl.dataset.tab, actionEl.dataset.key);
      break;

    case "cal-month":
    case "cal-day":
    case "deal-model":
    case "deal-feeto":
    case "day-status":
    case "day-close":
      onClassPlanClick(actionEl);
      break;

    case "day-save":
      await saveClassDay(box, actionEl);
      break;

    case "finalize-class":
      await saveClassDetails(box, actionEl, true);
      break;

    case "settle-class":
      openSettlePanel(box);
      break;

    case "settle-cancel":
      box.querySelector("[data-settle]").classList.add("hidden");
      break;

    case "settle-confirm":
      await confirmSettle(box, actionEl);
      break;

    case "tutor-stats":
      toggleTutorStats(actionEl, actionEl.dataset.id);
      break;

    case "ledger-record": {
      if (actionEl.dataset.sub) {
        const sub = (STATE.subscriptions || []).find(x => String(x.id) === actionEl.dataset.sub);
        if (sub) openPaymentFormForSubscription(sub);
        break;
      }
      const g = demoGroups().find(x => x.demoId === actionEl.dataset.demo);
      const activeRow = g ? activeRowFor(g) : null;
      if (activeRow) openPaymentFormForClass(actionEl.dataset.part, g, activeRow);
      break;
    }

    case "class-figure": {
      const g = demoGroups().find(x => x.demoId === actionEl.closest(".class-card").dataset.demo);
      const activeRow = g ? activeRowFor(g) : null;
      if (activeRow) openPaymentFormForClass(actionEl.dataset.kind, g, activeRow);
      break;
    }

    case "edit":
      STATE.editing.add(actionEl.dataset.key);
      rerenderCurrent();
      break;

    case "student-edit":
      STATE.open.add(actionEl.dataset.key);
      STATE.editing.add(actionEl.dataset.key);
      rerenderCurrent();
      break;

    case "student-status":
      STATE.open.add(actionEl.dataset.key);
      rerenderCurrent();
      break;

    case "student-mute":
      await muteStudent(actionEl.dataset.id, actionEl);
      break;

    case "student-block":
      await blockStudent(actionEl.dataset.id, actionEl);
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

    // Delete a tuition request for good (with its tutors' applications / demos)
    case "delete-tuition": {
      const demoId = box.dataset.demo;
      const ok = await askConfirm({
        title: `Delete ${demoId}?`,
        lines: [
          "The tuition request and every tutor's application / demo on it will be deleted for good. This cannot be undone.",
          "If you only want to stop it, use Terminate instead.",
        ],
      });
      if (ok) await save({ action: "adminDeleteTuition", demoId }, actionEl);
      break;
    }

    case "save-row":
      await saveDemoRow(box, actionEl);
      break;

    case "toggle-student": {
      const k = actionEl.dataset.key;
      if (STATE.studentOpen.has(k)) STATE.studentOpen.delete(k); else STATE.studentOpen.add(k);
      rerenderCurrent();
      break;
    }

    case "quick-open": {
      const head = box.querySelector("[data-toggle]");
      const key = head.dataset.toggle;
      // A second tap on the status while it's open (quick or full)
      // collapses the card again, instead of re-opening it.
      if (STATE.open.has(key)) {
        STATE.open.delete(key);
        STATE.quickOpen.delete(key);
        rerenderCurrent();
        break;
      }
      openQuickCard(head);
      requestAnimationFrame(() => {
        const newHead = Array.from(document.querySelectorAll("[data-toggle]")).find(h => h.dataset.toggle === key);
        const newBox = newHead && newHead.closest("[data-box]");
        const target = newBox && (newBox.querySelector("[data-rfield='date']") || newBox.querySelector("[data-assign]"));
        if (target) {
          target.focus();
          if (typeof target.showPicker === "function") {
            try { target.showPicker(); } catch (e) { /* not user-gesture-eligible in this browser */ }
          }
        }
      });
      break;
    }

    case "show-full": {
      STATE.quickOpen.delete(actionEl.dataset.key);
      rerenderCurrent();
      break;
    }

    case "toggle-completed": {
      // save() sets button.textContent while saving, but that's a no-op
      // on a checkbox input - swap the pill's own label text instead so
      // "Saving..." is actually visible while the request is in flight.
      const textEl = actionEl.closest(".pill-check")?.querySelector(".pill-check-text");
      const original = textEl ? textEl.textContent : "";
      if (textEl) textEl.textContent = "Saving...";
      actionEl.disabled = true;
      const ok = await save({
        action: "adminUpdateDemoRow",
        rowNumber: Number(actionEl.dataset.row),
        demoId: box.dataset.demo,
        tutorId: actionEl.dataset.tutorId,
        changes: { "Classes Completed": actionEl.checked }
      });
      if (!ok) {
        actionEl.checked = !actionEl.checked;
        actionEl.disabled = false;
        if (textEl) textEl.textContent = original;
      }
      break;
    }

    case "save-class-details":
      await saveClassDetails(box, actionEl);
      break;

    case "verify": {
      // Accept / Reject a Pending tutor, or Accept / Suspend a Verified
      // one (Suspend has the exact same effect as Reject).
      const value = actionEl.dataset.value;
      const record = STATE.data.tutors.rows.find(r => r.id === box.dataset.id) || { values: {} };
      const name = record.values["Full Name"] || box.dataset.id;
      const isSuspend = value === "Rejected" && statusGroup(record.values["Verification Status"]) === "verified";
      const ok = window.confirm(value === "Verified"
        ? `Accept ${name}? Their profile will be marked Verified.`
        : isSuspend
          ? `Suspend ${name}? Their profile will be marked Rejected and they will no longer count as verified.`
          : `Reject ${name}? Their profile will be marked Rejected.`);
      if (!ok) break;
      box.querySelectorAll(".admin-vbtn").forEach(b => { b.disabled = true; });
      const saved = await save({
        action: "adminUpdateRecord",
        kind: "tutors",
        rowNumber: Number(box.dataset.row),
        id: box.dataset.id,
        changes: { "Verification Status": value }
      }, actionEl);
      if (!saved) box.querySelectorAll(".admin-vbtn").forEach(b => { b.disabled = false; });
      break;
    }

    case "save-payment":
      await savePaymentEdit(box, actionEl);
      break;

    case "delete-payment": {
      const id = Number(box.dataset.id);
      if (window.confirm("Delete this payment record? This cannot be undone.")) {
        await save({ action: "adminDeletePayment", id }, actionEl);
      }
      break;
    }

    case "save-employee":
      await saveEmployeeEdit(box, actionEl);
      break;

    case "employee-status": {
      const value = actionEl.dataset.value === "true";
      const emp = (STATE.employees || []).find(x => String(x.id) === box.dataset.id) || {};
      const name = emp.full_name || box.dataset.id;
      const ok = window.confirm(value
        ? `Set ${name} back to Active?`
        : `Suspend ${name}? They will no longer be able to log in to the admin panel.`);
      if (!ok) break;
      box.querySelectorAll(".admin-vbtn").forEach(b => { b.disabled = true; });
      const saved = await save({ action: "adminUpdateEmployee", id: box.dataset.id, changes: { active: value } }, actionEl);
      if (!saved) box.querySelectorAll(".admin-vbtn").forEach(b => { b.disabled = false; });
      break;
    }

    case "save-subscription":
      await saveSubscriptionEdit(box, actionEl);
      break;

    case "delete-subscription": {
      toast("Subscriptions cannot be deleted.", true);
      break;
    }

    case "record-payment": {
      const id = Number(box.dataset.id);
      const sub = (STATE.subscriptions || []).find(s => s.id === id);
      if (sub) openPaymentFormForSubscription(sub);
      break;
    }


  }

}

/* =====================================================================
   SAVING EDITS
   Each function sends one kind of change (payment, subscription, employee,
   record, tuition, class, demo row) to the server and then refreshes.
   ===================================================================== */

async function savePaymentEdit(box, button) {

  const id = Number(box.dataset.id);
  const key = box.dataset.key;
  const payload = { action: "adminUpdatePayment", id };

  box.querySelectorAll("[data-pfield]").forEach(input => {
    const field = input.dataset.pfield;
    payload[field] = field === "transactionType" ? input.value.toLowerCase() : input.value;
  });

  const ok = await save(payload, button);

  if (ok) {
    STATE.editing.delete(key);
    rerenderCurrent();
  }

}

function roleKeyFromLabel(label) {
  return Object.keys(ROLE_LABELS).find(k => ROLE_LABELS[k] === label) || label;
}

function subscriptionStatusKeyFromLabel(label) {
  return Object.keys(SUBSCRIPTION_STATUS_LABELS).find(k => SUBSCRIPTION_STATUS_LABELS[k] === label) || label;
}

async function saveSubscriptionEdit(box, button) {

  const id = Number(box.dataset.id);
  const key = box.dataset.key;
  const payload = { action: "adminUpdateSubscription", id };

  box.querySelectorAll("[data-subfield]").forEach(input => {
    const field = input.dataset.subfield;
    payload[field] = field === "status" ? subscriptionStatusKeyFromLabel(input.value) : input.value;
  });

  const ok = await save(payload, button);

  if (ok) {
    STATE.editing.delete(key);
    rerenderCurrent();
  }

}

async function saveEmployeeEdit(box, button) {

  const id = box.dataset.id;
  const key = box.dataset.key;
  const changes = {};

  box.querySelectorAll("[data-efield]").forEach(input => {
    const field = input.dataset.efield;
    if (field === "active") changes.active = input.value === "Yes";
    else if (field === "role") changes.role = roleKeyFromLabel(input.value);
    else changes[field] = input.value;
  });

  const permArea = box.querySelector("[data-perms]");
  if (permArea && changes.role !== "super_admin" && !permArea.hasAttribute("data-locked")) {
    changes.permissions = permValues(permArea);
  }

  const ok = await save({ action: "adminUpdateEmployee", id, changes }, button);

  if (ok) {
    STATE.editing.delete(key);
    rerenderCurrent();
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

  box.querySelectorAll("[data-field]:not([readonly])").forEach(input => {
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

async function saveClassDetails(box, button, finalize = false) {

  const rowNumber = Number(box.dataset.row);
  const demoId = box.dataset.demo;
  const tutorId = box.dataset.tutorId;
  const changes = {};

  box.querySelectorAll("[data-cfield]").forEach(input => {
    changes[input.dataset.cfield] = input.value.trim();
  });

  // the calendar's dates and the deal; the older fields get the deal's figures
  const plan = box.querySelector("[data-class-plan]");
  let deal = null;
  if (plan) {
    const panel = plan.querySelector("[data-deal]");
    deal = readDeal(panel);
    const dates = planDates(plan);
    const m = dealNumbers(deal, dates.length);
    const g = demoGroups().find(x => x.demoId === demoId);
    const row = g ? (g.rows || []).find(r => r.tutorId === tutorId) || activeRowFor(g) : null;
    const before = (row && row.billingPlan && row.billingPlan.deal) || {};
    deal = { ...before, ...deal, tutorFreq: deal.parentFreq };
    changes["Class Dates"] = dates;
    changes["Billing Mode"] = deal.model;
    changes["Billing Plan"] = { ...((row && row.billingPlan) || {}), deal };
    changes["Class Duration"] = deal.minutes;
    changes["Class Charges"] = m.model === "margin" ? m.parentPerClass : m.perClass;
    changes["Class Total Amount"] = m.model === "margin" ? m.parentMonthly : m.monthlyFee;
    changes["Student Payment To"] = m.model === "commission" ? m.feeTo : "Agency";
    changes["Tutor Payment From"] = m.model === "commission" && m.feeTo === "Tutor" ? "Parents" : "Agency";
    changes["Tutor Agency Charge"] = m.model === "commission" ? m.cut : 0;
    changes["Student Payment Frequency"] = deal.parentFreq || "Monthly";
    changes["Tutor Payment Frequency"] = deal.parentFreq || "Monthly";
    const due = nextPayDates(changes["Class Start Date"] || box.querySelector('[data-cfield="Class Start Date"]')?.value, deal.parentFreq);
    changes["Student Next Due Date"] = due.parent;
    changes["Tutor Next Payment Date"] = due.tutor;
    if (finalize) {
      if (!dates.length) { toast("Pick the class dates on the calendar first.", true); return; }
      if (m.model === "commission" ? !(m.monthlyFee > 0) : !(m.parentPerClass > 0)) {
        toast(m.model === "commission" ? "Enter the Monthly Fee." : "Enter the Parent Pays per Class.", true); return;
      }
      if ((m.model === "commission" ? m.tutorFirstMonth : m.tutorPerClass) < 0) { toast("The agency's share can't be more than the fee.", true); return; }
    }
  }

  let ok = await save({ action: "adminUpdateDemoRow", rowNumber, demoId, tutorId, changes }, button);
  if (ok && finalize && deal) ok = await save({ action: "adminFinalizeClass", demoId, tutorId, deal }, button);

  if (ok) {
    STATE.editing.delete("class:" + demoId);
    rerenderCurrent();
  }

}

async function assignTutor(box, button) {

  const input = box.querySelector("[data-assign]");
  const found = exactTutor(input.value.trim());

  if (!found) {
    toast("No tutor found with that Tutor ID or mobile number.", true);
    input.focus();
    return;
  }

  const tutor = found.id;

  const ok = await save({ action: "adminAssignTutor", demoId: box.dataset.demo, tutor }, button);

  if (ok) input.value = "";

}

async function saveDemoRow(box, button) {

  const rowNumber = Number(box.dataset.row);
  const demoId = box.dataset.demo;

  // The database finds the row by Demo ID + Tutor ID.
  const row = (STATE.data.demos || []).find(r => r.rowNumber === rowNumber && r.demoId === demoId);

  if (!row || !row.tutorId) {
    toast("That row has changed. Refresh and try again.", true);
    return;
  }

  const date = box.querySelector("[data-rfield='date']").value;
  const time = box.querySelector("[data-rfield='time']").value;

  if ((date && !time) || (!date && time)) {
    toast("Choose both the demo date and time, or clear both.", true);
    return;
  }

  // The quick view (opened from the status rail) only shows the demo
  // fields above - Parent/Tutor Accepted and Classes Completed aren't in
  // the DOM there, so fall back to the row's current value instead of
  // silently resetting it to "pending" / unticked.
  const parentEl = box.querySelector(`input[name="parent-${rowNumber}"]:checked`);
  const parent = parentEl ? parentEl.value : (row.parentAccepted ? "accepted" : row.parentRejected ? "rejected" : "pending");
  const tutorEl = box.querySelector(`input[name="tutor-${rowNumber}"]:checked`);
  const tutor = tutorEl ? tutorEl.value : (row.tutorAccepted ? "accepted" : row.tutorRejected ? "rejected" : "pending");
  const completedEl = box.querySelector("[data-rfield='completed']");
  const completed = completedEl ? completedEl.checked : !!row.classesCompleted;

  if (completed && !(parent === "accepted" && tutor === "accepted")) {
    if (!window.confirm("Classes Completed is ticked but parent and tutor have not both accepted. Save anyway?")) return;
  }

  const changes = {
    "Demo Date": date,
    "Demo Time": time,
    "Parent Accepted": parent === "accepted",
    "Parent Rejected": parent === "rejected",
    "Tutor Accepted": tutor === "accepted",
    "Tutor Rejected": tutor === "rejected",
    "Classes Completed": completed
  };

  await save({ action: "adminUpdateDemoRow", rowNumber, demoId, tutorId: row.tutorId, changes }, button);

}


/************************************************************
 * STATES
 ************************************************************/

/* =====================================================================
   STATUS + COLOURS
   Works out each tuition/tutor's status (Finding Tutor, Running, ...) and
   the colour strip shown on the card.
   ===================================================================== */

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
  open: "Open", schedule: "Schedule Demo", scheduled: "Demo Scheduled",
  processing: "Processing", running: "Running", completed: "Completed",
  declined: "Declined", terminated: "Closed"
};

// Short codes are what's actually stored (data-day / Class Days); the
// full names are only ever shown on the chip itself.
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_LABELS = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday"
};

// A brand-new class defaults to Mon/Wed/Fri until the admin changes it -
// both the chips shown and what a toggle actually starts from, so the
// two never disagree about what's "currently selected".
const DEFAULT_CLASS_DAYS = ["Mon", "Wed", "Fri"];

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
  new: "Finding Tutors", schedule: "Schedule Demo", scheduled: "Demo Scheduled",
  running: "Running", completed: "Completed", terminated: "Closed"
};

// The Tuitions card's own status only ever shows one of these four -
// "Schedule Demo" / "Demo Scheduled" are a per-tutor-applied state, shown
// on that tutor's own card instead (see ROW_LABELS / tutorRowCard).
function tuitionRailTone(state) {
  return (state === "running" || state === "completed" || state === "terminated") ? state : "new";
}

const TUITION_RAIL_LABELS = {
  new: "Finding Tutor", running: "Running", completed: "Completed", terminated: "Closed"
};


/************************************************************
 * RENDER
 ************************************************************/

function renderAll() {
  renderStats();
  renderTuitions();
  renderTutors();
  renderStudents();
  renderPayments();
  renderSubscriptions();
  renderEmployees();
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

// Today as "dd/mm/yyyy" and "yyyy-mm-dd", to compare with Demo Date.
function isToday(text) {
  const iso = toDateInput(text);
  if (!iso) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return iso === today;
}

/* =====================================================================
   SUMMARY NUMBERS, BOXES AND CARD PIECES
   The counters at the top and the small building blocks every card is
   made from (info lines, field boxes, edit buttons, avatar badges).
   ===================================================================== */

function renderStats() {

  const groups = demoGroups();
  const tutors = STATE.data.tutors.rows;
  const count = s => groups.filter(g => groupState(g) === s).length;

  const todaysDemos = (STATE.data.demos || []).filter(r => {
    const s = rowState(r);
    return r.hasTutor && isToday(r.demoDate) && s !== "declined" && s !== "terminated";
  }).length;

  const stats = [
    ["Finding Tutors", count("new"), "lime", "tuitions", "new"],
    ["Demo to Schedule", count("schedule"), "violet", "tuitions", "schedule"],
    ["Running Classes", count("running"), "green", "tuitions", "running"],
    ["Tutor Verification Pending", tutors.filter(t => statusGroup(t.values["Verification Status"]) === "pending").length, "amber", "tutors", "pending"],
    ["Classes Completed", count("completed"), "grey", "tuitions", "completed"],
    ["Closed", count("terminated"), "red", "tuitions", "terminated"],
    ["Today's Demo", todaysDemos, "violet", "tuitions", "today"],
    ["Verified Tutors", tutors.filter(t => statusGroup(t.values["Verification Status"]) === "verified").length, "green", "tutors", "verified"]
  ];

  $("adminStats").innerHTML = stats.map(([label, value, tone, tab, filter]) => `
    <button class="admin-stat" type="button" data-tone="${tone}" data-go="${tab}" data-filter="${filter}">
      <span class="admin-stat-value">${esc(value)}</span>
      <span class="admin-stat-label">${esc(label)}</span>
    </button>
  `).join("");

}


/* ---------------- data boxes ----------------
   Every value sits in a box with its name on the top border.
   View mode: read-only.  Edit mode: editable fields turn lime. */

function box(label, value, opts = {}) {

  const editable = !!opts.editable;
  const attr = opts.attr || "";
  const cls = `admin-box${editable ? " is-edit" : ""}${opts.wide ? " wide" : ""}`;

  let control;

  if (opts.options && editable) {
    const current = opts.options.find(o => lower(o) === lower(value) || (lower(o) === "home" && lower(value) === "offline")) || opts.options[0];
    const labels = opts.optionLabels || {};
    control = `<select ${attr}>${opts.options.map(o => `<option value="${esc(o)}"${o === current ? " selected" : ""}>${esc(labels[o] || o)}</option>`).join("")}</select>`;
  } else if (opts.link && /^https?:\/\//i.test(value)) {
    control = `<a class="admin-box-link" href="${esc(value)}" target="_blank" rel="noopener">Open ${esc(label)}</a>`;
  } else if (opts.multiline) {
    control = `<textarea ${attr} rows="2"${editable ? "" : " readonly"}>${esc(value)}</textarea>`;
  } else {
    control = `<input ${attr} type="${opts.type || "text"}" value="${esc(value)}"${editable ? "" : " readonly"}${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ""}>`;
  }

  return `<label class="${cls}">${control}<span>${esc(label)}</span></label>`;

}

const STUDENT_PICKS = {
  "Gender": ["Male", "Female"],
  "Board": ["CBSE", "ICSE", "IGCSE", "State Board"],
};

const STUDENT_FIELD_ORDER = ["Timestamp", "Student ID", "Terms Accepted", "Parents Name", "Student Name", "Gender",
  "Phone", "WhatsApp", "Email", "Class", "Board", "School", "City", "Address", "PIN Code"];

function fieldsBoxes(kind, record, editing) {

  const data = STATE.data[kind];
  const readOnly = (data.readOnly || []).map(lower);

  // A Student card shows its details in fixed rows of three:
  //   Timestamp | Student ID | Terms Accepted
  //   Parents Name | Student Name | Gender
  //   Phone | WhatsApp | Email
  //   Class | Board | School
  //   City | Address | PIN Code
  const headers = kind === "students"
    ? [...STUDENT_FIELD_ORDER.filter(h => data.headers.includes(h)), ...data.headers.filter(h => !STUDENT_FIELD_ORDER.includes(h))]
    : data.headers;

  return `
    <div class="admin-boxes${kind === "students" ? " admin-boxes-student" : ""}">
      ${headers.map(h => {

        const value = record.values[h] || "";
        const canEdit = editing && !readOnly.includes(lower(h));
        const long = kind === "students"
          ? /^address$/i.test(h)
          : value.length > 48 || /address|subject you teach|classes you teach|boards you teach|languages|special/i.test(h);

        if (lower(h) === "verification status") {
          return box(h, value || "Pending for Verification", {
            editable: canEdit,
            options: STATE.data.verificationValues,
            attr: canEdit ? `data-field="${esc(h)}"` : ""
          });
        }

        // Students: Gender and Board are pick-lists while editing. A value that
        // isn't in the list (e.g. "IB") stays selectable so it is never lost.
        const picks = kind === "students" && canEdit ? STUDENT_PICKS[h] : null;
        if (picks) {
          const options = [...(value ? [] : [""]), ...(value && !picks.includes(value) ? [value] : []), ...picks];
          return box(h, value, {
            editable: true,
            options,
            optionLabels: { "": "Select" },
            attr: `data-field="${esc(h)}"`
          });
        }

        return box(h, value, {
          editable: canEdit,
          wide: long && kind !== "students",
          multiline: long,
          link: LINK_FIELDS.includes(h),
          attr: canEdit ? `data-field="${esc(h)}"` : ""
        });

      }).join("")}
    </div>
  `;

}

// "Edit details" (full width) / "Save changes" + "Cancel" joined.
function editButtons(key, editing, saveAction, editLabel) {

  return editing
    ? `<div class="admin-pair">
         <button class="admin-primary" data-action="${saveAction}" type="button">Save changes</button>
         <button class="admin-ghost" data-action="cancel" data-key="${esc(key)}" type="button">Cancel</button>
       </div>`
    : `<button class="admin-ghost admin-wide" data-action="edit" data-key="${esc(key)}" type="button">${esc(editLabel)}</button>`;

}

// Bold values in a row, split by "|" (empty ones left out).
function infoLine(values, separator = "|") {
  const parts = values.map(v => String(v == null ? "" : v).trim()).filter(Boolean);
  if (!parts.length) return "";
  return `<div class="admin-info">${parts.map(v => `<b>${esc(v)}</b>`).join(`<i aria-hidden="true"> ${esc(separator)} </i>`)}</div>`;
}

// The summary of a collapsed card, in two layers with a thin gap:
//   top    - bold values, coloured by the card's status (tone)
//   bottom - small text, light grey (left out when empty)
// Light colour, no border, square corners.
function highlight(boldValues, smallText, separator, tone, splitSmall) {
  const line = infoLine(boldValues, separator);
  const small = String(smallText || "").trim();
  return `<div class="admin-hl">
    <div class="admin-hl-top" data-tone="${esc(tone || "")}">${line}</div>
    ${small ? `<p class="admin-hl-small${splitSmall ? " admin-hl-small-split" : ""}">${small}</p>` : ""}
  </div>`;
}

// Left: a short status/info snippet. Right: a date/time, no label.
function timeSplitLine(leftText, whenIso) {
  const left = String(leftText || "").trim();
  const when = recordedAt(whenIso);
  if (!left && !when) return "";
  return `<span class="admin-hl-small-text">${esc(left)}</span><span class="admin-hl-small-right">${esc(when)}</span>`;
}

// "Address, City - PIN" without repeating the city.
function fullAddress(address, city, pin) {
  const a = String(address || "").trim();
  const c = String(city || "").trim();
  const p = String(pin || "").trim();
  let text = a;
  if (c && !lower(a).includes(lower(c))) text = text ? `${text}, ${c}` : c;
  if (p) text = text ? `${text} - ${p}` : p;
  return text;
}

function note(text) {
  return `<p class="admin-note">${esc(text)}</p>`;
}

// Sum of everything actually paid in (payouts don't count) against one
// subscription - shared by the avatar badge and the Subscription card's
// own "Dues" field, so both always agree.
function subscriptionPaidAmount(subscriptionId) {
  return (STATE.payments || [])
    .filter(p => p.subscription_id === subscriptionId && p.transaction_type !== "payout")
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
}

// Which subscription "represents" a student/tutor for the avatar badge -
// their active one, or their most recent if none is active.
function subscriptionFor(partyType, partyId) {
  if (!partyId) return null;
  const subs = (STATE.subscriptions || []).filter(s =>
    partyType === "student" ? s.student_id === partyId : s.tutor_id === partyId
  );
  if (!subs.length) return null;
  return subs.find(s => s.status === "active") || subs[0];
}

// A small verified-style badge on the avatar circle - two rounded
// squares overlapped 45deg (the classic 8-point seal shape) with a
// checkmark - coloured by how much of the party's current subscription
// has been paid: green (fully paid / exempted), orange (partially
// paid), red (nothing paid). Nothing is shown if they have no
// subscription at all. Only visible to roles that can see Payments/
// Subscriptions, since STATE.subscriptions/STATE.payments are empty
// otherwise.
// A Tuition's student/tutor initials circle, which opens (and wave-
// highlights) that person's own card on the Students/Tutors tab - a
// plain circle when there's no such card to go to.
// The tutor's uploaded photo as a round image over the letters ("" when there
// is none or this employee may not see tutor details). The link is made by
// the admin server function, so it only exists for allowed employees.
function tutorPhotoHtml(id) {
  const row = id && TUTOR_BY_ID[id];
  const url = row && row.values ? String(row.values["Profile Image"] || "") : "";
  return /^https?:\/\//i.test(url)
    ? `<img class="photo-fill" src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()">`
    : "";
}

/* ---- Tutors tab: tap a tutor's picture -> his tuition record ----
   A small box rises from the top of the picture:
     a bar of Accepted (Running + Completed) vs Rejected after a demo,
     then Completed, Running, Demo Given, Rejected (After Demo), Applied.
   Counted from every tuition this tutor applied to. */

function dmyToDate(text) {
  const m = String(text || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

function tutorTuitionStats(tutorId) {
  const tutor = TUTOR_BY_ID[tutorId];
  const key = tutor ? tutorKey(tutor) : "";
  const rows = (STATE.data.demos || []).filter(r => r.hasTutor &&
    (r.tutorId === tutorId || (!r.tutorId && key && r.mobileKey === key)));
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const s = { applied: rows.length, demoGiven: 0, running: 0, completed: 0, rejectedAfterDemo: 0 };
  rows.forEach(r => {
    const state = rowState(r);
    const hadDemo = !!(r.demoDate || r.demoTime);
    const demoDay = dmyToDate(r.demoDate);
    if (state === "running") s.running++;
    if (state === "completed") s.completed++;
    if (state === "declined" && hadDemo) s.rejectedAfterDemo++;
    // a demo counts as given once its day has come (or the tuition went past it)
    if (hadDemo && (["running", "completed", "declined", "processing"].includes(state) || (demoDay && demoDay <= today))) s.demoGiven++;
  });
  s.accepted = s.running + s.completed;
  return s;
}

function closeTutorStats() {
  const pop = document.getElementById("tutorStatsPop");
  if (pop) pop.remove();
  document.querySelectorAll('[data-action="tutor-stats"][aria-expanded="true"]').forEach(b => b.setAttribute("aria-expanded", "false"));
}

function toggleTutorStats(button, tutorId) {

  const wasOpenHere = button.getAttribute("aria-expanded") === "true";
  closeTutorStats();
  if (wasOpenHere) return;

  const s = tutorTuitionStats(tutorId);
  const decided = s.accepted + s.rejectedAfterDemo;
  const okPct = decided ? Math.round((s.accepted / decided) * 100) : 0;
  const noPct = decided ? 100 - okPct : 0;
  const tutor = TUTOR_BY_ID[tutorId];
  const name = (tutor && tutor.values["Full Name"]) || tutorId;

  const pop = document.createElement("div");
  pop.id = "tutorStatsPop";
  pop.className = "tutor-stats-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", `Tuition record of ${name}`);
  pop.innerHTML = `
    <div class="tsp-bar${decided ? "" : " is-empty"}" title="Accepted ${okPct}% · Rejected after demo ${noPct}%">
      ${decided ? `<span class="tsp-ok" style="width:${okPct}%"></span><span class="tsp-no" style="width:${noPct}%"></span>` : ""}
    </div>
    <div class="tsp-legend">
      <span class="tsp-ok-text">${decided ? okPct + "%" : "-"}</span>
      <span class="tsp-no-text">${decided ? noPct + "%" : "-"}</span>
    </div>
    <dl class="tsp-list">
      <div><dt>Completed</dt><dd>${s.completed}</dd></div>
      <div><dt>Running</dt><dd>${s.running}</dd></div>
      <div><dt>Demo Given</dt><dd>${s.demoGiven}</dd></div>
      <div><dt>Rejected (After Demo)</dt><dd>${s.rejectedAfterDemo}</dd></div>
      <div><dt>Applied</dt><dd>${s.applied}</dd></div>
    </dl>
    <span class="tsp-arrow" aria-hidden="true"></span>`;
  document.body.appendChild(pop);
  button.setAttribute("aria-expanded", "true");

  // place it just above the picture (below it if there is no room above)
  const r = button.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const centre = r.left + r.width / 2;
  const left = Math.min(Math.max(12, centre - 34), window.innerWidth - w - 12);
  const above = r.top - h - 12 >= 8;
  pop.style.left = (left + window.scrollX) + "px";
  pop.style.top = ((above ? r.top - h - 12 : r.bottom + 12) + window.scrollY) + "px";
  pop.classList.add(above ? "is-above" : "is-below");
  pop.style.setProperty("--arrow-x", (centre - left) + "px");
  requestAnimationFrame(() => pop.classList.add("is-shown"));

}

// close it: a click anywhere else, Esc, or a page change
document.addEventListener("click", (event) => {
  if (!document.getElementById("tutorStatsPop")) return;
  if (event.target.closest("#tutorStatsPop, [data-action='tutor-stats']")) return;
  closeTutorStats();
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeTutorStats(); });
window.addEventListener("resize", closeTutorStats);

function profileAvatar(kind, id, letters, badgeHtml) {
  const exists = id && (kind === "students" ? STUDENT_BY_ID : TUTOR_BY_ID)[id];
  const photo = kind === "tutors" ? tutorPhotoHtml(id) : "";
  return exists
    ? `<button type="button" class="admin-avatar admin-avatar-link" data-action="go-to-card" data-tab="${kind}" data-key="${esc(kind + ":" + id)}" title="Open profile">${esc(letters)}${photo}${badgeHtml}</button>`
    : `<div class="admin-avatar">${esc(letters)}${photo}${badgeHtml}</div>`;
}

function subscriptionPayBadge(partyType, partyId) {

  const sub = subscriptionFor(partyType, partyId);
  if (!sub) return "";

  const due = Number(sub.amount || 0);
  const paid = subscriptionPaidAmount(sub.id);

  const tone = due <= 0 || paid >= due ? "paid" : paid > 0 ? "partial" : "unpaid";
  const title = due <= 0
    ? "Subscription exempted / fully covered"
    : `Subscription ${tone === "paid" ? "fully paid" : tone === "partial" ? "partially paid" : "not paid"} (₹${paid.toLocaleString("en-IN")} / ₹${due.toLocaleString("en-IN")})`;

  return `
    <span class="admin-sub-badge" data-tone="${tone}" title="${esc(title)}">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path class="badge-tick" d="M10.54 16.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/>
        <path fill-rule="evenodd" clip-rule="evenodd" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/>
      </svg>
    </span>`;

}

// Only ever two buttons, Accept and Reject - their label just says
// which side is already chosen. Pending: Accept | Reject, both live.
// Accepted: Verified (disabled) | Suspend (live - same effect as
// Reject, sets Verification Status back to Rejected). Rejected:
// Accept (live) | Rejected (disabled) - so there's always exactly one
// live action to move a tutor the other way.
function verifyButtonsHtml(status) {
  const group = statusGroup(status);
  const approveChosen = group === "verified";
  const rejectChosen = group === "rejected";
  const rejectLabel = approveChosen ? "Suspend" : rejectChosen ? "Rejected" : "Reject";
  const approveLabel = approveChosen ? "Verified" : "Accept";
  return `
    <div class="admin-vbtns">
      <button class="admin-vbtn v-reject" type="button" data-action="verify" data-value="Rejected"${rejectChosen ? " disabled" : ""}>${rejectLabel}</button>
      <button class="admin-vbtn v-approve" type="button" data-action="verify" data-value="Verified"${approveChosen ? " disabled" : ""}>${approveLabel}</button>
    </div>
  `;
}

function recordCard(kind, record, opts) {

  const key = `${kind}:${record.id}`;
  const open = STATE.open.has(key);
  const editing = STATE.editing.has(key);

  return `
    <article class="admin-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}${kind === "students" && studentTags(record).includes("blocked") ? " is-blocked" : ""}" data-tone="${opts.tone || ""}"
      data-box data-kind="${kind}" data-row="${record.rowNumber}" data-id="${esc(record.id)}" data-key="${esc(key)}"${kind === "students" ? ` data-tags="${studentTags(record).join(" ")}"` : ""}>

      <div class="admin-card-head" data-toggle="${esc(key)}">
        ${kind === "tutors"
          ? `<button type="button" class="admin-avatar admin-avatar-link" data-action="tutor-stats" data-id="${esc(record.id)}" title="Tuition record" aria-haspopup="dialog">${esc(initials(opts.name, "T"))}${tutorPhotoHtml(record.id)}${subscriptionPayBadge("tutor", record.id)}</button>`
          : `<div class="admin-avatar">${esc(initials(opts.name, "S"))}${subscriptionPayBadge("student", record.id)}</div>`}
        <div class="admin-card-title">
          ${opts.titleHtml || `<strong>${esc(opts.name || record.id)}</strong><small>${esc(opts.sub)}</small>`}
        </div>
        ${kind === "students" ? studentIconsHtml(record, key) : `<span class="admin-caret" aria-hidden="true"></span>`}
        ${opts.verifyStatus ? verifyButtonsHtml(opts.verifyStatus) : ""}
        ${opts.pill ? `<span class="admin-status-rail admin-rail-sub" data-tone="${opts.tone}" tabindex="-1">${esc(opts.pill)}</span>` : ""}
      </div>

      <div class="admin-card-body">
        ${fieldsBoxes(kind, record, editing)}
        ${opts.extra || ""}
        ${(kind === "tutors" ? myPerms().tutorsEdit : (myPerms().studentsEdit && !studentTags(record).includes("blocked"))) ? editButtons(key, editing, "save-record", "Edit Details") : ""}
        ${editing && kind === "students" ? note("Changing the Email moves this student to that login. Brothers / sisters share one Email and Phone.") : ""}
        ${editing && kind === "tutors" ? note("Changing the Mobile Number also moves this tutor's tuitions to the new number.") : ""}
      </div>

    </article>
  `;

}


/* ---------------- search (every field, every word) ----------------
   Every search box on this panel is a "chip" search: pressing Space
   turns whatever was just typed into a small removable tag, and the
   filter is every tag plus whatever's still being typed - so it
   narrows down one word at a time, same AND logic as before, just
   now visible and removable one word at a time instead of hidden
   inside a single line of text. */

/* =====================================================================
   SEARCH
   Typing in the search bar or tapping a chip filters the cards by every
   word in every field.
   ===================================================================== */

// Everything a card shows - its own text, every box's value (boxes are
// inputs, so their values aren't part of the text), and the picked
// option of any dropdown - so a search matches whatever is on the card,
// wherever on it, collapsed or not.
function cardSearchText(el) {
  const parts = [el.textContent];
  el.querySelectorAll("input, textarea").forEach(i => {
    if (!["hidden", "radio", "checkbox"].includes(i.type)) parts.push(i.value);
  });
  el.querySelectorAll("select").forEach(sel => {
    const opt = sel.options[sel.selectedIndex];
    if (opt) parts.push(opt.text);
  });
  return parts.join(" ");
}

// Hides every card in the list that doesn't match that tab's search.
function applyTextSearch(listId, searchId, noMatchText) {
  const list = $(listId);
  const query = searchQueryFor(searchId);
  const items = [...list.children].filter(c => !c.classList.contains("admin-empty"));
  let shown = 0;
  items.forEach(c => {
    const ok = cardMatches(query, c);
    c.classList.toggle("hidden", !ok);
    if (ok) shown++;
  });
  if (items.length && !shown) list.insertAdjacentHTML("beforeend", empty(noMatchText));
  updateSearchBar(searchId, shown);
  paginateList(listId, query);
}

/* ---------------- pages (50 cards each) ----------------
   Every list shows 50 cards at a time, with Previous / Next under it.
   It pages whatever the search left showing, so the count and pages
   always follow the search; a new search (or filter) starts again on
   page 1, while a plain re-render after an edit stays on the same page. */
const PAGE_SIZE = 50;
const PAGES = {};   // listId -> { page, sig }

function pagedItems(list) {
  return [...list.children].filter(c => !c.classList.contains("admin-empty") && !c.classList.contains("hidden"));
}

function paginateList(listId, sig = "") {
  const list = $(listId);
  if (!list) return;
  list.dataset.paged = "1";
  const items = pagedItems(list);
  const fullSig = `${sig}|${items.length}`;
  const state = PAGES[listId] || (PAGES[listId] = { page: 1, sig: fullSig });
  if (state.sig !== fullSig) { state.page = 1; state.sig = fullSig; }
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  state.page = Math.min(Math.max(state.page, 1), pages);
  const from = (state.page - 1) * PAGE_SIZE;
  items.forEach((c, i) => c.classList.toggle("pg-hidden", i < from || i >= from + PAGE_SIZE));

  let pager = $(listId + "Pager");
  if (!pager) {
    list.insertAdjacentHTML("afterend", `<nav class="admin-pager" id="${listId}Pager" aria-label="Pages"></nav>`);
    pager = $(listId + "Pager");
    pager.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-page]");
      if (!btn || btn.disabled) return;
      PAGES[listId].page += Number(btn.dataset.page);
      paginateList(listId, PAGES[listId].sig.replace(/\|\d+$/, ""));
      list.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  pager.classList.toggle("hidden", items.length <= PAGE_SIZE);
  pager.innerHTML = items.length <= PAGE_SIZE ? "" : `
    <button type="button" class="admin-pager-btn" data-page="-1"${state.page === 1 ? " disabled" : ""}>‹ Previous</button>
    <span class="admin-pager-info">${from + 1}–${Math.min(from + PAGE_SIZE, items.length)} of ${items.length} · Page ${state.page} of ${pages}</span>
    <button type="button" class="admin-pager-btn" data-page="1"${state.page === pages ? " disabled" : ""}>Next ›</button>`;
}

// Before jumping to a card (goToCard / goToTuition): turn its list to the
// page the card is on.
function revealOnPage(el) {
  const list = el && el.closest("[data-paged]");
  if (!list || !PAGES[list.id]) return;
  const top = [...list.children].find(c => c === el || c.contains(el));
  const index = pagedItems(list).indexOf(top);
  if (index < 0) return;
  PAGES[list.id].page = Math.floor(index / PAGE_SIZE) + 1;
  paginateList(list.id, PAGES[list.id].sig.replace(/\|\d+$/, ""));
}

/* The search bar itself: just a search icon while nothing is applied;
   once a search word or a filter (other than All) is on, the number of
   matching cards and a cross (clears both) show on the right. */
const SEARCH_ICON_SVG = `<svg class="sb-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;
const CLEAR_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;

function searchFilterChip(searchId) {
  const tools = $(searchId) && $(searchId).closest(".admin-tools");
  return tools ? tools.querySelector(".admin-chips .admin-chip.active") : null;
}

function setupSearchBar(searchId) {
  const input = $(searchId);
  const wrap = input && input.closest(".admin-search-wrap");
  if (!wrap || wrap.dataset.bar) return;
  wrap.dataset.bar = "1";
  wrap.classList.add("sb");
  wrap.insertAdjacentHTML("afterbegin", SEARCH_ICON_SVG);
  wrap.insertAdjacentHTML("beforeend",
    `<span class="sb-count hidden" aria-live="polite"></span>
     <button type="button" class="sb-clear hidden" aria-label="Clear search and filter">${CLEAR_ICON_SVG}</button>`);
  wrap.querySelector(".sb-clear").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    input.value = "";
    clearSearchChips(searchId);
    const chip = searchFilterChip(searchId);
    const all = chip && chip.parentElement.querySelector('[data-value="all"]');
    if (all && chip !== all) all.click();          // re-renders with All
    else input.dispatchEvent(new Event("input"));   // re-renders the list
    input.focus();
  });
}

function updateSearchBar(searchId, shown) {
  setupSearchBar(searchId);
  const wrap = $(searchId).closest(".admin-search-wrap");
  if (!wrap) return;
  const chip = searchFilterChip(searchId);
  const applied = !!searchQueryFor(searchId).trim() || !!(chip && chip.dataset.value !== "all");
  const count = wrap.querySelector(".sb-count");
  count.textContent = `${shown} ${shown === 1 ? "Match" : "Matches"}`;
  count.classList.toggle("is-zero", shown === 0);
  count.classList.toggle("hidden", !applied);
  wrap.querySelector(".sb-clear").classList.toggle("hidden", !applied);
}

function matchesAll(query, text) {
  const words = lower(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = lower(text);
  return words.every(w => hay.includes(w));
}

function searchQueryFor(id) {
  const chips = SEARCH_CHIPS[id] || [];
  const el = $(id);
  return [...chips, el ? el.value : ""].join(" ");
}

// The chips row lives INSIDE the .admin-search-wrap label, right
// before the input, so it reads as part of the same search box
// rather than a separate row above it.
function renderSearchChips(id) {
  const input = $(id);
  const label = input && input.closest(".admin-search-wrap");
  if (!label) return;
  const chips = SEARCH_CHIPS[id] || [];
  let row = label.querySelector(`.admin-search-chips[data-chips-for="${id}"]`);
  if (!chips.length) {
    if (row) row.remove();
    label.classList.remove("has-chips");
    return;
  }
  label.classList.add("has-chips");
  if (!row) {
    row = document.createElement("span");
    row.className = "admin-search-chips";
    row.dataset.chipsFor = id;
    label.insertBefore(row, input);
  }
  row.innerHTML = chips.map((word, i) => `
    <span class="admin-search-chip">
      ${esc(word)}
      <button type="button" data-remove-chip="${i}" aria-label="Remove filter ${esc(word)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
      </button>
    </span>
  `).join("");
}

function clearSearchChips(id) {
  SEARCH_CHIPS[id] = [];
  renderSearchChips(id);
}

// Space commits the word just typed as a chip; clicking a chip's
// &times; removes it. Either way `onChange` re-runs the filter.
function wireChipSearch(id, onChange) {
  const input = $(id);
  const label = input.closest(".admin-search-wrap");
  SEARCH_CHIPS[id] = [];

  input.addEventListener("keydown", (event) => {

    if (event.key === " ") {
      event.preventDefault();
      const word = input.value.trim();
      if (!word) return;
      SEARCH_CHIPS[id].push(word);
      input.value = "";
      renderSearchChips(id);
      onChange();
      // Cursor stays in the box, right after the new chip, ready for
      // the next word - the chip render above doesn't touch the input
      // itself, but re-focus defensively in case anything stole it.
      input.focus();
      return;
    }

    // Backspace on an already-empty box removes the last chip instead
    // of doing nothing, same as Gmail/most tag inputs.
    if (event.key === "Backspace" && !input.value && SEARCH_CHIPS[id].length) {
      event.preventDefault();
      SEARCH_CHIPS[id].pop();
      renderSearchChips(id);
      onChange();
      input.focus();
    }

  });

  label.addEventListener("click", (event) => {
    const row = event.target.closest(`.admin-search-chips[data-chips-for="${id}"]`);
    const btn = event.target.closest("[data-remove-chip]");
    if (!row || !btn) return;
    SEARCH_CHIPS[id].splice(Number(btn.dataset.removeChip), 1);
    renderSearchChips(id);
    onChange();
    input.focus();
  });

  wireSearchSuggest(id, onChange);
}

/* Suggestions under a search box: as you type, the names, mobile /
   WhatsApp numbers, IDs ... of that section that match show below (same
   look as every other suggestion list); picking one adds it as a chip,
   same as typing it and pressing Space. */

// The records a section's search suggests from: { name, id, fields: [[tag, value]] }
function searchSuggestRecords(searchId) {
  const data = STATE.data || {};
  const v = (r, k) => (r.values && r.values[k]) || "";
  const studentRec = r => ({
    name: v(r, "Student Name") || r.id, id: r.id,
    fields: [["Name", v(r, "Student Name")], ["Parent", v(r, "Parents Name")], ["Mobile", v(r, "Phone")],
             ["WhatsApp", v(r, "WhatsApp")], ["Student ID", r.id], ["City", v(r, "City")], ["Email", v(r, "Email")]]
  });
  const tutorRec = r => ({
    name: v(r, "Full Name") || r.id, id: r.id,
    fields: [["Name", v(r, "Full Name")], ["Mobile", v(r, "Mobile Number")], ["WhatsApp", v(r, "WhatsApp Number")],
             ["Tutor ID", r.id], ["City", v(r, "City")], ["Email", v(r, "E-mail Address")]]
  });

  if (searchId === "studentSearch") return ((data.students && data.students.rows) || []).map(studentRec);
  if (searchId === "tutorSearch") return ((data.tutors && data.tutors.rows) || []).map(tutorRec);
  if (searchId === "tuitionSearch") {
    return demoGroups().map(g => {
      const student = STUDENT_BY_ID[g.first.studentId];
      const own = student ? studentRec(student) : { name: g.first.studentId, fields: [["Student ID", g.first.studentId]] };
      const row = activeRowFor(g);
      const tutor = row && row.tutorId ? DIR_TUTOR_BY_ID[row.tutorId] : null;
      return {
        name: own.name, id: g.demoId,
        fields: [["Demo ID", g.demoId], ["Subject", g.first.subject], ...own.fields,
                 ["Tutor ID", row && row.tutorId], ["Tutor", tutor && tutor.name]]
      };
    });
  }
  // Payments / Subscriptions / Ledger: every student, tutor and Demo ID
  const dir = STATE.directory || {};
  return [
    ...(dir.students || []).map(st => ({ name: st.name || st.id, id: st.id,
      fields: [["Name", st.name], ["Parent", st.parentsName], ["Mobile", st.mobile], ["WhatsApp", st.whatsapp], ["Student ID", st.id]] })),
    ...(dir.tutors || []).map(t => ({ name: t.name || t.id, id: t.id,
      fields: [["Tutor", t.name], ["Mobile", t.mobile], ["Tutor ID", t.id]] })),
    ...(dir.demos || []).map(d => ({ name: (DIR_STUDENT_BY_ID[d.studentId] || {}).name || d.studentId, id: d.demoId,
      fields: [["Demo ID", d.demoId], ["Subject", d.subject]] })),
  ];
}

function searchSuggestions(searchId, text) {
  const q = lower(text.trim());
  const digits = text.replace(/\D/g, "");
  if (q.length < 2) return [];
  const seen = new Set();
  const out = [];
  for (const rec of searchSuggestRecords(searchId)) {
    for (const [tag, raw] of rec.fields) {
      const value = String(raw || "").trim();
      if (!value || value.includes("*")) continue;   // hidden numbers
      const hit = lower(value).includes(q) ||
        (digits.length >= 3 && digits.length === q.replace(/[\s+-]/g, "").length && value.replace(/\D/g, "").includes(digits));
      if (!hit) continue;
      // the same number as Mobile and WhatsApp: one row, both tags
      const key = rec.id + "|" + lower(value);
      if (seen.has(key)) {
        const same = out.find(o => o.key === key);
        if (same && !same.tag.includes(tag)) same.tag += " · " + tag;
        continue;
      }
      seen.add(key);
      out.push({ key, value, tag, sub: [rec.name !== value ? rec.name : "", rec.id !== value ? rec.id : ""] });
      if (out.length >= 8) return out;
    }
  }
  return out;
}

function wireSearchSuggest(id, onChange) {

  const input = $(id);
  const label = input.closest(".admin-search-wrap");
  // box + list share one holder, so the list can wrap round the box
  const holder = document.createElement("div");
  holder.className = "search-holder";
  label.before(holder);
  holder.appendChild(label);
  const panel = document.createElement("div");
  panel.className = "admin-suggest search-suggest hidden";
  holder.appendChild(panel);
  let active = -1;

  const hide = () => { panel.classList.add("hidden"); active = -1; };
  const items = () => [...panel.querySelectorAll("[data-pick-chip]")];
  const mark = () => items().forEach((el, i) => el.classList.toggle("is-active", i === active));

  const show = () => {
    const list = searchSuggestions(id, input.value);
    if (!list.length) { hide(); return; }
    active = -1;
    panel.innerHTML = list.map(item => suggestItem({
      title: item.value, sub: item.sub, tag: item.tag, attrs: `data-pick-chip="${esc(item.value)}"`
    })).join("");
    panel.classList.remove("hidden");
  };

  const pick = (value) => {
    SEARCH_CHIPS[id].push(value);
    input.value = "";
    hide();
    renderSearchChips(id);
    onChange();
    input.focus();
  };

  input.addEventListener("input", show);
  input.addEventListener("keydown", (event) => {
    if (event.key === " ") { hide(); return; }       // Space makes its own chip
    if (panel.classList.contains("hidden")) return;
    const list = items();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
      mark();
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      pick(list[active].dataset.pickChip);
    } else if (event.key === "Escape") hide();
  });

  panel.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const btn = event.target.closest("[data-pick-chip]");
    if (btn) pick(btn.dataset.pickChip);
  });

  document.addEventListener("click", (event) => { if (!holder.contains(event.target)) hide(); });

}

/* Every suggestion list opens wrapped round its own box (like a browser's
   address bar): the list's panel starts just above the box, the box sits
   on top of it, and the matches follow underneath - one rounded panel.
   Whenever a list opens, its panel learns how tall the box is. */
function watchSuggestionLists() {
  const fit = (panel) => {
    const host = panel.parentElement;
    const anchor = host && host.firstElementChild;
    if (!anchor || anchor === panel) return;
    // (only when missing: re-adding a class still counts as a change
    // and would wake this observer again, forever)
    if (!host.classList.contains("sg-host")) host.classList.add("sg-host");
    if (!panel.classList.contains("sg-wrap")) panel.classList.add("sg-wrap");
    panel.style.setProperty("--anchor-h", anchor.offsetHeight + "px");
  };
  new MutationObserver(list => list.forEach(m => {
    const el = m.target;
    if (el.classList && el.classList.contains("admin-suggest") && !el.classList.contains("admin-pick") &&
        !el.classList.contains("hidden")) fit(el);
  })).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
}


/* ---------------- tutors ---------------- */

function renderTutors() {

  const rows = STATE.data.tutors.rows
    .filter(r => STATE.tutorFilter === "all" || statusGroup(r.values["Verification Status"]) === STATE.tutorFilter)
    .slice()
    .sort((a, b) => {
      const order = { pending: 0, rejected: 1, verified: 2 };
      return (order[statusGroup(a.values["Verification Status"])] - order[statusGroup(b.values["Verification Status"])]) ||
        (b.rowNumber - a.rowNumber);
    });

  $("tutorList").innerHTML = rows.length ? rows.map(r => {
    const status = r.values["Verification Status"] || "Pending for Verification";
    const v = f => r.values[f] || "";
    return recordCard("tutors", r, {
      name: v("Full Name"),
      // One line, 8 equal columns: Name | Gender | Mobile | WhatsApp |
      // Tutor ID | Subjects | Address (no PIN) | Pin Code - text too
      // long for its column is cut with "..." (see equalRow).
      titleHtml: equalRow([
        v("Full Name") || r.id, v("Gender"), v("Mobile Number"), v("WhatsApp Number"),
        r.id, v("Subject You Teach"), fullAddress(v("Present Address"), v("City"), ""), v("Pin Code")
      ]),
      // Only the Accept/Reject buttons say the status; the read-only
      // rail is just a fallback for roles that can't verify.
      pill: myPerms().tutorsVerify ? "" : status,
      tone: statusGroup(status),
      // Accept/Reject while Pending, Accept/Suspend once Verified,
      // Accept/Reject again if Rejected - always on the right of the tab.
      verifyStatus: myPerms().tutorsVerify ? status : ""
    });
  }).join("") : empty("No tutors match.");

  $("tutorHeader").innerHTML = rows.length ? tutorHeaderCard() : "";

  applyTextSearch("tutorList", "tutorSearch", "No tutors match.");

}


/* ---------------- students ---------------- */

// The row shown on a collapsed Student card (and so what every column's width
// is measured from).
function studentSummaryCells(r) {
  return [
    r.values["Student Name"] || r.id, r.values["Gender"], r.values["Class"], r.values["Board"],
    r.values["Phone"], r.values["WhatsApp"], r.id,
    fullAddress(r.values["Address"], r.values["City"], ""), r.values["PIN Code"]
  ];
}

// Until the widths are measured the nine columns are equal.
const STUDENT_COLUMNS = "var(--stu-cols, repeat(9, minmax(0, 1fr)))";
const STUDENT_COLUMN_LABELS = ["Name", "Gender", "Class", "Board", "Mobile", "WhatsApp", "Student ID", "Address", "Pin Code"];

/* Column widths of the Students list. Every student's value is measured, so
   each column knows how wide its widest card needs it. The row's width is
   then shared fairly: a column needing less than an equal share takes only
   what it needs, and the space that frees up goes to the columns that need
   more (Name, Address...). A column still too narrow is cut with "...". If
   nobody needs more, what is left is shared equally. */
let measureCtx = null;

function fitStudentColumns() {
  const list = $("studentList");
  const first = list && list.querySelector(".eq-grid");
  const rows = STATE.data && STATE.data.students && STATE.data.students.rows;
  if (!first || !rows || !rows.length) return;
  const width = first.getBoundingClientRect().width;
  if (!(width > 0)) return;

  const sample = first.querySelector(".ledger-cell");
  const style = getComputedStyle(sample);
  measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
  measureCtx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const pad = 6 + 6 + 2;                                    // cell padding + divider + a hair

  const n = STUDENT_COLUMN_LABELS.length;
  const need = STUDENT_COLUMN_LABELS.map((label) => {       // the header label counts too
    measureCtx.font = "800 11px " + style.fontFamily;
    return measureCtx.measureText(label.toUpperCase()).width + label.length * 0.44 + pad;
  });
  measureCtx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  rows.forEach(r => studentSummaryCells(r).forEach((c, i) => {
    const text = (c === undefined || c === null || c === "") ? "-" : String(c);
    const w = measureCtx.measureText(text).width + pad;
    if (w > need[i]) need[i] = w;
  }));

  // fair sharing: give every column min(need, equal share of what is left)
  const give = new Array(n).fill(0);
  let open = need.map((_, i) => i);
  let left = width;
  while (open.length && left > 0.5) {
    const share = left / open.length;
    const done = open.filter(i => need[i] - give[i] <= share);
    if (!done.length) { open.forEach(i => { give[i] += share; }); left = 0; break; }
    done.forEach(i => { left -= need[i] - give[i]; give[i] = need[i]; });
    open = open.filter(i => !done.includes(i));
  }
  if (left > 0.5) give.forEach((_, i) => { give[i] += left / n; });   // nobody needs more: share equally

  const template = give.map(g => `minmax(0, ${Math.max(g, 1).toFixed(1)}fr)`).join(" ");
  $("tab-students").style.setProperty("--stu-cols", template);
}

let fitTimer = 0;
window.addEventListener("resize", () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitStudentColumns, 120); });

function renderStudents() {

  const groups = demoGroups();

  const rows = STATE.data.students.rows.slice().reverse();

  $("studentList").innerHTML = rows.length ? rows.map(r => {

    const mine = groups.filter(g => g.first.studentId === r.id);

    const extra = mine.length ? `
      <div class="admin-mini-list">
        <span class="admin-mini-title">Tuitions</span>
        ${mine.map(g => {
          const tone = tuitionRailTone(groupState(g));
          return `<button type="button" class="admin-pill admin-pill-link" data-tone="${esc(tone)}" data-action="go-to-tuition" data-demo="${esc(g.demoId)}">${esc(g.first.subject)} · ${esc(TUITION_RAIL_LABELS[tone])}</button>`;
        }).join("")}
      </div>` : "";

    return recordCard("students", r, {
      name: r.values["Student Name"],
      // One line, 9 equal columns: Name | Gender | Class | Board |
      // Mobile | WhatsApp | Student ID | Address (no PIN) | PIN Code -
      // text too long for its column is cut with "..." (see equalRow).
      titleHtml: equalRow(studentSummaryCells(r), STUDENT_COLUMNS),
      tone: "neutral",
      extra
    });

  }).join("") : empty("No students match.");

  $("studentHeader").innerHTML = rows.length ? studentHeaderCard() : "";

  applyTextSearch("studentList", "studentSearch", "No students match.");

  fitStudentColumns();
  requestAnimationFrame(fitStudentColumns);       // again once the tab is on screen

}


/* ---------------- payments ---------------- */

function renderPayments() {

  if (!$("paymentList")) return;

  const groups = demoGroups();
  const context = {};

  groups.forEach(g => {
    const student = STUDENT_BY_ID[g.first.studentId];
    context[g.demoId] = {
      studentName: student ? student.values["Student Name"] : g.first.studentId,
      subject: g.first.subject
    };
  });

  const rows = STATE.payments || [];

  $("paymentList").innerHTML = rows.length
    ? rows.map(p => paymentCard(p, context[p.demo_id] || {})).join("")
    : empty("No payments recorded yet.");

  $("paymentHeader").innerHTML = rows.length ? paymentHeaderCard() : "";

  applyTextSearch("paymentList", "paymentSearch", "No payments match.");

}

// The Tuition a Collection/Payout was made against: its own Demo ID, or
// (an older payout saved without one) the tutor's live Tuition.
function tuitionForPayment(p) {
  const byDemo = p.demo_id ? demoGroups().find(x => x.demoId === p.demo_id) : null;
  if (byDemo) return byDemo;
  if (p.transaction_type !== "payout") return null;
  return demoGroups().find(x => { const r = activeRowFor(x); return r && r.tutorId === p.tutor_id; }) || null;
}

// Dues on this Tuition's own fee just before payment p (same payment
// kind only), and the fee itself - null when there's no live Tuition.
function tuitionPaymentDues(p) {
  const g = tuitionForPayment(p);
  const activeRow = g ? activeRowFor(g) : null;
  if (!activeRow) return null;
  const m = classMoney(g, activeRow);
  const isPayout = p.transaction_type === "payout";
  const same = (STATE.payments || []).filter(o => isPayout
    ? o.transaction_type === "payout" && o.tutor_id === p.tutor_id && (!o.demo_id || o.demo_id === g.demoId)
    : o.transaction_type === "collection" && o.demo_id === p.demo_id);
  const before = same.filter(o => o.payment_date < p.payment_date || (o.payment_date === p.payment_date && o.id < p.id))
    .reduce((sum, o) => sum + num(o.amount), 0);
  const total = isPayout ? m.tutorTotalAmount : m.studentTotalAmount;
  const duesBefore = Math.max(total - (isPayout ? m.tutorAdvance : 0) - before, 0);
  return { g, activeRow, total, duesBefore };
}

// Total of `list` up to and including payment p, in the order the
// payments were made.
function paidUpTo(list, p) {
  return list
    .filter(o => o.payment_date < p.payment_date || (o.payment_date === p.payment_date && o.id <= p.id))
    .reduce((sum, o) => sum + num(o.amount), 0);
}

/* =====================================================================
   PAYMENT CARDS
   How much a student/tutor owes, how much was paid, and the card layout
   for normal, subscription and agency-charge payments.
   ===================================================================== */

// Who a payment is from (or, for a payout, to), what it was for, and
// the dues still left right after it - null when there's nothing to
// measure it against (e.g. a payout to a tutor with no live Tuition).
function paymentSummary(p) {

  const all = STATE.payments || [];
  const groupFor = demoId => demoGroups().find(x => x.demoId === demoId);
  let kind, partyId, purpose, dues = null, target = null, studentId = "", tutorId = "", demoId = p.demo_id || "";

  if (p.subscription_id) {
    const sub = (STATE.subscriptions || []).find(x => x.id === p.subscription_id) || {};
    kind = sub.student_id ? "Student" : "Tutor";
    partyId = sub.student_id || sub.tutor_id || "";
    purpose = "Subscription";
    target = { action: "go-to-card", tab: "subscriptions", key: "subscription:" + p.subscription_id };
    const paid = paidUpTo(all.filter(o => o.subscription_id === p.subscription_id && o.transaction_type !== "payout"), p);
    dues = Math.max(num(sub.amount) - paid, 0);
    studentId = sub.student_id || "";
    tutorId = sub.tutor_id || "";

  } else if (p.transaction_type === "agency_charge") {
    const g = groupFor(p.demo_id);
    const activeRow = g ? activeRowFor(g) : null;
    kind = p.tutor_id ? "Tutor" : "Student";
    partyId = p.tutor_id || (g ? g.first.studentId : "");
    purpose = "Agency Charge";
    if (p.demo_id) target = { action: "go-to-tuition", demo: p.demo_id, part: p.tutor_id ? "tutor-agency" : "student-agency" };
    if (activeRow) {
      const m = classMoney(g, activeRow);
      const charge = p.tutor_id ? m.tutorAgencyCharge : m.studentAgencyCharge;
      const paid = paidUpTo(all.filter(o => o.transaction_type === "agency_charge" && o.demo_id === p.demo_id && !!o.tutor_id === !!p.tutor_id), p);
      dues = Math.max(charge - paid, 0);
    }
    studentId = g ? g.first.studentId : "";
    tutorId = p.tutor_id || (activeRow ? activeRow.tutorId : "");

  } else if (["refund", "tutor_credit", "credit_used"].includes(p.transaction_type)) {
    // refund to the parent / a tutor's balance added or used (see adminSettleClass)
    const g = groupFor(p.demo_id);
    const isRefund = p.transaction_type === "refund";
    kind = isRefund ? "Student" : "Tutor";
    partyId = isRefund ? (g ? g.first.studentId : ((DIR_DEMO_BY_ID[p.demo_id] || {}).studentId || "")) : (p.tutor_id || "");
    purpose = isRefund ? "Refund" : (p.transaction_type === "tutor_credit" ? "Balance Added" : "Balance Used");
    if (p.demo_id) target = { action: "go-to-tuition", demo: p.demo_id, part: isRefund ? "student-payment" : "tutor-agency" };
    studentId = g ? g.first.studentId : "";
    tutorId = p.tutor_id || "";

  } else if (p.transaction_type === "payout") {
    kind = "Tutor";
    partyId = p.tutor_id || "";
    purpose = "Payments Out";
    const t = tuitionPaymentDues(p);
    target = t
      ? { action: "go-to-tuition", demo: t.g.demoId, part: "tutor-payment" }
      : (p.tutor_id ? { action: "go-to-card", tab: "tutors", key: "tutors:" + p.tutor_id } : null);
    if (t) dues = Math.max(t.duesBefore - num(p.amount), 0);
    studentId = t ? t.g.first.studentId : "";
    tutorId = p.tutor_id || "";
    demoId = demoId || (t ? t.g.demoId : "");

  } else {
    const demo = p.demo_id ? DIR_DEMO_BY_ID[p.demo_id] : null;
    kind = "Student";
    partyId = demo ? demo.studentId : "";
    purpose = "Payments In";
    if (p.demo_id) target = { action: "go-to-tuition", demo: p.demo_id, part: "student-payment" };
    const t = tuitionPaymentDues(p);
    if (t) dues = Math.max(t.duesBefore - num(p.amount), 0);
    studentId = partyId;
    tutorId = p.tutor_id || (t ? t.activeRow.tutorId : "");
  }

  const party = partyId ? (kind === "Student" ? DIR_STUDENT_BY_ID : DIR_TUTOR_BY_ID)[partyId] : null;
  const partyRow = partyId ? (kind === "Student" ? STUDENT_BY_ID : TUTOR_BY_ID)[partyId] : null;
  const partyWhatsapp = partyRow
    ? (kind === "Student" ? partyRow.values["WhatsApp"] : partyRow.values["WhatsApp Number"]) || ""
    : (kind === "Student" ? ((party && party.whatsapp) || "") : "");
  return {
    kind, partyId, purpose, dues, target, studentId, tutorId, demoId,
    partyName: (party && party.name) || partyId,
    partyMobile: (party && party.mobile) || "",
    partyWhatsapp
  };

}

// Same two layers as a Subscription card: who / what / how much on top,
// Full Payment or Dues left after it plus the time stamp below, and
// what it was for + Student/Tutor as two vertical rails on the right
// edge. The ₹ avatar jumps to (and outlines, without opening) whatever
// the payment belongs to - its Tuition, Subscription, or (a payout with
// no live Tuition) its Tutor.
function paymentHead(key, p) {
  const s = paymentSummary(p);
  return `
      <div class="admin-card-head" data-toggle="${esc(key)}">
        ${s.target
          ? `<button type="button" class="admin-avatar admin-avatar-link" data-action="${s.target.action}" data-highlight="1"${s.target.demo ? ` data-demo="${esc(s.target.demo)}"` : ""}${s.target.part ? ` data-part="${esc(s.target.part)}"` : ""}${s.target.tab ? ` data-tab="${esc(s.target.tab)}" data-key="${esc(s.target.key)}"` : ""} title="Open what this payment is for">₹</button>`
          : `<div class="admin-avatar">₹</div>`}
        ${equalRow([
          { text: ledgerDate(p.payment_date), sub: timeIST(p.created_at) }, s.partyName, s.partyMobile, s.partyWhatsapp,
          s.studentId, s.demoId, s.tutorId, s.dues == null ? "" : rupees(s.dues), rupees(p.amount)
        ])}
        <span class="admin-caret" aria-hidden="true"></span>
        <span class="admin-status-rail admin-rail-purpose" data-tone="black" tabindex="-1">${esc(s.purpose)}</span>
        <span class="admin-status-rail admin-rail-party" data-tone="black" tabindex="-1">${esc(s.kind)}</span>
      </div>`;
}

function paymentCard(p, ctx) {

  const key = "payment:" + p.id;
  const open = STATE.open.has(key);
  const editing = STATE.editing.has(key);
  const isPayout = p.transaction_type === "payout";

  const perms = myPerms();
  const buttons = editing
    ? `<div class="admin-pair">
         <button class="admin-primary" data-action="save-payment" type="button">Save changes</button>
         <button class="admin-ghost" data-action="cancel" data-key="${esc(key)}" type="button">Cancel</button>
       </div>`
    : (perms.paymentsEdit || perms.paymentsDelete) ? `<div class="admin-split">
         ${perms.paymentsEdit ? `<button class="admin-ghost" data-action="edit" data-key="${esc(key)}" type="button">Edit</button>` : ""}
         ${perms.paymentsDelete ? `<button class="admin-ghost admin-danger" data-action="delete-payment" type="button">Delete</button>` : ""}
       </div>` : "";

  if (p.subscription_id) {
    return subscriptionPaymentCard(p, key, open, editing, buttons);
  }

  if (p.transaction_type === "agency_charge") {
    return agencyChargePaymentCard(p, key, open, editing, buttons);
  }

  // Same rows, in the same order, as the Collection/Payout entry form.
  const t = tuitionPaymentDues(p);
  const g = t ? t.g : (p.demo_id ? demoGroups().find(x => x.demoId === p.demo_id) : null);
  const studentId = g ? g.first.studentId : ((DIR_DEMO_BY_ID[p.demo_id] || {}).studentId || "");
  const student = DIR_STUDENT_BY_ID[studentId] || {};
  const tutorId = p.tutor_id || (t ? t.activeRow.tutorId : "");
  const tutor = DIR_TUTOR_BY_ID[tutorId] || {};
  const paying = num(p.amount);
  const remaining = t && !["refund", "tutor_credit", "credit_used"].includes(p.transaction_type) ? Math.max(t.duesBefore - paying, 0) : null;

  const topRow =
    box("Transaction", isPayout ? "Payout (Tutor)" : "Collection (Parent)") +
    box("Payment Mode", p.payment_mode, { editable: editing, options: ["Online", "Offline"], attr: editing ? `data-pfield="paymentMode"` : "" }) +
    box("Payment Date", editing ? p.payment_date : formatPaymentDateTime(p), { editable: editing, type: editing ? "date" : "text", attr: editing ? `data-pfield="paymentDate"` : "" });
  const demoRow = box("Demo ID", p.demo_id || (t ? t.g.demoId : "")) + box("Student Mobile Number", student.mobile || "") + box("Name", student.name || "");
  const studentRow = box("Student ID", studentId) + box("WhatsApp Number", student.whatsapp || student.mobile || "") + box("Parent Name", student.parentsName || "");
  const tutorRow = box("Tutor ID", tutorId) + box("Mobile Number", tutor.mobile || "") + box("Name", tutor.name || "");
  const amountRow =
    box("Amount (₹)", t ? rupees(t.total) : "") +
    box("Dues (₹)", t ? rupees(t.duesBefore) : "") +
    box("Paying Now (₹)", editing ? p.amount : rupees(paying), { editable: editing, type: editing ? "number" : "text", attr: editing ? `data-pfield="amount"` : "" });
  const notesRow =
    box("Notes", p.notes || "", { editable: editing, multiline: true, attr: editing ? `data-pfield="notes"` : "" }) +
    box("Next Payment Date", editing ? (p.next_payment_date || "") : formatDate(p.next_payment_date), {
      editable: editing,
      type: editing ? "date" : "text",
      attr: (editing ? `data-pfield="nextPaymentDate"` : "") + (remaining > 0 ? ` data-reminder="1"` : "")
    }) +
    box("Remaining (₹)", remaining == null ? "" : rupees(remaining));

  const boxes = `
    <div class="admin-boxes admin-boxes-3">
      ${topRow}
      ${isPayout ? tutorRow + demoRow + studentRow : demoRow + studentRow + tutorRow}
      ${amountRow}
      ${notesRow}
    </div>`;


  return `
    <article class="admin-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}" data-tone="neutral" data-box data-id="${p.id}" data-key="${esc(key)}">
${paymentHead(key, p)}

      <div class="admin-card-body">
        ${boxes}
        ${buttons}
      </div>

    </article>
  `;

}


// A subscription payment's card mirrors the fields entered on the
// Payments form. Dues/Remaining are worked out as they stood when this
// payment was made (earlier instalments only), so they don't change as
// later payments arrive.
function recordedAt(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata"
  });
}

// Plain-text date for read-only display - a readonly <input type="date">
// doesn't reliably show its value on every mobile browser (the native
// picker chrome can render blank/oddly sized instead), so view mode
// uses this instead of the date input, matching a value like "29
// September 2027".
// The chosen Payment Date, followed by the time the payment was actually
// recorded (created_at, shown in Indian time) - never a preset time.
function formatPaymentDateTime(p) {
  const day = formatDate(p.payment_date);
  const at = p.created_at ? new Date(p.created_at) : null;
  if (!day || !at || isNaN(at)) return day;
  const time = at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
  return `${day}, ${time.toUpperCase()}`;
}

function formatDate(dateText) {
  if (!dateText) return "";
  const d = new Date(dateText + "T00:00:00");
  if (isNaN(d)) return dateText;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

// Next Due Date follows the most recent payment made against the
// subscription (that payment's date + 1 year), never earlier than what
// is already stored.
function subscriptionNextDue(sub) {
  const amount = Number(sub.amount || 0);
  const paid = subscriptionPaidAmount(sub.id);
  if (paid >= amount && sub.start_date) {
    const fromCycle = oneYearFrom(sub.start_date);
    return sub.next_due_date && sub.next_due_date > fromCycle ? sub.next_due_date : fromCycle;
  }
  return sub.next_due_date || "";
}

function subscriptionPaymentCard(p, key, open, editing, buttons) {

  const sub = (STATE.subscriptions || []).find(s => s.id === p.subscription_id) || {};
  const isStudent = !!sub.student_id;
  const partyId = sub.student_id || sub.tutor_id || "";
  const party = partyId ? (isStudent ? DIR_STUDENT_BY_ID : DIR_TUTOR_BY_ID)[partyId] : null;
  const partyName = (party && party.name) || partyId;
  const partyMobile = (party && party.mobile) || "";

  const paying = Number(p.amount || 0);
  const planAmount = Number(sub.amount || 0);
  const paidBefore = (STATE.payments || [])
    .filter(o => o.subscription_id === p.subscription_id && o.transaction_type !== "payout" &&
      (o.payment_date < p.payment_date || (o.payment_date === p.payment_date && o.id < p.id)))
    .reduce((sum, o) => sum + Number(o.amount || 0), 0);
  const duesThen = Math.max(planAmount - paidBefore, 0);
  const remaining = Math.max(duesThen - paying, 0);
  const startDate = sub.start_date || "";
  const nextDue = subscriptionNextDue(sub);

  // Same rows, in the same order, as the Subscription entry form.
  const boxes = `
    <div class="admin-boxes admin-boxes-3">
      ${box("Transaction", isStudent ? "Subscription (Student)" : "Subscription (Tutor)")}
      ${box("Payment Mode", p.payment_mode, { editable: editing, options: ["Online", "Offline"], attr: editing ? `data-pfield="paymentMode"` : "" })}
      ${box("Payment Date", editing ? p.payment_date : formatPaymentDateTime(p), { editable: editing, type: editing ? "date" : "text", attr: editing ? `data-pfield="paymentDate"` : "" })}
      ${box(isStudent ? "Student ID" : "Tutor ID", partyId)}
      ${box("Mobile Number", partyMobile)}
      ${box("Name", partyName)}
      ${box("Plan Name", sub.plan_name || "")}
      ${box("Billing Cycle", sub.billing_cycle || "")}
      ${box("Status", SUBSCRIPTION_STATUS_LABELS[sub.status] || sub.status || "")}
      ${box("Amount (₹)", rupees(planAmount))}
      ${box("Dues (₹)", rupees(duesThen))}
      ${box("Paying Now (₹)", editing ? p.amount : rupees(paying), { editable: editing, type: editing ? "number" : "text", attr: editing ? `data-pfield="amount"` : "" })}
      ${box("Start Date", formatDate(startDate))}
      ${box("Next Due Date", formatDate(nextDue), { attr: remaining > 0 ? `data-reminder="1"` : "" })}
      ${box("Remaining (₹)", rupees(remaining))}
      ${box("Notes", p.notes || "", { editable: editing, wide: true, multiline: true, attr: editing ? `data-pfield="notes"` : "" })}
    </div>`;

  return `
    <article class="admin-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}" data-tone="neutral" data-box data-id="${p.id}" data-key="${esc(key)}">

${paymentHead(key, p)}

      <div class="admin-card-body">
        ${boxes}
        ${buttons}
      </div>

    </article>
  `;

}


// An Agency Charge payment's card mirrors the fields entered on the
// Payments form (Demo ID, the paying party's own ID/Mobile/Name, and
// Agency Charge/Dues/Paying Now) - same idea as a Subscription
// payment's card mirroring its own entry form above.
function agencyChargePaymentCard(p, key, open, editing, buttons) {

  const g = demoGroups().find(x => x.demoId === p.demo_id);
  const activeRow = g ? activeRowFor(g) : null;
  const isTutorSide = !!p.tutor_id;
  const m = (g && activeRow) ? classMoney(g, activeRow) : null;
  const charge = m ? (isTutorSide ? m.tutorAgencyCharge : m.studentAgencyCharge) : 0;

  const partyId = isTutorSide ? p.tutor_id : (g ? g.first.studentId : "");
  const party = partyId ? (isTutorSide ? DIR_TUTOR_BY_ID : DIR_STUDENT_BY_ID)[partyId] : null;
  const studentDir = g ? (DIR_STUDENT_BY_ID[g.first.studentId] || null) : null;
  const partyName = isTutorSide ? ((party && party.name) || partyId) : ((studentDir && studentDir.parentsName) || "");
  const partyMobile = (party && party.mobile) || "";

  const paying = Number(p.amount || 0);
  const paidBefore = (STATE.payments || [])
    .filter(o => o.transaction_type === "agency_charge" && o.demo_id === p.demo_id && !!o.tutor_id === isTutorSide &&
      (o.payment_date < p.payment_date || (o.payment_date === p.payment_date && o.id < p.id)))
    .reduce((sum, o) => sum + Number(o.amount || 0), 0);
  const duesThen = Math.max(charge - paidBefore, 0);
  const transactionLabel = isTutorSide ? "Tutor Agency Charge" : "Student Agency Charge";

  const boxes = `
    <div class="admin-boxes admin-boxes-3">
      ${box("Transaction", transactionLabel)}
      ${box("Payment Mode", p.payment_mode, { editable: editing, options: ["Online", "Offline"], attr: editing ? `data-pfield="paymentMode"` : "" })}
      ${box("Payment Date", editing ? p.payment_date : formatPaymentDateTime(p), { editable: editing, type: editing ? "date" : "text", attr: editing ? `data-pfield="paymentDate"` : "" })}
      ${box("Demo ID", p.demo_id || "")}
      ${box("Student Mobile Number", (studentDir && studentDir.mobile) || "")}
      ${box("Name", (studentDir && studentDir.name) || "")}
      ${box(isTutorSide ? "Tutor ID" : "Student ID", partyId)}
      ${box("Mobile Number", partyMobile)}
      ${box(isTutorSide ? "Name" : "Parent Name", partyName)}
      ${box("Amount (₹)", rupees(charge))}
      ${box("Dues (₹)", rupees(duesThen))}
      ${box("Paying Now (₹)", editing ? p.amount : rupees(paying), { editable: editing, type: editing ? "number" : "text", attr: editing ? `data-pfield="amount"` : "" })}
      ${box("Notes", p.notes || "", { editable: editing, multiline: true, attr: editing ? `data-pfield="notes"` : "" })}
      ${box("Next Payment Date", editing ? (p.next_payment_date || "") : formatDate(p.next_payment_date), {
        editable: editing,
        type: editing ? "date" : "text",
        attr: (editing ? `data-pfield="nextPaymentDate"` : "") + (duesThen - paying > 0 ? ` data-reminder="1"` : "")
      })}
      ${box("Remaining (₹)", rupees(Math.max(duesThen - paying, 0)))}
    </div>`;

  return `
    <article class="admin-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}" data-tone="neutral" data-box data-id="${p.id}" data-key="${esc(key)}">
${paymentHead(key, p)}

      <div class="admin-card-body">
        ${boxes}
        ${buttons}
      </div>

    </article>
  `;

}


/* ---------------- ledger ---------------- */

// One list of every payment already made plus every one still due -
// each live Tuition's Student fees, Tutor payout and both Agency
// Charges, and every Subscription - with when it was (or is to be)
// paid. Tapping an entry opens what it belongs to: the payment's own
// card if it's been made, else the Class card figure / Subscription it
// has to be paid against.
function ledgerEntries() {

  const today = new Date().toISOString().slice(0, 10);
  const entries = [];
  const all = STATE.payments || [];
  const person = (kind, id) => (kind === "Student" ? DIR_STUDENT_BY_ID : DIR_TUTOR_BY_ID)[id] || {};
  const latestNextDate = list => {
    const withDate = list.filter(p => p.next_payment_date)
      .sort((a, b) => (b.payment_date || "").localeCompare(a.payment_date || "") || b.id - a.id);
    return withDate.length ? withDate[0].next_payment_date : "";
  };
  const due = (fields) => {
    const date = fields.date || "";
    entries.push({ ...fields, date, status: date && date < today ? "overdue" : "upcoming" });
  };

  all.forEach(p => {
    const s = paymentSummary(p);
    // The Tuition behind it (if any) fills in the other side's ID.
    const g = tuitionForPayment(p) || (p.demo_id ? demoGroups().find(x => x.demoId === p.demo_id) : null);
    const activeRow = g ? activeRowFor(g) : null;
    const demoId = p.demo_id || (g ? g.demoId : "");
    entries.push({
      status: "paid", date: p.payment_date || "", kind: s.kind, partyId: s.partyId, partyName: s.partyName,
      studentId: s.kind === "Student" ? s.partyId : (g ? g.first.studentId : ""),
      tutorId: s.kind === "Tutor" ? s.partyId : (p.tutor_id || (activeRow ? activeRow.tutorId : "")),
      demoId, purpose: s.purpose, amount: num(p.amount), mode: p.payment_mode || "",
      recordedAt: p.created_at, target: { action: "go-to-card", tab: "payments", key: "payment:" + p.id }
    });
  });

  demoGroups().forEach(g => {
    const activeRow = activeRowFor(g);
    if (!activeRow) return;
    const m = classMoney(g, activeRow);
    const studentId = g.first.studentId, tutorId = activeRow.tutorId;
    const target = part => ({ action: "go-to-tuition", demo: g.demoId, part });
    const payoutsHere = all.filter(p => p.transaction_type === "payout" && p.tutor_id === tutorId && (!p.demo_id || p.demo_id === g.demoId));
    const agency = all.filter(p => p.transaction_type === "agency_charge" && p.demo_id === g.demoId);

    if (m.studentDues > 0) due({
      kind: "Student", partyId: studentId, partyName: person("Student", studentId).name || studentId, demoId: g.demoId, studentId, tutorId,
      purpose: "Payments In", amount: m.studentDues, target: target("student-payment"),
      date: latestNextDate(all.filter(p => p.transaction_type === "collection" && p.demo_id === g.demoId)) || toDateInput(activeRow.studentNextDueDate)
    });
    if (m.tutorDues > 0) due({
      kind: "Tutor", partyId: tutorId, partyName: person("Tutor", tutorId).name || tutorId, demoId: g.demoId, studentId, tutorId,
      purpose: "Payments Out", amount: m.tutorDues, target: target("tutor-payment"),
      date: latestNextDate(payoutsHere) || toDateInput(activeRow.tutorNextPaymentDate)
    });
    if (m.studentAgencyDue > 0) due({
      kind: "Student", partyId: studentId, partyName: person("Student", studentId).name || studentId, demoId: g.demoId, studentId, tutorId,
      purpose: "Agency Charge", amount: m.studentAgencyDue, target: target("student-agency"),
      date: latestNextDate(agency.filter(p => !p.tutor_id))
    });
    if (m.tutorAgencyDue > 0) due({
      kind: "Tutor", partyId: tutorId, partyName: person("Tutor", tutorId).name || tutorId, demoId: g.demoId, studentId, tutorId,
      purpose: "Agency Charge", amount: m.tutorAgencyDue, target: target("tutor-agency"),
      date: latestNextDate(agency.filter(p => p.tutor_id === tutorId))
    });
  });

  (STATE.subscriptions || []).forEach(sub => {
    const dues = Math.max(num(sub.amount) - subscriptionPaidAmount(sub.id), 0);
    if (!(dues > 0) || sub.status === "cancelled") return;
    const kind = sub.student_id ? "Student" : "Tutor";
    const id = sub.student_id || sub.tutor_id;
    due({
      kind, partyId: id, partyName: person(kind, id).name || id, demoId: "",
      studentId: sub.student_id || "", tutorId: sub.tutor_id || "",
      purpose: "Subscription", amount: dues, date: subscriptionNextDue(sub),
      target: { action: "go-to-card", tab: "subscriptions", key: "subscription:" + sub.id },
      subscriptionId: sub.id
    });
  });

  entries.forEach(e => { e.mobile = person(e.kind, e.partyId).mobile || ""; });

  // Still to be paid first, then paid. Within each: no date set first,
  // then by date, earliest first.
  const rank = e => (e.status === "paid" ? 1 : 0);
  return entries.sort((a, b) =>
    rank(a) - rank(b) || (a.date ? 1 : 0) - (b.date ? 1 : 0) || (a.date || "").localeCompare(b.date || ""));

}

const LEDGER_STATUS = {
  paid: { label: "Paid", tone: "running" },
  upcoming: { label: "Upcoming", tone: "schedule" },
  overdue: { label: "Overdue", tone: "declined" }
};

const LEDGER_COLUMNS = ["Date", "Who", "Name", "Mobile Number", "Tutor ID", "Student ID", "Demo ID", "Amount"];

// "2026-10-06" -> "06|10|2026"
function ledgerDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}|${m[2]}|${m[1]}` : "";
}

function ledgerRow(cells) {
  return `<div class="ledger-grid">${cells.map(cellHtml).join("")}</div>`;
}

// One grid cell. A plain value is cut with "..." when too long; a
// { text, sub } cell (the Date columns) shows the date with its time
// below in small type.
function cellHtml(c) {
  if (c && typeof c === "object") {
    const text = String(c.text || "") || "-";
    const sub = String(c.sub || "");
    return `<span class="ledger-cell" title="${esc(sub ? text + ", " + sub : text)}">${esc(text)}${sub ? `<small class="cell-sub">${esc(sub)}</small>` : ""}</span>`;
  }
  const text = (c === undefined || c === null || c === "") ? "-" : String(c);
  return `<span class="ledger-cell" title="${esc(text)}">${esc(text)}</span>`;
}

// "5:34 AM" - the time a payment was recorded, in Indian time.
function timeIST(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).toUpperCase();
}

// Money in (green) or out (red) - only a Tutor payout goes out.
function ledgerFlow(out) {
  return `<span class="ledger-flow" data-flow="${out ? "out" : "in"}" title="${out ? "Money going out" : "Money coming in"}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${out ? "M7 17L17 7M9 7h8v8" : "M17 7L7 17M15 17H7V9"}"/></svg>
  </span>`;
}

// One line per entry: status + payment type rails and the in/out arrow
// on the left, the columns, and - while
// it's still to be paid - a + on the right to record it.
function ledgerCard(e) {
  const t = e.target;
  const attrs = `data-action="${t.action}"` +
    (t.demo ? ` data-demo="${esc(t.demo)}"` : "") + (t.part ? ` data-part="${esc(t.part)}"` : "") +
    (t.tab ? ` data-tab="${esc(t.tab)}" data-key="${esc(t.key)}"` : "");
  const status = LEDGER_STATUS[e.status];
  const record = (e.status === "paid" || !myPerms().paymentsAdd) ? `<span class="ledger-record-space" aria-hidden="true"></span>` : `
        <button type="button" class="admin-avatar admin-avatar-link ledger-record" data-action="ledger-record"
          ${e.subscriptionId ? `data-sub="${e.subscriptionId}"` : `data-demo="${esc(t.demo)}" data-part="${esc(t.part)}"`}
          title="Record this payment" aria-label="Record this payment"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>`;
  const cells = [
    { text: ledgerDate(e.date), sub: e.status === "paid" ? timeIST(e.recordedAt) : "" }, e.kind, e.partyName, e.mobile,
    e.tutorId, e.studentId, e.demoId, "₹" + Number(e.amount || 0).toLocaleString("en-IN")
  ];
  return `
    <article class="admin-card ledger-card" data-tone="neutral">
      <div class="admin-card-head" ${attrs} title="Open what this is for">
        <span class="admin-status-rail ledger-status-rail" data-tone="${status.tone}" tabindex="-1">${esc(status.label)}</span>
        <span class="admin-status-rail ledger-purpose-rail" data-tone="black" tabindex="-1">${esc(e.purpose)}</span>
        ${ledgerFlow(e.purpose === "Payments Out" || e.purpose === "Refund")}
        ${ledgerRow(cells)}
        ${record}
      </div>
    </article>`;
}

// The column titles, as a card of its own above the list - same rail
// and + spaces as an entry so every column lines up.
function ledgerHeaderCard() {
  return `
    <div class="admin-card ledger-card ledger-header" aria-hidden="true">
      <div class="admin-card-head">
        <span class="admin-status-rail ledger-status-rail" data-tone="black">Status</span>
        <span class="admin-status-rail ledger-purpose-rail" data-tone="black">Type</span>
        <span class="ledger-flow ledger-flow-head">In/Out</span>
        ${ledgerRow(LEDGER_COLUMNS)}
        <span class="ledger-record-head" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>
      </div>
    </div>`;
}

function renderLedger() {

  if (!$("ledgerList")) return;

  const filter = STATE.ledgerFilter;
  const rows = ledgerEntries().filter(e => filter === "all" || e.status === filter);

  $("ledgerList").innerHTML = rows.length
    ? rows.map(ledgerCard).join("")
    : empty(filter === "all" ? "Nothing paid or due yet." : "Nothing here.");
  $("ledgerHeader").innerHTML = rows.length ? ledgerHeaderCard() : "";

  applyTextSearch("ledgerList", "ledgerSearch", "Nothing matches.");

}


/* ---------------- graph ---------------- */

/* =====================================================================
   GRAPH TAB
   Monthly money-in / money-out bar chart and the totals above it.
   ===================================================================== */

// Money in vs out, and outstanding dues, over time - built from the
// same paid/due entries the Ledger lists (ledgerEntries), just
// totalled by month and by purpose instead of shown one row per
// payment. Money "out" is only ever a tutor Payments Out entry, same
// convention as the Ledger's own in/out arrow.
function graphMonthKey(dateStr) {
  return (dateStr || "").slice(0, 7); // "YYYY-MM"
}

function graphMonthLabel(key) {
  if (!key) return "";
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

// "1.2L" / "35k" - keeps the y-axis labels short.
function shortMoney(n) {
  if (n >= 100000) return (n / 100000).toFixed(1).replace(/\.0$/, "") + "L";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(n));
}

function renderGraph() {

  if (!$("graphChart")) return;

  const purposeFilter = STATE.graphFilter;
  const days = Number(STATE.graphPeriod) || 0; // 0 = all time
  const cutoff = days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : "";

  const all = ledgerEntries().filter(e => purposeFilter === "all" || e.purpose === purposeFilter);
  // a refund is money out; a tutor's balance moving is not money at all
  const isOut = e => e.purpose === "Payments Out" || e.purpose === "Refund";
  const paid = all.filter(e => e.status === "paid" && !/^Balance /.test(e.purpose) && (!cutoff || !e.date || e.date >= cutoff));
  const due = all.filter(e => e.status !== "paid");

  const totalIn = paid.filter(e => !isOut(e)).reduce((s, e) => s + e.amount, 0);
  const totalOut = paid.filter(isOut).reduce((s, e) => s + e.amount, 0);
  const totalDues = due.reduce((s, e) => s + e.amount, 0);
  const totalOverdue = due.filter(e => e.status === "overdue").reduce((s, e) => s + e.amount, 0);

  const stats = [
    ["Total Collected", rupeesRounded(totalIn), "green"],
    ["Total Paid Out", rupeesRounded(totalOut), "red"],
    ["Net", rupeesRounded(totalIn - totalOut), totalIn - totalOut >= 0 ? "lime" : "red"],
    ["Outstanding Dues", rupeesRounded(totalDues), "amber"],
    ["Over Dues", rupeesRounded(totalOverdue), "red"]
  ];

  $("graphStats").innerHTML = stats.map(([label, value, tone]) => `
    <div class="admin-stat" data-tone="${tone}">
      <span class="admin-stat-value">${esc(value)}</span>
      <span class="admin-stat-label">${esc(label)}</span>
    </div>
  `).join("");

  // Paid entries grouped by month for the bar chart below the tiles.
  const byMonth = new Map();
  paid.forEach(e => {
    const key = graphMonthKey(e.date);
    if (!key) return;
    if (!byMonth.has(key)) byMonth.set(key, { in: 0, out: 0 });
    const bucket = byMonth.get(key);
    if (isOut(e)) bucket.out += e.amount; else bucket.in += e.amount;
  });
  const monthKeys = [...byMonth.keys()].sort();

  $("graphChart").innerHTML = monthKeys.length ? graphBarChart(monthKeys, byMonth) : empty("Nothing paid in this period yet.");

}

// Plain inline-SVG grouped bar chart, In vs Out per month - no chart
// library. Bars are scaled to the largest single in/out value across
// the whole range, so months stay comparable to each other.
function graphBarChart(monthKeys, byMonth) {

  const w = 720, h = 220, padL = 42, padB = 26, padT = 10, padR = 10;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const maxVal = Math.max(1, ...monthKeys.map(k => Math.max(byMonth.get(k).in, byMonth.get(k).out)));
  const groupW = plotW / monthKeys.length;
  const barW = Math.min(22, groupW / 3);

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = padT + plotH * (1 - f);
    return `<line class="graph-gridline" x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}"/>` +
      `<text class="graph-axis-label" x="${padL - 8}" y="${y + 3}" text-anchor="end">${esc(shortMoney(maxVal * f))}</text>`;
  }).join("");

  const bars = monthKeys.map((key, i) => {
    const { in: inVal, out: outVal } = byMonth.get(key);
    const cx = padL + groupW * i + groupW / 2;
    const inH = (inVal / maxVal) * plotH;
    const outH = (outVal / maxVal) * plotH;
    return `
      <rect class="graph-bar-in" x="${cx - barW - 2}" y="${padT + plotH - inH}" width="${barW}" height="${Math.max(inH, 0.5)}" rx="3">
        <title>${esc(graphMonthLabel(key))} - In: ${esc(rupeesRounded(inVal))}</title>
      </rect>
      <rect class="graph-bar-out" x="${cx + 2}" y="${padT + plotH - outH}" width="${barW}" height="${Math.max(outH, 0.5)}" rx="3">
        <title>${esc(graphMonthLabel(key))} - Out: ${esc(rupeesRounded(outVal))}</title>
      </rect>
      <text class="graph-month-label" x="${cx}" y="${h - 8}" text-anchor="middle">${esc(graphMonthLabel(key))}</text>
    `;
  }).join("");

  return `
    <div class="admin-card graph-card">
      <svg viewBox="0 0 ${w} ${h}" class="graph-svg" role="img" aria-label="Payments in vs out by month">
        ${gridLines}
        ${bars}
      </svg>
      <div class="graph-legend">
        <span class="graph-legend-item"><span class="graph-swatch" data-tone="in"></span>In</span>
        <span class="graph-legend-item"><span class="graph-swatch" data-tone="out"></span>Out</span>
      </div>
    </div>
  `;

}


/* ---------------- subscriptions ---------------- */

function renderSubscriptions() {

  if (!$("subscriptionList")) return;

  const rows = STATE.subscriptions || [];

  $("subscriptionList").innerHTML = rows.length
    ? rows.map(subscriptionCard).join("")
    : empty("No subscriptions yet.");

  $("subscriptionHeader").innerHTML = rows.length ? subscriptionHeaderCard() : "";

  applyTextSearch("subscriptionList", "subscriptionSearch", "No subscriptions match.");

}

const SUBSCRIPTION_STATUS_LABELS = { active: "Active", paused: "Paused", cancelled: "Cancelled", completed: "Completed" };
const SUBSCRIPTION_STATUS_TONES = { active: "running", paused: "schedule", cancelled: "rejected", completed: "completed" };

/* =====================================================================
   LIST HEADER ROWS
   The column titles shown above each list (Students, Payments, ...), built
   with equal-width columns so text lines up with the cards below.
   ===================================================================== */

// A single-line card-head row of N equal, centred, dotted-divided
// columns - text too long for its column is cut with "...", the full
// value always sitting in the tooltip. Shared by the Subscription,
// Payment, Student and Tutor cards.
function equalRow(cells, widths) {
  const template = widths || `repeat(${cells.length}, minmax(0, 1fr))`;
  return `<div class="eq-grid" style="grid-template-columns: ${template}">${cells.map(cellHtml).join("")}</div>`;
}

// A slim, rounded header-row card above a list, naming its columns -
// the same idea as the Ledger's own header (see ledgerHeaderCard), just
// reused for the other sections. The leading/trailing spacers keep it
// the same width as a real card's avatar/caret so the labels line up
// with the rows underneath.
function listHeaderCard(innerHtml) {
  return `<div class="admin-card list-header" aria-hidden="true"><div class="admin-card-head">${innerHtml}</div></div>`;
}

/* ---------------- student card icons ----------------
   A 2 x 2 grid right of the PIN Code on every Student card:
        Block    | Check / Flag
        Bell     | Edit
   Block (red)       - blocks the student: they can only open their page,
                       nothing else works, no notification goes to them, and
                       they can't be edited until unblocked. Nothing is erased.
   Check / Flag      - green check when every detail is filled, orange flag
                       when something is missing.
   Bell (blue)       - switches this student's notifications off / on.
   Edit (violet)     - opens the card ready to edit.
   A tinted icon means "recorded": blocked, notifications off, edited.
   All of it is searchable: block, notification, edit, check, flag. */
const STUDENT_REQUIRED = ["Parents Name", "Student Name", "Phone", "WhatsApp", "Email", "Gender",
  "Class", "Board", "School", "Address", "City", "PIN Code"];

function studentMissing(r) {
  return STUDENT_REQUIRED.filter(f => !String((r.values || {})[f] || "").trim());
}

function studentTags(r) {
  const m = r.meta || {};
  const tags = [studentMissing(r).length ? "flagged" : "approved"];
  if (m.editedAt) tags.push("edited");
  if (m.blockedAt) tags.push("blocked");
  // a blocked student never gets notifications, so they count as switched off too
  if (m.notificationsOff || m.blockedAt) tags.push("muted");
  return tags;
}

// Search words that look at what a card's icons recorded instead of its text.
const STATUS_WORDS = {
  approved: "approved", approve: "approved", check: "approved", checked: "approved", complete: "approved",
  flag: "flagged", flagged: "flagged", incomplete: "flagged",
  edit: "edited", edited: "edited",
  notification: "muted", notifications: "muted", notify: "muted", mute: "muted", muted: "muted", disabled: "muted",
  block: "blocked", blocked: "blocked", delete: "blocked", deleted: "blocked",
};

function cardMatches(query, el) {
  const tags = el.dataset.tags;
  if (tags === undefined) return matchesAll(query, cardSearchText(el));
  const have = tags.split(" ");
  const words = lower(query).split(/\s+/).filter(Boolean);
  const textWords = words.filter(w => !STATUS_WORDS[w]);
  return words.every(w => !STATUS_WORDS[w] || have.includes(STATUS_WORDS[w])) &&
    matchesAll(textWords.join(" "), cardSearchText(el));
}

const STU_SVG = {
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  bellOff: '<path d="M8.7 3A6 6 0 0 1 18 8c0 2.2.3 4 .8 5.4"/><path d="M17 17H3s3-2 3-9c0-.7.1-1.4.3-2"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  flag: '<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
};

function stuIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${STU_SVG[name]}</svg>`;
}

function fmtWhen(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

function studentIconsHtml(r, key) {
  const perms = myPerms();
  const m = r.meta || {};
  const missing = studentMissing(r);
  const blocked = !!m.blockedAt;
  const muted = !!m.notificationsOff;
  const btn = (action, icon, tone, label, allowed, on) =>
    `<button type="button" class="stu-icon" data-tone="${tone}"${on ? ' data-on="1"' : ""} data-action="${action}" data-id="${esc(r.id)}" data-key="${esc(key)}"
      title="${esc(label)}" aria-label="${esc(label)}"${allowed ? "" : " disabled"}>${stuIcon(icon)}</button>`;
  // order = top-left, top-right, bottom-left, bottom-right
  return `<span class="stu-icons">
    ${btn("student-block", "ban", "red",
      blocked ? `Blocked since ${fmtWhen(m.blockedAt)} - click to unblock` : "Block this student", perms.studentsBlock, blocked)}
    ${missing.length
      ? btn("student-status", "flag", "orange", `Needs check - missing: ${missing.join(", ")}`, true, true)
      : btn("student-status", "check", "green", "All details filled - approved", true, true)}
    ${btn("student-mute", muted || blocked ? "bellOff" : "bell", "blue",
      blocked ? "Blocked - notifications are off" : muted ? "Notifications are OFF - click to turn on" : "Notifications are ON - click to turn off",
      perms.studentsMute && !blocked, muted || blocked)}
    ${btn("student-edit", "edit", "violet",
      blocked ? "Blocked - unblock to edit" : m.editedAt ? `Edit details (last edited ${fmtWhen(m.editedAt)})` : "Edit details",
      perms.studentsEdit && !blocked, !!m.editedAt)}
  </span>`;
}

async function muteStudent(id, button) {
  const r = STUDENT_BY_ID[id];
  if (!r) return;
  const name = r.values["Student Name"] || id;
  const turnOff = !(r.meta && r.meta.notificationsOff);
  const ok = await askConfirm(turnOff
    ? { title: `Turn off notifications for ${name}?`, okText: "Turn Off",
        lines: ["No email and no Telegram message about this student will be sent to them - tuition requests, demos, payments, agreements, tutor replies - until you turn it back on."] }
    : { title: `Turn notifications back on for ${name}?`, okText: "Turn On",
        lines: [`${name} will get emails and Telegram messages again.`] });
  if (!ok) return;
  button.disabled = true;
  await save({ action: "adminMuteStudent", id, off: turnOff });
  if (document.body.contains(button)) button.disabled = false;
}

async function blockStudent(id, button) {
  const r = STUDENT_BY_ID[id];
  if (!r) return;
  const name = r.values["Student Name"] || id;
  const unblock = !!(r.meta && r.meta.blockedAt);
  const ok = await askConfirm(unblock
    ? { title: `Unblock ${name}?`, okText: "Unblock",
        lines: [`${id} gets full access again, and can be edited. Their notifications go back to how they were before.`] }
    : { title: `Block ${name}?`, okText: "Block",
        lines: ["Nothing is deleted. The student can only open their page: they can't post or answer tuitions, their open tuitions are hidden from tutors, no update or notification is sent, and their details can't be edited - until you unblock."] });
  if (!ok) return;
  button.disabled = true;
  STATE.editing.delete("students:" + id);
  await save({ action: "adminBlockStudent", id, unblock });
  if (document.body.contains(button)) button.disabled = false;
}

function studentHeaderCard() {
  return listHeaderCard(`
    <span class="list-header-spacer list-header-avatar-label">Profile</span>
    ${equalRow(STUDENT_COLUMN_LABELS, STUDENT_COLUMNS)}
    <span class="stu-icons stu-icons-label">Actions</span>
  `);
}

function paymentHeaderCard() {
  return listHeaderCard(`
    <div class="admin-avatar">₹</div>
    ${equalRow(["Date", "Name", "Mobile", "WhatsApp", "Student ID", "Demo ID", "Tutor ID", "Dues", "Amount Paid"])}
    <span class="admin-caret" aria-hidden="true"></span>
    <span class="admin-status-rail admin-rail-purpose" data-tone="black">Type</span>
    <span class="admin-status-rail admin-rail-party" data-tone="black">Who</span>
  `);
}

function subscriptionHeaderCard() {
  return listHeaderCard(`
    <span class="list-header-spacer list-header-avatar-label">Profile</span>
    ${equalRow(["Student/Tutor", "Name", "Mobile", "WhatsApp", "ID", "Plan", "Amount"])}
    <span class="admin-caret" aria-hidden="true"></span>
    <span class="admin-status-rail admin-rail-sub" data-tone="black">Status</span>
  `);
}

function tutorHeaderCard() {
  return listHeaderCard(`
    <span class="list-header-spacer list-header-avatar-label">Profile</span>
    ${equalRow(["Name", "Gender", "Mobile", "WhatsApp", "Tutor ID", "Subjects", "Address", "Pin Code"])}
    <span class="admin-caret" aria-hidden="true"></span>
    <span class="admin-status-rail admin-rail-sub list-header-vbtns" data-tone="black">Status</span>
  `);
}

function employeeHeaderCard() {
  return listHeaderCard(`
    <span class="list-header-spacer list-header-avatar-label">Profile</span>
    ${equalRow(["Name", "Email", "Role", "Status"])}
    <span class="admin-caret" aria-hidden="true"></span>
    <span class="admin-status-rail admin-rail-sub list-header-vbtns" data-tone="black">Action</span>
  `);
}

function subscriptionCard(sub) {

  const key = "subscription:" + sub.id;
  const open = STATE.open.has(key);
  const editing = STATE.editing.has(key);

  const student = sub.student_id ? STUDENT_BY_ID[sub.student_id] : null;
  const tutor = sub.tutor_id ? TUTOR_BY_ID[sub.tutor_id] : null;
  const partyName = student ? (student.values["Student Name"] || sub.student_id) : (tutor ? (tutor.values["Full Name"] || sub.tutor_id) : "");
  const partyMobile = student ? (student.values["WhatsApp"] || student.values["Phone"]) : (tutor ? tutor.values["Mobile Number"] : "");
  const partyId = sub.student_id || sub.tutor_id || "";
  const partyKind = sub.student_id ? "Student" : "Tutor";
  const dir = sub.student_id ? DIR_STUDENT_BY_ID[sub.student_id] : DIR_TUTOR_BY_ID[sub.tutor_id];
  const partyPhone = (student ? student.values["Phone"] : (tutor ? tutor.values["Mobile Number"] : "")) || (dir && dir.mobile) || "";
  const partyWhatsapp = (student ? student.values["WhatsApp"] : (tutor ? tutor.values["WhatsApp Number"] : "")) || (dir && dir.whatsapp) || "";
  const amount = Number(sub.amount || 0);
  const paid = subscriptionPaidAmount(sub.id);
  const dues = Math.max(amount - paid, 0);
  const nextDueDate = subscriptionNextDue(sub);

  const boxes = `
    <div class="admin-boxes">
      ${box(partyKind + " ID", partyId)}
      ${box("Plan Name", sub.plan_name, { editable: editing, attr: editing ? `data-subfield="planName"` : "" })}
      ${box("Amount (₹)", sub.amount, { editable: editing, type: "number", attr: editing ? `data-subfield="amount"` : "" })}
      ${box("Dues (₹)", dues)}
      ${box("Billing Cycle", sub.billing_cycle, { editable: editing, attr: editing ? `data-subfield="billingCycle"` : "" })}
      ${box("Status", SUBSCRIPTION_STATUS_LABELS[sub.status] || sub.status, {
        editable: editing,
        options: Object.values(SUBSCRIPTION_STATUS_LABELS),
        attr: editing ? `data-subfield="status"` : ""
      })}
      ${box("Start Date", editing ? sub.start_date : formatDate(sub.start_date), { editable: editing, type: editing ? "date" : "text", attr: editing ? `data-subfield="startDate"` : "" })}
      ${box("Next Due Date", editing ? nextDueDate : formatDate(nextDueDate), { editable: editing, type: editing ? "date" : "text", attr: (editing ? `data-subfield="nextDueDate"` : "") + (dues > 0 ? ` data-reminder="1"` : "") })}
      ${box("Notes", sub.notes || "", { editable: editing, wide: true, multiline: true, attr: editing ? `data-subfield="notes"` : "" })}
    </div>`;

  const buttons = editing
    ? `<div class="admin-pair">
         <button class="admin-primary" data-action="save-subscription" type="button">Save changes</button>
         <button class="admin-ghost" data-action="cancel" data-key="${esc(key)}" type="button">Cancel</button>
       </div>`
    : myPerms().subscriptionsEdit ? `<div class="admin-split">
         <button class="admin-ghost" data-action="edit" data-key="${esc(key)}" type="button">Edit</button>
         <button class="admin-ghost admin-danger" data-action="delete-subscription" type="button" disabled title="Subscriptions cannot be deleted">Delete</button>
       </div>` : "";

  return `
    <article class="admin-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}" data-tone="neutral" data-box data-id="${sub.id}" data-key="${esc(key)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        <div class="admin-avatar">${esc(initials(partyName, "$"))}${sub.student_id ? "" : tutorPhotoHtml(partyId)}${subscriptionPayBadge(sub.student_id ? "student" : "tutor", partyId)}</div>
        ${equalRow([partyKind, partyName || partyId, partyPhone, partyWhatsapp, partyId, sub.plan_name, "₹" + amount.toLocaleString("en-IN")])}
        <span class="admin-caret" aria-hidden="true"></span>
        <span class="admin-status-rail admin-rail-sub" data-tone="${SUBSCRIPTION_STATUS_TONES[sub.status] || ""}" tabindex="-1">${esc(SUBSCRIPTION_STATUS_LABELS[sub.status] || sub.status)}</span>
      </div>

      <div class="admin-card-body">
        ${boxes}
        ${(!editing && dues > 0) ? `<button class="admin-ghost admin-wide" data-action="record-payment" type="button">Record a Payment for this Subscription</button>` : ""}
        ${buttons}
      </div>

    </article>
  `;

}


/* ---------------- employees ---------------- */

function renderEmployees() {

  if (!$("employeeList")) return;

  const rows = STATE.employees || [];

  $("employeeList").innerHTML = rows.length
    ? rows.map(employeeCard).join("")
    : empty("No employees yet.");
  paginateList("employeeList");

  $("employeeHeader").innerHTML = rows.length ? `
    <p class="emp-legend">
      <span><i class="emp-key" data-presence="online"></i>Logged In</span>
      <span><i class="emp-key" data-presence="working"><i class="emp-ring"></i></i>Working Now</span>
      <span><i class="emp-key" data-presence="off"></i>Logged Out</span>
    </p>` + employeeHeaderCard() : "";

}

// Active | Suspend - same vertical button strip and light-tint /
// disabled-when-current-state look as the tutor Accept/Suspend pair.
// Always both buttons, on every employee's card - including your own,
// where both are simply disabled rather than hidden, so the row shape
// never changes from one card to the next.
function employeeStatusButtonsHtml(active, isMe) {
  return `
    <div class="admin-vbtns">
      <button class="admin-vbtn v-reject" type="button" data-action="employee-status" data-value="false"${(!active || isMe) ? " disabled" : ""}>Suspend</button>
      <button class="admin-vbtn v-approve" type="button" data-action="employee-status" data-value="true"${(active || isMe) ? " disabled" : ""}>Active</button>
    </div>
  `;
}

// "09:00" -> "9:00 AM"
function clock12(t) {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

// "09:00", "18:00" -> "9"; overnight shifts wrap past midnight
function hoursBetween(start, end) {
  const m = t => { const x = String(t || "").match(/^(\d{1,2}):(\d{2})/); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
  const a = m(start), b = m(end);
  if (a === null || b === null) return "";
  const mins = ((b - a) + 1440) % 1440 || 1440;
  return String(Math.round(mins / 30) / 2);
}

// "09:00" + 9 hours -> "18:00" (negative hours go back)
function addHours(time, hours) {
  const x = String(time || "").match(/^(\d{1,2}):(\d{2})/);
  if (!x || !hours) return "";
  const mins = (((Number(x[1]) * 60 + Number(x[2]) + Math.round(hours * 60)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

// Duration | Login From | Login Till: set the Duration, then either time -
// the other one follows. Works for the New Employee form and every card.
function onHoursInput(event) {
  const el = event.target;
  const part = el.dataset && el.dataset.hoursPart;
  const group = part && el.closest("[data-hours]");
  if (!group) return;
  const get = p => group.querySelector(`[data-hours-part="${p}"]`);
  const hours = Number(get("duration").value);
  if (part === "end") {
    if (el.value && hours > 0) get("start").value = addHours(el.value, -hours);
  } else if (get("start").value && hours > 0) {
    get("end").value = addHours(get("start").value, hours);
  }
}

function loginHoursText(e) {
  if (e.role === "super_admin") return "24 × 7";
  return e.workStart && e.workEnd ? `${clock12(e.workStart)} - ${clock12(e.workEnd)}` : "Any time";
}

// A ring round the profile icon: grey = logged out, green = logged in,
// green and spinning = working right now.
function employeeAvatarHtml(e, isMe) {
  const online = !!e.loggedIn, working = !!e.working;
  const state = working ? "working" : online ? "online" : "off";
  const tip = [isMe ? "This is you" : "", online ? "Logged in" : "Logged out", working ? "Working now" : (online ? "Idle" : "")]
    .filter(Boolean).join(" · ");
  return `
    <div class="admin-avatar emp-avatar" data-presence="${state}" title="${esc(tip)}">
      <i class="emp-ring" aria-hidden="true"></i>
      ${esc(initials(e.full_name, "E"))}
      <span class="sr-only">${esc(tip)}</span>
    </div>`;
}

function employeeCard(e) {

  const key = "employee:" + e.id;
  const open = STATE.open.has(key);
  const editing = STATE.editing.has(key);
  const isMe = STATE.me && lower(e.email) === lower(STATE.me.email);

  const boxes = `
    <div class="admin-boxes">
      ${box("Email", e.email)}
      ${box("Full Name", e.full_name, { editable: editing, attr: editing ? `data-efield="fullName"` : "" })}
      ${box("Role", ROLE_LABELS[e.role] || e.role, {
        editable: editing && !isMe,
        options: Object.values(ROLE_LABELS),
        attr: editing && !isMe ? `data-efield="role"` : ""
      })}
      ${box("Active", e.active ? "Yes" : "No", { editable: editing && !isMe, options: ["Yes", "No"], attr: editing && !isMe ? `data-efield="active"` : "" })}
      ${editing && e.role !== "super_admin" && !isMe
        ? `<div class="admin-hours-boxes" data-hours>` +
          box("Duration (Hours)", hoursBetween(e.workStart, e.workEnd) || "9", { editable: true, type: "number", attr: `data-hours-part="duration" min="0.5" max="24" step="0.5"` }) +
          box("Login From", e.workStart || "", { editable: true, type: "time", attr: `data-efield="workStart" data-hours-part="start"` }) +
          box("Login Till", e.workEnd || "", { editable: true, type: "time", attr: `data-efield="workEnd" data-hours-part="end"` }) +
          `</div>`
        : box("Login Hours", loginHoursText(e))}
    </div>`;

  // Their ticks: editable only in edit mode, never for yourself (you
  // can't change your own); a Super Admin's are all ticked until their
  // Role is changed.
  const locked = isMe;
  const permsBox = STATE.permInfo ? `
    <div class="perm-box">
      <p class="perm-title">Permissions:${locked ? " <small>- you can't change your own</small>" : e.role === "super_admin" ? " <small>- a Super Admin always has all (change the Role to pick individually)</small>" : ""}</p>
      <div class="perm-grid" data-perms${locked ? " data-locked" : ""}>${permChecklistHtml(new Set(e.permissions || []), !editing || locked || e.role === "super_admin")}</div>
    </div>` : "";

  const buttons = editing
    ? `<div class="admin-pair">
         <button class="admin-primary" data-action="save-employee" type="button">Save changes</button>
         <button class="admin-ghost" data-action="cancel" data-key="${esc(key)}" type="button">Cancel</button>
       </div>`
    : `<button class="admin-ghost admin-wide" data-action="edit" data-key="${esc(key)}" type="button">Edit Employee</button>`;

  return `
    <article class="admin-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}" data-tone="${e.active ? "verified" : "rejected"}" data-box data-id="${esc(e.id)}" data-key="${esc(key)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        ${employeeAvatarHtml(e, isMe)}
        <div class="eq-grid" style="grid-template-columns: repeat(4, minmax(0, 1fr))">
          <span class="ledger-cell" title="${esc(e.full_name)}${isMe ? " (this is you)" : ""}">${esc(e.full_name)}</span>
          <span class="ledger-cell" title="${esc(e.email)}">${esc(e.email)}</span>
          <span class="ledger-cell" title="${esc(ROLE_LABELS[e.role] || e.role)}">${esc(ROLE_LABELS[e.role] || e.role)}</span>
          <span class="ledger-cell"><span class="emp-status" data-active="${e.active ? "yes" : "no"}">${e.active ? "Active" : "Suspended"}</span></span>
        </div>
        <span class="admin-caret" aria-hidden="true"></span>
        ${employeeStatusButtonsHtml(!!e.active, isMe)}
      </div>

      <div class="admin-card-body">
        ${boxes}
        ${permsBox}
        ${buttons}
      </div>

    </article>
  `;

}


/* ---------------- tuitions ---------------- */

function renderTuitions() {

  const filter = STATE.tuitionFilter;

  const list = demoGroups().filter(g => {

    if (filter === "today") {
      return g.rows.some(r => {
        const st = rowState(r);
        return r.hasTutor && isToday(r.demoDate) && st !== "declined" && st !== "terminated";
      });
    }

    return filter === "all" || groupState(g) === filter;

  }).reverse();

  $("tuitionList").innerHTML = list.length ? list.map(tuitionStack).join("") : empty("No tuitions match.");

  applyTextSearch("tuitionList", "tuitionSearch", "No tuitions match.");

}

// The one tutor row actually Running/Completed for a Tuition group, if
// any - the same row the Class card is keyed off, shared with anywhere
// else (like the Agency Charge payment form) that needs to know
// whether a Tuition is currently live and who its active tutor is.
function activeRowFor(g) {
  const state = groupState(g);
  const railTone = tuitionRailTone(state);
  if (railTone !== "running" && railTone !== "completed") return null;
  return g.rows.filter(r => r.hasTutor).find(r => ["running", "completed"].includes(rowState(r))) || null;
}

function tuitionStack(g) {

  const key = "tuition:" + g.demoId;
  const open = STATE.open.has(key);
  const editing = STATE.editing.has(key);
  const state = groupState(g);
  const railTone = tuitionRailTone(state);
  const f = g.first;
  const student = STUDENT_BY_ID[f.studentId];
  const studentName = student ? student.values["Student Name"] : f.studentId;
  const tutorRows = g.rows.filter(r => r.hasTutor);
  const terminated = state === "terminated";
  const assigned = railTone === "running" || railTone === "completed";
  const sv = field => (student && student.values[field]) || "";
  const studentKey = "student:" + g.demoId;
  const studentOpen = STATE.studentOpen.has(studentKey);
  const appliedLabel = `${tutorRows.length} Tutor${tutorRows.length === 1 ? "" : "s"} Applied`;
  const quickOpen = STATE.quickOpen.has(key);
  // Tapping "Finding Tutor" quick-opens to the assign field; tapping
  // "Running" or "Completed" quick-opens to just the Classes Completed
  // checkbox - in none of those cases should the whole card expand.
  const canQuickOpen = !terminated && (railTone === "new" || railTone === "running" || railTone === "completed");

  // "Classes Completed" moved up from the Tutor Applied card - it only
  // makes sense once a tutor is actually running the tuition, so it's
  // shown here (against that tutor's row) only while Running/Completed.
  const activeRow = activeRowFor(g);

  const completedBlock = activeRow ? `
    <label class="pill-check">
      <input type="checkbox" data-action="toggle-completed" data-row="${activeRow.rowNumber}" data-tutor-id="${esc(activeRow.tutorId)}"${activeRow.classesCompleted ? " checked" : ""}>
      <span class="pill-check-text">Classes Completed</span>
      <span class="pill-check-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </span>
    </label>` : "";

  const assignBlock = `
    <div class="admin-assign">
      <label class="admin-float">
        <input data-assign type="text" placeholder=" " autocomplete="off">
        <span>${STATE.me && STATE.me.hideContacts ? "Enter Tutor ID to assign a tutor" : "Enter Tutor ID or Mobile Number to assign a tutor"}</span>
      </label>
      <div class="admin-suggest hidden" data-suggest></div>
      <button class="admin-primary admin-wide" data-action="assign" type="button" disabled>Assign Tutor</button>
    </div>`;

  const tuitionBoxes = `
    <div class="admin-boxes">
      ${box("Demo ID", g.demoId)}
      ${box("Subject", f.subject, { editable: editing, attr: editing ? `data-tfield="Subject"` : "" })}
      ${box("Mode", editing ? (f.medium || "Any") : mediumText(f.medium), { editable: editing, options: ["Any", "Online", "Home"], attr: editing ? `data-tfield="Medium"` : "" })}
      ${box("Preferred Tutor", editing ? (f.preferredTutor || "Any") : genderText(f.preferredTutor), { editable: editing, options: ["Any", "Male", "Female"], attr: editing ? `data-tfield="Preferred Tutor"` : "" })}
      ${box("Preferred Timing", f.preferredTiming, { editable: editing, wide: true, attr: editing ? `data-tfield="Preferred Timing"` : "" })}
      ${box("Posted On", f.postedOn)}
    </div>`;

  const tuitionButtons = editing
    ? editButtons(key, true, "save-tuition", "Edit Tuition")
    : `<div class="admin-split${myPerms().tuitionsDelete ? " admin-split-3" : ""}">
         <button class="admin-ghost" data-action="edit" data-key="${esc(key)}" type="button">Edit Tuition</button>
         ${terminated
           ? `<button class="admin-ghost" data-action="reopen" type="button">Reopen Tuition</button>`
           : `<button class="admin-ghost admin-danger" data-action="terminate" type="button">Terminate Tuition</button>`}
         ${myPerms().tuitionsDelete
           ? `<button class="admin-ghost admin-danger" data-action="delete-tuition" type="button">Delete Tuition</button>`
           : ""}
       </div>`;

  // Top layer (coloured by status): Demo ID | Subject | Class | Gender of
  // Tutor | Mode | Tutor Applied. Bottom layer (grey): the student's Name |
  // Gender | Mobile | WhatsApp | Address | Pin Code. One column each, equal
  // width; anything too long for its column is cut with "...".
  const titleHtml = `
    <div class="admin-hl">
      <div class="admin-hl-top" data-tone="${esc(railTone)}">
        ${equalRow([g.demoId, f.subject, sv("Class"), genderText(f.preferredTutor), mediumText(f.medium), appliedLabel])}
      </div>
      <div class="admin-hl-small">
        ${equalRow([studentName, sv("Gender"), sv("Phone"), sv("WhatsApp"), fullAddress(sv("Address"), sv("City"), ""), sv("PIN Code")])}
      </div>
    </div>`;

  const head = `
    <article class="admin-card tuition-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}" data-box data-tone="${esc(railTone)}" data-demo="${esc(g.demoId)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        ${profileAvatar("students", f.studentId, initials(studentName, "S"), subscriptionPayBadge("student", f.studentId))}
        <div class="admin-card-title">${titleHtml}</div>
        <span class="admin-caret" aria-hidden="true"></span>
        <button type="button" class="admin-status-rail" data-tone="${railTone}"${canQuickOpen ? ` data-action="quick-open"` : ` tabindex="-1"`}>${esc(TUITION_RAIL_LABELS[railTone])}</button>
      </div>

      <div class="admin-card-body">

        ${completedBlock}

        ${quickOpen ? `
          ${assigned ? "" : assignBlock}
          <button class="admin-ghost admin-wide" data-action="show-full" data-key="${esc(key)}" type="button">Show Full Details</button>
        ` : `

          ${terminated || assigned ? "" : assignBlock}

          <h3 class="admin-section-title">Tuition</h3>
          ${tuitionBoxes}
          ${tuitionButtons}

          <h3 class="admin-section-title admin-section-toggle" data-action="toggle-student" data-key="${esc(studentKey)}">
            Student
            <span class="admin-caret-mini${studentOpen ? " is-open" : ""}" aria-hidden="true"></span>
          </h3>
          ${studentOpen ? (student ? fieldsBoxes("students", student, false) : note(`Student ${f.studentId} was not found.`)) : ""}

        `}

      </div>

    </article>
  `;

  const tutorCards = tutorRows
    .slice()
    .sort((a, b) => tutorOrder(rowState(a)) - tutorOrder(rowState(b)))
    .map(r => tutorRowCard(r, terminated))
    .join("");

  // Once a tutor is actually Running/Completed, the money side of this
  // Tuition (which days it meets, what's been paid against it) gets its
  // own card, sat above the Tuition card itself.
  const classCardHtml = activeRow ? classCard(g, activeRow) : "";

  return `<div class="admin-stack${tutorRows.length ? " has-tutors" : ""}${classCardHtml ? " has-class-card" : ""}">${classCardHtml}${head}${tutorCards}</div>`;

}

/* =====================================================================
   CLASS CARD
   The running-class part of a tuition: schedule, charges, advance payment
   and the Student/Tutor payment fractions.
   ===================================================================== */

// A separate card for the currently Running/Completed class's own
// schedule and money - which days it meets, its own charges/term dates,
// the Student's and Tutor's own payment terms (computed Total
// Payment/Dues, not typed in), their profiles, and every payment
// recorded against this Tuition, with a shortcut into recording a new
// one pre-filled with this Demo/Tutor ID.
// All the money maths shared between the Class card's Student/Tutor
// sections and the Agency Charge payment form, so the two can never
// disagree about what's owed.
function classMoney(g, activeRow) {

  const saved = activeRow.billingPlan && activeRow.billingPlan.deal;
  if (saved && saved.model) return dealMoney(g, activeRow, saved);

  // With a billing plan (calendar + Number of Classes / Hourly) the Amount
  // worked out there is the Tuition Fee; older cards keep the old formula.
  const studentTotalAmount = activeRow.billingMode
    ? num(activeRow.classTotalAmount)
    : (num(activeRow.classDuration) / 60) * num(activeRow.classCharges) * num(activeRow.classCount);
  const demoCollections = (STATE.payments || []).filter(p => p.demo_id === g.demoId && p.transaction_type === "collection");
  const studentAdvancePaid = demoCollections
    .filter(p => p.payment_type === "advance")
    .reduce((sum, p) => sum + num(p.amount), 0);
  const collected = demoCollections
    .filter(p => p.payment_type !== "advance")
    .reduce((sum, p) => sum + num(p.amount), 0);
  const studentDues = Math.max(studentTotalAmount - studentAdvancePaid - collected, 0);

  // Tutor's Total Amount is the same Tuition Fee as the Student's - it's
  // the one class, just looked at from the other side - so it's never
  // typed in separately either.
  const tutorTotalAmount = studentTotalAmount;
  const tutorAgencyCharge = num(activeRow.tutorAgencyCharge);
  const tutorPaid = (STATE.payments || [])
    .filter(p => p.tutor_id === activeRow.tutorId && p.transaction_type === "payout" && (!p.demo_id || p.demo_id === g.demoId));
  const tutorAdvance = num(activeRow.tutorAdvancePayment)
    + tutorPaid.filter(p => p.payment_type === "advance").reduce((sum, p) => sum + num(p.amount), 0);
  // A payout records which Tuition it's for; older ones without a Demo
  // ID still count against every Tuition that tutor is taking.
  const tutorPayouts = tutorPaid
    .filter(p => p.payment_type !== "advance")
    .reduce((sum, p) => sum + num(p.amount), 0);
  const tutorTotalPayment = tutorAdvance + tutorPayouts;
  // The tutor's Agency Charge isn't taken off here - the tutor pays it
  // in separately (its own "agency_charge" ledger below), so what the
  // agency owes the tutor is the full Tuition Fee less what's been paid.
  const tutorDues = Math.max(tutorTotalAmount - tutorTotalPayment, 0);

  // The agency's own cut on each side has its own real ledger - actual
  // "agency_charge" payments recorded against this Tuition, split by
  // whether it's the student/parent or the tutor paying it in (tutor_id
  // null vs set), never guessed from other money that moved.
  const agencyChargePayments = (STATE.payments || []).filter(p => p.demo_id === g.demoId && p.transaction_type === "agency_charge");
  const studentAgencyCharge = num(activeRow.studentAgencyCharge);
  const studentAgencyReceived = agencyChargePayments
    .filter(p => !p.tutor_id)
    .reduce((sum, p) => sum + num(p.amount), 0);
  const studentAgencyDue = Math.max(studentAgencyCharge - studentAgencyReceived, 0);

  const tutorAgencyReceived = agencyChargePayments
    .filter(p => p.tutor_id === activeRow.tutorId)
    .reduce((sum, p) => sum + num(p.amount), 0);
  const tutorAgencyDue = Math.max(tutorAgencyCharge - tutorAgencyReceived, 0);

  return {
    studentTotalAmount, studentAdvancePaid, collected, studentDues,
    tutorTotalAmount, tutorAgencyCharge, tutorAdvance, tutorPayouts, tutorTotalPayment, tutorDues,
    studentAgencyCharge, studentAgencyReceived, studentAgencyDue,
    tutorAgencyReceived, tutorAgencyDue
  };

}

// classMoney() for a class billed by a deal (see dealPanelHtml). Same shape
// as before, so the card's figures and the payment form keep working:
//   commission, fee to Agency: parent pays the agency the Monthly Fee, the
//     tutor is paid the fee less the cut (the cut is kept back - shown as paid)
//   commission, fee to Tutor:  no parent money via the agency; the tutor pays
//     the cut in (agency charge payments + balance used)
//   margin: parent pays the agency the month's classes, the tutor is paid
//     theirs; the margin stays with the agency
function dealMoney(g, activeRow, deal) {
  const m = dealNumbers(deal, (activeRow.classDates || []).length);
  const pays = (STATE.payments || []).filter(p => p.demo_id === g.demoId);
  const sum = (list) => list.reduce((s, p) => s + num(p.amount), 0);
  const studentAdvancePaid = sum(pays.filter(p => p.transaction_type === "collection" && p.payment_type === "advance"));
  const collected = sum(pays.filter(p => p.transaction_type === "collection" && p.payment_type !== "advance"))
    - sum(pays.filter(p => p.transaction_type === "refund"));
  const tutorPaid = (STATE.payments || []).filter(p => p.tutor_id === activeRow.tutorId && p.transaction_type === "payout" && (!p.demo_id || p.demo_id === g.demoId));
  const tutorAdvance = num(activeRow.tutorAdvancePayment) + sum(tutorPaid.filter(p => p.payment_type === "advance"));
  const tutorPayouts = sum(tutorPaid.filter(p => p.payment_type !== "advance"));
  const tutorTotalPayment = tutorAdvance + tutorPayouts;

  const viaAgency = m.model === "margin" || m.feeTo === "Agency";
  const studentTotalAmount = m.model === "margin" ? m.parentMonthly : (viaAgency ? m.monthlyFee : 0);
  const tutorTotalAmount = m.model === "margin" ? m.tutorMonthly : (viaAgency ? m.tutorFirstMonth : 0);
  const tutorAgencyCharge = m.model === "commission" ? m.cut : 0;
  const tutorAgencyReceived = m.model !== "commission" ? 0
    : (m.feeTo === "Agency" ? m.cut
      : sum(pays.filter(p => (p.transaction_type === "agency_charge" || p.transaction_type === "credit_used") && p.tutor_id === activeRow.tutorId)));
  const studentAgencyCharge = num(activeRow.studentAgencyCharge);
  const studentAgencyReceived = sum(pays.filter(p => p.transaction_type === "agency_charge" && !p.tutor_id));

  return {
    studentTotalAmount, studentAdvancePaid, collected,
    studentDues: Math.max(studentTotalAmount - studentAdvancePaid - collected, 0),
    tutorTotalAmount, tutorAgencyCharge, tutorAdvance, tutorPayouts, tutorTotalPayment,
    tutorDues: Math.max(tutorTotalAmount - tutorTotalPayment, 0),
    studentAgencyCharge, studentAgencyReceived, studentAgencyDue: Math.max(studentAgencyCharge - studentAgencyReceived, 0),
    tutorAgencyReceived, tutorAgencyDue: Math.max(tutorAgencyCharge - tutorAgencyReceived, 0),
  };
}

/* =====================================================================
   CLASS PLAN (Payments card, under the class days)
   Left: a month calendar - tap dates to pick the class days (light green).
   Right: how the class is billed - Number of Classes or Hourly. Each
   option has its own 4 boxes (Duration in Minutes | Number of Classes
   (= dates picked) | Price per Class or per Hour | Amount), kept apart so
   switching never mixes them:
     Number of Classes  ->  Amount = Price x Classes
     Hourly             ->  Amount = Price x Minutes/60 x Classes
   Typing a Price fills the Amount and typing an Amount fills the Price.
   Only in edit mode; saved with the panel's "Save" or "Save changes".
   Both options are stored (billing_plan); the chosen one also fills
   Class Duration / Charges / Total Amount. (STATE.calMonth keeps the
   month each card's calendar shows.)
   ===================================================================== */

const CAL_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CAL_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

function planDates(plan) {
  try { return JSON.parse(plan.dataset.dates || "[]"); } catch (e) { return []; }
}

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CAL_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function planLog(plan) {
  try { return JSON.parse(plan.dataset.log || "{}"); } catch (e) { return {}; }
}

// "2026-10-14" -> "14 Oct 2026"
function fmtPayDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${CAL_SHORT[Number(m[2]) - 1]} ${m[1]}` : "";
}

function isoPlusDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// the k-th payment date counted from the class start: weekly, every 15 days or monthly
function payDateAt(startISO, freq, k) {
  if (freq === "Weekly") return isoPlusDays(startISO, 7 * k);
  if (freq === "15 Days") return isoPlusDays(startISO, 15 * k);
  const [y, m, d] = startISO.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

// the next `n` parent payment dates (today or later); the tutor is paid a day after each
function payDates(start, freq, n = 4) {
  const startISO = toDateInput(start) || isoToday();
  const today = isoToday();
  let k = 0;
  while (k < 800 && payDateAt(startISO, freq, k) < today) k++;
  return Array.from({ length: n }, (_, i) => payDateAt(startISO, freq, k + i));
}

function nextPayDates(start, freq) {
  const parent = payDates(start, freq || "Monthly", 1)[0];
  return { parent, tutor: isoPlusDays(parent, 1) };
}

function calendarHtml(monthKey, dates, editing, log = {}, defMin = "", defTime = "", sel = "") {
  const [y, m] = monthKey.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7;          // Monday first
  const picked = new Set(dates);
  const today = isoToday();
  let cells = "";
  for (let i = 0; i < lead; i++) cells += `<span class="cal-empty"></span>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const on = picked.has(iso);
    const e = log[iso] || {};
    const mins = e.m || defMin;
    const time = e.t || defTime;
    const state = e.s === "done" ? " is-done" : e.s === "missed" ? " is-missed" : "";
    const meta = on ? `
      <small>${mins ? esc(mins) + "m" : "&nbsp;"}</small><small>${time ? esc(clock12(time)) : "&nbsp;"}</small>` : "";
    cells += `<button type="button" class="cal-day${on ? " is-on" : ""}${state}${iso === today ? " is-today" : ""}${iso === sel ? " is-sel" : ""}"
      data-action="cal-day" data-date="${iso}"${editing || on ? "" : " disabled"}><b>${day}</b>${meta}</button>`;
  }
  const inMonth = dates.filter(d => d.startsWith(monthKey)).length;
  const done = dates.filter(d => (log[d] || {}).s === "done").length;
  const missed = dates.filter(d => (log[d] || {}).s === "missed").length;

  let editor = "";
  if (sel && picked.has(sel) && !editing) {
    const e = log[sel] || {};
    const wd = new Date(sel + "T00:00:00");
    editor = `
      <div class="cal-pop"><div class="cal-pop-bg" data-action="day-close"></div>
      <div class="cal-edit" data-day-edit data-date="${sel}" data-s="${esc(e.s || "")}">
        <strong>${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][wd.getDay()]}, ${esc(fmtPayDate(sel))}</strong>
        <div class="cal-edit-status">
          <button type="button" class="day-opt${e.s === "done" ? " is-on" : ""}" data-action="day-status" data-s="done">Taken</button>
          <button type="button" class="day-opt is-bad${e.s === "missed" ? " is-on" : ""}" data-action="day-status" data-s="missed">Not Taken</button>
          <button type="button" class="day-opt${!e.s ? " is-on" : ""}" data-action="day-status" data-s="">Pending</button>
        </div>
        <div class="cal-edit-fields">
          <label class="admin-box is-edit"><input type="number" min="1" max="600" data-day-m value="${esc(e.m || defMin)}"><span>Duration (minutes)</span></label>
          <label class="admin-box is-edit"><input type="time" data-day-t value="${esc(e.t || defTime)}"><span>Class time</span></label>
        </div>
        <div class="admin-pair">
          <button class="admin-ghost" type="button" data-action="day-close">Close</button>
          <button class="admin-primary" type="button" data-action="day-save">Save Day</button>
        </div>
      </div></div>`;
  }

  return `
    <div class="cal-head">
      <button type="button" class="cal-nav" data-action="cal-month" data-step="-1" aria-label="Previous month"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M15 5l-7 7 7 7"/></svg></button>
      <strong>${CAL_MONTHS[m - 1]} ${y}</strong>
      <button type="button" class="cal-nav" data-action="cal-month" data-step="1" aria-label="Next month"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
    <div class="cal-grid">
      ${CAL_WEEKDAYS.map(w => `<span class="cal-wd">${w}</span>`).join("")}
      ${cells}
    </div>
    <p class="cal-note">
      <span class="cal-chip">${dates.length} ${dates.length === 1 ? "Class" : "Classes"} Scheduled${inMonth !== dates.length ? ` (${inMonth} This Month)` : ""}</span>
      <span class="cal-chip cal-ok">${done} Taken</span>
      <span class="cal-chip cal-bad">${missed} Not Taken</span>
    </p>
    ${editing ? "" : '<p class="cal-hint">Tap a scheduled date to correct it</p>'}
    ${editor}`;
}

function classPlanHtml(g, activeRow, editing, extra = {}) {

  const dates = (activeRow.classDates || []).slice().sort();
  STATE.calMonth = STATE.calMonth || {};
  const monthKey = STATE.calMonth[g.demoId]
    || (dates[0] || toDateInput(activeRow.classStartDate) || isoToday()).slice(0, 7);
  STATE.calMonth[g.demoId] = monthKey;

  return `
    <div class="class-plan" data-class-plan data-month="${esc(monthKey)}" data-dates='${esc(JSON.stringify(dates))}' data-log='${esc(JSON.stringify(activeRow.classLog || {}))}'>
      <div class="class-top">
        <div class="class-cal">
          <div data-cal>${calendarHtml(monthKey, dates, editing, activeRow.classLog || {}, dealOf(activeRow).minutes || "", dealOf(activeRow).time || "")}</div>
          ${extra.terms || ""}
        </div>
        <div class="admin-class-parties">${extra.parties || ""}</div>
      </div>
      ${dealPanelHtml(g, activeRow, editing, dates.length)}
    </div>`;
}

/* =====================================================================
   THE DEAL (how a running class is billed) - right of the calendar
     Monthly Commission: a monthly deal (classes a month, Monthly Fee); the
       agency takes a cut (% or Rs.) of the FIRST month's fee, from the tutor,
       once. The first month's fee goes to the tutor (who pays the cut) or to
       the agency (which keeps the cut and pays the rest on).
     Per Class Commission: the parent pays the agency a price per class; the agency
       keeps a margin (% or Rs.) and pays the tutor the rest, every month.
   Number of Classes = the dates picked on the calendar; Per Class / Per Hour
   and the monthly figures work themselves out. Parent / tutor can pay Weekly,
   every 15 Days or Monthly. "Save & Send Agreement" finalises the class and
   emails / Telegrams the agreement (parent copy without the agency's cut).
   Same maths as supabase/functions/_shared/deal.ts.
   ===================================================================== */

const DEAL_FREQ = { "Weekly": 4, "15 Days": 2, "Monthly": 1 };

function dealNumbers(deal, classes) {
  const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const r = Math.round;
  const minutes = n(deal.minutes);
  const hours = classes * minutes / 60;
  const pK = DEAL_FREQ[deal.parentFreq] || 1;
  const tK = DEAL_FREQ[deal.tutorFreq] || 1;
  if (deal.model === "margin") {
    const P = n(deal.parentPerClass);
    const margin = deal.marginType === "percent" ? P * n(deal.marginValue) / 100 : n(deal.marginValue);
    const T = P - margin;
    return {
      model: "margin", classes, minutes, hours,
      parentPerClass: r(P), parentPerHour: minutes ? r(P * 60 / minutes) : 0,
      margin: r(margin), tutorPerClass: r(T), tutorPerHour: minutes ? r(T * 60 / minutes) : 0,
      parentMonthly: r(classes * P), tutorMonthly: r(classes * T), agencyMonthly: r(classes * margin),
      parentInstallment: r(classes * P / pK), tutorInstallment: r(classes * T / tK),
    };
  }
  const fee = n(deal.monthlyFee);
  const cut = deal.cutType === "percent" ? fee * n(deal.cutValue) / 100 : n(deal.cutValue);
  return {
    model: "commission", classes, minutes, hours,
    monthlyFee: r(fee), perClass: classes ? r(fee / classes) : 0, perHour: hours ? r(fee / hours) : 0,
    cut: r(cut), cutPercent: fee ? Math.round(cut / fee * 1000) / 10 : 0,
    feeTo: deal.feeTo === "Agency" ? "Agency" : "Tutor",
    tutorFirstMonth: r(fee - cut),
    parentInstallment: r(fee / pK), cutInstallment: r(cut / tK), tutorInstallment: r((fee - cut) / tK),
  };
}

// the saved deal, or one made from an older card's own numbers
function dealOf(activeRow) {
  const saved = (activeRow.billingPlan && activeRow.billingPlan.deal) || null;
  if (saved && saved.model) return saved;
  return {
    model: "commission", minutes: activeRow.classDuration || "", time: "",
    monthlyFee: activeRow.classTotalAmount || "", feeTo: activeRow.studentPaymentTo === "Agency" ? "Agency" : "Tutor",
    cutType: "percent", cutValue: "", parentPerClass: activeRow.classCharges || "", marginType: "amount", marginValue: "",
    parentFreq: activeRow.studentPaymentFrequency || "Monthly", tutorFreq: activeRow.tutorPaymentFrequency || "Monthly",
  };
}

// a tutor's balance: extra commission kept for them, less what's been used
function tutorBalance(tutorId) {
  const sum = t => (STATE.payments || []).filter(p => p.tutor_id === tutorId && p.transaction_type === t)
    .reduce((s, p) => s + num(p.amount), 0);
  return sum("tutor_credit") - sum("credit_used");
}

function dealPanelHtml(g, activeRow, editing, count) {
  const d = dealOf(activeRow);
  const m = dealNumbers(d, count);
  const inp = (label, key, value, opts = {}) => box(label, value ?? "", { editable: editing, type: opts.type || "number",
    options: opts.options, attr: `data-d="${key}"${opts.type ? "" : ' min="0"'}` });
  const out = (label, key, value) => box(label, value, { attr: `data-out="${key}"` });
  const rs = v => "₹" + Number(v || 0).toLocaleString("en-IN");
  const kind = (key, value) => editing
    ? `<select class="deal-kind" data-d="${key}"><option value="percent"${value === "percent" ? " selected" : ""}>%</option><option value="amount"${value !== "percent" ? " selected" : ""}>₹</option></select>`
    : `<span class="deal-kind-text">${value === "percent" ? "%" : "₹"}</span>`;
  const finalized = d.finalizedAt;
  const settled = d.settled;
  const balance = tutorBalance(activeRow.tutorId);
  const pay = nextPayDates(activeRow.classStartDate, d.parentFreq || "Monthly");

  return `
    <div class="class-bill deal" data-deal data-model="${d.model === "margin" ? "margin" : "commission"}">
      <div class="bill-seg" role="radiogroup" aria-label="How this class is billed">
        <button type="button" class="bill-opt${d.model !== "margin" ? " is-on" : ""}" data-action="deal-model" data-model="commission"${editing ? "" : " disabled"}>Monthly commission</button>
        <button type="button" class="bill-opt${d.model === "margin" ? " is-on" : ""}" data-action="deal-model" data-model="margin"${editing ? "" : " disabled"}>Per class commission</button>
      </div>

      <div class="deal-grid deal-row4">
        <div class="deal-slot" data-set="commission">${inp("Monthly fee (₹)", "monthlyFee", d.monthlyFee)}</div>
        <div class="deal-slot" data-set="margin">${inp("Parent pays per class (₹)", "parentPerClass", d.parentPerClass)}</div>
        <label class="admin-box deal-cut${editing ? " is-edit" : ""}" data-set="commission">${kind("cutType", d.cutType)}<input type="number" min="0" data-d="cutValue" value="${esc(d.cutValue ?? "")}"${editing ? "" : " readonly"}><span>Agency cut (first month)</span></label>
        <label class="admin-box deal-cut${editing ? " is-edit" : ""}" data-set="margin">${kind("marginType", d.marginType)}<input type="number" min="0" data-d="marginValue" value="${esc(d.marginValue ?? "")}"${editing ? "" : " readonly"}><span>Agency commission per class</span></label>
        <div class="deal-slot">${inp("Duration (minutes)", "minutes", d.minutes)}</div>
        <div class="deal-slot">${inp("Class time", "time", d.time, { type: "time" })}</div>
      </div>

      <div class="deal-grid deal-row2">
        ${inp("Parent pays", "parentFreq", d.parentFreq || "Monthly", { type: "text", options: Object.keys(DEAL_FREQ) })}
        <div class="deal-slot" data-set="commission">${inp("Payment to", "feeTo", d.feeTo || "Tutor", { type: "text", options: ["Agency", "Tutor"] })}</div>
        <label class="admin-box" data-set="margin"><input type="text" readonly value="Agency" data-out="margPayTo"><span>Payment to</span></label>
      </div>

      <div class="deal-grid deal-auto">
        ${out("Number of classes", "classes", count)}
        ${out("Hours", "hours", Math.round(m.hours * 100) / 100)}
        <div class="deal-slot" data-set="commission">${out("Per class (₹)", "perClass", m.perClass || 0)}</div>
        <div class="deal-slot" data-set="commission">${out("Per hour (₹)", "perHour", m.perHour || 0)}</div>
        <div class="deal-slot" data-set="commission">${out("Agency cut (₹)", "cut", m.cut || 0)}</div>
        <div class="deal-slot" data-set="commission">${out("Tutor gets, 1st month (₹)", "tutorFirstMonth", m.tutorFirstMonth || 0)}</div>
        <div class="deal-slot" data-set="margin">${out("Parent per hour (₹)", "parentPerHour", m.parentPerHour || 0)}</div>
        <div class="deal-slot" data-set="margin">${out("Agency per class (₹)", "margin", m.margin || 0)}</div>
        <div class="deal-slot" data-set="margin">${out("Tutor per class (₹)", "tutorPerClass", m.tutorPerClass || 0)}</div>
        <div class="deal-slot" data-set="margin">${out("Tutor per hour (₹)", "tutorPerHour", m.tutorPerHour || 0)}</div>
        <div class="deal-slot" data-set="margin">${out("Parent per month (₹)", "parentMonthly", m.parentMonthly || 0)}</div>
        <div class="deal-slot" data-set="margin">${out("Tutor per month (₹)", "tutorMonthly", m.tutorMonthly || 0)}</div>
        <div class="deal-slot" data-set="margin">${out("Agency per month (₹)", "agencyMonthly", m.agencyMonthly || 0)}</div>
      </div>

      <div class="deal-grid deal-auto">
        ${out("Each parent payment (₹)", "parentInstallment", m.parentInstallment || 0)}
        ${out("Parent pays on", "parentDate", fmtPayDate(pay.parent))}
        ${out("Each tutor payment (₹)", "tutorInstallment", (m.model === "commission" && m.feeTo === "Tutor" ? m.cutInstallment : m.tutorInstallment) || 0)}
        ${out("Tutor paid / pays on", "tutorDate", fmtPayDate(pay.tutor))}
      </div>
      <p class="deal-sched" data-sched>${schedText(activeRow.classStartDate, d.parentFreq || "Monthly")}</p>

      <p class="deal-note" data-deal-note>${esc(dealNoteText(m))}</p>
      ${balance ? `<p class="deal-balance">Tutor's balance: <strong>${rs(balance)}</strong>${balance > 0 ? " - used against this commission when the class is finalised" : ""}</p>` : ""}
      ${finalized ? `<p class="deal-final">Finalised ${esc(fmtShortDate(finalized))}${d.agreementSentAt ? ` · Agreement sent ${esc(fmtShortDate(d.agreementSentAt))}` : ""}</p>` : ""}
      ${settled ? `<p class="deal-final is-settled">Settled ${esc(fmtShortDate(settled.at))} · ${esc(settled.classesDone)} class(es) taken${settled.refund ? ` · Refund ${rs(settled.refund)}` : ""}${settled.credit ? ` · Tutor balance ${rs(settled.credit)}` : ""}</p>` : ""}

      ${editing
        ? `<div class="admin-pair deal-actions">
             <button class="admin-ghost bill-save" data-action="save-class-details" type="button">Save</button>
             <button class="admin-primary" data-action="finalize-class" type="button">${finalized ? "Save & Resend Agreement" : "Save & Send Agreement"}</button>
           </div>`
        : (finalized && !settled ? `<button class="admin-ghost admin-wide deal-settle-btn" data-action="settle-class" type="button">Tutor Left / Fewer Classes - Settle</button>` : "")}
      <div class="deal-settle hidden" data-settle></div>
    </div>`;
}

function schedText(start, freq) {
  const list = payDates(start, freq, 4);
  return `Parent pays: ${list.map(fmtPayDate).join(" · ")}<br>Tutor: ${list.map(x => fmtPayDate(isoPlusDays(x, 1))).join(" · ")}`;
}

function fmtShortDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function dealNoteText(m) {
  if (m.model === "margin") {
    return `Parent pays ₹${m.parentPerClass} a class → agency keeps ₹${m.margin}, tutor gets ₹${m.tutorPerClass}. ` +
      `${m.classes} classes a month: parent ₹${m.parentMonthly}, tutor ₹${m.tutorMonthly}, agency ₹${m.agencyMonthly}.`;
  }
  return `${m.classes} classes a month for ₹${m.monthlyFee}. Agency takes ₹${m.cut}${m.cutPercent ? ` (${m.cutPercent}%)` : ""} once, from the first month. ` +
    (m.feeTo === "Agency" ? `First month's fee comes to the agency; tutor gets ₹${m.tutorFirstMonth}.` : `Fee goes to the tutor; tutor pays the agency ₹${m.cut}.`);
}

// what the deal panel holds right now
function readDeal(panel) {
  const deal = { model: panel.dataset.model };
  panel.querySelectorAll("[data-d]").forEach(el => { deal[el.dataset.d] = el.value.trim(); });
  deal.tutorFreq = deal.parentFreq;
  return deal;
}

function recalcDeal(panel) {
  if (!panel) return;
  const plan = panel.closest("[data-class-plan]");
  const count = plan ? planDates(plan).length : 0;
  const m = dealNumbers(readDeal(panel), count);
  const set = (k, v) => panel.querySelectorAll(`[data-out="${k}"]`).forEach(el => { el.value = v; });
  set("classes", count);
  set("hours", Math.round(m.hours * 100) / 100);
  Object.keys(m).forEach(k => { if (typeof m[k] === "number") set(k, m[k]); });
  set("tutorInstallment", (m.model === "commission" && m.feeTo === "Tutor" ? m.cutInstallment : m.tutorInstallment) || 0);
  const note = panel.querySelector("[data-deal-note]");
  if (note) note.textContent = dealNoteText(m);

  // payment dates follow the class start date and how often the parent pays
  const card = panel.closest("[data-demo]");
  const start = card && card.querySelector('[data-term="start"]');
  const deal = readDeal(panel);
  const freq = deal.parentFreq || "Monthly";
  const pay = nextPayDates(start ? start.value : "", freq);
  set("parentDate", fmtPayDate(pay.parent));
  set("tutorDate", fmtPayDate(pay.tutor));
  const sched = panel.querySelector("[data-sched]");
  if (sched) sched.innerHTML = schedText(start ? start.value : "", freq);
  if (card) {
    const viaTutor = m.model === "commission" && m.feeTo === "Tutor";
    const sync = (k, v) => card.querySelectorAll(`[data-sync="${k}"]`).forEach(el => { el.textContent = v; });
    sync("studentTo", m.model === "commission" ? m.feeTo : "Agency");
    sync("tutorFrom", viaTutor ? "Parents" : "Agency");
    sync("freq", freq);
    sync("studentDate", fmtPayDate(pay.parent));
    sync("tutorDate", fmtPayDate(pay.tutor));
  }
}

/* Tutor left / fewer classes than agreed:
     parent  - paid (collections less refunds) vs what the classes taken cost
               -> the difference is refunded to the parent
     tutor   - commission paid in (agency charge + balance used) vs the cut for
               the classes taken (cut x taken / agreed) -> the extra becomes the
               tutor's balance for their next tuition */
function settleNumbers(g, activeRow, done) {
  const d = dealOf(activeRow);
  const agreed = (activeRow.classDates || []).length;
  const m = dealNumbers(d, agreed);
  const pays = (STATE.payments || []).filter(p => p.demo_id === g.demoId);
  const total = (t, tutor) => pays.filter(p => p.transaction_type === t && (tutor === undefined || (tutor ? p.tutor_id === activeRow.tutorId : !p.tutor_id)))
    .reduce((s, p) => s + num(p.amount), 0);
  const parentPaid = total("collection") - total("refund");
  const parentCost = m.model === "margin" ? done * m.parentPerClass
    : (m.feeTo === "Agency" ? (agreed ? Math.round(m.monthlyFee * done / agreed) : 0) : 0);
  const commissionPaid = total("agency_charge", true) + total("credit_used", true);
  const commissionDue = m.model === "commission" && m.feeTo === "Tutor" && agreed ? Math.round(m.cut * done / agreed) : 0;
  return {
    agreed, parentPaid, parentCost, refund: Math.max(parentPaid - parentCost, 0),
    commissionPaid, commissionDue, model: m.model,
    // only a commission the tutor paid in can be too much (margin: the agency pays the tutor)
    credit: m.model === "commission" && m.feeTo === "Tutor" ? Math.max(commissionPaid - commissionDue, 0) : 0,
  };
}

function settleHtml(g, activeRow, done) {
  const x = settleNumbers(g, activeRow, done);
  const rs = v => "₹" + Number(v || 0).toLocaleString("en-IN");
  return `
    <h4>Tutor Left / Fewer Classes</h4>
    <div class="deal-grid">
      ${box("Classes Agreed", x.agreed)}
      <label class="admin-box is-edit"><input type="number" min="0" data-settle-done value="${esc(done)}"><span>Classes Taken</span></label>
      ${box("Parent Paid (₹)", x.parentPaid)}
      ${box("Classes Taken Cost (₹)", x.parentCost)}
      <label class="admin-box is-edit"><input type="number" min="0" data-settle-refund value="${esc(x.refund)}"><span>Refund to Parent (₹)</span></label>
      ${x.model === "commission" ? box("Commission Paid by Tutor (₹)", x.commissionPaid) + box("Commission for Classes Taken (₹)", x.commissionDue) : ""}
      <label class="admin-box is-edit"><input type="number" min="0" data-settle-credit value="${esc(x.credit)}"><span>Add to Tutor's Balance (₹)</span></label>
      ${box("Refund Mode", "Online", { editable: true, options: ["Online", "Offline"], attr: "data-settle-mode" })}
    </div>
    <p class="deal-note">The parent gets ${rs(x.refund)} back. ${x.credit ? `${rs(x.credit)} stays as the tutor's balance and is used against their next tuition's commission.` : "Nothing is added to the tutor's balance."} This class is then marked completed.</p>
    <div class="admin-pair">
      <button class="admin-primary" data-action="settle-confirm" type="button">Settle</button>
      <button class="admin-ghost" data-action="settle-cancel" type="button">Cancel</button>
    </div>`;
}

function openSettlePanel(box) {
  const g = demoGroups().find(x => x.demoId === box.dataset.demo);
  const activeRow = g ? activeRowFor(g) : null;
  const panel = box.querySelector("[data-settle]");
  if (!activeRow || !panel) return;
  panel.innerHTML = settleHtml(g, activeRow, Number(activeRow.classCount) || 0);
  panel.classList.remove("hidden");
  openSettlePanelRewire(panel, g, activeRow);
}
// changing Classes Taken redoes the numbers
function openSettlePanelRewire(panel, g, activeRow) {
  panel.querySelector("[data-settle-done]").addEventListener("change", (e) => {
    panel.innerHTML = settleHtml(g, activeRow, Math.max(Number(e.target.value) || 0, 0));
    openSettlePanelRewire(panel, g, activeRow);
  });
}

async function confirmSettle(box, button) {
  const panel = box.querySelector("[data-settle]");
  const v = sel => panel.querySelector(sel).value;
  const ok = await askConfirm({
    title: `Settle ${box.dataset.demo}?`,
    lines: [`Refund to parent: ₹${num(v("[data-settle-refund]"))} · Tutor's balance: ₹${num(v("[data-settle-credit]"))}`,
            "These are recorded and the class is marked completed."],
  });
  if (!ok) return;
  await save({
    action: "adminSettleClass", demoId: box.dataset.demo, tutorId: box.dataset.tutorId,
    classesDone: v("[data-settle-done]"), parentRefund: v("[data-settle-refund]"), tutorCredit: v("[data-settle-credit]"),
    paymentMode: v("[data-settle-mode]"),
  }, button);
}

// The older Number of Classes / Hourly helpers stay for cards saved before the deal.
function planNoteText(hourly, n, minutes) {
  const hrs = Math.round(n * minutes / 60 * 100) / 100;
  return hourly
    ? `${n} class${n === 1 ? "" : "es"} × ${minutes || 0} min = ${hrs} hr${hrs === 1 ? "" : "s"} · Amount = Price per Hour × ${hrs}`
    : `Amount = Price per Class × ${n} class${n === 1 ? "" : "es"}`;
}

// the Duration / Price / Amount typed in one option ("classes" or "hourly")
function billSetValues(plan, set) {
  const q = k => plan.querySelector(`[data-set="${set}"] [data-bill="${k}"]`);
  return { minutes: q("minutes").value.trim(), price: q("price").value.trim(), amount: q("amount").value.trim() };
}

// keeps Number of Classes, the notes and Price <-> Amount in step.
// The two options never touch each other's boxes.
function recalcClassPlan(plan, changedEl) {
  const n = planDates(plan).length;
  const round2 = v => String(Math.round(v * 100) / 100);
  plan.querySelectorAll(".bill-set").forEach(setEl => {
    const q = k => setEl.querySelector(`[data-bill="${k}"]`);
    const hourly = setEl.dataset.set === "hourly";
    const minutes = num(q("minutes").value);
    const units = hourly ? n * (minutes / 60) : n;
    const price = q("price"), amount = q("amount");
    q("count").value = n;
    if (!price.readOnly) {
      if (changedEl === amount) {
        price.value = amount.value === "" ? "" : (units > 0 ? round2(num(amount.value) / units) : price.value);
      } else if (price.value !== "") {
        amount.value = round2(num(price.value) * units);
      }
    }
    const note = setEl.querySelector("[data-bill-note]");
    if (note) note.textContent = planNoteText(hourly, n, minutes);
  });
}

function redrawCalendar(plan) {
  const editing = !!plan.querySelector('[data-action="deal-model"]:not([disabled])');
  const panel = plan.querySelector("[data-deal]");
  const deal = panel ? readDeal(panel) : {};
  plan.querySelector("[data-cal]").innerHTML = calendarHtml(plan.dataset.month, planDates(plan), editing,
    planLog(plan), deal.minutes || "", deal.time || "", plan.dataset.sel || "");
}

// clicks on the plan (calendar days / months, billing option, day editor)
function onClassPlanClick(actionEl) {
  const plan = actionEl.closest("[data-class-plan]");
  if (!plan) return;
  const action = actionEl.dataset.action;
  const editing = !!plan.querySelector('[data-action="deal-model"]:not([disabled])');
  if (action === "cal-month") {
    const [y, m] = plan.dataset.month.split("-").map(Number);
    const d = new Date(y, m - 1 + Number(actionEl.dataset.step), 1);
    plan.dataset.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const card = plan.closest("[data-demo]");
    if (card) { STATE.calMonth = STATE.calMonth || {}; STATE.calMonth[card.dataset.demo] = plan.dataset.month; }
    redrawCalendar(plan);
  } else if (action === "cal-day") {
    const iso = actionEl.dataset.date;
    if (editing) {
      const dates = new Set(planDates(plan));
      if (dates.has(iso)) dates.delete(iso); else dates.add(iso);
      const sorted = [...dates].sort();
      plan.dataset.dates = JSON.stringify(sorted);
      if (sorted.length) {
        const st = plan.querySelector('[data-term="start"]'), en = plan.querySelector('[data-term="end"]');
        const put = (el, iso) => {
          if (!el) return;
          el.value = iso;
          const t = el.parentNode.querySelector("[data-term-text]");
          if (t) t.textContent = fmtPayDate(iso);
        };
        put(st, sorted[0]);
        put(en, sorted[sorted.length - 1]);
      }
      redrawCalendar(plan);
      recalcDeal(plan.querySelector("[data-deal]"));
    } else {
      plan.dataset.sel = plan.dataset.sel === iso ? "" : iso;
      redrawCalendar(plan);
    }
  } else if (action === "day-status") {
    const ed = actionEl.closest("[data-day-edit]");
    ed.dataset.s = actionEl.dataset.s;
    ed.querySelectorAll(".day-opt").forEach(b => b.classList.toggle("is-on", b === actionEl));
  } else if (action === "day-close") {
    plan.dataset.sel = "";
    redrawCalendar(plan);
  } else if (action === "deal-feeto") {
    const panel = plan.querySelector("[data-deal]");
    panel.querySelector('[data-d="feeTo"]').value = actionEl.dataset.v;
    panel.querySelectorAll(".pay-opt").forEach(b => b.classList.toggle("is-on", b === actionEl));
    recalcDeal(panel);
  } else if (action === "deal-model") {
    const panel = plan.querySelector("[data-deal]");
    panel.dataset.model = actionEl.dataset.model;
    panel.querySelectorAll(".bill-opt").forEach(b => b.classList.toggle("is-on", b === actionEl));
    recalcDeal(panel);
  }
}

// admin corrects one scheduled day (taken / not taken, minutes, time)
async function saveClassDay(box, button) {
  const ed = button.closest("[data-day-edit]");
  const plan = box.querySelector("[data-class-plan]");
  if (!ed || !plan) return;
  const entry = { s: ed.dataset.s || "", m: ed.querySelector("[data-day-m]").value.trim(), t: ed.querySelector("[data-day-t]").value.trim() };
  const ok = await save({ action: "adminSetClassDay", demoId: box.dataset.demo, tutorId: box.dataset.tutorId, date: ed.dataset.date, entry }, button);
  if (ok) { plan.dataset.sel = ""; rerenderCurrent(); }
}

// typing / picking anything in the deal
["input", "change"].forEach(type => document.addEventListener(type, (event) => {
  const field = event.target.closest && event.target.closest("[data-deal] [data-d]");
  if (field) {
    recalcDeal(field.closest("[data-deal]"));
    if (field.dataset.d === "minutes" || field.dataset.d === "time") {
      const plan = field.closest("[data-class-plan]");
      if (plan) redrawCalendar(plan);
    }
  }
}));

function classCard(g, activeRow) {

  const key = "class:" + g.demoId;
  const open = STATE.open.has(key);
  const editing = STATE.editing.has(key);
  const student = STUDENT_BY_ID[g.first.studentId];
  const tutor = TUTOR_BY_ID[activeRow.tutorId];
  const sv = field => (student && student.values[field]) || "";
  const tv = field => (tutor && tutor.values[field]) || "";

  const cfield = f => editing ? `data-cfield="${esc(f)}"` : "";
  // Outside edit mode, tapping one of these figures opens a New Payment
  // for it straight away - only while it still has dues.
  // (Advance is always allowed; the rest go inert at zero dues.)
  const jump = kind => {
    const left = {
      "student-agency": studentAgencyCharge - studentAgencyReceived, "tutor-agency": tutorAgencyCharge - tutorAgencyReceived,
      "student-payment": studentDues, "tutor-payment": tutorDues
    }[kind];
    return `data-action="class-figure" data-kind="${kind}"${left !== undefined && !(left > 0) ? ' data-empty="1"' : ""}`;
  };

  // Start Date is the first scheduled class and End Date the last one - they
  // follow the calendar by themselves. The next payment dates are worked out
  // from the start date and how often the parent pays (the tutor a day later).
  const todayISO = new Date().toISOString().slice(0, 10);
  const sched = (activeRow.classDates || []).slice().sort();
  const startISO = sched[0] || toDateInput(activeRow.classStartDate) || todayISO;
  const endISO = sched[sched.length - 1] || toDateInput(activeRow.classEndDate) || startISO;
  const dmy = iso => iso.split("-").reverse().join("/");
  const startDateShown = editing ? startISO : dmy(startISO);
  const endDateShown = editing ? endISO : dmy(endISO);
  const deal0 = dealOf(activeRow);
  const freq0 = deal0.parentFreq || "Monthly";
  const pay0 = nextPayDates(startDateShown, freq0);
  const dm0 = dealNumbers(deal0, (activeRow.classDates || []).length);
  const studentTo0 = dm0.model === "commission" ? dm0.feeTo : "Agency";
  const tutorFrom0 = dm0.model === "commission" && dm0.feeTo === "Tutor" ? "Parents" : "Agency";

  const termTile = (label, sub, which, iso, field) => `
    <div class="term-tile">
      <b data-term-text="${which}">${esc(fmtPayDate(iso))}</b>
      <small>${label} (${sub})</small>
      <input type="hidden" ${editing ? `data-cfield="${field}" ` : ""}data-term="${which}" value="${esc(iso)}">
    </div>`;
  const tuitionTermsBoxes = `
    <div class="cal-terms">
      ${termTile("Start Date", "First Class", "start", startISO, "Class Start Date")}
      ${termTile("End Date", "Last Class", "end", endISO, "Class End Date")}
    </div>`;

  // Student's Total Amount is never typed in - it's Class Duration x
  // Per hour Charges x Number of Classes, so it moves on its own the
  // moment any of those change. Advance Payment and Total Payment are
  // the same: both read straight off the payments actually recorded
  // against this Tuition ID (split by Payment Type - "advance" feeds
  // Advance Payment, "regular"/"final" feed Total Payment, so the two
  // never double-count each other), and Dues is Total Amount less both.
  const {
    studentTotalAmount, studentAdvancePaid, collected, studentDues,
    tutorTotalAmount, tutorAdvance, tutorTotalPayment, tutorDues,
    studentAgencyCharge, studentAgencyReceived,
    tutorAgencyCharge, tutorAgencyReceived
  } = classMoney(g, activeRow);

  // Student and Tutor: two identical cards that follow the deal (who is paid,
  // how often, on which date) and show this class's own money.
  const stat = (label, value, kind, extra = "", text = "") => {
    const attr = !editing && kind ? jump(kind) : "";
    const tag = attr ? 'button type="button"' : "div";
    return `<${tag} class="pc-stat${extra}" ${attr}><small>${label.includes("<br>") ? label : esc(label)}</small><b>${text || esc(rupees(value))}</b></${attr ? "button" : "div"}>`;
  };
  const editStat = (label, value, field, wide) => box(label, value, { editable: true, wide, type: "number", attr: cfield(field) });
  const phone = (n, wa) => n ? `<span class="pc-num${wa ? " is-wa" : ""}"><i class="pc-ico">${wa
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.47-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.08-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.89 9.88m8.41-18.3A11.8 11.8 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>'}</i>${esc(n)}</span>` : "";
  const pcFrac = (paid, total) => `<span class="pc-frac"><i>${esc(rupees(paid))}</i><i>${esc(rupees(total))}</i></span>`;
  const party = (cls, avatar, name, id, mobile, whatsapp, payLabel, payValue, syncKey, dueSync, dueValue, stats) => `
    <section class="pc ${cls}">
      <header class="pc-head">
        ${avatar}
        <div class="pc-who"><h3>${esc(name || "-")}</h3><span class="pc-id">${esc(id || "")}</span></div>
      </header>
      <div class="pc-nums">${phone(mobile, false)}${phone(whatsapp, true)}</div>
      <div class="pc-terms">
        <div><small>${payLabel}</small><b class="pc-chip" data-sync="${syncKey}">${esc(payValue)}</b></div>
        <div><small>Frequency</small><b data-sync="freq">${esc(freq0)}</b></div>
        <div class="pc-due"><small>Next Due Date</small><b data-sync="${dueSync}">${esc(dueValue)}</b></div>
      </div>
      <div class="pc-stats">${stats}</div>
    </section>`;

  const studentId = g.first.studentId;
  const studentSection = party("pc-student",
    profileAvatar("students", studentId, initials(sv("Student Name"), "S"), subscriptionPayBadge("student", studentId)),
    sv("Student Name"), studentId, sv("Phone"), sv("WhatsApp"),
    "Pays To", studentTo0, "studentTo", "studentDate", fmtPayDate(pay0.parent),
    `${stat("Total Amount", studentTotalAmount, "student-payment")}
     ${stat("Advance", studentAdvancePaid, "student-advance")}
     ${stat("Paid", collected, "student-payment")}
     ${stat("Dues", studentDues, "", studentDues > 0 ? " is-due" : "")}
     ${editing
       ? editStat("Agency Charge (₹)", activeRow.studentAgencyCharge || 0, "Student Agency Charge", true)
       : stat("Agency<br>Charges", 0, "student-agency", " pc-wide", pcFrac(studentAgencyReceived, studentAgencyCharge))}`);

  const tutorId = activeRow.tutorId;
  const bal = tutorBalance(tutorId);
  const tutorSection = party("pc-tutor",
    profileAvatar("tutors", tutorId, initials(tv("Full Name"), "T"), subscriptionPayBadge("tutor", tutorId)),
    tv("Full Name"), tutorId, tv("Mobile Number"), tv("WhatsApp Number"),
    "Paid By", tutorFrom0, "tutorFrom", "tutorDate", fmtPayDate(pay0.tutor),
    `${stat("Total Amount", tutorTotalAmount, "tutor-payment")}
     ${editing ? editStat("Advance (₹)", activeRow.tutorAdvancePayment, "Tutor Advance Payment") : stat("Advance", tutorAdvance, "tutor-advance")}
     ${stat("Paid", tutorTotalPayment, "tutor-payment")}
     ${stat("Dues", tutorDues, "", tutorDues > 0 ? " is-due" : "")}
     ${stat("Agency<br>Charges", 0, "tutor-agency", " pc-wide", pcFrac(tutorAgencyReceived, tutorAgencyCharge))}
     ${bal ? stat("Balance", bal, "", " pc-wide") : ""}`);

  // Collapsed head: 4 fraction figures in one row - Student's own Total
  // Payment/Total Amount on the far left, Tutor's on the far right, and
  // each side's own Agency Payment/Agency Amount centred between them
  // (Student's agency fraction first, then Tutor's).
  const frac = (paid, total) => `
    <span class="admin-class-frac-num">${esc(rupees(paid))}</span>
    <span class="admin-class-frac-den">${esc(rupees(total))}</span>`;

  const titleHtml = `
    <div class="admin-class-fracs">
      <span class="admin-class-frac admin-class-frac-left" data-part="student-payment">${frac(collected + studentAdvancePaid, studentTotalAmount)}</span>
      <span class="admin-class-frac-center">
        <span class="admin-class-frac" data-part="student-agency">${frac(studentAgencyReceived, studentAgencyCharge)}</span>
        <span class="admin-class-frac" data-part="tutor-agency">${frac(tutorAgencyReceived, tutorAgencyCharge)}</span>
      </span>
      <span class="admin-class-frac admin-class-frac-right" data-part="tutor-payment">${frac(tutorTotalPayment, tutorTotalAmount)}</span>
    </div>`;

  return `
    <article class="admin-card class-card${open ? " is-open" : ""}" data-box data-demo="${esc(g.demoId)}" data-row="${activeRow.rowNumber}" data-tutor-id="${esc(activeRow.tutorId)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        <div class="admin-avatar">₹</div>
        <div class="admin-card-title">${titleHtml}</div>
        <span class="admin-caret" aria-hidden="true"></span>
        <span class="admin-status-rail" data-tone="completed" tabindex="-1">Payments</span>
      </div>

      <div class="admin-card-body">

        <h3 class="admin-section-title admin-section-title-center">Tuition ID: ${esc(g.demoId)}</h3>

        ${classPlanHtml(g, activeRow, editing, { terms: tuitionTermsBoxes, parties: studentSection + tutorSection })}

        ${editButtons(key, editing, "save-class-details", "Edit Class Details")}

      </div>

    </article>`;

}

function tutorOrder(state) {
  return { running: 0, completed: 1, processing: 2, scheduled: 3, schedule: 4, declined: 5, terminated: 6 }[state] ?? 9;
}

function tutorRowCard(row, terminated) {

  const tutor = TUTOR_BY_MOBILE[row.mobileKey];
  const key = `row:${row.rowNumber}:${row.demoId}`;
  const open = STATE.open.has(key);
  const state = rowState(row);
  const name = tutor ? tutor.values["Full Name"] : "Unknown tutor";
  const off = terminated ? " disabled" : "";
  const tv = field => (tutor && tutor.values[field]) || "";

  const parent = row.parentAccepted ? "accepted" : row.parentRejected ? "rejected" : "pending";
  const tut = row.tutorAccepted ? "accepted" : row.tutorRejected ? "rejected" : "pending";
  const canQuickOpen = !terminated && ["schedule", "scheduled", "processing", "running", "completed"].includes(state);
  const quickOpen = STATE.quickOpen.has(key);

  const segmented = (who, value) => `
    <div class="admin-seg" role="radiogroup" aria-label="${who === "parent" ? "Parent" : "Tutor"}">
      ${["pending", "accepted", "rejected"].map(v => `
        <label>
          <input type="radio" name="${who}-${row.rowNumber}" value="${v}"${v === value ? " checked" : ""}${off}>
          <span data-v="${v}">${v === "pending" ? "Pending" : v === "accepted" ? "Accepted" : "Rejected"}</span>
        </label>`).join("")}
    </div>`;

  const input = (field, label, value, type) => `
    <label class="admin-box admin-box-input${type ? " is-picker" : ""}">
      <input data-rfield="${field}" type="${type || "text"}" value="${esc(value)}"${off}>
      <span>${esc(label)}</span>
    </label>`;

  return `
    <article class="admin-card tutor-row-card${open ? " is-open" : ""}" data-tone="${state}"
      data-box data-row="${row.rowNumber}" data-demo="${esc(row.demoId)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        ${profileAvatar("tutors", tutor ? tutor.id : "", initials(name, "T"), subscriptionPayBadge("tutor", tutor ? tutor.id : ""))}
        <div class="admin-card-title">
          <div class="admin-hl">
            <div class="admin-hl-top" data-tone="${esc(state)}">
              ${equalRow([name, tv("Gender"), tutor ? tutor.id : "", tv("Mobile Number") || row.mobile, tv("WhatsApp Number"), tv("Subject You Teach")])}
            </div>
            <div class="admin-hl-small">
              ${equalRow([tv("Graduation - Course"), tv("Graduation - Subject"), fullAddress(tv("Present Address"), tv("City"), ""), tv("Pin Code")], "1fr 1fr 3fr 1fr")}
            </div>
          </div>
        </div>
        <span class="admin-caret" aria-hidden="true"></span>
        <button type="button" class="admin-status-rail" data-tone="${state}"${canQuickOpen ? ` data-action="quick-open"` : ` tabindex="-1"`}>${esc(ROW_LABELS[state])}</button>
      </div>

      <div class="admin-card-body">

        <div class="admin-demo-grid admin-demo-2">
          ${input("date", "Demo Date", toDateInput(row.demoDate), "date")}
          ${input("time", "Demo Time", toTimeInput(row.demoTime), "time")}
        </div>
        <h3 class="admin-section-title">Parent Status</h3>
        ${segmented("parent", parent)}

        <h3 class="admin-section-title">Tutor Status</h3>
        ${segmented("tutor", tut)}

        ${terminated
          ? note("This tuition is terminated. Reopen it to make changes.")
          : `<button class="admin-primary admin-wide" data-action="save-row" type="button">Save</button>`}

        ${quickOpen ? `<button class="admin-ghost admin-wide" data-action="show-full" data-key="${esc(key)}" type="button">Show Full Details</button>` : `

          <h3 class="admin-section-title">Tutor</h3>
          ${tutor ? fieldsBoxes("tutors", tutor, false) : note(`No tutor has mobile ${row.mobile}.`)}

        `}

      </div>

    </article>
  `;

}

function empty(text) {
  return `<div class="admin-empty">${esc(text)}</div>`;
}


/************************************************************
 * ASSIGN - suggestions while typing
 *
 * Suggests tutors whose Tutor ID or mobile number contains what
 * was typed (name too, to help find them). Assign only unlocks
 * when the box holds an EXACT Tutor ID or 10-digit mobile of a
 * tutor who isn't already on this tuition.
 ************************************************************/

function exactTutor(text) {

  const t = lower(text);
  const key = mobileKey(text);

  if (!t) return null;

  return STATE.data.tutors.rows.find(r =>
    lower(r.id) === t || (key.length === 10 && tutorKey(r) === key)
  ) || null;

}

/* =====================================================================
   ASSIGNING A TUTOR
   Typing a Tutor ID or mobile number shows suggestions; picking one fills it in.
   ===================================================================== */

function onAssignInput(event) {

  const input = event.target.closest && event.target.closest("[data-assign]");

  if (!input) return;

  const card = input.closest("[data-box]");
  const list = card.querySelector("[data-suggest]");
  const button = card.querySelector("[data-action='assign']");
  const demoId = card.dataset.demo;

  const onThis = new Set(
    (STATE.data.demos || []).filter(r => r.demoId === demoId && r.hasTutor).map(r => r.mobileKey)
  );

  const text = input.value.trim();
  const t = lower(text);
  const digits = text.replace(/\D/g, "");

  const found = exactTutor(text);
  const ok = !!found && !onThis.has(tutorKey(found)) &&
    lower(found.values["Verification Status"]) === "verified";

  button.disabled = !ok;
  button.dataset.tutor = ok ? found.id : "";

  if (t.length < 2) {
    list.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  const hits = STATE.data.tutors.rows.filter(r =>
    lower(r.id).includes(t) ||
    (digits.length >= 3 && String(r.values["Mobile Number"] || "").replace(/\D/g, "").includes(digits)) ||
    lower(r.values["Full Name"]).includes(t)
  ).slice(0, 6);

  list.innerHTML = hits.length ? hits.map(r => {
    const already = onThis.has(tutorKey(r));
    const verified = lower(r.values["Verification Status"]) === "verified";
    const why = already ? "Already on this tuition" : (verified ? "" : (r.values["Verification Status"] || "Not verified"));
    return suggestItem({
      title: r.id,
      sub: [r.values["Full Name"], r.values["Mobile Number"]],
      tag: "Tutor",
      attrs: `data-pick="${esc(r.id)}"`,
      disabled: already || !verified,
      note: why,
    });
  }).join("") : `<p class="admin-suggest-empty">No tutor matches “${esc(text)}”.</p>`;

  list.classList.remove("hidden");

}

function onSuggestPick(event) {

  const pick = event.target.closest && event.target.closest("[data-pick]");

  if (!pick || pick.disabled) return false;

  const card = pick.closest("[data-box]");
  const input = card.querySelector("[data-assign]");

  input.value = pick.dataset.pick;
  input.dispatchEvent(new Event("input", { bubbles: true }));

  const list = card.querySelector("[data-suggest]");
  list.classList.add("hidden");

  return true;

}

// New Employee form: a Super Admin has no login hours (24 x 7)
function syncHoursRow() {
  const row = $("employeeHoursRow");
  if (row) row.classList.toggle("hidden", $("employeeRole").value === "super_admin");
}
