export interface HybridLogicalClock {
  wallTime: number;
  logical: number;
  nodeId: string;
}

export function compareHLC(a: HybridLogicalClock, b: HybridLogicalClock): number {
  if (a.wallTime !== b.wallTime) return a.wallTime < b.wallTime ? -1 : 1;
  if (a.logical !== b.logical) return a.logical < b.logical ? -1 : 1;
  return a.nodeId.localeCompare(b.nodeId);
}

export function tickHLC(
  previous: HybridLogicalClock | null,
  now: number,
  nodeId: string,
): HybridLogicalClock {
  if (!Number.isFinite(now) || !nodeId.trim()) throw new Error("HLC requires finite time and a nodeId");
  if (!previous) return { wallTime: now, logical: 0, nodeId };
  return now > previous.wallTime
    ? { wallTime: now, logical: 0, nodeId }
    : { wallTime: previous.wallTime, logical: previous.logical + 1, nodeId };
}

export function mergeHLC(
  local: HybridLogicalClock | null,
  remote: HybridLogicalClock,
  now: number,
  nodeId: string,
): HybridLogicalClock {
  if (!Number.isFinite(now) || !nodeId.trim()) throw new Error("HLC merge requires finite time and a nodeId");
  const localWall = local?.wallTime ?? -Infinity;
  const maxWall = Math.max(now, localWall, remote.wallTime);
  let logical = 0;
  if (maxWall === localWall && maxWall === remote.wallTime) {
    logical = Math.max(local?.logical ?? 0, remote.logical) + 1;
  } else if (maxWall === localWall) {
    logical = (local?.logical ?? 0) + 1;
  } else if (maxWall === remote.wallTime) {
    logical = remote.logical + 1;
  }
  return { wallTime: maxWall, logical, nodeId };
}
