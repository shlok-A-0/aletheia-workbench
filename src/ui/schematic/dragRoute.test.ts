import { describe, expect, it } from 'vitest';
import { rerouteWire } from './dragRoute';

const route = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 20 }];

describe('rerouteWire', () => {
  it('keeps the original route when neither end moved', () => {
    expect(rerouteWire(route)).toBe(route);
  });
  it('follows a dragged target gate with a Z-route', () => {
    expect(rerouteWire(route, undefined, { dx: 10, dy: 30 })).toEqual([
      { x: 0, y: 0 }, { x: 55, y: 0 }, { x: 55, y: 50 }, { x: 110, y: 50 },
    ]);
  });
  it('collapses to a straight line when pins line up', () => {
    expect(rerouteWire(route, { dx: 0, dy: 20 })).toEqual([{ x: 0, y: 20 }, { x: 100, y: 20 }]);
  });
  it('never routes a backward wire through a gate body', () => {
    // target dragged left of the source: the wire must wrap around, not cut across the gate
    const gate = { x: 40, y: -20, width: 60, height: 60 };
    const wire = rerouteWire([{ x: 100, y: 0 }, { x: 150, y: 0 }], { dx: 100, dy: 0 }, { dx: -120, dy: 30 }, [gate]);
    const inside = (p: { x: number; y: number }) => p.x > gate.x && p.x < gate.x + gate.width && p.y > gate.y && p.y < gate.y + gate.height;
    for (let i = 0; i < wire.length - 1; i++) {
      for (let t = 0; t <= 1; t += 0.05) {
        expect(inside({ x: wire[i].x + (wire[i + 1].x - wire[i].x) * t, y: wire[i].y + (wire[i + 1].y - wire[i].y) * t })).toBe(false);
      }
    }
    expect(wire[0].x).toBeLessThan(wire[1].x);
    expect(wire.at(-1)!.x).toBeGreaterThan(wire.at(-2)!.x);
  });
});
