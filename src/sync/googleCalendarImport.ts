import type { AuthSession } from "./authService";
import type { LocalCalendarDatabase } from "../persistence/localDatabase";
import type { TemporalEntity, TemporalMetadata } from "../temporal/types";
import { useCalendarStore } from "../store/calendarStore";

type GoogleCalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  updated?: string;
};
type GoogleEventsResponse = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
  error?: { message?: string; status?: string; errors?: Array<{ reason?: string; message?: string }> };
};
const GOOGLE_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const syncTokenKey = (workspaceId: string) => `google_calendar_sync_token:${workspaceId}`;

function parseGoogleDate(value: { dateTime?: string; date?: string } | undefined): number | null {
  if (value?.dateTime) {
    const parsed = Date.parse(value.dateTime);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value?.date) {
    const parsed = Date.parse(`${value.date}T00:00:00.000Z`);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
async function fetchGoogleEvents(accessToken: string): Promise<GoogleCalendarEvent[]> {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const url = new URL(GOOGLE_EVENTS_URL);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", new Date(Date.now() - 365 * 86400000).toISOString());
    url.searchParams.set("timeMax", new Date(Date.now() + 730 * 86400000).toISOString());
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    const payload = await response.json().catch(() => ({})) as GoogleEventsResponse;
    if (!response.ok) {
      const detail = payload.error?.message ?? `Google Calendar request failed (${response.status}).`;
      if (response.status === 401) throw new Error(`Google Calendar access expired. Sign in with Google again. ${detail}`);
      if (response.status === 403) throw new Error(`Google Calendar access denied. Confirm Calendar API access was approved. ${detail}`);
      throw new Error(detail);
    }
    events.push(...(payload.items ?? []));
    pageToken = payload.nextPageToken;
    if (!pageToken) break;
  }
  return events;
}
function mapGoogleEvent(item: GoogleCalendarEvent, existing: TemporalEntity | null, workspaceId: string, now: number): TemporalEntity | null {
  if (!item.id || item.status === "cancelled") return null;
  const start = parseGoogleDate(item.start);
  const end = parseGoogleDate(item.end);
  if (start === null) return null;
  return {
    id: existing?.id ?? `google-calendar-${item.id}`,
    workspaceId,
    itemType: "event",
    title: (item.summary ?? "Untitled Google Calendar event").trim() || "Untitled Google Calendar event",
    scheduledAt: start,
    endAt: end !== null && end > start ? end : null,
    isCompleted: false,
    priority: existing?.priority ?? "normal",
    isShielded: existing?.isShielded ?? false,
    isElastic: existing?.isElastic ?? false,
    isGhost: false,
    ghostClusterId: null,
    assignedUserIds: existing?.assignedUserIds ?? [],
    rrule: existing?.rrule ?? null,
    syncVersion: (existing?.syncVersion ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
    timeZone: item.start?.timeZone ?? existing?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    metadata: {
      ...existing?.metadata,
      event: {
        kind: item.start?.date ? "all-day" : "standard",
        commitment: existing?.metadata?.event?.commitment ?? "hard",
        location: item.location ?? null,
        meetingUrl: item.htmlLink ?? existing?.metadata?.event?.meetingUrl ?? null,
        organizerUserId: existing?.metadata?.event?.organizerUserId ?? null,
        attendeeUserIds: existing?.metadata?.event?.attendeeUserIds ?? [],
        travelBufferMinutes: existing?.metadata?.event?.travelBufferMinutes ?? null,
        cooldownBufferMinutes: existing?.metadata?.event?.cooldownBufferMinutes ?? null,
        reminderMinutesBefore: existing?.metadata?.event?.reminderMinutesBefore ?? null,
        notificationIds: existing?.metadata?.event?.notificationIds ?? [],
      },
      googleCalendar: {
        source: "google",
        eventId: item.id,
        htmlLink: item.htmlLink ?? null,
        description: item.description ?? null,
        originalStartDate: item.start?.date ?? null,
        originalEndDate: item.end?.date ?? null,
        providerUpdatedAt: item.updated ?? null,
      },
    } satisfies TemporalMetadata,
  };
}

/** Initial import of the primary calendar (keeps the original import button behavior). */
export async function importPrimaryGoogleCalendar(database: LocalCalendarDatabase, session: AuthSession): Promise<number> {
  if (!session.providerToken) throw new Error("Google Calendar access is missing. Sign in with Google again and approve Calendar access.");
  const googleEvents = await fetchGoogleEvents(session.providerToken);
  let imported = 0;
  const now = Date.now();
  for (const item of googleEvents) {
    const existing = await database.repository.getById(`google-calendar-${item.id}`);
    const entity = mapGoogleEvent(item, existing, database.workspaceId, now);
    if (!entity) continue;
    await database.repository.upsert(entity, `google-calendar-import-${item.id}-${entity.syncVersion}`);
    imported++;
  }
  return imported;
}

/**
 * Incrementally applies Google Calendar changes to the local workspace.
 * Google sync tokens are stored per workspace; HTTP 410 invalidates a token,
 * so the next attempt performs a fresh full sync instead.
 */
export async function syncGoogleCalendarChanges(database: LocalCalendarDatabase, session: AuthSession): Promise<{ createdOrUpdated: number; deleted: number; fullSync: boolean }> {
  if (!session.providerToken) throw new Error("Google Calendar access is missing or expired. Sign in with Google again and approve Calendar access.");
  const key = syncTokenKey(database.workspaceId);
  const setting = await database.db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = ? LIMIT 1", key);
  let syncToken = setting?.value ?? null;
  let fullSync = !syncToken;
  let resetForRetry = false;
  const changes: GoogleCalendarEvent[] = [];
  let nextSyncToken: string | null = null;

  const fetchChanges = async (token: string | null): Promise<void> => {
    let pageToken: string | undefined;
    for (let page = 0; page < 100; page++) {
      const url = new URL(GOOGLE_EVENTS_URL);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("showDeleted", "true");
      url.searchParams.set("maxResults", "250");
      if (token) url.searchParams.set("syncToken", token);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${session.providerToken}` } });
      const payload = await response.json().catch(() => ({})) as GoogleEventsResponse;
      if (response.status === 410 && token && !resetForRetry) {
        resetForRetry = true;
        await database.db.runAsync("DELETE FROM app_settings WHERE key = ?", key);
        changes.length = 0;
        await fetchChanges(null);
        fullSync = true;
        return;
      }
      if (!response.ok) {
        const detail = payload.error?.message ?? `Google Calendar sync failed (${response.status}).`;
        if (response.status === 401) throw new Error(`Google Calendar access expired. Sign in with Google again. ${detail}`);
        if (response.status === 403) throw new Error(`Google Calendar access denied. Confirm Calendar API access was approved. ${detail}`);
        throw new Error(detail);
      }
      changes.push(...(payload.items ?? []));
      pageToken = payload.nextPageToken;
      if (!pageToken) { nextSyncToken = payload.nextSyncToken ?? null; break; }
    }
    if (!nextSyncToken) throw new Error("Google Calendar did not return a sync token. No sync checkpoint was saved; retry the sync.");
  };
  await fetchChanges(syncToken);

  let createdOrUpdated = 0;
  let deleted = 0;
  const now = Date.now();
  const allLocal = await database.repository.queryRange(database.workspaceId, 0, 4102444800000);
  const linked = allLocal.filter(entity => entity.itemType === "event" && entity.metadata?.googleCalendar?.eventId);
  for (const item of changes) {
    if (!item.id) continue;
    const existing = linked.find(entity => entity.metadata?.googleCalendar?.eventId === item.id)
      ?? await database.repository.getById(`google-calendar-${item.id}`)
      ?? await database.repository.getByIdIncludingDeleted(`google-calendar-${item.id}`);
    if (item.status === "cancelled") {
      if (existing && existing.deletedAt === null) {
        const mutationId = `google-calendar-remote-delete-${item.id}-${existing.syncVersion + 1}`;
        const tombstone = await database.repository.softDelete(existing.id, mutationId);
        if (tombstone) {
          useCalendarStore.getState().deleteEntity(existing.id, mutationId, existing.workspaceId, "event");
          deleted++;
        }
      }
      continue;
    }
    const entity = mapGoogleEvent(item, existing, database.workspaceId, now);
    if (!entity) continue;
    const mutationId = `google-calendar-remote-upsert-${item.id}-${entity.syncVersion}`;
    await database.repository.upsert(entity, mutationId);
    useCalendarStore.getState().upsertEntity(entity, mutationId);
    createdOrUpdated++;
  }
  await database.db.runAsync(
    "INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    key, nextSyncToken, Date.now(),
  );
  return { createdOrUpdated, deleted, fullSync };
}
