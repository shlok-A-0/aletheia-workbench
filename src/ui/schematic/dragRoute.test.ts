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
});
