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

["whatsapp", "pinCode"].forEach(id =>
  $(id).addEventListener("input", () => digitsOnly($(id)))
);

/* ---- Year pickers (Class 12th / Graduation / PG passing year) ----
   The <select> stays the real value (val(id) reads it); a styled
   button + year grid is drawn over it. */

const YEAR_MIN = 1980;
const YEAR_MAX = new Date().getFullYear();
const YEARS_PER_PAGE = 12;

function fillYearSelect(id) {
  const select = $(id);
  if (!select) return;
  select.innerHTML = '<option value="">Select Year</option>';
  for (let y = YEAR_MAX; y >= YEAR_MIN; y--) {
    select.insertAdjacentHTML("beforeend", `<option value="${y}">${y}</option>`);
  }
  buildYearPicker(select);
}

function buildYearPicker(select) {
  const wrap = document.createElement("div");
  wrap.className = "yp";
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.classList.add("yp-native");
  select.tabIndex = -1;

  wrap.insertAdjacentHTML("beforeend", `
    <button type="button" class="yp-trigger" aria-haspopup="dialog" aria-expanded="false">
      <svg class="yp-cal" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>
      <span class="yp-text">Select Year</span>
      <svg class="yp-chev" viewBox="0 0 14 9" aria-hidden="true"><path d="M1 1.5l6 6 6-6"/></svg>
    </button>
    <div class="yp-panel" role="dialog" aria-label="${select.getAttribute("aria-label") || "Choose year"}" hidden>
      <div class="yp-head">
        <button type="button" class="yp-nav" data-dir="-1" aria-label="Earlier years">‹</button>
        <span class="yp-range"></span>
        <button type="button" class="yp-nav" data-dir="1" aria-label="Later years">›</button>
      </div>
      <div class="yp-grid"></div>
    </div>`);

  const trigger = wrap.querySelector(".yp-trigger");
  const text = wrap.querySelector(".yp-text");
  const panel = wrap.querySelector(".yp-panel");
  const grid = wrap.querySelector(".yp-grid");
  const range = wrap.querySelector(".yp-range");
  let pageEnd = YEAR_MAX;

  function draw() {
    const start = pageEnd - YEARS_PER_PAGE + 1;
    range.textContent = `${Math.max(start, YEAR_MIN)} – ${pageEnd}`;
    grid.innerHTML = "";
    for (let y = start; y <= pageEnd; y++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "yp-year";
      b.textContent = y;
      if (y < YEAR_MIN) { b.disabled = true; b.classList.add("is-empty"); }
      if (String(y) === select.value) b.classList.add("is-selected");
      if (y === YEAR_MAX) b.classList.add("is-current");
      b.addEventListener("click", () => {
        select.value = String(y);
        select.dispatchEvent(new Event("change", { bubbles: true }));
        close();
      });
      grid.appendChild(b);
    }
    wrap.querySelector('[data-dir="1"]').disabled = pageEnd >= YEAR_MAX;
    wrap.querySelector('[data-dir="-1"]').disabled = start <= YEAR_MIN;
  }

  function sync() {
    text.textContent = select.value || "Select Year";
    wrap.classList.toggle("has-value", !!select.value);
  }

  function open() {
    document.querySelectorAll(".yp.is-open").forEach(o => o !== wrap && o._close());
    const y = Number(select.value) || YEAR_MAX;
    pageEnd = Math.min(YEAR_MAX, y + Math.floor(YEARS_PER_PAGE / 2) - 1);
    if (pageEnd < YEAR_MIN + YEARS_PER_PAGE - 1) pageEnd = YEAR_MIN + YEARS_PER_PAGE - 1;
    if (!select.value) pageEnd = YEAR_MAX;
    draw();
    panel.hidden = false;
    wrap.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
  }

  function close() {
    panel.hidden = true;
    wrap.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  }
  wrap._close = close;

  trigger.addEventListener("click", () => (panel.hidden ? open() : close()));
  wrap.querySelectorAll(".yp-nav").forEach(n =>
    n.addEventListener("click", () => { pageEnd += Number(n.dataset.dir) * YEARS_PER_PAGE; pageEnd = Math.min(pageEnd, YEAR_MAX); draw(); })
  );
  select.addEventListener("change", sync);
  document.addEventListener("click", e => { if (!wrap.contains(e.target)) close(); });
  wrap.addEventListener("keydown", e => { if (e.key === "Escape") { close(); trigger.focus(); } });
  sync();
}

["twelfthYear", "graduationYear", "pgYear"].forEach(fillYearSelect);


/* ---- Slider helpers: position of a value along the rail (0-100%) ---- */

function sliderPct(input, value) {
  const min = Number(input.min), max = Number(input.max);
  return ((Number(value) - min) / (max - min)) * 100;
}

function markTicks(container, lo, hi, offset) {
  container.querySelectorAll(".ut-ticks span").forEach((s, i) =>
    s.classList.toggle("is-on", i + offset >= lo && i + offset <= hi)
  );
}


/* ---- Experience slider (0-10, 11 = "10+") ---- */

const experienceSlider = $("experience");
const experienceValueLabel = $("experienceValue");
const experienceFill = $("experienceFill");

function syncExperienceLabel() {
  const v = Number(experienceSlider.value);
  experienceValueLabel.textContent = v >= 11 ? "10+ years" : `${v} year${v === 1 ? "" : "s"}`;
  experienceFill.style.left = "0%";
  experienceFill.style.width = sliderPct(experienceSlider, v) + "%";
  markTicks(experienceSlider.closest(".ut-slider"), 0, v, 0);
}

experienceSlider.addEventListener("input", syncExperienceLabel);
syncExperienceLabel();


/* ---- Classes You Teach: one rail, two handles (Class 1 - Class 12) ---- */

const classesFrom = $("classesFrom");
const classesTo = $("classesTo");
const classesFromLabel = $("classesFromLabel");
const classesToLabel = $("classesToLabel");
const classesFill = $("classesFill");
const classesCount = $("classesCount");

function syncClassesRange(e) {
  let from = Number(classesFrom.value);
  let to = Number(classesTo.value);
  if (from > to) {
    // the handles never cross: the one being moved stops at the other
    if (e && e.target === classesTo) { to = from; classesTo.value = to; }
    else { from = to; classesFrom.value = from; }
  }

  // when both handles sit on the same class, keep the movable one on top
  classesFrom.style.zIndex = from === to && from > 6 ? 4 : 2;
  classesTo.style.zIndex = 3;

  classesFromLabel.textContent = `Class ${from}`;
  classesToLabel.textContent = `Class ${to}`;
  const n = to - from + 1;
  classesCount.textContent = `${n} class${n === 1 ? "" : "es"}`;

  classesFill.style.left = sliderPct(classesFrom, from) + "%";
  classesFill.style.width = (sliderPct(classesFrom, to) - sliderPct(classesFrom, from)) + "%";
  markTicks(classesFrom.closest(".ut-slider"), from, to, 1);

  document.querySelectorAll("#classesPresets button").forEach(b =>
    b.classList.toggle("is-active", Number(b.dataset.from) === from && Number(b.dataset.to) === to)
  );
  setError("classesError", "");
}

classesFrom.addEventListener("input", syncClassesRange);
classesTo.addEventListener("input", syncClassesRange);
document.querySelectorAll("#classesPresets button").forEach(b =>
  b.addEventListener("click", () => {
    classesFrom.value = b.dataset.from;
    classesTo.value = b.dataset.to;
    syncClassesRange();
  })
);
syncClassesRange();

function classesYouTeachValue() {
  const from = Number(classesFrom.value);
  const to = Number(classesTo.value);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const list = [];
  for (let c = lo; c <= hi; c++) list.push(`Class ${c}`);
  return list.join(", ");
}


/* ---- Subjects You Teach: search + add chips ---- */

const SUBJECTS_LIST = [
  "Accountancy", "Arts & Craft", "Biology", "Biology/Biotechnology",
  "Business Administration (BBA/MBA)", "Business Studies", "Chemistry", "Civics",
  "Computer Applications", "Computer Science", "Dance", "Economics", "English",
  "Environmental Studies (EVS)", "French", "Geography", "German", "Hindi", "History",
  "Home Science", "Informatics Practices", "Information Technology", "Korean",
  "Marathi", "Mathematics", "Music", "Philosophy", "Physical Education", "Physics",
  "Political Science", "Psychology", "Punjabi", "Sanskrit", "Sciences", "Sociology",
  "Spanish", "Yoga & Gymnastics"
];

const POPULAR_SUBJECTS = [
  "Mathematics", "English", "Physics", "Chemistry", "Biology", "Hindi",
  "Sciences", "Computer Science", "Accountancy", "Economics"
];

let selectedSubjects = [];
let subjectOptions = [];
let subjectActive = -1;

const subjectsChipList = $("subjectsChipList");
const subjectsSearchInput = $("subjectsSearchInput");
const subjectsSuggestions = $("subjectsSuggestions");
const subjectsCount = $("subjectsCount");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function isSelectedSubject(s) {
  return selectedSubjects.some(sel => sel.toLowerCase() === s.toLowerCase());
}

function renderSubjectChips() {
  subjectsChipList.innerHTML = "";
  selectedSubjects.forEach(subject => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `<span>${escapeHtml(subject)}</span><button type="button" class="chip-remove" aria-label="Remove ${escapeHtml(subject)}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg></button>`;
    chip.querySelector(".chip-remove").addEventListener("click", () => {
      selectedSubjects = selectedSubjects.filter(s => s !== subject);
      renderSubjectChips();
      if (document.activeElement === subjectsSearchInput) renderSubjectSuggestions();
    });
    subjectsChipList.appendChild(chip);
  });
  const n = selectedSubjects.length;
  subjectsCount.textContent = n
    ? `${n} subject${n === 1 ? "" : "s"} selected`
    : "Pick from the list, or type your own and press Enter";
  subjectsCount.classList.toggle("is-on", n > 0);
}

function addSubject(subject) {
  const clean = cleanText(subject);
  if (!clean) return;
  // use the list's spelling when the typed text matches one
  const known = SUBJECTS_LIST.find(s => s.toLowerCase() === clean.toLowerCase());
  const finalName = known || clean;
  if (!isSelectedSubject(finalName)) {
    selectedSubjects.push(finalName);
    renderSubjectChips();
    setError("subjectsError", "");
  }
  subjectsSearchInput.value = "";
  renderSubjectSuggestions();
}

function closeSubjectSuggestions() {
  subjectsSuggestions.classList.add("hidden");
  subjectsSearchInput.setAttribute("aria-expanded", "false");
  subjectActive = -1;
}

function renderSubjectSuggestions() {
  const raw = subjectsSearchInput.value.trim();
  const query = raw.toLowerCase();
  subjectsSuggestions.innerHTML = "";
  subjectActive = -1;

  let heading;
  if (!query) {
    heading = "Popular subjects";
    subjectOptions = POPULAR_SUBJECTS.filter(s => !isSelectedSubject(s)).map(s => ({ value: s }));
  } else {
    heading = "";
    const starts = SUBJECTS_LIST.filter(s => s.toLowerCase().startsWith(query));
    const contains = SUBJECTS_LIST.filter(s => !s.toLowerCase().startsWith(query) && s.toLowerCase().includes(query));
    subjectOptions = [...starts, ...contains].filter(s => !isSelectedSubject(s)).slice(0, 7).map(s => ({ value: s }));
    const exact = SUBJECTS_LIST.some(s => s.toLowerCase() === query) || isSelectedSubject(raw);
    if (!exact) subjectOptions.push({ value: raw, custom: true });
  }

  if (subjectOptions.length === 0) { closeSubjectSuggestions(); return; }

  if (heading) subjectsSuggestions.insertAdjacentHTML("beforeend", `<div class="chip-suggest-head">${heading}</div>`);

  subjectOptions.forEach((opt, i) => {
    const item = document.createElement("div");
    item.className = "chip-suggestion" + (opt.custom ? " is-custom" : "");
    item.setAttribute("role", "option");
    if (opt.custom) {
      item.innerHTML = `<span class="chip-plus">+</span> Add “${escapeHtml(opt.value)}”`;
    } else if (query) {
      const at = opt.value.toLowerCase().indexOf(query);
      item.innerHTML = escapeHtml(opt.value.slice(0, at)) +
        `<mark>${escapeHtml(opt.value.slice(at, at + query.length))}</mark>` +
        escapeHtml(opt.value.slice(at + query.length));
    } else {
      item.textContent = opt.value;
    }
    item.addEventListener("mousedown", e => { e.preventDefault(); addSubject(opt.value); });
    item.addEventListener("mousemove", () => highlightSubject(i));
    subjectsSuggestions.appendChild(item);
  });

  if (query) highlightSubject(0);
  subjectsSuggestions.classList.remove("hidden");
  subjectsSearchInput.setAttribute("aria-expanded", "true");
}

function highlightSubject(i) {
  subjectActive = i;
  subjectsSuggestions.querySelectorAll(".chip-suggestion").forEach((el, j) =>
    el.classList.toggle("is-active", j === i)
  );
}

subjectsSearchInput.addEventListener("input", renderSubjectSuggestions);
subjectsSearchInput.addEventListener("focus", renderSubjectSuggestions);
subjectsSearchInput.addEventListener("keydown", e => {
  const n = subjectOptions.length;
  if (e.key === "ArrowDown" && n) { e.preventDefault(); highlightSubject((subjectActive + 1) % n); }
  else if (e.key === "ArrowUp" && n) { e.preventDefault(); highlightSubject((subjectActive - 1 + n) % n); }
  else if (e.key === "Enter") {
    e.preventDefault();
    if (subjectActive >= 0 && subjectOptions[subjectActive]) addSubject(subjectOptions[subjectActive].value);
    else addSubject(subjectsSearchInput.value);
  }
  else if (e.key === "Escape") closeSubjectSuggestions();
  else if (e.key === "Backspace" && !subjectsSearchInput.value && selectedSubjects.length) {
    selectedSubjects.pop();
    renderSubjectChips();
    renderSubjectSuggestions();
  }
});
subjectsSearchInput.addEventListener("blur", () => setTimeout(closeSubjectSuggestions, 120));
$("subjectsTeach").addEventListener("click", e => {
  if (!e.target.closest(".chip-remove") && !e.target.closest(".chip-suggestions")) subjectsSearchInput.focus();
});
renderSubjectChips();


/* ---- Class 12th Board / Boards You Teach: "Other" reveals a text box ---- */

function bindOtherBoard(radioName, wrapId, inputId) {
  const wrap = $(wrapId);
  document.querySelectorAll(`input[name="${radioName}"]`).forEach(radio => {
    radio.addEventListener("change", () => {
      const isOther = radio.value === "Other" && radio.checked;
      wrap.classList.toggle("hidden", !isOther);
      if (isOther) $(inputId).focus();
    });
  });
}

bindOtherBoard("twelfthBoard", "twelfthBoardOtherWrap", "twelfthBoardOther");

function class12BoardValue() {
  const selected = checked("twelfthBoard");
  if (selected === "Other") return cleanText($("twelfthBoardOther").value);
  return selected;
}

const boardsOtherCheckbox = document.querySelector('#boardsTeach input[value="Other"]');
const boardsOtherWrap = $("boardsOtherWrap");

if (boardsOtherCheckbox) {
  boardsOtherCheckbox.addEventListener("change", () => {
    boardsOtherWrap.classList.toggle("hidden", !boardsOtherCheckbox.checked);
    if (boardsOtherCheckbox.checked) $("boardsOther").focus();
  });
}

function boardsYouTeachValue() {
  const selected = values("boardsTeach").filter(v => v !== "Other");
  const other = boardsOtherCheckbox && boardsOtherCheckbox.checked ? cleanText($("boardsOther").value) : "";
  if (other) selected.push(other);
  return selected.join(", ");
}

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

  /* Register as / Gender: must be explicitly chosen */
  if (!checked("registerAs")) fail("registerAsError", "Please select an option.");
  if (!checked("gender")) fail("genderError", "Please select an option.");

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
  if (selectedSubjects.length === 0) fail("subjectsError", "Add at least one subject.");
  if (values("boardsTeach").length === 0) {
    fail("boardsError", "Select at least one board.");
  } else if (boardsOtherCheckbox && boardsOtherCheckbox.checked && !cleanText($("boardsOther").value)) {
    fail("boardsError", "Please enter the board name.");
  }

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
    class12Board: class12BoardValue(),

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

    experienceYears: Number(experienceSlider.value) >= 11 ? 10 : Number(experienceSlider.value),

    classesYouTeach: classesYouTeachValue(),
    subjectsYouTeach: selectedSubjects.join(", "),
    boardsYouTeach: boardsYouTeachValue(),

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
