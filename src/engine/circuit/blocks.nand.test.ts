import { describe, expect, it } from 'vitest';
import { functionWithDecoderNand } from './blocks';
import { truthTableOfNetlist } from './simulate';
import { truthTableFromMinterms } from '../boolean/truth-table';

describe('functionWithDecoderNand', () => {
  const cases: [string[], number[]][] = [
    [['A', 'B', 'C'], [1, 3, 6, 7]],
    [['A', 'B', 'C'], [0, 1, 2, 3, 4, 5, 6]],
    [['A', 'B'], [2]],
    [['A', 'B'], [0, 1, 3]],
    [['A'], [1]],
    [['A', 'B'], []],
    [['A', 'B'], [0, 1, 2, 3]],
  ];
  it.each(cases)('is equivalent to the table for %j / %j', (vars, minterms) => {
    const tt = truthTableFromMinterms(vars, minterms);
    const { netlist } = functionWithDecoderNand(tt);
    const got = truthTableOfNetlist(netlist, vars);
    expect(got.rows.map((r) => r.out)).toEqual(tt.rows.map((r) => r.out));
  });
});
