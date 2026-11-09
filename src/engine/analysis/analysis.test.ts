import { describe, expect, it } from 'vitest';
import type { Gate, Netlist } from '../types';
import {
  DEFAULT_IC_LIBRARY,
  activityFromSequence,
  compare,
  dynamicPower,
  faultList,
  mapToICs,
  minimalTestSet,
  runFaultTest,
  simulateWithFault,
  transistorCount,
  type ICLibrary,
} from './index';

function nandNetlist(count: number): Netlist {
  return {
    name: 'nand-pack',
    inputs: ['A', 'B'],
    outputs: Array.from({ length: count }, (_, index) => `Y${index}`),
    nodes: Array.from({ length: count }, (_, index): Gate => ({
      kind: 'gate',
      id: `nand${index}`,
      type: 'NAND',
      inputs: ['A', 'B'],
      output: `Y${index}`,
    })),
  };
}

const andCircuit: Netlist = {
  name: 'and',
  inputs: ['A', 'B'],
  outputs: ['Y'],
  nodes: [{ kind: 'gate', id: 'and', type: 'AND', inputs: ['A', 'B'], output: 'Y' }],
};

describe('Phase 6 IC mapping, power, comparison, and fault analysis', () => {
  it('packs NAND gates and inverters into their matching packages', () => {
    expect(mapToICs(nandNetlist(5)).ics).toEqual([
      { part: '7400', count: 2, unusedGates: 3, unitPrice: null, subtotal: null },
    ]);
    expect(mapToICs(nandNetlist(4)).ics[0]).toMatchObject({ part: '7400', count: 1, unusedGates: 0 });

    const inverterNetlist: Netlist = {
      name: 'inverters',
      inputs: ['A'],
      outputs: Array.from({ length: 9 }, (_, index) => `Y${index}`),
      nodes: Array.from({ length: 9 }, (_, index): Gate => ({
        kind: 'gate',
        id: `not${index}`,
        type: 'NOT',
        inputs: ['A'],
        output: `Y${index}`,
      })),
    };
    expect(mapToICs(inverterNetlist).ics[0]).toMatchObject({ part: '7404', count: 2, unusedGates: 3 });
  });

  it('matches fan-in and decomposes wider gates as an equivalent tree', () => {
    const library = DEFAULT_IC_LIBRARY;
    const and2 = mapToICs(andCircuit, library);
    expect(and2.ics[0].part).toBe('7408');

    const and3: Netlist = {
      ...andCircuit,
      inputs: ['A', 'B', 'C'],
      nodes: [{ kind: 'gate', id: 'and3', type: 'AND', inputs: ['A', 'B', 'C'], output: 'Y' }],
    };
    expect(mapToICs(and3).ics[0].part).toBe('7411');

    const and5: Netlist = {
      ...andCircuit,
      inputs: ['A', 'B', 'C', 'D', 'E'],
      nodes: [{ kind: 'gate', id: 'and5', type: 'AND', inputs: ['A', 'B', 'C', 'D', 'E'], output: 'Y' }],
    };
    const report = mapToICs(and5);
    expect(report.ics).toContainEqual(expect.objectContaining({ part: '7411', count: 1 }));
    expect(report.notes.join(' ')).toContain('AND5');
  });

  it('reports pins, cost, and missing library price data', () => {
    const netlist = {
      name: 'parts',
      inputs: ['A'],
      outputs: ['Y'],
      nodes: [
        ...nandNetlist(5).nodes,
        { kind: 'gate' as const, id: 'inv', type: 'NOT' as const, inputs: ['A'], output: 'Y' },
      ],
    };
    const pricedLibrary: ICLibrary = DEFAULT_IC_LIBRARY.map((ic) => ({
      ...ic,
      unitPrice: ic.part === '7400' ? 10 : ic.part === '7404' ? 12 : ic.unitPrice,
    }));
    const pricedNetlist: Netlist = {
      ...netlist,
      outputs: ['Y0', 'Y1', 'Y2', 'Y3', 'Y4', 'Y'],
    };
    const report = mapToICs(pricedNetlist, pricedLibrary);
    expect(report.totalPins).toBe(42);
    expect(report.totalCost).toBe(32);
    expect(mapToICs(pricedNetlist).totalCost).toBeUndefined();
  });

  it('uses the documented transistor estimates and dynamic power equation', () => {
    const gates: Netlist = {
      name: 'counts',
      inputs: ['A', 'B', 'C'],
      outputs: ['n', 'n2', 'n3', 'n4', 'n5', 'n6'],
      nodes: [
        { kind: 'gate', id: 'inv', type: 'NOT', inputs: ['A'], output: 'n' },
        { kind: 'gate', id: 'nand2', type: 'NAND', inputs: ['A', 'B'], output: 'n2' },
        { kind: 'gate', id: 'nand3', type: 'NAND', inputs: ['A', 'B', 'C'], output: 'n3' },
        { kind: 'gate', id: 'and2', type: 'AND', inputs: ['A', 'B'], output: 'n4' },
        { kind: 'gate', id: 'or3', type: 'OR', inputs: ['A', 'B', 'C'], output: 'n5' },
        { kind: 'ff', id: 'dff', type: 'D', edge: 'rising', clk: 'CLK', d: 'A', q: 'n6' },
      ],
    };
    expect(transistorCount(gates)).toBe(46);
    expect(dynamicPower(andCircuit, { Y: 0.5 }, {
      vdd: 5,
      freqHz: 1e6,
      defaultCapF: 10e-12,
    }).total).toBeCloseTo(125e-6);
  });

  it('calculates activity by rising transitions per applied cycle', () => {
    const inverter: Netlist = {
      name: 'clock-inverter',
      inputs: ['CLK'],
      outputs: ['Y'],
      nodes: [{ kind: 'gate', id: 'not', type: 'NOT', inputs: ['CLK'], output: 'Y' }],
    };
    const samples = [1, 0, 1, 0, 1, 0, 1, 0].map((CLK) => ({ CLK: CLK as 0 | 1 }));
    expect(activityFromSequence(inverter, samples)).toEqual({ CLK: 1, Y: 1 });
  });

  it('compares a non-minimal function against a wire-only simplification', () => {
    const original: Netlist = {
      name: 'original',
      inputs: ['A', 'B', 'C'],
      outputs: ['Y'],
      nodes: [
        { kind: 'gate', id: 'ab', type: 'AND', inputs: ['A', 'B'], output: 'ab' },
        { kind: 'gate', id: 'notab', type: 'NOT', inputs: ['ab'], output: 'notab' },
        { kind: 'gate', id: 'out', type: 'NOT', inputs: ['notab'], output: 'Y' },
      ],
    };
    const simplified: Netlist = { name: 'wire', inputs: ['A', 'B', 'C'], outputs: ['C'], nodes: [] };
    const result = compare([{ name: 'Original', netlist: original }, { name: 'Simplified', netlist: simplified }]);
    expect(result.rows[0].gates).toBeGreaterThan(result.rows[1].gates);
    expect(result.rows[1].gates).toBe(0);
    expect(result.best.gates).toBe('Simplified');
  });

  it('detects stuck-at faults and chooses a minimum AND test set', () => {
    const report = runFaultTest(andCircuit);
    expect(faultList(andCircuit)).toHaveLength(6);
    expect(report.coverage).toBe(100);
    expect(report.table.find((fault) => fault.net === 'Y' && fault.stuckAt === 0)?.detectedBy).toEqual([3]);
    expect(report.table.find((fault) => fault.net === 'Y' && fault.stuckAt === 1)?.detectedBy).toEqual([0, 1, 2]);
    expect(minimalTestSet(report)).toHaveLength(3);
    expect(report.minimalTestSet).toHaveLength(3);
    expect(simulateWithFault(andCircuit, { net: 'Y', stuckAt: 1 }, [1, 1]).Y).toBe(1);
  });

  it('marks stem faults as redundant when the Boolean output is independent of that stem', () => {
    const redundant: Netlist = {
      name: 'redundant-B',
      inputs: ['A', 'B'],
      outputs: ['Y'],
      nodes: [
        { kind: 'gate', id: 'notB', type: 'NOT', inputs: ['B'], output: 'notB' },
        { kind: 'gate', id: 'ab', type: 'AND', inputs: ['A', 'B'], output: 'ab' },
        { kind: 'gate', id: 'anotb', type: 'AND', inputs: ['A', 'notB'], output: 'anotb' },
        { kind: 'gate', id: 'or', type: 'OR', inputs: ['ab', 'anotb'], output: 'Y' },
      ],
    };
    const report = runFaultTest(redundant);
    expect(report.undetected).toContainEqual({ net: 'B', stuckAt: 0 });
    expect(report.undetected).toContainEqual({ net: 'B', stuckAt: 1 });
  });

  it('compares sequential output streams across the supplied input sequence', () => {
    const dFlipFlop: Netlist = {
      name: 'D state',
      inputs: ['D'],
      outputs: ['Q'],
      nodes: [{
        kind: 'ff',
        id: 'ff1',
        type: 'D',
        edge: 'rising',
        clk: 'CLK',
        d: 'D',
        q: 'Q',
        init: 0,
      }],
    };
    const report = runFaultTest(dFlipFlop, [{ D: 0 }, { D: 1 }, { D: 0 }]);
    expect(report.table.find((fault) => fault.net === 'Q' && fault.stuckAt === 0)?.detectedBy).toEqual([1]);
    expect(report.table.find((fault) => fault.net === 'Q' && fault.stuckAt === 1)?.detectedBy).toEqual([0, 2]);
  });
});
