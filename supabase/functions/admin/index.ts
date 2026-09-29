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
import { emailTemplate, detailRow, sendMail } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
    .select("id, email, full_name, role, active")
    .ilike("email", user.email)
    .maybeSingle();

  if (row && row.active) {
    return { id: row.id, email: row.email, fullName: row.full_name, role: row.role as Role };
  }

  const { count } = await db.from("admin_users").select("id", { count: "exact", head: true });
  if (!count) return "bootstrap-needed";

  return "not-admin";
}


/* ------------------------------------------------------------------
   ROLE PERMISSIONS
------------------------------------------------------------------ */

const READ_ONLY_ACTION = "adminGetOverview";

const ACTIONS_BY_ROLE: Record<Role, Set<string>> = {
  super_admin: new Set([
    "adminGetOverview", "adminUpdateRecord", "adminUpdateTuition", "adminUpdateDemoRow",
    "adminAssignTutor", "adminSetTerminated",
    "adminAddPayment", "adminUpdatePayment", "adminDeletePayment",
    "adminAddSubscription", "adminUpdateSubscription", "adminDeleteSubscription",
    "adminListEmployees", "adminAddEmployee", "adminUpdateEmployee",
  ]),
  tuition_coordinator: new Set([
    "adminGetOverview", "adminUpdateRecord", "adminUpdateTuition", "adminUpdateDemoRow",
    "adminAssignTutor", "adminSetTerminated",
  ]),
  verification_staff: new Set(["adminGetOverview", "adminUpdateRecord"]),
  accounts_finance: new Set([
    "adminGetOverview", "adminAddPayment", "adminUpdatePayment", "adminDeletePayment",
    "adminAddSubscription", "adminUpdateSubscription", "adminDeleteSubscription",
  ]),
  tutor_relations: new Set(["adminGetOverview", "adminUpdateRecord"]),
};

// Payments and Subscriptions are always granted to the same roles, so
// the panel's "Payments" tab (which also shows Subscriptions) can be
// gated with a single check.
function canSeePayments(role: Role): boolean {
  return ACTIONS_BY_ROLE[role].has("adminAddPayment");
}

// What admin_get_overview's data a role actually gets to see. A role
// whose panel doesn't show a tab never receives that tab's data either -
// the browser it's sent to shouldn't hold tutor/student PII (contact
// details, addresses, ID documents) it has no UI for.
const DATA_ACCESS: Record<Role, { tuitions: boolean; tutorsFull: boolean; studentsFull: boolean }> = {
  super_admin:         { tuitions: true,  tutorsFull: true,  studentsFull: true },
  tuition_coordinator: { tuitions: true,  tutorsFull: true,  studentsFull: true },
  verification_staff:  { tuitions: false, tutorsFull: true,  studentsFull: false },
  accounts_finance:    { tuitions: false, tutorsFull: false, studentsFull: false },
  tutor_relations:     { tuitions: false, tutorsFull: true,  studentsFull: false },
};

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
  return { success: false, message: "Your role does not allow this action." };
}

// Some roles may call adminUpdateRecord, but only touch specific
// fields on specific record kinds.
function checkUpdateRecordScope(role: Role, kind: string, changes: Json): string | null {

  if (role === "super_admin" || role === "tuition_coordinator") return null;

  const keys = Object.keys(changes ?? {});

  if (role === "verification_staff") {
    if (kind !== "tutors") return "Verification staff can only update tutor records.";
    if (keys.some(k => k !== "Verification Status")) return "Verification staff can only change Verification Status.";
    return null;
  }

  if (role === "tutor_relations") {
    if (kind !== "tutors") return "Tutor Relations can only update tutor records.";
    if (keys.includes("Verification Status")) return "Tutor Relations cannot change Verification Status.";
    return null;
  }

  return "Your role does not allow this action.";
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
      id: s.student_id, name: s.student_name, parentsName: s.parents_name || "", mobile: s.phone || s.whatsapp || "",
    })),
    tutors: (tutors ?? []).map((t: Json) => ({
      id: t.tutor_id, name: t.full_name, mobile: t.mobile_number || t.whatsapp_number || "",
      activeNow: activeTutorIds.has(t.tutor_id),
      demoIds: [...(demosByTutor.get(t.tutor_id) ?? [])],
    })),
  };

}

async function handleGetOverview(caller: Caller): Promise<Json> {

  const overview = await rpc("admin_get_overview");
  if (!overview?.success) return overview;

  const access = DATA_ACCESS[caller.role];

  // Only sign document links for tutor data the caller actually receives.
  const withLinks = access.tutorsFull ? await linkDocuments(overview) : overview;

  if (!access.tuitions) withLinks.demos = [];
  if (!access.tutorsFull) withLinks.tutors = nameOnlyTable(withLinks.tutors, "Full Name");
  if (!access.studentsFull) withLinks.students = nameOnlyTable(withLinks.students, "Student Name");

  withLinks.me = { email: caller.email, fullName: caller.fullName, role: caller.role };

  if (canSeePayments(caller.role)) {
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

  if (caller.role === "super_admin") {
    const { data: employees } = await db
      .from("admin_users")
      .select("id, email, full_name, role, active, created_at")
      .order("created_at", { ascending: true });
    withLinks.employees = employees ?? [];
  }

  return withLinks;
}

/* ------------------------------------------------------------------
   NOTIFICATIONS - best-effort emails to the tutor/student an admin
   action affects, naming the admin who made the change. A failed
   send never blocks the action itself (see _shared/email.ts).
------------------------------------------------------------------ */

interface Party { name: string; email: string | null; }

async function lookupTutor(tutorId?: string | null): Promise<Party | null> {
  if (!tutorId) return null;
  const { data } = await db.from("tutors").select("full_name, email").eq("tutor_id", tutorId).maybeSingle();
  return data ? { name: data.full_name, email: data.email } : null;
}

async function lookupStudent(studentId?: string | null): Promise<Party | null> {
  if (!studentId) return null;
  const { data } = await db.from("students").select("student_name, email").eq("student_id", studentId).maybeSingle();
  return data ? { name: data.student_name, email: data.email } : null;
}

async function lookupDemo(demoId?: string | null): Promise<{ studentId: string; subject: string | null } | null> {
  if (!demoId) return null;
  const { data } = await db.from("tuitions").select("student_id, subject").eq("demo_id", demoId).maybeSingle();
  return data ? { studentId: data.student_id, subject: data.subject } : null;
}

async function studentForDemo(demoId?: string | null): Promise<Party | null> {
  const demo = await lookupDemo(demoId);
  return demo ? lookupStudent(demo.studentId) : null;
}

// The tutor currently running (accepted by both sides, not rejected or
// completed) on a demo - "who is teaching this right now".
async function activeTutorForDemo(demoId?: string | null): Promise<Party | null> {
  if (!demoId) return null;
  const { data } = await db.from("applications")
    .select("tutor_id")
    .eq("demo_id", demoId)
    .eq("parent_accepted", true).eq("tutor_accepted", true)
    .eq("parent_rejected", false).eq("tutor_rejected", false)
    .maybeSingle();
  return data ? lookupTutor(data.tutor_id) : null;
}

async function notify(party: Party | null, subject: string, heading: string, intro: string, rows: [string, string][] = []) {
  if (!party?.email) return;
  const html = emailTemplate({
    heading,
    greeting: `Hi ${party.name},`,
    intro,
    detailRowsHtml: rows.map(([l, v]) => detailRow(l, v)).join(""),
  });
  await sendMail(party.email, subject, html);
}

function changeSummaryRows(changes: Json): [string, string][] {
  return Object.entries(changes ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, v === null || v === "" ? "-" : String(v)] as [string, string]);
}

async function resolvePaymentParty(row: Json): Promise<Party | null> {
  if ((row.transaction_type === "payout" || row.transaction_type === "agency_charge") && row.tutor_id) return lookupTutor(row.tutor_id);
  if (row.demo_id) return studentForDemo(row.demo_id);
  if (row.subscription_id) {
    const { data: sub } = await db.from("subscriptions").select("student_id, tutor_id").eq("id", row.subscription_id).maybeSingle();
    if (sub?.student_id) return lookupStudent(sub.student_id);
    if (sub?.tutor_id) return lookupTutor(sub.tutor_id);
  }
  return null;
}

function paymentRows(row: Json): [string, string][] {
  return [
    ["Amount", `Rs. ${row.amount}`],
    ["Type", row.payment_type ?? "-"],
    ["Mode", row.payment_mode ?? "-"],
    ["Date", row.payment_date ?? "-"],
  ];
}

async function resolveSubscriptionParty(row: Json): Promise<Party | null> {
  if (row.student_id) return lookupStudent(row.student_id);
  if (row.tutor_id) return lookupTutor(row.tutor_id);
  return null;
}

function subscriptionRows(row: Json): [string, string][] {
  return [
    ["Plan", row.plan_name ?? "-"],
    ["Amount", `Rs. ${row.amount}`],
    ["Billing Cycle", row.billing_cycle ?? "-"],
    ["Status", row.status ?? "-"],
  ];
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

async function handle(body: Json, authHeader: string | null): Promise<Json> {

  const action = String(body?.action ?? "");
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

  if (!ACTIONS_BY_ROLE[caller.role]?.has(action)) return forbidden();

  switch (action) {

    case "adminUpdateRecord": {
      const scopeError = checkUpdateRecordScope(caller.role, String(body.kind), body.changes ?? {});
      if (scopeError) return { success: false, message: scopeError };
      const result = await rpc("admin_update_record", {
        p_kind: body.kind,
        p_id: body.id,
        p_changes: body.changes ?? {},
      });
      if (result?.success) {
        const kind = String(body.kind);
        const changes = body.changes ?? {};
        const isVerification = kind === "tutors" && changes["Verification Status"] !== undefined;
        const party = kind === "tutors" ? await lookupTutor(body.id)
          : kind === "students" ? await lookupStudent(body.id) : null;
        await notify(
          party,
          isVerification ? "Your verification status has been updated" : "Your profile was updated",
          isVerification ? "Verification Status Updated" : "Profile Updated",
          `${caller.fullName} has updated your profile on Urban Tutor Site.`,
          changeSummaryRows(changes),
        );
      }
      return result;
    }

    case "adminUpdateTuition": {
      const result = await rpc("admin_update_tuition", {
        p_demo_id: body.demoId,
        p_changes: body.changes ?? {},
      });
      if (result?.success) {
        const party = await studentForDemo(body.demoId);
        await notify(
          party,
          "Your tuition request was updated",
          "Tuition Request Updated",
          `${caller.fullName} has updated your tuition request.`,
          [["Demo ID", String(body.demoId)], ...changeSummaryRows(body.changes ?? {})],
        );
      }
      return result;
    }

    case "adminUpdateDemoRow": {
      if (!body.tutorId) {
        return { success: false, message: "Please refresh the page and try again." };
      }
      const result = await rpc("admin_update_demo_row", {
        p_demo_id: body.demoId,
        p_tutor_id: body.tutorId,
        p_changes: body.changes ?? {},
      });
      if (result?.success) {
        const rows: [string, string][] = [["Demo ID", String(body.demoId)], ...changeSummaryRows(body.changes ?? {})];
        const tutor = await lookupTutor(body.tutorId);
        await notify(tutor, "Your demo/application details were updated", "Demo Details Updated",
          `${caller.fullName} has updated the demo details for one of your applications.`, rows);
        const student = await studentForDemo(body.demoId);
        await notify(student, "Your demo details were updated", "Demo Details Updated",
          `${caller.fullName} has updated the demo details for your tuition request.`, rows);
      }
      return result;
    }

    case "adminAssignTutor": {
      const result = await rpc("admin_assign_tutor", {
        p_demo_id: body.demoId,
        p_tutor_lookup: String(body.tutor ?? ""),
      });
      if (result?.success) {
        const tutor = await activeTutorForDemo(body.demoId);
        const student = await studentForDemo(body.demoId);
        const rows: [string, string][] = [["Demo ID", String(body.demoId)]];
        await notify(tutor, "You have been assigned to a tuition", "Tutor Assigned",
          `${caller.fullName} has assigned you to teach this tuition.`, rows);
        await notify(student, "A tutor has been assigned to your tuition", "Tutor Assigned",
          `${caller.fullName} has assigned a tutor to your tuition request.`,
          tutor ? [...rows, ["Tutor", tutor.name]] : rows);
      }
      return result;
    }

    case "adminSetTerminated": {
      const terminated = body.value === true;
      const result = await rpc("admin_set_terminated", {
        p_demo_id: body.demoId,
        p_terminated: terminated,
      });
      if (result?.success) {
        const student = await studentForDemo(body.demoId);
        const tutor = await activeTutorForDemo(body.demoId);
        const rows: [string, string][] = [["Demo ID", String(body.demoId)]];
        const heading = terminated ? "Tuition Terminated" : "Tuition Reopened";
        const intro = `${caller.fullName} has ${terminated ? "terminated" : "reopened"} this tuition.`;
        await notify(student, heading, heading, intro, rows);
        await notify(tutor, heading, heading, intro, rows);
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
        const party = await resolvePaymentParty(inserted);
        await notify(party, "A payment was recorded", "Payment Recorded",
          `${caller.fullName} has recorded a payment on your account.`, paymentRows(inserted));
      }
      return { success: true, message: "Payment recorded." };
    }

    case "adminUpdatePayment": {
      if (!body.id) return { success: false, message: "Missing payment." };
      const changes = paymentChangesFromBody(body, true);
      if ("error" in changes) return { success: false, message: changes.error };
      const { data: updated, error } = await db.from("payments").update(changes).eq("id", body.id).select().maybeSingle();
      if (error) return { success: false, message: error.message };
      if (updated) {
        const party = await resolvePaymentParty(updated);
        await notify(party, "A payment was updated", "Payment Updated",
          `${caller.fullName} has updated a payment on your account.`, paymentRows(updated));
      }
      return { success: true, message: "Payment updated." };
    }

    case "adminDeletePayment": {
      if (!body.id) return { success: false, message: "Missing payment." };
      const { data: existing } = await db.from("payments").select("*").eq("id", body.id).maybeSingle();
      const { error } = await db.from("payments").delete().eq("id", body.id);
      if (error) return { success: false, message: error.message };
      if (existing) {
        const party = await resolvePaymentParty(existing);
        await notify(party, "A payment was removed", "Payment Removed",
          `${caller.fullName} has removed a payment record on your account.`, paymentRows(existing));
      }
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
      if (inserted) {
        const party = await resolveSubscriptionParty(inserted);
        await notify(party, "A subscription was created", "Subscription Created",
          `${caller.fullName} has set up a subscription for you.`, subscriptionRows(inserted));
      }
      return { success: true, message: "Subscription created." };
    }

    case "adminUpdateSubscription": {
      if (!body.id) return { success: false, message: "Missing subscription." };
      const changes = subscriptionChangesFromBody(body, true);
      if ("error" in changes) return { success: false, message: changes.error };
      const { data: updated, error } = await db.from("subscriptions").update(changes).eq("id", body.id).select().maybeSingle();
      if (error) return { success: false, message: error.message };
      if (updated) {
        const party = await resolveSubscriptionParty(updated);
        await notify(party, "Your subscription was updated", "Subscription Updated",
          `${caller.fullName} has updated your subscription.`, subscriptionRows(updated));
      }
      return { success: true, message: "Subscription updated." };
    }

    case "adminDeleteSubscription": {
      if (!body.id) return { success: false, message: "Missing subscription." };
      const { data: existing } = await db.from("subscriptions").select("*").eq("id", body.id).maybeSingle();
      const { error } = await db.from("subscriptions").delete().eq("id", body.id);
      if (error) return { success: false, message: error.message };
      if (existing) {
        const party = await resolveSubscriptionParty(existing);
        await notify(party, "Your subscription was cancelled", "Subscription Removed",
          `${caller.fullName} has removed your subscription.`, subscriptionRows(existing));
      }
      return { success: true, message: "Subscription deleted." };
    }

    case "adminListEmployees": {
      const { data, error } = await db
        .from("admin_users")
        .select("id, email, full_name, role, active, created_at")
        .order("created_at", { ascending: true });
      if (error) return { success: false, message: error.message };
      return { success: true, employees: data };
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
