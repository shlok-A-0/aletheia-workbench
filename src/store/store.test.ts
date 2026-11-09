import { describe, expect, it } from 'vitest';
import { parseExpr, truthTableFromExpr } from '../engine/boolean';
import { exprToNetlist } from '../engine/circuit/generate';
import { quineMcCluskey } from '../engine/minimize/qm';
import { useStore } from './index';

describe('input-dependent store state', () => {
  it('clears results from the previous input when a new source is set', () => {
    const truthTable = truthTableFromExpr(parseExpr('A'), ['A']);
    useStore.getState().setTruthTable(truthTable);
    useStore.getState().setMinResult(quineMcCluskey(truthTable));
    useStore.getState().setNetlist('simplified', exprToNetlist(parseExpr('A')));
    useStore.getState().setInput('B', 'expr');

    const state = useStore.getState();
    expect(state.truthTable).toBeNull();
    expect(state.parsedExpr).toBeNull();
    expect(state.minResult).toBeNull();
    expect(state.netlists.simplified).toBeNull();
  });

  it('keeps the active input source as a typed object', () => {
    useStore.getState().setInput('1, 3', 'minterms');
    useStore.getState().setVars(['A', 'B']);
    useStore.getState().setDontCaresStr('0');

    expect(useStore.getState().input).toEqual({
      mode: 'minterms',
      raw: '1, 3',
      vars: ['A', 'B'],
      dontCares: '0',
    });
  });
});
