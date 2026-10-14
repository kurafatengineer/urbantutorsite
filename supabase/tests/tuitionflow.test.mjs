globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "http://db", SUPABASE_SERVICE_ROLE_KEY: "k" }[k]) } };
const db = {
  bot_sessions: [],
  students: [{ student_id: "SID1", student_name: "Rahul", email: "r@x.com" }, { student_id: "SID2", student_name: "Riya", email: "r@x.com", blocked_at: null }],
  tuitions: [{ demo_id: "DID1", student_id: "SID1", subject: "Maths", terminated: false }],
  status: { DID1: "Finding Tutor" }, next: 100,
};
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const path = u.pathname.replace("/rest/v1/", ""); const m = (init.method || "GET").toUpperCase();
  const ok = (b) => ({ ok: true, status: 200, json: async () => b });
  const eq = (k) => decodeURIComponent(u.searchParams.get(k)?.replace("eq.", "") || "");
  if (path === "bot_sessions") {
    const ch = eq("channel"), key = eq("chat_key");
    if (m === "GET") return ok(db.bot_sessions.filter((r) => r.channel === ch && r.chat_key === key));
    if (m === "POST") { const b = JSON.parse(init.body); db.bot_sessions = db.bot_sessions.filter((r) => !(r.channel === b.channel && r.chat_key === b.chat_key)); db.bot_sessions.push(b); return ok([]); }
    if (m === "DELETE") { db.bot_sessions = db.bot_sessions.filter((r) => !(r.channel === ch && r.chat_key === key)); return ok([]); }
  }
  if (path === "students") return ok(db.students.filter((s) => s.student_id === eq("student_id")));
  if (path === "tuitions" && m === "GET") return ok(db.tuitions.filter((t) => t.student_id === eq("student_id") && !t.terminated));
  if (path === "tuitions" && m === "POST") { const b = JSON.parse(init.body); db.tuitions.push(b); return ok([b]); }
  if (path === "rpc/generate_demo_id") return ok("DID" + db.next++);
  if (path === "rpc/tuition_status") return ok(db.status[JSON.parse(init.body).p_demo_id] ?? "Finding Tutor");
  throw new Error("unexpected " + m + " " + url);
};
const { handleInput } = await import("./build/regflow.mjs");
const { startTuition } = await import("./build/tuitionflow.mjs");
const { sent } = await import("./build/telegram.mjs");
const assert = (c, msg) => { if (!c) { console.log("FAIL:", msg); process.exitCode = 1; } else console.log("ok  :", msg); };
const step = () => db.bot_sessions[0]?.step;

const wa = { channel: "wa", key: "9876543210" };
const mine = [{ student_id: "SID1", student_name: "Rahul" }, { student_id: "SID2", student_name: "Riya" }];
let o = await startTuition(wa, mine);
assert(step() === "t_pick" && o[0].choices.length === 3, "two students -> pick one (+ Cancel)");
o = await handleInput(wa, { choice: "t_pick:SID999" }); assert(step() === "t_pick", "a student not on the list is refused");
await handleInput(wa, { choice: "t_pick:SID1" }); assert(step() === "t_subjects", "picked -> subjects");
o = await handleInput(wa, { text: "maths, science" }); assert(o[0].text.includes("Maths") && step() === "t_subjects", "running subject refused");
await handleInput(wa, { text: "english,  science , English" }); assert(JSON.stringify(db.bot_sessions[0].data.subjects) === '["English","Science"]', "subjects split, title-cased, de-duplicated");
o = await handleInput(wa, { text: "x" }); assert(step() === "t_timing", "time too short refused");
await handleInput(wa, { text: "6 pm - 8 pm" }); assert(step() === "t_tutor" && db.bot_sessions[0].data.timing === "6 pm - 8 pm", "typed time saved");
await handleInput(wa, { choice: "t_tutor:female" }); await handleInput(wa, { choice: "t_mode:home" });
assert(step() === "t_confirm", "-> confirm");
o = await handleInput(wa, { choice: "t_post" });
const added = db.tuitions.filter((t) => t.student_id === "SID1" && t.demo_id !== "DID1");
assert(added.length === 2 && added[0].preferred_tutor === "Female" && added[0].medium === "Home" && added[0].preferred_timing === "6 pm - 8 pm", "two tuitions saved");
assert(o[0].text.includes("Tuition: *English* (DID100)\nTutor - Female") && o[0].text.includes("(DID101)") && o[0].text.includes("*Rahul* (SID1)") && db.bot_sessions.length === 0, "posted message + session cleared");
assert(sent.length === 1 && sent[0].email === "r@x.com" && sent[0].mail.d.demos.length === 2, "tuition-posted notice sent once");

// one student -> straight to subjects; slot button; Hi leaves the flow
await startTuition(wa, [mine[1]]); assert(step() === "t_subjects", "one student -> subjects");
o = await handleInput(wa, { text: "physics" }); assert(o[0].text.includes("For example") && !o[0].choices, "time is typed, no buttons");
assert((await handleInput(wa, { text: "Hi" })) === null && db.bot_sessions.length === 0, "Hi leaves the flow");
o = await startTuition(wa, [{ student_id: "SID3", student_name: "X", blocked_at: "2026-01-01" }]); assert(o[0].text.includes("blocked"), "blocked student cannot post");
await startTuition(wa, [mine[0]]); o = await handleInput(wa, { text: "cancel" }); assert(o[0].text.startsWith("Cancelled") && db.bot_sessions.length === 0, "cancel");
