globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "http://db", SUPABASE_SERVICE_ROLE_KEY: "k" }[k]) } };
const db = { bot_sessions: [], students: [{ student_id: "SID1", phone10: "9999900000", whatsapp10: "", email_lc: "taken@x.com", parents_name: "Ravindra Kumar", email: "taken@x.com", phone: "9999900000", city: "Patna", pin_code: "800001", address: "12 Main Road" }], registered: [] };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const path = u.pathname.replace("/rest/v1/", ""); const m = (init.method || "GET").toUpperCase();
  const ok = (b) => ({ ok: true, status: 200, json: async () => b });
  if (path === "bot_sessions") {
    const ch = u.searchParams.get("channel")?.replace("eq.", ""), key = decodeURIComponent(u.searchParams.get("chat_key")?.replace("eq.", "") || "");
    if (m === "GET") return ok(db.bot_sessions.filter((r) => r.channel === ch && r.chat_key === key));
    if (m === "POST") { const b = JSON.parse(init.body); db.bot_sessions = db.bot_sessions.filter((r) => !(r.channel === b.channel && r.chat_key === b.chat_key)); db.bot_sessions.push(b); return ok([]); }
    if (m === "DELETE") { db.bot_sessions = db.bot_sessions.filter((r) => !(r.channel === ch && r.chat_key === key)); return ok([]); }
  }
  if (path === "students") {
    const e = u.searchParams.get("email_lc"); if (e) return ok(db.students.filter((s) => "eq." + s.email_lc === e));
    const sid = u.searchParams.get("student_id");
    if (sid && m === "GET") return ok(db.students.filter((s) => sid.includes(s.student_id)));
    const or = u.searchParams.get("or"); if (or) { const p = or.match(/phone10\.eq\.(\d+)/)[1]; return ok(db.students.filter((s) => s.phone10 === p || s.whatsapp10 === p)); }
    if (m === "PATCH") { db.patched = JSON.parse(init.body); return ok([]); }
  }
  if (path === "rpc/admin_register_student") { const p = JSON.parse(init.body).p; db.registered.push(p); db.students.push({ student_id: "SID9", phone10: p.phone, whatsapp10: p.phone, email_lc: p.email }); return ok({ success: true, studentId: "SID9" }); }
  throw new Error("unexpected " + m + " " + url);
};
const { handleInput, startAddChild, startRegistration } = await import("./build/regflow.mjs");
const { mails } = await import("./build/email.mjs");
const assert = (c, msg) => { if (!c) { console.log("FAIL:", msg); process.exitCode = 1; } else console.log("ok  :", msg); };
const say = async (ctx, input) => (await handleInput(ctx, input)).map((o) => o.text.split("\n")[0].slice(0, 60) + (o.choices ? " [" + o.choices.map((c) => c.id).join("|") + "]" : "") + (o.askPhone ? " [askPhone]" : ""));

// --- WhatsApp: sender number known
const wa = { channel: "wa", key: "9876543210", verifiedPhone: "919876543210" };
let o = await startRegistration(wa); assert(o[0].text.includes("parent's name"), "wa start asks parent name");
await handleInput(wa, { text: "rupu kumhar" }); await handleInput(wa, { text: "rahul kumar" });
assert(db.bot_sessions[0].step === "email", "wa skips phone step -> email");
o = await handleInput(wa, { text: "taken@x.com" }); assert(o[0].text.includes("already registered") && db.bot_sessions[0].step === "email", "wa duplicate email refused");
o = await handleInput(wa, { text: "new@x.com" }); assert(db.bot_sessions[0].step === "otp" && mails.length === 1 && mails[0].opts?.always === true, "wa OTP mailed with always:true");
const code = mails[0].html.match(/code is (\d{6})/)[1];
o = await handleInput(wa, { text: "000000" }); assert(o[0].text.includes("not correct"), "wrong code rejected");
o = await handleInput(wa, { text: code }); assert(db.bot_sessions[0].step === "gender", "right code -> gender");
await handleInput(wa, { choice: "gender:Male" }); await handleInput(wa, { text: "12th" }); await handleInput(wa, { text: "lbs school" }); await handleInput(wa, { text: "CBSE" }); await handleInput(wa, { text: "new delhi" });
o = await handleInput(wa, { text: "12345" }); assert(o[0].text.includes("6 digits"), "bad PIN rejected");
await handleInput(wa, { text: "110009" }); await handleInput(wa, { text: "12 main street delhi" }); await handleInput(wa, { choice: "terms:yes" });
o = await handleInput(wa, { choice: "confirm:yes" });
assert(db.registered.length === 1 && db.registered[0].phone === "9876543210" && db.registered[0].email === "new@x.com" && db.registered[0].parentsName === "Rupu Kumhar", "wa registered with normalized data");
assert(o[0].text.includes("SID9"), "wa success message");
assert(db.patched === undefined, "wa does not touch telegram_chat_id");
await handleInput(wa, { choice: "tuition:no" }); assert(db.bot_sessions.length === 0, "session cleared at the end");

// --- Telegram: needs contact
const tg = { channel: "tg", key: "555", telegramChatId: 555 };
await startRegistration(tg); await handleInput(tg, { text: "a b" }); await handleInput(tg, { text: "c d" });
assert(db.bot_sessions[0].step === "phone", "tg asks for the number");
o = await handleInput(tg, { text: "9123456780" }); assert(o[0].askPhone === true, "typed number not accepted");
o = await handleInput(tg, { contactPhone: "+91 99999 00000" }); assert(o[0].text.includes("already registered") && db.bot_sessions.length === 0, "tg duplicate phone refused + session cleared");
await startRegistration(tg); await handleInput(tg, { text: "a b" }); await handleInput(tg, { text: "c d" });
await handleInput(tg, { contactPhone: "+91 91234 56780" }); assert(db.bot_sessions[0].step === "email", "tg contact accepted -> email");
const o2 = await handleInput(tg, { text: "tg@x.com" }); const code2 = mails.at(-1).html.match(/code is (\d{6})/)[1];
await handleInput(tg, { text: code2 });
for (const x of [{ choice: "gender:Female" }, { text: "10th" }, { text: "xyz school" }, { text: "ICSE" }, { text: "mumbai" }, { text: "400001" }, { text: "some address here" }, { choice: "terms:yes" }, { choice: "confirm:yes" }]) await handleInput(tg, x);
assert(db.registered.length === 2 && db.patched?.telegram_chat_id === 555, "tg registered and chat linked");
// cancel
await startRegistration(tg); o = await handleInput(tg, { text: "cancel" }); assert(o[0].text.includes("cancelled") && db.bot_sessions.length === 0, "cancel clears the session");
assert((await handleInput(tg, { text: "hi" })) === null, "no session -> null (normal bot flow continues)");

// --- Add New Child: a sibling on an account we already know
const mailsBefore = mails.length;
const wa2 = { channel: "wa", key: "9999900000", verifiedPhone: "919999900000" };
let c = await startAddChild(wa2, [{ student_id: "SID1" }]);
assert(c[0].text.includes("Add a New Child") && c[0].text.includes("Ravindra Kumar") && c[0].text.includes("new student's name"), "add child asks only the new name");
await handleInput(wa2, { text: "priyanka shukla" });
assert(db.bot_sessions.at(-1).step === "gender", "add child: name -> gender (no number, email or OTP)");
await handleInput(wa2, { choice: "gender:Female" }); await handleInput(wa2, { text: "9th" }); await handleInput(wa2, { text: "dav school" });
c = await handleInput(wa2, { text: "CBSE" });
assert(c[0].text.includes("check the new child") && db.bot_sessions.at(-1).step === "confirm", "add child: board -> confirm");
c = await handleInput(wa2, { choice: "confirm:yes" });
const added = db.registered.at(-1);
assert(added.studentName === "Priyanka Shukla" && added.email === "taken@x.com" && added.phone === "9999900000", "add child reuses the parent's email and number");
assert(added.parentsName === "Ravindra Kumar" && added.city === "Patna" && added.pinCode === "800001" && added.address === "12 Main Road", "add child reuses the parent's name and address");
assert(mails.length === mailsBefore, "add child sends no verification code");
assert(c[0].text.includes("Priyanka Shukla has been added") && c[0].text.includes("SID9"), "add child success message");
await handleInput(wa2, { choice: "tuition:no" }); assert(db.bot_sessions.length === 0, "add child session cleared");
c = await startAddChild(wa2, [{ student_id: "SID1", blocked_at: "x" }]);
assert(c[0].text.includes("could not add a child"), "blocked account cannot add a child");
