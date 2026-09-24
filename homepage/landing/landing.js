/* =========================================================
   HOMEPAGE LANDING  (visitors who are NOT logged in)
   File: homepage/landing/landing.js

   Loads real figures from your sheets through the Apps Script
   action "getHomeStats" (Home Stats.gs) and fills the page.
   Nothing here is hard-coded: if a figure isn't available, its
   section simply stays hidden.

   Buttons:
     I'm a student  -> student.html            (student login)
     I'm a tutor    -> tutorregistration.html  (tutor login)
========================================================= */

(function () {

  "use strict";

  const WEB_APP_URL =
    "https://script.google.com/macros/s/AKfycbwnhZnXpGVegX3kQtggtRjTej1JrsgfUdDyPrtMmuxh-IR_I8EGudmGAgLscda2y3nxLg/exec";

  const LIME = "#c8ff2e";
  const VIOLET = "#9486ff";
  const MUTED = "#8e8e99";
  const LINE = "rgba(255,255,255,.06)";
  const AVATAR_COLORS = [LIME, VIOLET, "#7fe3ff", "#ffb4d2"];

  let DATA = null;
  let subjectsChart = null;
  let tickerIndex = 0;
  let tickerTimer = null;

  const $ = id => document.getElementById(id);

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const hasChart = () => typeof window.Chart !== "undefined";

  function countTo(el, target, suffix = "", prefix = "", ms = 1500) {
    if (!el) return;
    const t0 = performance.now();
    const step = t => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = prefix + Math.round(target * e).toLocaleString("en-IN") + suffix;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function initials(name) {
    return String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2)
      .map(p => p[0].toUpperCase()).join("") || "T";
  }

  function mediumText(v) {
    return /^any$/i.test(String(v || "").trim()) ? "Online | Offline" : (v || "");
  }

  function classText(v) {
    const s = String(v || "").trim();
    return /^\d+$/.test(s) ? `Class ${s}` : s;
  }


  /* ---------------- fetch ---------------- */

  async function load() {

    try {

      const response = await fetch(`${WEB_APP_URL}?action=getHomeStats`, { method: "GET" });
      const result = JSON.parse(await response.text());

      if (!result || !result.success) throw new Error(result && result.message);

      DATA = result;
      render();

    } catch (error) {

      console.error("Homepage figures:", error);

      // No figures -> hide the number strip, keep the rest of the page.
      const kpis = $("ldKpis");
      if (kpis) kpis.classList.add("ld-hidden");

    }

  }


  /* ---------------- render ---------------- */

  function render() {

    renderKpis();
    renderTicker();
    prepareDemand();
    prepareGrowth();
    renderOpenTuitions();
    renderTutors();
    watchSections();

  }

  function renderKpis() {

    const c = DATA.counts || {};
    const d = DATA.deltas || {};

    document.querySelectorAll(".landing [data-k]").forEach(el => countTo(el, Number(c[el.dataset.k]) || 0));

    const deltaText = {
      tutors: n => n > 0 ? `+${n} this month` : "",
      students: n => n > 0 ? `+${n} this month` : "",
      tuitions: n => n > 0 ? `+${n} vs last month` : (n < 0 ? `${n} vs last month` : ""),
      demos: n => n > 0 ? `+${n} vs last week` : (n < 0 ? `${n} vs last week` : "")
    };

    document.querySelectorAll(".landing [data-d]").forEach(el => {
      const key = el.dataset.d;
      const n = Number(d[key]) || 0;
      el.textContent = deltaText[key] ? deltaText[key](n) : "";
      el.classList.toggle("ld-down", n < 0);
    });

  }

  function renderTicker() {

    const items = DATA.activity || [];

    if (!items.length) return;

    $("ldTicker").classList.remove("ld-hidden");

    const show = () => {
      const a = items[tickerIndex % items.length];
      const el = $("ldTk");
      el.classList.add("ld-out");
      setTimeout(() => {
        const bits = [a.subject, classText(a.cls)].filter(Boolean).join(" · ");
        el.innerHTML = `<b>${esc(a.stage)}</b> · ${esc(bits)}${a.city ? ` <em>· ${esc(a.city)}</em>` : ""}`;
        el.classList.remove("ld-out");
      }, 350);
      tickerIndex++;
    };

    show();

    if (items.length > 1) {
      clearInterval(tickerTimer);
      tickerTimer = setInterval(show, 3200);
    }

  }


  /* ---------------- demand ---------------- */

  function prepareDemand() {

    const demand = DATA.demand || {};
    const all = demand["All cities"] || {};

    if (!Object.keys(all).length) return;   // no requests in 30 days -> stay hidden

    $("ldDemand").classList.remove("ld-hidden");

    const cities = Object.keys(demand).filter(c => Object.keys(demand[c]).length);

    $("ldCities").innerHTML = cities.length > 1
      ? cities.map((c, i) => `<button class="ld-chip${i ? "" : " ld-on"}" data-c="${esc(c)}" type="button">${esc(c)}</button>`).join("")
      : "";

    $("ldCities").onclick = e => {
      const b = e.target.closest("[data-c]");
      if (!b) return;
      $("ldCities").querySelectorAll(".ld-chip").forEach(x => x.classList.toggle("ld-on", x === b));
      drawDemand(b.dataset.c);
    };

  }

  // Every request in that city in the last 30 days (not only the
  // subjects shown in the chart).
  function cityTotal(city) {
    const totals = DATA.demandTotals || {};
    if (totals[city] !== undefined) return Number(totals[city]) || 0;
    return Object.values((DATA.demand || {})[city] || {}).reduce((a, b) => a + b, 0);
  }

  function drawDemand(city) {

    const data = DATA.demand[city] || {};
    const labels = Object.keys(data).sort((a, b) => data[b] - data[a]);
    const values = labels.map(l => data[l]);
    const total = values.reduce((a, b) => a + b, 0);

    if (!labels.length) return;

    const top = labels[0];
    const isAll = city === "All cities";

    $("ldDemandH").innerHTML = `<em>${esc(top)}</em> leads the way${isAll ? "." : " in " + esc(city) + "."}`;

    const cityCount = cityTotal(city) || total;

    countTo($("ldTopShare"), cityCount ? Math.round(values[0] / cityCount * 100) : 0, "%", "", 900);
    $("ldTopShareTxt").textContent = `of requests are for ${top}`;

    countTo($("ldCityReq"), cityCount, "", "", 900);
    $("ldCityReqTxt").textContent = `requests${isAll ? "" : " in " + city} in the last 30 days`;

    const max = Math.max(...Object.keys(DATA.demand).map(cityTotal), 1);
    $("ldCityBar").style.width = Math.round(cityCount / max * 100) + "%";

    if (!hasChart()) return;

    const colors = labels.map((_, i) => i === 0 ? LIME : "rgba(255,255,255,.16)");

    if (subjectsChart) {
      subjectsChart.data.labels = labels;
      subjectsChart.data.datasets[0].data = values;
      subjectsChart.data.datasets[0].backgroundColor = colors;
      subjectsChart.update();
      return;
    }

    subjectsChart = new Chart($("ldSubjects"), {
      type: "bar",
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 999, borderSkipped: false, barThickness: 14 }] },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.raw} request${c.raw === 1 ? "" : "s"}` } } },
        scales: {
          x: { grid: { color: LINE }, border: { display: false }, ticks: { precision: 0, color: MUTED } },
          y: { grid: { display: false }, border: { display: false }, ticks: { color: "#e6e6ea", font: { size: 13 } } }
        },
        animation: { duration: 900 }
      }
    });

  }


  /* ---------------- growth ---------------- */

  function prepareGrowth() {

    const m = DATA.monthly || {};
    const any = (m.posted || []).some(v => v > 0) || (m.started || []).some(v => v > 0);

    if (!any) return;

    $("ldGrowth").classList.remove("ld-hidden");

    if (DATA.successRate === null || DATA.successRate === undefined) $("ldRateBox").classList.add("ld-hidden");
    if (DATA.growthPct === null || DATA.growthPct === undefined) $("ldGrowthBox").classList.add("ld-hidden");

  }

  function drawGrowth() {

    if (DATA.successRate !== null && DATA.successRate !== undefined) countTo($("ldRate"), DATA.successRate, "%");

    if (DATA.growthPct !== null && DATA.growthPct !== undefined) {
      const g = DATA.growthPct;
      countTo($("ldGrowthPct"), Math.abs(g), "%", g >= 0 ? "+" : "-");
      $("ldGrowthTxt").textContent = g >= 0
        ? "more tuitions than the 3 months before"
        : "tuitions compared with the 3 months before";
    }

    if (!hasChart()) return;

    const canvas = $("ldGrowthChart");
    const ctx = canvas.getContext("2d");
    const fill = ctx.createLinearGradient(0, 0, 0, 320);
    fill.addColorStop(0, "rgba(200,255,46,.22)");
    fill.addColorStop(1, "rgba(200,255,46,0)");

    new Chart(canvas, {
      type: "line",
      data: {
        labels: DATA.monthly.labels,
        datasets: [
          { label: "Tuitions posted", data: DATA.monthly.posted, borderColor: LIME, backgroundColor: fill, fill: true, tension: 0.42, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 },
          { label: "Classes started", data: DATA.monthly.started, borderColor: VIOLET, borderDash: [6, 6], fill: false, tension: 0.42, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: MUTED } },
          y: { beginAtZero: true, grid: { color: LINE }, border: { display: false }, ticks: { precision: 0, color: MUTED } }
        },
        animation: { duration: 1500 }
      }
    });

  }


  /* ---------------- lists ---------------- */

  function renderOpenTuitions() {

    const list = DATA.openTuitions || [];

    if (!list.length) return;

    $("ldOpen").classList.remove("ld-hidden");

    $("ldTuitions").innerHTML = list.map(t => {
      const info = [classText(t.cls), t.board, mediumText(t.medium), t.timing].filter(Boolean).join(" · ");
      const place = [t.city, t.pin].filter(Boolean).join(" ");
      return `
        <div class="ld-tu">
          <span class="ld-sj">${esc(String(t.subject || "?").slice(0, 2))}</span>
          <div><b>${esc(t.subject)}</b><span>${esc(info)}</span>${place ? `<span>${esc(place)}</span>` : ""}</div>
          <a href="tutoradvertisement.html">Apply</a>
        </div>`;
    }).join("");

  }

  function renderTutors() {

    const list = DATA.tutors || [];

    if (!list.length) return;

    $("ldTutors").classList.remove("ld-hidden");

    $("ldTutorGrid").innerHTML = list.map((t, i) => {
      const exp = String(t.experience || "").trim();
      const info = [t.degree, exp ? `${exp} yr${exp === "1" ? "" : "s"}` : ""].filter(Boolean).join(" · ");
      return `
        <div class="ld-tt">
          <div class="ld-av" style="background:${AVATAR_COLORS[i % AVATAR_COLORS.length]}">${esc(initials(t.name))}</div>
          <b>${esc(t.name)}</b>
          ${info ? `<span>${esc(info)}</span>` : ""}
          ${t.city ? `<span>${esc(t.city)}</span>` : ""}
          <span class="ld-vf"><svg class="ld-ico"><use href="#ld-check"/></svg>Verified</span>
        </div>`;
    }).join("");

  }


  /* ---------------- reveal + draw charts on scroll ---------------- */

  const drawn = new Set();
  let observer = null;

  function watchSections() {

    if (!("IntersectionObserver" in window)) {
      document.querySelectorAll(".landing .ld-reveal").forEach(el => el.classList.add("ld-show"));
      if (!$("ldDemand").classList.contains("ld-hidden")) drawDemand("All cities");
      if (!$("ldGrowth").classList.contains("ld-hidden")) drawGrowth();
      return;
    }

    if (observer) observer.disconnect();

    observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        e.target.classList.add("ld-show");
        if (e.target.id === "ldDemand" && !drawn.has("d")) { drawn.add("d"); drawDemand("All cities"); }
        if (e.target.id === "ldGrowth" && !drawn.has("g")) { drawn.add("g"); drawGrowth(); }
      });
    }, { threshold: 0.15 });

    document.querySelectorAll(".landing .ld-reveal").forEach(el => observer.observe(el));

  }


  /* ---------------- component API (index.html loader) ---------------- */

  window.LandingComponent = {
    init: function () {
      // Sections without data are hidden until the figures arrive.
      document.querySelectorAll(".landing .ld-reveal:not(.ld-hidden)").forEach(el => el.classList.add("ld-show"));
      load();
    }
  };

})();
