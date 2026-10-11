import { describe, it, expect } from 'vitest';
import type { TruthTable, Netlist } from './types';

describe('LDAM Core Engine Smoke Tests', () => {
  it('types and data contracts compile cleanly', () => {
    const sampleTable: TruthTable = {
      vars: ['A', 'B'],
      rows: [
        { index: 0, inputs: [0, 0], out: 0 },
        { index: 1, inputs: [0, 1], out: 1 },
        { index: 2, inputs: [1, 0], out: 1 },
        { index: 3, inputs: [1, 1], out: 0 },
      ],
    };

    expect(sampleTable.vars).toEqual(['A', 'B']);
    expect(sampleTable.rows).toHaveLength(4);
    expect(sampleTable.rows[1].out).toBe(1);
  });

  it('netlist structure contract verification', () => {
    const netlist: Netlist = {
      name: 'xor2_gate',
      inputs: ['A', 'B'],
      outputs: ['Y'],
      nodes: [
        {
          kind: 'gate',
          id: 'g1',
          type: 'XOR',
          inputs: ['A', 'B'],
          output: 'Y',
        },
      ],
    };

    expect(netlist.nodes).toHaveLength(1);
    expect(netlist.nodes[0].kind).toBe('gate');
  });
});
