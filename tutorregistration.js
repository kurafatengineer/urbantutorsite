const API_URL = "https://script.google.com/macros/s/AKfycbwnhZnXpGVegX3kQtggtRjTej1JrsgfUdDyPrtMmux-IR_I8EGudmGAgLscda2y3nxLg/exec";

const $ = id => document.getElementById(id);
const values = name => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(x => x.value);
const radio = name => document.querySelector(`input[name="${name}"]:checked`)?.value || "";

function setError(id, message="") { const el = $(id); if (el) el.textContent = message; }
function setMessage(message, type="") { const el = $("formMessage"); el.textContent = message; el.className = `message ${type}`; }
function setLoading(on) { $("registerButton").disabled = on; $("registerText").classList.toggle("hidden", on); $("registerLoader").classList.toggle("hidden", !on); }

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name:file.name, mimeType:file.type || "application/octet-stream", data:String(reader.result).split(",")[1] });
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function validPhone(v) { return /^\d{10}$/.test(v); }
function validPin(v) { return /^\d{6}$/.test(v); }

function collectData(identityFile, profileFile) {
  return {
    action: "tutorregistration",
    email: $("email").value.trim().toLowerCase(),
    mobile: $("mobile").value.replace(/\D/g, ""),
    whatsapp: $("whatsapp").value.replace(/\D/g, ""),
    registerAs: radio("registerAs"),
    firstName: $("firstName").value.trim(),
    lastName: $("lastName").value.trim(),
    birthDate: $("birthDate").value,
    gender: radio("gender"),
    languages: values("languages"),
    identityProof: identityFile,
    profileImage: profileFile,
    class12Stream: radio("class12Stream"),
    class12PassingYear: $("class12PassingYear").value,
    class12Grade: $("class12Grade").value.trim(),
    class12Board: radio("class12Board"),
    graduationCourse: $("graduationCourse").value.trim(),
    graduationSubject: $("graduationSubject").value.trim(),
    graduationCollege: $("graduationCollege").value.trim(),
    graduationPassingYear: $("graduationPassingYear").value,
    graduationPercentage: $("graduationPercentage").value,
    postGraduationSubject: $("postGraduationSubject").value.trim(),
    postGraduationCollege: $("postGraduationCollege").value.trim(),
    postGraduationPassingYear: $("postGraduationPassingYear").value,
    postGraduationPercentage: $("postGraduationPercentage").value,
    specialCourses: values("specialCourses"),
    disabilities: values("disabilities"),
    experience: $("experience").value,
    classesTeach: values("classesTeach"),
    subjectsTeach: values("subjectsTeach"),
    boardsTeach: values("boardsTeach"),
    teachingArea: $("teachingArea").value,
    presentAddress: $("presentAddress").value.trim(),
    pinCode: $("pinCode").value.replace(/\D/g, ""),
    termsAccepted: $("terms").checked
  };
}

function validateBasic() {
  let ok = true;
  const email = $("email").value.trim();
  const mobile = $("mobile").value.replace(/\D/g, "");
  const whatsapp = $("whatsapp").value.replace(/\D/g, "");
  const languages = values("languages");
  const classes = values("classesTeach");
  const subjects = values("subjectsTeach");
  const boards = values("boardsTeach");
  const identity = $("identityProof").files[0];
  const profile = $("profileImage").files[0];

  setError("emailError", validEmail(email) ? "" : "Please enter a valid email address.");
  setError("mobileError", validPhone(mobile) ? "" : "Please enter a valid 10-digit mobile number.");
  setError("whatsappError", validPhone(whatsapp) ? "" : "Please enter a valid 10-digit WhatsApp number.");
  setError("languagesError", languages.length ? "" : "Select at least one language.");
  setError("identityProofError", identity ? "" : "Identity proof is required.");
  setError("profileImageError", profile ? "" : "Profile image is required.");
  setError("classesTeachError", classes.length ? "" : "Select at least one class range.");
  setError("subjectsTeachError", subjects.length ? "" : "Select at least one subject.");
  setError("boardsTeachError", boards.length ? "" : "Select at least one board.");
  setError("teachingAreaError", $("teachingArea").value ? "" : "Select a teaching city.");
  setError("pinError", validPin($("pinCode").value.replace(/\D/g, "")) ? "" : "Please enter a valid 6-digit PIN code.");
  setError("termsError", $("terms").checked ? "" : "Please accept the terms and conditions.");

  const requiredText = [["firstName","First name"],["lastName","Last name"],["birthDate","Birth date"],["presentAddress","Present address"]];
  requiredText.forEach(([id,label]) => { const e = $(id); e.setCustomValidity(e.value.trim() ? "" : `${label} is required.`); });

  if (!validEmail(email) || !validPhone(mobile) || !validPhone(whatsapp) || !languages.length || !identity || !profile || !classes.length || !subjects.length || !boards.length || !$("teachingArea").value || !validPin($("pinCode").value.replace(/\D/g, "")) || !$("terms").checked) ok = false;
  if (!["firstName","lastName","birthDate","presentAddress"].every(id => $(id).value.trim())) ok = false;
  if (!radio("class12Stream") || !radio("class12Board")) ok = false;
  return ok;
}

function validateFiles() {
  const identity = $("identityProof").files[0], profile = $("profileImage").files[0];
  const max = 5 * 1024 * 1024;
  let ok = true;
  if (identity && identity.size > max) { setError("identityProofError", "Identity proof must be 5 MB or smaller."); ok=false; }
  if (profile && profile.size > max) { setError("profileImageError", "Profile image must be 5 MB or smaller."); ok=false; }
  if (identity && !/(pdf|jpeg|jpg|png)$/i.test(identity.name)) { setError("identityProofError", "Use PDF, JPG or PNG."); ok=false; }
  if (profile && !/^image\//i.test(profile.type)) { setError("profileImageError", "Please upload an image file."); ok=false; }
  return ok;
}

$("sameAsMobile").addEventListener("change", e => { if (e.target.checked) { $("whatsapp").value = $("mobile").value; $("whatsapp").dispatchEvent(new Event("input")); } });
$("mobile").addEventListener("input", () => { if ($("sameAsMobile").checked) $("whatsapp").value = $("mobile").value; });
$("identityProof").addEventListener("change", e => { $("identityName").textContent = e.target.files[0]?.name || "PDF, JPG or PNG"; });
$("profileImage").addEventListener("change", e => { $("profileName").textContent = e.target.files[0]?.name || "JPG, JPEG or PNG"; });

$("termsButton").addEventListener("click", () => $("termsModal").classList.remove("hidden"));
$("closeTerms").addEventListener("click", () => $("termsModal").classList.add("hidden"));
$("acceptTerms").addEventListener("click", () => { $("terms").checked = true; $("termsModal").classList.add("hidden"); });
$("termsModal").querySelector(".modal-overlay").addEventListener("click", () => $("termsModal").classList.add("hidden"));

$("tutorRegistrationForm").addEventListener("submit", async e => {
  e.preventDefault();
  setMessage("");
  if (!validateBasic() || !validateFiles()) { setMessage("Please complete the highlighted fields.", "error"); return; }

  const identityFile = await fileToBase64($("identityProof").files[0]);
  const profileFile = await fileToBase64($("profileImage").files[0]);
  const payload = collectData(identityFile, profileFile);
  setLoading(true); setMessage("Uploading documents and saving your tutor profile...", "success");

  try {
    const response = await fetch(API_URL, { method:"POST", headers:{"Content-Type":"text/plain;charset=utf-8"}, body:JSON.stringify(payload) });
    const result = await response.json();
    if (!result.success) throw new Error(result.message || "Registration failed.");
    $("successTutorId").textContent = result.tutorId || "Submitted";
    document.querySelector("main.page").classList.add("hidden");
    $("successPage").classList.remove("hidden");
    window.scrollTo({top:0,behavior:"smooth"});
  } catch (error) {
    setMessage(error.message || "Unable to submit registration.", "error");
  } finally { setLoading(false); }
});
