import { describe, expect, it } from 'vitest';
import { analyzeWiring, findHops, findJunctionDots, wirePath, type WireInput } from './wiring';

const w = (id: string, net: string, ...pts: [number, number][]): WireInput => ({ id, net, points: pts.map(([x, y]) => ({ x, y })) });

describe('junction dots', () => {
  it('dots a branch that leaves a long wire part-way (T-junction mid-wire)', () => {
    // Net D: one wire runs up a trunk to y=0; another taps off it at y=60.
    const wires = [
      w('a', 'D', [0, 100], [50, 100], [50, 0], [100, 0]),
      w('b', 'D', [0, 100], [50, 100], [50, 60], [100, 60]),
    ];
    const dots = findJunctionDots(wires);
    expect(dots).toContainEqual({ x: 50, y: 60, net: 'D' });
  });

  it('dots every tap along a shared trunk, not just the first', () => {
    const wires = [
      w('a', 'E', [0, 90], [40, 90], [40, 10], [90, 10]),
      w('b', 'E', [0, 90], [40, 90], [40, 40], [90, 40]),
      w('c', 'E', [0, 90], [40, 90], [40, 70], [90, 70]),
    ];
    const ys = findJunctionDots(wires).map((d) => d.y).sort((p, q) => p - q);
    expect(ys).toEqual([40, 70]);
  });

  it('dots where shared wires part, even right after the pin', () => {
    const wires = [w('a', 'A', [0, 50], [30, 50], [30, 0], [80, 0]), w('b', 'A', [0, 50], [80, 50])];
    expect(findJunctionDots(wires).map((d) => [d.x, d.y])).toEqual([[30, 50]]);
  });

  it('dots the source pin when two wires leave it in different directions', () => {
    const wires = [w('a', 'A', [0, 50], [0, 0], [80, 0]), w('b', 'A', [0, 50], [80, 50])];
    expect(findJunctionDots(wires).map((d) => [d.x, d.y])).toEqual([[0, 50]]);
  });

  it('does not dot a plain bend or a single wire', () => {
    expect(findJunctionDots([w('a', 'X', [0, 0], [20, 0], [20, 30], [60, 30])])).toEqual([]);
    expect(findJunctionDots([w('a', 'X', [0, 0], [20, 0], [20, 30]), w('b', 'Y', [0, 50], [60, 50])])).toEqual([]);
  });
});

describe('crossing hops', () => {
  it('hops the horizontal wire over a vertical wire of another net', () => {
    const wires = [w('h', 'A', [0, 50], [100, 50]), w('v', 'B', [50, 0], [50, 100])];
    expect(findHops(wires)).toEqual({ h: [{ x: 50, y: 50 }] });
  });
  it('does not hop wires of the same net, or wires that only touch at an end', () => {
    expect(findHops([w('h', 'A', [0, 50], [100, 50]), w('v', 'A', [50, 0], [50, 100])])).toEqual({});
    expect(findHops([w('h', 'A', [0, 50], [100, 50]), w('v', 'B', [50, 50], [50, 100])])).toEqual({});
  });
  it('analyzeWiring returns both', () => {
    const out = analyzeWiring([w('h', 'A', [0, 50], [100, 50]), w('v', 'B', [50, 0], [50, 100])]);
    expect(out.junctions).toEqual([]);
    expect(Object.keys(out.hops)).toEqual(['h']);
  });
});

describe('wirePath', () => {
  it('draws an arc at each hop and nothing extra without hops', () => {
    expect(wirePath([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBe('M0,0 L100,0');
    const d = wirePath([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 50, y: 0 }]);
    expect(d).toContain('A5,5 0 0 1 55,0');
  });
  it('mirrors the arc when the wire runs right-to-left', () => {
    expect(wirePath([{ x: 100, y: 0 }, { x: 0, y: 0 }], [{ x: 50, y: 0 }])).toContain('A5,5 0 0 0 45,0');
  });
});
