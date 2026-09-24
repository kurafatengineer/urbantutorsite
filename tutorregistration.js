"use strict";

/************************************************************
 * URBANTUTORSITE - TUTOR REGISTRATION (front-end)
 *
 * FLOW
 *   1. Email page
 *        - email already registered -> LOGIN  : OTP  -> welcome page
 *        - new email                -> REGISTER: form -> OTP -> saved
 *   2. Registration page (validated in the browser)
 *   3. OTP page (shared by registration and login)
 *   4. Success page
 *
 * API ACTIONS USED (see API Router.gs / Tutor Registration.gs)
 *   checkTutorEmail            sendTutorOTP
 *   resendTutorOTP             verifyTutorOTP
 *   completeTutorRegistration  getTutorProfile   (NEW)
 *
 * UPDATE (Tutor Login / Session):
 *   A successful login OR a freshly completed registration now
 *   returns a "sessionToken". showSuccess() stores it in
 *   localStorage and sends the tutor straight to index.html,
 *   already logged in, instead of showing a static message.
 *   The IIFE at the bottom of this file checks for an existing
 *   session on page load and, if it is still valid, skips the
 *   login form entirely and goes straight to index.html.
 ************************************************************/


/************************************************************
 * CONFIGURATION
 ************************************************************/

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwnhZnXpGVegX3kQtggtRjTej1JrsgfUdDyPrtMmuxh-IR_I8EGudmGAgLscda2y3nxLg/exec";

const MAX_FILE_SIZE = 5 * 1024 * 1024;   // 5 MB per document


/************************************************************
 * STATE
 ************************************************************/

let currentEmail = "";     // email the tutor entered on page 1
let currentMode = "";      // "register" or "login"
let currentName = "";      // used only in the OTP e-mail greeting
let verifiedToken = "";    // received after a correct registration OTP
let resendTimer = null;    // countdown interval for "Resend OTP"


/************************************************************
 * SMALL HELPERS
 ************************************************************/

const $ = id => document.getElementById(id);

function val(id) { return ($(id)?.value || "").trim(); }

function cleanText(value) { return String(value || "").trim().replace(/\s+/g, " "); }

function checked(name) {
  const e = document.querySelector(`input[name="${name}"]:checked`);
  return e ? e.value : "";
}

/* Values of all ticked checkboxes inside a container */
function values(containerId) {
  return [...document.querySelectorAll(`#${containerId} input:checked`)].map(x => x.value);
}

function normalizeEmail(email) { return String(email || "").trim().toLowerCase(); }

function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email); }

/* Inline field error.
   On the registration form the box (or buttons / upload card / terms
   tick) of the field gets a light red border; the message text stays
   hidden there. The email and OTP pages still show their messages. */
function errorHost(e) {
  if (!e) return null;
  const field = e.closest(".field");
  if (field) return field;
  const before = e.previousElementSibling;
  return before && (before.classList.contains("terms") || before.classList.contains("upload-card")) ? before : null;
}

function setError(id, text) {
  const e = $(id);
  if (!e) return;
  e.textContent = text || "";
  const host = errorHost(e);
  if (host) host.classList.toggle("has-error", !!text);
}

function clearErrors() {
  document.querySelectorAll(".field-error").forEach(e => e.textContent = "");
  document.querySelectorAll(".has-error").forEach(e => e.classList.remove("has-error"));
}

/* Status message under a form ("info" | "error" | "success") */
function showMessage(id, text, type = "") {
  const el = $(id);
  if (!el) return;
  el.textContent = text || "";
  el.className = "message" + (type ? " " + type : "");
}

function clearMessages() {
  ["emailMessage", "registrationMessage", "otpMessage"].forEach(id => showMessage(id, ""));
}

/* Swap a button's label for a spinner */
function setBusy(button, textId, loaderId, busy) {
  button.disabled = busy;
  // The OTP page has no visible button: show the spinner in the box
  // (it stays there while the documents upload, too).
  if (textId === "verifyOtpText") {
    const field = $("otp").closest(".field");
    if (field) field.classList.toggle("is-busy", busy);
    $("otp").readOnly = busy;
  }
  $(textId).classList.toggle("hidden", busy);
  $(loaderId).classList.toggle("hidden", !busy);
}

/* Keep only digits (or digits + one dot when allowDecimal) */
function digitsOnly(input, allowDecimal = false) {
  let v = input.value;
  if (allowDecimal) {
    v = v.replace(/[^\d.]/g, "");
    const firstDot = v.indexOf(".");
    if (firstDot !== -1) {
      v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
    }
  } else {
    v = v.replace(/\D/g, "");
  }
  input.value = v;
}

function formatFileSize(bytes) {
  return bytes >= 1024 * 1024
    ? (bytes / (1024 * 1024)).toFixed(1) + " MB"
    : Math.max(1, Math.round(bytes / 1024)) + " KB";
}


/************************************************************
 * PAGE MANAGEMENT
 ************************************************************/

function showPage(name) {
  ["email", "registration", "otp", "success"].forEach(n =>
    $(n + "Page").classList.toggle("hidden", n !== name)
  );
  window.scrollTo(0, 0);
}


/************************************************************
 * API REQUEST (with timeout and readable errors)
 ************************************************************/

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
    } catch (e) {
      throw new Error("Server returned an invalid response.");
    }

  } catch (err) {

    if (err.name === "AbortError") throw new Error("Request timed out. Please try again.");
    if (err instanceof TypeError) throw new Error("Unable to connect to the server. Please try again.");
    throw err;

  } finally {

    clearTimeout(timer);

  }

}


/************************************************************
 * FORM INPUT BEHAVIOUR
 ************************************************************/

/* ---- WhatsApp "same as mobile" ---- */

/* Ticked (default): WhatsApp = mobile number, its box hidden.
   Unticked: the WhatsApp box appears for a different number. */
function syncWhatsApp() {
  const same = $("sameWhatsapp").checked;
  if (same) $("whatsapp").value = val("mobile");
  $("whatsapp").readOnly = same;
  const wrap = $("whatsappWrap");
  if (wrap) wrap.classList.toggle("hidden", same);
}

$("sameWhatsapp").addEventListener("change", () => {
  if (!$("sameWhatsapp").checked) $("whatsapp").value = "";
  syncWhatsApp();
  if (!$("sameWhatsapp").checked) $("whatsapp").focus();
});

syncWhatsApp();

$("mobile").addEventListener("input", () => {
  digitsOnly($("mobile"));
  if ($("sameWhatsapp").checked) $("whatsapp").value = val("mobile");
});

/* ---- digits-only fields ---- */

["whatsapp", "pinCode", "twelfthYear", "graduationYear", "pgYear"].forEach(id =>
  $(id).addEventListener("input", () => digitsOnly($(id)))
);

/* ---- OTP: digits only, then auto-verify once 6 digits are entered ---- */

$("otp").addEventListener("input", () => {

  digitsOnly($("otp"));

  const button = $("verifyOtpButton");

  if (/^\d{6}$/.test(val("otp")) && !button.disabled) {
    verifyOtp();
  }

});

/* ---- 12th: Percentage OR CGPA (never both) ----
 * Typing in one box disables the other; clearing it enables it again. */

function syncTwelfthResult() {
  const percentage = $("twelfthPercentage");
  const cgpa = $("twelfthCgpa");
  cgpa.disabled = percentage.value.trim() !== "";
  percentage.disabled = cgpa.value.trim() !== "";
}

["twelfthPercentage", "twelfthCgpa"].forEach(id =>
  $(id).addEventListener("input", () => {
    digitsOnly($(id), true);
    setError(id + "Error", "");
    syncTwelfthResult();
  })
);

/* ---- Date of birth ----
 * The input is a real date field; the "Choose Date of Birth" text is a
 * placeholder drawn on top. `has-value` hides it once a date is chosen. */

const birthDateInput = $("birthDate");
const birthDateWrap = $("birthDateWrap");

function syncBirthDate() {
  birthDateWrap.classList.toggle("has-value", birthDateInput.value !== "");
}

birthDateInput.max = new Date().toISOString().split("T")[0];   // no future dates
birthDateInput.addEventListener("input", syncBirthDate);
birthDateInput.addEventListener("change", syncBirthDate);
syncBirthDate();

/* ---- Upload cards (file name, size, "Change" button, photo preview) ---- */

function bindUpload(prefix, inputId) {

  const input = $(inputId);
  const card = $(prefix + "Card");
  const fileLine = $(prefix + "File");
  const buttonText = $(prefix + "BtnText");
  const preview = $(prefix + "Preview");      // only the profile card has one
  let previewUrl = "";

  input.addEventListener("change", () => {

    setError(prefix + "Error", "");

    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ""; }

    const file = input.files[0];

    card.classList.toggle("has-file", !!file);
    buttonText.textContent = file ? "Change" : "Upload";
    fileLine.textContent = file ? `✓ ${file.name} · ${formatFileSize(file.size)}` : "";

    if (preview) {
      if (file && /^image\//.test(file.type)) {
        previewUrl = URL.createObjectURL(file);
        preview.src = previewUrl;
        preview.classList.remove("hidden");
      } else {
        preview.classList.add("hidden");
        preview.removeAttribute("src");
      }
    }

  });

}

bindUpload("identity", "identityProof");
bindUpload("profile", "profileImage");


/************************************************************
 * TERMS MODAL
 ************************************************************/

$("termsButton").onclick = () => $("termsModal").classList.remove("hidden");
$("closeTerms").onclick = () => $("termsModal").classList.add("hidden");
$("acceptTerms").onclick = () => {
  $("terms").checked = true;
  $("termsModal").classList.add("hidden");
  setError("termsError", "");
};
$("termsModal").querySelector(".modal-overlay").onclick = () => $("termsModal").classList.add("hidden");


/************************************************************
 * STEP 1 - EMAIL
 *   existing tutor -> login OTP
 *   new tutor      -> registration form
 ************************************************************/

$("emailForm").addEventListener("submit", async e => {
  e.preventDefault();
  await checkEmail();
});

async function checkEmail() {

  clearErrors();
  clearMessages();

  const email = normalizeEmail($("email").value);

  if (!isValidEmail(email)) {
    setError("emailError", "Please enter a valid email address.");
    $("email").focus();
    return;
  }

  currentEmail = email;
  verifiedToken = "";

  const button = $("continueButton");
  setBusy(button, "continueText", "continueLoader", true);
  showMessage("emailMessage", "Checking your account...", "info");

  try {

    const result = await apiRequest({ action: "checkTutorEmail", email });

    if (!result.success) {
      showMessage("emailMessage", result.message || "Unable to check email.", "error");
      return;
    }

    /* ---- Existing tutor: LOGIN with OTP ---- */

    if (result.exists) {

      currentMode = "login";
      currentName = result.name || "";

      showMessage("emailMessage", "Account found. Sending your login code...", "info");

      const otpResult = await apiRequest({
        action: "sendTutorOTP",
        email: currentEmail,
        mode: "login"
      });

      if (!otpResult.success) {
        showMessage("emailMessage", otpResult.message || "Unable to send OTP.", "error");
        return;
      }

      showMessage("emailMessage", "");
      openOtpPage("login", otpResult);
      return;

    }

    /* ---- New tutor: REGISTRATION form ---- */

    currentMode = "register";
    $("registrationEmail").value = email;
    showMessage("emailMessage", "");
    showPage("registration");
    setTimeout(() => $("mobile").focus(), 250);

  } catch (err) {

    showMessage("emailMessage", err.message, "error");

  } finally {

    setBusy(button, "continueText", "continueLoader", false);

  }

}


/************************************************************
 * STEP 2 - REGISTRATION FORM
 *   Validate -> send OTP -> OTP page.
 *   Nothing is saved until the OTP is verified.
 ************************************************************/

$("registrationBackButton").addEventListener("click", () => {
  clearErrors();
  clearMessages();
  showPage("email");
});

$("tutorForm").addEventListener("submit", async e => {
  e.preventDefault();
  await registerTutor();
});

/* Client-side validation. Returns true when everything is fine. */
function validateRegistration() {

  let ok = true;

  const fail = (id, message) => { setError(id, message); ok = false; };

  /* Phone numbers */
  if (!/^\d{10}$/.test(val("mobile"))) fail("mobileError", "Mobile Number must contain 10 digits.");
  if ($("sameWhatsapp").checked) $("whatsapp").value = val("mobile");
  if (!/^\d{10}$/.test(val("whatsapp"))) fail("whatsappError", "WhatsApp Number must contain 10 digits.");

  /* Full name */
  if (cleanText($("fullName").value).length < 2) fail("fullNameError", "Please enter your full name.");

  /* Date of birth */
  if (!val("birthDate")) {
    fail("birthDateError", "Please choose your date of birth.");
  } else if (new Date(val("birthDate")) > new Date()) {
    fail("birthDateError", "Date of birth cannot be in the future.");
  }

  /* Class 12th result: percentage 0-100 OR CGPA 0-10 */
  const percentage = val("twelfthPercentage");
  const cgpa = val("twelfthCgpa");
  const decimal = /^\d+(\.\d{1,2})?$/;

  if (percentage && (!decimal.test(percentage) || Number(percentage) > 100)) {
    fail("twelfthPercentageError", "Enter 0 - 100.");
  }
  if (cgpa && (!decimal.test(cgpa) || Number(cgpa) > 10)) {
    fail("twelfthCgpaError", "Enter 0 - 10.");
  }

  /* Required text fields */
  ["experience", "city", "address"].forEach(id => {
    if (!val(id)) fail(id + "Error", "This field is required.");
  });

  if (!/^\d{6}$/.test(val("pinCode"))) fail("pinError", "Pin Code must contain 6 digits.");

  /* Groups */
  if (values("languages").length === 0) fail("languagesError", "Select at least one language.");
  if (values("classesTeach").length === 0) fail("classesError", "Select at least one class range.");
  if (values("subjectsTeach").length === 0) fail("subjectsError", "Select at least one subject.");
  if (values("boardsTeach").length === 0) fail("boardsError", "Select at least one board.");

  /* Documents */
  if (!validateFile("identityProof", "identityError", false)) ok = false;
  if (!validateFile("profileImage", "profileError", true)) ok = false;

  /* Terms */
  if (!$("terms").checked) fail("termsError", "Please accept the Terms & Conditions.");

  return ok;

}

function validateFile(id, errorId, imagesOnly) {

  const f = $(id).files[0];

  if (!f) { setError(errorId, "Please upload this file."); return false; }
  if (f.size > MAX_FILE_SIZE) { setError(errorId, "File must be 5 MB or smaller."); return false; }

  if (imagesOnly && !/^image\/(jpeg|png)$/.test(f.type)) {
    setError(errorId, "Please upload a JPG or PNG image.");
    return false;
  }

  if (!imagesOnly && !["application/pdf", "image/jpeg", "image/png"].includes(f.type)) {
    setError(errorId, "Please upload PDF, JPG or PNG.");
    return false;
  }

  return true;

}

async function registerTutor() {

  clearErrors();
  clearMessages();

  if (!currentEmail) {
    showPage("email");
    showMessage("emailMessage", "Please enter your email first.", "error");
    return;
  }

  if (!validateRegistration()) {
    // error texts are hidden on this form -> scroll to the red box
    const first = document.querySelector("#registrationPage .has-error") ||
      document.querySelector(".field-error:not(:empty)");
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  currentName = cleanText($("fullName").value);
  verifiedToken = "";

  const button = $("registerButton");
  setBusy(button, "registerText", "registerLoader", true);
  showMessage("registrationMessage", "Sending verification OTP...", "info");

  try {

    const result = await apiRequest({
      action: "sendTutorOTP",
      email: currentEmail,
      mode: "register",
      name: currentName
    });

    if (!result.success) {
      showMessage("registrationMessage", result.message || "Unable to send OTP.", "error");
      return;
    }

    showMessage("registrationMessage", "");
    openOtpPage("register", result);

  } catch (err) {

    showMessage("registrationMessage", err.message, "error");

  } finally {

    setBusy(button, "registerText", "registerLoader", false);

  }

}


/************************************************************
 * STEP 3 - OTP (registration and login)
 ************************************************************/

function openOtpPage(mode, apiResult) {

  currentMode = mode;

  $("emailDisplay").textContent = currentEmail;
  $("otp").value = "";
  clearErrors();
  showMessage("otpMessage", "");

  if (mode === "login") {
    $("otpEyebrow").textContent = "SECURE LOGIN";
    $("otpTitle").textContent = "Verify to login";
    $("verifyOtpText").textContent = "Login";
    $("otpBackButton").textContent = "← Change email";
  } else {
    $("otpEyebrow").textContent = "REGISTRATION VERIFICATION";
    $("otpTitle").textContent = "Verify your email";
    $("verifyOtpText").textContent = "Verify & Register";
    $("otpBackButton").textContent = "← Edit details";
  }

  showPage("otp");
  startResendTimer(apiResult.resendAfter || 60);
  setTimeout(() => $("otp").focus(), 250);

}

/* Back: registration -> form (details kept), login -> email page */
$("otpBackButton").addEventListener("click", () => {

  clearInterval(resendTimer);
  resendTimer = null;
  verifiedToken = "";

  clearErrors();
  clearMessages();
  $("otp").value = "";

  showPage(currentMode === "register" ? "registration" : "email");

});

$("otpForm").addEventListener("submit", async e => {
  e.preventDefault();
  await verifyOtp();
});

async function verifyOtp() {

  clearErrors();
  showMessage("otpMessage", "");

  const otp = val("otp");

  /* If the OTP was already accepted (only the upload failed), skip the OTP check */
  const needOtp = !(currentMode === "register" && verifiedToken);

  if (needOtp && !/^\d{6}$/.test(otp)) {
    setError("otpError", "Please enter the 6-digit OTP.");
    $("otp").focus();
    return;
  }

  const button = $("verifyOtpButton");
  setBusy(button, "verifyOtpText", "verifyOtpLoader", true);

  try {

    /* ---- A. verify the OTP ---- */

    if (needOtp) {

      showMessage("otpMessage", "Verifying your OTP...", "info");

      const result = await apiRequest({
        action: "verifyTutorOTP",
        email: currentEmail,
        otp: otp,
        mode: currentMode
      });

      if (!result.success) {
        // wrong OTP: empty the box and give it the light red border
        $("otp").value = "";
        setError("otpError", result.message || "Incorrect OTP.");
        $("otp").focus();
        return;
      }

      /* LOGIN finished */
      if (currentMode === "login") {
        showSuccess("login", result);
        return;
      }

      verifiedToken = result.verificationToken || "";

    }

    /* ---- B. registration: OTP is correct -> save the tutor ---- */

    if (!verifiedToken) {
      showMessage("otpMessage", "Verification failed. Please request a new OTP.", "error");
      return;
    }

    showMessage("otpMessage", "Email verified. Saving your registration and documents...", "info");

    const payload = await buildRegistrationPayload();
    payload.action = "completeTutorRegistration";
    payload.email = currentEmail;
    payload.verificationToken = verifiedToken;

    const saved = await apiRequest(payload, 90000);

    if (!saved.success) {
      showMessage("otpMessage", saved.message || "Registration could not be completed.", "error");
      return;
    }

    showSuccess("register", saved);

  } catch (err) {

    showMessage("otpMessage", err.message, "error");

  } finally {

    setBusy(button, "verifyOtpText", "verifyOtpLoader", false);

  }

}

/* Resend OTP (server enforces the 60 second gap) */
$("resendButton").addEventListener("click", async () => {

  const button = $("resendButton");
  button.disabled = true;
  verifiedToken = "";
  showMessage("otpMessage", "Sending a new OTP...", "info");

  try {

    const result = await apiRequest({
      action: "resendTutorOTP",
      email: currentEmail,
      mode: currentMode,
      name: currentName
    });

    if (!result.success) {
      showMessage("otpMessage", result.message || "Unable to resend OTP.", "error");
      if (result.resendAfter) startResendTimer(result.resendAfter);
      else button.disabled = false;
      return;
    }

    $("otp").value = "";
    showMessage("otpMessage", "New OTP sent successfully.", "success");
    startResendTimer(result.resendAfter || 60);

  } catch (err) {

    button.disabled = false;
    showMessage("otpMessage", err.message, "error");

  }

});

/* "Resend in 42s" countdown */
function startResendTimer(seconds) {

  const button = $("resendButton");

  clearInterval(resendTimer);

  let remaining = Math.max(0, Number(seconds) || 60);

  button.disabled = remaining > 0;
  button.textContent = remaining > 0 ? `Resend in ${remaining}s` : "Resend OTP";

  if (remaining <= 0) return;

  resendTimer = setInterval(() => {

    remaining--;

    if (remaining <= 0) {
      clearInterval(resendTimer);
      resendTimer = null;
      button.disabled = false;
      button.textContent = "Resend OTP";
      return;
    }

    button.textContent = `Resend in ${remaining}s`;

  }, 1000);

}


/************************************************************
 * REGISTRATION PAYLOAD (form + documents)
 * Built only AFTER the OTP is verified.
 ************************************************************/

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read uploaded file."));
    reader.readAsDataURL(file);
  });
}

async function buildRegistrationPayload() {

  const identity = $("identityProof").files[0];
  const profile = $("profileImage").files[0];

  const [identityData, profileData] = await Promise.all([
    fileToBase64(identity),
    fileToBase64(profile)
  ]);

  return {

    mobile: val("mobile"),
    whatsapp: val("whatsapp"),
    registerAs: checked("registerAs"),

    fullName: cleanText($("fullName").value),
    birthDate: val("birthDate"),
    gender: checked("gender"),
    languages: values("languages"),

    identityProof: { name: identity.name, mimeType: identity.type, size: identity.size, data: identityData },
    profileImage: { name: profile.name, mimeType: profile.type, size: profile.size, data: profileData },

    twelfthStream: checked("twelfthStream"),
    twelfthYear: val("twelfthYear"),
    twelfthPercentage: val("twelfthPercentage"),
    twelfthCgpa: val("twelfthCgpa"),
    twelfthBoard: checked("twelfthBoard"),

    graduationCourse: val("graduationCourse"),
    graduationSubject: val("graduationSubject"),
    graduationCollege: val("graduationCollege"),
    graduationYear: val("graduationYear"),
    graduationPercentage: val("graduationPercentage"),

    pgSubject: val("pgSubject"),
    pgCollege: val("pgCollege"),
    pgYear: val("pgYear"),
    pgPercentage: val("pgPercentage"),

    specialCourses: values("specialCourses"),
    disability: values("disability"),

    experience: val("experience"),

    classesTeach: values("classesTeach"),
    subjectsTeach: values("subjectsTeach"),
    boardsTeach: values("boardsTeach"),

    location: val("location"),
    city: val("city"),
    address: val("address"),
    pinCode: val("pinCode"),

    termsAccepted: $("terms").checked

  };

}


/************************************************************
 * STEP 4 - SUCCESS
 ************************************************************/

const TUTOR_SESSION_KEY = "urbantutorsite_tutor_session";

function showSuccess(type, result) {

  clearInterval(resendTimer);
  resendTimer = null;

  /*
   * NEW: sign the tutor in on this device and go straight to
   * the home screen, with the header's Tutor toggle already
   * selected. If, for any reason, the backend did not send a
   * sessionToken (e.g. an older deployment), fall back to the
   * original static success screen below instead of breaking.
   */

  if (result && result.sessionToken) {

    try {

      localStorage.setItem(
        TUTOR_SESSION_KEY,
        JSON.stringify({
          sessionToken: result.sessionToken,
          profile: result.profile || null
        })
      );

    } catch (storageError) {
      console.error(storageError);
    }

    // Home reads this once, on the very next load, to pre-select
    // the "Tutor" toggle instead of the default "Student" one.
    try {
      sessionStorage.setItem("urbantutorsite_last_login", "tutor");
    } catch (ignore) {}

    window.location.href = "index.html";
    return;

  }

  $("successEmail").textContent = currentEmail;

  if (type === "login") {

    const profile = result.profile || {};
    const firstName = (profile.fullName || currentName || "").split(" ")[0];

    $("successEyebrow").textContent = "SECURE LOGIN";
    $("successTitle").textContent = firstName ? `Welcome back, ${firstName}.` : "Welcome back.";
    $("successDescription").textContent =
      "Your email is verified and you are signed in as a tutor." +
      (profile.status ? ` Your profile status is ${profile.status}.` : "");

    $("successTutorId").textContent = profile.tutorId || "";
    $("successIdBox").classList.toggle("hidden", !profile.tutorId);

  } else {

    $("successEyebrow").textContent = "REGISTRATION COMPLETE";
    $("successTitle").textContent = "You're registered.";
    $("successDescription").textContent =
      "Your email is verified and your profile has been submitted for verification. " +
      "We will contact you once the review is complete.";

    // The Tutor ID (result.tutorId) is saved in the sheet but not shown here.
    $("successIdBox").classList.add("hidden");

  }

  showPage("success");

}


/************************************************************
 * INITIAL STATE
 *
 * The login/registration form is shown first. Only if a saved
 * session is confirmed valid by the server is the tutor sent
 * to index.html. An expired / invalid session is cleared so
 * the form stays usable.
 ************************************************************/

showPage("email");

(async function () {

  let existingSession = null;

  try {
    const raw = localStorage.getItem(TUTOR_SESSION_KEY);
    existingSession = raw ? JSON.parse(raw) : null;
  } catch (error) {
    localStorage.removeItem(TUTOR_SESSION_KEY);
    return;
  }

  if (!existingSession || !existingSession.sessionToken) {
    return;
  }

  try {

    const result = await apiRequest({
      action: "getTutorProfile",
      sessionToken: existingSession.sessionToken
    });

    if (result.success) {
      window.location.replace("index.html");
      return;
    }

    localStorage.removeItem(TUTOR_SESSION_KEY);

  } catch (error) {
    console.error(error);
  }

})();



/************************************************************
 * RED BORDER CLEARS AS SOON AS THE FIELD IS FIXED
 ************************************************************/

(function () {
  const form = $("tutorForm");
  if (!form) return;
  const clear = event => {
    const host = event.target.closest(".field") || event.target.closest(".terms") || event.target.closest(".upload-card");
    if (host) host.classList.remove("has-error");
  };
  form.addEventListener("input", clear);
  form.addEventListener("change", clear);
})();


/************************************************************
 * EMAIL + OTP BOXES: red border clears once you type again
 ************************************************************/

["emailForm", "otpForm"].forEach(function (formId) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener("input", function (event) {
    const field = event.target.closest(".field");
    if (field) field.classList.remove("has-error");
  });
});
