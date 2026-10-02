# Urban Tutor Site — project map (plain language)

A website that connects students (parents) with tutors, plus an office
**Admin Panel**. It has two halves:

1. **The website** — ordinary files (HTML / CSS / JavaScript) that you upload
   to your hosting. No build step.
2. **The server** — a Supabase project (database + login + small server
   programs called "Edge Functions"). It is NOT part of the hosting upload.

---

## 1. Website files (what goes on your hosting)

Upload everything in this repo **except** `supabase/`, `share-preview/`,
`README.md` and `.git`.

| Page (open this in the browser) | What it is | Its own JS | Its own CSS |
|---|---|---|---|
| `index.html` | Home page (shows the landing / dashboard inside it) | `homepage/landing/landing.js`, `homepage/dashboard/dashboard.js` | `homepage/…/*.css` |
| `studentregistration.html` | Student / parent sign-up + login (email + 6-digit code) | `js/pages/studentregistration.js` | `css/pages/studentregistration.css` |
| `studentprofile.html` | Student dashboard: tuitions, payments, subscription | `js/pages/student-profile.js` | `css/pages/student-profile.css` |
| `tutorregistration.html` | Tutor sign-up + login | `js/pages/tutor-registration.js` | `css/pages/tutor-registration.css` |
| `tutorprofile.html` | Tutor dashboard: classes, demos, payments | `js/pages/tutor-profile.js` | `css/pages/tutor-profile.css` |
| `advertisement.html` | List of open tuitions a tutor can apply to | `js/pages/advertisement.js` | `css/pages/advertisement.css` |
| `admin.html` | Office Admin Panel | `js/pages/admin.js` | `css/pages/admin.css` |

Shared pieces used by several pages (change them once, every page changes):

| File | Used for |
|---|---|
| `js/supabase-client.js` | The connection to the server. Every page loads it first. `sbCall()` runs a database action; `sbCallNotify()` runs an action that also sends an email. |
| `js/portal.js` | Stamps every login with the door it was made at (Student / Tutor / Admin), so one email logged in at one door does not silently open the others. |
| `js/photos.js`, `css/photos.css` | Tutor profile photos on the round name-letter avatars (tutor's own header/profile, student dashboard for verified tutors who applied, Admin cards). The homepage "Tutors worth meeting" cards also show them (via the public home-photos function). |
| `js/photo-cropper.js`, `css/photo-cropper.css` | The round-crop window on tutor registration: shows the round picture, drag / zoom, "Use this photo" and "Save a copy". |
| `js/common.js` | `escapeHTML()` (safe text) and `hasSession()` (is someone logged in). |
| `js/profile-common.js` | Date/time text, address, badge helpers shared by the two profile pages. |
| `js/header.js`, `js/footer.js`, `components/*.html` | The top bar and the footer on every page. |
| `js/pills.js` | The small coloured status pills. |
| `js/otp-boxes.js`, `css/otpboxes.css` | The six-box login-code entry. |
| `css/registration-common.css` | Styles shared by both sign-up pages. |
| `css/profile-common.css` | Styles shared by the profile pages. |
| `css/header.css`, `css/footer.css` | Top bar and footer look. |

### The `?v=…` after file names
`<script src="js/common.js?v=20261001a">` — the part after `?v=` is only a
"cache bump". Browsers keep old copies of files; **change the letters/numbers
whenever you change that file**, or visitors may keep seeing the old version.

### Rules this site follows
- Never type user-entered text straight into a page: wrap it in `escapeHTML()`
  (or `esc()` in the admin panel).
- Mobile numbers and addresses hidden for an employee are hidden **on the
  server**, not just on the screen.

---

## 2. Server (Supabase)

Project id: `zbvtdcqoouwyrcxkzjfv`

- **Database changes** — `supabase/migrations/NNNN_name.sql`, numbered in the
  order they were applied. Never edit an old one; add a new number.
  `supabase/schema/000_catalog_reference.sql` is a *reference map* of the live
  database (do not run it).
- **Edge Functions** — `supabase/functions/`
  - `admin/` — everything the Admin Panel does (permissions, payments,
    employees, hiding mobile numbers / addresses, adding a student / posting a tuition for a student without OTP).
  - `actions/` — student/tutor actions that must also send an email (new
    tuition, tutor applied, accept/reject).
  - `home-photos/` — public: 1-hour links to the photos of the 4 verified tutors shown on the homepage (nothing else).
  - `tutor-photos/` — gives a logged-in student 1-hour links to the photos of VERIFIED tutors who applied to his tuitions.
  - `_shared/email.ts` — the email design + sending. `_shared/mails.ts` — the
    wording of the 10 emails.
- `supabase/archive/` — old, switched-off code kept only for reference (the WhatsApp webhook). Nothing there is live.
- **Login emails** (the 6-digit code mail) — `supabase/email-templates/`; they
  are pasted by hand into Supabase → Authentication → Email Templates.
- **Secrets** (set in Supabase → Edge Functions → Secrets, never in the code):
  `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`.

### The 10 emails that are sent
1 Student posted a tuition · 2 Tutor applied · 3 Demo scheduled ·
4 Tutor accepted/rejected · 5 Parent accepted/rejected · 6 Tuition payment
received · 7 Agency charge received · 8 Payment to tutor · 9 Student
subscription · 10 Tutor subscription. Nothing else sends mail.

---

## 3. When something breaks

| Symptom | Look at |
|---|---|
| A page looks old after an update | Bump the `?v=` on that file in the HTML. |
| "Unable to connect" on a profile/admin page | Supabase → Edge Functions → Logs (function `admin` / `actions`). |
| Emails not arriving | Supabase secrets `GMAIL_*`; Edge Function logs; Gmail "App password" still valid. |
| Employee sees data they shouldn't | Admin → Employees → their Permissions (Privacy: Hide Mobile / Hide Address). |
| Wrong amount / date on a card | Page's JS in `js/pages/`; money text comes from `rupees()` in `admin.js`. |
