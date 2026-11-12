export interface Point { x: number; y: number }
export interface Offset { dx: number; dy: number }
export type Offsets = Record<string, Offset>;

/**
 * Re-routes one wire after the gates at its ends were dragged.
 * An untouched wire keeps the route ELK computed; a moved one becomes a simple
 * orthogonal Z-route from its (shifted) output pin to its (shifted) input pin.
 */
export function rerouteWire(points: Point[], from?: Offset, to?: Offset): Point[] {
  if ((!from && !to) || points.length < 2) return points;
  const a = points[0];
  const b = points[points.length - 1];
  const s = { x: a.x + (from?.dx ?? 0), y: a.y + (from?.dy ?? 0) };
  const e = { x: b.x + (to?.dx ?? 0), y: b.y + (to?.dy ?? 0) };
  if (s.y === e.y) return [s, e];
  const midX = (s.x + e.x) / 2;
  return [s, { x: midX, y: s.y }, { x: midX, y: e.y }, e];
}
