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
  paymentsSubTab: "payments",
  tab: "tuitions",
  tutorFilter: "all",
  tuitionFilter: "all",
  open: new Set(),      // keys of expanded cards
  editing: new Set()    // keys of records in edit mode
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
    employees: perms.employees
  };

  let firstVisible = null;

  ["tuitions", "tutors", "students", "payments", "employees"].forEach(name => {
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
  ["tuitions", "tutors", "students", "payments", "employees"].forEach(n => {
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

  ["tuitionList", "tutorList", "studentList", "paymentList", "employeeList", "subscriptionList"].forEach(id =>
    $(id).addEventListener("click", onListClick)
  );

  $("tuitionList").addEventListener("input", onAssignInput);

  $("paymentsSubTabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-subtab]");
    if (!tab) return;
    STATE.paymentsSubTab = tab.dataset.subtab;
    $("paymentsSubTabs").querySelectorAll("[data-subtab]").forEach(t => t.classList.toggle("active", t === tab));
    $("subtab-payments").classList.toggle("hidden", STATE.paymentsSubTab !== "payments");
    $("subtab-subscriptions").classList.toggle("hidden", STATE.paymentsSubTab !== "subscriptions");
  });

  wirePaymentForm();
  wirePaymentIdSuggestions();
  wireSubscriptionForm();
  wireSubscriptionIdSuggestion();
  wireEmployeeForm();

}

// Shows/hides the fields that only apply to a collection (from a
// parent) vs. a payout (agency paying a tutor out of what it collected).
function applyPaymentTransactionType() {
  const isPayout = $("paymentTransactionType").value === "payout";
  $("paymentTypeField").classList.toggle("hidden", isPayout);
  $("collectedByField").classList.toggle("hidden", isPayout);
  $("ourCutField").classList.toggle("hidden", isPayout);
  $("paymentDemoIdField").classList.toggle("hidden", isPayout || !!$("paymentSubscriptionId").value);
  $("paymentTutorIdField").querySelector("span").textContent = isPayout ? "Tutor ID" : "Tutor ID (optional)";
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
  $("paymentMode").value = "";
  $("paymentOurCut").value = "";
  $("paymentTutorId").value = "";
  $("paymentNotes").value = "";
  updateIdDetail($("paymentDemoDetail"), null);
  updateIdDetail($("paymentTutorDetail"), null);
  document.querySelectorAll('#paymentDemoIdField .admin-suggest, #paymentTutorIdField .admin-suggest')
    .forEach(el => el.classList.add("hidden"));
  applyPaymentTransactionType();
}

// Opens the payment form pre-filled for one subscription's renewal,
// switching over to the Payments sub-tab so the form is visible.
function openPaymentFormForSubscription(sub) {
  STATE.paymentsSubTab = "payments";
  $("paymentsSubTabs").querySelectorAll("[data-subtab]").forEach(t => t.classList.toggle("active", t.dataset.subtab === "payments"));
  $("subtab-payments").classList.remove("hidden");
  $("subtab-subscriptions").classList.add("hidden");

  resetPaymentForm();
  $("paymentSubscriptionId").value = sub.id;
  $("paymentDemoIdField").classList.add("hidden");
  $("paymentForSubscription").classList.remove("hidden");
  $("paymentForSubscription").textContent = `For subscription: ${sub.plan_name} (₹${Number(sub.amount).toLocaleString("en-IN")} / ${sub.billing_cycle})`;
  $("paymentAmount").value = sub.amount;
  if (sub.tutor_id) {
    $("paymentTutorId").value = sub.tutor_id;
    updateIdDetail($("paymentTutorDetail"), DIR_TUTOR_BY_ID[sub.tutor_id] || null);
  }
  applyPaymentTransactionType();

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

  $("paymentTransactionType").addEventListener("change", applyPaymentTransactionType);

  $("paymentForm").addEventListener("submit", async (event) => {

    event.preventDefault();

    const isPayout = $("paymentTransactionType").value === "payout";
    const demoId = $("paymentDemoId").value.trim();
    const subscriptionId = $("paymentSubscriptionId").value;
    const tutorId = $("paymentTutorId").value.trim();

    if (isPayout && !tutorId) {
      toast("Enter which Tutor ID is being paid.", true);
      return;
    }

    if (!isPayout && !demoId && !subscriptionId) {
      toast("Enter the Demo ID.", true);
      return;
    }

    const payload = {
      action: "adminAddPayment",
      transactionType: $("paymentTransactionType").value,
      demoId,
      subscriptionId: subscriptionId || undefined,
      tutorId,
      amount: $("paymentAmount").value,
      paymentType: $("paymentType").value,
      collectedBy: $("paymentCollectedBy").value,
      ourCutAmount: $("paymentOurCut").value,
      paymentMode: $("paymentMode").value.trim(),
      paymentDate: $("paymentDate").value,
      notes: $("paymentNotes").value.trim()
    };

    const button = $("paymentForm").querySelector("button[type=submit]");
    const ok = await save(payload, button);

    if (ok) $("paymentForm").classList.add("hidden");

  });

}

function wireSubscriptionForm() {

  $("subscriptionPartyType").addEventListener("change", () => {
    const isStudent = $("subscriptionPartyType").value === "student";
    $("subscriptionPartyIdLabel").textContent = isStudent ? "Student ID" : "Tutor ID";
    $("subscriptionPartyId").value = "";
    updateIdDetail($("subscriptionPartyDetail"), null);
    document.querySelector('#subscriptionPartyIdField .admin-suggest').classList.add("hidden");
  });

  $("addSubscriptionButton").addEventListener("click", () => {
    const form = $("subscriptionForm");
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) {
      $("subscriptionPartyType").value = "student";
      $("subscriptionPartyIdLabel").textContent = "Student ID";
      $("subscriptionPartyId").value = "";
      $("subscriptionPlanName").value = "";
      $("subscriptionAmount").value = "";
      $("subscriptionBillingCycle").value = "Monthly";
      $("subscriptionStartDate").value = new Date().toISOString().slice(0, 10);
      $("subscriptionNextDueDate").value = "";
      $("subscriptionNotes").value = "";
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

function studentOrTutorSuggestions(query, isStudent) {
  const q = lower(query);
  const digits = String(query || "").replace(/\D/g, "");
  const list = isStudent ? (STATE.directory.students || []) : (STATE.directory.tutors || []);
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

  } else {

    STATE.open.delete(key);

  }

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

// Filter / tab change: everything collapses, unsaved edits are dropped.
function collapseAll() {
  STATE.open.clear();
  STATE.editing.clear();
}

function rerenderCurrent() {
  if (STATE.tab === "tuitions") renderTuitions();
  if (STATE.tab === "tutors") renderTutors();
  if (STATE.tab === "students") renderStudents();
  if (STATE.tab === "payments") { renderPayments(); renderSubscriptions(); }
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

    case "save-subscription":
      await saveSubscriptionEdit(box, actionEl);
      break;

    case "delete-subscription": {
      const id = Number(box.dataset.id);
      if (window.confirm("Delete this subscription? This cannot be undone.")) {
        await save({ action: "adminDeleteSubscription", id }, actionEl);
      }
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

  // The database finds the row by Demo ID + Tutor ID.
  const row = (STATE.data.demos || []).find(r => r.rowNumber === rowNumber && r.demoId === demoId);

  if (!row || !row.tutorId) {
    toast("That row has changed. Refresh and try again.", true);
    return;
  }

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
  new: "Find Tutors", schedule: "Schedule Demo", scheduled: "Demo Scheduled",
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
function highlight(boldValues, smallText, separator, tone) {
  const line = infoLine(boldValues, separator);
  const small = String(smallText || "").trim();
  return `<div class="admin-hl">
    <div class="admin-hl-top" data-tone="${esc(tone || "")}">${line}</div>
    ${small ? `<p class="admin-hl-small">${small}</p>` : ""}
  </div>`;
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
        <div class="admin-avatar">${esc(initials(opts.name, kind === "tutors" ? "T" : "S"))}</div>
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
      <button type="button" data-remove-chip="${i}" aria-label="Remove filter ${esc(word)}">&times;</button>
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
    if (event.key !== " ") return;
    event.preventDefault();
    const word = input.value.trim();
    if (!word) return;
    SEARCH_CHIPS[id].push(word);
    input.value = "";
    renderSearchChips(id);
    onChange();
  });

  label.addEventListener("click", (event) => {
    const row = event.target.closest(`.admin-search-chips[data-chips-for="${id}"]`);
    const btn = event.target.closest("[data-remove-chip]");
    if (!row || !btn) return;
    SEARCH_CHIPS[id].splice(Number(btn.dataset.removeChip), 1);
    renderSearchChips(id);
    onChange();
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
        ${mine.map(g => `<span class="admin-pill" data-tone="${groupState(g)}">${esc(g.first.subject)} · ${esc(GROUP_LABELS[groupState(g)])}</span>`).join("")}
      </div>` : "";

    return recordCard("students", r, {
      name: r.values["Student Name"],
      // Name | WhatsApp Number | Class | Board - all bold, one line
      titleHtml: highlight([
        r.values["Student Name"] || r.id,
        r.values["WhatsApp"] || r.values["Phone"],
        r.values["Class"],
        r.values["Board"],
        fullAddress(r.values["Address"], r.values["City"], r.values["PIN Code"])
      ], "", "|", "blue"),
      extra
    });

  }).join("") : empty("No students match.");

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

  const query = searchQueryFor("paymentSearch");

  const rows = (STATE.payments || []).filter(p => matchesAll(query, [
    p.demo_id, p.tutor_id, p.payment_mode, p.notes,
    context[p.demo_id] && context[p.demo_id].studentName
  ].join(" ")));

  $("paymentList").innerHTML = rows.length
    ? rows.map(p => paymentCard(p, context[p.demo_id] || {})).join("")
    : empty("No payments recorded yet.");

}

function paymentCard(p, ctx) {

  const key = "payment:" + p.id;
  const editing = STATE.editing.has(key);
  const amount = Number(p.amount || 0);
  const cut = p.our_cut_amount != null && p.our_cut_amount !== "" ? Number(p.our_cut_amount) : null;
  const isPayout = p.transaction_type === "payout";
  const tutorCollected = p.collected_by === "tutor";

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
      ${box("Payment Date", p.payment_date, { editable: editing, type: "date", attr: editing ? `data-pfield="paymentDate"` : "" })}
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

  const headline = isPayout
    ? [p.tutor_id, "Payout to Tutor", "₹" + amount.toLocaleString("en-IN")]
    : [p.demo_id, ctx.studentName, ctx.subject, "₹" + amount.toLocaleString("en-IN"), tutorCollected ? "Tutor collected" : "Agency collected"];

  return `
    <article class="admin-card is-open${editing ? " is-editing" : ""}" data-box data-id="${p.id}" data-key="${esc(key)}">

      <div class="admin-card-head">
        <div class="admin-avatar">₹</div>
        <div class="admin-card-title">
          ${highlight(
            headline,
            !isPayout && cut != null ? `Our cut: ₹${cut.toLocaleString("en-IN")}` : "",
            "|",
            isPayout ? "scheduled" : (tutorCollected ? "processing" : "running")
          )}
        </div>
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
  const editing = STATE.editing.has(key);

  const student = sub.student_id ? STUDENT_BY_ID[sub.student_id] : null;
  const tutor = sub.tutor_id ? TUTOR_BY_ID[sub.tutor_id] : null;
  const partyName = student ? (student.values["Student Name"] || sub.student_id) : (tutor ? (tutor.values["Full Name"] || sub.tutor_id) : "");
  const partyKind = sub.student_id ? "Student" : "Tutor";
  const amount = Number(sub.amount || 0);

  const boxes = `
    <div class="admin-boxes">
      ${box(partyKind + " ID", sub.student_id || sub.tutor_id || "")}
      ${box("Plan Name", sub.plan_name, { editable: editing, wide: true, attr: editing ? `data-subfield="planName"` : "" })}
      ${box("Amount (₹)", sub.amount, { editable: editing, type: "number", attr: editing ? `data-subfield="amount"` : "" })}
      ${box("Billing Cycle", sub.billing_cycle, { editable: editing, attr: editing ? `data-subfield="billingCycle"` : "" })}
      ${box("Status", SUBSCRIPTION_STATUS_LABELS[sub.status] || sub.status, {
        editable: editing,
        options: Object.values(SUBSCRIPTION_STATUS_LABELS),
        attr: editing ? `data-subfield="status"` : ""
      })}
      ${box("Start Date", sub.start_date, { editable: editing, type: "date", attr: editing ? `data-subfield="startDate"` : "" })}
      ${box("Next Due Date", sub.next_due_date || "", { editable: editing, type: "date", attr: editing ? `data-subfield="nextDueDate"` : "" })}
      ${box("Notes", sub.notes || "", { editable: editing, wide: true, multiline: true, attr: editing ? `data-subfield="notes"` : "" })}
    </div>`;

  const buttons = editing
    ? `<div class="admin-pair">
         <button class="admin-primary" data-action="save-subscription" type="button">Save changes</button>
         <button class="admin-ghost" data-action="cancel" data-key="${esc(key)}" type="button">Cancel</button>
       </div>`
    : `<div class="admin-split">
         <button class="admin-ghost" data-action="edit" data-key="${esc(key)}" type="button">Edit</button>
         <button class="admin-ghost admin-danger" data-action="delete-subscription" type="button">Delete</button>
       </div>`;

  return `
    <article class="admin-card is-open${editing ? " is-editing" : ""}" data-tone="${SUBSCRIPTION_STATUS_TONES[sub.status] || ""}" data-box data-id="${sub.id}" data-key="${esc(key)}">

      <div class="admin-card-head">
        <div class="admin-avatar">${esc(initials(partyName, "$"))}</div>
        <div class="admin-card-title">
          ${highlight(
            [partyName || (sub.student_id || sub.tutor_id), sub.plan_name, "₹" + amount.toLocaleString("en-IN"), sub.billing_cycle],
            sub.next_due_date ? `Next due: ${sub.next_due_date}` : "",
            "|",
            SUBSCRIPTION_STATUS_TONES[sub.status] || "schedule"
          )}
        </div>
        <span class="admin-pill" data-tone="${SUBSCRIPTION_STATUS_TONES[sub.status] || ""}">${esc(SUBSCRIPTION_STATUS_LABELS[sub.status] || sub.status)}</span>
      </div>

      <div class="admin-card-body">
        ${boxes}
        ${editing ? "" : `<button class="admin-ghost admin-wide" data-action="record-payment" type="button">Record a Payment for this Subscription</button>`}
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

function employeeCard(e) {

  const key = "employee:" + e.id;
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
    <article class="admin-card is-open${editing ? " is-editing" : ""}" data-box data-id="${esc(e.id)}" data-key="${esc(key)}">

      <div class="admin-card-head">
        <div class="admin-avatar">${esc(initials(e.full_name, "E"))}</div>
        <div class="admin-card-title">
          ${highlight([e.full_name, e.email, ROLE_LABELS[e.role] || e.role, e.active ? "" : "Inactive"], isMe ? "This is you" : "", "|", e.active ? "verified" : "rejected")}
        </div>
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
  const sv = field => (student && student.values[field]) || "";

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

  const head = `
    <article class="admin-card tuition-card${open ? " is-open" : ""}${editing ? " is-editing" : ""}" data-box data-demo="${esc(g.demoId)}">

      <div class="admin-card-head" data-toggle="${esc(key)}">
        <div class="admin-avatar">${esc(initials(studentName, "S"))}</div>
        <div class="admin-card-title">
          ${highlight(
            [studentName, sv("WhatsApp") || sv("Phone"), g.demoId, f.subject, sv("Class"),
             genderText(f.preferredTutor), mediumText(f.medium)],
            [esc(sv("Gender")),
             esc(fullAddress(sv("Address"), sv("City"), sv("PIN Code"))),
             `<span class="admin-hl-count">${tutorRows.length} tutor${tutorRows.length === 1 ? "" : "s"} applied</span>`
            ].filter(Boolean).join(" · "),
            "·",
            state
          )}
        </div>
        <span class="admin-pill" data-tone="${state}">${esc(GROUP_LABELS[state])}</span>
        <span class="admin-caret" aria-hidden="true"></span>
      </div>

      <div class="admin-card-body">

        <h3 class="admin-section-title">Tuition</h3>
        ${tuitionBoxes}
        ${tuitionButtons}

        <h3 class="admin-section-title">Student</h3>
        ${student ? fieldsBoxes("students", student, false) : note(`Student ${f.studentId} was not found.`)}

        ${terminated ? "" : `
          <div class="admin-assign">
            <label class="admin-float">
              <input data-assign type="text" placeholder=" " autocomplete="off">
              <span>Enter Tutor ID or Mobile Number to assign a tutor</span>
            </label>
            <div class="admin-suggest hidden" data-suggest></div>
            <button class="admin-primary admin-wide" data-action="assign" type="button" disabled>Assign Tutor</button>
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

function tutorRowCard(row, terminated) {

  const tutor = TUTOR_BY_MOBILE[row.mobileKey];
  const key = `row:${row.rowNumber}:${row.demoId}`;
  const open = STATE.open.has(key);
  const state = rowState(row);
  const name = tutor ? tutor.values["Full Name"] : "Unknown tutor";
  const gender = tutor ? tutor.values["Gender"] : "";
  const verification = tutor ? tutor.values["Verification Status"] : "";
  const off = terminated ? " disabled" : "";
  const tv = field => (tutor && tutor.values[field]) || "";

  const parent = row.parentAccepted ? "accepted" : row.parentRejected ? "rejected" : "pending";
  const tut = row.tutorAccepted ? "accepted" : row.tutorRejected ? "rejected" : "pending";

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
        <div class="admin-avatar">${esc(initials(name, "T"))}</div>
        <div class="admin-card-title">
          ${highlight(
            [name, tv("WhatsApp Number") || tv("Mobile Number") || row.mobile,
             tv("Graduation - Course"), tv("Graduation - Subject")],
            [esc(gender),
             esc(fullAddress(tv("Present Address"), tv("City"), tv("Pin Code"))),
             lower(verification) === "verified" ? "" : `<span class="warn">${esc(verification || "Not verified")}</span>`
            ].filter(Boolean).join(" · "),
            "|",
            state
          )}
        </div>
        <span class="admin-pill" data-tone="${state}">${esc(ROW_LABELS[state])}</span>
        <span class="admin-caret" aria-hidden="true"></span>
      </div>

      <div class="admin-card-body">

        <h3 class="admin-section-title">Tutor</h3>
        ${tutor ? fieldsBoxes("tutors", tutor, false) : note(`No tutor has mobile ${row.mobile}.`)}

        <div class="admin-demo-grid admin-demo-2">
          ${input("date", "Demo Date", toDateInput(row.demoDate), "date")}
          ${input("time", "Demo Time", toTimeInput(row.demoTime), "time")}
        </div>
        <div class="admin-demo-grid admin-demo-3">
          ${input("price", "Price", row.price)}
          ${input("duration", "Duration", row.duration)}
          ${input("percentage", "Percentage", row.percentage)}
        </div>

        <h3 class="admin-section-title">Parent</h3>
        ${segmented("parent", parent)}

        <h3 class="admin-section-title">Tutor</h3>
        ${segmented("tutor", tut)}

        <label class="pill-check">
          <input data-rfield="completed" type="checkbox"${row.classesCompleted ? " checked" : ""}${off}>
          <span class="pill-check-text">Classes Completed</span>
          <span class="pill-check-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
        </label>

        ${terminated
          ? note("This tuition is terminated. Reopen it to make changes.")
          : `<button class="admin-primary admin-wide" data-action="save-row" type="button">Save</button>`}

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
