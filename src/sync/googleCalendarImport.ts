import type { AuthSession } from "./authService";
import type { LocalCalendarDatabase } from "../persistence/localDatabase";
import type { TemporalEntity, TemporalMetadata } from "../temporal/types";

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
  error?: { message?: string };
};

const GOOGLE_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

function parseGoogleDate(value: { dateTime?: string; date?: string } | undefined): number | null {
  if (value?.dateTime) {
    const parsed = Date.parse(value.dateTime);
    return Number.isFinite(parsed) ? parsed : null;
  }
  // Google all-day dates are calendar dates, not instants. Use UTC midnight as a
  // stable representation and retain the original date in metadata.
  if (value?.date) {
    const parsed = Date.parse(`${value.date}T00:00:00.000Z`);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function fetchGoogleEvents(accessToken: string): Promise<GoogleCalendarEvent[]> {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  // Bound the initial import to avoid an unexpectedly huge first sync.
  for (let page = 0; page < 10; page += 1) {
    const url = new URL(GOOGLE_EVENTS_URL);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", new Date(Date.now() - 365 * 86400000).toISOString());
    url.searchParams.set("timeMax", new Date(Date.now() + 730 * 86400000).toISOString());
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => ({})) as GoogleEventsResponse;
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Google Calendar access was not granted or has expired. Sign out and sign in with Google again to grant calendar read access.");
      }
      throw new Error(payload.error?.message ?? `Google Calendar request failed (${response.status}).`);
    }
    events.push(...(payload.items ?? []));
    pageToken = payload.nextPageToken;
    if (!pageToken) break;
  }
  return events;
}

export async function importPrimaryGoogleCalendar(
  database: LocalCalendarDatabase,
  session: AuthSession,
): Promise<number> {
  if (!session.providerToken) {
    throw new Error("This Google session has no Calendar access token. Sign out, then sign in with Google again and approve the Calendar read-only permission.");
  }
  const googleEvents = await fetchGoogleEvents(session.providerToken);
  let imported = 0;
  const now = Date.now();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  for (const item of googleEvents) {
    if (!item.id || item.status === "cancelled") continue;
    const start = parseGoogleDate(item.start);
    const end = parseGoogleDate(item.end);
    if (start === null) continue;
    const entityId = `google-calendar-${item.id}`;
    const existing = await database.repository.getById(entityId);
    const entity: TemporalEntity = {
      id: entityId,
      workspaceId: database.workspaceId,
      itemType: "event",
      title: (item.summary ?? "Untitled Google Calendar event").trim() || "Untitled Google Calendar event",
      scheduledAt: start,
      endAt: end !== null && end > start ? end : null,
      isCompleted: false,
      priority: "normal",
      isShielded: false,
      isElastic: false,
      isGhost: false,
      ghostClusterId: null,
      assignedUserIds: [],
      rrule: null,
      syncVersion: (existing?.syncVersion ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
      timeZone: item.start?.timeZone ?? timeZone,
      metadata: {
        event: {
          kind: item.start?.date ? "all-day" : "standard",
          commitment: "hard",
          location: item.location ?? null,
          meetingUrl: item.htmlLink ?? null,
          organizerUserId: null,
          attendeeUserIds: [],
          travelBufferMinutes: null,
          cooldownBufferMinutes: null,
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
    await database.repository.upsert(entity, `google-calendar-import-${item.id}-${entity.syncVersion}`);
    imported += 1;
  }
  return imported;
}
