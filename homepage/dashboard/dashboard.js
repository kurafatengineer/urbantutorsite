/* =========================================================
   LOGGED-IN HOMEPAGE (student / tutor)
   File: homepage/dashboard/dashboard.js

   Student: getStudentProfile  -> welcome, status numbers,
            next demo (Accept / Reject), every tuition's progress.
   Tutor:   getTutorProfile + getAvailableTuitions -> welcome,
            verification status, status numbers, next demo
            (Accept / Reject), open tuitions matching the tutor.

   Buttons:
     Apply for New Tuition -> studentprofile.html#apply
     Find Tuitions / See all open tuitions -> tutoradvertisement.html
     Apply (matching card) -> tutoradvertisement.html#<Demo ID>
                              (opens that card; nothing is applied here)
========================================================= */

(function () {

  "use strict";

  const STUDENT_KEY = "urbantutorsite_student_session";
  const TUTOR_KEY = "urbantutorsite_tutor_session";
  const SELECTED_STUDENT_KEY = "urbantutorsite_selected_student";

  const COLORS = ["#c8ff2e", "#9486ff", "#7fe3ff", "#ffb4d2", "#ffc947"];
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

  const $ = id => document.getElementById(id);

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const lower = v => String(v == null ? "" : v).trim().toLowerCase();

  function readSession(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  // Every request goes to the matching Supabase function (the same ones
  // Student Profile / Tutor Profile use). The rest of this file still
  // speaks in the old "action" names, so only this helper changed.
  async function api(payload) {

    if (typeof window.sbCall !== "function") {
      return { success: false, message: "Supabase is not loaded." };
    }

    switch (payload.action) {

      case "getStudentProfile":
        return window.sbCall("get_student_profile", {});

      case "getTutorProfile":
        return window.sbCall("get_tutor_profile", {});

      case "getAvailableTuitions":
        return window.sbCall("get_available_tuitions", {});

      case "respondToDemo":
        return window.sbCall("respond_to_demo", {
          p_demo_id: payload.demoId,
          p_tutor_id: payload.tutorId,
          p_decision: payload.decision
        });

      case "respondToDemoTutor":
        return window.sbCall("respond_to_demo_tutor", {
          p_demo_id: payload.demoId,
          p_decision: payload.decision
        });

      case "addTuition":
        return window.sbCall("add_tuition", {
          p: Object.assign({ studentId: payload.studentId }, payload.tuition)
        });

      default:
        return { success: false, message: "Unknown request: " + payload.action };

    }

  }

  function initials(name, fallback) {
    return String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2)
      .map(p => p[0].toUpperCase()).join("") || fallback;
  }

  function firstName(name) {
    return String(name || "").trim().split(/\s+/)[0] || "";
  }

  function classText(v) {
    const s = String(v || "").trim();
    return /^\d+$/.test(s) ? `Class ${s}` : s;
  }

  function mediumText(v) {
    return lower(v) === "any" ? "Online | Offline" : (v || "");
  }

  // Hide broken sheet time values (e.g. "Sat Dec 30 1899 ...").
  function timingText(v) {
    const s = String(v || "").trim();
    return /1899|GMT/.test(s) ? "" : s;
  }

  function parseDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  function timeText(d) {
    let h = d.getHours();
    const m = d.getMinutes();
    const mer = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, "0")} ${mer}`;
  }

  function show(id, on) { const el = $(id); if (el) el.classList.toggle("db-hidden", !on); }

  function doneLoading() { show("dbLoading", false); }

  function dateBlock(d) {
    return `<div class="db-date"><small>${MONTHS[d.getMonth()]}</small><b>${d.getDate()}</b><small>${DAYS[d.getDay()]}</small></div>`;
  }


  /* =======================================================
     STUDENT
     ======================================================= */

  let SDATA = null;

  function readSelected() {
    try { return localStorage.getItem(SELECTED_STUDENT_KEY) || ""; } catch (e) { return ""; }
  }

  function writeSelected(id) {
    try { localStorage.setItem(SELECTED_STUDENT_KEY, id); } catch (e) {}
  }

  // Backend status -> one of: finding | applied | demo | running | completed | closed
  function studentStage(t) {
    const s = lower(t.status);
    if (s === "completed") return "completed";
    if (s === "running") return "running";
    if (s === "demo scheduled" || s === "processing") return "demo";
    if (s === "tutors applied") return "applied";
    if (s === "terminated") return "closed";
    return "finding";
  }

  const STAGE_LABEL = {
    finding: ["Finding tutor", "rgba(200,255,46,.12)", "#c8ff2e"],
    applied: ["Tutors applied", "rgba(200,255,46,.12)", "#c8ff2e"],
    demo: ["Demo scheduled", "rgba(148,134,255,.14)", "#c3b9ff"],
    running: ["Running", "rgba(94,227,154,.12)", "#5ee39a"],
    completed: ["Completed", "rgba(255,255,255,.06)", "#8e8e99"],
    closed: ["Closed", "rgba(255,107,107,.12)", "#ff6b6b"]
  };

  async function loadStudent(session) {

    const result = await api({ action: "getStudentProfile", sessionToken: session.sessionToken });

    doneLoading();
    show("dbStudent", true);

    if (!result || !result.success) {
      $("dbSList").innerHTML = `<div class="db-empty">${esc((result && result.message) || "Please log in again.")}</div>`;
      return;
    }

    SDATA = result;
    renderStudent();

  }

  function renderStudent() {

    const students = SDATA.students || [];
    const wanted = readSelected();
    const student = students.find(s => s.studentId === wanted) || students[0];

    if (!student) {
      $("dbSName").textContent = "there.";
      $("dbSList").innerHTML = `<div class="db-empty">Add a student to post your first tuition.</div>`;
      return;
    }

    // Shows the student selected on the Student Profile page (switch
    // students there). No switch and no Student IDs here.
    $("dbSName").textContent = (firstName(student.studentName) || "there") + ".";

    if (window.UrbanSession) window.UrbanSession.rememberName("student", student.studentName);

    $("dbSChips").innerHTML = "";

    const tuitions = (student.tuitions || []).slice()
      .sort((a, b) => (Number(b.timestampMs) || 0) - (Number(a.timestampMs) || 0));

    // numbers
    const count = stages => tuitions.filter(t => stages.includes(studentStage(t))).length;
    $("dbS1").textContent = count(["finding", "applied"]);
    $("dbS2").textContent = count(["demo"]);
    $("dbS3").textContent = count(["running"]);
    $("dbS4").textContent = count(["completed"]);

    // up next: the soonest demo that is still ahead (or just started)
    const soon = Date.now() - 60 * 60 * 1000;
    let next = null;

    tuitions.forEach(t => (t.tutors || []).forEach(tu => {
      const st = lower(tu.status);
      if (st !== "demo scheduled" && st !== "processing") return;
      const d = parseDate(tu.demoDate);
      if (!d || d.getTime() < soon) return;
      if (!next || d < next.date) next = { date: d, tuition: t, tutor: tu };
    }));

    show("dbSNextSec", !!next);
    $("dbSListNum").textContent = (next ? "02" : "01") + " · YOUR TUITIONS";

    if (next) {
      const t = next.tuition, tu = next.tutor;
      const exp = parseFloat(tu.experience);
      const bits = [
        timeText(next.date),
        mediumText(t.medium),
        tu.degree,
        isNaN(exp) ? "" : `${exp} ${exp === 1 ? "Year" : "Years"} of Teaching Experience`
      ].filter(Boolean).join(" · ");
      $("dbSNext").innerHTML = `
        <div class="db-next">
          ${dateBlock(next.date)}
          <div><h3>${esc(t.subject)}${tu.fullName ? ` with ${esc(tu.fullName)}` : ""}</h3><p>${esc(bits)}</p></div>
          <div class="db-acts">
            <button class="db-sbtn p" type="button" data-s-respond="accept" data-demo="${esc(t.demoId)}" data-tutor="${esc(tu.tutorId)}"${tu.canAccept ? "" : " disabled"}>Accept</button>
            <button class="db-sbtn r" type="button" data-s-respond="reject" data-demo="${esc(t.demoId)}" data-tutor="${esc(tu.tutorId)}"${tu.canReject ? "" : " disabled"}>Reject</button>
          </div>
        </div>`;
    }

    // every tuition with its progress
    const visible = tuitions.filter(t => studentStage(t) !== "closed");

    $("dbSList").innerHTML = visible.length ? visible.map(t => {

      const stage = studentStage(t);
      const [label, bg, fg] = STAGE_LABEL[stage];
      const step = { finding: 0, applied: 1, demo: 2, running: 3, completed: 4 }[stage];
      const bars = [0, 1, 2, 3].map(i => `<i class="db-st${i < step || stage === "completed" || (stage === "running" && i === 3) ? " done" : (i === step ? " now" : "")}"></i>`).join("");
      const names = ["Posted", "Tutors applied", "Demo", "Running"];
      const labels = names.map((n, i) => `<span${i === Math.min(step, 3) ? ' class="a"' : ""}>${n}</span>`).join("");

      const live = (t.tutors || []).filter(tu => lower(tu.status) !== "declined");
      const mine = live.find(tu => ["running", "completed"].includes(lower(tu.status)));

      let foot;
      if (mine) {
        foot = `<div class="db-faces"><i style="background:${COLORS[0]}">${esc(initials(mine.fullName, "T"))}</i></div><span>Your tutor: ${esc(mine.fullName)}</span>`;
      } else if (live.length) {
        foot = `<div class="db-faces">${live.slice(0, 4).map((tu, i) => `<i style="background:${COLORS[i % COLORS.length]}">${esc(initials(tu.fullName, "T"))}</i>`).join("")}</div>
                <span>${live.length} tutor${live.length === 1 ? "" : "s"} applied</span>`;
      } else {
        foot = `<span>We're matching tutors near you</span>`;
      }

      return `
        <a class="db-tc" href="studentprofile.html#tuition-${encodeURIComponent(t.demoId)}">
          <div class="db-tc-top"><div><b>${esc(t.subject)}</b> <span>· ${esc(mediumText(t.medium))}</span></div><span class="db-state" style="background:${bg};color:${fg}">${label}</span></div>
          <div class="db-steps">${bars}</div>
          <div class="db-steps-l">${labels}</div>
          <div class="db-tc-foot">${foot}</div>
        </a>`;

    }).join("") : `<div class="db-empty">No tuitions yet. Tap <b>Apply for New Tuition</b> to post one.</div>`;

  }

  async function studentRespond(button) {

    const decision = button.dataset.sRespond;

    if (!window.confirm(decision === "accept" ? "Accept this tutor for the tuition?" : "Reject this tutor?")) return;

    const session = readSession(STUDENT_KEY);
    const buttons = button.parentElement.querySelectorAll("button");
    buttons.forEach(b => { b.disabled = true; });

    try {
      const result = await api({
        action: "respondToDemo",
        sessionToken: session && session.sessionToken,
        demoId: button.dataset.demo,
        tutorId: button.dataset.tutor,
        decision
      });
      if (!result.success) window.alert(result.message || "Your response could not be saved.");
      await loadStudent(session);
    } catch (error) {
      window.alert("Unable to connect to the server. Please try again.");
      buttons.forEach(b => { b.disabled = false; });
    }

  }




  /* =======================================================
     APPLY FOR NEW TUITION  (right here on the dashboard -
     the same form and rules as on the Student Profile)
     ======================================================= */

  const TIMINGS = ["8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM",
    "3 PM", "4 PM", "5 PM", "6 PM", "7 PM", "8 PM", "9 PM"];

  let applyStudentId = "";
  let applyWired = false;

  function radioValue(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : "";
  }

  function setOther(show) {
    show ? $("dbOtherWrap").classList.remove("db-hidden") : $("dbOtherWrap").classList.add("db-hidden");
    if (!show) $("dbOtherTiming").value = "";
    else setTimeout(() => $("dbOtherTiming").focus(), 30);
  }

  // Same as Student Profile's "Apply For New Tuition": "Name · SID"
  // under the title; with more than one student it is a small lime
  // button that opens a list to pick the student.
  function renderApplyStudents() {
    const students = (SDATA && SDATA.students) || [];
    const current = students.find(s => s.studentId === applyStudentId) || students[0];
    const many = students.length > 1;
    if (!current) { $("dbApplyStudents").innerHTML = ""; return; }
    $("dbApplyStudents").innerHTML = `
      <div class="db-sid-switch">
        <button class="db-sid-button${many ? " is-switchable" : ""}" id="dbApplyFor" type="button"
                aria-haspopup="listbox" aria-expanded="false"${many ? "" : " disabled"}>${esc(current.studentName || "Student")} · ${esc(current.studentId)}</button>
        <div class="db-sid-menu db-hidden" id="dbApplyMenu" role="listbox" aria-label="Choose student">
          ${students.map(s => `
            <button class="db-sid-option${s.studentId === current.studentId ? " active" : ""}" type="button" role="option"
                    data-apply-sid="${esc(s.studentId)}" aria-selected="${s.studentId === current.studentId ? "true" : "false"}">
              <span class="db-sid-option-id">${esc(s.studentId)}</span>
              <span class="db-sid-option-name">${esc(s.studentName || "Student")}</span>
            </button>`).join("")}
        </div>
      </div>`;
  }

  function closeApplyMenu() {
    const menu = $("dbApplyMenu");
    if (!menu) return;
    menu.classList.add("db-hidden");
    $("dbApplyFor").setAttribute("aria-expanded", "false");
  }

  function wireApply() {

    if (applyWired) return;
    applyWired = true;

    $("dbTimings").innerHTML = TIMINGS.map(t =>
      `<label><input type="checkbox" name="dbTiming" value="${t}"><span>${t}</span></label>`).join("") +
      `<label><input type="checkbox" id="dbTimingOther" value="Other"><span>Other</span></label>`;

    // "Other" and the fixed times exclude each other
    $("dbTimings").addEventListener("change", e => {
      const box = e.target;
      if (box.id === "dbTimingOther") {
        if (box.checked) document.querySelectorAll('input[name="dbTiming"]').forEach(t => { t.checked = false; });
        setOther(box.checked);
      } else if (box.name === "dbTiming" && box.checked) {
        $("dbTimingOther").checked = false;
        setOther(false);
      }
      $("dbApplyMsg").textContent = "";
    });

    $("dbApplyModal").addEventListener("click", e => {
      if (e.target.closest("[data-db-close]")) { closeApply(); return; }
      const pick = e.target.closest("[data-apply-sid]");
      if (pick) { applyStudentId = pick.dataset.applySid; renderApplyStudents(); return; }
      const toggle = e.target.closest("#dbApplyFor");
      if (toggle && !toggle.disabled) {
        const opening = $("dbApplyMenu").classList.contains("db-hidden");
        $("dbApplyMenu").classList.toggle("db-hidden", !opening);
        toggle.setAttribute("aria-expanded", opening ? "true" : "false");
        return;
      }
      if (!e.target.closest(".db-sid-switch")) closeApplyMenu();
    });

    document.addEventListener("keydown", e => {
      if (e.key !== "Escape" || $("dbApplyModal").classList.contains("db-hidden")) return;
      if ($("dbApplyMenu") && !$("dbApplyMenu").classList.contains("db-hidden")) { closeApplyMenu(); $("dbApplyFor").focus(); return; }
      closeApply();
    });

    $("dbApplyForm").addEventListener("submit", submitApply);

    $("dbApplyForm").addEventListener("input", e => {
      const f = e.target.closest(".db-float");
      if (f) f.classList.remove("has-error");
    });

  }

  function openApply() {

    wireApply();

    const students = (SDATA && SDATA.students) || [];
    const wanted = readSelected();
    const current = students.find(s => s.studentId === wanted) || students[0];

    if (!current) {
      window.location.href = "studentprofile.html";
      return;
    }

    applyStudentId = current.studentId;

    $("dbApplyForm").reset();
    $("dbApplyMsg").textContent = "";
    document.querySelectorAll("#dbApplyForm .has-error").forEach(el => el.classList.remove("has-error"));
    setOther(false);
    renderApplyStudents();

    $("dbApplyModal").classList.remove("db-hidden");
    $("dbApplyModal").setAttribute("aria-hidden", "false");
    document.body.classList.add("add-modal-open");

    setTimeout(() => $("dbSubjects").focus(), 50);

  }

  function closeApply() {
    $("dbApplyModal").classList.add("db-hidden");
    $("dbApplyModal").setAttribute("aria-hidden", "true");
    document.body.classList.remove("add-modal-open");
  }

  // "17:30" style entries stay as typed; nothing else is changed.
  async function submitApply(event) {

    event.preventDefault();

    const msg = $("dbApplyMsg");
    msg.textContent = "";

    const subjects = String($("dbSubjects").value || "").replace(/\s+/g, " ").trim();
    const other = $("dbTimingOther").checked;
    const timing = other
      ? String($("dbOtherTiming").value || "").trim()
      : Array.from(document.querySelectorAll('input[name="dbTiming"]:checked')).map(i => i.value).join(", ");

    if (subjects.length < 2) {
      $("dbSubjects").closest(".db-float").classList.add("has-error");
      $("dbSubjects").focus();
      return;
    }

    if (!timing) {
      if (other) {
        $("dbOtherWrap").classList.add("has-error");
        $("dbOtherTiming").focus();
      } else {
        msg.textContent = "Select at least one preferred timing.";
      }
      return;
    }

    const session = readSession(STUDENT_KEY);
    const button = $("dbApplySubmit");
    button.disabled = true;
    button.textContent = "Posting...";

    try {

      const result = await api({
        action: "addTuition",
        sessionToken: session && session.sessionToken,
        studentId: applyStudentId,
        tuition: {
          subjects,
          preferredTutor: radioValue("dbTutor") || "Any",
          medium: radioValue("dbMedium") || "Any",
          preferredTiming: timing
        }
      });

      if (!result.success) {
        msg.textContent = result.message || "The tuition could not be added.";
        return;
      }

      closeApply();
      writeSelected(applyStudentId);
      await loadStudent(session);

    } catch (error) {
      msg.textContent = "Unable to connect to the server. Please try again.";
    } finally {
      button.disabled = false;
      button.textContent = "Post Tuition Request";
    }

  }

  /* =======================================================
     TUTOR
     ======================================================= */

  function tutorStage(c) {
    const s = lower(c.status);
    if (s === "applied") return "applied";
    if (s === "demo scheduled" || s === "processing") return "demo";
    if (s === "running") return "running";
    if (s === "completed") return "completed";
    return "other";
  }

  function splitList(v) {
    return String(v || "").split(",").map(x => lower(x)).filter(Boolean);
  }

  async function loadTutor(session) {

    const [profileResult, adsResult] = await Promise.all([
      api({ action: "getTutorProfile", sessionToken: session.sessionToken }),
      api({ action: "getAvailableTuitions", sessionToken: session.sessionToken }).catch(() => null)
    ]);

    doneLoading();
    show("dbTutor", true);

    if (!profileResult || !profileResult.success) {
      $("dbTMatch").innerHTML = `<div class="db-empty">${esc((profileResult && profileResult.message) || "Please log in again.")}</div>`;
      return;
    }

    const profile = profileResult.profile || {};
    const classes = profileResult.classes || [];

    $("dbTName").textContent = (firstName(profile.fullName) || "there") + ".";

    if (window.UrbanSession) window.UrbanSession.rememberName("tutor", profile.fullName);

    // verification
    const vs = lower(profile.verificationStatus);
    const verified = vs === "verified";
    const id = profile.tutorId ? ` · ${esc(profile.tutorId)}` : "";

    $("dbTStatus").innerHTML = verified
      ? `<span class="db-pill ok"><svg><use href="#db-verified"/></svg>Verified tutor${id}</span>`
      : vs === "rejected"
        ? `<span class="db-pill no">Verification rejected${id}</span>`
        : `<span class="db-pill wait">Verification pending${id}</span>`;

    if (!verified) {
      $("dbTLead").textContent = vs === "rejected"
        ? "Your profile verification was rejected. Please contact us to update your details."
        : "Your profile is being verified. You can apply for tuitions once it is verified.";
    }

    // numbers
    const count = stage => classes.filter(c => tutorStage(c) === stage).length;
    $("dbT1").textContent = count("applied");
    $("dbT2").textContent = count("demo");
    $("dbT3").textContent = count("running");
    $("dbT4").textContent = count("completed");

    // up next
    const soon = Date.now() - 60 * 60 * 1000;
    let next = null;

    classes.forEach(c => {
      if (tutorStage(c) !== "demo") return;
      const d = parseDate(c.demoDate);
      if (!d || d.getTime() < soon) return;
      if (!next || d < next.date) next = { date: d, item: c };
    });

    show("dbTNextSec", !!next);
    $("dbTMatchNum").textContent = (next ? "02" : "01") + " · MATCHING YOU";

    if (next) {
      const c = next.item;
      const place = [c.address, c.city, c.pinCode].filter(Boolean).join(", ");
      const bits = [timeText(next.date), mediumText(c.medium), place].filter(Boolean).join(" · ");
      $("dbTNext").innerHTML = `
        <div class="db-next">
          ${dateBlock(next.date)}
          <div><h3>${esc([c.subject, classText(c.className), c.board].filter(Boolean).join(" · "))}</h3><p>${esc(bits)}</p></div>
          <div class="db-acts">
            <button class="db-sbtn p" type="button" data-t-respond="accept" data-demo="${esc(c.demoId)}"${c.canAccept ? "" : " disabled"}>Accept</button>
            <button class="db-sbtn r" type="button" data-t-respond="reject" data-demo="${esc(c.demoId)}"${c.canReject ? "" : " disabled"}>Reject</button>
          </div>
        </div>`;
    }

    // matching open tuitions
    const subjects = splitList(profile.subjectsTeach);
    const places = [lower(profile.city), lower(profile.location)].filter(Boolean);
    const applied = new Set(((adsResult && adsResult.appliedDemoIds) || []).map(String));

    const matches = ((adsResult && adsResult.tuitions) || [])
      .filter(t => !applied.has(String(t.demoId)) && !t.applied)
      .map(t => {
        const subj = lower(t.subject);
        const subjectHit = subjects.find(s => s && (s === subj || s.includes(subj) || subj.includes(s)));
        const cityHit = places.some(p => p && (p === lower(t.city) || lower(t.city).includes(p) || p.includes(lower(t.city))));
        return { t, subjectHit, cityHit };
      })
      .filter(m => m.subjectHit)
      .sort((a, b) => (b.cityHit - a.cityHit) ||
        (new Date(b.t.postedOn || 0) - new Date(a.t.postedOn || 0)))
      .slice(0, 3);

    $("dbTMatch").innerHTML = matches.length ? matches.map(({ t, cityHit }) => {
      const info = [t.board, mediumText(t.medium), timingText(t.preferredTiming), [t.city, t.pinCode].filter(Boolean).join(" ")]
        .filter(Boolean).join(" · ");
      return `
        <div class="db-tu">
          <span class="db-sj">${esc(String(t.subject || "?").slice(0, 2).toUpperCase())}</span>
          <div>
            <b>${esc(t.subject)} · ${esc(classText(t.className))}</b>
            <span>${esc(info)}</span>
            <span class="db-fit">Matches: ${esc(t.subject)}${cityHit ? " · near you" : ""}</span>
          </div>
          <a class="db-sbtn p" href="tutoradvertisement.html#${encodeURIComponent(t.demoId)}">Apply</a>
        </div>`;
    }).join("") : `<div class="db-empty">No open tuitions match your subjects right now.</div>`;

  }

  async function tutorRespond(button) {

    const decision = button.dataset.tRespond;

    if (!window.confirm(decision === "accept" ? "Accept this tuition?" : "Reject this tuition?")) return;

    const session = readSession(TUTOR_KEY);
    const buttons = button.parentElement.querySelectorAll("button");
    buttons.forEach(b => { b.disabled = true; });

    try {
      const result = await api({
        action: "respondToDemoTutor",
        sessionToken: session && session.sessionToken,
        demoId: button.dataset.demo,
        decision
      });
      if (!result.success) window.alert(result.message || "Your response could not be saved.");
      await loadTutor(session);
    } catch (error) {
      window.alert("Unable to connect to the server. Please try again.");
      buttons.forEach(b => { b.disabled = false; });
    }

  }


  /* =======================================================
     START (called by index.html's loader)
     ======================================================= */

  window.DashboardComponent = {

    init: function () {

      const role = window.UrbanSession ? window.UrbanSession.role() : "";
      const root = document.querySelector(".dash");

      if (!root || !role) return;

      root.addEventListener("click", event => {

        if (event.target.closest("#dbApplyBtn")) { openApply(); return; }

        const chip = event.target.closest("[data-sid]");
        if (chip) {
          writeSelected(chip.dataset.sid);
          renderStudent();
          return;
        }

        const s = event.target.closest("[data-s-respond]");
        if (s && !s.disabled) { studentRespond(s); return; }

        const t = event.target.closest("[data-t-respond]");
        if (t && !t.disabled) { tutorRespond(t); }

      });

      const session = readSession(role === "tutor" ? TUTOR_KEY : STUDENT_KEY);

      if (!session || !session.sessionToken) return;

      (role === "tutor" ? loadTutor(session) : loadStudent(session)).catch(error => {
        console.error("Dashboard:", error);
        doneLoading();
        show(role === "tutor" ? "dbTutor" : "dbStudent", true);
      });

    }

  };

})();
