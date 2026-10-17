globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "http://db", SUPABASE_SERVICE_ROLE_KEY: "k", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "123" }[k]) } };
const db = {
  setting: { enabled: true, agency_phone: "+91 90018 00307" },
  tuitions: [{ demo_id: "DID20260007", subject: "Maths", medium: "Home", student_id: "SID20260013" }],
  students: [{ student_id: "SID20260013", student_name: "Rahul Sharma", parents_name: "Ravindra Kumar", phone: "9876543210", whatsapp: "9876543211", phone10: "9876543210", whatsapp10: "9876543211", address: "12 Park Street", city: "Jaipur", pin_code: "302001" }],
  tutors: [
    { tutor_id: "TID20260001", full_name: "Anita Verma", gender: "Female", experience_years: 5, mobile_number: "9111111111", whatsapp_number: "9111111112", mobile10: "9111111111", whatsapp10: "9111111112", email: "a@x.com" },
    { tutor_id: "TID20260002", full_name: "Rohit Singh", gender: "Male", experience_years: 1, mobile_number: "9222222222", whatsapp_number: "", mobile10: "9222222222", whatsapp10: "", email: "r@x.com" },
  ],
  applications: [{ id: 1, demo_id: "DID20260007", tutor_id: "TID20260001", applied_at: "2026-10-10", parent_rejected: false, tutor_rejected: false }],
  rpc: [], sent: [],
};
globalThis.fetch = async (url, init = {}) => {
  const ok = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => "" });
  if (String(url).startsWith("https://graph.facebook.com")) { db.sent.push(JSON.parse(init.body)); return ok({}); }
  const u = new URL(url); const path = u.pathname.replace("/rest/v1/", "");
  const g = (k) => u.searchParams.get(k) || "";
  const eq = (k) => decodeURIComponent(g(k).replace("eq.", ""));
  const inn = (k, v) => decodeURIComponent(g(k)).includes(`"${v}"`);
  if (path === "app_settings") return ok([{ value: db.setting }]);
  if (path === "tuitions") return ok(db.tuitions.filter((t) => t.demo_id === eq("demo_id")));
  if (path === "students") {
    if (g("student_id")) return ok(db.students.filter((s) => s.student_id === eq("student_id")));
    if (g("phone10")) return ok(db.students.filter((s) => s.phone10 === eq("phone10")));
    if (g("whatsapp10")) return ok(db.students.filter((s) => s.whatsapp10 === eq("whatsapp10")));
    return ok([]);
  }
  if (path === "tutors") {
    if (g("tutor_id").startsWith("eq.")) return ok(db.tutors.filter((t) => t.tutor_id === eq("tutor_id")));
    if (g("tutor_id").startsWith("in.")) return ok(db.tutors.filter((t) => inn("tutor_id", t.tutor_id)));
    return ok([]);
  }
  if (path === "applications") {
    const rows = db.applications.filter((a) => a.demo_id === eq("demo_id"));
    return ok(g("order").startsWith("applied_at.desc") ? [...rows].sort((a, b) => String(b.applied_at).localeCompare(String(a.applied_at)) || b.id - a.id) : rows);
  }
  if (path === "rpc/bot_mark_class") { const b = JSON.parse(init.body); db.rpc.push(b); return ok({ success: true, minutes: 60, already: !!db.already }); }
  throw new Error("unexpected " + url);
};
const w = await import("./build/wasend.mjs?on");
const assert = (c, msg) => { if (!c) { console.log("FAIL:", msg); process.exitCode = 1; } else console.log("ok  :", msg); };
const body = (m) => m.template.components.find((c) => c.type === "body").parameters.map((p) => p.text);
const buttons = (m) => m.template.components.filter((c) => c.type === "button").map((c) => c.parameters[0].payload);
const last = () => db.sent.at(-1);
const row = { demo_id: "DID20260007", tutor_id: "TID20260001", class_time: "19:30", minutes: 90, class_date: "2026-10-18" };

// class reminder
await w.waClassReminder(row, "tutor");
let m = last();
assert(m.to === "919111111112" && m.template.name === "class_reminder_tutor" && m.template.language.code === "en", "tutor reminder: to the tutor's WhatsApp number, right template + language");
assert(body(m).length === 11 && body(m).join("|") === "Anita Verma|Maths|7:30 PM|90|DID20260007|Rahul Sharma|SID20260013|+91 98765 43211|+91 98765 43210|12 Park Street, Jaipur - 302001|+91 90018 00307", "tutor reminder: 11 variables in the agreed order (student WhatsApp, mobile, address, agency)");
await w.waClassReminder(row, "student");
m = last();
assert(m.to === "919876543211" && m.template.name === "class_reminder_student" && body(m).length === 10 && body(m).join("|") === "Ravindra Kumar|Maths|7:30 PM|90|DID20260007|Anita Verma|TID20260001|+91 91111 11112|+91 91111 11111|+91 90018 00307", "student reminder: 10 variables, tutor details, no tutor address");

// class check with Yes / No buttons
await w.waClassCheck(row);
m = last();
assert(m.template.name === "class_taken_check" && body(m).length === 10 && body(m)[4] === "90" && body(m)[9] === "90" && body(m)[3] === "7:30 PM", "class check: 10 variables, duration twice");
assert(buttons(m).join(",") === "cl:y:DID20260007:TID20260001:2026-10-18,cl:n:DID20260007:TID20260001:2026-10-18", "class check: Yes / No button payloads carry the tuition, tutor and day");

// tutor with only a mobile number: both lines show it
await w.waClassReminder({ ...row, tutor_id: "TID20260002" }, "student");
assert(body(last())[7] === "+91 92222 22222" && body(last())[8] === "+91 92222 22222", "no WhatsApp number: the mobile number is shown on both lines");

// tutor applied: the first one, then a later one
await w.waTutorApplied("DID20260007", "TID20260001");
m = last();
assert(m.template.name === "new_tutor_applied_first" && body(m).length === 8 && !buttons(m).length && body(m)[5] === "Female" && body(m)[6] === "5 Years", "first tutor: template without a button, 8 variables");
db.applications.push({ id: 2, demo_id: "DID20260007", tutor_id: "TID20260002", applied_at: "2026-10-12", parent_rejected: false, tutor_rejected: false });
await w.waTutorApplied("DID20260007", "TID20260002");
m = last();
assert(m.template.name === "new_tutor_applied" && body(m).length === 9 && body(m)[7] === "2" && body(m)[6] === "1 Year" && buttons(m).join() === "tl:DID20260007", "second tutor: template with Check All Tutors button, total 2, 1 Year");
db.applications.push({ id: 3, demo_id: "DID20260007", tutor_id: "TIDX", applied_at: "2026-10-13", parent_rejected: true, tutor_rejected: false });
await w.waTutorApplied("DID20260007", "TID20260002");
assert(body(last())[7] === "2", "a rejected tutor is not counted");
db.applications.pop();

// demo scheduled: both get one
db.sent.length = 0;
await w.waDemoScheduled("DID20260007", "TID20260001", "2026-10-18", "17:30");
assert(db.sent.length === 2 && db.sent.map((x) => x.template.name).sort().join() === "demo_scheduled_student,demo_scheduled_tutor", "demo scheduled: a message each to the parent and the tutor");
const dt = db.sent.find((x) => x.template.name === "demo_scheduled_tutor"), ds = db.sent.find((x) => x.template.name === "demo_scheduled_student");
assert(body(dt).length === 12 && body(dt).slice(0, 6).join("|") === "Anita Verma|Maths|DID20260007|18 October 2026|5:30 PM|Home" && body(dt)[10] === "12 Park Street, Jaipur - 302001", "tutor demo message: 12 variables, student address included");
assert(body(ds).length === 11 && body(ds)[6] === "Anita Verma" && !body(ds).some((x) => x.includes("Park")), "student demo message: 11 variables, no tutor address");

// variables: no new lines, never empty
db.students[0].address = "12 Park\nStreet\n\nNear Mall";
await w.waDemoScheduled("DID20260007", "TID20260001", "2026-10-18", "17:30");
assert(!body(db.sent.at(-2)).concat(body(db.sent.at(-1))).some((x) => /[\n\t]/.test(x)), "new lines in an address are turned into commas");
db.students[0].address = "12 Park Street";

// button taps
db.sent.length = 0;
await w.handleTemplateButton("919999999999", "cl:y:DID20260007:TID20260001:2026-10-18");
assert(!db.rpc.length && last().type === "text" && last().text.body.includes("not for your number"), "Yes from another number is refused");
db.sent.length = 0;
await w.handleTemplateButton("919111111112", "cl:y:DID20260007:TID20260001:2026-10-18");
assert(db.rpc.at(-1).p_email === "a@x.com" && db.rpc.at(-1).p_date === "2026-10-18", "Yes: the day is marked through bot_mark_class");
assert(db.sent[0].type === "text" && db.sent[0].text.body.startsWith("Thank you. Your class has been recorded.") && db.sent[1].template.name === "class_done_student" && body(db.sent[1]).length === 10, "Yes: tutor thanked, parent gets the class-conducted template");
assert(body(db.sent[1])[2] === "18 October 2026" && body(db.sent[1])[3] === "60", "class done: date and the recorded duration");
db.sent.length = 0; db.already = true;
await w.handleTemplateButton("919111111112", "cl:y:DID20260007:TID20260001:2026-10-18");
assert(db.sent.length === 1 && db.sent[0].type === "text", "Yes twice: no second message to the parent");
db.sent.length = 0;
await w.handleTemplateButton("919111111112", "cl:n:DID20260007:TID20260001:2026-10-18");
assert(db.sent.length === 1 && db.sent[0].text.body.includes("+91 90018 00307") && db.sent[0].text.body.includes("contact your agency"), "No: tutor is told to contact the agency, parent hears nothing");

db.sent.length = 0;
await w.handleTemplateButton("919000000000", "tl:DID20260007");
assert(db.sent[0].text.body.includes("not for your number"), "Check All Tutors from another number is refused");
db.sent.length = 0;
await w.handleTemplateButton("919876543211", "tl:DID20260007");
const list = db.sent[0].text.body;
assert(db.sent.length === 1 && list.includes("*Total Tutors:* 2") && list.indexOf("Rohit Singh") < list.indexOf("Anita Verma") && list.includes("*1. Rohit Singh* 🆕") && list.includes("Experience: 1 Year") && list.includes("+91 90018 00307"), "Check All Tutors: newest first, count, details, agency number");
for (let i = 0; i < 60; i++) db.applications.push({ id: 100 + i, demo_id: "DID20260007", tutor_id: "TID20260001", applied_at: "2026-10-0" + (i % 9 + 1), parent_rejected: false, tutor_rejected: false });
db.sent.length = 0;
await w.handleTemplateButton("919876543211", "tl:DID20260007");
assert(db.sent.length > 1 && db.sent.every((x) => x.text.body.length <= 4096), "many tutors: the list is split into several messages");
assert(await w.handleTemplateButton("919876543211", "zz:1") === false, "an unknown button is left to the normal bot");

// off: nothing is sent
db.setting = { enabled: false };
const off = await import("./build/wasend.mjs?off");
db.sent.length = 0;
await off.waClassReminder(row, "tutor");
await off.waDemoScheduled("DID20260007", "TID20260001", "2026-10-18", "17:30");
assert(!db.sent.length, "switch off (default): nothing is sent");

// a student who muted notifications gets nothing
db.setting = { enabled: true };
db.students[0].notifications_off = true;
const on2 = await import("./build/wasend.mjs?muted");
db.sent.length = 0;
await on2.waClassReminder(row, "student");
await on2.waTutorApplied("DID20260007", "TID20260001");
assert(!db.sent.length, "muted student: no reminder, no tutor-applied message");
