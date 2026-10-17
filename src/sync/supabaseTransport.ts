import type { SyncMutation } from "../temporal/types";
import type { AuthSession, SupabaseConfig } from "./authService";
import type { RemoteTemporalRecord, SyncTransport } from "./syncCoordinator";
import { getValidSession } from "./authService";

type RemoteRow = { entity_id: string; entity_payload: unknown; clock: unknown; revision: number };
export class SupabaseSyncTransport implements SyncTransport {
  constructor(private readonly config: SupabaseConfig, _initialSession: AuthSession) {}
  private async credentials(): Promise<AuthSession> {
    const current = await getValidSession(this.config);
    if (!current) throw new Error("Your session expired. Sign in again to sync.");
    return current;
  }
  private async rpc<T>(name: string, body: unknown): Promise<T> {
    const session = await this.credentials();
    const response = await fetch(`${this.config.url.replace(/\/+$/, "")}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: this.config.anonKey, Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error("Sync session is not authorized. Sign in again.");
      if (response.status === 403) throw new Error("You do not have permission to access this workspace.");
      throw new Error(result.message ?? result.details ?? result.hint ?? `Sync request failed (${response.status}).`);
    }
    return result as T;
  }
  async push(mutations: SyncMutation[]): Promise<{ acknowledgedMutationIds: string[] }> {
    if (!mutations.length) return { acknowledgedMutationIds: [] };
    const groups = new Map<string, SyncMutation[]>();
    for (const mutation of mutations) groups.set(mutation.workspaceId, [...(groups.get(mutation.workspaceId) ?? []), mutation]);
    const acknowledgedMutationIds: string[] = [];
    for (const [workspaceId, batch] of groups) {
      const result = await this.rpc<{ acknowledged_mutation_ids: string[] }>("dr_sync_push", {
        p_workspace_id: workspaceId,
        p_mutations: batch.map(m => ({
          mutation_id: m.mutationId, entity_id: m.entityId, entity_type: m.entityType,
          operation: m.operation, payload: m.payload, sync_version: m.syncVersion,
          created_at: m.createdAt,
        })),
      });
      acknowledgedMutationIds.push(...(result.acknowledged_mutation_ids ?? []));
    }
    return { acknowledgedMutationIds };
  }
  async pull(input: { workspaceId: string; cursor: string | null }): Promise<{ records: RemoteTemporalRecord[]; cursor: string | null }> {
    const result = await this.rpc<{ records: RemoteRow[]; cursor: number | null }>("dr_sync_pull", {
      p_workspace_id: input.workspaceId,
      p_after_revision: input.cursor ? Number(input.cursor) : 0,
      p_limit: 500,
    });
    const records = (result.records ?? []).map(row => ({
      entity: row.entity_payload as RemoteTemporalRecord["entity"],
      clock: row.clock as RemoteTemporalRecord["clock"],
    }));
    return { records, cursor: result.cursor === null ? input.cursor : String(result.cursor) };
  }
}

export interface RemoteWorkspace { id: string; name: string; workspace_type: "personal" | "family" | "team" | "project"; role: "owner" | "admin" | "editor" | "viewer" }
export async function listRemoteWorkspaces(config: SupabaseConfig): Promise<RemoteWorkspace[]> {
  const session = await getValidSession(config);
  if (!session) throw new Error("Sign in to load workspaces.");
  const response = await fetch(`${config.url.replace(/\/+$/, "")}/rest/v1/rpc/dr_list_workspaces`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: config.anonKey, Authorization: `Bearer ${session.accessToken}` }, body: "{}",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? `Could not load workspaces (${response.status}).`);
  return data as RemoteWorkspace[];
}
export async function createRemoteWorkspace(config: SupabaseConfig, name: string, type: "personal" | "family" | "team" | "project", workspaceId?: string): Promise<RemoteWorkspace> {
  const session = await getValidSession(config);
  if (!session) throw new Error("Sign in to create a workspace.");
  const response = await fetch(`${config.url.replace(/\/+$/, "")}/rest/v1/rpc/dr_create_workspace`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: config.anonKey, Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ p_name: name.trim(), p_workspace_type: type, p_workspace_id: workspaceId ?? null }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? `Could not create workspace (${response.status}).`);
  return data as RemoteWorkspace;
}

export async function addRemoteWorkspaceMember(config: SupabaseConfig, workspaceId: string, email: string, role: "editor" | "viewer"): Promise<void> {
  const session = await getValidSession(config);
  if (!session) throw new Error("Sign in to manage workspace members.");
  const baseUrl = config.url.endsWith("/") ? config.url.slice(0, -1) : config.url;
  const response = await fetch(`${baseUrl}/rest/v1/rpc/dr_add_workspace_member`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.anonKey, Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ p_workspace_id: workspaceId, p_email: email.trim().toLowerCase(), p_role: role }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? `Could not add workspace member (${response.status}).`);
}
