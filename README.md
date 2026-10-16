# Urban Tutor Site — project map (plain language)

A website that connects students (parents) with tutors, plus an office
**Admin Panel**, a **Telegram bot** and a **WhatsApp bot**. It has two halves:

1. **The website** — ordinary files (HTML / CSS / JavaScript) hosted on GitHub
   Pages. No build step.
2. **The server** — a Supabase project (database + login + small server
   programs called "Edge Functions"). It is NOT part of the hosting upload.

Everything that happens (a student registers, a tutor applies, a class is
taken, money is recorded) is stored in the database; the website, the Admin
Panel and both bots are just different "doors" to the same data.

---

## 1. Website files (what goes on your hosting)

Upload everything in this repo **except** `supabase/`, `share-preview/`,
`docs/`, `README.md` and `.git`.

| Page (open this in the browser) | What it is | Its own JS | Its own CSS |
|---|---|---|---|
| `index.html` | Home page (landing + dashboard inside it) | `homepage/landing/landing.js`, `homepage/dashboard/dashboard.js` | `homepage/…/*.css` |
| `studentregistration.html` | Student / parent sign-up + login (email + 6-digit code) | `js/pages/student-registration.js` | `css/pages/student-registration.css` |
| `studentprofile.html` | Student dashboard: tuitions, payments, subscription | `js/pages/student-profile.js` | `css/pages/student-profile.css` (+ `tutor-profile.css`, shared card look) |
| `tutorregistration.html` | Tutor sign-up + login | `js/pages/tutor-registration.js` | `css/pages/tutor-registration.css` |
| `tutorprofile.html` | Tutor dashboard: classes, demos, payments | `js/pages/tutor-profile.js` | `css/pages/tutor-profile.css` |
| `advertisement.html` | List of open tuitions a tutor can apply to | `js/pages/advertisement.js` | `css/pages/advertisement.css` (+ `tutor-profile.css`) |
| `admin.html` | Office Admin Panel (desktop / web view only) | `js/pages/admin.js` | `css/pages/admin.css` |

Shared pieces used by several pages (change them once, every page changes):

| File | Used for |
|---|---|
| `js/supabase-client.js` | The connection to the server. Every page loads it first. `sbCall()` runs a database action; `sbCallNotify()` runs an action that also sends an email. |
| `js/portal.js` | Stamps every login with the door it was made at (Student / Tutor / Admin), so one email logged in at one door does not silently open the others. |
| `js/telegram.js` | When a page is opened inside Telegram (from the bot), fits it to Telegram and, once logged in, links the person's Telegram chat to their student / tutor record. Does nothing in a normal browser. |
| `js/photos.js`, `css/photos.css` | Tutor profile photos on the round name-letter avatars. |
| `js/photo-cropper.js`, `css/photo-cropper.css` | The round-crop window on tutor registration. |
| `css/student-forms.css` | The Student Profile pop-up look ("Add a Student", "Apply For New Tuition"), reused by the Admin Panel's Students tab. |
| `js/common.js` | `escapeHTML()` (safe text) and `hasSession()` (is someone logged in). |
| `js/profile-common.js` | Date/time text, address, badge helpers shared by the two profile pages. |
| `js/header.js`, `js/footer.js`, `components/*.html` | The top bar and the footer on every page. |
| `js/pills.js` | The small coloured status pills. |
| `js/autocaps.js` | Title-cases typed names / places as people type. |
| `js/otp-boxes.js`, `css/otpboxes.css` | The six-box login-code entry. |
| `css/registration-common.css`, `css/profile-common.css`, `css/header.css`, `css/footer.css` | Styles shared by the sign-up pages, profile pages, top bar and footer. |

### The `?v=…` after file names
`<script src="js/common.js?v=20261001a">` — the part after `?v=` is only a
"cache bump". Browsers keep old copies of files; **change the letters/numbers
whenever you change that file**, or visitors may keep seeing the old version.

### Rules this site follows
- Never type user-entered text straight into a page: wrap it in `escapeHTML()`
  (or `esc()` in the admin panel).
- Mobile numbers and addresses hidden for an employee are hidden **on the
  server**, not just on the screen.
- The Admin Panel is designed for a desktop / web view, not for phones.

---

## 2. Server (Supabase)

Project id: `zbvtdcqoouwyrcxkzjfv`

### 2.1 Database
- **Changes** — `supabase/migrations/NNNN_name.sql`, numbered in the order they
  were applied. Never edit an old one; add a new number. (A few were applied
  directly and are not in Supabase's own migration list — this folder is the
  source of truth.) `supabase/schema/000_catalog_reference.sql` is a *reference
  map* of the live database (do not run it).
- **Main tables** — `students`, `tutors`, `tuitions` (one per subject, with a
  Demo ID), `applications` (a tutor on a tuition: demo, class terms, calendar
  `class_log`, billing plan), `payments`, `subscriptions`, `admin_users`
  (employees), `app_settings` (site switches, e.g. `admin_mails`).
- **Bot tables** — `telegram_chats` (the one bot message kept per chat),
  `class_notifications` (the class reminder queue), `bot_sessions` (where a chat
  is in the "register as a student" conversation). All three are server-only.
- **Fast lookups** — `students.phone10 / whatsapp10 / email_lc` and `tutors.mobile10 / whatsapp10 / email_lc`
  are generated by the database (last 10 digits of a number, lower-cased e-mail) and indexed. The bots and the
  chat registration match on them (exact match), so they stay fast with many people. Do not write to them.
- **IDs** — students `SID+year+4 digits`, tutors `TID…`, tuitions `DID…`
  (generated in the database).
- **Scheduled jobs** (pg_cron):
  `tutor-experience-refresh` (nightly: `tutors.experience_since` → years, 1
  decimal) and `class-notify-tick` (every minute: queues "class in 15 minutes" /
  "did you take the class?" messages and calls the `telegram` function only when
  something is waiting).
- **Security** — every table has row-level security; the website only talks to
  the database through the numbered functions (RPCs). The `admin_*` and `bot_*`
  functions can be run by the server only (`service_role`).
- **Size** — the whole database is a few MB (≈ 600 students, ≈ 550 tutors), so
  data volume is not a speed problem. The Admin Panel pages its lists 50 at a
  time.

### 2.2 Edge Functions (`supabase/functions/`)
Each folder is one function. They import shared code from `_shared/`, so when
you deploy a function, deploy the `_shared` files it imports with it.

| Function | What it does |
|---|---|
| `admin/` | Everything the Admin Panel does: permissions, payments, employees, hiding mobile numbers / addresses, adding students / tuitions, block / mute, verification, class calendar. |
| `actions/` | Student / tutor actions that must also send a notification (new tuition, tutor applied, accept / reject). |
| `telegram/` | The Telegram bot **@UrbanTutorSiteBot** (see §3). Also `?link=1` (links a chat to a login) and `?run=1` (sends the class reminder queue). |
| `whatsapp/` | The WhatsApp bot on the Meta Cloud API (see §3). Webhook: `…/functions/v1/whatsapp`. |
| `home-photos/` | Public: 1-hour links to the photos of the tutors shown on the homepage "Tutors worth meeting" (nothing else). |
| `tutor-photos/` | Gives a logged-in student 1-hour links to the photos of VERIFIED tutors who applied to his tuitions. |

Shared code (`_shared/`):
- `email.ts` — the email design + Gmail sending.
- `mails.ts` — the wording of every message (also re-exports `SITE_URL`, `AGENCY_PHONE`, `fmtDate`, `fmtTime`).
- `constants.ts` — `SITE_URL`, `AGENCY_PHONE` (change them here once).
- `format.ts` — date / time wording ("25 September 2026", "5:00 PM").
- `telegram.ts` — sending to Telegram + the quiet / notifications-off checks, `notify()`.
- `botdata.ts` — the bots' database lookups: who is behind a phone / email, the tuition life (Running / Demo Scheduled / Finding Tutor / Completed). Used by both bots and the chat registration.
- `session.ts` — where the chat flows keep their progress (`bot_sessions`), shared types.
- `regflow.ts` — the chat registration flow used by both bots.
- `tuitionflow.ts` — the chat "post a new tuition" flow used by both bots.
- `classinfo.ts` — the bot texts for one running class (days, time, fee) and one scheduled demo.
- `deal.ts` — class-deal money maths.

**Tests** (no network needed): `NODE_PATH=$(npm root -g) node supabase/tests/run.mjs` checks the chat
registration (WhatsApp + Telegram paths, duplicate email / phone, wrong code, cancel) and the bot menu
categories against a pretend database, and the chat tuition posting. Run it after touching `regflow.ts`,
`tuitionflow.ts` or `botdata.ts`.

`supabase/archive/` — old, switched-off code kept only for reference. Nothing there is live.

**Secrets** (Supabase → Edge Functions → Secrets, never in the code):
`GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`, `TELEGRAM_BOT_TOKEN`,
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`,
`WHATSAPP_APP_SECRET` (optional but recommended: rejects calls not signed by Meta).

**Login emails** (the 6-digit code mail for website login) — `supabase/email-templates/`;
pasted by hand into Supabase → Authentication → Email Templates.

### 2.3 Messages that are sent
Email (and the same message on the person's linked Telegram): tuition posted ·
tutor applied · demo scheduled · tutor accepted / declined · parent accepted /
declined · both accepted · payment received · agency charge · payment to tutor ·
subscription · tuition agreement · class reminder · class check · class taken.
Class messages end with a line such as "If you have any queries, please contact
your tutor (number) or your agency (+91 90018 00307)".

**Emails On / Off** (Admin Panel top bar):
- **Super Admin** — the switch for the whole site (`app_settings` key
  `admin_mails`). Off = no notification email at all. Only login / sign-up
  codes (OTP) still go out: the chat-registration code uses `sendMail(..., {always: true})`.
  Checked inside `_shared/email.ts`, so every function obeys it.
- **Other employees** — their own switch (`admin_users.mails_enabled`); needs the
  "Switch off emails" permission.
- Per person: the bell on a student / tutor / employee card (or "Notifications"
  in the bot menu) turns that person's email + Telegram + WhatsApp off
  (`notifications_off`). A blocked student / tutor gets none either.

---

## 3. The bots

Both bots link a person by their number / chat to the student or tutor
record, and show the same menu: Running / Demo Scheduled / Finding Tutor (Applied
for tutors) / Completed, the tuition details, a Notifications on/off switch and a
link to the profile.

### Telegram (`telegram/`)
- Menu, notifications on/off, demo **Accept / Reject** buttons, class reminders
  and the tutor's "Yes, I took the class" button (marks the day done: the
  calendar turns green and the parent is told).
- **Register as a student in the chat**: a new user taps "Register as Student here
  in chat". The bot asks the details one by one. The mobile number comes from
  Telegram's "Share my number" button (so it is verified), the email is verified
  with a 6-digit code. Then the chat is linked to the new student so
  notifications arrive here.
- After changing the bot's webhook settings, open
  `https://zbvtdcqoouwyrcxkzjfv.supabase.co/functions/v1/telegram?setup=1` once.

### WhatsApp (`whatsapp/`)
- Works on the number set in `WHATSAPP_PHONE_NUMBER_ID`. The person is found by
  the sender's number (students' `phone` / `whatsapp`, tutors' `mobile_number` /
  `whatsapp_number`, last 10 digits).
- Menu, details, notifications on/off, **Open Website** (a button: WhatsApp cannot put a
  link on a word), **Apply for New Tuition** in the chat, and **Register as a student in the chat**
  (same questions as Telegram; the mobile number is the sender's own, the email
  is verified with a code).
- Meta settings: app → WhatsApp → Configuration: callback URL
  `https://zbvtdcqoouwyrcxkzjfv.supabase.co/functions/v1/whatsapp`, verify token =
  `WHATSAPP_VERIFY_TOKEN`, field **messages** subscribed, and "Subscribe
  webhooks" on for the WhatsApp Business Account.
- **Who is this number?** One number can be an employee (Admin), a student/parent and a tutor.
  If more than one matches, the bot asks *Act as Admin / Student / Tutor*, and every menu has
  a *Switch to …* row.
- **Admin on WhatsApp** (WhatsApp only for now; Telegram later): an employee whose **Mobile /
  WhatsApp number** is set in Admin → Employees gets an Admin menu - *New Tuition* (by WhatsApp /
  mobile number or Student ID), *Assign Tutor*, *Schedule Demo*, *Tutor Confirmation* (view, or
  confirm for the tutor) and *Create Payment* (only after tutor and parent both agreed). The bot
  calls the `admin` function as that employee, so permissions, login hours, "hide mobile" and
  e-mails are exactly the same as in the panel. Two more items: *Add New Student* (only the
  student's name and a mobile number are needed; parent, email, gender, class, school, board, city,
  PIN and address can each be skipped; no email code; then it offers to post a tuition) and
  *Class & Agreement* (for a tuition where tutor and parent agreed: class days, start date, time,
  minutes, *Monthly Commission* [fee, agency cut as % or ₹, who gets the first month] or *Per Class
  Commission* [price per class, agency share], how often the parent pays; it saves the class like
  the panel's "Save & Send Agreement" and mails/Telegrams the agreement to parent and tutor). Admin recognition is **switched off until the
  secret `WHATSAPP_APP_SECRET` is set** (Meta app → Settings → Basic → App Secret), so a forged
  message cannot act as an admin.
- **Not yet built:** sending notifications (reminders, demo, payments) over WhatsApp.
  That needs Meta-approved message templates — the ready-to-paste drafts are in
  `docs/whatsapp-templates.md`.
- Until the real number is set up, a Meta **test number** is used (messages only
  to up to 5 verified numbers, 24-hour access token). Switching to the real number =
  change `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_TOKEN`; the code is the same.

### Chat registration flow (`_shared/regflow.ts`)
One flow for both bots; the channel only draws the buttons. Steps:
parents' name → student's name → (Telegram: share number) → email → 6-digit code →
gender → class → school → board → city → PIN → address → terms → check &
Submit. Rules: mobile / email already on a student account = refused with a login
link; the code lasts 10 minutes, 5 tries, max 3 sends, 30 seconds apart; a
half-finished chat is forgotten after 3 hours. The account is created with
`admin_register_student` (the same duplicate check as the Admin Panel) and gets
the yearly subscription like any new student. No tutor sign-up here (documents /
photo stay on the website). At the end: "Post a new tuition request now?" → Yes
starts the tuition flow below.

**Add New Child** (same file) adds a brother / sister to the account the chat
already belongs to — in the student picker and in the menu. The parent's name,
number, email and address come from the student already on file, so it only asks:
new student's name → gender → class → school → board → check & Submit (no code to
verify). The same duplicate check applies, so the same child cannot be added twice.

### Chat tuition flow (`_shared/tuitionflow.ts`)
"Apply for New Tuition" in the bot menu (students only). Steps: pick the student
(only if the number / chat has more than one) → subjects (comma separated) → time
(typed, e.g. "5 PM" or "6 PM - 8 PM") → tutor (Any / Male /
Female) → mode (Any / Home / Online) → check & Post. Same result as the
website form: one Demo ID per subject, a subject that already has a running request
is refused, and the "Tuition Request Posted" email / Telegram message goes out.

### Chat apply flow for tutors (`_shared/applyflow.ts`)
"Apply for New Tuition" in the tutor's bot menu (next to "Find New Tuitions"). The
tutor types a Tuition ID — `DID` followed by 8 digits, e.g. `DID20260007` (spaces and
small letters are fine). `bot_apply_for_tuition` (migration 0053) applies with the
website's rules (verified, not blocked, tuition still open, not applied twice) and
also refuses a tutor whose gender does not match the tuition's preferred tutor
("Any" accepts everyone). After a refusal the tutor can type another ID; on success
the parent gets the "A Tutor Applied" email / Telegram message.

The same gender rule is in `apply_for_tuition` (migration 0054), so the website
follows it too: on `advertisement.html` a tuition for the other gender shows a pale,
disabled **Not Applicable** button (`get_available_tuitions` now returns
`tutorGender`), and the dashboard's "matching tuitions" skips it.
Only students found behind that WhatsApp number / linked to that Telegram chat can
be picked. "Hi" or "Cancel" leaves the flow.

### Class reminders (`class_notifications`)
15 minutes before a class: "You have class today" to the tutor and the student.
After it should have ended: "Have you taken today's class?" to the tutor.
"Yes" (button on Telegram, or in the profile) marks the day done
(`applications.class_log`) and tells the parent.

---

## 4. Admin Panel (`admin.html`)
Sign in with an employee email + 6-digit code. What each employee sees depends on
their Permissions. Tabs: Overview, Students, Tutors, Tuitions, Payments,
Subscriptions, Employees.
- **Overview cards** (2 rows of 6): Finding Tutors, Demo to Schedule, Today's Demo,
  Running Classes, Classes Completed, Closed · Tutor Verification Pending, Total
  Verified Tutors, Total Students, Total Tuitions, Blocked Tutors, Blocked Students.
- **Student / Tutor / Employee cards**: four icons (Block, Verify or profile
  check, Notifications bell, Edit). A blocked or disabled tutor can still log in
  and see their details but cannot apply / accept / mark classes. Up to four
  coloured status boxes on the card's left edge show the tuition stages.
- **Class cards**: calendar log, class deal (two payment models), refund box
  (opens "Record a Payment" with Refund to Parent / Refund to Tutor), first-month
  bar and weekday pills.

---

## 5. When something breaks

| Symptom | Look at |
|---|---|
| A page looks old after an update | Bump the `?v=` on that file in the HTML. |
| "Unable to connect" on a profile/admin page | Supabase → Edge Functions → Logs (function `admin` / `actions`). |
| Emails not arriving | Admin Panel "Emails" switch (Super Admin) – if off, only login codes go out; then secrets `GMAIL_*`; Edge Function logs; Gmail "App password" still valid. |
| WhatsApp bot does not answer | Meta: callback URL + verify token + **messages** subscribed + "Subscribe webhooks" on; `WHATSAPP_TOKEN` not expired (test tokens last 24 h); Supabase → Logs → Edge Function `whatsapp` (no calls at all = Meta is not delivering). |
| Telegram bot does not answer | `?setup=1` on the telegram function; `TELEGRAM_BOT_TOKEN`. |
| Employee sees data they shouldn't | Admin → Employees → their Permissions (Privacy: Hide Mobile / Hide Address). |
| Wrong amount / date on a card | Page's JS in `js/pages/`; money text comes from `rupees()` in `admin.js`. |
| A database change "hangs" when run from the SQL tool | Run it as small separate statements; scheduled-job (`cron.schedule`) and function-replace statements can time out while the every-minute job holds a lock — retry later. |

---

## 6. Known leftovers (safe to tidy when convenient)
- `bot_respond_to_demo_tutor` does not yet check for a blocked tutor.
- The `actions` and `admin` functions were last deployed before the newest shared code (`mails.ts`,
  `telegram.ts`, `constants.ts`, `format.ts`); they keep working, redeploy them when you next change them.
- `@supabase/supabase-js@2` is loaded from a CDN without an exact version; pinning an exact version would stop
  surprise upgrades.
- The Admin Panel loads all students / tutors at once and pages them 50 at a time on screen. That is fine for
  thousands of people; if it ever reaches tens of thousands, move the paging to the server.
