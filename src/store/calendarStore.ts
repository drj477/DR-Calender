import { create } from "zustand";
import type { ItemType, SyncMutation, TemporalEntity, WidgetSnapshotDTO } from "../temporal/types";

export interface CalendarViewport {
  mode: "day" | "week" | "month" | "agenda";
  anchorDate: number;
  visibleStart: number;
  visibleEnd: number;
}

export interface CalendarStoreState {
  entitiesById: Record<string, TemporalEntity>;
  viewport: CalendarViewport;
  pendingMutations: SyncMutation[];
  widgetSnapshot: WidgetSnapshotDTO | null;
  hydrated: boolean;
  hydrate(entities: TemporalEntity[], mutations?: SyncMutation[]): void;
  setViewport(viewport: Partial<CalendarViewport>): void;
  upsertEntity(entity: TemporalEntity, mutationId: string): void;
  deleteEntity(id: string, mutationId: string, workspaceId: string, itemType: ItemType): void;
  markCompleted(id: string, completed: boolean, mutationId: string): void;
  acknowledgeMutation(mutationId: string): void;
  setWidgetSnapshot(snapshot: WidgetSnapshotDTO): void;
}

const now = Date.now();

export const useCalendarStore = create<CalendarStoreState>((set, get) => ({
  entitiesById: {},
  viewport: {
    mode: "week",
    anchorDate: now,
    visibleStart: now,
    visibleEnd: now + 7 * 24 * 60 * 60_000,
  },
  pendingMutations: [],
  widgetSnapshot: null,
  hydrated: false,

  hydrate(entities, mutations = []) {
    const entitiesById: Record<string, TemporalEntity> = {};
    for (const entity of entities) entitiesById[entity.id] = entity;
    set({ entitiesById, pendingMutations: mutations, hydrated: true });
  },

  setViewport(viewport) {
    set(state => ({ viewport: { ...state.viewport, ...viewport } }));
  },

  upsertEntity(entity, mutationId) {
    const mutation: SyncMutation<TemporalEntity> = {
      mutationId,
      workspaceId: entity.workspaceId,
      entityId: entity.id,
      entityType: entity.itemType,
      operation: "upsert",
      payload: entity,
      syncVersion: entity.syncVersion,
      createdAt: Date.now(),
      retryCount: 0,
    };
    set(state => ({
      entitiesById: { ...state.entitiesById, [entity.id]: entity },
      pendingMutations: [...state.pendingMutations.filter(item => item.mutationId !== mutationId), mutation],
    }));
  },

  deleteEntity(id, mutationId, workspaceId, itemType) {
    const existing = get().entitiesById[id];
    const now = Date.now();
    const tombstone = existing ? { ...existing, deletedAt: now, updatedAt: now, syncVersion: existing.syncVersion + 1 } : null;
    const mutation: SyncMutation<{ deletedAt: number }> = {
      mutationId,
      workspaceId,
      entityId: id,
      entityType: itemType,
      operation: "delete",
      payload: { deletedAt: now },
      syncVersion: tombstone?.syncVersion ?? 1,
      createdAt: now,
      retryCount: 0,
    };
    set(state => ({
      entitiesById: tombstone ? { ...state.entitiesById, [id]: tombstone } : state.entitiesById,
      pendingMutations: [...state.pendingMutations.filter(item => item.mutationId !== mutationId), mutation],
    }));
  },

  markCompleted(id, completed, mutationId) {
    const entity = get().entitiesById[id];
    if (!entity) return;
    const updated: TemporalEntity = {
      ...entity,
      isCompleted: completed,
      updatedAt: Date.now(),
      syncVersion: entity.syncVersion + 1,
    };
    get().upsertEntity(updated, mutationId);
  },

  acknowledgeMutation(mutationId) {
    set(state => ({ pendingMutations: state.pendingMutations.filter(item => item.mutationId !== mutationId) }));
  },

  setWidgetSnapshot(snapshot) {
    set({ widgetSnapshot: snapshot });
  },
}));

/** Stable selectors help components subscribe only to the data they render. */
export const selectEntityById = (id: string) => (state: CalendarStoreState) => state.entitiesById[id];
export const selectVisibleEntities = (state: CalendarStoreState) =>
  Object.values(state.entitiesById).filter(entity =>
    entity.deletedAt === null &&
    (entity.scheduledAt === null ||
      (entity.scheduledAt < state.viewport.visibleEnd &&
        (entity.endAt ?? entity.scheduledAt) >= state.viewport.visibleStart)),
  );
export const selectPendingMutationCount = (state: CalendarStoreState) => state.pendingMutations.length;
