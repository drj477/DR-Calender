import type { AuthSession } from "./authService";
import type { TemporalEntity } from "../temporal/types";

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

type GoogleEventResponse = { id?: string; htmlLink?: string; error?: { message?: string } };

function toGooglePayload(entity: TemporalEntity) {
  if (entity.scheduledAt === null || entity.endAt === null || entity.endAt <= entity.scheduledAt) {
    throw new Error("Google Calendar requires an event with a valid start and end time.");
  }
  const allDay = entity.metadata?.event?.kind === "all-day";
  if (allDay) {
    const startDate = new Date(entity.scheduledAt).toISOString().slice(0, 10);
    const endDate = new Date(entity.endAt).toISOString().slice(0, 10);
    return { summary: entity.title, location: entity.metadata?.event?.location ?? undefined, start: { date: startDate }, end: { date: endDate } };
  }
  return {
    summary: entity.title,
    location: entity.metadata?.event?.location ?? undefined,
    start: { dateTime: new Date(entity.scheduledAt).toISOString(), timeZone: entity.timeZone || "UTC" },
    end: { dateTime: new Date(entity.endAt).toISOString(), timeZone: entity.timeZone || "UTC" },
  };
}

/** Create or update an event in the signed-in user's primary Google Calendar. */
export async function publishEventToGoogleCalendar(entity: TemporalEntity, session: AuthSession): Promise<{ eventId: string; htmlLink: string | null }> {
  if (!session.providerToken) {
    throw new Error("Your Google Calendar access is missing or expired. Sign out and sign in with Google again, approving Calendar event access.");
  }
  const existingGoogleId = entity.metadata?.googleCalendar?.eventId;
  const url = existingGoogleId ? `${EVENTS_URL}/${encodeURIComponent(existingGoogleId)}` : EVENTS_URL;
  const response = await fetch(url, {
    method: existingGoogleId ? "PUT" : "POST",
    headers: { Authorization: `Bearer ${session.providerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(toGooglePayload(entity)),
  });
  const payload = await response.json().catch(() => ({})) as GoogleEventResponse;
  if (!response.ok || !payload.id) {
    const detail = payload.error?.message ?? `Google Calendar request failed (${response.status}).`;
    if (response.status === 401) throw new Error("Google Calendar access expired. Sign out and sign in with Google again, then retry.");
    if (response.status === 403) throw new Error(`Google Calendar denied event write access. Confirm the Calendar API is enabled and re-consent to the calendar.events scope. ${detail}`);
    throw new Error(detail);
  }
  return { eventId: payload.id, htmlLink: payload.htmlLink ?? null };
}

/** Delete a linked event from the signed-in user's primary Google Calendar. */
export async function deleteEventFromGoogleCalendar(eventId: string, session: AuthSession): Promise<void> {
  if (!session.providerToken) {
    throw new Error("Your Google Calendar access is missing or expired. Sign out and sign in with Google again, approving Calendar event access.");
  }
  const response = await fetch(`${EVENTS_URL}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.providerToken}` },
  });
  // Google Calendar returns 204 on success. Treat 404 as already deleted.
  if (response.ok || response.status === 404 || response.status === 410) return;
  const payload = await response.json().catch(() => ({})) as GoogleEventResponse;
  const detail = payload.error?.message ?? `Google Calendar delete failed (${response.status}).`;
  if (response.status === 401) throw new Error("Google Calendar access expired. Sign out and sign in with Google again, then retry.");
  if (response.status === 403) throw new Error(`Google Calendar denied event delete access. Confirm Calendar event access was approved. ${detail}`);
  throw new Error(detail);
}

