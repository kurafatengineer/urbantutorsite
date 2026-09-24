"use strict";

/************************************************************
 * CONFIGURATION
 ************************************************************/

const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwnhZnXpGVegX3kQtggtRjTej1JrsgfUdDyPrtMmuxh-IR_I8EGudmGAgLscda2y3nxLg/exec";


/************************************************************
 * STATE
 ************************************************************/

let currentEmail = "";
let currentName = "";
let currentMode = "";
let resendTimer = null;


/************************************************************
 * ELEMENTS
 ************************************************************/

const emailPage = document.getElementById("emailPage");
const registrationPage = document.getElementById("registrationPage");
const otpPage = document.getElementById("otpPage");
const successPage = document.getElementById("successPage");

const emailForm = document.getElementById("emailForm");
const registrationForm = document.getElementById("registrationForm");
const otpForm = document.getElementById("otpForm");

const emailInput = document.getElementById("email");
const registrationEmail = document.getElementById("registrationEmail");
const phoneInput = document.getElementById("phone");
const whatsappInput = document.getElementById("whatsapp");
const sameAsPhoneInput = document.getElementById("sameAsPhone");
const parentsNameInput = document.getElementById("parentsName");
const studentNameInput = document.getElementById("studentName");
const schoolInput = document.getElementById("school");
const classInput = document.getElementById("className");
const boardInput = document.getElementById("board");
const subjectsInput = document.getElementById("subjects");
const timingOtherInput = document.getElementById("timingOtherInput");
const timingOtherWrap = document.getElementById("otherTimingWrap");
const cityInput = document.getElementById("city");
const addressInput = document.getElementById("address");
const pinInput = document.getElementById("pinCode");
const termsInput = document.getElementById("terms");
const otpInput = document.getElementById("otp");

const continueButton = document.getElementById("continueButton");
const registerButton = document.getElementById("registerButton");
const verifyOtpButton = document.getElementById("verifyOtpButton");
const resendButton = document.getElementById("resendButton");

const emailDisplay = document.getElementById("emailDisplay");
const successEmail = document.getElementById("successEmail");
const continueHomeButton = document.getElementById("continueHomeButton");

const studentProfileButton = document.getElementById("studentProfileButton");
const studentProfileModal = document.getElementById("studentProfileModal");
const studentProfileContent = document.getElementById("studentProfileContent");
const closeStudentProfile = document.getElementById("closeStudentProfile");
const studentLogoutButton = document.getElementById("studentLogoutButton");


/************************************************************
 * EVENT LISTENERS
 ************************************************************/

emailForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    await checkEmail();

  }
);


registrationForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    await registerUser();

  }
);


otpForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    await verifyOTP();

  }
);


resendButton.addEventListener(
  "click",
  resendOTP
);


if (studentProfileButton) {

  studentProfileButton.addEventListener(
    "click",
    openStudentProfile
  );

}


if (closeStudentProfile) {

  closeStudentProfile.addEventListener(
    "click",
    closeStudentProfileModal
  );

}


if (studentProfileModal) {

  studentProfileModal.addEventListener(
    "click",
    function(event) {
      if (event.target.hasAttribute("data-close-profile")) {
        closeStudentProfileModal();
      }
    }
  );

}


if (studentLogoutButton) {

  studentLogoutButton.addEventListener(
    "click",
    logoutStudent
  );

}


/************************************************************
 * SAME AS PHONE
 ************************************************************/

// Ticked (default): WhatsApp = mobile number, and its box is hidden.
// Unticked: the WhatsApp box is shown so a different number can be typed.
const whatsappWrap = document.getElementById("whatsappWrap");

function syncWhatsApp() {

  if (sameAsPhoneInput.checked) {

    whatsappInput.value = phoneInput.value;

    whatsappInput.readOnly = true;

    if (whatsappWrap) whatsappWrap.classList.add("hidden");

  } else {

    whatsappInput.readOnly = false;

    if (whatsappWrap) whatsappWrap.classList.remove("hidden");

  }

}

sameAsPhoneInput.addEventListener(
  "change",
  () => {

    if (!sameAsPhoneInput.checked) {

      whatsappInput.value = "";

    }

    syncWhatsApp();

    if (!sameAsPhoneInput.checked) {

      whatsappInput.focus();

    }

  }
);

syncWhatsApp();


phoneInput.addEventListener(
  "input",
  () => {

    numericInput({
      target: phoneInput
    });

    if (sameAsPhoneInput.checked) {

      whatsappInput.value = phoneInput.value;

    }

  }
);


/************************************************************
 * BACK BUTTONS
 ************************************************************/

document
  .getElementById("registrationBackButton")
  .addEventListener(
    "click",
    () => {

      showPage("email");

      clearMessages();
      clearFieldErrors();

    }
  );


document
  .getElementById("otpBackButton")
  .addEventListener(
    "click",
    () => {

      clearInterval(resendTimer);

      resendTimer = null;

      showPage("email");

      clearMessages();
      clearFieldErrors();

      otpInput.value = "";

    }
  );


/************************************************************
 * FINISH
 ************************************************************/

document
  .getElementById("finishButton")
  .addEventListener(
    "click",
    () => {

      location.reload();

    }
  );


/************************************************************
 * NUMERIC INPUTS
 ************************************************************/

whatsappInput.addEventListener(
  "input",
  numericInput
);

pinInput.addEventListener(
  "input",
  numericInput
);

otpInput.addEventListener(
  "input",
  numericInput
);

otpInput.addEventListener(
  "input",
  autoVerifyOtpWhenComplete
);


function numericInput(event) {

  event.target.value =
    event.target.value.replace(/\D/g, "");

}


/************************************************************
 * AUTO-VERIFY OTP
 *
 * As soon as the 6th digit is typed/pasted in, verify
 * automatically - no click on "Verify OTP" required.
 ************************************************************/

function autoVerifyOtpWhenComplete(event) {

  if (
    /^\d{6}$/.test(event.target.value) &&
    !verifyOtpButton.disabled
  ) {

    verifyOTP();

  }

}


/************************************************************
 * TERMS MODAL
 ************************************************************/

const termsModal = document.getElementById("termsModal");


document
  .getElementById("showTermsButton")
  ?.addEventListener(
    "click",
    openTerms
  );


document
  .getElementById("termsInlineButton")
  .addEventListener(
    "click",
    openTerms
  );


document
  .getElementById("closeTermsButton")
  .addEventListener(
    "click",
    closeTerms
  );


document
  .getElementById("acceptTermsButton")
  .addEventListener(
    "click",
    () => {

      termsInput.checked = true;

      closeTerms();

    }
  );


document
  .querySelector(".modal-overlay")
  .addEventListener(
    "click",
    closeTerms
  );


function openTerms() {

  termsModal.classList.remove("hidden");

}


function closeTerms() {

  termsModal.classList.add("hidden");

}


/************************************************************
 * CHECK EMAIL
 ************************************************************/

async function checkEmail() {

  const email = normalizeEmail(emailInput.value);

  clearFieldErrors();
  clearMessages();

  if (!isValidEmail(email)) {

    setFieldError(
      "emailError",
      "Please enter a valid email address."
    );

    emailInput.focus();

    return;

  }

  currentEmail = email;

  setLoading(continueButton, true);

  showMessage(
    "emailMessage",
    "Checking your account...",
    "info"
  );

  try {

    const result = await apiRequest({
      action: "checkEmail",
      email: email
    });


    if (!result.success) {

      showMessage(
        "emailMessage",
        result.message || "Unable to check email.",
        "error"
      );

      return;

    }


    if (result.exists) {

      currentMode = "login";
      currentName = result.name || "";

      /*
       * NEW: actually e-mail the login OTP (the backend's
       * "sendLoginOTP" action). Previously the OTP page was
       * shown without any OTP ever being sent.
       */

      showMessage(
        "emailMessage",
        "Sending your login OTP...",
        "info"
      );

      const otpResult = await apiRequest({
        action: "sendLoginOTP",
        email: email
      });

      if (!otpResult.success) {

        showMessage(
          "emailMessage",
          otpResult.message || "Unable to send login OTP.",
          "error"
        );

        return;

      }

      clearMessage("emailMessage");

      result.resendAfter = otpResult.resendAfter;

      emailDisplay.textContent = email;

      document.getElementById("otpEyebrow").textContent =
        "SECURE LOGIN";

      document.getElementById("otpTitle").textContent =
        "Verify to login";

      document.getElementById("verifyOtpText").textContent =
        "Login";

      otpInput.value = "";

      showPage("otp");

      startResendTimer(result.resendAfter || 60);

      focusOTP();

      return;

    }


    currentMode = "register";

    registrationEmail.value = email;

    showPage("registration");

    setTimeout(
      () => phoneInput.focus(),
      250
    );


  } catch (error) {

    console.error(error);

    showMessage(
      "emailMessage",
      "Unable to connect to the server. Please try again.",
      "error"
    );

  } finally {

    setLoading(continueButton, false);

  }

}


/************************************************************
 * REGISTRATION
 ************************************************************/

async function registerUser() {

  clearFieldErrors();
  clearMessages();

  const data = collectRegistrationData();

  const validation = validateRegistration(data);

  if (!validation.valid) {
    return;
  }

  currentName = data.studentName;

  setLoading(registerButton, true);

  showMessage(
    "registrationMessage",
    "Sending verification OTP...",
    "info"
  );

  try {

    const result = await apiRequest({

      action: "sendOTP",

      name: currentName,

      email: currentEmail,

      registration: data

    });


    if (!result.success) {

      showMessage(
        "registrationMessage",
        result.message || "Unable to send OTP.",
        "error"
      );

      return;

    }


    currentMode = "register";

    emailDisplay.textContent = currentEmail;

    document.getElementById("otpEyebrow").textContent =
      "REGISTRATION VERIFICATION";

    document.getElementById("otpTitle").textContent =
      "Verify your email";

    document.getElementById("verifyOtpText").textContent =
      "Verify & Register";

    otpInput.value = "";

    showPage("otp");

    startResendTimer(result.resendAfter || 60);

    focusOTP();


  } catch (error) {

    console.error(error);

    showMessage(
      "registrationMessage",
      "Unable to connect to the server.",
      "error"
    );

  } finally {

    setLoading(registerButton, false);

  }

}


/************************************************************
 * MEDIUM SELECTION
 *
 * Adds Online / Offline / Both without changing the existing
 * tutor-preference functionality.
 ************************************************************/

function ensureMediumOptions() {

  const tutorField = document.querySelector(
    'input[name="preferredTutor"]'
  );

  if (!tutorField) {
    return;
  }

  const tutorFieldContainer = tutorField.closest(".field");

  if (!tutorFieldContainer) {
    return;
  }

  if (document.querySelector('input[name="medium"]')) {
    return;
  }

  const mediumField = document.createElement("div");

  mediumField.className = "field medium-selection-field";

  mediumField.innerHTML = `
    <div class="selection-box medium-options"
         style="grid-template-columns:repeat(3,minmax(0,1fr));">

      <label class="selection-option">
        <input
          type="radio"
          name="medium"
          value="Online"
        >
        <span>Online</span>
      </label>

      <label class="selection-option">
        <input
          type="radio"
          name="medium"
          value="Offline"
        >
        <span>Offline</span>
      </label>

      <label class="selection-option">
        <input
          type="radio"
          name="medium"
          value="Both"
          checked
        >
        <span>Both</span>
      </label>

    </div>
  `;

  tutorFieldContainer.parentNode.insertBefore(
    mediumField,
    tutorFieldContainer.nextSibling
  );

}


/************************************************************
 * COLLECT REGISTRATION DATA
 ************************************************************/

function collectRegistrationData() {

  ensureMediumOptions();

  const timingValues = Array.from(
    document.querySelectorAll(
      'input[name="preferredTiming"]:checked'
    )
  ).map(
    input => input.value
  );


  const otherIndex = timingValues.indexOf("Other");


  if (otherIndex !== -1) {

    // The time picker gives "17:30" -> saved as "5:30 PM".
    const otherTiming = pickedTimeText(cleanText(timingOtherInput.value));

    if (otherTiming) {

      timingValues[otherIndex] = `Other: ${otherTiming}`;

    }

  }


  return {

    phone: cleanText(phoneInput.value),

    whatsapp: cleanText(
      sameAsPhoneInput.checked ? phoneInput.value : whatsappInput.value
    ),

    parentsName: cleanText(parentsNameInput.value),

    studentName: cleanText(studentNameInput.value),

    gender: getRadioValue("gender"),

    school: cleanText(schoolInput.value),

    className: cleanText(classInput.value),

    board: cleanText(boardInput.value),

    subjects: cleanText(subjectsInput.value),

    preferredTutor: getRadioValue("preferredTutor"),

    medium: getRadioValue("medium"),

    preferredTiming: timingValues.join(", "),

    city: cleanText(cityInput.value),

    address: cleanText(addressInput.value),

    pinCode: cleanText(pinInput.value),

    termsAccepted: termsInput.checked

  };

}


/************************************************************
 * CLIENT VALIDATION
 ************************************************************/

function validateRegistration(data) {

  let valid = true;


  if (!/^\d{10}$/.test(data.phone)) {

    setFieldError(
      "phoneError",
      "Enter a valid 10-digit phone number."
    );

    valid = false;

  }


  if (!/^\d{10}$/.test(data.whatsapp)) {

    setFieldError(
      "whatsappError",
      "Enter a valid 10-digit WhatsApp number."
    );

    valid = false;

  }


  if (data.parentsName.length < 2) {

    setFieldError(
      "parentsNameError",
      "Please enter the parent's name."
    );

    valid = false;

  }


  if (data.studentName.length < 2) {

    setFieldError(
      "studentNameError",
      "Please enter the student's name."
    );

    valid = false;

  }


  if (data.school.length < 2) {

    setFieldError(
      "schoolError",
      "Please enter your school."
    );

    valid = false;

  }


  if (!data.className) {

    setFieldError(
      "classError",
      "Please enter your class."
    );

    valid = false;

  }


  if (!data.board) {

    setFieldError(
      "boardError",
      "Please enter your board."
    );

    valid = false;

  }


  if (data.subjects.length < 2) {

    setFieldError(
      "subjectsError",
      "Please enter at least one subject."
    );

    valid = false;

  }


  if (!data.preferredTiming) {

    setFieldError(
      "timingError",
      "Please select at least one preferred timing."
    );

    valid = false;

  }


  if (
    data.preferredTiming.includes("Other") &&
    !cleanText(timingOtherInput.value)
  ) {

    setFieldError(
      "timingError",
      "Please enter your other preferred timing."
    );

    valid = false;

  }


  if (data.city.length < 2) {

    setFieldError(
      "cityError",
      "Please enter your city."
    );

    valid = false;

  }


  if (data.address.length < 3) {

    setFieldError(
      "addressError",
      "Please enter your address/location."
    );

    valid = false;

  }


  if (!/^\d{6}$/.test(data.pinCode)) {

    setFieldError(
      "pinError",
      "Enter a valid 6-digit PIN code."
    );

    valid = false;

  }


  if (!data.termsAccepted) {

    setFieldError(
      "termsError",
      "Please accept the Terms & Conditions."
    );

    valid = false;

  }


  return { valid };

}


/************************************************************
 * OTHER TIMING
 ************************************************************/

const timingOtherCheckbox = document.getElementById("timingOther");

const timingRegularCheckboxes = Array.from(
  document.querySelectorAll('input[name="preferredTiming"]')
).filter(
  (input) => input !== timingOtherCheckbox
);

timingOtherCheckbox.addEventListener(
  "change",
  function () {

    if (this.checked) {

      // "Other" selected -> clear every regular time slot and show the textbox.
      timingRegularCheckboxes.forEach((input) => {
        input.checked = false;
      });

      timingOtherWrap.classList.remove("hidden");

      setTimeout(
        () => timingOtherInput.focus(),
        50
      );

    } else {

      timingOtherWrap.classList.add("hidden");

      timingOtherInput.value = "";

    }

  }
);

// Vice versa: picking any regular time slot clears "Other" and hides its textbox.
timingRegularCheckboxes.forEach((input) => {

  input.addEventListener(
    "change",
    function () {

      if (this.checked && timingOtherCheckbox.checked) {

        timingOtherCheckbox.checked = false;

        timingOtherWrap.classList.add("hidden");

        timingOtherInput.value = "";

      }

    }
  );

});


/************************************************************
 * VERIFY OTP
 ************************************************************/

async function verifyOTP() {

  const otp = otpInput.value.trim();

  clearFieldError("otpError");
  clearMessage("otpMessage");

  if (!/^\d{6}$/.test(otp)) {

    setFieldError(
      "otpError",
      "Please enter the 6-digit OTP."
    );

    otpInput.focus();

    return;

  }

  setLoading(verifyOtpButton, true);

  showMessage(
    "otpMessage",
    "Verifying your OTP...",
    "info"
  );


  try {

    if (currentMode === "login") {

      const result = await apiRequest({

        action: "verifyLoginOTP",

        email: currentEmail,

        otp: otp

      });


      if (!result.success) {

        otpWrong(result.message || "Incorrect OTP.");

        return;

      }

      showSuccess("login", result);

      return;

    }


    if (currentMode === "register") {

      const result = await apiRequest({

        action: "verifyOTP",

        email: currentEmail,

        otp: otp

      });


      if (!result.success) {

        otpWrong(result.message || "Incorrect OTP.");

        return;

      }


      showSuccess("register", result);

    }


  } catch (error) {

    console.error(error);

    showMessage(
      "otpMessage",
      "Unable to connect to the server.",
      "error"
    );

  } finally {

    setLoading(verifyOtpButton, false);

  }

}


/************************************************************
 * RESEND OTP
 ************************************************************/

async function resendOTP() {

  resendButton.disabled = true;

  showMessage(
    "otpMessage",
    "Sending a new OTP...",
    "info"
  );


  try {

    const payload = {

      // NEW: a login OTP is re-sent with the login action, so
      // the backend doesn't treat it as a new registration.
      action:
        currentMode === "login"
          ? "sendLoginOTP"
          : "resendOTP",

      email: currentEmail

    };


    if (currentMode === "register") {

      payload.name = currentName;

    }


    const result = await apiRequest(payload);


    if (!result.success) {

      showMessage(
        "otpMessage",
        result.message || "Unable to resend OTP.",
        "error"
      );


      if (result.resendAfter) {

        startResendTimer(result.resendAfter);

      } else {

        resendButton.disabled = false;

      }

      return;

    }


    showMessage(
      "otpMessage",
      "New OTP sent successfully.",
      "success"
    );

    startResendTimer(result.resendAfter || 60);


  } catch (error) {

    console.error(error);

    resendButton.disabled = false;

    showMessage(
      "otpMessage",
      "Unable to connect to the server.",
      "error"
    );

  }

}


/************************************************************
 * SUCCESS / STUDENT SIGN-IN
 ************************************************************/

function showSuccess(type, result) {

  if (!result || !result.sessionToken) {

    showMessage(
      "otpMessage",
      "Verification succeeded, but the student session could not be created. Please try again.",
      "error"
    );

    return;

  }

  localStorage.setItem(
    "urbantutorsite_student_session",
    JSON.stringify({
      // Privacy: only the token is kept in the browser - no
      // email / mobile number is stored here.
      sessionToken: result.sessionToken
    })
  );

  // NEW: the homepage toggle / header open on "Student" right
  // after a student logs in (mirrors the tutor side).
  try {
    sessionStorage.setItem("urbantutorsite_last_login", "student");
  } catch (ignore) {}

  if (continueHomeButton) {
    continueHomeButton.href = "index.html";
  }

  window.location.href = "index.html";
}


/************************************************************
 * STUDENT PROFILE
 ************************************************************/

function getStudentSession() {

  try {
    const raw = localStorage.getItem(
      "urbantutorsite_student_session"
    );

    return raw ? JSON.parse(raw) : null;

  } catch (error) {

    localStorage.removeItem(
      "urbantutorsite_student_session"
    );

    return null;
  }
}

async function openStudentProfile() {

  const session = getStudentSession();

  if (!session || !session.sessionToken) {
    return;
  }

  // NEW: the full Student Profile page (all students on this
  // account) replaces the old single-student modal.
  window.location.href = "studentprofile.html";
  return;

  try {

    const result = await apiRequest({
      action: "getStudentProfile",
      sessionToken: session.sessionToken
    });

    if (!result.success) {
      localStorage.removeItem(
        "urbantutorsite_student_session"
      );
      window.location.href = "index.html";
      return;
    }

    session.profile = result.profile;
    localStorage.setItem(
      "urbantutorsite_student_session",
      JSON.stringify(session)
    );

    renderStudentProfile(result.profile);

    studentProfileModal.classList.remove("hidden");
    studentProfileModal.setAttribute("aria-hidden", "false");

  } catch (error) {

    console.error(error);

    alert("Unable to load your profile. Please try again.");

  }
}

function renderStudentProfile(profile) {

  if (!studentProfileContent) {
    return;
  }

  const fields = [
    ["Student ID", profile.studentId],
    ["Student Name", profile.studentName || profile.name],
    ["Parents Name", profile.parentsName || profile.parentName],
    ["Email", profile.email],
    ["Phone", profile.phone],
    ["WhatsApp", profile.whatsapp],
    ["School", profile.school],
    ["Class", profile.className],
    ["Board", profile.board],
    ["Subjects", profile.subjects, true],
    ["Preferred Tutor", profile.preferredTutor],
    ["Preferred Timing", profile.preferredTiming],
    ["City", profile.city],
    ["Address", profile.address, true],
    ["PIN Code", profile.pinCode],
    ["Account Status", profile.status]
  ];

  studentProfileContent.innerHTML = fields
    .filter(function(item) {
      return item[1] !== undefined && item[1] !== null && String(item[1]).trim() !== "";
    })
    .map(function(item) {
      const label = escapeHTML(item[0]);
      const value = escapeHTML(String(item[1]));
      const full = item[2] ? " full" : "";
      return `<div class="student-profile-item${full}"><span>${label}</span><strong>${value}</strong></div>`;
    })
    .join("");
}

function escapeHTML(value) {

  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function closeStudentProfileModal() {

  if (!studentProfileModal) {
    return;
  }

  studentProfileModal.classList.add("hidden");
  studentProfileModal.setAttribute("aria-hidden", "true");
}

async function logoutStudent() {

  const session = getStudentSession();

  if (session && session.sessionToken) {
    try {
      await apiRequest({
        action: "logoutStudent",
        sessionToken: session.sessionToken
      });
    } catch (error) {
      console.error(error);
    }
  }

  localStorage.removeItem(
    "urbantutorsite_student_session"
  );

  window.location.href = "index.html";
}


/************************************************************
 * API REQUEST
 ************************************************************/

async function apiRequest(payload) {

  const response = await fetch(
    WEB_APP_URL,
    {

      method: "POST",

      headers: {

        "Content-Type": "text/plain;charset=utf-8"

      },

      body: JSON.stringify(payload)

    }
  );


  if (!response.ok) {

    throw new Error(
      `HTTP ${response.status}`
    );

  }


  const text = await response.text();


  try {

    return JSON.parse(text);

  } catch (error) {

    throw new Error(
      "Invalid server response."
    );

  }

}


/************************************************************
 * PAGE MANAGEMENT
 ************************************************************/

function showPage(page) {

  emailPage.classList.add("hidden");

  registrationPage.classList.add("hidden");

  otpPage.hidden = true;

  successPage.hidden = true;


  if (page === "email") {

    emailPage.classList.remove("hidden");

  }


  if (page === "registration") {

    registrationPage.classList.remove("hidden");

  }


  if (page === "otp") {

    otpPage.hidden = false;

  }


  if (page === "success") {

    successPage.hidden = false;

  }


  window.scrollTo(0, 0);

}


/************************************************************
 * RESEND TIMER
 ************************************************************/

function startResendTimer(seconds) {

  clearInterval(resendTimer);

  let remaining = Math.max(
    0,
    Number(seconds) || 60
  );


  resendButton.disabled = remaining > 0;

  resendButton.textContent =
    remaining > 0
      ? `Resend in ${remaining}s`
      : "Resend OTP";


  if (remaining <= 0) {
    return;
  }


  resendTimer = setInterval(
    () => {

      remaining--;

      if (remaining <= 0) {

        clearInterval(resendTimer);

        resendTimer = null;

        resendButton.disabled = false;

        resendButton.textContent = "Resend OTP";

        return;

      }

      resendButton.textContent =
        `Resend in ${remaining}s`;

    },
    1000
  );

}


/************************************************************
 * LOADING
 ************************************************************/

// Wrong OTP: empty the box and give it the light red border.
function otpWrong(message) {

  otpInput.value = "";

  setFieldError("otpError", message);

  otpInput.focus();

}

function setLoading(button, loading) {

  button.disabled = loading;

  // The OTP page has no visible button: show the spinner in the box.
  if (button === verifyOtpButton) {
    const field = otpInput.closest(".field");
    if (field) field.classList.toggle("is-busy", loading);
    otpInput.readOnly = loading;
  }

  let textElement = null;
  let loaderElement = null;


  if (button === continueButton) {

    textElement = document.getElementById("continueText");

    loaderElement = document.getElementById("continueLoader");

  }


  if (button === registerButton) {

    textElement = document.getElementById("registerText");

    loaderElement = document.getElementById("registerLoader");

  }


  if (button === verifyOtpButton) {

    textElement = document.getElementById("verifyOtpText");

    loaderElement = document.getElementById("verifyOtpLoader");

  }


  if (textElement && loaderElement) {

    textElement.classList.toggle("hidden", loading);

    loaderElement.classList.toggle("hidden", !loading);

  }

}


/************************************************************
 * HELPERS
 ************************************************************/

function normalizeEmail(email) {

  return String(email || "")
    .trim()
    .toLowerCase();

}


function cleanText(value) {

  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");

}


function isValidEmail(email) {

  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i
    .test(email);

}


function getRadioValue(name) {

  const element = document.querySelector(
    `input[name="${name}"]:checked`
  );

  return element
    ? element.value
    : "";

}


function focusOTP() {

  setTimeout(
    () => otpInput.focus(),
    250
  );

}


/************************************************************
 * ERRORS / MESSAGES
 ************************************************************/

// "17:30" (time picker) -> "5:30 PM"; anything else is kept as is.
function pickedTimeText(value) {

  const m = String(value || "").match(/^(\d{1,2}):(\d{2})/);

  if (!m) return value;

  let h = parseInt(m[1], 10);
  const meridiem = h >= 12 ? "PM" : "AM";

  h = h % 12 || 12;

  return `${h}:${m[2]} ${meridiem}`;

}


// The box (or buttons) of a field with an error get a light red
// border. On the registration form the message text itself stays
// hidden; the email / OTP pages still show it.
function errorHost(element) {

  if (!element) return null;

  const field = element.closest(".field");

  if (field) return field;

  const before = element.previousElementSibling;

  return before && before.classList.contains("terms") ? before : null;

}

function setFieldError(id, message) {

  const element = document.getElementById(id);

  if (element) {

    element.textContent = message;

    const host = errorHost(element);

    if (host) host.classList.add("has-error");

  }

}


function clearFieldError(id) {

  const element = document.getElementById(id);

  if (element) {

    element.textContent = "";

    const host = errorHost(element);

    if (host) host.classList.remove("has-error");

  }

}


function clearFieldErrors() {

  [
    "emailError",
    "phoneError",
    "whatsappError",
    "parentsNameError",
    "studentNameError",
    "schoolError",
    "classError",
    "boardError",
    "subjectsError",
    "timingError",
    "cityError",
    "addressError",
    "pinError",
    "termsError",
    "otpError"

  ].forEach(clearFieldError);

}


function showMessage(id, message, type) {

  const element = document.getElementById(id);

  if (!element) {
    return;
  }

  element.textContent = message;

  element.className = `message ${type}`;

}


function clearMessage(id) {

  const element = document.getElementById(id);

  if (!element) {
    return;
  }

  element.textContent = "";

  element.className = "message";

}


function clearMessages() {

  [
    "emailMessage",
    "registrationMessage",
    "otpMessage"

  ].forEach(clearMessage);

}


/************************************************************
 * INITIAL STATE
 *
 * The login form is shown first. Only if the saved session is
 * confirmed valid by the server is the student sent to
 * index.html. An expired / invalid session is cleared so the
 * form stays usable.
 ************************************************************/

showPage("email");

ensureMediumOptions();

(async function () {

  const existingSession = getStudentSession();

  if (!existingSession || !existingSession.sessionToken) {
    return;
  }

  try {

    const result = await apiRequest({
      action: "getStudentProfile",
      sessionToken: existingSession.sessionToken
    });

    if (result.success) {

      window.location.replace("index.html");

      return;

    }

    localStorage.removeItem("urbantutorsite_student_session");

  } catch (error) {

    console.error(error);

  }

})();


/************************************************************
 * ERROR BORDER CLEARS AS SOON AS THE FIELD IS FIXED
 ************************************************************/

(function () {

  const form = document.getElementById("registrationForm");

  if (!form) return;

  const clearHost = event => {

    const host =
      event.target.closest(".field") ||
      event.target.closest(".terms");

    if (host) host.classList.remove("has-error");

  };

  form.addEventListener("input", clearHost);
  form.addEventListener("change", clearHost);

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
