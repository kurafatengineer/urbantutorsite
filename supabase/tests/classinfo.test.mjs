globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "http://db", SUPABASE_SERVICE_ROLE_KEY: "k" }[k]) } };
globalThis.fetch = async (url) => {
  const path = new URL(url).pathname.replace("/rest/v1/", "");
  const ok = (b) => ({ ok: true, status: 200, json: async () => b });
  if (path === "tutors") return ok([{ tutor_id: "TID1", full_name: "Amit Singh", gender: "Male", mobile_number: "9000000001" }]);
  throw new Error("unexpected " + url);
};
const { runningDetail, demoDetail, people } = await import("./build/classinfo.mjs");
const assert = (c, msg) => { if (!c) { console.log("FAIL:", msg); process.exitCode = 1; } else console.log("ok  :", msg); };

const deal = { model: "commission", monthlyFee: 6000, feeTo: "Tutor", cutType: "percent", cutValue: 20, parentFreq: "Monthly", tutorFreq: "Monthly", minutes: 60, time: "17:00", finalizedAt: "x" };
const dates = ["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14"];
const l = { demo: "DID1", subject: "Maths", mode: "Home", cat: "running", app: { tutor_id: "TID1", billing_plan: { deal }, class_dates: dates, class_start_date: "2026-10-05" }, apps: [], tutorIds: ["TID1"], student: null };
const who = await people("s", [l]);
const t = runningDetail("s", l, who);
console.log(t);
assert(t.includes("*Maths* (DID1)") && t.includes("Tutor: *Amit Singh*") && t.includes("Class days: Mon, Wed"), "running: head, tutor, days");
assert(t.includes("Monthly fee: *Rs 6000*") && t.includes("Pay to: The tutor directly") && !t.includes("commission"), "parent sees fee, no agency cut");
const t2 = runningDetail("s", { ...l, app: { ...l.app, billing_plan: {} } }, who);
assert(t2.includes("shared by the agency soon"), "no deal yet -> soon");
const d = demoDetail("s", { ...l, cat: "scheduled", app: { tutor_id: "TID1", demo_date: "2026-10-20", demo_time: "17:00" } }, who);
assert(d.includes("Demo: *20 October 2026, 5:00 PM*") && d.includes("Amit Singh"), "demo detail: when + tutor");
