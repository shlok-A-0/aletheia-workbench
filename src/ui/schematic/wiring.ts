/**
 * Wire geometry: where wires split (junction dots) and where wires of different nets
 * cross (hops). Works on any set of orthogonal polylines, so it also covers wires
 * the user re-routed by dragging a gate.
 */
export interface Pt { x: number; y: number }
export interface WireInput { id: string; net: string; points: Pt[] }
export interface Dot extends Pt { net: string }
export interface Wiring {
  /** One dot per point where a net splits (3+ wire ends meet, or 2+ leave a pin). */
  junctions: Dot[];
  /** Per wire id: points on that wire where it must hop over a wire of another net. */
  hops: Record<string, Pt[]>;
}

const EPS = 0.6;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;
const keyOf = (p: Pt) => `${Math.round(p.x * 2) / 2},${Math.round(p.y * 2) / 2}`;
const isH = (a: Pt, b: Pt) => near(a.y, b.y) && !near(a.x, b.x);
const isV = (a: Pt, b: Pt) => near(a.x, b.x) && !near(a.y, b.y);

interface Unit { a: Pt; b: Pt }

/** Splits every segment of one net at every vertex that lies on it, then removes duplicates. */
function netUnits(wires: WireInput[]): { units: Unit[]; starts: Pt[] } {
  const vertices: Pt[] = [];
  const raw: Unit[] = [];
  const starts: Pt[] = [];
  for (const w of wires) {
    if (w.points.length) starts.push(w.points[0]);
    w.points.forEach((p) => vertices.push(p));
    for (let i = 1; i < w.points.length; i++) raw.push({ a: w.points[i - 1], b: w.points[i] });
  }
  const seen = new Set<string>();
  const units: Unit[] = [];
  for (const s of raw) {
    const cuts: Pt[] = [s.a, s.b];
    if (isH(s.a, s.b)) {
      const [lo, hi] = [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)];
      for (const v of vertices) if (near(v.y, s.a.y) && v.x > lo + EPS && v.x < hi - EPS) cuts.push({ x: v.x, y: s.a.y });
      cuts.sort((p, q) => p.x - q.x);
    } else if (isV(s.a, s.b)) {
      const [lo, hi] = [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)];
      for (const v of vertices) if (near(v.x, s.a.x) && v.y > lo + EPS && v.y < hi - EPS) cuts.push({ x: s.a.x, y: v.y });
      cuts.sort((p, q) => p.y - q.y);
    } else continue;
    for (let i = 1; i < cuts.length; i++) {
      const ka = keyOf(cuts[i - 1]);
      const kb = keyOf(cuts[i]);
      if (ka === kb) continue;
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(k)) continue;
      seen.add(k);
      units.push({ a: cuts[i - 1], b: cuts[i] });
    }
  }
  return { units, starts };
}

export function findJunctionDots(wires: WireInput[]): Dot[] {
  const byNet = new Map<string, WireInput[]>();
  for (const w of wires) byNet.set(w.net, [...(byNet.get(w.net) ?? []), w]);
  const dots: Dot[] = [];
  for (const [net, group] of byNet) {
    if (group.length < 2) continue; // a single wire never splits
    const { units, starts } = netUnits(group);
    const degree = new Map<string, { p: Pt; n: number }>();
    for (const u of units) {
      for (const p of [u.a, u.b]) {
        const k = keyOf(p);
        const e = degree.get(k);
        if (e) e.n++;
        else degree.set(k, { p, n: 1 });
      }
    }
    const startKeys = new Set(starts.map(keyOf));
    for (const [k, { p, n }] of degree) {
      // 3+ wire ends meet, or two wires leave the source pin in different directions.
      if (n >= 3 || (n >= 2 && startKeys.has(k))) dots.push({ x: p.x, y: p.y, net });
    }
  }
  return dots;
}

/** Crossings between wires of DIFFERENT nets; horizontal wires hop over vertical ones. */
export function findHops(wires: WireInput[], hopR = 5): Record<string, Pt[]> {
  const hops: Record<string, Pt[]> = {};
  const segs: { id: string; net: string; a: Pt; b: Pt }[] = [];
  for (const w of wires) for (let i = 1; i < w.points.length; i++) segs.push({ id: w.id, net: w.net, a: w.points[i - 1], b: w.points[i] });
  const horizontals = segs.filter((s) => isH(s.a, s.b));
  const verticals = segs.filter((s) => isV(s.a, s.b));
  for (const h of horizontals) {
    const [hx1, hx2] = [Math.min(h.a.x, h.b.x), Math.max(h.a.x, h.b.x)];
    for (const v of verticals) {
      if (v.net === h.net) continue;
      const [vy1, vy2] = [Math.min(v.a.y, v.b.y), Math.max(v.a.y, v.b.y)];
      const x = v.a.x;
      const y = h.a.y;
      // Strictly inside both segments, and far enough from the ends for the arc to fit.
      if (x <= hx1 + hopR + 1 || x >= hx2 - hopR - 1) continue;
      if (y <= vy1 + EPS || y >= vy2 - EPS) continue;
      (hops[h.id] ??= []).push({ x, y });
    }
  }
  // Drop hops that would overlap their neighbour on the same wire.
  for (const id of Object.keys(hops)) {
    const sorted = hops[id].sort((p, q) => p.y - q.y || p.x - q.x);
    hops[id] = sorted.filter((p, i) => i === 0 || sorted[i - 1].y !== p.y || Math.abs(sorted[i - 1].x - p.x) > hopR * 2 + 2);
  }
  return hops;
}

export function analyzeWiring(wires: WireInput[]): Wiring {
  return { junctions: findJunctionDots(wires), hops: findHops(wires) };
}

/**
 * SVG path for one wire: rounded corners, plus a semicircular bump wherever it crosses
 * a wire of another net (the standard "hop" so crossings are not mistaken for connections).
 */
export function wirePath(points: Pt[] = [], hops: Pt[] = [], cornerR = 6, hopR = 5): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  let d = `M${points[0].x},${points[0].y}`;
  const last = points.length - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const next = points[i + 2];
    const prev = i > 0 ? points[i - 1] : null;
    const kStart = prev ? Math.min(cornerR, Math.hypot(a.x - prev.x, a.y - prev.y) / 2, len / 2) : 0;
    const kEnd = next ? Math.min(cornerR, len / 2, Math.hypot(next.x - b.x, next.y - b.y) / 2) : 0;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const s = { x: a.x + ux * kStart, y: a.y + uy * kStart };
    const e = { x: b.x - ux * kEnd, y: b.y - uy * kEnd };
    if (i > 0) {
      if (kStart >= 0.5) d += ` Q${a.x},${a.y} ${s.x},${s.y}`;
      else d += ` L${s.x},${s.y}`;
    }
    if (isH(a, b)) {
      const dir = b.x > a.x ? 1 : -1;
      const mine = hops
        .filter((h) => near(h.y, a.y) && (h.x - s.x) * dir > hopR && (e.x - h.x) * dir > hopR)
        .sort((p, q) => (p.x - q.x) * dir);
      for (const h of mine) {
        d += ` L${h.x - dir * hopR},${a.y} A${hopR},${hopR} 0 0 ${dir === 1 ? 1 : 0} ${h.x + dir * hopR},${a.y}`;
      }
    }
    d += ` L${e.x},${e.y}`;
  }
  return d;
}
