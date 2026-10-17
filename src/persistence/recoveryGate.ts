/**
 * Process-wide coordination between cloud sync and destructive local recovery.
 * The lock is intentionally in-memory: SQLite remains the final transaction
 * boundary, while this gate prevents this app instance from mutating the same
 * database concurrently through its own sync/recovery workflows.
 */
let activeSyncOperations = 0;
let maintenanceOperation = false;

export function acquireSyncLease(): () => void {
  if (maintenanceOperation) {
    throw new Error("Local data recovery is in progress. Sync is paused until recovery finishes.");
  }
  activeSyncOperations += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeSyncOperations = Math.max(0, activeSyncOperations - 1);
  };
}

export function acquireDataMaintenanceLease(): () => void {
  if (maintenanceOperation) {
    throw new Error("Another local data recovery operation is already in progress.");
  }
  if (activeSyncOperations > 0) {
    throw new Error("Sync is currently running. Wait for sync to finish before restoring a backup.");
  }
  maintenanceOperation = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    maintenanceOperation = false;
  };
}

export function isSyncOperationActive(): boolean {
  return activeSyncOperations > 0;
}

export function isDataMaintenanceActive(): boolean {
  return maintenanceOperation;
}
