/* =====================================================================
   PROFILE PAGES - SHARED HELPERS
   Used by BOTH studentprofile.js and tutorprofile.js.
   (These functions used to be copied word-for-word in each file; they now
   live here once, so a fix made here applies to both profile pages.)

   Load order in the HTML:  profile-common.js  ->  studentprofile.js / tutorprofile.js
   Needs from the page:     $()  and  escapeHTML()  (defined in each page's own JS)

   What is inside:
     - Date / time text      formatDemoDateTime, paymentDateTime
     - Small value helpers   isTicked, isAny, mediumText, joinAddress
     - Verified-seal badge   verifiedBadge_, setProfileAvatarBadge_
   ===================================================================== */

// Same "verified seal" shape used on the Admin Panel's avatars,
// coloured by subscriptionTone_.
function verifiedBadge_(tone) {
  if (!tone) return "";
  const title = tone === "paid" ? "Subscription fully paid" : tone === "partial" ? "Subscription partially paid" : "Subscription not paid";
  return `
    <span class="profile-sub-badge" data-tone="${tone}" title="${escapeHTML(title)}">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/>
      </svg>
    </span>`;
}

// Adds/removes the verified badge on the profile page's big avatar.
function setProfileAvatarBadge_(tone) {
  const wrap = $("profileAvatarWrap");
  const existing = wrap.querySelector(".profile-sub-badge");
  if (existing) existing.remove();
  if (tone) wrap.insertAdjacentHTML("beforeend", verifiedBadge_(tone));
}

function joinAddress(address, city) {

  const a = String(address || "").trim();
  const c = String(city || "").trim();

  if (!a) return c;
  if (!c || a.toLowerCase().includes(c.toLowerCase())) return a;

  return `${a}, ${c}`;

}

function isTicked(value) {
  return value === true || /^(true|yes|y|1)$/i.test(String(value == null ? "" : value).trim());
}

// Same parsing as tutorprofile.js: "25 September 2026, 11:00 AM".
// The Payment Date chosen for the payment, followed by the time it was
// actually recorded (paidAt), in Indian time.
function paymentDateTime(p) {
  const day = formatDemoDateTime(p.paymentDate);
  const at = p.paidAt ? new Date(p.paidAt) : null;
  if (!day || !at || isNaN(at)) return day;
  const time = at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
  return `${day.split(",")[0]}, ${time.toUpperCase()}`;
}

function formatDemoDateTime(value) {

  if (!value) return "";

  const date = new Date(value);

  if (isNaN(date.getTime())) return "";

  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  const day = String(date.getDate()).padStart(2, "0");
  const text = `${day} ${months[date.getMonth()]} ${date.getFullYear()}`;

  const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;

  if (!hasTime) return text;

  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return `${text}, ${time}`;

}

// "Any" is shown as the two real options, anything else as chosen.
function isAny(value) {
  return /^any$/i.test(String(value == null ? "" : value).trim());
}

function mediumText(value) {
  const v = String(value == null ? "" : value).trim();
  return isAny(v) ? "Online | Home" : v.replace(/^offline$/i, "Home");
}
