// Authenticated invitation delivery. The client never receives a service-role key.
// Required function secrets: SUPABASE_URL, SUPABASE_ANON_KEY, RESEND_API_KEY,
// INVITE_FROM_EMAIL. Authorization is enforced by the caller-scoped RPCs.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] ?? char);
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "Use POST." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("INVITE_FROM_EMAIL");
  if (!supabaseUrl || !anonKey || !resendKey || !fromEmail) {
    return response(503, { error: "Workspace email delivery is not configured. Share the invitation ID from the app instead." });
  }
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return response(401, { error: "Sign in before sending a workspace invitation." });

  let body: { workspaceId?: unknown; email?: unknown; role?: unknown };
  try { body = await request.json(); } catch { return response(400, { error: "Invalid JSON body." }); }
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role === "viewer" ? "viewer" : body.role === "editor" ? "editor" : "";
  if (!workspaceId || workspaceId.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !role) {
    return response(400, { error: "Provide a workspace, valid email, and editor/viewer role." });
  }

  const headers = { apikey: anonKey, Authorization: authorization, "Content-Type": "application/json" };
  const inviteResponse = await fetch(supabaseUrl + "/rest/v1/rpc/dr_create_workspace_invite", {
    method: "POST", headers,
    body: JSON.stringify({ p_workspace_id: workspaceId, p_email: email, p_role: role }),
  });
  const inviteData = await inviteResponse.json().catch(() => ({}));
  if (!inviteResponse.ok || !inviteData?.id) {
    return response(inviteResponse.status === 401 ? 401 : inviteResponse.status === 403 ? 403 : 400, {
      error: inviteData?.message ?? inviteData?.details ?? "Could not create this workspace invitation.",
    });
  }

  let workspaceName = workspaceId;
  const workspaceResponse = await fetch(supabaseUrl + "/rest/v1/rpc/dr_list_workspaces", {
    method: "POST", headers, body: "{}",
  });
  if (workspaceResponse.ok) {
    const workspaces = await workspaceResponse.json().catch(() => []);
    if (Array.isArray(workspaces)) {
      const workspace = workspaces.find((item: { id?: string; name?: string }) => item.id === workspaceId);
      if (workspace?.name) workspaceName = workspace.name;
    }
  }

  const inviteId = String(inviteData.id);
  const expiresAt = typeof inviteData.expires_at === "string" ? inviteData.expires_at : "";
  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      subject: "You're invited to a DR-Calender workspace",
      text: "You have been invited to the workspace \"" + workspaceName + "\" as " + role + ".\n\nSign in to DR-Calender with " + email + " and enter this invitation ID in Account & sync:\n" + inviteId + "\n\n" + (expiresAt ? "This invitation expires at " + expiresAt + ".\n\n" : "") + "If you were not expecting this invitation, you can ignore this email.",
      html: "<p>You have been invited to the DR-Calender workspace <strong>" + escapeHtml(workspaceName) + "</strong> as <strong>" + role + "</strong>.</p><p>Sign in to DR-Calender using <strong>" + escapeHtml(email) + "</strong>, then enter this invitation ID in Account &amp; sync:</p><p style=\"font-size:18px;font-weight:bold;letter-spacing:1px\">" + escapeHtml(inviteId) + "</p>" + (expiresAt ? "<p>This invitation expires at " + escapeHtml(expiresAt) + ".</p>" : "") + "<p>If you were not expecting this invitation, you can ignore this email.</p>",
    }),
  });
  if (!emailResponse.ok) {
    // Return the created invite ID so the signed-in client can still share it.
    const detail = await emailResponse.text().catch(() => "");
    return response(502, { error: "The invitation was created, but the email provider rejected delivery. Share the invitation ID manually.", invite: inviteData, providerStatus: emailResponse.status, providerMessage: detail.slice(0, 500) });
  }
  return response(200, { invite: inviteData, emailSent: true });
});
