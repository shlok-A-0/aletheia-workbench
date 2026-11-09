import { describe, it, expect } from 'vitest';
import {
  characteristicTable,
  excitationTable,
  nextQ,
  stepClock,
  stepClockNets,
  runSequence,
  syncCounter,
  rippleCounter,
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
import type { StateTable, Netlist } from '../types';

describe('Phase 4 — Sequential Logic Golden Tests', () => {
  it('generates deterministic sequential net names independent of intervening calls', () => {
    const first = syncCounter(3, 'down', 'JK');
    johnsonCounter(4);
    rippleCounter(3, 'up');
    expect(syncCounter(3, 'down', 'JK')).toEqual(first);
  });

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

  it('Item 1: Synchronous down counters (bits 2,3,4 T and JK) and up/down counter', () => {
    // 1. Down counters for bits 2, 3, 4 and both T and JK
    for (const bits of [2, 3, 4] as const) {
      for (const ffType of ['T', 'JK'] as const) {
        const counter = syncCounter(bits, 'down', ffType);
        const totalStates = 1 << bits;
        const numClocks = 2 * totalStates;
        const dummyInputs = new Array(numClocks).fill({ CLK: 1 as const });
        const initReset = Object.fromEntries(Array.from({ length: bits }, (_, i) => [`Q${i}`, 0 as const]));
        const { states } = runSequence(counter, dummyInputs, { resetState: initReset });

        const values = states.map((s) => {
          let v = 0;
          for (let b = 0; b < bits; b++) v |= (s[`Q${b}`] ?? 0) << b;
          return v;
        });

        const expected: number[] = [];
        let curr = 0;
        for (let c = 0; c < numClocks; c++) {
          curr = (curr - 1 + totalStates) % totalStates;
          expected.push(curr);
        }
        expect(values).toEqual(expected);
      }
    }

    // 2. Up/down counter switches direction when UP changes in middle of run
    for (const ffType of ['T', 'JK'] as const) {
      const upDownCounter = syncCounter(3, 'updown', ffType);
      const inputSeq = [
        { CLK: 1 as const, UP: 1 as const },
        { CLK: 1 as const, UP: 1 as const },
        { CLK: 1 as const, UP: 1 as const },
        { CLK: 1 as const, UP: 1 as const },
        { CLK: 1 as const, UP: 0 as const },
        { CLK: 1 as const, UP: 0 as const },
        { CLK: 1 as const, UP: 0 as const },
        { CLK: 1 as const, UP: 0 as const },
      ];
      const { states } = runSequence(upDownCounter, inputSeq, { resetState: { Q0: 0, Q1: 0, Q2: 0 } });
      const counts = states.map((s) => (s.Q2 << 2) | (s.Q1 << 1) | s.Q0);
      expect(counts).toEqual([1, 2, 3, 4, 3, 2, 1, 0]);
    }
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
  // Golden Test 9: State reduction merges equivalent states
  it('Golden Test 9: Implication table state reduction preserves output stream on 5 random tables with equivalent states', () => {
    function seededRandom(seed: number) {
      let s = seed;
      return () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
      };
    }

    const prng = seededRandom(42);

    for (let t = 0; t < 5; t++) {
      // Create a base table with 3 states S0, S1, S2 and add S3 as equivalent to S1
      const st: StateTable = {
        model: 'mealy',
        inputs: ['X'],
        outputs: ['Z'],
        states: ['S0', 'S1', 'S2', 'S3'],
        reset: 'S0',
        rows: [],
      };

      // Base transitions for S0, S1, S2
      const baseNext: Record<string, Record<string, string>> = {
        S0: {
          '0': prng() < 0.5 ? 'S1' : 'S2',
          '1': prng() < 0.5 ? 'S0' : 'S1',
        },
        S1: {
          '0': prng() < 0.5 ? 'S0' : 'S2',
          '1': prng() < 0.5 ? 'S1' : 'S0',
        },
        S2: {
          '0': prng() < 0.5 ? 'S1' : 'S0',
          '1': prng() < 0.5 ? 'S2' : 'S1',
        },
      };

      const baseOut: Record<string, Record<string, string>> = {
        S0: { '0': prng() < 0.5 ? '0' : '1', '1': prng() < 0.5 ? '0' : '1' },
        S1: { '0': prng() < 0.5 ? '0' : '1', '1': prng() < 0.5 ? '0' : '1' },
        S2: { '0': prng() < 0.5 ? '0' : '1', '1': prng() < 0.5 ? '0' : '1' },
      };

      // S3 is equivalent to S1: identical outputs and equivalent next states
      baseNext.S3 = { ...baseNext.S1 };
      baseOut.S3 = { ...baseOut.S1 };

      // Occasionally redirect transitions that go to S1 to S3
      for (const s of ['S0', 'S1', 'S2', 'S3']) {
        for (const inp of ['0', '1']) {
          let nxt = baseNext[s][inp];
          if (nxt === 'S1' && prng() < 0.5) {
            nxt = 'S3';
          }
          st.rows.push({
            state: s,
            input: inp,
            next: nxt,
            output: baseOut[s][inp],
          });
        }
      }

      const { reduced, classes } = reduceStates(st);
      expect(classes.length).toBeLessThan(st.states.length);
      expect(reduced.states.length).toBeLessThan(st.states.length);

      // Verify behavioral equivalence across 200 random inputs
      let currOrig = st.reset;
      let currRed = reduced.reset;

      for (let i = 0; i < 200; i++) {
        const x = (prng() < 0.5 ? '0' : '1');
        const origRow = st.rows.find((r) => r.state === currOrig && r.input === x)!;
        const redRow = reduced.rows.find((r) => r.state === currRed && r.input === x)!;

        expect(origRow.output).toBe(redRow.output);
        currOrig = origRow.next;
        currRed = redRow.next;
      }
    }
  });

  // Golden Test 10: Real round-trip designFSM -> analyzeCircuit equivalence
  it('Golden Test 10: Real round-trip designFSM -> analyzeCircuit across FF types and encodings', () => {
    function seededRandom(seed: number) {
      let s = seed;
      return () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
      };
    }

    const prng = seededRandom(101);

    // Table 1: Mealy sequence detector 1011
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
        { state: 'S3', input: '1', next: 'S1', output: '1' },
      ],
    };

    // Tables 2, 3, 4: Random complete state tables (3 to 4 states)
    const tables: StateTable[] = [detectorST];

    for (let t = 0; t < 3; t++) {
      const numStates = 3;
      const stateList = Array.from({ length: numStates }, (_, i) => `S${i}`);
      const rows: StateTable['rows'] = [];

      for (let sIdx = 0; sIdx < numStates; sIdx++) {
        for (const inp of ['0', '1']) {
          const nextIdx = Math.floor(prng() * numStates);
          const outBit = prng() < 0.5 ? '0' : '1';
          rows.push({
            state: stateList[sIdx],
            input: inp,
            next: stateList[nextIdx],
            output: outBit,
          });
        }
      }

      tables.push({
        model: 'mealy',
        inputs: ['X'],
        outputs: ['Z'],
        states: stateList,
        reset: 'S0',
        rows,
      });
    }

    const ffTypes: ('D' | 'T' | 'JK' | 'SR')[] = ['D', 'T', 'JK', 'SR'];
    const strategies: ('binary' | 'gray' | 'one-hot')[] = ['binary', 'gray', 'one-hot'];

    for (const origST of tables) {
      for (const ffType of ffTypes) {
        for (const strategy of strategies) {
          const { netlist } = designFSM(origST, ffType, strategy);
          const analysis = analyzeCircuit(netlist);
          const recoveredST = analysis.stateTable;
          const codes = assignStates(origST, strategy).codes;

          // Simulate 200 random input transitions from reset
          let currOrig = origST.reset;

          for (let step = 0; step < 200; step++) {
            const x = prng() < 0.5 ? '0' : '1';
            const origRow = origST.rows.find((r) => r.state === currOrig && r.input === x)!;
            const encodedState = parseInt(codes[currOrig], 2);
            const recStateName = `S${encodedState}`;
            const recRow = recoveredST.rows.find((r) => r.state === recStateName && r.input === x);

            expect(recRow).toBeDefined();
            expect(recRow!.output).toBe(origRow.output);
            expect(recRow!.next).toBe(`S${parseInt(codes[origRow.next], 2)}`);

            currOrig = origRow.next;
          }
        }
      }
    }
  });

  // Item 6 specific tests
  it('Item 6: analyzeCircuit reports real equations, unused states, and lock-up detection', () => {
    // 1. Mod-6 counter reports unused {S6, S7} and no lock-up
    const mod6 = modNCounter(6);
    const analysisMod6 = analyzeCircuit(mod6);
    expect(analysisMod6.unusedStates.sort()).toEqual(['S6', 'S7']);
    expect(analysisMod6.lockUp).toBe(false);

    // 2. Intentionally broken 3-bit counter whose unused state loops to itself reports lockUp: true
    const brokenST: StateTable = {
      model: 'moore',
      inputs: [],
      outputs: ['Z'],
      states: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'],
      reset: 'S0',
      rows: [
        { state: 'S0', input: '', next: 'S1', output: '0' },
        { state: 'S1', input: '', next: 'S2', output: '0' },
        { state: 'S2', input: '', next: 'S3', output: '0' },
        { state: 'S3', input: '', next: 'S4', output: '0' },
        { state: 'S4', input: '', next: 'S5', output: '0' },
        { state: 'S5', input: '', next: 'S0', output: '0' },
        { state: 'S6', input: '', next: 'S6', output: '0' }, // Loops to itself (trap)
        { state: 'S7', input: '', next: 'S0', output: '0' },
      ],
    };
    const { netlist: brokenNetlist } = designFSM(brokenST, 'D', 'binary');
    const analysisBroken = analyzeCircuit(brokenNetlist);
    expect(analysisBroken.unusedStates).toContain('S6');
    expect(analysisBroken.lockUp).toBe(true);

    // 3. Equations returned for a 2-bit JK counter are J0=K0=1 and J1=K1=Q0
    const jk2 = syncCounter(2, 'up', 'JK');
    const analysisJK = analyzeCircuit(jk2);
    expect(analysisJK.flipFlopInputEquations.J0).toBe('1');
    expect(analysisJK.flipFlopInputEquations.K0).toBe('1');
    expect(analysisJK.flipFlopInputEquations.J1).toBe('Q0');
    expect(analysisJK.flipFlopInputEquations.K1).toBe('Q0');
  });

  it('Item 16: rejects FSM outputs that collide with internal state nets', () => {
    const stateTable: StateTable = {
      model: 'moore',
      inputs: [],
      outputs: ['Q0'],
      states: ['S0'],
      reset: 'S0',
      rows: [{ state: 'S0', input: '', next: 'S0', output: '0' }],
    };
    expect(() => designFSM(stateTable, 'D', 'binary')).toThrow(/conflicts with an internal or input net/);
  });

  // Item 7: Clocked simulator gaps
  it('Item 7: Falling-edge flip-flops, ripple counters, level-sensitive async clear, and SR warnings', () => {
    // 1. Falling-edge flip-flop changes only on the falling edge
    const fallingDNetlist: Netlist = {
      name: 'falling_d',
      inputs: ['CLK', 'D'],
      outputs: ['Q0'],
      clock: 'CLK',
      nodes: [
        {
          kind: 'ff',
          id: 'ff_d0',
          type: 'D',
          edge: 'falling',
          clk: 'CLK',
          d: 'D',
          q: 'Q0',
          qn: 'qn0',
          init: 0,
        },
      ],
    };

    // State is 0, D is 1. CLK rises 0 -> 1: should NOT change Q0
    const prevRising = { CLK: 0 as const, D: 1 as const, Q0: 0 as const, qn0: 1 as const };
    const stepRising = stepClockNets(fallingDNetlist, { Q0: 0 }, prevRising, { CLK: 1, D: 1 });
    expect(stepRising.state.Q0).toBe(0);

    // CLK falls 1 -> 0: should toggle Q0 to 1
    const stepFalling = stepClockNets(fallingDNetlist, stepRising.state, stepRising.nets, { CLK: 0, D: 1 });
    expect(stepFalling.state.Q0).toBe(1);

    // 2. 3-bit ripple up and down counters count correctly
    const ripUp = rippleCounter(3, 'up');
    let stateUp: Record<string, 0 | 1> = { Q0: 0, Q1: 0, Q2: 0 };
    const upCounts: number[] = [];
    for (let c = 0; c < 8; c++) {
      stateUp = stepClock(ripUp, stateUp, {}).state;
      upCounts.push((stateUp.Q2 << 2) | (stateUp.Q1 << 1) | stateUp.Q0);
    }
    expect(upCounts).toEqual([1, 2, 3, 4, 5, 6, 7, 0]);

    const ripDown = rippleCounter(3, 'down');
    let stateDown: Record<string, 0 | 1> = { Q0: 0, Q1: 0, Q2: 0 };
    const downCounts: number[] = [];
    for (let c = 0; c < 8; c++) {
      stateDown = stepClock(ripDown, stateDown, {}).state;
      downCounts.push((stateDown.Q2 << 2) | (stateDown.Q1 << 1) | stateDown.Q0);
    }
    expect(downCounts).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);

    // 3. Asynchronous clear forces 0 without a clock
    const asyncClrNetlist: Netlist = {
      name: 'async_clr',
      inputs: ['CLK', 'D', 'CLR'],
      outputs: ['Q0'],
      clock: 'CLK',
      nodes: [
        {
          kind: 'ff',
          id: 'ff_d0',
          type: 'D',
          edge: 'rising',
          clk: 'CLK',
          d: 'D',
          clear: 'CLR',
          q: 'Q0',
          qn: 'qn0',
          init: 1,
        },
      ],
    };

    // CLK remains at 0 (no clock edge), but CLR goes high
    const prevNoClk = { CLK: 0 as const, D: 1 as const, CLR: 0 as const, Q0: 1 as const, qn0: 0 as const };
    const stepNoClk = stepClockNets(asyncClrNetlist, { Q0: 1 }, prevNoClk, { CLK: 0, D: 1, CLR: 1 });
    expect(stepNoClk.state.Q0).toBe(0);

    // Asynchronous clear wins over rising clock edge
    const stepEdgeWithClr = stepClockNets(asyncClrNetlist, { Q0: 1 }, prevNoClk, { CLK: 1, D: 1, CLR: 1 });
    expect(stepEdgeWithClr.state.Q0).toBe(0);

    // 4. SR with S=R=1 produces a warning and keeps state unchanged
    const srNetlist: Netlist = {
      name: 'sr_warn',
      inputs: ['CLK', 'S', 'R'],
      outputs: ['Q0'],
      clock: 'CLK',
      nodes: [
        {
          kind: 'ff',
          id: 'ff_sr0',
          type: 'SR',
          edge: 'rising',
          clk: 'CLK',
          s: 'S',
          r: 'R',
          q: 'Q0',
          qn: 'qn0',
          init: 1,
        },
      ],
    };

    const prevSR = { CLK: 0 as const, S: 1 as const, R: 1 as const, Q0: 1 as const, qn0: 0 as const };
    const stepSR = stepClockNets(srNetlist, { Q0: 1 }, prevSR, { CLK: 1, S: 1, R: 1 });
    expect(stepSR.state.Q0).toBe(1); // state unchanged!
    expect(stepSR.warnings.length).toBeGreaterThan(0);
    expect(stepSR.warnings.some((w) => w.includes('S=1, R=1'))).toBe(true);
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
