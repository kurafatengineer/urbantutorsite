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
