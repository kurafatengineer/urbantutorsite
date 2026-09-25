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
 * SUPABASE (replaces the old Apps Script API)
 *   Login + registration use Supabase Auth's own e-mail OTP
 *   (window.sb.auth.signInWithOtp / verifyOtp) - same as student.js.
 *   RPC functions (supabase-setup-3-register-profile.sql):
 *     email_status(p_email)      -> { student, tutor }
 *     register_tutor(p)          -> { success, tutorId }
 *     set_tutor_documents(p_identity_proof, p_profile_image)
 *   Documents are uploaded to the private "tutor-documents" storage,
 *   inside the tutor's own folder (TID.../), after register_tutor.
 *   showSuccess() sets the "urbantutorsite_tutor_session" flag that
 *   header.js / the homepage read to know a tutor is logged in.
 ************************************************************/


/************************************************************
 * CONFIGURATION
 ************************************************************/

const MAX_FILE_SIZE = 5 * 1024 * 1024;   // 5 MB per document


/************************************************************
 * STATE
 ************************************************************/

let currentEmail = "";     // email the tutor entered on page 1
let currentMode = "";      // "register" or "login"
let currentName = "";      // used only in the OTP e-mail greeting
let pendingRegistration = null; // form data + files, saved only after the OTP
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
  pendingRegistration = null;

  const button = $("continueButton");
  setBusy(button, "continueText", "continueLoader", true);
  showMessage("emailMessage", "Checking your account...", "info");

  try {

    // email_status returns { student, tutor } (no "success" key);
    // only a real error comes back as { success: false, message }.
    const status = await window.sbCall("email_status", { p_email: email });

    if (!status || status.success === false) {
      showMessage("emailMessage", (status && status.message) || "Unable to check email.", "error");
      return;
    }

    // One email may be both a tutor and a student's parent: an email
    // that is only registered as a student simply registers as a tutor.

    /* ---- Existing tutor: LOGIN with OTP ---- */

    if (status.tutor) {

      currentMode = "login";
      currentName = "";

      showMessage("emailMessage", "Account found. Sending your login code...", "info");

      // shouldCreateUser: true - tutors copied over from the Google
      // Sheet don't have a Supabase login yet; this creates it.
      const { error } = await window.sb.auth.signInWithOtp({
        email: currentEmail,
        options: { shouldCreateUser: true }
      });

      if (error) {
        showMessage("emailMessage", error.message || "Unable to send OTP.", "error");
        return;
      }

      showMessage("emailMessage", "");
      openOtpPage("login", { resendAfter: 60 });
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

  /* Full Time / Part Time and gender are no longer pre-selected */
  if (!checked("registerAs")) fail("registerAsError", "Select Full Time or Part Time.");
  if (!checked("gender")) fail("genderError", "Select your gender.");

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

  /* Class 12th (and Graduation + Post Graduation when that is ticked) */
  if (!educationValid(!!$("pgToggle") && $("pgToggle").checked, true)) ok = false;
  if ($("pgToggle") && $("pgToggle").checked) {
    if (!val("pgSubject")) fail("pgSubjectError", "This field is required.");
    if (!val("pgCollege")) fail("pgCollegeError", "This field is required.");
    if (!/^\d{4}$/.test(val("pgYear"))) fail("pgYearError", "Enter the passing year.");
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
    if (typeof window.showAllRegistrationSteps === "function") window.showAllRegistrationSteps(false);
    // error texts are hidden on this form -> scroll to the red box
    const first = document.querySelector("#registrationPage .has-error") ||
      document.querySelector(".field-error:not(:empty)");
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  currentName = cleanText($("fullName").value);

  // Kept in memory only - nothing is saved until the OTP is verified.
  pendingRegistration = buildRegistrationPayload();

  const button = $("registerButton");
  setBusy(button, "registerText", "registerLoader", true);
  showMessage("registrationMessage", "Sending verification OTP...", "info");

  try {

    const { error } = await window.sb.auth.signInWithOtp({
      email: currentEmail,
      options: { shouldCreateUser: true }
    });

    if (error) {
      showMessage("registrationMessage", error.message || "Unable to send OTP.", "error");
      return;
    }

    showMessage("registrationMessage", "");
    openOtpPage("register", { resendAfter: 60 });

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

  clearErrors();
  clearMessages();
  $("otp").value = "";

  showPage(currentMode === "register" ? "registration" : "email");

});

$("otpForm").addEventListener("submit", async e => {
  e.preventDefault();
  await verifyOtp();
});

/* Upload one document into the tutor's own folder (TID.../) in the
   private "tutor-documents" storage; returns the saved path. */
async function uploadTutorDocument(tutorId, file, label) {

  if (!file) return null;

  const ext = (file.name.split(".").pop() || "dat").toLowerCase();
  const path = `${tutorId}/${label}-${Date.now()}.${ext}`;

  const { error } = await window.sb.storage
    .from("tutor-documents")
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) throw new Error(`Could not upload ${label}: ${error.message}`);

  return path;

}

async function verifyOtp() {

  clearErrors();
  showMessage("otpMessage", "");

  const otp = val("otp");

  if (!/^\d{6}$/.test(otp)) {
    setError("otpError", "Please enter the 6-digit OTP.");
    $("otp").focus();
    return;
  }

  const button = $("verifyOtpButton");
  setBusy(button, "verifyOtpText", "verifyOtpLoader", true);

  try {

    /* ---- A. verify the OTP (Supabase Auth) ---- */

    showMessage("otpMessage", "Verifying your OTP...", "info");

    const { error } = await window.sb.auth.verifyOtp({
      email: currentEmail,
      token: otp,
      type: "email"
    });

    if (error) {
      // wrong OTP: empty the box and give it the light red border
      $("otp").value = "";
      setError("otpError", error.message || "Incorrect OTP.");
      $("otp").focus();
      return;
    }

    /* LOGIN finished */
    if (currentMode === "login") {
      showSuccess("login");
      return;
    }

    /* ---- B. registration: OTP is correct -> save the tutor ---- */

    if (!pendingRegistration) {
      await window.sb.auth.signOut();
      showMessage("otpMessage", "Please fill in the registration form again.", "error");
      return;
    }

    showMessage("otpMessage", "Email verified. Saving your registration and documents...", "info");

    const { _files, ...profileFields } = pendingRegistration;

    const saved = await window.sbCall("register_tutor", { p: profileFields });

    if (!saved || !saved.success) {
      // don't leave a half-registered login behind
      await window.sb.auth.signOut();
      showMessage("otpMessage", (saved && saved.message) || "Registration could not be completed.", "error");
      return;
    }

    /* ---- C. upload the documents into the new Tutor ID folder ---- */

    try {

      const [identityPath, profilePath] = await Promise.all([
        uploadTutorDocument(saved.tutorId, _files.identityProof, "identity-proof"),
        uploadTutorDocument(saved.tutorId, _files.profileImage, "profile-photo")
      ]);

      const docs = await window.sbCall("set_tutor_documents", {
        p_identity_proof: identityPath,
        p_profile_image: profilePath
      });

      if (!docs || !docs.success) console.error("set_tutor_documents:", docs);

    } catch (uploadError) {
      // The registration itself is saved; the office can collect the
      // documents later, so this doesn't block the tutor.
      console.error(uploadError);
    }

    pendingRegistration = null;
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
  showMessage("otpMessage", "Sending a new OTP...", "info");

  try {

    const { error } = await window.sb.auth.signInWithOtp({
      email: currentEmail,
      options: { shouldCreateUser: true }
    });

    if (error) {
      showMessage("otpMessage", error.message || "Unable to resend OTP.", "error");
      startResendTimer(60);
      return;
    }

    $("otp").value = "";
    showMessage("otpMessage", "New OTP sent successfully.", "success");
    startResendTimer(60);

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

function joinValues(containerId) {
  return values(containerId).join(", ");
}

/* Keys match what public.register_tutor(p) reads. Multi-select
   groups are sent as "A, B, C" text. The two files are kept aside
   (_files) and uploaded to storage after registration. */
function buildRegistrationPayload() {

  return {

    _files: {
      identityProof: $("identityProof").files[0] || null,
      profileImage: $("profileImage").files[0] || null
    },

    mobileNumber: val("mobile"),
    whatsappNumber: val("whatsapp"),
    registerAs: checked("registerAs"),

    fullName: cleanText($("fullName").value),
    birthDate: val("birthDate"),
    gender: checked("gender"),
    languagesKnown: joinValues("languages"),

    class12Stream: checked("twelfthStream"),
    class12PassingYear: val("twelfthYear"),
    class12Percentage: val("twelfthPercentage"),
    class12Cgpa: val("twelfthCgpa"),
    class12Board: checked("twelfthBoard"),

    graduationCourse: val("graduationCourse"),
    graduationSubject: val("graduationSubject"),
    graduationCollege: val("graduationCollege"),
    graduationPassingYear: val("graduationYear"),
    graduationPercentage: val("graduationPercentage"),

    pgSubject: val("pgSubject"),
    pgCollege: val("pgCollege"),
    pgPassingYear: val("pgYear"),
    pgPercentage: val("pgPercentage"),

    specialCourses: joinValues("specialCourses"),
    specialChildDisability: joinValues("disability"),

    experienceYears: val("experience"),

    classesYouTeach: joinValues("classesTeach"),
    subjectsYouTeach: joinValues("subjectsTeach"),
    boardsYouTeach: joinValues("boardsTeach"),

    teachingLocation: val("location"),
    city: val("city"),
    presentAddress: val("address"),
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

  // Supabase keeps the real login; this flag only tells the header /
  // homepage "a tutor is logged in here" (same idea as student.js).
  {

    try {

      localStorage.setItem(
        TUTOR_SESSION_KEY,
        JSON.stringify({ sessionToken: "supabase" })
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

  try {

    const { data } = await window.sb.auth.getSession();

    if (data && data.session) {

      // already logged in as a tutor on this device -> go home
      const profile = await window.sbCall("get_tutor_profile", {});

      if (profile && profile.success) {
        localStorage.setItem(TUTOR_SESSION_KEY, JSON.stringify({ sessionToken: "supabase" }));
        window.location.replace("index.html");
        return;
      }

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



/************************************************************
 * CLASS 12TH / GRADUATION CHECK
 * Used before the Post Graduation tick hides these details and
 * again when Register is pressed. Marks missing boxes red.
 ************************************************************/

function educationValid(includeGraduation, showErrors) {

  let ok = true;
  const fail = (id, message) => { ok = false; if (showErrors) setError(id, message); };
  const decimal = /^\d+(\.\d{1,2})?$/;

  if (!checked("twelfthStream")) fail("twelfthStreamError", "Select your Class 12th stream.");
  if (!/^\d{4}$/.test(val("twelfthYear"))) fail("twelfthYearError", "Enter the passing year.");

  const percentage = val("twelfthPercentage");
  const cgpa = val("twelfthCgpa");
  if (!percentage && !cgpa) {
    fail("twelfthPercentageError", "Enter Percentage or CGPA.");
    fail("twelfthCgpaError", "Enter Percentage or CGPA.");
  } else if (percentage && (!decimal.test(percentage) || Number(percentage) > 100)) {
    fail("twelfthPercentageError", "Enter 0 - 100.");
  } else if (cgpa && (!decimal.test(cgpa) || Number(cgpa) > 10)) {
    fail("twelfthCgpaError", "Enter 0 - 10.");
  }

  if (!checked("twelfthBoard")) fail("twelfthBoardError", "Select your Class 12th board.");

  if (includeGraduation) {
    ["graduationCourse", "graduationSubject", "graduationCollege", "graduationPercentage"].forEach(id => {
      if (!val(id)) fail(id + "Error", "This field is required.");
    });
    if (!/^\d{4}$/.test(val("graduationYear"))) fail("graduationYearError", "Enter the passing year.");
  }

  return ok;

}


/************************************************************
 * STEP-BY-STEP FORM
 *
 *  1. Only Contact Information is shown.
 *     Full Time / Part Time -> (mobile + WhatsApp checked) ->
 *     Contact hides, Basic Information shows.
 *  2. Full Name + Date of Birth + Male / Female ->
 *     Basic hides, Languages Known + Identity Proof show.
 *  3. One language + both documents ->
 *     those hide, Education & Qualification shows.
 *  4. Education opens one piece at a time:
 *     Stream -> Passing Year -> Percentage / CGPA -> Board.
 *     After the Board: Graduation, the "Post Graduation",
 *     "Special Courses" and "Special Child Disability" ticks,
 *     and the ticks for Experience, Teaching Preferences,
 *     Subjects, Boards and Areas You Teach, plus the Terms.
 *     - Post Graduation tick: checks Class 12th + Graduation,
 *       hides them and shows the Post Graduation boxes.
 *     - Experience ... Areas ticks: open their part and hide
 *       whatever else is open above.
 *     - Special Courses / Disability ticks: open / close their
 *       own options only.
 *  5. Ticking Terms & Conditions shows the whole form and goes
 *     back to the top, so everything can be reviewed.
 ************************************************************/

(function () {

  const form = $("tutorForm");
  if (!form || !$("sectionContact")) return;

  const DELAY = 500;
  const hide = id => { const e = $(id); if (e) e.classList.add("step-hidden"); };
  const show = id => { const e = $(id); if (e) e.classList.remove("step-hidden"); };
  const isShown = id => { const e = $(id); return !!e && !e.classList.contains("step-hidden"); };

  let step = 1;          // 1 contact, 2 basic, 3 languages + identity, 4 education
  let timer = null;
  let reviewing = false;

  function scrollToEl(id) {
    const e = $(id);
    if (e) e.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function later(fn) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; if (!reviewing) fn(); }, DELAY);
  }

  /* ---------- starting state ---------- */

  form.classList.add("step-mode");

  ["sectionBasic", "sectionLanguages", "sectionIdentity", "sectionEducation",
   "sectionExperience", "sectionTeaching", "sectionAreas", "sectionTerms",
   "eduYear", "eduResult", "eduBoard", "eduGraduation",
   "pgToggleField", "eduPg", "specialToggleField", "eduSpecial",
   "disabilityToggleField", "eduDisability",
   "expContent", "teachClasses", "teachSubjects", "teachBoards", "areasContent"
  ].forEach(hide);


  /* ---------- 1. Contact Information ---------- */

  function contactDone(showErrors) {
    let ok = true;
    const fail = (id, message) => { ok = false; if (showErrors) setError(id, message); };
    if (!/^\d{10}$/.test(val("mobile"))) fail("mobileError", "Mobile Number must contain 10 digits.");
    if ($("sameWhatsapp").checked) $("whatsapp").value = val("mobile");
    if (!/^\d{10}$/.test(val("whatsapp"))) fail("whatsappError", "WhatsApp Number must contain 10 digits.");
    if (!checked("registerAs")) ok = false;
    return ok;
  }

  function tryContact(showErrors) {
    if (reviewing || step !== 1) return;
    if (!contactDone(showErrors)) return;
    step = 2;
    later(() => {
      hide("sectionContact");
      show("sectionBasic");
      scrollToEl("sectionBasic");
    });
  }

  document.querySelectorAll('input[name="registerAs"]').forEach(r =>
    r.addEventListener("click", () => tryContact(true))
  );
  ["mobile", "whatsapp"].forEach(id =>
    $(id).addEventListener("change", () => { if (checked("registerAs")) tryContact(false); })
  );
  $("sameWhatsapp").addEventListener("change", () => { if (checked("registerAs")) tryContact(false); });


  /* ---------- 2. Basic Information ---------- */

  function basicDone(showErrors) {
    let ok = true;
    const fail = (id, message) => { ok = false; if (showErrors) setError(id, message); };
    if (cleanText($("fullName").value).length < 2) fail("fullNameError", "Please enter your full name.");
    if (!val("birthDate")) fail("birthDateError", "Please choose your date of birth.");
    else if (new Date(val("birthDate")) > new Date()) fail("birthDateError", "Date of birth cannot be in the future.");
    if (!checked("gender")) ok = false;
    return ok;
  }

  function tryBasic(showErrors) {
    if (reviewing || step !== 2) return;
    if (!basicDone(showErrors)) return;
    step = 3;
    later(() => {
      hide("sectionBasic");
      show("sectionLanguages");
      show("sectionIdentity");
      scrollToEl("sectionLanguages");
    });
  }

  document.querySelectorAll('input[name="gender"]').forEach(r =>
    r.addEventListener("click", () => tryBasic(true))
  );
  ["fullName", "birthDate"].forEach(id =>
    $(id).addEventListener("change", () => { if (checked("gender")) tryBasic(false); })
  );


  /* ---------- 3. Languages Known + Identity Proof ---------- */

  function tryLanguagesAndDocs() {
    if (reviewing || step !== 3) return;
    if (values("languages").length === 0) return;
    if (!$("identityProof").files[0] || !$("profileImage").files[0]) return;
    const idOk = validateFile("identityProof", "identityError", false);
    const photoOk = validateFile("profileImage", "profileError", true);
    if (!idOk || !photoOk) return;
    step = 4;
    later(() => {
      hide("sectionLanguages");
      hide("sectionIdentity");
      show("sectionEducation");
      scrollToEl("sectionEducation");
    });
  }

  document.querySelectorAll("#languages input").forEach(c =>
    c.addEventListener("change", tryLanguagesAndDocs)
  );
  ["identityProof", "profileImage"].forEach(id =>
    $(id).addEventListener("change", tryLanguagesAndDocs)
  );


  /* ---------- 4. Education & Qualification, one piece at a time ---------- */

  document.querySelectorAll('input[name="twelfthStream"]').forEach(r =>
    r.addEventListener("change", () => { if (!reviewing) show("eduYear"); })
  );

  $("twelfthYear").addEventListener("input", () => {
    if (!reviewing && /^\d{4}$/.test(val("twelfthYear"))) show("eduResult");
  });

  ["twelfthPercentage", "twelfthCgpa"].forEach(id =>
    $(id).addEventListener("input", () => {
      if (reviewing) return;
      const v = val(id);
      const max = id === "twelfthPercentage" ? 100 : 10;
      if (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= max) show("eduBoard");
    })
  );

  document.querySelectorAll('input[name="twelfthBoard"]').forEach(r =>
    r.addEventListener("change", () => {
      if (reviewing || isShown("eduGraduation")) return;
      ["eduGraduation", "pgToggleField", "specialToggleField", "disabilityToggleField",
       "sectionExperience", "sectionTeaching", "sectionAreas", "sectionTerms"].forEach(show);
    })
  );


  /* ---------- the ticks ---------- */

  // details that the Post Graduation / Experience ... Areas ticks hide
  const details = ["eduStream", "eduYear", "eduResult", "eduBoard", "eduGraduation"];

  // only one of these is open at a time
  const exclusive = [
    { tick: "pgToggle",       part: "eduPg" },
    { tick: "expToggle",      part: "expContent" },
    { tick: "teachToggle",    part: "teachClasses" },
    { tick: "subjectsToggle", part: "teachSubjects" },
    { tick: "boardsToggle",   part: "teachBoards" },
    { tick: "areasToggle",    part: "areasContent" }
  ];

  // these simply open / close their own options
  const simple = [
    { tick: "specialToggle",    part: "eduSpecial" },
    { tick: "disabilityToggle", part: "eduDisability" }
  ];

  exclusive.forEach(item => {
    const box = $(item.tick);
    if (!box) return;
    box.addEventListener("change", () => {
      if (reviewing) return;

      if (box.checked) {

        // Post Graduation: Class 12th + Graduation must be complete first
        if (item.tick === "pgToggle" && !educationValid(true, true)) {
          box.checked = false;
          const first = document.querySelector("#sectionEducation .has-error");
          if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }

        exclusive.forEach(other => {
          if (other === item) return;
          $(other.tick).checked = false;
          hide(other.part);
        });
        simple.forEach(other => {
          $(other.tick).checked = false;
          hide(other.part);
        });
        details.forEach(hide);
        show(item.part);
        scrollToEl(item.tick + "Field");

      } else {

        hide(item.part);
        // nothing open any more -> Class 12th + Graduation come back
        if (!exclusive.some(other => $(other.tick).checked)) details.forEach(show);

      }
    });
  });

  simple.forEach(item => {
    const box = $(item.tick);
    if (!box) return;
    box.addEventListener("change", () => {
      if (reviewing) return;
      if (box.checked) show(item.part); else hide(item.part);
    });
  });


  /* ---------- 5. review everything ---------- */

  function showAll(goToTop) {
    reviewing = true;
    clearTimeout(timer);
    form.classList.remove("step-mode");
    form.querySelectorAll(".step-hidden").forEach(e => e.classList.remove("step-hidden"));
    if (goToTop) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  window.showAllRegistrationSteps = showAll;

  $("terms").addEventListener("change", () => { if ($("terms").checked) showAll(true); });
  $("acceptTerms").addEventListener("click", () => showAll(true));

})();
