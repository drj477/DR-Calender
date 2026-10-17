import * as SecureStore from "expo-secure-store";

export interface SupabaseConfig { url: string; anonKey: string }
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string | null };
}
const CONFIG_KEY = "dr-calender.supabase-config.v1";
const SESSION_KEY = "dr-calender.auth-session.v1";

const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, "");
export async function saveSupabaseConfig(config: SupabaseConfig): Promise<void> {
  const url = normalizeUrl(config.url);
  if (!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(url)) throw new Error("Enter a valid HTTPS Supabase project URL.");
  if (!config.anonKey.trim()) throw new Error("Supabase anon/publishable key is required.");
  await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify({ url, anonKey: config.anonKey.trim() }));
}
export async function loadSupabaseConfig(): Promise<SupabaseConfig | null> {
  const raw = await SecureStore.getItemAsync(CONFIG_KEY);
  if (!raw) return null;
  try { const value = JSON.parse(raw) as SupabaseConfig; return value.url && value.anonKey ? value : null; } catch { return null; }
}
export async function clearSupabaseConfig(): Promise<void> {
  await SecureStore.deleteItemAsync(CONFIG_KEY);
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
export async function loadSession(): Promise<AuthSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as AuthSession;
    if (!session.accessToken || !session.refreshToken || !session.user?.id) return null;
    return session;
  } catch { return null; }
}
async function saveSession(session: AuthSession): Promise<AuthSession> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  return session;
}
async function requestAuth(config: SupabaseConfig, path: string, body: unknown, token?: string): Promise<any> {
  const response = await fetch(`${normalizeUrl(config.url)}/auth/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.anonKey, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.msg ?? json.message ?? json.error_description ?? json.error ?? `Authentication failed (${response.status}).`);
  return json;
}
function toSession(payload: any): AuthSession {
  if (!payload.access_token || !payload.refresh_token || !payload.user?.id) throw new Error("The authentication server returned an incomplete session.");
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresAt: Date.now() + Number(payload.expires_in ?? 3600) * 1000, user: { id: payload.user.id, email: payload.user.email ?? null } };
}
export async function signIn(config: SupabaseConfig, email: string, password: string): Promise<AuthSession> {
  const payload = await requestAuth(config, "token?grant_type=password", { email: email.trim().toLowerCase(), password });
  return saveSession(toSession(payload));
}
export async function signUp(config: SupabaseConfig, email: string, password: string): Promise<{ session: AuthSession | null; confirmationRequired: boolean }> {
  const payload = await requestAuth(config, "signup", { email: email.trim().toLowerCase(), password });
  if (payload.access_token && payload.refresh_token && payload.user?.id) return { session: await saveSession(toSession(payload)), confirmationRequired: false };
  return { session: null, confirmationRequired: true };
}
export async function refreshSession(config: SupabaseConfig, session: AuthSession): Promise<AuthSession> {
  const payload = await requestAuth(config, "token?grant_type=refresh_token", { refresh_token: session.refreshToken });
  return saveSession(toSession(payload));
}
export async function getValidSession(config: SupabaseConfig): Promise<AuthSession | null> {
  const session = await loadSession();
  if (!session) return null;
  if (session.expiresAt > Date.now() + 60_000) return session;
  try { return await refreshSession(config, session); } catch { await SecureStore.deleteItemAsync(SESSION_KEY); return null; }
}
export async function signOut(config: SupabaseConfig, session: AuthSession): Promise<void> {
  try {
    await fetch(`${normalizeUrl(config.url)}/auth/v1/logout`, { method: "POST", headers: { apikey: config.anonKey, Authorization: `Bearer ${session.accessToken}` } });
  } finally { await SecureStore.deleteItemAsync(SESSION_KEY); }
}
