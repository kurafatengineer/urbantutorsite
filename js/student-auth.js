"use strict";

/************************************************************
 * STUDENT AUTH (shared)
 *
 * Add to index.html (and any other page), just before </body>:
 *   <script src="js/student-auth.js"></script>
 *
 * - Keeps the student logged in (session saved in localStorage
 *   by student.js, valid 30 days on the server).
 * - Shows a Profile button + Logout in the header.
 * - Hides "Login / Register" links to student.html while logged in.
 ************************************************************/

(function () {

  const API_URL =
    "https://script.google.com/macros/s/AKfycbyQ2ZkRBjB8zvJ8w_JvhUl6MZQlpkeLwAJ98DTH16ry9dbmBp4PR-eo7uPOuJlWhCfu/exec";

  const SESSION_KEY =
    "urbantutorsite_student_session";


  /* ---------- session ---------- */

  function getSession() {

    try {

      const raw = localStorage.getItem(SESSION_KEY);

      const session = raw ? JSON.parse(raw) : null;

      return session && session.sessionToken ? session : null;

    } catch (error) {

      localStorage.removeItem(SESSION_KEY);

      return null;

    }

  }

  function saveSession(session) {

    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (error) { /* ignore */ }

  }

  function clearSession() {

    localStorage.removeItem(SESSION_KEY);

  }


  /* ---------- api ---------- */

  async function api(payload) {

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    return JSON.parse(await response.text());

  }


  /* ---------- helpers ---------- */

  function esc(value) {

    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  }

  function firstName(profile) {

    if (!profile) return "Profile";

    return profile.firstName ||
      String(profile.name || "").split(" ")[0] ||
      "Profile";

  }


  /* ---------- styles ---------- */

  function injectStyles() {

    if (document.getElementById("utAuthStyles")) return;

    const style = document.createElement("style");

    style.id = "utAuthStyles";

    style.textContent = `
      .ut-auth{display:inline-flex;align-items:center;gap:8px;margin-left:12px;flex-wrap:nowrap}
      .ut-auth.ut-floating{position:fixed;top:12px;right:12px;z-index:9998;background:#fff;padding:6px 10px;border-radius:999px;box-shadow:0 4px 18px rgba(0,0,0,.18)}
      .ut-auth button{font:inherit;font-size:14px;font-weight:600;cursor:pointer;border-radius:999px;padding:8px 14px;border:1px solid #0f6b4f;line-height:1}
      .ut-auth .ut-profile{background:#0f6b4f;color:#fff}
      .ut-auth .ut-logout{background:transparent;color:#0f6b4f}
      .ut-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px}
      .ut-modal[hidden]{display:none}
      .ut-overlay{position:absolute;inset:0;background:rgba(0,0,0,.55)}
      .ut-box{position:relative;background:#fff;color:#1a1a1a;width:100%;max-width:520px;max-height:88vh;overflow:auto;border-radius:16px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
      .ut-box h2{margin:0 0 4px;font-size:22px}
      .ut-kicker{font-size:12px;letter-spacing:.12em;color:#0f6b4f;font-weight:700}
      .ut-close{position:absolute;top:10px;right:14px;border:0;background:none;font-size:28px;cursor:pointer;line-height:1}
      .ut-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0}
      .ut-item{background:#f4f6f5;border-radius:10px;padding:10px 12px}
      .ut-item.full{grid-column:1/-1}
      .ut-item span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#667}
      .ut-item strong{display:block;font-size:14px;word-break:break-word}
      .ut-box .ut-signout{width:100%;padding:12px;border-radius:10px;border:0;background:#c0392b;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
      @media (max-width:480px){.ut-grid{grid-template-columns:1fr}.ut-auth button{padding:7px 11px;font-size:13px}}
    `;

    document.head.appendChild(style);

  }


  /* ---------- modal ---------- */

  function buildModal() {

    if (document.getElementById("utProfileModal")) return;

    const modal = document.createElement("div");

    modal.id = "utProfileModal";
    modal.className = "ut-modal";
    modal.hidden = true;

    modal.innerHTML = `
      <div class="ut-overlay" data-ut-close></div>
      <section class="ut-box" role="dialog" aria-modal="true" aria-labelledby="utProfileTitle">
        <button class="ut-close" type="button" aria-label="Close" data-ut-close>&times;</button>
        <div class="ut-kicker">STUDENT PROFILE</div>
        <h2 id="utProfileTitle">Your account</h2>
        <div id="utProfileContent" class="ut-grid"></div>
        <button id="utModalLogout" class="ut-signout" type="button">Logout</button>
      </section>`;

    modal.addEventListener("click", function (event) {
      if (event.target.hasAttribute("data-ut-close")) {
        modal.hidden = true;
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") modal.hidden = true;
    });

    document.body.appendChild(modal);

    document
      .getElementById("utModalLogout")
      .addEventListener("click", logout);

  }

  function renderProfile(profile) {

    const fields = [
      ["Name", profile.name],
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

    document.getElementById("utProfileContent").innerHTML = fields
      .filter(function (f) {
        return f[1] !== undefined && f[1] !== null && String(f[1]).trim() !== "";
      })
      .map(function (f) {
        return '<div class="ut-item' + (f[2] ? " full" : "") + '"><span>' +
          esc(f[0]) + "</span><strong>" + esc(f[1]) + "</strong></div>";
      })
      .join("");

  }

  async function openProfile() {

    const session = getSession();

    if (!session) return;

    buildModal();

    /* Show cached data instantly, then refresh from the server. */

    if (session.profile) renderProfile(session.profile);

    document.getElementById("utProfileModal").hidden = false;

    try {

      const result = await api({
        action: "getStudentProfile",
        sessionToken: session.sessionToken
      });

      if (result.success) {

        session.profile = result.profile;
        saveSession(session);
        renderProfile(result.profile);

      } else {

        clearSession();
        window.location.reload();

      }

    } catch (error) {

      console.error(error);   /* offline: keep cached profile */

    }

  }


  /* ---------- logout ---------- */

  async function logout() {

    const session = getSession();

    if (session) {

      try {
        await api({
          action: "logoutStudent",
          sessionToken: session.sessionToken
        });
      } catch (error) {
        console.error(error);
      }

    }

    clearSession();

    window.location.href = "index.html";

  }


  /* ---------- header widget ---------- */

  function findHeader() {

    return document.querySelector("header nav") ||
           document.querySelector("header") ||
           document.querySelector(".header");

  }

  function mountWidget(session) {

    if (document.getElementById("utAuth")) return true;

    const wrap = document.createElement("div");

    wrap.id = "utAuth";
    wrap.className = "ut-auth";

    wrap.innerHTML =
      '<button type="button" class="ut-profile" id="utProfileButton">' +
      esc(firstName(session.profile)) + "</button>" +
      '<button type="button" class="ut-logout" id="utLogoutButton">Logout</button>';

    const header = findHeader();

    if (header) {
      header.appendChild(wrap);
    } else {
      wrap.classList.add("ut-floating");
      document.body.appendChild(wrap);
    }

    document
      .getElementById("utProfileButton")
      .addEventListener("click", openProfile);

    document
      .getElementById("utLogoutButton")
      .addEventListener("click", logout);

    return true;

  }

  function hideLoginLinks() {

    document
      .querySelectorAll('a[href$="student.html"]')
      .forEach(function (link) {
        if (link.closest("header, nav, .header")) {
          link.style.display = "none";
        }
      });

  }


  /* ---------- init ---------- */

  function init() {

    const session = getSession();

    if (!session) return;   /* not logged in: page unchanged */

    injectStyles();

    /* header.js may draw the header a moment later: retry briefly. */

    let tries = 0;

    (function attempt() {

      if (findHeader() || tries >= 20) {

        mountWidget(session);
        hideLoginLinks();

        return;

      }

      tries++;

      setTimeout(attempt, 150);

    })();

    /* Quietly confirm the session is still valid on the server. */

    api({
      action: "getStudentProfile",
      sessionToken: session.sessionToken
    })
      .then(function (result) {

        if (result.success) {

          session.profile = result.profile;
          saveSession(session);

          const button = document.getElementById("utProfileButton");

          if (button) button.textContent = firstName(result.profile);

        } else {

          /* Expired / removed on the server. */

          clearSession();
          window.location.reload();

        }

      })
      .catch(function (error) {

        console.error(error);   /* network problem: stay logged in */

      });

  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
