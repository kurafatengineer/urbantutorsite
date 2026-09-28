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

const PAYMENT_TYPES = ["advance", "regular", "final"];
const COLLECTED_BY = ["agency", "tutor"];
const TRANSACTION_TYPES = ["collection", "payout"];

function paymentChangesFromBody(body: Json, partial: boolean): Json | { error: string } {
  const changes: Json = {};

  const assign = (key: string, value: unknown) => { if (value !== undefined) changes[key] = value; };

  // What kind of transaction this is: money coming in from a parent
  // ("collection", the default) or the agency paying a tutor out of
  // money it already collected ("payout").
  let transactionType: string | undefined;

  if (!partial || body.transactionType !== undefined) {
    transactionType = String(body.transactionType ?? "collection");
    if (!TRANSACTION_TYPES.includes(transactionType)) return { error: "Unknown transaction type." };
    changes.transaction_type = transactionType;
  }

  const isPayout = transactionType === "payout";

  if (!partial || body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!(amount > 0)) return { error: "Enter a valid amount." };
    changes.amount = amount;
  }

  if (!partial || body.paymentType !== undefined) {
    const t = String(body.paymentType ?? "regular");
    if (!PAYMENT_TYPES.includes(t)) return { error: "Unknown payment type." };
    changes.payment_type = t;
  }

  // Collected By / Our Cut only apply to a collection from a parent -
  // a payout has no "collector", the agency is always the one paying.
  if (!isPayout && (!partial || body.collectedBy !== undefined)) {
    const c = String(body.collectedBy ?? "agency");
    if (!COLLECTED_BY.includes(c)) return { error: "Unknown collector." };
    changes.collected_by = c;
  }

  if (!isPayout && body.ourCutAmount !== undefined) {
    changes.our_cut_amount = body.ourCutAmount === "" || body.ourCutAmount === null
      ? null : Number(body.ourCutAmount);
  }

  if (!partial || body.paymentMode !== undefined) {
    const mode = String(body.paymentMode ?? "").trim();
    if (!mode) return { error: "Enter how the payment was made (cash, UPI, bank transfer, ...)." };
    changes.payment_mode = mode;
  }

  assign("payment_date", body.paymentDate || undefined);
  assign("notes", body.notes !== undefined ? String(body.notes ?? "").trim() : undefined);

  if (!partial) {
    if (isPayout && !body.tutorId) return { error: "Choose which tutor is being paid." };
    if (!isPayout && !body.demoId && !body.subscriptionId) return { error: "Demo ID or Subscription is required." };
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
    if (!(amount > 0)) return { error: "Enter a valid amount." };
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
      return rpc("admin_update_record", {
        p_kind: body.kind,
        p_id: body.id,
        p_changes: body.changes ?? {},
      });
    }

    case "adminUpdateTuition":
      return rpc("admin_update_tuition", {
        p_demo_id: body.demoId,
        p_changes: body.changes ?? {},
      });

    case "adminUpdateDemoRow":
      if (!body.tutorId) {
        return { success: false, message: "Please refresh the page and try again." };
      }
      return rpc("admin_update_demo_row", {
        p_demo_id: body.demoId,
        p_tutor_id: body.tutorId,
        p_changes: body.changes ?? {},
      });

    case "adminAssignTutor":
      return rpc("admin_assign_tutor", {
        p_demo_id: body.demoId,
        p_tutor_lookup: String(body.tutor ?? ""),
      });

    case "adminSetTerminated":
      return rpc("admin_set_terminated", {
        p_demo_id: body.demoId,
        p_terminated: body.value === true,
      });

    case "adminAddPayment": {
      const changes = paymentChangesFromBody(body, false);
      if ("error" in changes) return { success: false, message: changes.error };
      const { error } = await db.from("payments").insert({ ...changes, recorded_by: caller.id });
      if (error) return { success: false, message: error.message };
      return { success: true, message: "Payment recorded." };
    }

    case "adminUpdatePayment": {
      if (!body.id) return { success: false, message: "Missing payment." };
      const changes = paymentChangesFromBody(body, true);
      if ("error" in changes) return { success: false, message: changes.error };
      const { error } = await db.from("payments").update(changes).eq("id", body.id);
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
      const { error } = await db.from("subscriptions").insert({ ...changes, created_by: caller.id });
      if (error) return { success: false, message: error.message };
      return { success: true, message: "Subscription created." };
    }

    case "adminUpdateSubscription": {
      if (!body.id) return { success: false, message: "Missing subscription." };
      const changes = subscriptionChangesFromBody(body, true);
      if ("error" in changes) return { success: false, message: changes.error };
      const { error } = await db.from("subscriptions").update(changes).eq("id", body.id);
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
