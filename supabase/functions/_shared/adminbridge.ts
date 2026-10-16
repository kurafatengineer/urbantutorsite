// How the chat bots run an admin action for an employee they recognised by phone number.
// It calls the "admin" Edge Function with the service key (which only edge functions hold) and names the
// employee. The admin function then checks that employee exactly as it does for the panel: active, inside
// their login hours, allowed to run that action - and it only accepts the few actions listed there as BOT_ACTIONS.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type Json = Record<string, any>;

export async function adminCall(employeeId: string, action: string, body: Json = {}): Promise<Json> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, action, botEmployeeId: employeeId }),
    });
    const out = await res.json().catch(() => null);
    return out ?? { success: false, message: "The admin service did not answer. Please try again." };
  } catch (err) {
    console.error("adminCall failed", action, String(err));
    return { success: false, message: "The admin service could not be reached. Please try again." };
  }
}
