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
 *   adminUpdateDemoRow  adminAssignTutor  adminSetTerminated
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

const ROLE_LABELS = {
  super_admin: "Super Admin",
  tuition_coordinator: "Tuition Coordinator",
  verification_staff: "Verification Staff",
  accounts_finance: "Accounts / Finance",
  tutor_relations: "Tutor Relations",
};

const ROLE_PERMS = {
  super_admin:          { tuitions: true,  tutorsEdit: true,  tutorsVerify: true,  students: true,  payments: true,  employees: true  },
  tuition_coordinator:  { tuitions: true,  tutorsEdit: true,  tutorsVerify: false, students: true,  payments: false, employees: false },
  verification_staff:   { tuitions: false, tutorsEdit: false, tutorsVerify: true,  students: false, payments: false, employees: false },
  accounts_finance:     { tuitions: false, tutorsEdit: false, tutorsVerify: false, students: false, payments: true,  employees: false },
  tutor_relations:      { tuitions: false, tutorsEdit: true,  tutorsVerify: false, students: false, payments: false, employees: false },
};

function myPerms() {
  return ROLE_PERMS[STATE.me && STATE.me.role] || ROLE_PERMS.tuition_coordinator;
}


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

// Strips currency symbols/commas etc. off a display value like "₹1,200"
// and returns a plain number, or 0 if there's nothing usable in it.
function num(value) {
  const n = Number(String(value == null ? "" : value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function getAccessToken() {
  try {
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
    await window.sb.auth.signOut().catch(() => {});
    showEmailStep(result.message);
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
  me: null,             // { email, fullName, role }
  payments: [],
  subscriptions: [],
  employees: [],
  directory: { demos: [], students: [], tutors: [] },
  tab: "tuitions",
  tutorFilter: "all",
  tuitionFilter: "all",
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

// Payment IDs already shown stacked under one of the Payments tab's own
// status cards (Payment by Student/Parent, Payment to Tutor, Student/
// Tutor Agency Charges) - rebuilt on every renderTuitionPaymentStatus(),
// then used by renderPayments() to keep the same payment from also
// floating loose in the flat list below.
let STACKED_PAYMENT_IDS = new Set();

function indexData() {

  TUTOR_BY_MOBILE = {};
  TUTOR_BY_ID = {};
  STUDENT_BY_ID = {};

  STATE.data.tutors.rows.forEach(r => {
    const key = mobileKey(r.values["Mobile Number"]);
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

  if (data && data.session) await loadOverview();
  else showEmailStep();

})();

let pendingEmail = "";
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
  $("adminOtp").value = "";
  $("otpMessage").textContent = "";
  showPage("login");
  setTimeout(() => $("adminOtp").focus(), 50);
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
  btn.textContent = remaining > 0 ? `Resend in ${remaining}s` : "Resend code";
}

function applyRoleUI() {

  const perms = myPerms();

  const visibility = {
    tuitions: perms.tuitions,
    tutors: perms.tutorsEdit || perms.tutorsVerify,
    students: perms.students,
    payments: perms.payments,
    subscriptions: perms.payments,
    employees: perms.employees
  };

  let firstVisible = null;

  ["tuitions", "tutors", "students", "payments", "subscriptions", "employees"].forEach(name => {
    const tabButton = document.querySelector(`.admin-tab[data-tab="${name}"]`);
    if (tabButton) tabButton.classList.toggle("hidden", !visibility[name]);
    if (visibility[name] && !firstVisible) firstVisible = name;
  });

  if (!visibility[STATE.tab]) STATE.tab = firstVisible || "tuitions";

  $("adminMe").innerHTML = (STATE.me && STATE.me.fullName)
    ? `${esc(STATE.me.fullName)} <span class="admin-role-pill" data-role="${esc(STATE.me.role)}">${esc(ROLE_LABELS[STATE.me.role] || STATE.me.role)}</span>`
    : "";

  applyActiveTab();

}

function applyActiveTab() {
  document.querySelectorAll(".admin-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === STATE.tab));
  ["tuitions", "tutors", "students", "payments", "subscriptions", "employees"].forEach(n => {
    const sec = $("tab-" + n);
    if (sec) sec.classList.toggle("hidden", n !== STATE.tab);
  });
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
    STATE.payments = result.payments || [];
    STATE.subscriptions = result.subscriptions || [];
    STATE.employees = result.employees || [];
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
  document.addEventListener("click", (event) => {
    if (event.target.closest(".class-card")) return;
    let changed = false;
    STATE.open.forEach(k => {
      if (k.startsWith("class:")) { STATE.open.delete(k); changed = true; }
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

      const { error } = await window.sb.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true }
      });

      if (error) {
        $("emailMessage").textContent = error.message || "Unable to send the code.";
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

  $("otpStepForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    const code = $("adminOtp").value.trim();

    if (!/^\d{6}$/.test(code)) {
      $("otpMessage").textContent = "Enter the 6-digit code.";
      return;
    }

    const button = $("verifyCodeButton");
    button.disabled = true;
    button.textContent = "Verifying...";
    $("otpMessage").textContent = "";

    try {

      const { error } = await window.sb.auth.verifyOtp({
        email: pendingEmail,
        token: code,
        type: "email"
      });

      if (error) {
        $("otpMessage").textContent = error.message || "Incorrect code.";
        $("adminOtp").value = "";
        $("adminOtp").focus();
        return;
      }

      await loadOverview();

    } catch (error) {
      console.error(error);
      $("otpMessage").textContent = "Unable to connect to the server. Please try again.";
    } finally {
      button.disabled = false;
      button.textContent = "Verify & log in";
    }

  });

  $("otpBackButton").addEventListener("click", () => {
    clearInterval(resendTimer);
    showEmailStep();
  });

  $("resendCodeButton").addEventListener("click", async () => {
    const button = $("resendCodeButton");
    button.disabled = true;
    try {
      const { error } = await window.sb.auth.signInWithOtp({
        email: pendingEmail,
        options: { shouldCreateUser: true }
      });
      if (error) $("otpMessage").textContent = error.message || "Unable to resend the code.";
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
    try { await window.sb.auth.signOut(); } catch (e) {}
    STATE.me = null;
    showEmailStep();
  });

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

  wireChipSearch("tutorSearch", renderTutors);
  wireChipSearch("tuitionSearch", renderTuitions);
  wireChipSearch("studentSearch", renderStudents);
  wireChipSearch("paymentSearch", renderPayments);
  wireChipSearch("subscriptionSearch", renderSubscriptions);

  ["tuitionList", "tutorList", "studentList", "tuitionPaymentStatusList", "paymentList", "employeeList", "subscriptionList"].forEach(id =>
    $(id).addEventListener("click", onListClick)
  );

  $("tuitionList").addEventListener("input", onAssignInput);

  wirePaymentForm();
  wirePaymentIdSuggestions();
  wirePaymentSubPartySuggestion();
  wireSubscriptionForm();
  wireSubscriptionIdSuggestion();
  wireEmployeeForm();

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

// Only an Agency Charge payment gets its own grouped layout (Transaction/
// Payment Mode/Payment Date on one line, the paying party's ID/Mobile/
// Name on another, Amount/Dues/Paying Now/Remaining on a third) - every
// other transaction type, Subscription included, keeps the plain field
// order it always had. Rather than a second copy of these fields (ids
// must be unique), the same DOM nodes are physically relocated into the
// #agencySlot... containers for Agency Charge mode and moved back to
// their original spot otherwise.
//
// listed in true original document order, since restoring depends on
// each field's original *next sibling* still being a valid anchor -
// walking that chain back-to-front (see layoutAgencyChargeFields)
// guarantees every field lands back exactly where it started, even
// though the fields it's chained to may themselves still be mid-move.
const AGENCY_LAYOUT_DOC_ORDER = [
  "paymentTransactionTypeField",
  "paymentSubNameField", "paymentSubMobileField", "paymentSubIdField",
  "paymentDateField", "paymentModeField",
  "paymentSubAmountField", "paymentSubDuesField", "paymentPayingNowField", "paymentRemainingField"
];

let agencyLayoutOriginalPos = null;

function layoutAgencyChargeFields(isAgencyCharge) {

  if (!agencyLayoutOriginalPos) {
    agencyLayoutOriginalPos = new Map();
    AGENCY_LAYOUT_DOC_ORDER.forEach(id => {
      const el = $(id);
      agencyLayoutOriginalPos.set(id, { parent: el.parentNode, next: el.nextSibling });
    });
  }

  const topSlot = $("agencySlotTop"), partySlot = $("agencySlotParty"), amountSlot = $("agencySlotAmount");

  if (isAgencyCharge) {
    ["paymentTransactionTypeField", "paymentModeField", "paymentDateField"].forEach(id => topSlot.appendChild($(id)));
    ["paymentSubIdField", "paymentSubMobileField", "paymentSubNameField"].forEach(id => partySlot.appendChild($(id)));
    // No Remaining here - Paying Now already starts at the full Dues,
    // so it would just show ₹0 until the admin deliberately changes it.
    ["paymentSubAmountField", "paymentSubDuesField", "paymentPayingNowField"].forEach(id => amountSlot.appendChild($(id)));
  } else {
    // Reverse document order: each field is reinserted right before its
    // own original next-sibling, so a field chained to another moved
    // field (not yet restored) still ends up in the right place once
    // that later field's own restore runs first.
    [...AGENCY_LAYOUT_DOC_ORDER].reverse().forEach(id => {
      const pos = agencyLayoutOriginalPos.get(id);
      pos.parent.insertBefore($(id), pos.next);
    });
  }

  topSlot.classList.toggle("hidden", !isAgencyCharge);
  partySlot.classList.toggle("hidden", !isAgencyCharge);
  amountSlot.classList.toggle("hidden", !isAgencyCharge);

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

  layoutAgencyChargeFields(isAgencyCharge);

  $("paymentTypeField").classList.toggle("hidden", !isCollection);
  $("collectedByField").classList.toggle("hidden", !isCollection);
  $("ourCutField").classList.toggle("hidden", !isCollection);

  $("paymentAmountField").classList.toggle("hidden", isSub || isAgencyCharge);
  // A Subscription or Agency Charge payment is always against one
  // single party (see PAYMENT_PARTY_FIELD_IDS below), never a Demo ID/
  // Tutor ID pair.
  $("paymentDemoIdField").classList.toggle("hidden", isSub || isPayout || isAgencyCharge);
  $("paymentTutorIdField").classList.toggle("hidden", isSub || isAgencyCharge);
  if (!isSub && !isAgencyCharge) $("paymentTutorIdField").querySelector("span").textContent = isPayout ? "Tutor ID" : "Tutor ID (optional)";

  $("paymentReceivedByField").classList.toggle("hidden", !isSub);
  PAYMENT_SUB_ONLY_FIELD_IDS.forEach(id => $(id).classList.toggle("hidden", !isSub));
  PAYMENT_PARTY_FIELD_IDS.forEach(id => $(id).classList.toggle("hidden", !isSub && !isAgencyCharge));
  PAYMENT_AMOUNT_FIELD_IDS.forEach(id => $(id).classList.toggle("hidden", !isSub && !isAgencyCharge));
  // Remaining stays Subscription-only - an Agency Charge payment never
  // shows it (see layoutAgencyChargeFields).
  if (isAgencyCharge) $("paymentRemainingField").classList.add("hidden");

  // The search box only shows in subscription mode, and only until a
  // party has actually been resolved (typed/picked, or pre-filled by
  // "Record a Payment for this Subscription").
  $("paymentSubPartyIdField").classList.toggle("hidden", !isSub || !!$("paymentSubscriptionId").value);

  if (isSub) {
    $("paymentSubPartyIdLabel").textContent = mode === "student-subscription"
      ? "Enter Student ID, Mobile or WhatsApp Number"
      : "Enter Tutor ID, Mobile or WhatsApp Number";
    $("paymentSubIdLabel").textContent = mode === "student-subscription" ? "Student ID" : "Tutor ID";
  } else if (isAgencyCharge) {
    $("paymentSubIdLabel").textContent = mode === "student-agency-charge" ? "Student ID" : "Tutor ID";
  }

}

function clearPaymentSubFields() {
  ["paymentSubName", "paymentSubMobile", "paymentSubId", "paymentSubPlan", "paymentSubAmount",
   "paymentSubDues", "paymentPayingNow", "paymentRemaining", "paymentSubCycle", "paymentSubStatus",
   "paymentSubStartDate", "paymentSubNextDue"].forEach(id => { $(id).value = ""; });
}

function updatePaymentRemaining() {
  const dues = Number(String($("paymentSubDues").value).replace(/[^\d.-]/g, "")) || 0;
  let payingNow = Number($("paymentPayingNow").value) || 0;
  if (payingNow > dues) {
    payingNow = dues;
    $("paymentPayingNow").value = dues;
  }
  $("paymentRemaining").value = "₹" + Math.max(dues - payingNow, 0).toLocaleString("en-IN");
  $("paymentSubNextDueField").classList.toggle("needs-reminder", dues - payingNow > 0);
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
  $("paymentSubPartyId").value = partyId;
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

  $("paymentSubPartyIdField").classList.add("hidden");

  return true;

}

function paymentModeValue() {
  const checked = document.querySelector('input[name="paymentModeChoice"]:checked');
  return checked ? checked.value : "Online";
}

function resetPaymentForm() {
  $("paymentDemoId").value = "";
  $("paymentSubscriptionId").value = "";
  $("paymentSubPartyId").value = "";
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
  document.querySelectorAll('#paymentDemoIdField .admin-suggest, #paymentTutorIdField .admin-suggest, #paymentSubPartyIdField .admin-suggest')
    .forEach(el => el.classList.add("hidden"));
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
// Paying Now/Remaining group - same numbers as the status card it was
// opened from, so it can never disagree with what the admin was just
// looking at. Demo ID/Tutor ID still get set (hidden) since the
// payload still needs them.
function fillPaymentAgencyChargeFields(g, activeRow, side) {

  const m = classMoney(g, activeRow);
  const charge = side === "tutor" ? m.tutorAgencyCharge : m.studentAgencyCharge;
  const dues = side === "tutor" ? m.tutorAgencyDue : m.studentAgencyDue;
  const party = side === "tutor" ? (DIR_TUTOR_BY_ID[activeRow.tutorId] || null) : (DIR_STUDENT_BY_ID[g.first.studentId] || null);

  $("paymentDemoId").value = g.demoId;
  $("paymentTutorId").value = activeRow.tutorId;

  $("paymentSubId").value = side === "tutor" ? activeRow.tutorId : g.first.studentId;
  $("paymentSubMobile").value = (party && party.mobile) || "";
  $("paymentSubName").value = (party && party.name) || "";

  $("paymentSubAmount").value = "₹" + charge.toLocaleString("en-IN");
  $("paymentSubDues").value = "₹" + dues.toLocaleString("en-IN");
  $("paymentPayingNow").max = dues;
  $("paymentPayingNow").value = dues;
  updatePaymentRemaining();

}

// Opens the payment form pre-filled for one Tuition's Student or
// Tutor Agency Charge - same "+ Record a Payment" pattern as a
// Subscription, but tracked against this Tuition's own Agency Charge
// instead of a subscription plan.
function openPaymentFormForAgencyCharge(g, activeRow, side) {
  if (STATE.tab !== "payments") showTab("payments");
  resetPaymentForm();
  $("paymentTransactionType").value = side === "tutor" ? "tutor-agency-charge" : "student-agency-charge";
  $("paymentForSubscription").classList.remove("hidden");
  $("paymentForSubscription").textContent = `For ${g.demoId}'s ${side === "tutor" ? "Tutor" : "Student"} Agency Charge`;
  applyPaymentTransactionType();
  fillPaymentAgencyChargeFields(g, activeRow, side);

  $("paymentForm").classList.remove("hidden");
  $("paymentForm").scrollIntoView({ behavior: "smooth", block: "center" });
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
    $("paymentSubPartyId").value = "";
    clearPaymentSubFields();
    $("paymentForSubscription").classList.add("hidden");
    applyPaymentTransactionType();
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
      toast("Search and select the student/tutor first.", true);
      return;
    }

    if (isPayout && !tutorId) {
      toast("Enter which Tutor ID is being paid.", true);
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

    const usesPayingNow = isSub || isAgencyCharge;
    const enteredAmount = Number(usesPayingNow ? $("paymentPayingNow").value : $("paymentAmount").value);
    if (!(enteredAmount > 0)) {
      toast(usesPayingNow ? "Enter the amount being paid now." : "Enter a valid amount.", true);
      return;
    }

    if (usesPayingNow) {
      const dues = Number(String($("paymentSubDues").value).replace(/[^\d.-]/g, "")) || 0;
      if (enteredAmount > dues) {
        toast(`Amount Paid can't be more than the Dues (₹${dues.toLocaleString("en-IN")}).`, true);
        return;
      }
    }

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
      notes: $("paymentNotes").value.trim()
    };

    const button = $("paymentForm").querySelector("button[type=submit]");
    const ok = await save(payload, button);

    if (ok) $("paymentForm").classList.add("hidden");

  });

}

function wirePaymentSubPartySuggestion() {

  const input = $("paymentSubPartyId");
  const suggest = document.querySelector('#paymentSubPartyIdField [data-suggest="subparty"]');

  const isStudent = () => $("paymentTransactionType").value === "student-subscription";

  input.addEventListener("input", () => {
    renderIdSuggestions(suggest, studentOrTutorSuggestions(input.value.trim(), isStudent(), { excludeFullyPaid: true }), "party");
  });

  input.addEventListener("focus", () => {
    renderIdSuggestions(suggest, studentOrTutorSuggestions(input.value.trim(), isStudent(), { excludeFullyPaid: true }), "party");
  });

  suggest.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-pick-id]");
    if (!pick) return;
    suggest.classList.add("hidden");
    fillPaymentSubscriptionFields(isStudent() ? "student" : "tutor", pick.dataset.pickId);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#paymentSubPartyIdField")) suggest.classList.add("hidden");
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
    updateIdDetail($("subscriptionPartyDetail"), null);
    document.querySelector('#subscriptionPartyIdField .admin-suggest').classList.add("hidden");
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
      updateIdDetail($("subscriptionPartyDetail"), null);
      document.querySelector('#subscriptionPartyIdField .admin-suggest').classList.add("hidden");
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

function paymentDemoSuggestions(query, tutorFilter) {
  const q = lower(query);
  const digits = String(query || "").replace(/\D/g, "");
  // Payments are for classes actually running right now, not every
  // tuition ever posted.
  let list = (STATE.directory.demos || []).filter(d => d.running);
  if (tutorFilter) list = list.filter(d => d.tutorIds.includes(tutorFilter));
  if (q) {
    list = list.filter(d => {
      const student = DIR_STUDENT_BY_ID[d.studentId] || {};
      return lower(d.demoId).includes(q) ||
        lower(student.name || "").includes(q) ||
        (digits.length >= 3 && String(student.mobile || "").replace(/\D/g, "").includes(digits));
    });
  }
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
  const q = lower(query);
  const digits = String(query || "").replace(/\D/g, "");
  let list = isStudent ? (STATE.directory.students || []) : (STATE.directory.tutors || []);
  if (opts.excludeFullyPaid) {
    list = list.filter(p => {
      const sub = subscriptionFor(isStudent ? "student" : "tutor", p.id);
      return !sub || subscriptionPaidAmount(sub.id) < Number(sub.amount || 0);
    });
  }
  if (!q) return list.slice(0, 8);
  return list.filter(p =>
    lower(p.id).includes(q) ||
    lower(p.name || "").includes(q) ||
    (digits.length >= 3 && String(p.mobile || "").replace(/\D/g, "").includes(digits))
  ).slice(0, 8);
}

// Renders a dropdown of {id/demoId, name, mobile} - "demo" items show
// the linked student's name/mobile; everything else shows its own.
function renderIdSuggestions(container, items, kind) {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<p class="admin-suggest-empty">No match found.</p>`;
    container.classList.remove("hidden");
    return;
  }
  container.innerHTML = items.map(item => {
    const id = kind === "demo" ? item.demoId : item.id;
    const who = kind === "demo" ? (DIR_STUDENT_BY_ID[item.studentId] || {}) : item;
    return `
      <button type="button" class="admin-suggest-item" data-pick-id="${esc(id)}">
        <strong>${esc(id)}</strong>
        <span>${esc(who.name || "")} · ${esc(who.mobile || "No mobile")}</span>
      </button>`;
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

  demoInput.addEventListener("input", () => {
    const text = demoInput.value.trim();
    const exact = DIR_DEMO_BY_ID[text];
    updateIdDetail(demoDetail, exact ? DIR_STUDENT_BY_ID[exact.studentId] : null);
    renderIdSuggestions(demoSuggest, paymentDemoSuggestions(text, exactTutorId()), "demo");
  });

  demoInput.addEventListener("focus", () => {
    renderIdSuggestions(demoSuggest, paymentDemoSuggestions(demoInput.value.trim(), exactTutorId()), "demo");
  });

  tutorInput.addEventListener("input", () => {
    const text = tutorInput.value.trim();
    const exact = DIR_TUTOR_BY_ID[text];
    updateIdDetail(tutorDetail, exact || null);
    renderIdSuggestions(tutorSuggest, paymentTutorSuggestions(text, exactDemoId()), "tutor");
  });

  tutorInput.addEventListener("focus", () => {
    renderIdSuggestions(tutorSuggest, paymentTutorSuggestions(tutorInput.value.trim(), exactDemoId()), "tutor");
  });

  demoSuggest.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-pick-id]");
    if (!pick) return;
    demoInput.value = pick.dataset.pickId;
    demoInput.dispatchEvent(new Event("input", { bubbles: true }));
    demoSuggest.classList.add("hidden");
    if (!tutorInput.value.trim()) {
      renderIdSuggestions(tutorSuggest, paymentTutorSuggestions("", pick.dataset.pickId), "tutor");
    }
  });

  tutorSuggest.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-pick-id]");
    if (!pick) return;
    tutorInput.value = pick.dataset.pickId;
    tutorInput.dispatchEvent(new Event("input", { bubbles: true }));
    tutorSuggest.classList.add("hidden");
    if (!demoInput.value.trim()) {
      renderIdSuggestions(demoSuggest, paymentDemoSuggestions("", pick.dataset.pickId), "demo");
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#paymentDemoIdField")) demoSuggest.classList.add("hidden");
    if (!event.target.closest("#paymentTutorIdField")) tutorSuggest.classList.add("hidden");
  });

}

function wireSubscriptionIdSuggestion() {

  const input = $("subscriptionPartyId");
  const suggest = document.querySelector('#subscriptionPartyIdField [data-suggest="party"]');
  const detail = $("subscriptionPartyDetail");

  const isStudent = () => $("subscriptionPartyType").value === "student";
  const currentParty = () => {
    const dir = isStudent() ? DIR_STUDENT_BY_ID : DIR_TUTOR_BY_ID;
    return dir[input.value.trim()] || null;
  };

  input.addEventListener("input", () => {
    updateIdDetail(detail, currentParty());
    renderIdSuggestions(suggest, studentOrTutorSuggestions(input.value.trim(), isStudent()), "party");
  });

  input.addEventListener("focus", () => {
    renderIdSuggestions(suggest, studentOrTutorSuggestions(input.value.trim(), isStudent()), "party");
  });

  suggest.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-pick-id]");
    if (!pick) return;
    input.value = pick.dataset.pickId;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    suggest.classList.add("hidden");
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#subscriptionPartyIdField")) suggest.classList.add("hidden");
  });

}

function wireEmployeeForm() {

  $("addEmployeeButton").addEventListener("click", () => {
    const form = $("employeeForm");
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) {
      $("employeeEmail").value = "";
      $("employeeName").value = "";
      $("employeeRole").value = "tuition_coordinator";
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

    const payload = { action: "adminAddEmployee", email, fullName, role: $("employeeRole").value };

    const button = $("employeeForm").querySelector("button[type=submit]");
    const ok = await save(payload, button);

    if (ok) $("employeeForm").classList.add("hidden");

  });

}

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

  if (name !== STATE.tab) collapseAll();

  STATE.tab = name;

  applyActiveTab();

  rerenderCurrent();

}

// Tile click: open that tab with that filter (search cleared so the
// whole group shows). "today" has no chip of its own.
function goToFilter(tab, filter) {

  collapseAll();

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

// From a student's "Tuitions" pill: jump to the Tuitions tab with that
// one tuition opened, ignoring whatever filter/search was active there.
function goToTuition(demoId) {

  collapseAll();
  STATE.tab = "tuitions";
  STATE.tuitionFilter = "all";
  $("tuitionSearch").value = "";
  clearSearchChips("tuitionSearch");
  $("tuitionFilter").querySelectorAll(".admin-chip").forEach(c => c.classList.toggle("active", c.dataset.value === "all"));
  STATE.open.add("tuition:" + demoId);

  applyActiveTab();
  rerenderCurrent();

  requestAnimationFrame(() => {
    const card = document.querySelector(`.tuition-card[data-demo="${CSS.escape(demoId)}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
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
  if (STATE.tab === "employees") renderEmployees();
}

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
      goToTuition(actionEl.dataset.demo);
      break;

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

    case "toggle-class-day": {
      const day = actionEl.dataset.day;
      const rowNumber = Number(actionEl.dataset.row);
      const demoId = box.dataset.demo;
      const tutorId = actionEl.dataset.tutorId;
      const row = (STATE.data.demos || []).find(r => r.rowNumber === rowNumber && r.demoId === demoId);
      const current = new Set((row && row.classDays && row.classDays.length) ? row.classDays : DEFAULT_CLASS_DAYS);
      const adding = !current.has(day);
      if (adding) current.add(day); else current.delete(day);
      const days = WEEKDAYS.filter(d => current.has(d));
      actionEl.classList.toggle("is-on", adding);
      actionEl.disabled = true;
      const ok = await save({
        action: "adminUpdateDemoRow",
        rowNumber,
        demoId,
        tutorId,
        changes: { "Class Days": days }
      });
      if (!ok) {
        actionEl.classList.toggle("is-on", !adding);
        actionEl.disabled = false;
      }
      break;
    }

    case "increment-class-count": {
      const rowNumber = Number(actionEl.dataset.row);
      const demoId = box.dataset.demo;
      const tutorId = actionEl.dataset.tutorId;
      const row = (STATE.data.demos || []).find(r => r.rowNumber === rowNumber && r.demoId === demoId);
      const next = (row ? Number(row.classCount) || 0 : 0) + 1;
      await save({
        action: "adminUpdateDemoRow",
        rowNumber,
        demoId,
        tutorId,
        changes: { "Class Count": next }
      }, actionEl);
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

    case "record-agency-payment": {
      const g = demoGroups().find(x => x.demoId === actionEl.dataset.demoId);
      const activeRow = g ? activeRowFor(g) : null;
      if (g && activeRow) openPaymentFormForAgencyCharge(g, activeRow, actionEl.dataset.side);
      break;
    }

  }

}

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

async function saveClassDetails(box, button) {

  const rowNumber = Number(box.dataset.row);
  const demoId = box.dataset.demo;
  const tutorId = box.dataset.tutorId;
  const changes = {};

  box.querySelectorAll("[data-cfield]").forEach(input => {
    changes[input.dataset.cfield] = input.value.trim();
  });

  const ok = await save({ action: "adminUpdateDemoRow", rowNumber, demoId, tutorId, changes }, button);

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
  new: "Find Tutors", schedule: "Schedule Demo", scheduled: "Demo Scheduled",
  running: "Running", completed: "Completed", terminated: "Terminated"
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

function renderStats() {

  const groups = demoGroups();
  const tutors = STATE.data.tutors.rows;
  const count = s => groups.filter(g => groupState(g) === s).length;

  const todaysDemos = (STATE.data.demos || []).filter(r => {
    const s = rowState(r);
    return r.hasTutor && isToday(r.demoDate) && s !== "declined" && s !== "terminated";
  }).length;

  const stats = [
    ["Find Tutors", count("new"), "lime", "tuitions", "new"],
    ["Demo to Schedule", count("schedule"), "violet", "tuitions", "schedule"],
    ["Running Classes", count("running"), "green", "tuitions", "running"],
    ["Tutor Verification Pending", tutors.filter(t => statusGroup(t.values["Verification Status"]) === "pending").length, "amber", "tutors", "pending"],
    ["Classes Completed", count("completed"), "grey", "tuitions", "completed"],
    ["Terminated", count("terminated"), "red", "tuitions", "terminated"],
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
    const current = opts.options.find(o => lower(o) === lower(value)) || opts.options[0];
    control = `<select ${attr}>${opts.options.map(o => `<option${o === current ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  } else if (opts.link && /^https?:\/\//i.test(value)) {
    control = `<a class="admin-box-link" href="${esc(value)}" target="_blank" rel="noopener">Open ${esc(label)}</a>`;
  } else if (opts.multiline) {
    control = `<textarea ${attr} rows="2"${editable ? "" : " readonly"}>${esc(value)}</textarea>`;
  } else {
    control = `<input ${attr} type="${opts.type || "text"}" value="${esc(value)}"${editable ? "" : " readonly"}${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ""}>`;
  }

  return `<label class="${cls}">${control}<span>${esc(label)}</span></label>`;

}

function fieldsBoxes(kind, record, editing) {

  const data = STATE.data[kind];
  const readOnly = (data.readOnly || []).map(lower);

  return `
    <div class="admin-boxes">
      ${data.headers.map(h => {

        const value = record.values[h] || "";
        const canEdit = editing && !readOnly.includes(lower(h));
        const long = value.length > 48 || /address|subject you teach|classes you teach|boards you teach|languages|special/i.test(h);

        if (lower(h) === "verification status") {
          return box(h, value || "Pending for Verification", {
            editable: canEdit,
            options: STATE.data.verificationValues,
            attr: canEdit ? `data-field="${esc(h)}"` : ""
          });
        }

        return box(h, value, {
          editable: canEdit,
          wide: long,
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
        <path fill-rule="evenodd" clip-rule="evenodd" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/>
      </svg>
    </span>`;

}

// Pending: Accept | Reject. Verified: Accept (already chosen, disabled) |
// Suspend (same effect as Reject - sets Verification Status back to
// Rejected). Rejected: Accept | Reject (already chosen, disabled) - so
// there's always exactly one live action to move a tutor the other way.
function verifyButtonsHtml(status) {
  const group = statusGroup(status);
  const approveChosen = group === "verified";
  const rejectChosen = group === "rejected";
  const rejectLabel = group === "verified" ? "Suspend" : "Reject";
  const approveLabel = approveChosen ? "Accepted" : "Accept";
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
    <article class="admin-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}" data-tone="${opts.tone || ""}"
      data-box data-kind="${kind}" data-row="${record.rowNumber}" data-id="${esc(record.id)}" data-key="${esc(key)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        <div class="admin-avatar">${esc(initials(opts.name, kind === "tutors" ? "T" : "S"))}${subscriptionPayBadge(kind === "tutors" ? "tutor" : "student", record.id)}</div>
        <div class="admin-card-title">
          ${opts.titleHtml || `<strong>${esc(opts.name || record.id)}</strong><small>${esc(opts.sub)}</small>`}
        </div>
        ${opts.pill ? `<span class="admin-pill" data-tone="${opts.tone}">${esc(opts.pill)}</span>` : ""}
        <span class="admin-caret" aria-hidden="true"></span>
        ${opts.verifyStatus ? verifyButtonsHtml(opts.verifyStatus) : ""}
      </div>

      <div class="admin-card-body">
        ${fieldsBoxes(kind, record, editing)}
        ${opts.extra || ""}
        ${kind !== "tutors" || myPerms().tutorsEdit ? editButtons(key, editing, "save-record", "Edit Details") : ""}
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

function haystackOfRecord(record) {
  return record ? Object.values(record.values || {}).join(" ") : "";
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
}


/* ---------------- tutors ---------------- */

function renderTutors() {

  const rows = STATE.data.tutors.rows
    .filter(r => STATE.tutorFilter === "all" || statusGroup(r.values["Verification Status"]) === STATE.tutorFilter)
    .filter(r => matchesAll(searchQueryFor("tutorSearch"), haystackOfRecord(r)))
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
      // Name | WhatsApp | Graduation | Tutor ID, address small below
      // Name | WhatsApp | Mobile | Tutor ID | Subject Taught, one line,
      // truncated with an ellipsis if it runs long (see #tutorList
      // .admin-info in admin.css). Graduation now lives on the small
      // line below, right before the address.
      titleHtml: highlight(
        [v("Full Name") || r.id, v("WhatsApp Number"), v("Mobile Number"), r.id, v("Subject You Teach")],
        [
          [v("Graduation - Course"), v("Graduation - Subject")].filter(Boolean).join(" - "),
          fullAddress(v("Present Address"), v("City"), v("Pin Code"))
        ].filter(Boolean).join(" | "),
        "|",
        statusGroup(status)
      ),
      pill: status,
      tone: statusGroup(status),
      // Accept/Reject while Pending, Accept/Suspend once Verified,
      // Accept/Reject again if Rejected - always on the right of the tab.
      verifyStatus: myPerms().tutorsVerify ? status : ""
    });
  }).join("") : empty("No tutors match.");

}


/* ---------------- students ---------------- */

function renderStudents() {

  const groups = demoGroups();

  const rows = STATE.data.students.rows
    .filter(r => matchesAll(searchQueryFor("studentSearch"),
      haystackOfRecord(r) + " " + groups.filter(g => g.first.studentId === r.id).map(g => g.demoId + " " + g.first.subject).join(" ")))
    .slice()
    .reverse();

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
      // Name | WhatsApp Number | Class | Board - all bold, one line
      titleHtml: highlight([
        r.values["Student Name"] || r.id,
        r.values["WhatsApp"] || r.values["Phone"],
        r.values["Gender"],
        r.values["Class"],
        r.values["Board"],
        fullAddress(r.values["Address"], r.values["City"], r.values["PIN Code"])
      ], "", "|", "neutral"),
      tone: "neutral",
      extra
    });

  }).join("") : empty("No students match.");

}


/* ---------------- payments ---------------- */

// A small collapsed-by-default card for the Payments tab's own status
// summaries - same shell as any other card (head with a caret, body
// hidden until opened), plus a static status-rail label on the right
// edge (no click action, just the word) saying at a glance whether
// this side of the money is cleared or still owed.
function statusCard(key, tone, titleParts, subtitle, boxesHtml, railLabel, footerHtml, boxesClass, titleHtmlOverride, partyLabel) {
  const open = STATE.open.has(key);
  const titleHtml = titleHtmlOverride || highlight(titleParts, subtitle, "|", tone);
  return `
    <article class="admin-card admin-paystatus-card${open ? " is-open" : ""}" data-tone="${esc(tone)}" data-box data-key="${esc(key)}">
      <div class="admin-card-head" data-toggle="${esc(key)}">
        <div class="admin-avatar">₹</div>
        <div class="admin-card-title">${titleHtml}</div>
        ${partyLabel ? `<span class="admin-pill admin-pill-party" data-tone="${esc(tone)}">${esc(partyLabel)}</span>` : ""}
        <span class="admin-caret" aria-hidden="true"></span>
        <span class="admin-status-rail" data-tone="${esc(tone)}" tabindex="-1">${esc(railLabel)}</span>
      </div>
      <div class="admin-card-body">
        <div class="admin-boxes${boxesClass ? " " + boxesClass : ""}">${boxesHtml}</div>
        ${footerHtml || ""}
      </div>
    </article>`;
}

// The 4 payment-status cards for one Running/Completed Tuition: what
// the Student/Parent owes, what's owed to the Tutor, and each side's
// own Agency Charge status - a read-only summary view in the Payments
// tab, backed by the exact same numbers as the Class card in Tuitions.
function tuitionPaymentStatusCards(g, activeRow) {

  const m = classMoney(g, activeRow);
  const student = STUDENT_BY_ID[g.first.studentId];
  const tutor = TUTOR_BY_ID[activeRow.tutorId];
  const studentName = student ? student.values["Student Name"] : g.first.studentId;
  const tutorName = tutor ? tutor.values["Full Name"] : activeRow.tutorId;
  const studentMobile = student ? student.values["Phone"] : "";
  const studentWhatsapp = student ? student.values["WhatsApp"] : "";
  const tutorMobile = tutor ? tutor.values["Mobile Number"] : "";
  const tutorWhatsapp = tutor ? tutor.values["WhatsApp Number"] : "";

  // Top layer for every one of these 4 cards: the relevant party's own
  // details on the left, a plain label naming the card pushed to the
  // right - no bottom line, nothing else.
  const partyCardTitleHtml = (parts, tone, rightLabel) => `
    <div class="admin-hl">
      <div class="admin-hl-top admin-hl-top-split" data-tone="${esc(tone)}">
        ${infoLine(parts)}
        <span class="admin-hl-top-right">${esc(rightLabel)}</span>
      </div>
    </div>`;

  const studentTitleParts = [studentName, studentMobile, studentWhatsapp, g.first.studentId, g.demoId];
  const tutorTitleParts = [tutorName, tutorMobile, tutorWhatsapp, activeRow.tutorId];

  // Stacks each payment record actually made under the status card it
  // was made against - same joined-card look as a Tuition and its
  // Tutor rows - and tracks it in STACKED_PAYMENT_IDS so the flat
  // payments list below doesn't also show it loose.
  const stack = (cardHtml, payments) => {
    payments.forEach(p => STACKED_PAYMENT_IDS.add(p.id));
    const paymentsHtml = payments.map(p => paymentCard(p, {})).join("");
    return `<div class="admin-stack${paymentsHtml ? " has-tutors" : ""}">${cardHtml}${paymentsHtml}</div>`;
  };

  const studentTone = m.studentDues > 0 ? "schedule" : "running";
  const studentCard = statusCard(
    "paystatus:student:" + g.demoId,
    studentTone,
    [g.demoId, "Payment by Student/Parent"], `${studentName} · ${g.first.subject}`,
    box("Tuition Fee", m.studentDues > 0 ? "Dues" : "Received", { wide: true }) +
    box("Total Amount (₹)", m.studentTotalAmount) +
    box("Advance Payment (₹)", m.studentAdvancePaid) +
    box("Total Payment (₹)", m.collected) +
    box("Dues (₹)", m.studentDues) +
    box("Payment To", activeRow.studentPaymentTo) +
    box("Next Due Date", activeRow.studentNextDueDate),
    m.studentDues > 0 ? "Dues" : "Received",
    "",
    undefined,
    partyCardTitleHtml(studentTitleParts, studentTone, "Payment To"),
    "Student"
  );

  const tutorTone = m.tutorDues > 0 ? "schedule" : "running";
  const tutorCard = statusCard(
    "paystatus:tutor:" + g.demoId,
    tutorTone,
    [g.demoId, "Payment to Tutor"], `${tutorName} · ${g.first.subject}`,
    box("Tutor Fee", m.tutorDues > 0 ? "Due" : "Paid", { wide: true }) +
    box("Total Amount (₹)", m.tutorTotalAmount) +
    box("Advance Payment (₹)", m.tutorAdvance) +
    box("Total Payment (₹)", m.tutorTotalPayment) +
    box("Dues (₹)", m.tutorDues) +
    box("Payment From", activeRow.tutorPaymentFrom) +
    box("Next Payment Date", activeRow.tutorNextPaymentDate),
    m.tutorDues > 0 ? "Due" : "Paid",
    "",
    undefined,
    partyCardTitleHtml(tutorTitleParts, tutorTone, "Payment To"),
    "Tutor"
  );

  const studentAgencyTone = m.studentAgencyDue > 0 ? "schedule" : "running";
  const tutorAgencyTone = m.tutorAgencyDue > 0 ? "schedule" : "running";

  const studentAgencyCard = statusCard(
    "paystatus:studentagency:" + g.demoId,
    studentAgencyTone,
    [g.demoId, "Student Agency Charges"], `${studentName} · ${g.first.subject}`,
    box("Demo ID", g.demoId) +
    box("Student Name", studentName) +
    box("Student Mobile", studentMobile) +
    box("Tutor ID", activeRow.tutorId) +
    box("Tutor Name", tutorName) +
    box("Tutor Mobile", tutorMobile) +
    box("Agency Charge (₹)", m.studentAgencyCharge) +
    box("Received (₹)", m.studentAgencyReceived) +
    box("Dues (₹)", m.studentAgencyDue),
    m.studentAgencyDue > 0 ? "Dues" : "Paid",
    m.studentAgencyDue > 0 ? `<button class="admin-ghost admin-wide" data-action="record-agency-payment" data-demo-id="${esc(g.demoId)}" data-side="student" type="button">+ Record a Payment</button>` : "",
    "admin-boxes-triple",
    partyCardTitleHtml(studentTitleParts, studentAgencyTone, "Agency Charge"),
    "Student"
  );

  const tutorAgencyCard = statusCard(
    "paystatus:tutoragency:" + g.demoId,
    tutorAgencyTone,
    [g.demoId, "Tutor Agency Charges"], `${tutorName} · ${g.first.subject}`,
    box("Demo ID", g.demoId) +
    box("Student Name", studentName) +
    box("Student Mobile", studentMobile) +
    box("Tutor ID", activeRow.tutorId) +
    box("Tutor Name", tutorName) +
    box("Tutor Mobile", tutorMobile) +
    box("Agency Charge (₹)", m.tutorAgencyCharge) +
    box("Received (₹)", m.tutorAgencyReceived) +
    box("Dues (₹)", m.tutorAgencyDue),
    m.tutorAgencyDue > 0 ? "Dues" : "Paid",
    m.tutorAgencyDue > 0 ? `<button class="admin-ghost admin-wide" data-action="record-agency-payment" data-demo-id="${esc(g.demoId)}" data-side="tutor" type="button">+ Record a Payment</button>` : "",
    "admin-boxes-triple",
    partyCardTitleHtml(tutorTitleParts, tutorAgencyTone, "Agency Charge"),
    "Tutor"
  );

  const studentPayments = (STATE.payments || [])
    .filter(p => p.transaction_type === "collection" && p.demo_id === g.demoId);
  const tutorPayments = (STATE.payments || [])
    .filter(p => p.transaction_type === "payout" && p.tutor_id === activeRow.tutorId);
  const studentAgencyPayments = (STATE.payments || [])
    .filter(p => p.transaction_type === "agency_charge" && p.demo_id === g.demoId && !p.tutor_id);
  const tutorAgencyPayments = (STATE.payments || [])
    .filter(p => p.transaction_type === "agency_charge" && p.demo_id === g.demoId && p.tutor_id === activeRow.tutorId);

  return stack(studentCard, studentPayments)
    + stack(tutorCard, tutorPayments)
    + stack(studentAgencyCard, studentAgencyPayments)
    + stack(tutorAgencyCard, tutorAgencyPayments);

}

function renderTuitionPaymentStatus() {

  if (!$("tuitionPaymentStatusList")) return;

  const query = searchQueryFor("paymentSearch");

  // Built for every Running/Completed Tuition regardless of the search
  // box (not just the ones about to be shown), so STACKED_PAYMENT_IDS
  // always covers every payment actually stacked somewhere - otherwise
  // narrowing the search here would wrongly unhide those payments in
  // the flat list below, which runs its own separate search match.
  STACKED_PAYMENT_IDS = new Set();

  const cards = demoGroups()
    .map(g => ({ g, activeRow: activeRowFor(g) }))
    .filter(({ activeRow }) => activeRow)
    .map(({ g, activeRow }) => {
      const student = STUDENT_BY_ID[g.first.studentId];
      const studentName = student ? student.values["Student Name"] : g.first.studentId;
      const matches = matchesAll(query, [g.demoId, studentName, g.first.subject, activeRow.tutorId].join(" "));
      const html = tuitionPaymentStatusCards(g, activeRow);
      return matches ? html : "";
    })
    .join("");

  $("tuitionPaymentStatusList").innerHTML = cards || "";

}

function renderPayments() {

  if (!$("paymentList")) return;

  renderTuitionPaymentStatus();

  const groups = demoGroups();
  const context = {};

  groups.forEach(g => {
    const student = STUDENT_BY_ID[g.first.studentId];
    context[g.demoId] = {
      studentName: student ? student.values["Student Name"] : g.first.studentId,
      subject: g.first.subject
    };
  });

  const query = searchQueryFor("paymentSearch");

  const rows = (STATE.payments || []).filter(p => {
    // Collection/Payout/Agency Charge payments already shown stacked
    // under one of the status cards above don't also float loose here.
    if (STACKED_PAYMENT_IDS.has(p.id)) return false;
    const sub = p.subscription_id ? (STATE.subscriptions || []).find(s => s.id === p.subscription_id) : null;
    const subId = sub ? (sub.student_id || sub.tutor_id) : "";
    const subParty = subId ? (sub.student_id ? DIR_STUDENT_BY_ID : DIR_TUTOR_BY_ID)[subId] : null;
    return matchesAll(query, [
      p.demo_id, p.tutor_id, p.payment_mode, p.notes, subId,
      subParty && subParty.name, subParty && subParty.mobile,
      context[p.demo_id] && context[p.demo_id].studentName
    ].join(" "));
  });

  $("paymentList").innerHTML = rows.length
    ? rows.map(p => paymentCard(p, context[p.demo_id] || {})).join("")
    : empty("No payments recorded yet.");

}

function paymentCard(p, ctx) {

  const key = "payment:" + p.id;
  const open = STATE.open.has(key);
  const editing = STATE.editing.has(key);
  const amount = Number(p.amount || 0);
  const isPayout = p.transaction_type === "payout";

  // So the payment can be verified against the right person by phone.
  const demoDir = p.demo_id ? DIR_DEMO_BY_ID[p.demo_id] : null;
  const studentDir = demoDir ? DIR_STUDENT_BY_ID[demoDir.studentId] : null;
  const tutorDir = p.tutor_id ? DIR_TUTOR_BY_ID[p.tutor_id] : null;

  const boxes = `
    <div class="admin-boxes">
      ${box("Transaction", isPayout ? "Payout" : "Collection", {
        editable: editing,
        options: ["Collection", "Payout"],
        attr: editing ? `data-pfield="transactionType"` : ""
      })}
      ${!isPayout ? box("Demo ID", p.demo_id) : ""}
      ${!isPayout && studentDir ? box("Student Mobile", `${studentDir.name} · ${studentDir.mobile || "No mobile"}`) : ""}
      ${box("Tutor ID", p.tutor_id || "")}
      ${tutorDir ? box("Tutor Mobile", `${tutorDir.name} · ${tutorDir.mobile || "No mobile"}`) : ""}
      ${box("Amount (₹)", p.amount, { editable: editing, type: "number", attr: editing ? `data-pfield="amount"` : "" })}
      ${box("Payment Date", editing ? p.payment_date : formatDate(p.payment_date), { editable: editing, type: editing ? "date" : "text", attr: editing ? `data-pfield="paymentDate"` : "" })}
      ${!isPayout ? box("Payment Type", p.payment_type, { editable: editing, options: ["advance", "regular", "final"], attr: editing ? `data-pfield="paymentType"` : "" }) : ""}
      ${!isPayout ? box("Collected By", p.collected_by, { editable: editing, options: ["agency", "tutor"], attr: editing ? `data-pfield="collectedBy"` : "" }) : ""}
      ${box("Payment Mode", p.payment_mode, { editable: editing, attr: editing ? `data-pfield="paymentMode"` : "" })}
      ${!isPayout ? box("Our Cut (₹)", p.our_cut_amount == null ? "" : p.our_cut_amount, { editable: editing, type: "number", attr: editing ? `data-pfield="ourCutAmount"` : "" }) : ""}
      ${box("Notes", p.notes || "", { editable: editing, wide: true, multiline: true, attr: editing ? `data-pfield="notes"` : "" })}
    </div>`;

  const buttons = editing
    ? `<div class="admin-pair">
         <button class="admin-primary" data-action="save-payment" type="button">Save changes</button>
         <button class="admin-ghost" data-action="cancel" data-key="${esc(key)}" type="button">Cancel</button>
       </div>`
    : `<div class="admin-split">
         <button class="admin-ghost" data-action="edit" data-key="${esc(key)}" type="button">Edit</button>
         <button class="admin-ghost admin-danger" data-action="delete-payment" type="button">Delete</button>
       </div>`;

  if (p.subscription_id) {
    return subscriptionPaymentCard(p, key, open, editing, buttons);
  }

  if (p.transaction_type === "agency_charge") {
    return agencyChargePaymentCard(p, key, open, editing, buttons);
  }

  return `
    <article class="admin-card tutor-row-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}" data-tone="neutral" data-box data-id="${p.id}" data-key="${esc(key)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        <div class="admin-avatar">₹</div>
        <div class="admin-card-title">
          <div class="admin-hl">
            <div class="admin-hl-top admin-hl-top-split" data-tone="neutral">
              ${infoLine(["Paid ₹" + amount.toLocaleString("en-IN")])}
              <span class="admin-hl-top-right">${esc(recordedAt(p.created_at))}</span>
            </div>
          </div>
        </div>
        <span class="admin-caret" aria-hidden="true"></span>
      </div>

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
  const rupees = n => "₹" + Number(n).toLocaleString("en-IN");
  const startDate = sub.start_date || "";
  const nextDue = subscriptionNextDue(sub);

  const boxes = `
    <div class="admin-boxes">
      ${box("Transaction", isStudent ? "Student Subscription" : "Tutor Subscription")}
      ${box("Name", partyName)}
      ${box("Mobile Number", partyMobile)}
      ${box(isStudent ? "Student ID" : "Tutor ID", partyId)}
      ${box("Plan Name", sub.plan_name || "")}
      ${box("Billing Cycle", sub.billing_cycle || "")}
      ${box("Status", SUBSCRIPTION_STATUS_LABELS[sub.status] || sub.status || "")}
      ${box("Start Date", formatDate(startDate))}
      ${box("Next Due Date", formatDate(nextDue))}
      ${box("Payment Date", editing ? p.payment_date : formatDate(p.payment_date), { editable: editing, type: editing ? "date" : "text", attr: editing ? `data-pfield="paymentDate"` : "" })}
      ${box("Payment Mode", p.payment_mode, { editable: editing, options: ["Online", "Offline"], attr: editing ? `data-pfield="paymentMode"` : "" })}
      ${box("Received By", p.received_by || "", { editable: editing, attr: editing ? `data-pfield="receivedBy"` : "" })}
      ${box("Amount (₹)", rupees(planAmount))}
      ${box("Dues (₹)", rupees(duesThen))}
      ${box("Amount Paid (₹)", editing ? p.amount : rupees(paying), { editable: editing, type: editing ? "number" : "text", attr: editing ? `data-pfield="amount"` : "" })}
      ${box("Remaining (₹)", rupees(remaining))}
      ${box("Notes", p.notes || "", { editable: editing, wide: true, multiline: true, attr: editing ? `data-pfield="notes"` : "" })}
    </div>`;

  return `
    <article class="admin-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}" data-tone="neutral" data-box data-id="${p.id}" data-key="${esc(key)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        <div class="admin-avatar">₹</div>
        <div class="admin-card-title">
          ${highlight(
            [partyName, partyMobile, partyId, sub.plan_name, "Amount Paid " + rupees(paying)],
            timeSplitLine(remaining > 0 ? `Remaining ${rupees(remaining)}` : "Fully paid", p.created_at),
            "|",
            "neutral",
            true
          )}
        </div>
        <span class="admin-caret" aria-hidden="true"></span>
      </div>

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
  const partyName = (party && party.name) || partyId;
  const partyMobile = (party && party.mobile) || "";

  const paying = Number(p.amount || 0);
  const paidBefore = (STATE.payments || [])
    .filter(o => o.transaction_type === "agency_charge" && o.demo_id === p.demo_id && !!o.tutor_id === isTutorSide &&
      (o.payment_date < p.payment_date || (o.payment_date === p.payment_date && o.id < p.id)))
    .reduce((sum, o) => sum + Number(o.amount || 0), 0);
  const duesThen = Math.max(charge - paidBefore, 0);
  const rupees = n => "₹" + Number(n).toLocaleString("en-IN");
  const transactionLabel = isTutorSide ? "Tutor Agency Charge" : "Student Agency Charge";

  const boxes = `
    <div class="admin-boxes">
      ${box("Transaction", transactionLabel)}
      ${box("Demo ID", p.demo_id || "")}
      ${box(isTutorSide ? "Tutor ID" : "Student ID", partyId)}
      ${box("Mobile Number", partyMobile)}
      ${box("Name", partyName)}
      ${box("Agency Charge (₹)", rupees(charge))}
      ${box("Dues (₹)", rupees(duesThen))}
      ${box("Paying Now (₹)", editing ? p.amount : rupees(paying), { editable: editing, type: editing ? "number" : "text", attr: editing ? `data-pfield="amount"` : "" })}
      ${box("Payment Date", editing ? p.payment_date : formatDate(p.payment_date), { editable: editing, type: editing ? "date" : "text", attr: editing ? `data-pfield="paymentDate"` : "" })}
      ${box("Payment Mode", p.payment_mode, { editable: editing, options: ["Online", "Offline"], attr: editing ? `data-pfield="paymentMode"` : "" })}
      ${box("Notes", p.notes || "", { editable: editing, wide: true, multiline: true, attr: editing ? `data-pfield="notes"` : "" })}
    </div>`;

  return `
    <article class="admin-card tutor-row-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}" data-tone="neutral" data-box data-id="${p.id}" data-key="${esc(key)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        <div class="admin-avatar">₹</div>
        <div class="admin-card-title">
          <div class="admin-hl">
            <div class="admin-hl-top admin-hl-top-split" data-tone="neutral">
              ${infoLine(["Paid " + rupees(paying)])}
              <span class="admin-hl-top-right">${esc(recordedAt(p.created_at))}</span>
            </div>
          </div>
        </div>
        <span class="admin-caret" aria-hidden="true"></span>
      </div>

      <div class="admin-card-body">
        ${boxes}
        ${buttons}
      </div>

    </article>
  `;

}


/* ---------------- subscriptions ---------------- */

function renderSubscriptions() {

  if (!$("subscriptionList")) return;

  const query = searchQueryFor("subscriptionSearch");

  const rows = (STATE.subscriptions || []).filter(sub => {
    const student = sub.student_id ? STUDENT_BY_ID[sub.student_id] : null;
    const tutor = sub.tutor_id ? TUTOR_BY_ID[sub.tutor_id] : null;
    return matchesAll(query, [
      sub.plan_name, sub.student_id, sub.tutor_id,
      student && student.values["Student Name"],
      tutor && tutor.values["Full Name"]
    ].join(" "));
  });

  $("subscriptionList").innerHTML = rows.length
    ? rows.map(subscriptionCard).join("")
    : empty("No subscriptions yet.");

}

const SUBSCRIPTION_STATUS_LABELS = { active: "Active", paused: "Paused", cancelled: "Cancelled", completed: "Completed" };
const SUBSCRIPTION_STATUS_TONES = { active: "running", paused: "schedule", cancelled: "rejected", completed: "completed" };

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
    : `<div class="admin-split">
         <button class="admin-ghost" data-action="edit" data-key="${esc(key)}" type="button">Edit</button>
         <button class="admin-ghost admin-danger" data-action="delete-subscription" type="button" disabled title="Subscriptions cannot be deleted">Delete</button>
       </div>`;

  return `
    <article class="admin-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}" data-tone="neutral" data-box data-id="${sub.id}" data-key="${esc(key)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        <div class="admin-avatar">${esc(initials(partyName, "$"))}${subscriptionPayBadge(sub.student_id ? "student" : "tutor", partyId)}</div>
        <div class="admin-card-title">
          ${highlight(
            [partyName || partyId, partyMobile, partyId, sub.plan_name, "₹" + amount.toLocaleString("en-IN")],
            "",
            "|",
            "neutral"
          )}
        </div>
        <span class="admin-pill" data-tone="${SUBSCRIPTION_STATUS_TONES[sub.status] || ""}">${esc(SUBSCRIPTION_STATUS_LABELS[sub.status] || sub.status)}</span>
        <span class="admin-caret" aria-hidden="true"></span>
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

}

// Active | Suspend - same vertical button strip and light-tint /
// disabled-when-current-state look as the tutor Accept/Suspend pair.
function employeeStatusButtonsHtml(active) {
  return `
    <div class="admin-vbtns">
      <button class="admin-vbtn v-reject" type="button" data-action="employee-status" data-value="false"${!active ? " disabled" : ""}>Suspend</button>
      <button class="admin-vbtn v-approve" type="button" data-action="employee-status" data-value="true"${active ? " disabled" : ""}>Active</button>
    </div>
  `;
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
    </div>`;

  const buttons = editing
    ? `<div class="admin-pair">
         <button class="admin-primary" data-action="save-employee" type="button">Save changes</button>
         <button class="admin-ghost" data-action="cancel" data-key="${esc(key)}" type="button">Cancel</button>
       </div>`
    : `<button class="admin-ghost admin-wide" data-action="edit" data-key="${esc(key)}" type="button">Edit Employee</button>`;

  return `
    <article class="admin-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}" data-tone="${e.active ? "verified" : "rejected"}" data-box data-id="${esc(e.id)}" data-key="${esc(key)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        <div class="admin-avatar">${esc(initials(e.full_name, "E"))}</div>
        <div class="admin-card-title">
          ${highlight([e.full_name, e.email, ROLE_LABELS[e.role] || e.role, e.active ? "" : "Inactive"], isMe ? "This is you" : "", "|", e.active ? "verified" : "rejected")}
        </div>
        <span class="admin-caret" aria-hidden="true"></span>
        ${!isMe ? employeeStatusButtonsHtml(!!e.active) : ""}
      </div>

      <div class="admin-card-body">
        ${boxes}
        ${buttons}
      </div>

    </article>
  `;

}


/* ---------------- tuitions ---------------- */

function renderTuitions() {

  const query = searchQueryFor("tuitionSearch");
  const filter = STATE.tuitionFilter;

  const list = demoGroups().filter(g => {

    const student = STUDENT_BY_ID[g.first.studentId];

    const text = [
      g.demoId, g.first.subject, g.first.medium, g.first.preferredTutor, g.first.preferredTiming,
      GROUP_LABELS[groupState(g)],
      haystackOfRecord(student),
      ...g.rows.map(r => haystackOfRecord(TUTOR_BY_MOBILE[r.mobileKey]) + " " + (r.mobile || ""))
    ].join(" ");

    if (!matchesAll(query, text)) return false;

    if (filter === "today") {
      return g.rows.some(r => {
        const st = rowState(r);
        return r.hasTutor && isToday(r.demoDate) && st !== "declined" && st !== "terminated";
      });
    }

    return filter === "all" || groupState(g) === filter;

  }).reverse();

  $("tuitionList").innerHTML = list.length ? list.map(tuitionStack).join("") : empty("No tuitions match.");

}

// The one tutor row actually Running/Completed for a Tuition group, if
// any - the same row the Class card is keyed off, shared with anywhere
// else (like the Payments tab's status cards) that needs to know
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
        <span>Enter Tutor ID or Mobile Number to assign a tutor</span>
      </label>
      <div class="admin-suggest hidden" data-suggest></div>
      <button class="admin-primary admin-wide" data-action="assign" type="button" disabled>Assign Tutor</button>
    </div>`;

  const tuitionBoxes = `
    <div class="admin-boxes">
      ${box("Demo ID", g.demoId)}
      ${box("Subject", f.subject, { editable: editing, attr: editing ? `data-tfield="Subject"` : "" })}
      ${box("Medium", editing ? (f.medium || "Any") : mediumText(f.medium), { editable: editing, options: ["Any", "Online", "Offline"], attr: editing ? `data-tfield="Medium"` : "" })}
      ${box("Preferred Tutor", editing ? (f.preferredTutor || "Any") : genderText(f.preferredTutor), { editable: editing, options: ["Any", "Male", "Female"], attr: editing ? `data-tfield="Preferred Tutor"` : "" })}
      ${box("Preferred Timing", f.preferredTiming, { editable: editing, wide: true, attr: editing ? `data-tfield="Preferred Timing"` : "" })}
      ${box("Posted On", f.postedOn)}
    </div>`;

  const tuitionButtons = editing
    ? editButtons(key, true, "save-tuition", "Edit Tuition")
    : `<div class="admin-split">
         <button class="admin-ghost" data-action="edit" data-key="${esc(key)}" type="button">Edit Tuition</button>
         ${terminated
           ? `<button class="admin-ghost" data-action="reopen" type="button">Reopen Tuition</button>`
           : `<button class="admin-ghost admin-danger" data-action="terminate" type="button">Terminate Tuition</button>`}
       </div>`;

  // Top layer: Demo ID, Subject, Class, tutor Gender/Medium preferences
  // (left) with the applied count pushed to the right. Bottom layer:
  // the student's own contact details, plain text, left-aligned.
  const topLine = infoLine(
    [g.demoId, f.subject, sv("Class"), genderText(f.preferredTutor), mediumText(f.medium)],
    "·"
  );
  const bottomText = [studentName, sv("WhatsApp") || sv("Phone"), sv("Gender"), fullAddress(sv("Address"), sv("City"), sv("PIN Code"))]
    .filter(Boolean).map(esc).join(" · ");

  const titleHtml = `
    <div class="admin-hl">
      <div class="admin-hl-top admin-hl-top-split" data-tone="${esc(railTone)}">
        ${topLine}
        <span class="admin-hl-top-right">
          <span class="admin-hl-small-applied">${esc(appliedLabel)}</span>
        </span>
      </div>
      ${bottomText ? `<p class="admin-hl-small">${bottomText}</p>` : ""}
    </div>`;

  const head = `
    <article class="admin-card tuition-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}" data-box data-tone="${esc(railTone)}" data-demo="${esc(g.demoId)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        <div class="admin-avatar">${esc(initials(studentName, "S"))}${subscriptionPayBadge("student", f.studentId)}</div>
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

// A separate card for the currently Running/Completed class's own
// schedule and money - which days it meets, its own charges/term dates,
// the Student's and Tutor's own payment terms (computed Total
// Payment/Dues, not typed in), their profiles, and every payment
// recorded against this Tuition, with a shortcut into recording a new
// one pre-filled with this Demo/Tutor ID.
// All the money maths shared between the Class card's Student/Tutor
// sections and the Payments tab's own 4 status cards for this Tuition,
// so the two views can never disagree about what's owed.
function classMoney(g, activeRow) {

  const studentTotalAmount = (num(activeRow.classDuration) / 60) * num(activeRow.classCharges) * num(activeRow.classCount);
  const demoCollections = (STATE.payments || []).filter(p => p.demo_id === g.demoId && p.transaction_type !== "payout");
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
  const tutorAdvance = num(activeRow.tutorAdvancePayment);
  const tutorPayouts = (STATE.payments || [])
    .filter(p => p.tutor_id === activeRow.tutorId && p.transaction_type === "payout")
    .reduce((sum, p) => sum + num(p.amount), 0);
  const tutorTotalPayment = tutorAdvance + tutorPayouts;
  const tutorDues = Math.max(tutorTotalAmount - tutorAgencyCharge - tutorTotalPayment, 0);

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

function classCard(g, activeRow) {

  const key = "class:" + g.demoId;
  const open = STATE.open.has(key);
  const editing = STATE.editing.has(key);
  const days = new Set((activeRow.classDays && activeRow.classDays.length) ? activeRow.classDays : DEFAULT_CLASS_DAYS);

  const dayChips = WEEKDAYS.map(d => `
    <button type="button" class="admin-chip admin-day-chip${days.has(d) ? " is-on" : ""}"
      data-action="toggle-class-day" data-row="${activeRow.rowNumber}" data-tutor-id="${esc(activeRow.tutorId)}" data-day="${esc(d)}">${esc(WEEKDAY_LABELS[d])}</button>
  `).join("");

  const student = STUDENT_BY_ID[g.first.studentId];
  const tutor = TUTOR_BY_ID[activeRow.tutorId];
  const sv = field => (student && student.values[field]) || "";
  const tv = field => (tutor && tutor.values[field]) || "";

  const cfield = f => editing ? `data-cfield="${esc(f)}"` : "";

  // Start Date defaults to today, End Date to a week out, and the two
  // Next Due/Payment Dates a week (and a week + 1 day) out - all until
  // the admin actually picks a date of their own, both in the edit form
  // (so saving without touching it still records the default) and in
  // the plain display.
  const addDaysISO = (iso, n) => {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const todayISO = new Date().toISOString().slice(0, 10);
  const todayDMY = todayISO.split("-").reverse().join("/");
  const nextWeekISO = addDaysISO(todayISO, 7);
  const nextWeekDMY = nextWeekISO.split("-").reverse().join("/");
  const nextWeekPlusOneISO = addDaysISO(todayISO, 8);
  const nextWeekPlusOneDMY = nextWeekPlusOneISO.split("-").reverse().join("/");
  const startDateShown = editing ? (toDateInput(activeRow.classStartDate) || todayISO) : (activeRow.classStartDate || todayDMY);
  const endDateShown = editing ? (toDateInput(activeRow.classEndDate) || nextWeekISO) : (activeRow.classEndDate || nextWeekDMY);
  const studentNextDueShown = editing ? (toDateInput(activeRow.studentNextDueDate) || nextWeekISO) : (activeRow.studentNextDueDate || nextWeekDMY);
  const tutorNextPaymentShown = editing ? (toDateInput(activeRow.tutorNextPaymentDate) || nextWeekPlusOneISO) : (activeRow.tutorNextPaymentDate || nextWeekPlusOneDMY);

  const tuitionTermsBoxes = `
    <div class="admin-boxes">
      ${box("Class Duration (Minutes)", activeRow.classDuration, { editable: editing, type: "number", attr: cfield("Class Duration") })}
      ${box("Per hour Charges (₹)", activeRow.classCharges, { editable: editing, type: "number", attr: cfield("Class Charges") })}
      ${box("Start Date", startDateShown, { editable: editing, type: editing ? "date" : "text", attr: cfield("Class Start Date") })}
      ${box("End Date", endDateShown, { editable: editing, type: editing ? "date" : "text", attr: cfield("Class End Date") })}
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
    tutorTotalAmount, tutorTotalPayment, tutorDues,
    studentAgencyCharge, studentAgencyReceived,
    tutorAgencyCharge, tutorAgencyReceived
  } = classMoney(g, activeRow);

  // Student and Tutor sit side by side as two columns (stacking on
  // narrow screens) - the full profile toggle is gone, just this
  // party's own name/contact/payment terms for this class.
  const studentSection = `
    <div class="admin-class-party">
      <h3 class="admin-section-title">Student</h3>
      <div class="admin-boxes">
        ${box("Name", sv("Student Name"), { wide: true })}
        ${box("Mobile Number", sv("Phone"))}
        ${box("WhatsApp Number", sv("WhatsApp"))}
        ${box("Payment To", editing ? (activeRow.studentPaymentTo || "Agency") : activeRow.studentPaymentTo, { editable: editing, options: ["Agency", "Tutor"], attr: cfield("Student Payment To") })}
        ${box("Next Due Date", studentNextDueShown, { editable: editing, type: editing ? "date" : "text", attr: cfield("Student Next Due Date") })}
        ${box("Agency Charge (₹)", editing ? (activeRow.studentAgencyCharge || 0) : activeRow.studentAgencyCharge, { editable: editing, type: "number", attr: cfield("Student Agency Charge") })}
        ${box("Payment Frequency", editing ? (activeRow.studentPaymentFrequency || "Weekly") : activeRow.studentPaymentFrequency, { editable: editing, options: ["Weekly", "Monthly"], attr: cfield("Student Payment Frequency") })}
        ${box("Advance Payment (₹)", studentAdvancePaid)}
        ${box("Total Amount (₹)", studentTotalAmount)}
        ${box("Total Payment (₹)", collected)}
        ${box("Dues (₹)", studentDues)}
      </div>
    </div>`;

  const tutorSection = `
    <div class="admin-class-party">
      <h3 class="admin-section-title">Tutor</h3>
      <div class="admin-boxes">
        ${box("Tutor Name", tv("Full Name"), { wide: true })}
        ${box("Mobile Number", tv("Mobile Number"))}
        ${box("WhatsApp Number", tv("WhatsApp Number"))}
        ${box("Payment From", editing ? (activeRow.tutorPaymentFrom || "Agency") : activeRow.tutorPaymentFrom, { editable: editing, options: ["Agency", "Parents"], attr: cfield("Tutor Payment From") })}
        ${box("Next Payment Date", tutorNextPaymentShown, { editable: editing, type: editing ? "date" : "text", attr: cfield("Tutor Next Payment Date") })}
        ${box("Agency Charges (₹)", editing ? (activeRow.tutorAgencyCharge || 0) : activeRow.tutorAgencyCharge, { editable: editing, type: "number", attr: cfield("Tutor Agency Charge") })}
        ${box("Payment Frequency", editing ? (activeRow.tutorPaymentFrequency || "Weekly") : activeRow.tutorPaymentFrequency, { editable: editing, options: ["Weekly", "Monthly"], attr: cfield("Tutor Payment Frequency") })}
        ${box("Advance Payment (₹)", activeRow.tutorAdvancePayment, { editable: editing, type: "number", attr: cfield("Tutor Advance Payment") })}
        ${box("Total Amount (₹)", tutorTotalAmount)}
        ${box("Total Payment (₹)", tutorTotalPayment)}
        ${box("Dues (₹)", tutorDues)}
      </div>
    </div>`;

  // Collapsed head: 4 fraction figures in one row - Student's own Total
  // Payment/Total Amount on the far left, Tutor's on the far right, and
  // each side's own Agency Payment/Agency Amount centred between them
  // (Student's agency fraction first, then Tutor's).
  const rupees = n => "₹" + Number(n || 0).toLocaleString("en-IN");
  const frac = (paid, total) => `
    <span class="admin-class-frac-num">${esc(rupees(paid))}</span>
    <span class="admin-class-frac-den">${esc(rupees(total))}</span>`;

  const titleHtml = `
    <div class="admin-class-fracs">
      <span class="admin-class-frac admin-class-frac-left">${frac(collected, studentTotalAmount)}</span>
      <span class="admin-class-frac-center">
        <span class="admin-class-frac">${frac(studentAgencyReceived, studentAgencyCharge)}</span>
        <span class="admin-class-frac">${frac(tutorAgencyReceived, tutorAgencyCharge)}</span>
      </span>
      <span class="admin-class-frac admin-class-frac-right">${frac(tutorTotalPayment, tutorTotalAmount)}</span>
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

        <div class="admin-day-chips">${dayChips}</div>

        <h3 class="admin-section-title admin-section-title-center">Tuition ID: ${esc(g.demoId)}</h3>
        ${tuitionTermsBoxes}
        <div class="admin-class-count">
          <span>Number of Classes: <strong>${esc(activeRow.classCount || 0)}</strong></span>
          <button class="admin-ghost" data-action="increment-class-count" data-row="${activeRow.rowNumber}" data-tutor-id="${esc(activeRow.tutorId)}" type="button">+1 Class</button>
        </div>

        <div class="admin-class-parties">
          ${studentSection}
          ${tutorSection}
        </div>

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
        <div class="admin-avatar">${esc(initials(name, "T"))}${subscriptionPayBadge("tutor", tutor ? tutor.id : "")}</div>
        <div class="admin-card-title">
          ${highlight(
            [name, tv("WhatsApp Number"), tv("Mobile Number"), tutor ? tutor.id : row.mobile, tv("Subject You Teach")],
            [
              [tv("Graduation - Course"), tv("Graduation - Subject")].filter(Boolean).join(" - "),
              fullAddress(tv("Present Address"), tv("City"), tv("Pin Code"))
            ].filter(Boolean).join(" | "),
            "|",
            state
          )}
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
    lower(r.id) === t || (key.length === 10 && mobileKey(r.values["Mobile Number"]) === key)
  ) || null;

}

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
  const ok = !!found && !onThis.has(mobileKey(found.values["Mobile Number"])) &&
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
    const already = onThis.has(mobileKey(r.values["Mobile Number"]));
    const verified = lower(r.values["Verification Status"]) === "verified";
    const why = already ? "Already on this tuition" : (verified ? "" : (r.values["Verification Status"] || "Not verified"));
    return `
      <button type="button" class="admin-suggest-item" data-pick="${esc(r.id)}"${already || !verified ? " disabled" : ""}>
        <strong>${esc(r.id)}</strong>
        <span>${esc(r.values["Full Name"] || "")} · ${esc(r.values["Mobile Number"] || "")}</span>
        ${why ? `<em>${esc(why)}</em>` : ""}
      </button>`;
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
