import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { initializeLocalDatabase } from "../persistence/localDatabase";
import { getValidSession, loadSupabaseConfig } from "./authService";
import { syncGoogleCalendarChanges } from "./googleCalendarImport";

export const GOOGLE_CALENDAR_BACKGROUND_TASK = "DR_CALENDER_GOOGLE_CALENDAR_BACKGROUND_SYNC";

// Task definitions must be evaluated at module scope so Android can invoke the
// task even when React has not mounted.
if (!TaskManager.isTaskDefined(GOOGLE_CALENDAR_BACKGROUND_TASK)) {
  TaskManager.defineTask(GOOGLE_CALENDAR_BACKGROUND_TASK, async () => {
    try {
      const config = await loadSupabaseConfig();
      if (!config) return BackgroundTask.BackgroundTaskResult.Success;
      const session = await getValidSession(config);
      if (!session?.providerToken) return BackgroundTask.BackgroundTaskResult.Success;
      const database = await initializeLocalDatabase();
      await syncGoogleCalendarChanges(database, session);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      console.warn("Google Calendar background sync failed", error);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerGoogleCalendarBackgroundSync(): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(GOOGLE_CALENDAR_BACKGROUND_TASK);
  if (!registered) {
    await BackgroundTask.registerTaskAsync(GOOGLE_CALENDAR_BACKGROUND_TASK, {
      minimumInterval: 15,
    });
  }
}
