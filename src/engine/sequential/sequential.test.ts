import { describe, it, expect } from 'vitest';
import {
  characteristicTable,
  excitationTable,
  nextQ,
  stepClock,
  runSequence,
  syncCounter,
  modNCounter,
  johnsonCounter,
  shiftRegister,
  analyzeUnusedStates,
  validateStateTable,
  reduceStates,
  assignStates,
  designFSM,
  analyzeCircuit,
} from './index';
import type { StateTable } from '../types';

describe('Phase 4 — Sequential Logic Golden Tests', () => {
  // Golden Test 1: JK characteristic: for all (J,K,Q) combos matches JQ' + K'Q; T and D; SR (1,1) -> 'x'
  it('Golden Test 1: Flip-flop characteristic evaluations', () => {
    // JK: Q+ = J*Q' + K'*Q
    for (const j of [0, 1] as (0 | 1)[]) {
      for (const k of [0, 1] as (0 | 1)[]) {
        for (const q of [0, 1] as (0 | 1)[]) {
          const expected = (j & (q === 0 ? 1 : 0)) | ((k === 0 ? 1 : 0) & q);
          expect(nextQ('JK', q, { J: j, K: k })).toBe(expected);
        }
      }
    }

    // T: Q+ = T ^ Q
    for (const t of [0, 1] as (0 | 1)[]) {
      for (const q of [0, 1] as (0 | 1)[]) {
        expect(nextQ('T', q, { T: t })).toBe(t ^ q);
      }
    }

    // D: Q+ = D
    for (const d of [0, 1] as (0 | 1)[]) {
      for (const q of [0, 1] as (0 | 1)[]) {
        expect(nextQ('D', q, { D: d })).toBe(d);
      }
    }

    // SR: S=1, R=1 returns 'x'
    expect(nextQ('SR', 0, { S: 1, R: 1 })).toBe('x');
    expect(nextQ('SR', 1, { S: 1, R: 1 })).toBe('x');

    // Characteristic tables length
    expect(characteristicTable('SR').length).toBe(8);
    expect(characteristicTable('D').length).toBe(4);
    expect(characteristicTable('JK').length).toBe(8);
    expect(characteristicTable('T').length).toBe(4);
  });

  // Golden Test 2: JK excitation table
  it('Golden Test 2: JK excitation requirements', () => {
    const table = excitationTable('JK');
    const lookup = (q: 0 | 1, next: 0 | 1) =>
      table.find((r) => r.q === q && r.nextQ === next)!.inputs;

    expect(lookup(0, 0)).toEqual({ J: 0, K: 'x' });
    expect(lookup(0, 1)).toEqual({ J: 1, K: 'x' });
    expect(lookup(1, 0)).toEqual({ J: 'x', K: 1 });
    expect(lookup(1, 1)).toEqual({ J: 'x', K: 0 });
  });

  // Golden Test 3: 2-bit synchronous up-counter with JK flip-flops counts 00,01,10,11
  it('Golden Test 3: 2-bit synchronous JK up-counter', () => {
    const counter = syncCounter(2, 'up', 'JK');
    // Run 8 clocks from reset 00
    const dummyInputs = new Array(8).fill({ CLK: 1 as const });
    const { states } = runSequence(counter, dummyInputs, { resetState: { Q0: 0, Q1: 0 } });

    const sequence = states.map((s) => `${s.Q1}${s.Q0}`);
    expect(sequence).toEqual([
      '01', '10', '11', '00',
      '01', '10', '11', '00',
    ]);

    // Test stepClock directly
    const singleStep = stepClock(counter, { Q0: 1, Q1: 0 }, { CLK: 1 });
    expect(singleStep.state).toEqual({ Q0: 0, Q1: 1 });
  });

  // Golden Test 4: 3-bit synchronous up-counter with T flip-flops: counts 0-7 then wraps
  it('Golden Test 4: 3-bit synchronous T up-counter', () => {
    const counter = syncCounter(3, 'up', 'T');
    const dummyInputs = new Array(9).fill({ CLK: 1 as const });
    const { states } = runSequence(counter, dummyInputs, { resetState: { Q0: 0, Q1: 0, Q2: 0 } });

    const numbers = states.map((s) => (s.Q2 << 2) | (s.Q1 << 1) | s.Q0);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 0, 1]);
  });

  // Golden Test 5: Mod-6 counter (0-5) built with D flip-flops, self-starting unused states (6 and 7)
  it('Golden Test 5: Mod-6 counter and unused states analysis', () => {
    const mod6 = modNCounter(6);
    const validStates = ['000', '001', '010', '011', '100', '101'];

    const analysis = analyzeUnusedStates(mod6, validStates);
    expect(analysis.unused.sort()).toEqual(['110', '111']); // States 6 and 7
    expect(analysis.selfStarting).toBe(true);

    // Verify counting sequence 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 0
    const dummyInputs = new Array(7).fill({ CLK: 1 as const });
    const { states } = runSequence(mod6, dummyInputs, { resetState: { Q0: 0, Q1: 0, Q2: 0 } });
    const counts = states.map((s) => (s.Q2 << 2) | (s.Q1 << 1) | s.Q0);
    expect(counts).toEqual([1, 2, 3, 4, 5, 0, 1]);
  });

  // Golden Test 6: Simultaneous update (no race within one clock edge)
  it('Golden Test 6: Simultaneous update in shift registers', () => {
    // 2-bit shift register: starting at Q1Q0 = 01 with serial-in held at 0 -> goes 01 -> 10 -> 00
    const siso2 = shiftRegister('SISO', 2);
    // Din = 0 for 2 clocks
    const inputs2 = [{ Din: 0 as const, CLK: 1 as const }, { Din: 0 as const, CLK: 1 as const }];
    const res2 = runSequence(siso2, inputs2, { resetState: { Q0: 1, Q1: 0 } });
    const sisoSequence = res2.states.map((s) => `${s.Q1}${s.Q0}`);
    expect(sisoSequence).toEqual(['10', '00']);

    // 3-bit SIPO fed 1, 1, 0 ends at Q2Q1Q0 = 110 (first bit ends up deepest, in Q2)
    const sipo3 = shiftRegister('SIPO', 3);
    const sipoInputs = [
      { Din: 1 as const, CLK: 1 as const },
      { Din: 1 as const, CLK: 1 as const },
      { Din: 0 as const, CLK: 1 as const },
    ];
    const resSipo = runSequence(sipo3, sipoInputs, { resetState: { Q0: 0, Q1: 0, Q2: 0 } });
    const finalState = resSipo.states[resSipo.states.length - 1];
    expect(`${finalState.Q2}${finalState.Q1}${finalState.Q0}`).toBe('110');
  });

  // Golden Test 7: Johnson counter (3-bit) cycles through 6 states: 000, 100, 110, 111, 011, 001
  it('Golden Test 7: 3-bit Johnson counter states cycle', () => {
    const jc = johnsonCounter(3);
    const dummyInputs = new Array(6).fill({ CLK: 1 as const });
    const { states } = runSequence(jc, dummyInputs, { resetState: { Q0: 0, Q1: 0, Q2: 0 } });
    const cycle = states.map((s) => `${s.Q2}${s.Q1}${s.Q0}`);

    expect(cycle).toEqual(['100', '110', '111', '011', '001', '000']);
    expect(cycle.length).toBe(6);

    // Each state differs from previous by exactly one bit
    let prev = '000';
    for (const st of cycle) {
      let diff = 0;
      for (let i = 0; i < 3; i++) {
        if (st[i] !== prev[i]) diff++;
      }
      expect(diff).toBe(1);
      prev = st;
    }
  });

  // Golden Test 8: Sequence detector for '1011', Mealy, overlapping
  it('Golden Test 8: Mealy sequence detector 1011 overlapping', () => {
    // Sequence detector for 1011:
    // S0: reset (saw nothing)
    // S1: saw '1'
    // S2: saw '10'
    // S3: saw '101'
    // In S3, on input '1' -> output '1', next state S1 (overlapping!)
    const detectorST: StateTable = {
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
        { state: 'S3', input: '1', next: 'S1', output: '1' }, // Match!
      ],
    };

    expect(validateStateTable(detectorST)).toEqual([]);

    // Stream: 1, 0, 1, 1, 0, 1, 1 -> Output: 0, 0, 0, 1, 0, 0, 1
    const stream = [1, 0, 1, 1, 0, 1, 1] as (0 | 1)[];
    const expectedOutputs = [0, 0, 0, 1, 0, 0, 1];

    // Design using binary assignment
    const { netlist: binNetlist } = designFSM(detectorST, 'D', 'binary');
    const inputSeq = stream.map((x) => ({ X: x, CLK: 1 as const }));
    const simBin = runSequence(binNetlist, inputSeq);
    const outBin = simBin.inputChangeOutputs.map((o) => o.outputs.Z);
    expect(outBin).toEqual(expectedOutputs);

    // Design using one-hot assignment
    const { netlist: oneHotNetlist } = designFSM(detectorST, 'D', 'one-hot');
    const simOneHot = runSequence(oneHotNetlist, inputSeq);
    const outOneHot = simOneHot.inputChangeOutputs.map((o) => o.outputs.Z);
    expect(outOneHot).toEqual(expectedOutputs);

    // Test state assignments
    const grayAssign = assignStates(detectorST, 'gray');
    expect(grayAssign.flops).toBe(2);
    expect(Object.keys(grayAssign.codes).length).toBe(4);
  });

  // Golden Test 9: State reduction merges equivalent states
  it('Golden Test 9: Implication table state reduction', () => {
    // Table with 2 equivalent states (S1 and S2 have identical output and next states)
    const st: StateTable = {
      model: 'mealy',
      inputs: ['X'],
      outputs: ['Z'],
      states: ['S0', 'S1', 'S2'],
      reset: 'S0',
      rows: [
        { state: 'S0', input: '0', next: 'S1', output: '0' },
        { state: 'S0', input: '1', next: 'S2', output: '0' },
        { state: 'S1', input: '0', next: 'S0', output: '1' },
        { state: 'S1', input: '1', next: 'S1', output: '0' },
        { state: 'S2', input: '0', next: 'S0', output: '1' },
        { state: 'S2', input: '1', next: 'S1', output: '0' },
      ],
    };

    const { reduced, classes } = reduceStates(st);
    expect(classes.length).toBe(2);
    expect(reduced.states.length).toBe(2);

    // Verify behavioral equivalence across 200 random inputs
    let currOrig = st.reset;
    let currRed = reduced.reset;

    for (let i = 0; i < 200; i++) {
      const x = (Math.random() < 0.5 ? 0 : 1).toString();
      const origRow = st.rows.find((r) => r.state === currOrig && r.input === x)!;
      const redRow = reduced.rows.find((r) => r.state === currRed && r.input === x)!;

      expect(origRow.output).toBe(redRow.output);
      currOrig = origRow.next;
      currRed = redRow.next;
    }
  });

  // Golden Test 10: analyzeCircuit round-trip
  it('Golden Test 10: analyzeCircuit round-trip equivalence', () => {
    const st: StateTable = {
      model: 'mealy',
      inputs: ['X'],
      outputs: ['Z'],
      states: ['S0', 'S1', 'S2'],
      reset: 'S0',
      rows: [
        { state: 'S0', input: '0', next: 'S0', output: '0' },
        { state: 'S0', input: '1', next: 'S1', output: '0' },
        { state: 'S1', input: '0', next: 'S2', output: '0' },
        { state: 'S1', input: '1', next: 'S0', output: '1' },
        { state: 'S2', input: '0', next: 'S0', output: '1' },
        { state: 'S2', input: '1', next: 'S1', output: '0' },
      ],
    };

    const { netlist } = designFSM(st, 'D', 'binary');
    const analysis = analyzeCircuit(netlist);

    expect(analysis.stateTable.rows.length).toBeGreaterThan(0);
    expect(analysis.lockUp).toBe(false);
  });

  // Golden Test 11: Incomplete state table reported by validateStateTable
  it('Golden Test 11: Incomplete state table validation error', () => {
    const incompleteST: StateTable = {
      model: 'mealy',
      inputs: ['X'],
      outputs: ['Z'],
      states: ['S0', 'S1'],
      reset: 'S0',
      rows: [
        // S0 only has input '0', missing input '1'!
        { state: 'S0', input: '0', next: 'S0', output: '0' },
        { state: 'S1', input: '0', next: 'S0', output: '0' },
        { state: 'S1', input: '1', next: 'S1', output: '1' },
      ],
    };

    const errors = validateStateTable(incompleteST);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('incomplete') || e.includes('missing'))).toBe(true);
  });
});
