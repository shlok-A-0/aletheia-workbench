import {
  analyzeCircuit,
  designFSM,
  evaluate,
  fullAdder,
  kmapSimplify,
  minResultToNetlist,
  mintermsOf,
  modNCounter,
  parseExpr,
  quineMcCluskey,
  syncCounter,
  toNandOnly,
  toNorOnly,
  truthTableFromExpr,
  truthTableFromMinterms,
  verify,
} from '../engine';
import type { StateTable } from '../engine/types';

export interface SelfTestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const DETECTOR: StateTable = {
  model: 'mealy',
  inputs: ['X'],
  outputs: ['Z'],
  states: ['S0', 'S1', 'S2', 'S3'],
  reset: 'S0',
  rows: [
    { state: 'S0', input: '0', next: 'S0', output: '0' },
    { state: 'S0', input: '1', next: 'S1', output: '0' },
    { state: 'S1', input: '0', next: 'S2', output: '0' },
    { state: 'S1', input: '1', next: 'S1', output: '0' },
    { state: 'S2', input: '0', next: 'S0', output: '0' },
    { state: 'S2', input: '1', next: 'S3', output: '0' },
    { state: 'S3', input: '0', next: 'S2', output: '0' },
    { state: 'S3', input: '1', next: 'S1', output: '1' },
  ],
};

function runCase(name: string, check: () => void): SelfTestResult {
  try {
    check();
    return { name, passed: true, detail: 'Passed' };
  } catch (error) {
    return {
      name,
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function runSystemSelfTests(): SelfTestResult[] {
  return [
    runCase('Σm(1,3,5,7) truth-table generation', () => {
      const table = truthTableFromMinterms(['A', 'B', 'C'], [1, 3, 5, 7]);
      if (mintermsOf(table).join(',') !== '1,3,5,7') throw new Error('Generated minterms do not match the golden example.');
    }),
    runCase('Four-variable QM and K-map verification', () => {
      const table = truthTableFromMinterms(['A', 'B', 'C', 'D'], [1, 3, 7, 11, 15], [0, 2, 5]);
      const qm = minResultToNetlist(quineMcCluskey(table));
      const kmap = minResultToNetlist(kmapSimplify(table));
      if (!verify(qm, table).ok || !verify(kmap, table).ok) {
        throw new Error('At least one minimizer disagrees with the truth table.');
      }
    }),
    runCase('NAND-only and NOR-only equivalence', () => {
      const table = truthTableFromExpr(parseExpr("A'B + C"), ['A', 'B', 'C']);
      const base = minResultToNetlist(quineMcCluskey(table));
      if (!verify(toNandOnly(base), table).ok) throw new Error('NAND conversion changed the function.');
      if (!verify(toNorOnly(base), table).ok) throw new Error('NOR conversion changed the function.');
    }),
    runCase('Full-adder outputs across all input combinations', () => {
      const circuit = fullAdder();
      for (let index = 0; index < 8; index++) {
        const a = ((index >> 2) & 1) as 0 | 1;
        const b = ((index >> 1) & 1) as 0 | 1;
        const cin = (index & 1) as 0 | 1;
        const sum = a + b + cin;
        const values = evaluate(circuit, { A: a, B: b, Cin: cin });
        if (values.S !== (sum % 2) || values.Cout !== (sum > 1 ? 1 : 0)) {
          throw new Error(`Incorrect full-adder result for input index ${index}.`);
        }
      }
    }),
    runCase('Sequential counter and FSM analysis', () => {
      const counter = syncCounter(2, 'up', 'JK');
      const modulo = modNCounter(6);
      const detector = designFSM(DETECTOR, 'D', 'binary').netlist;
      if (analyzeCircuit(counter).stateTable.rows.length === 0) throw new Error('Counter analysis produced no transitions.');
      if (analyzeCircuit(modulo).stateTable.rows.length === 0) throw new Error('Mod-6 analysis produced no transitions.');
      if (!detector.nodes.some((node) => node.kind === 'ff')) throw new Error('FSM synthesis produced no flip-flops.');
    }),
    runCase('Deterministic minimization', () => {
      const table = truthTableFromExpr(parseExpr("A'B + C"), ['A', 'B', 'C']);
      const first = quineMcCluskey(table);
      const second = quineMcCluskey(table);
      if (first.text !== second.text || first.literalCount !== second.literalCount) {
        throw new Error('Repeated minimization produced different results.');
      }
    }),
  ];
}
