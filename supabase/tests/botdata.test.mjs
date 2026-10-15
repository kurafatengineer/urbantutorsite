globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "http://db", SUPABASE_SERVICE_ROLE_KEY: "k" }[k]) } };
const T = { tuitions: [
  { demo_id: "D1", subject: "Maths", student_id: "S1" }, { demo_id: "D2", subject: "Physics", student_id: "S1" },
  { demo_id: "D3", subject: "Chem", student_id: "S1" }, { demo_id: "D4", subject: "Bio", student_id: "S1" }, { demo_id: "D5", subject: "Eng", student_id: "S1" }],
  apps: [
  { demo_id: "D1", tutor_id: "T1", parent_accepted: true, tutor_accepted: true, demo_date: "2026-10-01" },
  { demo_id: "D2", tutor_id: "T1", demo_date: "2026-10-20" },
  { demo_id: "D3", tutor_id: "T1" }, { demo_id: "D3", tutor_id: "T2" },
  { demo_id: "D4", tutor_id: "T1", parent_accepted: true, tutor_accepted: true, demo_date: "2026-09-01", classes_completed: true },
  { demo_id: "D5", tutor_id: "T9", parent_rejected: true }],
  students: [{ student_id: "S1", student_name: "Rahul" }] };
globalThis.fetch = async (url) => {
  const u = new URL(url); const p = u.pathname.replace("/rest/v1/", "");
  const ok = (b) => ({ ok: true, json: async () => b });
  if (p === "tuitions") return ok(T.tuitions);
  if (p === "applications") { const t = u.searchParams.get("tutor_id"); return ok(t ? T.apps.filter((a) => t.includes(`"${a.tutor_id}"`)) : T.apps); }
  if (p === "students") return ok(T.students);
  throw new Error(p);
};
const { loadLife, accountsByPhone } = await import("./build/botdata.mjs");
const cats = (l) => l.map((x) => `${x.demo}:${x.cat}:${x.apps.length}`).join(" ");
const s = await loadLife("s", ["S1"]); console.log("student ", cats(s));
const t = await loadLife("t", ["T1"]); console.log("tutor   ", cats(t), "| student of D1 =", t[0]?.student?.student_name);
const ok = cats(s) === "D1:running:1 D2:scheduled:1 D3:new:2 D4:completed:1 D5:new:0" && cats(t) === "D1:running:1 D2:scheduled:1 D3:new:1 D4:completed:1" && t[0].student?.student_name === "Rahul";
console.log(ok ? "ok  : categories as expected" : "FAIL"); process.exitCode = ok ? 0 : 1;
console.log("short phone ->", JSON.stringify(await accountsByPhone("12345")));

// "Hi, parent" + which child to continue with
const { pickerText } = await import("./build/botdata.mjs");
const kids = (n) => ["Priyanka Shukla", "Mohit Kumar", "Rahul Kumar", "Mohan Kumar"].slice(0, n).map((x, i) => ({ student_id: "SID" + i, student_name: x, parents_name: i ? "" : "Ramesh Shukla" }));
const p2 = pickerText(kids(2)), p3 = pickerText(kids(3)), p4 = pickerText(kids(4));
console.log(p3 + "\n--\n" + p4);
if (p2 !== "Hi,\n*Ramesh Shukla*\n\nDo you want to continue with *Priyanka Shukla* or *Mohit Kumar*?") { console.log("FAIL: picker 2", p2); process.exitCode = 1; }
if (!p3.endsWith("*Priyanka Shukla*, *Mohit Kumar* or *Rahul Kumar*?") || p3.includes("menu")) { console.log("FAIL: picker 3"); process.exitCode = 1; }
if (!p4.includes("*Rahul Kumar* or *Mohan Kumar*?") || !p4.includes("*Students* menu") || p4.includes("SID")) { console.log("FAIL: picker 4"); process.exitCode = 1; }
if (!pickerText([{ student_id: "S", student_name: "A" }, { student_id: "T", student_name: "B" }]).startsWith("Hi,\n\nDo you")) { console.log("FAIL: no parent"); process.exitCode = 1; }
if (!pickerText(kids(4), "tg").endsWith("Tap the student's name below.") || pickerText(kids(3), "tg") !== p3) { console.log("FAIL: picker tg"); process.exitCode = 1; }
