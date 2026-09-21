"use strict";

/**
 * ============================================================
 * URBANTUTORSITE - STUDENT REGISTRATION
 * ============================================================
 *
 * This JavaScript handles ONLY:
 *
 * 1. Email entry
 * 2. Registration form
 * 3. Sending OTP
 * 4. OTP verification
 * 5. Successful registration
 *
 *
 * It communicates with Google Apps Script through ONE URL.
 *
 * ============================================================
 */


/**
 * ============================================================
 * CONFIGURATION
 * ============================================================
 *
 * This is your EXISTING Web App URL taken from your original
 * student.js.
 *
 * DO NOT change this unless you deploy a new Web App.
 */

const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwnhZnXpGVegX3kQtggtRjTej1JrsgfUdDyPrtMmuxh-IR_I8EGudmGAgLscda2y3nxLg/exec";


/**
 * ============================================================
 * PAGE STATE
 * ============================================================
 */

let currentEmail = "";

let currentName = "";

let resendTimer = null;


/**
 * ============================================================
 * GET HTML ELEMENTS
 * ============================================================
 */

const emailPage =
  document.getElementById("emailPage");

const registrationPage =
  document.getElementById("registrationPage");

const otpPage =
  document.getElementById("otpPage");

const successPage =
  document.getElementById("successPage");


const emailForm =
  document.getElementById("emailForm");

const registrationForm =
  document.getElementById("registrationForm");

const otpForm =
  document.getElementById("otpForm");


const emailInput =
  document.getElementById("email");

const registrationEmail =
  document.getElementById("registrationEmail");

const phoneInput =
  document.getElementById("phone");

const whatsappInput =
  document.getElementById("whatsapp");

const sameAsPhoneInput =
  document.getElementById("sameAsPhone");

const firstNameInput =
  document.getElementById("firstName");

const lastNameInput =
  document.getElementById("lastName");

const schoolInput =
  document.getElementById("school");

const classInput =
  document.getElementById("className");

const boardInput =
  document.getElementById("board");

const subjectsInput =
  document.getElementById("subjects");

const timingOtherInput =
  document.getElementById("timingOtherInput");

const timingOtherWrap =
  document.getElementById("otherTimingWrap");

const cityInput =
  document.getElementById("city");

const addressInput =
  document.getElementById("address");

const pinInput =
  document.getElementById("pinCode");

const termsInput =
  document.getElementById("terms");

const otpInput =
  document.getElementById("otp");


const continueButton =
  document.getElementById("continueButton");

const registerButton =
  document.getElementById("registerButton");

const verifyOtpButton =
  document.getElementById("verifyOtpButton");

const resendButton =
  document.getElementById("resendButton");


const emailDisplay =
  document.getElementById("emailDisplay");

const successEmail =
  document.getElementById("successEmail");

const continueHomeButton =
  document.getElementById("continueHomeButton");


/**
 * ============================================================
 * FORM EVENTS
 * ============================================================
 */

emailForm.addEventListener(
  "submit",
  async function(event) {

    event.preventDefault();

    await checkEmail();

  }
);


registrationForm.addEventListener(
  "submit",
  async function(event) {

    event.preventDefault();

    await registerUser();

  }
);


otpForm.addEventListener(
  "submit",
  async function(event) {

    event.preventDefault();

    await verifyOTP();

  }
);


resendButton.addEventListener(
  "click",
  resendOTP
);


/**
 * ============================================================
 * SAME AS PHONE NUMBER
 * ============================================================
 */

sameAsPhoneInput.addEventListener(
  "change",
  function() {

    if (sameAsPhoneInput.checked) {

      whatsappInput.value =
        phoneInput.value;

      whatsappInput.readOnly = true;

    } else {

      whatsappInput.readOnly = false;

      whatsappInput.value = "";

    }

  }
);


phoneInput.addEventListener(
  "input",
  function() {

    numericInput({
      target: phoneInput
    });


    if (sameAsPhoneInput.checked) {

      whatsappInput.value =
        phoneInput.value;

    }

  }
);


/**
 * ============================================================
 * OTHER NUMERIC INPUTS
 * ============================================================
 */

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


function numericInput(event) {

  event.target.value =
    event.target.value.replace(
      /\D/g,
      ""
    );

}


/**
 * ============================================================
 * BACK BUTTON - REGISTRATION
 * ============================================================
 */

document
  .getElementById("registrationBackButton")
  .addEventListener(
    "click",
    function() {

      showPage("email");

      clearMessages();

      clearFieldErrors();

    }
  );


/**
 * ============================================================
 * BACK BUTTON - OTP
 * ============================================================
 */

document
  .getElementById("otpBackButton")
  .addEventListener(
    "click",
    function() {

      clearInterval(resendTimer);

      resendTimer = null;

      showPage("email");

      clearMessages();

      clearFieldErrors();

      otpInput.value = "";

    }
  );


/**
 * ============================================================
 * FINISH BUTTON
 * ============================================================
 */

document
  .getElementById("finishButton")
  .addEventListener(
    "click",
    function() {

      location.reload();

    }
  );


/**
 * ============================================================
 * TERMS MODAL
 * ============================================================
 */

const termsModal =
  document.getElementById("termsModal");


document
  .getElementById("termsInlineButton")
  ?.addEventListener(
    "click",
    openTerms
  );


document
  .getElementById("closeTermsButton")
  ?.addEventListener(
    "click",
    closeTerms
  );


document
  .getElementById("acceptTermsButton")
  ?.addEventListener(
    "click",
    function() {

      termsInput.checked = true;

      closeTerms();

    }
  );


document
  .querySelector(".modal-overlay")
  ?.addEventListener(
    "click",
    closeTerms
  );


function openTerms() {

  termsModal.classList.remove(
    "hidden"
  );

}


function closeTerms() {

  termsModal.classList.add(
    "hidden"
  );

}


/**
 * ============================================================
 * CHECK EMAIL
 * ============================================================
 *
 * We first ask Apps Script:
 *
 * "Does this email already exist?"
 *
 * If yes:
 *
 *     registration stops
 *
 * If no:
 *
 *     registration form opens
 *
 * ============================================================
 */

async function checkEmail() {


  const email =
    normalizeEmail(
      emailInput.value
    );


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


  setLoading(
    continueButton,
    true
  );


  showMessage(
    "emailMessage",
    "Checking your email...",
    "info"
  );


  try {


    const result =
      await apiRequest({

        action: "checkEmail",

        email: email

      });


    if (!result.success) {

      showMessage(
        "emailMessage",
        result.message ||
          "Unable to check email.",
        "error"
      );

      return;

    }


    if (result.exists) {

      showMessage(
        "emailMessage",
        "This email is already registered.",
        "error"
      );

      return;

    }


    registrationEmail.value =
      email;


    showPage(
      "registration"
    );


    setTimeout(
      function() {

        phoneInput.focus();

      },
      250
    );


  } catch (error) {


    console.error(error);


    showMessage(
      "emailMessage",
      "Unable to connect to the server.",
      "error"
    );


  } finally {


    setLoading(
      continueButton,
      false
    );

  }

}


/**
 * ============================================================
 * REGISTER USER
 * ============================================================
 */

async function registerUser() {


  clearFieldErrors();

  clearMessages();


  const data =
    collectRegistrationData();


  const validation =
    validateRegistration(
      data
    );


  if (!validation.valid) {

    return;

  }


  currentName =
    `${data.firstName} ${data.lastName}`;


  setLoading(
    registerButton,
    true
  );


  showMessage(
    "registrationMessage",
    "Sending verification OTP...",
    "info"
  );


  try {


    const result =
      await apiRequest({

        action: "sendOTP",

        name: currentName,

        email: currentEmail,

        registration: data

      });


    if (!result.success) {

      showMessage(
        "registrationMessage",
        result.message ||
          "Unable to send OTP.",
        "error"
      );

      return;

    }


    emailDisplay.textContent =
      currentEmail;


    document
      .getElementById(
        "otpEyebrow"
      )
      .textContent =
        "REGISTRATION VERIFICATION";


    document
      .getElementById(
        "otpTitle"
      )
      .textContent =
        "Verify your email";


    document
      .getElementById(
        "verifyOtpText"
      )
      .textContent =
        "Verify & Register";


    otpInput.value = "";


    showPage(
      "otp"
    );


    startResendTimer(
      result.resendAfter || 60
    );


    focusOTP();


  } catch (error) {


    console.error(error);


    showMessage(
      "registrationMessage",
      "Unable to connect to the server.",
      "error"
    );


  } finally {


    setLoading(
      registerButton,
      false
    );

  }

}


/**
 * ============================================================
 * COLLECT REGISTRATION DATA
 * ============================================================
 *
 * These fields are taken directly from your original
 * student.js.
 * ============================================================
 */

function collectRegistrationData() {


  const timingValues =
    Array.from(
      document.querySelectorAll(
        'input[name="preferredTiming"]:checked'
      )
    )
    .map(
      function(input) {

        return input.value;

      }
    );


  const otherIndex =
    timingValues.indexOf(
      "Other"
    );


  if (otherIndex !== -1) {


    const otherTiming =
      cleanText(
        timingOtherInput.value
      );


    if (otherTiming) {

      timingValues[otherIndex] =
        `Other: ${otherTiming}`;

    }

  }


  return {


    phone:
      cleanText(
        phoneInput.value
      ),


    whatsapp:
      cleanText(
        whatsappInput.value
      ),


    firstName:
      cleanText(
        firstNameInput.value
      ),


    lastName:
      cleanText(
        lastNameInput.value
      ),


    gender:
      getRadioValue(
        "gender"
      ),


    school:
      cleanText(
        schoolInput.value
      ),


    className:
      cleanText(
        classInput.value
      ),


    board:
      cleanText(
        boardInput.value
      ),


    subjects:
      cleanText(
        subjectsInput.value
      ),


    preferredTutor:
      getRadioValue(
        "preferredTutor"
      ),


    preferredTiming:
      timingValues.join(
        ", "
      ),


    city:
      cleanText(
        cityInput.value
      ),


    address:
      cleanText(
        addressInput.value
      ),


    pinCode:
      cleanText(
        pinInput.value
      ),


    termsAccepted:
      termsInput.checked

  };

}


/**
 * ============================================================
 * CLIENT-SIDE VALIDATION
 * ============================================================
 */

function validateRegistration(data) {


  let valid = true;


  if (!/^\d{10}$/.test(
    data.phone
  )) {

    setFieldError(
      "phoneError",
      "Enter a valid 10-digit phone number."
    );

    valid = false;

  }


  if (!/^\d{10}$/.test(
    data.whatsapp
  )) {

    setFieldError(
      "whatsappError",
      "Enter a valid 10-digit WhatsApp number."
    );

    valid = false;

  }


  if (
    data.firstName.length < 2
  ) {

    setFieldError(
      "firstNameError",
      "Please enter your first name."
    );

    valid = false;

  }


  if (
    data.lastName.length < 1
  ) {

    setFieldError(
      "lastNameError",
      "Please enter your last name."
    );

    valid = false;

  }


  if (
    data.school.length < 2
  ) {

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


  if (
    data.subjects.length < 2
  ) {

    setFieldError(
      "subjectsError",
      "Please enter at least one subject."
    );

    valid = false;

  }


  if (
    !data.preferredTiming
  ) {

    setFieldError(
      "timingError",
      "Please select at least one preferred timing."
    );

    valid = false;

  }


  if (
    data.preferredTiming.includes(
      "Other"
    ) &&
    !cleanText(
      timingOtherInput.value
    )
  ) {

    setFieldError(
      "timingError",
      "Please enter your other preferred timing."
    );

    valid = false;

  }


  if (
    data.city.length < 2
  ) {

    setFieldError(
      "cityError",
      "Please enter your city."
    );

    valid = false;

  }


  if (
    data.address.length < 3
  ) {

    setFieldError(
      "addressError",
      "Please enter your address/location."
    );

    valid = false;

  }


  if (!/^\d{6}$/.test(
    data.pinCode
  )) {

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


  return {

    valid: valid

  };

}


/**
 * ============================================================
 * OTHER TIMING
 * ============================================================
 */

document
  .getElementById("timingOther")
  ?.addEventListener(
    "change",
    function() {


      if (this.checked) {

        timingOtherWrap
          .classList
          .remove("hidden");


        setTimeout(
          function() {

            timingOtherInput.focus();

          },
          50
        );


      } else {

        timingOtherWrap
          .classList
          .add("hidden");


        timingOtherInput.value =
          "";

      }

    }
  );


/**
 * ============================================================
 * VERIFY OTP
 * ============================================================
 */

async function verifyOTP() {


  const otp =
    otpInput.value.trim();


  clearFieldError(
    "otpError"
  );

  clearMessage(
    "otpMessage"
  );


  if (!/^\d{6}$/.test(otp)) {

    setFieldError(
      "otpError",
      "Please enter the 6-digit OTP."
    );

    otpInput.focus();

    return;

  }


  setLoading(
    verifyOtpButton,
    true
  );


  showMessage(
    "otpMessage",
    "Verifying your OTP...",
    "info"
  );


  try {


    const result =
      await apiRequest({

        action: "verifyOTP",

        email: currentEmail,

        otp: otp

      });


    if (!result.success) {

      showMessage(
        "otpMessage",
        result.message ||
          "Unable to complete registration.",
        "error"
      );

      return;

    }


    /**
     * Registration is now permanently saved.
     */

    showRegistrationSuccess(
      result
    );


  } catch (error) {


    console.error(error);


    showMessage(
      "otpMessage",
      "Unable to connect to the server.",
      "error"
    );


  } finally {


    setLoading(
      verifyOtpButton,
      false
    );

  }

}


/**
 * ============================================================
 * RESEND OTP
 * ============================================================
 */

async function resendOTP() {


  resendButton.disabled = true;


  showMessage(
    "otpMessage",
    "Sending a new OTP...",
    "info"
  );


  try {


    const result =
      await apiRequest({

        action: "resendOTP",

        email: currentEmail,

        name: currentName

      });


    if (!result.success) {


      showMessage(
        "otpMessage",
        result.message ||
          "Unable to resend OTP.",
        "error"
      );


      resendButton.disabled =
        false;


      return;

    }


    showMessage(
      "otpMessage",
      "New OTP sent successfully.",
      "success"
    );


    startResendTimer(
      result.resendAfter || 60
    );


  } catch (error) {


    console.error(error);


    resendButton.disabled =
      false;


    showMessage(
      "otpMessage",
      "Unable to connect to the server.",
      "error"
    );

  }

}


/**
 * ============================================================
 * SHOW REGISTRATION SUCCESS
 * ============================================================
 */

function showRegistrationSuccess(
  result
) {


  clearInterval(
    resendTimer
  );


  resendTimer = null;


  successEmail.textContent =
    currentEmail;


  /**
   * Show the success page.
   */

  showPage(
    "success"
  );


  /**
   * If the HTML has a success description element,
   * update it with the Student ID.
   */

  const description =
    document.getElementById(
      "successDescription"
    );


  if (
    description &&
    result.studentId
  ) {

    description.textContent =
      "Your registration has been completed successfully. " +
      "Your Student ID is " +
      result.studentId +
      ".";

  }


  /**
   * We don't need a login/session system in this first
   * registration-only version.
   */

  if (continueHomeButton) {

    continueHomeButton
      .classList
      .remove("hidden");

  }

}


/**
 * ============================================================
 * API REQUEST
 * ============================================================
 *
 * All communication with Google Apps Script happens here.
 *
 * Later, when we add:
 *
 *     getStudents
 *     updateStudent
 *     getAppointments
 *     updateAppointment
 *
 * we will still use this SAME function.
 *
 * ============================================================
 */

async function apiRequest(
  payload
) {


  const response =
    await fetch(

      WEB_APP_URL,

      {

        method:
          "POST",

        headers: {

          "Content-Type":
            "text/plain;charset=utf-8"

        },

        body:
          JSON.stringify(
            payload
          )

      }

    );


  if (!response.ok) {

    throw new Error(
      `HTTP ${response.status}`
    );

  }


  const text =
    await response.text();


  try {

    return JSON.parse(
      text
    );

  } catch (error) {

    console.error(
      "Server response:",
      text
    );


    throw new Error(
      "Invalid server response."
    );

  }

}


/**
 * ============================================================
 * PAGE MANAGEMENT
 * ============================================================
 */

function showPage(page) {


  emailPage
    .classList
    .add("hidden");


  registrationPage
    .classList
    .add("hidden");


  otpPage.hidden =
    true;


  successPage.hidden =
    true;


  if (page === "email") {

    emailPage
      .classList
      .remove("hidden");

  }


  if (page === "registration") {

    registrationPage
      .classList
      .remove("hidden");

  }


  if (page === "otp") {

    otpPage.hidden =
      false;

  }


  if (page === "success") {

    successPage.hidden =
      false;

  }


  window.scrollTo(
    0,
    0
  );

}


/**
 * ============================================================
 * OTP RESEND TIMER
 * ============================================================
 */

function startResendTimer(
  seconds
) {


  clearInterval(
    resendTimer
  );


  let remaining =
    Math.max(
      0,
      Number(seconds) || 60
    );


  resendButton.disabled =
    remaining > 0;


  resendButton.textContent =
    remaining > 0
      ? `Resend in ${remaining}s`
      : "Resend OTP";


  if (remaining <= 0) {

    return;

  }


  resendTimer =
    setInterval(
      function() {


        remaining--;


        if (remaining <= 0) {


          clearInterval(
            resendTimer
          );


          resendTimer =
            null;


          resendButton.disabled =
            false;


          resendButton.textContent =
            "Resend OTP";


          return;

        }


        resendButton.textContent =
          `Resend in ${remaining}s`;


      },
      1000
    );

}


/**
 * ============================================================
 * LOADING STATE
 * ============================================================
 */

function setLoading(
  button,
  loading
) {


  if (!button) {

    return;

  }


  button.disabled =
    loading;


  let textElement =
    null;


  let loaderElement =
    null;


  if (
    button ===
    continueButton
  ) {

    textElement =
      document.getElementById(
        "continueText"
      );


    loaderElement =
      document.getElementById(
        "continueLoader"
      );

  }


  if (
    button ===
    registerButton
  ) {

    textElement =
      document.getElementById(
        "registerText"
      );


    loaderElement =
      document.getElementById(
        "registerLoader"
      );

  }


  if (
    button ===
    verifyOtpButton
  ) {

    textElement =
      document.getElementById(
        "verifyOtpText"
      );


    loaderElement =
      document.getElementById(
        "verifyOtpLoader"
      );

  }


  if (
    textElement &&
    loaderElement
  ) {

    textElement
      .classList
      .toggle(
        "hidden",
        loading
      );


    loaderElement
      .classList
      .toggle(
        "hidden",
        !loading
      );

  }

}


/**
 * ============================================================
 * HELPERS
 * ============================================================
 */

function normalizeEmail(
  email
) {

  return String(
    email || ""
  )
    .trim()
    .toLowerCase();

}


function cleanText(
  value
) {

  return String(
    value || ""
  )
    .trim()
    .replace(
      /\s+/g,
      " "
    );

}


function isValidEmail(
  email
) {

  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i
    .test(email);

}


function getRadioValue(
  name
) {


  const element =
    document.querySelector(
      `input[name="${name}"]:checked`
    );


  return element
    ? element.value
    : "";

}


/**
 * ============================================================
 * FOCUS OTP
 * ============================================================
 */

function focusOTP() {


  setTimeout(
    function() {

      otpInput.focus();

    },
    250
  );

}


/**
 * ============================================================
 * ERROR HELPERS
 * ============================================================
 */

function setFieldError(
  id,
  message
) {


  const element =
    document.getElementById(
      id
    );


  if (element) {

    element.textContent =
      message;

  }

}


function clearFieldError(
  id
) {


  const element =
    document.getElementById(
      id
    );


  if (element) {

    element.textContent =
      "";

  }

}


function clearFieldErrors() {


  [

    "emailError",

    "phoneError",

    "whatsappError",

    "firstNameError",

    "lastNameError",

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

  ].forEach(
    clearFieldError
  );

}


/**
 * ============================================================
 * MESSAGE HELPERS
 * ============================================================
 */

function showMessage(
  id,
  message,
  type
) {


  const element =
    document.getElementById(
      id
    );


  if (!element) {

    return;

  }


  element.textContent =
    message;


  element.className =
    `message ${type}`;

}


function clearMessage(
  id
) {


  const element =
    document.getElementById(
      id
    );


  if (!element) {

    return;

  }


  element.textContent =
    "";


  element.className =
    "message";

}


function clearMessages() {


  [

    "emailMessage",

    "registrationMessage",

    "otpMessage"

  ].forEach(
    clearMessage
  );

}


/**
 * ============================================================
 * INITIAL PAGE
 * ============================================================
 */

showPage(
  "email"
);
