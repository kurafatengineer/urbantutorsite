/* =======================================================
   TUTOR IDENTITY AREA
   ======================================================= */

const overlay =
  document.createElement("div");

overlay.className =
  "tutor-card-overlay";



/* =======================================================
   NAME ROW
   =======================================================

   Structure:

       Rahul Kumar  ✓

   The verification mark is now beside the name,
   similar to verified profiles on social platforms.
   ======================================================= */

const nameRow =
  document.createElement("div");

nameRow.className =
  "tutor-name-row";



/* =======================================================
   TUTOR NAME
   ======================================================= */

const name =
  document.createElement("div");

name.className =
  "tutor-title";

name.textContent =
  getTutorName(tutor);



/* =======================================================
   VERIFIED ACCOUNT BADGE
   ======================================================= */

const badge =
  document.createElement("span");

badge.className =
  "verified-badge";

/*
 * Only the verification check is displayed.
 *
 * The word "APPROVED" has intentionally been removed.
 */
badge.textContent =
  "✓";

badge.setAttribute(
  "aria-label",
  "Verified tutor"
);

badge.setAttribute(
  "title",
  "Verified tutor"
);



/* =======================================================
   ADD NAME + VERIFIED BADGE
   ======================================================= */

nameRow.appendChild(
  name
);

nameRow.appendChild(
  badge
);



/* =======================================================
   TUTOR ROLE
   ======================================================= */

const role =
  document.createElement("div");

role.className =
  "tutor-role";

role.textContent =
  cleanValue(
    tutor.registerAs
  ) ||
  "Tutor";



/* =======================================================
   ADD IDENTITY TO CARD
   ======================================================= */

overlay.appendChild(
  nameRow
);

overlay.appendChild(
  role
);
