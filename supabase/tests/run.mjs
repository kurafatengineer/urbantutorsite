// Checks the chat-registration flow and the bot menu logic against a pretend database (no network, no Supabase).
// Run from the repo root:   NODE_PATH=$(npm root -g) node supabase/tests/run.mjs        (needs `npm i -g typescript`)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const here = dirname(fileURLToPath(import.meta.url));
const shared = join(here, "..", "functions", "_shared");
const out = join(here, "build");
mkdirSync(out, { recursive: true });

for (const f of ["botdata", "session", "regflow", "tuitionflow", "constants", "format"]) {
  const js = ts.transpileModule(readFileSync(join(shared, f + ".ts"), "utf8"), { compilerOptions: { target: "ES2022", module: "ESNext" } }).outputText;
  writeFileSync(join(out, f + ".mjs"), js.replace(/from "\.\/(\w+)\.ts"/g, 'from "./$1.mjs"'));
}
// the real email.ts needs nodemailer and Gmail: a pretend one that remembers what would be sent
writeFileSync(join(out, "email.mjs"), "export const mails=[];export const emailTemplate=(o)=>o.intro;export async function sendMail(to,subject,html,opts){mails.push({to,subject,html,opts});}");

// the real mails.ts / telegram.ts send mail and Telegram messages: pretend ones that remember what would go out
writeFileSync(join(out, "mails.mjs"), "export const tuitionPostedMail=(d)=>({subject:'posted',d});");
writeFileSync(join(out, "telegram.mjs"), "export const sent=[];export async function notify(email,mail){sent.push({email,mail});}export async function studentQuiet(){return false;}");

let failed = 0;
for (const t of ["regflow.test.mjs", "tuitionflow.test.mjs", "botdata.test.mjs"]) {
  console.log("\n== " + t);
  const r = spawnSync("node", [join(here, t)], { stdio: "inherit" });
  if (r.status) failed++;
}
console.log(failed ? `\n${failed} test file(s) FAILED` : "\nAll good.");
process.exit(failed ? 1 : 0);
