export interface Point { x: number; y: number }
export interface Offset { dx: number; dy: number }
export type Offsets = Record<string, Offset>;
export interface Rect { x: number; y: number; width: number; height: number }

const STUB = 14;
const STEP = 12;

/** True when an axis-aligned segment passes through the rectangle grown by `margin` (negative = shrunk). */
function hits(a: Point, b: Point, r: Rect, margin: number): boolean {
  const left = r.x - margin;
  const right = r.x + r.width + margin;
  const top = r.y - margin;
  const bottom = r.y + r.height + margin;
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x1 > left && x0 < right && y1 > top && y0 < bottom;
}

function clear(route: Point[], obstacles: Rect[]): boolean {
  for (let i = 0; i < route.length - 1; i++) {
    // Pin stubs touch their own gate, so they get a hair of slack; the wire's body keeps a clear gap.
    const margin = i === 0 || i === route.length - 2 ? -1 : 6;
    if (obstacles.some((r) => hits(route[i], route[i + 1], r, margin))) return false;
  }
  return true;
}

/**
 * Re-routes one wire after the gates at its ends were dragged.
 * An untouched wire keeps the route ELK computed. A moved one leaves its output pin to the right,
 * enters its input pin from the left, and is steered around every gate body instead of through it.
 */
export function rerouteWire(points: Point[], from?: Offset, to?: Offset, obstacles: Rect[] = []): Point[] {
  if ((!from && !to) || points.length < 2) return points;
  const a = points[0];
  const b = points[points.length - 1];
  const s = { x: a.x + (from?.dx ?? 0), y: a.y + (from?.dy ?? 0) };
  const e = { x: b.x + (to?.dx ?? 0), y: b.y + (to?.dy ?? 0) };
  if (s.y === e.y && e.x > s.x && clear([s, e], obstacles)) return [s, e];

  const out = s.x + STUB;
  const into = e.x - STUB;
  const candidates: Point[][] = [];

  if (out <= into) {
    const mid = (out + into) / 2;
    const shifts = [0];
    for (let k = 1; mid - k * STEP >= out || mid + k * STEP <= into; k++) shifts.push(-k * STEP, k * STEP);
    for (const d of shifts) {
      const x = mid + d;
      if (x < out || x > into) continue;
      candidates.push(s.y === e.y ? [s, e] : [s, { x, y: s.y }, { x, y: e.y }, e]);
    }
  }

  const midY = (s.y + e.y) / 2;
  for (let k = 0; k <= 60; k++) {
    for (const d of k === 0 ? [0] : [-k * STEP, k * STEP]) {
      const y = midY + d;
      candidates.push([s, { x: out, y: s.y }, { x: out, y }, { x: into, y }, { x: into, y: e.y }, e]);
    }
  }

  const found = candidates.find((route) => clear(route, obstacles));
  if (found) return found;
  if (s.y === e.y) return [s, e];
  const midX = (s.x + e.x) / 2;
  return [s, { x: midX, y: s.y }, { x: midX, y: e.y }, e];
}
