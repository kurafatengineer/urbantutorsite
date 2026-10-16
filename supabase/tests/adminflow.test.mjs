globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "http://db", SUPABASE_SERVICE_ROLE_KEY: "k" }[k]) } };

const deal = { model: "margin", parentPerClass: 300, marginType: "amount", marginValue: 50, parentFreq: "Monthly", tutorFreq: "Monthly", minutes: 60, finalizedAt: "x" };
const db = {
  bot_sessions: [],
  students: [
    { student_id: "SID20260001", student_name: "Priyanka Shukla", parents_name: "Ravindra Kumar", phone10: "9000000001", whatsapp10: "9000000001", email_lc: "p@x.com", class_name: "10th", board: "CBSE" },
    { student_id: "SID20260002", student_name: "Mohit Kumar", parents_name: "Ravindra Kumar", phone10: "9000000002", whatsapp10: "9000000002", email_lc: "p@x.com", class_name: "8th", board: "CBSE" },
    { student_id: "SID20260003", student_name: "Blocked Kid", parents_name: "X", phone10: "9000000003", whatsapp10: "9000000003", email_lc: "b@x.com", blocked_at: "2026-10-01" },
    { student_id: "SID20260004", student_name: "Solo Kid", parents_name: "Y", phone10: "9000000004", whatsapp10: "9000000004", email_lc: "s@x.com", class_name: "9th", board: "ICSE" },
  ],
  tutors: [
    { tutor_id: "TID20260001", full_name: "Anita Verma", gender: "Female", verification_status: "Verified", mobile10: "9111111111", whatsapp10: "9111111111" },
    { tutor_id: "TID20260002", full_name: "Rohit Singh", gender: "Male", verification_status: "Verified", mobile10: "9222222222", whatsapp10: "9222222223" },
    { tutor_id: "TID20260003", full_name: "Neha Gupta", gender: "Female", verification_status: "Pending", mobile10: "9333333333", whatsapp10: "9333333333" },
  ],
  tuitions: [
    { demo_id: "DID20260007", subject: "English", medium: "Home", preferred_tutor: "Any", student_id: "SID20260001", terminated: false },
    { demo_id: "DID20260008", subject: "Maths", medium: "Online", preferred_tutor: "Female", student_id: "SID20260001", terminated: false },
    { demo_id: "DID20260009", subject: "Science", medium: "Any", preferred_tutor: "Any", student_id: "SID20260001", terminated: true },
    { demo_id: "DID20260010", subject: "Hindi", medium: "Any", preferred_tutor: "Any", student_id: "SID20260004", terminated: false },
  ],
  applications: [
    { demo_id: "DID20260007", tutor_id: "TID20260001", parent_accepted: true, tutor_accepted: true, class_dates: ["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14"], billing_plan: { deal }, demo_date: "2026-10-01", demo_time: "17:00:00" },
    { demo_id: "DID20260008", tutor_id: "TID20260001", parent_accepted: true, tutor_accepted: false },
    { demo_id: "DID20260010", tutor_id: "TID20260001", parent_accepted: false, tutor_accepted: false },
    { demo_id: "DID20260010", tutor_id: "TID20260002", parent_accepted: false, tutor_accepted: false },
  ],
  calls: [], me: { fullName: "Rahul Kumar", role: "tuition_coordinator", permissions: ["tuitions_view", "tuitions_edit", "tuitions_assign_tutor", "tuitions_add", "students_view", "payments_add", "payments_view"], hideContacts: false },
  adminOk: true,
};
const ok = (b) => ({ ok: true, status: 200, json: async () => b });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const m = (init.method || "GET").toUpperCase();
  if (u.pathname === "/functions/v1/admin") {
    const b = JSON.parse(init.body); db.calls.push(b);
    if (!db.adminOk) return ok({ success: false, message: "Your login hours are 9:00 AM - 6:00 PM." });
    if (b.action === "adminWhoAmI") return ok({ success: true, me: db.me });
    if (b.action === "adminAddTuition") return ok({ success: true, demoIds: ["DID20260100"] });
    return ok({ success: true, message: "Saved." });
  }
  const path = u.pathname.replace("/rest/v1/", "");
  const eq = (k) => u.searchParams.get(k)?.replace(/^eq\./, "");
  const inVals = (k) => (u.searchParams.get(k) ?? "").replace(/^in\.\(|\)$/g, "").split(",").map((x) => x.replace(/"/g, ""));
  if (path === "bot_sessions") {
    const ch = eq("channel"), key = decodeURIComponent(eq("chat_key") ?? "");
    if (m === "GET") return ok(db.bot_sessions.filter((r) => r.channel === ch && r.chat_key === key));
    if (m === "POST") { const b = JSON.parse(init.body); db.bot_sessions = db.bot_sessions.filter((r) => !(r.channel === b.channel && r.chat_key === b.chat_key)); db.bot_sessions.push(b); return ok([]); }
    if (m === "DELETE") { db.bot_sessions = db.bot_sessions.filter((r) => !(r.channel === ch && r.chat_key === key)); return ok([]); }
  }
  if (path === "students") {
    return ok(db.students.filter((s) =>
      (u.searchParams.has("student_id") ? s.student_id === eq("student_id") : true) &&
      (u.searchParams.has("phone10") ? s.phone10 === eq("phone10") : true) &&
      (u.searchParams.has("whatsapp10") ? s.whatsapp10 === eq("whatsapp10") : true) &&
      (u.searchParams.has("email_lc") ? inVals("email_lc").includes(s.email_lc) : true)));
  }
  if (path === "tutors") {
    return ok(db.tutors.filter((t) =>
      (u.searchParams.has("tutor_id") ? (u.searchParams.get("tutor_id").startsWith("in.") ? inVals("tutor_id").includes(t.tutor_id) : t.tutor_id === eq("tutor_id")) : true) &&
      (u.searchParams.has("whatsapp10") ? t.whatsapp10 === eq("whatsapp10") : true) &&
      (u.searchParams.has("mobile10") ? t.mobile10 === eq("mobile10") : true)));
  }
  if (path === "tuitions" && m === "GET") {
    return ok(db.tuitions.filter((t) =>
      (u.searchParams.has("demo_id") ? (u.searchParams.get("demo_id").startsWith("in.") ? inVals("demo_id").includes(t.demo_id) : t.demo_id === eq("demo_id")) : true) &&
      (u.searchParams.has("student_id") ? t.student_id === eq("student_id") : true) && !(u.searchParams.has("terminated") && t.terminated)));
  }
  if (path === "applications") return ok(db.applications.filter((a) => a.demo_id === eq("demo_id")));
  if (path === "rpc/tuition_status") return ok(JSON.parse(init.body).p_demo_id === "DID20260009" ? "Terminated" : "Finding Tutor");
  throw new Error("unexpected " + m + " " + url);
};

const { handleInput } = await import("./build/regflow.mjs");
const { startAdminFlow, adminMenuRows, parseDate, parseTime, parseAmount, classify } = await import("./build/adminflow.mjs");
const assert = (c, msg) => { if (!c) { console.log("FAIL:", msg); process.exitCode = 1; } else console.log("ok  :", msg); };
const wa = { channel: "wa", key: "9800000000" };
const step = () => db.bot_sessions[0]?.step;
const say = async (text, choice) => (await handleInput(wa, { text, choice })) ?? [];
const txt = (o) => o.map((x) => x.text).join("\n");
const last = () => db.calls.filter((c) => c.action !== "adminWhoAmI").at(-1);
const EID = "emp-1";
const today = parseDate("today");

// ---- parsing
assert(parseDate("18-10-2026") === "2026-10-18" && parseDate("18/10/2026") === "2026-10-18" && parseDate("2026-10-18") === "2026-10-18", "dates: dd-mm-yyyy, dd/mm/yyyy, iso");
assert(parseDate("31-02-2026") === "" && parseDate("hello") === "" && parseDate("today") === today, "dates: impossible / text refused, today works");
assert(parseTime("5 pm") === "17:00" && parseTime("5:30 PM") === "17:30" && parseTime("17:30") === "17:30" && parseTime("12 am") === "00:00" && parseTime("12 pm") === "12:00", "times: 5 pm, 5:30 PM, 17:30, 12 am/pm");
assert(parseTime("25:00") === "" && parseTime("13 pm") === "" && parseTime("soon") === "", "times: impossible refused");
assert(parseAmount("₹3,600") === 3600 && parseAmount("Rs. 1500.50") === 1500.5 && parseAmount("0") === 0 && parseAmount("abc") === 0, "amounts parsed");
assert(classify("did 2026 0007").kind === "did" && classify("SID20260001").kind === "sid" && classify("tid20260001").kind === "tid", "ids recognised");
assert(classify("+91 98765 43210").value === "9876543210" && classify("12345").kind === "" && classify("5555555555").kind === "badphone", "phone numbers: +91 stripped, short / non-Indian refused");

// ---- menu
const rows = adminMenuRows(db.me.permissions).map((r) => r.id);
assert(rows.join() === "ad:new,ad:assign,ad:demo,ad:conf,ad:pay", "full menu for an employee with every permission");
assert(adminMenuRows(["payments_add"]).map((r) => r.id).join() === "ad:pay" && adminMenuRows([]).length === 0, "menu only shows what the employee may do");

// ---- permission / hours
let o = await startAdminFlow(wa, EID, "pay");
assert(step() === "ad_pm_demo", "allowed -> asks the Tuition ID");
await say("cancel"); assert(!db.bot_sessions.length, "Cancel ends it");
db.me.permissions = ["tuitions_view"];
o = await startAdminFlow(wa, EID, "pay");
assert(txt(o).includes("do not have permission") && !db.bot_sessions.length, "no permission -> refused");
db.me.permissions = ["tuitions_view", "tuitions_edit", "tuitions_assign_tutor", "tuitions_add", "students_view", "payments_add", "payments_view"];
db.adminOk = false;
o = await startAdminFlow(wa, EID, "new");
assert(txt(o).includes("login hours") && !db.bot_sessions.length, "outside login hours -> the admin function's message");
db.adminOk = true;

// ---- 1. new tuition
await startAdminFlow(wa, EID, "new");
o = await say("12345"); assert(txt(o).includes("not a valid number or ID") && step() === "ad_new_find", "bad number refused");
o = await say("9999999999"); assert(txt(o).includes("No student was found"), "unknown number -> not found");
o = await say("9000000003"); assert(txt(o).includes("blocked"), "blocked student refused");
o = await say("9000000001");
assert(step() === "ad_new_pick" && o[0].choices.length === 3, "two children on this number (siblings) -> pick one (+ Cancel)");
o = await say("", "ad_pick:SID20260099"); assert(step() === "ad_new_pick", "a student not on the list is refused");
o = await say("", "ad_pick:SID20260001");
assert(step() === "t_subjects" && db.bot_sessions[0].data.adminId === EID && txt(o).includes("Priyanka Shukla"), "picked -> the usual tuition questions, posting as the employee");
await say("Physics, Chemistry"); await say("6 pm"); await say("", "t_tutor:female"); await say("", "t_mode:online");
o = await say("", "t_post");
assert(last().action === "adminAddTuition" && last().botEmployeeId === EID && last().p.studentId === "SID20260001" && last().p.subjects === "Physics,Chemistry" && last().p.preferredTutor === "Female" && last().p.medium === "Online" && last().p.preferredTiming === "6 pm", "posted through the admin function with the right details");
assert(txt(o).includes("Tuition request posted!") && txt(o).includes("DID20260100") && txt(o).includes("The parent has been told") && !db.bot_sessions.length, "success message, session cleared");
await startAdminFlow(wa, EID, "new");
o = await say("SID20260004"); assert(step() === "t_subjects", "Student ID works too (single student goes straight on)");
await say("cancel");
db.me.hideContacts = true;
await startAdminFlow(wa, EID, "new");
o = await say("9000000001"); assert(txt(o).includes("cannot search by number") && step() === "ad_new_find", "'hide mobile numbers' account cannot search by number");
o = await say("SID20260004"); assert(step() === "t_subjects", "...but can use the Student ID");
await say("cancel"); db.me.hideContacts = false;

// ---- 2. assign tutor
await startAdminFlow(wa, EID, "assign");
o = await say("DID2026"); assert(txt(o).includes("not a valid *Tuition ID*"), "short Tuition ID refused");
o = await say("DID20260999"); assert(txt(o).includes("No tuition was found"), "unknown Tuition ID refused");
o = await say("DID20260009"); assert(txt(o).includes("is closed"), "closed tuition refused");
o = await say("DID20260008");
assert(step() === "ad_as_tutor" && txt(o).includes("*Maths* (DID20260008)") && txt(o).includes("Student: *Priyanka Shukla*") && txt(o).includes("Tutor wanted: Female") && txt(o).includes("Tutors on it: 1"), "Tuition ID -> tuition card, asks for the tutor");
o = await say("9333333333"); assert(txt(o).includes("not a verified tutor"), "unverified tutor refused");
o = await say("9111111111"); assert(txt(o).includes("already on this tuition"), "tutor already on it refused");
o = await say("9888888888"); assert(txt(o).includes("No tutor was found"), "unknown tutor number refused");
o = await say("9222222223");
assert(step() === "ad_as_confirm" && txt(o).includes("Rohit Singh") && txt(o).includes("asks for *female* tutors") && o[0].choices[0].title === "Assign Anyway", "found by WhatsApp number (different from mobile); gender mismatch is warned about");
o = await say("", "ad_yes");
assert(last().action === "adminAssignTutor" && last().demoId === "DID20260008" && last().tutor === "TID20260002", "assigned through the admin function, by Tutor ID");
assert(txt(o).includes("Tutor assigned!") && !db.bot_sessions.length, "success, session cleared");
await startAdminFlow(wa, EID, "assign"); await say("DID20260007"); o = await say("TID20260002");
assert(step() === "ad_as_confirm" && o[0].choices[0].title === "Assign" && !txt(o).includes("asks for"), "gender 'Any' -> no warning, plain Assign");
await say("cancel");

// ---- 3. schedule demo
await startAdminFlow(wa, EID, "demo");
o = await say("DID20260010");
assert(step() === "ad_sd_pick" && o[0].choices.length === 3, "two tutors on the tuition -> pick one");
o = await say("", "ad_pick:TID20260002"); assert(step() === "ad_sd_date" && txt(o).includes("Rohit Singh"), "tutor picked -> asks the date");
o = await say("tomorrow-ish"); assert(txt(o).includes("not a valid date") && step() === "ad_sd_date", "bad date refused");
o = await say("01-01-2020"); assert(txt(o).includes("already passed"), "past date refused");
await say("tomorrow"); assert(step() === "ad_sd_time", "date ok -> asks the time");
o = await say("seven"); assert(txt(o).includes("not a valid time"), "bad time refused");
o = await say("5:30 PM");
assert(step() === "ad_sd_confirm" && txt(o).includes("5:30 PM") && txt(o).includes("Hindi") && txt(o).includes("Solo Kid"), "summary shown");
o = await say("", "ad_yes");
assert(last().action === "adminUpdateDemoRow" && last().demoId === "DID20260010" && last().tutorId === "TID20260002" && last().changes["Demo Date"] === parseDate("tomorrow") && last().changes["Demo Time"] === "17:30", "scheduled through the admin function with ISO date and 24-hour time");
assert(txt(o).includes("Demo scheduled!") && !db.bot_sessions.length, "success");
await startAdminFlow(wa, EID, "demo"); o = await say("DID20260007");
assert(step() === "ad_sd_date" && txt(o).includes("The demo is now on 01 October 2026, 5:00 PM"), "one tutor goes straight to the date; an existing demo is mentioned");
await say("cancel");
await startAdminFlow(wa, EID, "demo"); o = await say("DID20260009"); assert(txt(o).includes("is closed"), "closed tuition refused");
await say("cancel");

// ---- 4. tutor confirmation
await startAdminFlow(wa, EID, "conf");
o = await say("DID20260008");
assert(step() === "ad_tc_pick" && txt(o).includes("Tutor: Waiting") && txt(o).includes("Parent: Agreed") && o.at(-1).choices.some((c) => c.id === "ad_pick:TID20260001"), "shows who has agreed; offers to confirm for the waiting tutor");
o = await say("", "ad_pick:TID20260001");
assert(step() === "ad_tc_confirm" && txt(o).includes("only after the tutor has agreed"), "asks to be sure");
o = await say("", "ad_yes");
assert(last().action === "adminUpdateDemoRow" && last().changes["Tutor Accepted"] === true && last().tutorId === "TID20260001", "confirmed through the admin function");
assert(txt(o).includes("Tutor confirmed.") && txt(o).includes("Parent: Agreed"), "success, shows the parent's side");
await startAdminFlow(wa, EID, "conf"); o = await say("DID20260007");
assert(!db.bot_sessions.length && txt(o).includes("Tutor: Agreed") && txt(o).includes("Use *Create Payment*"), "already agreed -> just the details and the next step");
db.me.permissions = ["tuitions_view"];
await startAdminFlow(wa, EID, "conf"); o = await say("DID20260008");
assert(!db.bot_sessions.length && !o.some((x) => x.choices), "a viewer who may not edit gets the details only, no confirm button");
db.me.permissions = ["tuitions_view", "tuitions_edit", "tuitions_assign_tutor", "tuitions_add", "students_view", "payments_add", "payments_view"];

// ---- 5. payment
await startAdminFlow(wa, EID, "pay");
o = await say("DID20260010"); assert(txt(o).includes("both agreed") && txt(o).includes("Tutor waiting"), "tutor + parent not both agreed -> refused, with the state of each");
o = await say("DID20260999"); assert(txt(o).includes("No tuition was found"), "unknown tuition refused");
o = await say("DID20260007");
assert(step() === "ad_pm_kind" && txt(o).includes("English") && txt(o).includes("Anita Verma") && txt(o).includes("Parent pays each time: Rs 1200") && txt(o).includes("Tutor gets each time: Rs 1000"), "agreed -> shows the deal's instalments, asks the kind");
o = await say("", "pm_kind:collection"); assert(step() === "ad_pm_amount", "kind -> amount");
o = await say("lots"); assert(txt(o).includes("not a valid amount"), "bad amount refused");
await say("₹1,200"); assert(step() === "ad_pm_ptype", "amount -> payment type");
await say("", "pm_ptype:regular"); assert(step() === "ad_pm_mode", "type -> mode");
await say("", "pm_mode:Online"); assert(step() === "ad_pm_date", "mode -> date");
o = await say("01-01-2099"); assert(txt(o).includes("cannot be in the future"), "future payment date refused");
await say("", "pm_today"); assert(step() === "ad_pm_next", "today -> next payment date");
o = await say(today); assert(txt(o).includes("must be after"), "next date not after the payment date refused");
await say("", "pm_skip");
o = await say("");
assert(step() === "ad_pm_confirm" && txt(o).includes("Parent paid us") && txt(o).includes("Rs 1200") && txt(o).includes("Regular") && txt(o).includes("Online"), "summary shown");
o = await say("", "ad_yes");
const pay = last();
assert(pay.action === "adminAddPayment" && pay.transactionType === "collection" && pay.demoId === "DID20260007" && pay.tutorId === "TID20260001" && pay.amount === 1200 && pay.paymentType === "regular" && pay.paymentMode === "Online" && pay.paymentDate === today && pay.nextPaymentDate === undefined && pay.collectedBy === "agency" && pay.notes.includes("Rahul Kumar"), "recorded through the admin function with every field");
assert(txt(o).includes("Payment recorded.") && !db.bot_sessions.length, "success");
await startAdminFlow(wa, EID, "pay"); await say("DID20260007"); await say("", "pm_kind:agency_charge"); o = await say("500");
assert(step() === "ad_pm_mode", "agency charge skips the payment type");
await say("", "pm_mode:Offline"); await say("", "pm_today"); await say("17-11-2099"); o = await say("", "ad_yes");
assert(last().transactionType === "agency_charge" && last().paymentType === "agency" && last().paymentMode === "Offline" && last().nextPaymentDate === "2099-11-17" && last().tutorId === "TID20260001", "agency charge from the tutor, with a next payment date");
await startAdminFlow(wa, EID, "pay"); await say("DID20260007"); await say("", "pm_kind:payout"); await say("900"); await say("", "pm_ptype:advance"); await say("offline"); await say("", "pm_today"); await say("", "pm_skip"); await say("", "ad_yes");
assert(last().transactionType === "payout" && last().paymentType === "advance" && last().paymentMode === "Offline", "payout to the tutor (mode typed instead of tapped)");

// ---- leaving
await startAdminFlow(wa, EID, "assign");
o = await handleInput(wa, { text: "Hi" });
assert(o === null && !db.bot_sessions.length, "Hi leaves an admin flow and shows the menu");
