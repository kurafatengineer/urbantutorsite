globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "http://db", SUPABASE_SERVICE_ROLE_KEY: "k" }[k]) } };
const db = {
  bot_sessions: [],
  tutors: [{ tutor_id: "TID1", email: "amit@x.com", full_name: "Amit Singh", gender: "Male", experience_years: 3 }],
  tuitions: [
    { demo_id: "DID20260007", subject: "English", medium: "Home", student_id: "SID1", preferred_tutor: "Any" },
    { demo_id: "DID20260008", subject: "Maths", medium: "Online", student_id: "SID1", preferred_tutor: "Female" },
  ],
  students: [{ student_id: "SID1", student_name: "Priyanka Shukla", email: "p@x.com", class_name: "10th", board: "CBSE", city: "Patna", pin_code: "800001" }],
  applied: [], calls: [],
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
  if (path === "tutors") return ok(db.tutors.filter((t) => (u.searchParams.get("tutor_id") || "").includes(t.tutor_id)));
  if (path === "tuitions") return ok(db.tuitions.filter((t) => t.demo_id === eq("demo_id")));
  if (path === "students") return ok(db.students.filter((s) => s.student_id === eq("student_id")));
  if (path === "app_settings" || path === "applications") return ok([]);
  if (path === "rpc/bot_apply_for_tuition") {
    const b = JSON.parse(init.body); db.calls.push(b);
    const t = db.tuitions.find((x) => x.demo_id === b.p_demo_id);
    if (!t) return ok({ success: false, notFound: true });
    const me = db.tutors.find((x) => x.email === b.p_email);
    if (["Male", "Female"].includes(t.preferred_tutor) && me.gender !== t.preferred_tutor) return ok({ success: false, genderMismatch: true, needed: t.preferred_tutor });
    if (db.applied.includes(t.demo_id)) return ok({ success: true, alreadyApplied: true });
    db.applied.push(t.demo_id); return ok({ success: true });
  }
  throw new Error("unexpected " + m + " " + url);
};
const { handleInput } = await import("./build/regflow.mjs");
const { startApply } = await import("./build/applyflow.mjs");
const { sent } = await import("./build/telegram.mjs");
const assert = (c, msg) => { if (!c) { console.log("FAIL:", msg); process.exitCode = 1; } else console.log("ok  :", msg); };
const step = () => db.bot_sessions[0]?.step;

const wa = { channel: "wa", key: "9000000001" };
let o = await startApply(wa, [{ tutor_id: "TID1" }]);
assert(step() === "a_id" && o[0].text.includes("starts with *DID* followed by *8 digits*") && o[0].text.includes("DID20260007"), "asks for the Tuition ID, explains DID + 8 digits");
assert(db.bot_sessions[0].data.email === "amit@x.com", "the tutor's own email is kept in the session");
o = await handleInput(wa, { text: "DID2026" });
assert(o[0].text.includes("not a valid") && step() === "a_id" && !db.calls.length, "short ID refused without calling the database");
o = await handleInput(wa, { text: "did 2026 0008" });
assert(db.calls.at(-1).p_demo_id === "DID20260008" && o[0].text.includes("only for *female* tutors") && step() === "a_id", "spaces/case cleaned; gender mismatch refused, can try another ID");
assert(!sent.length, "no mail to the parent after a refusal");
o = await handleInput(wa, { text: "DID99999999" });
assert(o[0].text.includes("No tuition was found") && step() === "a_id", "unknown ID refused");
o = await handleInput(wa, { text: "DID20260007" });
assert(o[0].text.startsWith("*Applied successfully!*") && o[0].text.includes("*English* (DID20260007)") && o[0].text.includes("Class: 10th · CBSE") && o[0].text.includes("Area: Patna - 800001"), "applied: subject, ID, class and area shown");
assert(!db.bot_sessions.length, "session cleared after applying");
assert(sent.length === 1 && sent[0].email === "p@x.com" && sent[0].mail.d.tutorName === "Amit Singh", "parent told: a tutor applied");
await startApply(wa, [{ tutor_id: "TID1" }]);
o = await handleInput(wa, { text: "DID20260007" });
assert(o[0].text.includes("already applied") && sent.length === 1, "second time: already applied, no second mail");
o = await handleInput(wa, { text: "Hi" });
assert(o === null && !db.bot_sessions.length, "Hi leaves the flow");
o = await startApply(wa, [{ tutor_id: "TID1", blocked_at: "x" }]);
assert(o[0].text.includes("blocked") && !db.bot_sessions.length, "blocked tutor cannot apply");
