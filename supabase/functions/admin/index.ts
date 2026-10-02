// =====================================================================
// URBANTUTORSITE - ADMIN PANEL SERVER  (Supabase Edge Function "admin")
//
// admin.html / admin.js talk ONLY to this function. It:
//   1. verifies the caller's Supabase Auth session (they signed in with
//      their own email + a one-time code emailed by Supabase, same as
//      students/tutors do elsewhere on the site)
//   2. looks up that email in admin_users to find their role, and
//      refuses anyone not listed there (or marked inactive)
//   3. runs every database change with the service role - the only
//      role allowed to touch these tables - after checking the
//      caller's role is allowed to run that particular action
//   4. turns each tutor's document paths into links that work for
//      1 hour (the documents are in private storage)
//
// Settings it reads (Supabase -> Edge Functions -> Secrets):
//   SUPABASE_URL               provided by Supabase automatically
//   SUPABASE_SERVICE_ROLE_KEY  provided by Supabase automatically
//
// Request (POST, JSON):  { action, ...fields }
//   Authorization: Bearer <supabase auth access token>
// Reply (JSON):          { success, message?, ... }
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMail } from "../_shared/email.ts";
import {
  demoScheduledMail, paymentReceivedMail, agencyChargeMail, payoutMail, subscriptionMail, tuitionPostedMail,
} from "../_shared/mails.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const DOC_LINK_SECONDS = 60 * 60;
const DOC_BUCKET = "tutor-documents";
const DOC_FIELDS = ["Identity Proof", "Profile Image"];

const ROLES = [
  "super_admin",
  "tuition_coordinator",
  "verification_staff",
  "accounts_finance",
  "tutor_relations",
] as const;
type Role = typeof ROLES[number];

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// deno-lint-ignore no-explicit-any
type Json = any;

function reply(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}


/* ------------------------------------------------------------------
   WHO IS CALLING
------------------------------------------------------------------ */

interface Caller {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  permissions: Set<string>;
  mailsEnabled: boolean;
}

interface AuthedUser { id: string; email: string; }

async function currentUser(authHeader: string | null): Promise<AuthedUser | null> {
  const token = (authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user?.email) return null;
  return { id: data.user.id, email: data.user.email.toLowerCase() };
}

// supabase-js has no "get user by email" admin call, so we page
// through users and match - fine for this site's small user count.
async function findAuthUserByEmail(email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function loadCaller(authHeader: string | null): Promise<Caller | "no-session" | "not-admin" | "bootstrap-needed"> {
  const user = await currentUser(authHeader);
  if (!user) return "no-session";

  const { data: row } = await db
    .from("admin_users")
    .select("id, email, full_name, role, active, permissions, mails_enabled")
    .ilike("email", user.email)
    .maybeSingle();

  if (row && row.active) {
    return {
      id: row.id, email: row.email, fullName: row.full_name, role: row.role as Role,
      permissions: new Set(effectivePermissions(row.role as Role, row.permissions)),
      mailsEnabled: row.mails_enabled !== false,
    };
  }

  const { count } = await db.from("admin_users").select("id", { count: "exact", head: true });
  if (!count) return "bootstrap-needed";

  return "not-admin";
}


/* ------------------------------------------------------------------
   PERMISSIONS
   Every employee has a set of individual permissions. A role is just a
   preset of them (ROLE_PRESETS); an employee whose `permissions` column
   is NULL gets their role's preset, anyone with an explicit list gets
   exactly that list. A Super Admin always has everything.
------------------------------------------------------------------ */

const READ_ONLY_ACTION = "adminGetOverview";

// What the "New Employee" checklist shows, in three columns of groups.
const PERMISSION_GROUPS = [
  { id: "tuitions", label: "Tuitions", items: [
    { key: "tuitions_view", label: "View tuitions" },
    { key: "tuitions_edit", label: "Edit tuition & demo details" },
    { key: "tuitions_assign_tutor", label: "Assign tutors" },
    { key: "tuitions_close", label: "Close / reopen tuitions" },
    { key: "tuitions_add", label: "Apply for new tuition for students" },
  ] },
  { id: "tutors", label: "Tutors", items: [
    { key: "tutors_view", label: "View tutors" },
    { key: "tutors_edit", label: "Edit tutor details" },
    { key: "tutors_verify", label: "Accept / Reject (verify) tutors" },
  ] },
  { id: "students", label: "Students", items: [
    { key: "students_view", label: "View students" },
    { key: "students_edit", label: "Edit student details" },
    { key: "students_add", label: "Register students (Add a Student)" },
  ] },
  { id: "payments", label: "Payments", items: [
    { key: "payments_view", label: "View Payments, Ledger & Graph" },
    { key: "payments_add", label: "Record payments" },
    { key: "payments_edit", label: "Edit payments" },
    { key: "payments_delete", label: "Delete payments" },
  ] },
  { id: "subscriptions", label: "Subscriptions", items: [
    { key: "subscriptions_add", label: "Create subscriptions" },
    { key: "subscriptions_edit", label: "Edit subscriptions" },
  ] },
  { id: "employees", label: "Employees", items: [
    { key: "employees_manage", label: "Manage employees & permissions" },
  ] },
  { id: "emails", label: "Emails", items: [
    { key: "mails_toggle", label: "Switch off emails for own updates (Emails On / Off)" },
  ] },
  // Restrictions, not grants: when ticked, every mobile / WhatsApp number
  // (or every street address) is masked in what this employee's panel
  // receives (see maskContacts).
  { id: "privacy", label: "Privacy", items: [
    { key: "hide_contacts", label: "Hide Mobile Number (mobile & WhatsApp, everywhere)" },
    { key: "hide_address", label: "Hide Address (student & tutor, everywhere)" },
  ] },
];

const ALL_PERMISSIONS: string[] = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

// Restrictions never come with a role or with Super Admin.
const RESTRICTION_PERMISSIONS = ["hide_contacts", "hide_address"];
const ALL_GRANTS: string[] = ALL_PERMISSIONS.filter((p) => !RESTRICTION_PERMISSIONS.includes(p));

// A permission that only makes sense with another one: ticking the child
// ticks the parent, and (server side, too) saving a child without its
// parent adds the parent.
const PERMISSION_PARENT: Record<string, string> = {
  tuitions_edit: "tuitions_view", tuitions_assign_tutor: "tuitions_view", tuitions_close: "tuitions_view",
  tutors_edit: "tutors_view", tutors_verify: "tutors_view",
  students_edit: "students_view", students_add: "students_view", tuitions_add: "students_view",
  payments_add: "payments_view", payments_edit: "payments_view", payments_delete: "payments_view",
  subscriptions_add: "payments_view", subscriptions_edit: "payments_view",
};

const ROLE_PRESETS: Record<Role, string[]> = {
  super_admin: ALL_GRANTS,
  tuition_coordinator: [
    "tuitions_view", "tuitions_edit", "tuitions_assign_tutor", "tuitions_close",
    "tutors_view", "tutors_edit", "students_view", "students_edit", "students_add", "tuitions_add",
  ],
  verification_staff: ["tutors_view", "tutors_verify"],
  accounts_finance: [
    "payments_view", "payments_add", "payments_edit", "payments_delete",
    "subscriptions_add", "subscriptions_edit",
  ],
  tutor_relations: ["tutors_view", "tutors_edit"],
};

function normalizePermissions(list: unknown): string[] {
  const wanted = new Set((Array.isArray(list) ? list : []).map(String).filter((p) => ALL_PERMISSIONS.includes(p)));
  for (const p of [...wanted]) if (PERMISSION_PARENT[p]) wanted.add(PERMISSION_PARENT[p]);
  return ALL_PERMISSIONS.filter((p) => wanted.has(p));
}

function effectivePermissions(role: Role, stored: unknown): string[] {
  if (role === "super_admin") return ALL_GRANTS;
  return Array.isArray(stored) ? normalizePermissions(stored) : ROLE_PRESETS[role] ?? [];
}

// Which permission each action needs. adminUpdateRecord is checked field
// by field below, and reading the overview is open to every employee.
const ACTION_PERMISSION: Record<string, string> = {
  adminUpdateTuition: "tuitions_edit",
  adminUpdateDemoRow: "tuitions_edit",
  adminAssignTutor: "tuitions_assign_tutor",
  adminSetTerminated: "tuitions_close",
  adminAddStudent: "students_add",
  adminAddTuition: "tuitions_add",
  adminAddPayment: "payments_add",
  adminUpdatePayment: "payments_edit",
  adminDeletePayment: "payments_delete",
  adminAddSubscription: "subscriptions_add",
  adminUpdateSubscription: "subscriptions_edit",
  adminDeleteSubscription: "subscriptions_edit",
  adminListEmployees: "employees_manage",
  adminAddEmployee: "employees_manage",
  adminUpdateEmployee: "employees_manage",
};

function canRunAction(caller: Caller, action: string): boolean {
  if (action === "adminUpdateRecord") {
    return ["tutors_edit", "tutors_verify", "students_edit"].some((p) => caller.permissions.has(p));
  }
  const needed = ACTION_PERMISSION[action];
  return !!needed && caller.permissions.has(needed);
}

function canSeePayments(caller: Caller): boolean {
  return caller.permissions.has("payments_view");
}

// What admin_get_overview's data an employee actually gets to see. One
// whose panel doesn't show a tab never receives that tab's data either -
// the browser it's sent to shouldn't hold tutor/student PII (contact
// details, addresses, ID documents) it has no UI for.
function dataAccess(caller: Caller): { tuitions: boolean; tutorsFull: boolean; studentsFull: boolean } {
  return {
    tuitions: caller.permissions.has("tuitions_view"),
    tutorsFull: caller.permissions.has("tutors_view"),
    studentsFull: caller.permissions.has("students_view"),
  };
}

// A name-only stand-in for a full tutors/students table, in the same
// {headers, readOnly, rows} shape the panel already renders - just with
// every field but the name stripped out, so Payments/Subscriptions
// cards can still show whose record this is.
function nameOnlyTable(table: Json, nameField: string): Json {
  const rows = (table?.rows ?? []).map((r: Json) => ({
    id: r.id,
    rowNumber: r.rowNumber,
    values: { [nameField]: r.values?.[nameField] ?? "" },
  }));
  return { headers: [nameField], readOnly: [], rows };
}

function forbidden(): Json {
  return { success: false, message: "You do not have permission for this action." };
}

// adminUpdateRecord touches tutor or student records: Verification Status
// needs "verify tutors", any other tutor field "edit tutors", and a
// student record "edit students".
function checkUpdateRecordScope(caller: Caller, kind: string, changes: Json): string | null {

  const keys = Object.keys(changes ?? {});

  if (hidesContacts(caller) && keys.some((k) => CONTACT_FIELDS.includes(k))) {
    return "Contact numbers are hidden for your account, so they can't be edited.";
  }

  if (hidesAddress(caller) && keys.some((k) => ADDRESS_FIELDS.includes(k))) {
    return "Addresses are hidden for your account, so they can't be edited.";
  }

  if (kind === "tutors") {
    if (keys.includes("Verification Status") && !caller.permissions.has("tutors_verify")) {
      return "You do not have permission to verify tutors.";
    }
    if (keys.some((k) => k !== "Verification Status") && !caller.permissions.has("tutors_edit")) {
      return "You do not have permission to edit tutor details.";
    }
    return null;
  }

  if (kind === "students") {
    return caller.permissions.has("students_edit") ? null : "You do not have permission to edit student details.";
  }

  return "You do not have permission for this action.";
}


/* ------------------------------------------------------------------
   DATABASE HELPERS
------------------------------------------------------------------ */

async function rpc(fn: string, args: Record<string, unknown> = {}): Promise<Json> {
  const { data, error } = await db.rpc(fn, args);
  if (error) return { success: false, message: error.message };
  return data ?? { success: true };
}

// Replace each stored document path with a link valid for 1 hour.
async function linkDocuments(overview: Json): Promise<Json> {
  const rows: Json[] = overview?.tutors?.rows ?? [];
  const paths = new Set<string>();

  rows.forEach((r) =>
    DOC_FIELDS.forEach((f) => {
      const v = String(r.values?.[f] ?? "").trim();
      if (v && !/^https?:\/\//i.test(v)) paths.add(v);
    })
  );

  if (!paths.size) return overview;

  const { data, error } = await db.storage
    .from(DOC_BUCKET)
    .createSignedUrls([...paths], DOC_LINK_SECONDS);

  if (error) {
    console.error("createSignedUrls:", error.message);
    return overview;
  }

  const links = new Map<string, string>();
  (data ?? []).forEach((d: Json) => {
    if (d?.path && d?.signedUrl) links.set(d.path, d.signedUrl);
  });

  rows.forEach((r) =>
    DOC_FIELDS.forEach((f) => {
      const v = String(r.values?.[f] ?? "").trim();
      if (links.has(v)) r.values[f] = links.get(v);
    })
  );

  return overview;
}

const PAYMENT_TYPES = ["advance", "regular", "final", "agency"];
const COLLECTED_BY = ["agency", "tutor"];
const TRANSACTION_TYPES = ["collection", "payout", "agency_charge"];

function paymentChangesFromBody(body: Json, partial: boolean): Json | { error: string } {
  const changes: Json = {};

  const assign = (key: string, value: unknown) => { if (value !== undefined) changes[key] = value; };

  // What kind of transaction this is: money coming in from a parent
  // ("collection", the default), the agency paying a tutor out of
  // money it already collected ("payout"), or money paid straight
  // towards the agency's own Agency Charge, from either side
  // ("agency_charge" - demo_id always set, tutor_id set only when
  // it's the tutor paying, not the student/parent).
  let transactionType: string | undefined;

  if (!partial || body.transactionType !== undefined) {
    transactionType = String(body.transactionType ?? "collection");
    if (!TRANSACTION_TYPES.includes(transactionType)) return { error: "Unknown transaction type." };
    changes.transaction_type = transactionType;
  }

  const isPayout = transactionType === "payout";
  const isAgencyCharge = transactionType === "agency_charge";

  if (!partial || body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!(amount > 0)) return { error: "Enter a valid amount." };
    changes.amount = amount;
  }

  if (!partial || body.paymentType !== undefined) {
    const t = String(body.paymentType ?? (isAgencyCharge ? "agency" : "regular"));
    if (!PAYMENT_TYPES.includes(t)) return { error: "Unknown payment type." };
    changes.payment_type = t;
  }

  // Collected By / Our Cut only apply to a collection from a parent -
  // a payout or an agency-charge payment has no "collector", the
  // agency is always the party being paid.
  if (!isPayout && !isAgencyCharge && (!partial || body.collectedBy !== undefined)) {
    const c = String(body.collectedBy ?? "agency");
    if (!COLLECTED_BY.includes(c)) return { error: "Unknown collector." };
    changes.collected_by = c;
  }

  if (!isPayout && !isAgencyCharge && body.ourCutAmount !== undefined) {
    changes.our_cut_amount = body.ourCutAmount === "" || body.ourCutAmount === null
      ? null : Number(body.ourCutAmount);
  }

  if (!partial || body.paymentMode !== undefined) {
    const mode = String(body.paymentMode ?? "").trim();
    if (!mode) return { error: "Enter how the payment was made (cash, UPI, bank transfer, ...)." };
    changes.payment_mode = mode;
  }

  assign("payment_date", body.paymentDate || undefined);
  // When the rest of a part-paid Agency Charge is due.
  assign("next_payment_date", body.nextPaymentDate !== undefined ? (body.nextPaymentDate || null) : undefined);
  assign("notes", body.notes !== undefined ? String(body.notes ?? "").trim() : undefined);
  assign("received_by", body.receivedBy !== undefined ? (String(body.receivedBy ?? "").trim() || null) : undefined);

  if (!partial) {
    if (isPayout && !body.tutorId) return { error: "Choose which tutor is being paid." };
    if (isAgencyCharge && !body.demoId) return { error: "Demo ID is required for an Agency Charge payment." };
    if (!isPayout && !isAgencyCharge && !body.demoId && !body.subscriptionId) return { error: "Demo ID or Subscription is required." };
    changes.demo_id = body.demoId || null;
    changes.tutor_id = body.tutorId || null;
    changes.subscription_id = body.subscriptionId || null;
  }

  return changes;
}

const SUBSCRIPTION_STATUSES = ["active", "paused", "cancelled", "completed"];

function subscriptionChangesFromBody(body: Json, partial: boolean): Json | { error: string } {
  const changes: Json = {};

  const assign = (key: string, value: unknown) => { if (value !== undefined) changes[key] = value; };

  if (!partial) {
    const partyType = String(body.partyType ?? "");
    if (partyType === "student") {
      if (!body.studentId) return { error: "Choose a student." };
      changes.student_id = body.studentId;
      changes.tutor_id = null;
    } else if (partyType === "tutor") {
      if (!body.tutorId) return { error: "Choose a tutor." };
      changes.tutor_id = body.tutorId;
      changes.student_id = null;
    } else {
      return { error: "Choose whether this subscription is for a student or a tutor." };
    }
  }

  if (!partial || body.planName !== undefined) {
    const planName = String(body.planName ?? "").trim();
    if (!planName) return { error: "Enter a plan name." };
    changes.plan_name = planName;
  }

  if (!partial || body.amount !== undefined) {
    const amount = Number(body.amount);
    // 0 is allowed - the amount can be reduced or fully exempted case by case.
    if (!(amount >= 0)) return { error: "Enter a valid amount." };
    changes.amount = amount;
  }

  if (!partial || body.billingCycle !== undefined) {
    const cycle = String(body.billingCycle ?? "").trim();
    if (!cycle) return { error: "Enter a billing cycle (monthly, one-time, per session, ...)." };
    changes.billing_cycle = cycle;
  }

  if (!partial || body.status !== undefined) {
    const status = String(body.status ?? "active");
    if (!SUBSCRIPTION_STATUSES.includes(status)) return { error: "Unknown status." };
    changes.status = status;
  }

  assign("start_date", body.startDate || undefined);
  assign("next_due_date", body.nextDueDate === "" ? null : body.nextDueDate || undefined);
  assign("notes", body.notes !== undefined ? String(body.notes ?? "").trim() : undefined);

  return changes;
}


/* ------------------------------------------------------------------
   ACTIONS
------------------------------------------------------------------ */

async function handleBootstrap(caller: AuthedUser, body: Json): Promise<Json> {

  const { count } = await db.from("admin_users").select("id", { count: "exact", head: true });
  if (count) return { success: false, message: "An admin account already exists. Ask a super admin to add you." };

  const fullName = String(body.fullName ?? "").trim() || caller.email;

  const { error } = await db.from("admin_users").insert({
    id: caller.id, email: caller.email, full_name: fullName, role: "super_admin", active: true,
  });

  if (error) return { success: false, message: error.message };

  return { success: true, message: "Super admin account created. Log in again to continue." };
}

// A minimal Demo ID / Tutor ID lookup for the Payments form's search
// suggestions - just enough to find the right record and verify it by
// mobile number, whatever the caller's role. Every role that can see
// Payments gets this (even Accounts/Finance, who otherwise receives no
// tuition/tutor/student data at all): it carries none of the fuller
// PII (address, documents, verification status) those tables hold.
async function buildPaymentDirectory(): Promise<Json> {

  const [{ data: tuitions }, { data: applications }, { data: students }, { data: tutors }] = await Promise.all([
    db.from("tuitions").select("demo_id, student_id, subject, terminated"),
    db.from("applications").select(
      "demo_id, tutor_id, parent_accepted, tutor_accepted, parent_rejected, tutor_rejected, classes_completed, demo_date"
    ),
    db.from("students").select("student_id, student_name, parents_name, phone, whatsapp"),
    db.from("tutors").select("tutor_id, full_name, mobile_number, whatsapp_number"),
  ]);

  const tuitionByDemo = new Map<string, Json>();
  (tuitions ?? []).forEach((t: Json) => tuitionByDemo.set(t.demo_id, t));

  // "running": both sides accepted, a demo date was set, neither side
  // rejected, the class isn't marked complete, and the office hasn't
  // terminated the tuition - the class is actually going on right now.
  const isRunning = (a: Json) => {
    const tuition = tuitionByDemo.get(a.demo_id);
    return !!tuition && !tuition.terminated &&
      a.parent_accepted && a.tutor_accepted &&
      !a.parent_rejected && !a.tutor_rejected &&
      !a.classes_completed && !!a.demo_date;
  };

  const runningApps = (applications ?? []).filter(isRunning);

  const tutorsByDemo = new Map<string, Set<string>>();
  const demosByTutor = new Map<string, Set<string>>();
  const runningDemoIds = new Set<string>();
  const activeTutorIds = new Set<string>();

  runningApps.forEach((a: Json) => {
    runningDemoIds.add(a.demo_id);
    activeTutorIds.add(a.tutor_id);
    if (!tutorsByDemo.has(a.demo_id)) tutorsByDemo.set(a.demo_id, new Set());
    tutorsByDemo.get(a.demo_id)!.add(a.tutor_id);
    if (!demosByTutor.has(a.tutor_id)) demosByTutor.set(a.tutor_id, new Set());
    demosByTutor.get(a.tutor_id)!.add(a.demo_id);
  });

  return {
    // Payment suggestions only ever show demos/tutors flagged running/
    // activeNow; the full lists (unfiltered) stay here too since
    // Subscriptions - a different arrangement, not tied to one running
    // class - still needs to look any student or tutor up.
    demos: (tuitions ?? []).map((t: Json) => ({
      demoId: t.demo_id,
      studentId: t.student_id,
      subject: t.subject,
      running: runningDemoIds.has(t.demo_id),
      tutorIds: [...(tutorsByDemo.get(t.demo_id) ?? [])],
    })),
    students: (students ?? []).map((s: Json) => ({
      id: s.student_id, name: s.student_name, parentsName: s.parents_name || "",
      mobile: s.phone || s.whatsapp || "", whatsapp: s.whatsapp || "",
    })),
    tutors: (tutors ?? []).map((t: Json) => ({
      id: t.tutor_id, name: t.full_name, mobile: t.mobile_number || t.whatsapp_number || "",
      activeNow: activeTutorIds.has(t.tutor_id),
      demoIds: [...(demosByTutor.get(t.tutor_id) ?? [])],
    })),
  };

}

// Every employee with the permissions they effectively have (their
// explicit list, or their role's preset when none was ever set).
async function listEmployees(): Promise<Json[]> {
  const { data } = await db
    .from("admin_users")
    .select("id, email, full_name, role, active, created_at, permissions")
    .order("created_at", { ascending: true });
  return (data ?? []).map((e: Json) => ({ ...e, permissions: effectivePermissions(e.role as Role, e.permissions) }));
}

/* ------------------------------------------------------------------
   HIDE CONTACT NUMBERS
   An employee with the "hide_contacts" permission never receives a real
   mobile / WhatsApp number: every such field is masked here, on the
   server, so nothing is left in the browser to be read. The internal
   join key (mobileKey) becomes an opaque, keyed hash so cards that link a
   demo to its tutor still line up, without exposing the number.
------------------------------------------------------------------ */

const CONTACT_KEY = /mobile|phone|whatsapp/i;
const CONTACT_FIELDS = ["Phone", "WhatsApp", "Mobile Number", "WhatsApp Number"];
const ADDRESS_KEY = /address/i;
const ADDRESS_FIELDS = ["Address", "Present Address"];

function hidesContacts(caller: Caller): boolean {
  return caller.role !== "super_admin" && caller.permissions.has("hide_contacts");
}

function hidesAddress(caller: Caller): boolean {
  return caller.role !== "super_admin" && caller.permissions.has("hide_address");
}

function maskNumber(value: unknown): string {
  const d = String(value ?? "").replace(/\D/g, "");
  if (!d) return "";
  return d.length <= 2 ? "*".repeat(d.length) : "*".repeat(d.length - 2) + d.slice(-2);
}

let hmacKey: CryptoKey | null = null;
async function opaqueKey(value: unknown): Promise<string> {
  const d = String(value ?? "").replace(/\D/g, "").slice(-10);
  if (!d) return "";
  if (!hmacKey) {
    hmacKey = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(SERVICE_KEY || "contacts"),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
  }
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(d)));
  return "k" + [...sig].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// What to hide: mobile / WhatsApp numbers and / or street addresses.
interface MaskOpts { contacts: boolean; address: boolean; }

async function maskContacts(node: unknown, opts: MaskOpts): Promise<unknown> {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = await maskContacts(node[i], opts);
    return node;
  }
  if (node && typeof node === "object") {
    const obj = node as Json;
    // a tutor row: its real number gives the same opaque key its demos carry
    const tutorRowKey = opts.contacts && obj.values && typeof obj.values === "object" && (obj.values as Json)["Mobile Number"] !== undefined
      ? await opaqueKey((obj.values as Json)["Mobile Number"])
      : null;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (opts.contacts && k === "mobileKey") obj[k] = await opaqueKey(v);
      else if (opts.contacts && CONTACT_KEY.test(k) && (typeof v === "string" || typeof v === "number")) obj[k] = maskNumber(v);
      else if (opts.address && ADDRESS_KEY.test(k) && !/e-?mail/i.test(k) && typeof v === "string") obj[k] = v.trim() ? "Hidden" : "";
      else if (v && typeof v === "object") obj[k] = await maskContacts(v, opts);
    }
    if (tutorRowKey !== null) obj.mobileKey = tutorRowKey;
    return obj;
  }
  return node;
}

async function handleGetOverview(caller: Caller): Promise<Json> {

  const overview = await rpc("admin_get_overview");
  if (!overview?.success) return overview;

  const access = dataAccess(caller);

  // Only sign document links for tutor data the caller actually receives.
  const withLinks = access.tutorsFull ? await linkDocuments(overview) : overview;

  if (!access.tuitions) withLinks.demos = [];
  if (!access.tutorsFull) withLinks.tutors = nameOnlyTable(withLinks.tutors, "Full Name");
  if (!access.studentsFull) withLinks.students = nameOnlyTable(withLinks.students, "Student Name");

  withLinks.me = {
    email: caller.email, fullName: caller.fullName, role: caller.role,
    permissions: [...caller.permissions],
  };
  const siteOn = await siteMailsOn();
  withLinks.settings = caller.role === "super_admin"
    ? { mailsEnabled: siteOn, canToggleMails: true, scope: "site" }
    : { mailsEnabled: siteOn && callerMailsOn(caller), canToggleMails: siteOn && caller.permissions.has("mails_toggle"),
        scope: "own", siteOff: !siteOn };

  if (canSeePayments(caller)) {
    const { data: payments, error } = await db
      .from("payments")
      .select("*")
      .order("payment_date", { ascending: false })
      .order("id", { ascending: false });
    withLinks.payments = error ? [] : payments;

    const { data: subscriptions, error: subError } = await db
      .from("subscriptions")
      .select("*")
      .order("created_at", { ascending: false });
    withLinks.subscriptions = subError ? [] : subscriptions;

    withLinks.directory = await buildPaymentDirectory();
  }

  if (caller.permissions.has("employees_manage")) {
    withLinks.employees = await listEmployees();
    withLinks.permissionInfo = { groups: PERMISSION_GROUPS, presets: ROLE_PRESETS, parents: PERMISSION_PARENT };
  }

  const opts: MaskOpts = { contacts: hidesContacts(caller), address: hidesAddress(caller) };
  if (opts.contacts || opts.address) {
    await maskContacts(withLinks, opts);
    // masked values can't be edited: lock those fields in the record forms
    const locked = [...(opts.contacts ? CONTACT_FIELDS : []), ...(opts.address ? ADDRESS_FIELDS : [])];
    for (const table of [withLinks.tutors, withLinks.students]) {
      if (table) table.readOnly = [...new Set([...(table.readOnly ?? []), ...locked])];
    }
    withLinks.me.hideContacts = opts.contacts;
    withLinks.me.hideAddress = opts.address;
  }

  return withLinks;
}

/* NOTIFICATIONS - only these emails are ever sent from the admin panel:
     demo scheduled (student + tutor), tuition payment received (student),
     agency charge received (student / tutor), payment sent to a tutor, and
     a subscription payment (student / tutor). Everything else is silent.
   A failed send never blocks the action itself (see _shared/email.ts). */

// The "Emails On / Off" switch in the Admin Panel header:
//  - Super Admin: the switch for the WHOLE SITE (app_settings "admin_mails").
//    Off = no notification email at all - Admin Panel, students, tutors -
//    except login codes (checked inside _shared/email.ts sendMail).
//  - Any other employee: their OWN switch (admin_users.mails_enabled).
//    Off = the updates THAT employee makes send no email. Only counts while
//    they have the "mails_toggle" permission.
async function siteMailsOn(): Promise<boolean> {
  const { data } = await db.from("app_settings").select("value").eq("key", "admin_mails").maybeSingle();
  return data?.value?.enabled !== false;
}

function callerMailsOn(caller: Caller): boolean {
  if (caller.role === "super_admin") return true;   // the site-wide switch covers them
  return !caller.permissions.has("mails_toggle") || caller.mailsEnabled;
}

async function sendTo(email: string | null | undefined, mail: { subject: string; html: string }) {
  if (!email) return;
  await sendMail(email, mail.subject, mail.html);
}

const num = (v: unknown) => Number(v) || 0;

async function tutorById(tutorId?: string | null) {
  if (!tutorId) return null;
  const { data } = await db.from("tutors").select("tutor_id, full_name, email").eq("tutor_id", tutorId).maybeSingle();
  return data;
}

async function studentById(studentId?: string | null) {
  if (!studentId) return null;
  const { data } = await db.from("students").select("student_id, student_name, email").eq("student_id", studentId).maybeSingle();
  return data;
}

async function demoWithStudent(demoId?: string | null) {
  if (!demoId) return { tuition: null, student: null };
  const { data: tuition } = await db.from("tuitions").select("demo_id, subject, student_id, medium").eq("demo_id", demoId).maybeSingle();
  return { tuition, student: await studentById(tuition?.student_id) };
}

// The application that is actually running the tuition (both sides accepted).
async function activeApplication(demoId: string, tutorId?: string | null) {
  let q = db.from("applications")
    .select("tutor_id, class_duration, class_charges, class_count, student_agency_charge, tutor_agency_charge, tutor_advance_payment")
    .eq("demo_id", demoId).eq("parent_accepted", true).eq("tutor_accepted", true)
    .eq("parent_rejected", false).eq("tutor_rejected", false);
  if (tutorId) q = q.eq("tutor_id", tutorId);
  const { data } = await q.limit(1);
  return data?.[0] ?? null;
}

const classTotal = (a: Json) => (num(a?.class_duration) / 60) * num(a?.class_charges) * num(a?.class_count);

async function sumPayments(filter: (q: Json) => Json): Promise<number> {
  const { data } = await filter(db.from("payments").select("amount"));
  return (data ?? []).reduce((sum: number, r: Json) => sum + num(r.amount), 0);
}

// Tuition request(s) posted for a student (by the office): the same
// "Tuition Request Posted" email the student gets when posting it themselves.
async function sendTuitionPosted(studentId: string, demoIds: string[]) {
  if (!studentId || !demoIds?.length) return;
  const { data: student } = await db.from("students")
    .select("student_name, email, class_name, board, city, pin_code").eq("student_id", studentId).maybeSingle();
  if (!student?.email) return;
  const { data: rows } = await db.from("tuitions")
    .select("demo_id, subject, medium, preferred_tutor").in("demo_id", demoIds).order("demo_id");
  if (!rows?.length) return;
  await sendTo(student.email, tuitionPostedMail({
    name: student.student_name, demos: rows.map((r: Json) => ({ demoId: r.demo_id, subject: r.subject })),
    cls: student.class_name, board: student.board, medium: rows[0].medium, preferredTutor: rows[0].preferred_tutor,
    city: student.city, pin: student.pin_code,
  }));
}

// Demo scheduled: a date + time was newly set (or changed) on an application.
async function sendDemoScheduled(demoId: string, tutorId: string, date: string, time: string) {
  const { tuition, student } = await demoWithStudent(demoId);
  const tutor = await tutorById(tutorId);
  if (!tuition || !student || !tutor) return;
  const base = { demoId, subject: tuition.subject ?? "", date, time, mode: tuition.medium };
  await sendTo(student.email, demoScheduledMail({ ...base, forTutor: false, name: student.student_name, otherName: tutor.full_name }));
  await sendTo(tutor.email, demoScheduledMail({ ...base, forTutor: true, name: tutor.full_name, otherName: student.student_name }));
}

// Payment recorded: pick the right email for what the payment was.
async function sendPaymentMail(pay: Json) {
  const common = { receipt: pay.id, amount: num(pay.amount), mode: pay.payment_mode ?? "", paymentDate: pay.payment_date, createdAt: pay.created_at };

  // 9 / 10 - a subscription payment
  if (pay.subscription_id) {
    const { data: sub } = await db.from("subscriptions")
      .select("student_id, tutor_id, plan_name, amount, start_date, next_due_date").eq("id", pay.subscription_id).maybeSingle();
    if (!sub) return;
    const paid = await sumPayments((q) => q.eq("subscription_id", pay.subscription_id).neq("transaction_type", "payout"));
    const party = sub.student_id ? await studentById(sub.student_id) : await tutorById(sub.tutor_id);
    if (!party) return;
    await sendTo(party.email, subscriptionMail({
      forTutor: !sub.student_id, name: sub.student_id ? party.student_name : party.full_name,
      plan: sub.plan_name, amount: num(sub.amount), paid, startDate: sub.start_date, nextDue: sub.next_due_date,
    }));
    return;
  }

  if (!pay.demo_id) return;
  const { tuition, student } = await demoWithStudent(pay.demo_id);
  if (!tuition) return;
  const subject = tuition.subject ?? "";

  // 7 - agency charge (student side has no tutor_id, tutor side has one)
  if (pay.transaction_type === "agency_charge") {
    const forTutor = !!pay.tutor_id;
    const app = await activeApplication(pay.demo_id, pay.tutor_id);
    const charge = num(forTutor ? app?.tutor_agency_charge : app?.student_agency_charge);
    const received = await sumPayments((q) => {
      const r = q.eq("demo_id", pay.demo_id).eq("transaction_type", "agency_charge");
      return forTutor ? r.eq("tutor_id", pay.tutor_id) : r.is("tutor_id", null);
    });
    const party = forTutor ? await tutorById(pay.tutor_id) : student;
    if (!party) return;
    await sendTo(party.email, agencyChargeMail({
      ...common, forTutor, name: forTutor ? party.full_name : party.student_name, subject, demoId: pay.demo_id,
      remaining: app ? Math.max(charge - received, 0) : undefined,
    }));
    return;
  }

  const app = await activeApplication(pay.demo_id, pay.tutor_id);
  const total = classTotal(app);

  // 8 - the agency paid a tutor
  if (pay.transaction_type === "payout") {
    const tutor = await tutorById(pay.tutor_id);
    if (!tutor) return;
    const payouts = await sumPayments((q) => q.eq("tutor_id", pay.tutor_id).eq("transaction_type", "payout").or(`demo_id.is.null,demo_id.eq.${pay.demo_id}`));
    const received = num(app?.tutor_advance_payment) + payouts;
    await sendTo(tutor.email, payoutMail({
      ...common, name: tutor.full_name, subject, demoId: pay.demo_id, studentName: student?.student_name ?? "",
      totalReceived: total > 0 ? received : undefined, stillDue: total > 0 ? Math.max(total - received, 0) : undefined,
    }));
    return;
  }

  // 6 - a parent's payment for the tuition
  if (!student) return;
  const paid = await sumPayments((q) => q.eq("demo_id", pay.demo_id).eq("transaction_type", "collection"));
  await sendTo(student.email, paymentReceivedMail({
    ...common, name: student.student_name, subject, demoId: pay.demo_id, type: pay.payment_type,
    totalPaid: total > 0 ? paid : undefined, duesLeft: total > 0 ? Math.max(total - paid, 0) : undefined,
  }));
}

// Sum of everything paid in against a subscription so far (payouts
// don't count) - the server-side twin of admin.js's
// subscriptionPaidAmount, used both to cap a new payment at what's
// still owed and to tell whether it's now fully settled.
async function subscriptionPaidTotal(subscriptionId: number): Promise<number> {
  const { data: rows } = await db.from("payments").select("amount")
    .eq("subscription_id", subscriptionId).neq("transaction_type", "payout");
  return (rows ?? []).reduce((sum: number, r: Json) => sum + Number(r.amount || 0), 0);
}

// start_date marks when the current billing cycle began - the first
// payment ever, or a renewal landing after the previous cycle's
// next_due_date had already passed. next_due_date only moves once the
// subscription is fully paid off, to one year from that cycle's start -
// while dues remain, the admin sets their own follow-up date instead of
// the system guessing one.
async function realignSubscriptionCycle(subscriptionId: number, paymentDate: string) {
  const { data: sub } = await db
    .from("subscriptions")
    .select("start_date, next_due_date, amount")
    .eq("id", subscriptionId)
    .maybeSingle();
  if (!sub) return;

  const startsNewCycle = !sub.start_date || !sub.next_due_date || paymentDate > sub.next_due_date;
  const cycleStart = startsNewCycle ? paymentDate : sub.start_date;

  const changes: Record<string, string> = {};
  if (startsNewCycle) changes.start_date = cycleStart;

  const totalPaid = await subscriptionPaidTotal(subscriptionId);
  if (totalPaid >= Number(sub.amount || 0)) {
    const nextDue = new Date(cycleStart);
    nextDue.setFullYear(nextDue.getFullYear() + 1);
    changes.next_due_date = nextDue.toISOString().slice(0, 10);
  }

  if (!Object.keys(changes).length) return;

  await db.from("subscriptions").update(changes).eq("id", subscriptionId);
}

// LOGIN STEP 1 - the only action that runs BEFORE someone is logged in.
// It decides on the SERVER whether this email may receive a login code, and
// the answer to the browser is always the same ("code requested"), so nobody
// can use the login page to find out which emails belong to office staff.
// A code is only really sent to an active employee - or, while no employee
// exists yet, to whoever sets up the first Super Admin.
async function handleSendCode(body: Json): Promise<Json> {
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, message: "Enter a valid email address." };
  }

  const { data: row } = await db.from("admin_users").select("id").ilike("email", email).eq("active", true).maybeSingle();
  const { count } = await db.from("admin_users").select("id", { count: "exact", head: true });
  const bootstrap = !count;

  if (row || bootstrap) {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await anon.auth.signInWithOtp({ email, options: { shouldCreateUser: bootstrap } });
    if (error) console.error("admin send code failed", error.message);
  }

  return { success: true };
}

async function handle(body: Json, authHeader: string | null): Promise<Json> {

  const action = String(body?.action ?? "");
  if (action === "adminSendCode") return handleSendCode(body);
  const user = await currentUser(authHeader);

  if (!user) {
    return { success: false, notAdmin: true, message: "Please log in again." };
  }

  const caller = await loadCaller(authHeader);

  if (caller === "no-session" || caller === "not-admin") {
    return { success: false, notAdmin: true, message: "This email is not set up for admin access." };
  }

  if (caller === "bootstrap-needed") {
    if (action === "adminBootstrapSuperAdmin") return handleBootstrap(user, body);
    return { success: false, bootstrapNeeded: true, message: "No admin account exists yet." };
  }

  if (action === READ_ONLY_ACTION) return handleGetOverview(caller);

  // Emails On / Off: a Super Admin switches the whole site, anyone else
  // (with the mails_toggle permission) only their own updates.
  if (action === "adminSetMails") {
    const enabled = body.enabled === true;
    if (caller.role === "super_admin") {
      const { error } = await db.from("app_settings").upsert({
        key: "admin_mails", value: { enabled }, updated_at: new Date().toISOString(), updated_by: caller.id,
      });
      if (error) return { success: false, message: error.message };
      return {
        success: true, mailsEnabled: enabled,
        message: enabled ? "Emails are ON for the whole site again." : "All emails are OFF (login codes still go out).",
      };
    }
    if (!caller.permissions.has("mails_toggle")) return forbidden();
    if (!(await siteMailsOn())) return { success: false, message: "The Super Admin has switched off all emails." };
    const { error } = await db.from("admin_users").update({ mails_enabled: enabled }).eq("id", caller.id);
    if (error) return { success: false, message: error.message };
    return {
      success: true, mailsEnabled: enabled,
      message: enabled ? "Emails are ON - your updates will email students and tutors again." : "Emails are OFF - your updates will not send any email.",
    };
  }

  if (!canRunAction(caller, action)) return forbidden();

  switch (action) {

    case "adminUpdateRecord": {
      const scopeError = checkUpdateRecordScope(caller, String(body.kind), body.changes ?? {});
      if (scopeError) return { success: false, message: scopeError };
      const result = await rpc("admin_update_record", {
        p_kind: body.kind,
        p_id: body.id,
        p_changes: body.changes ?? {},
      });
      return result;
    }

    case "adminUpdateTuition": {
      return await rpc("admin_update_tuition", {
        p_demo_id: body.demoId,
        p_changes: body.changes ?? {},
      });
    }

    case "adminUpdateDemoRow": {
      if (!body.tutorId) {
        return { success: false, message: "Please refresh the page and try again." };
      }
      const { data: before } = await db.from("applications").select("demo_date, demo_time")
        .eq("demo_id", body.demoId).eq("tutor_id", body.tutorId).maybeSingle();
      const result = await rpc("admin_update_demo_row", {
        p_demo_id: body.demoId,
        p_tutor_id: body.tutorId,
        p_changes: body.changes ?? {},
      });
      if (result?.success) {
        // "Demo Scheduled" goes out only when a date + time is newly set or changed.
        const newDate = String(body.changes?.["Demo Date"] ?? "");
        const newTime = String(body.changes?.["Demo Time"] ?? "");
        const changed = newDate !== String(before?.demo_date ?? "") || newTime.slice(0, 5) !== String(before?.demo_time ?? "").slice(0, 5);
        if (newDate && newTime && changed) {
          if (callerMailsOn(caller)) try { await sendDemoScheduled(String(body.demoId), String(body.tutorId), newDate, newTime); } catch (e) { console.error("demo mail", e); }
        }
      }
      return result;
    }

    case "adminAssignTutor": {
      return await rpc("admin_assign_tutor", {
        p_demo_id: body.demoId,
        p_tutor_lookup: String(body.tutor ?? ""),
      });
    }

    case "adminSetTerminated": {
      const terminated = body.value === true;
      return await rpc("admin_set_terminated", {
        p_demo_id: body.demoId,
        p_terminated: terminated,
      });
    }

    // Add a Student - the same details as the student's own registration, with no OTP.
    case "adminAddStudent": {
      const p = body.p ?? {};
      const result = await rpc("admin_register_student", { p });
      if (result?.success && result.demoIds?.length) {
        if (callerMailsOn(caller)) try { await sendTuitionPosted(String(result.studentId), result.demoIds); } catch (e) { console.error("tuition mail", e); }
      }
      return result;
    }

    // Apply for New Tuition on a student's behalf.
    case "adminAddTuition": {
      const p = body.p ?? {};
      const result = await rpc("admin_add_tuition", { p });
      if (result?.success) {
        if (callerMailsOn(caller)) try { await sendTuitionPosted(String(p.studentId ?? ""), result.demoIds ?? []); } catch (e) { console.error("tuition mail", e); }
      }
      return result;
    }

    case "adminAddPayment": {
      const changes = paymentChangesFromBody(body, false);
      if ("error" in changes) return { success: false, message: changes.error };

      if (changes.subscription_id) {
        const { data: sub } = await db.from("subscriptions").select("amount")
          .eq("id", changes.subscription_id).maybeSingle();
        if (sub) {
          const paidSoFar = await subscriptionPaidTotal(changes.subscription_id);
          const dues = Math.max(Number(sub.amount || 0) - paidSoFar, 0);
          if (Number(changes.amount) > dues) {
            return { success: false, message: `Amount Paid can't be more than the Dues (Rs. ${dues}).` };
          }
        }
      }

      const { data: inserted, error } = await db.from("payments").insert({ ...changes, recorded_by: caller.id }).select().maybeSingle();
      if (error) return { success: false, message: error.message };
      if (inserted) {
        if (inserted.subscription_id) {
          await realignSubscriptionCycle(inserted.subscription_id, inserted.payment_date);
        }
        if (callerMailsOn(caller)) try { await sendPaymentMail(inserted); } catch (e) { console.error("payment mail", e); }
      }
      return { success: true, message: "Payment recorded." };
    }

    case "adminUpdatePayment": {
      if (!body.id) return { success: false, message: "Missing payment." };
      const changes = paymentChangesFromBody(body, true);
      if ("error" in changes) return { success: false, message: changes.error };
      const { data: updated, error } = await db.from("payments").update(changes).eq("id", body.id).select().maybeSingle();
      if (error) return { success: false, message: error.message };
      return { success: true, message: "Payment updated." };
    }

    case "adminDeletePayment": {
      if (!body.id) return { success: false, message: "Missing payment." };
      const { error } = await db.from("payments").delete().eq("id", body.id);
      if (error) return { success: false, message: error.message };
      return { success: true, message: "Payment deleted." };
    }

    case "adminAddSubscription": {
      const changes = subscriptionChangesFromBody(body, false);
      if ("error" in changes) return { success: false, message: changes.error };

      // One subscription per student/tutor: while it isn't cancelled a
      // second one can't be opened - payments are added to the existing one.
      const partyColumn = changes.student_id ? "student_id" : "tutor_id";
      const partyId = changes.student_id ?? changes.tutor_id;
      const { data: existingSub } = await db.from("subscriptions")
        .select("id").eq(partyColumn, partyId).neq("status", "cancelled").limit(1).maybeSingle();
      if (existingSub) {
        return { success: false, message: `${partyId} already has a subscription. Record a payment against it instead of creating another.` };
      }

      const { data: inserted, error } = await db.from("subscriptions").insert({ ...changes, created_by: caller.id }).select().maybeSingle();
      if (error) return { success: false, message: error.message };
      return { success: true, message: "Subscription created." };
    }

    case "adminUpdateSubscription": {
      if (!body.id) return { success: false, message: "Missing subscription." };
      const changes = subscriptionChangesFromBody(body, true);
      if ("error" in changes) return { success: false, message: changes.error };
      const { data: updated, error } = await db.from("subscriptions").update(changes).eq("id", body.id).select().maybeSingle();
      if (error) return { success: false, message: error.message };
      return { success: true, message: "Subscription updated." };
    }

    case "adminDeleteSubscription": {
      if (!body.id) return { success: false, message: "Missing subscription." };
      const { error } = await db.from("subscriptions").delete().eq("id", body.id);
      if (error) return { success: false, message: error.message };
      return { success: true, message: "Subscription deleted." };
    }

    case "adminListEmployees": {
      return { success: true, employees: await listEmployees() };
    }

    case "adminAddEmployee": {
      const employeeEmail = String(body.email ?? "").trim().toLowerCase();
      const fullName = String(body.fullName ?? "").trim();
      const role = String(body.role ?? "");

      if (!employeeEmail) return { success: false, message: "Enter an email." };
      if (!fullName) return { success: false, message: "Enter a name." };
      if (!ROLES.includes(role as Role)) return { success: false, message: "Unknown role." };

      const { data: alreadyEmployee } = await db
        .from("admin_users").select("id").ilike("email", employeeEmail).maybeSingle();
      if (alreadyEmployee) return { success: false, message: "That email is already an employee." };

      let userId = await findAuthUserByEmail(employeeEmail);

      if (!userId) {
        const { data: created, error: createError } = await db.auth.admin.createUser({
          email: employeeEmail,
          email_confirm: true,
        });
        if (createError) return { success: false, message: createError.message };
        userId = created.user?.id;
      }

      if (!userId) return { success: false, message: "Could not create the login for that email." };

      const { error } = await db.from("admin_users").insert({
        id: userId, email: employeeEmail, full_name: fullName, role, active: true,
        // A Super Admin always has everything; anyone else gets exactly the ticked list.
        permissions: role === "super_admin" ? null : normalizePermissions(body.permissions),
      });
      if (error) return { success: false, message: error.message };

      return { success: true, message: "Employee added." };
    }

    case "adminUpdateEmployee": {
      if (!body.id) return { success: false, message: "Missing employee." };
      if (body.id === caller.id && body.changes?.active === false) {
        return { success: false, message: "You cannot deactivate your own account." };
      }
      if (body.id === caller.id && body.changes?.role && body.changes.role !== "super_admin") {
        return { success: false, message: "You cannot change your own role." };
      }
      const changes: Json = {};
      if (body.changes?.fullName !== undefined) changes.full_name = String(body.changes.fullName).trim();
      if (body.changes?.role !== undefined) {
        if (!ROLES.includes(body.changes.role)) return { success: false, message: "Unknown role." };
        changes.role = body.changes.role;
      }
      if (body.changes?.active !== undefined) changes.active = body.changes.active === true;
      if (body.changes?.permissions !== undefined) {
        if (body.id === caller.id) return { success: false, message: "You cannot change your own permissions." };
        changes.permissions = normalizePermissions(body.changes.permissions);
      }
      // Whatever role they end up with, a Super Admin's list is never stored.
      if (changes.role === "super_admin") changes.permissions = null;

      const { error } = await db.from("admin_users").update(changes).eq("id", body.id);
      if (error) return { success: false, message: error.message };
      return { success: true, message: "Employee updated." };
    }

    default:
      return { success: false, message: "Unknown action." };
  }
}


/* ------------------------------------------------------------------
   HTTP
------------------------------------------------------------------ */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ success: false, message: "Use POST." }, 405);

  let body: Json;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return reply({ success: false, message: "Invalid request." }, 400);
  }

  try {
    return reply(await handle(body, req.headers.get("authorization")));
  } catch (error) {
    console.error(error);
    return reply({ success: false, message: "Server error. Please try again." }, 500);
  }
});
