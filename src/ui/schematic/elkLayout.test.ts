import { describe, expect, it } from 'vitest';
import { parseExpr } from '../../engine/boolean';
import { exprToNetlist, minResultToNetlist, toNandOnly } from '../../engine/circuit/generate';
import { fullAdder } from '../../engine/circuit/blocks';
import { quineMcCluskey } from '../../engine/minimize';
import { truthTableFromMinterms } from '../../engine/boolean';
import type { Netlist } from '../../engine/types';
import { layoutSchematic, roundedPath, type SchematicLayout } from './elkLayout';

type Seg = { x1: number; y1: number; x2: number; y2: number };

function segments(points: { x: number; y: number }[]): Seg[] {
  return points.slice(1).map((p, i) => ({ x1: points[i].x, y1: points[i].y, x2: p.x, y2: p.y }));
}

/** Does an axis-aligned segment pass through the strict interior of a node box? */
function crossesBody(seg: Seg, n: SchematicLayout['nodes'][number]): boolean {
  const inset = 3;
  const left = n.x + inset, right = n.x + n.width - inset;
  const top = n.y + inset, bottom = n.y + n.height - inset;
  const minX = Math.min(seg.x1, seg.x2), maxX = Math.max(seg.x1, seg.x2);
  const minY = Math.min(seg.y1, seg.y2), maxY = Math.max(seg.y1, seg.y2);
  return maxX > left && minX < right && maxY > top && minY < bottom;
}

function bodyHits(layout: SchematicLayout): string[] {
  const hits: string[] = [];
  for (const e of layout.edges) {
    for (const seg of segments(e.points)) {
      for (const n of layout.nodes) {
        if (n.id === e.from || n.id === e.to) continue;
        if (crossesBody(seg, n)) hits.push(`${e.net}: ${e.from}→${e.to} through ${n.id}`);
      }
    }
  }
  return hits;
}

function orthogonal(layout: SchematicLayout): boolean {
  return layout.edges.every((e) =>
    segments(e.points).every((s) => Math.abs(s.x1 - s.x2) < 0.5 || Math.abs(s.y1 - s.y2) < 0.5));
}

function crossings(layout: SchematicLayout): number {
  const segs = layout.edges.map((e) => ({ e, s: segments(e.points) }));
  let count = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].e.net === segs[j].e.net) continue; // same net: a branch, not a crossing
      for (const a of segs[i].s) for (const b of segs[j].s) {
        const aH = Math.abs(a.y1 - a.y2) < 0.5, bH = Math.abs(b.y1 - b.y2) < 0.5;
        if (aH === bH) continue;
        const [h, v] = aH ? [a, b] : [b, a];
        const vx = v.x1, hy = h.y1;
        if (vx > Math.min(h.x1, h.x2) + 0.5 && vx < Math.max(h.x1, h.x2) - 0.5 &&
            hy > Math.min(v.y1, v.y2) + 0.5 && hy < Math.max(v.y1, v.y2) - 0.5) count++;
      }
    }
  }
  return count;
}

const cases: [string, () => Netlist][] = [
  ["A'B + C (the reported bad diagram)", () => exprToNetlist(parseExpr("A'B + C"))],
  ['majority AB+BC+AC', () => exprToNetlist(parseExpr('AB + BC + AC'))],
  ['full adder', () => fullAdder()],
  ['4-var QM result as NAND-only', () => toNandOnly(minResultToNetlist(
    quineMcCluskey(truthTableFromMinterms(['A', 'B', 'C', 'D'], [1, 3, 7, 11, 15], [0, 2, 5]))))],
];

describe('ELK schematic layout', () => {
  for (const [name, make] of cases) {
    it(`${name}: orthogonal, no wire through a foreign gate`, async () => {
      const layout = await layoutSchematic(make());
      expect(layout.nodes.length).toBeGreaterThan(2);
      expect(orthogonal(layout)).toBe(true);
      expect(bodyHits(layout)).toEqual([]);
    });
  }

  it("A'B + C has zero wire crossings", async () => {
    const layout = await layoutSchematic(exprToNetlist(parseExpr("A'B + C")));
    expect(crossings(layout)).toBe(0);
  });

  it('gives every gate one pin per input, on its left edge', async () => {
    const netlist = exprToNetlist(parseExpr('AB + C'));
    const layout = await layoutSchematic(netlist);
    for (const n of layout.nodes.filter((x) => x.kind === 'gate')) {
      const gate = netlist.nodes.find((g) => g.id === n.id);
      expect(gate && gate.kind === 'gate' ? n.inPins.length : -1).toBe(gate && gate.kind === 'gate' ? gate.inputs.length : -2);
      for (const p of n.inPins) expect(p.x).toBeLessThanOrEqual(2);
    }
  });

  it('labels an engine-generated output net F, not or_3', async () => {
    const layout = await layoutSchematic(exprToNetlist(parseExpr("A'B + C")));
    const out = layout.nodes.find((n) => n.kind === 'output');
    expect(out?.label).toBe('F');
  });

  it('marks a junction where one net fans out', async () => {
    const layout = await layoutSchematic(exprToNetlist(parseExpr('AB + A\'C')));
    expect(layout.junctions.length).toBeGreaterThan(0);
  });

  it('rounds corners without leaving the polyline endpoints', () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }], 6);
    expect(d.startsWith('M0,0')).toBe(true);
    expect(d.endsWith('L40,40')).toBe(true);
    expect(d).toContain('Q40,0');
  });

  it('lays out a synchronous counter with flip-flops orthogonally', async () => {
    const { syncCounter } = await import('../../engine/sequential/library');
    const nl = syncCounter(2, 'up', 'JK');
    const layout = await layoutSchematic(nl);
    expect(layout.nodes.some((n) => n.kind === 'ff')).toBe(true);
    expect(layout.edges.length).toBeGreaterThan(0);
    expect(orthogonal(layout)).toBe(true);
  });
});
