import { describe, expect, it } from 'vitest';
import { functionsWithDemux } from './blocks';
import { truthTableOfNetlist } from './simulate';
import { truthTableFromMinterms } from '../boolean/truth-table';

describe('functionsWithDemux', () => {
  it('realizes several outputs with a single shared demux', () => {
    const vars = ['A', 'B', 'C'];
    const sets = [[1, 3, 6, 7], [0, 5], [2], [], [0, 1, 2, 3, 4, 5, 6, 7]];
    const tts = sets.map((m) => truthTableFromMinterms(vars, m));
    const { netlist } = functionsWithDemux(tts, ['F', 'G', 'H', 'Z', 'O']);
    expect(netlist.outputs).toEqual(['F', 'G', 'H', 'Z', 'O']);
    // 8 demux lines are built once, not once per output.
    const lineGates = netlist.nodes.filter((n) => n.kind === 'gate' && n.type === 'AND');
    expect(lineGates).toHaveLength(8);
    tts.forEach((tt, i) => {
      const got = truthTableOfNetlist(netlist, vars, i);
      expect(got.rows.map((r) => r.out)).toEqual(tt.rows.map((r) => r.out));
    });
  });

  it('handles a single output named Y', () => {
    const tt = truthTableFromMinterms(['A', 'B'], [1, 2]);
    const { netlist } = functionsWithDemux([tt]);
    expect(netlist.outputs).toEqual(['Y']);
    expect(truthTableOfNetlist(netlist, ['A', 'B']).rows.map((r) => r.out)).toEqual([0, 1, 1, 0]);
  });
});
