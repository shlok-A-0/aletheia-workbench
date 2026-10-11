import { describe, it, expect } from 'vitest';
import {
  exprToNetlist,
  minResultToNetlist,
  toNandOnly,
  toNorOnly,
  CombinationalLoopError,
  evaluate,
  truthTableOfNetlist,
  verify,
  mux,
  demux,
  decoder,
  encoder,
  priorityEncoder,
  halfAdder,
  fullAdder,
  rippleAdder,
  comparator,
  bcdTo7Seg,
  functionWithMux,
} from './index';
import { parseExpr, truthTableFromExpr, truthTableFromMinterms } from '../boolean';
import { quineMcCluskey } from '../minimize';
import type { Netlist, Gate } from '../types';

function generateRandomExpr(vars: string[], depth = 3): string {
  if (depth <= 1 || Math.random() < 0.3) {
    const v = vars[Math.floor(Math.random() * vars.length)];
    return Math.random() < 0.4 ? `${v}'` : v;
  }
  const op = ['*', '+', '^'][Math.floor(Math.random() * 3)];
  const left = generateRandomExpr(vars, depth - 1);
  const right = generateRandomExpr(vars, depth - 1);
  return `(${left} ${op} ${right})`;
}

describe('Phase 3 — Circuit Engine Golden Tests', () => {
  // Golden Test 1: exprToNetlist(parse("A'B + C")) verifies against its truth table; 30 random expressions (n=3,4)
  it("Golden Test 1: exprToNetlist for A'B + C and 30 random expressions", () => {
    const expr1 = parseExpr("A'B + C");
    const tt1 = truthTableFromExpr(expr1, ['A', 'B', 'C']);
    const netlist1 = exprToNetlist(expr1);
    const verify1 = verify(netlist1, tt1);
    expect(verify1.ok).toBe(true);
    expect(verify1.mismatches.length).toBe(0);

    // 30 random expressions with n=3 and n=4
    const varPools = [
      ['A', 'B', 'C'],
      ['A', 'B', 'C', 'D'],
    ];

    for (let i = 0; i < 30; i++) {
      const vars = varPools[i % 2];
      const randStr = generateRandomExpr(vars, 3);
      const randExpr = parseExpr(randStr);
      const goldenTT = truthTableFromExpr(randExpr, vars);
      const nl = exprToNetlist(randExpr);
      const res = verify(nl, goldenTT);
      expect(res.ok).toBe(true);
    }
  });

  // Golden Test 2: toNandOnly and toNorOnly verify and contain strictly NAND / NOR gates
  it('Golden Test 2: toNandOnly and toNorOnly conversion and verification', () => {
    const varPools = [
      ['A', 'B', 'C'],
      ['A', 'B', 'C', 'D'],
    ];

    for (let i = 0; i < 30; i++) {
      const vars = varPools[i % 2];
      const randStr = generateRandomExpr(vars, 3);
      const randExpr = parseExpr(randStr);
      const goldenTT = truthTableFromExpr(randExpr, vars);
      const baseNetlist = exprToNetlist(randExpr);

      // NAND-only
      const nandNetlist = toNandOnly(baseNetlist);
      const nandGates = nandNetlist.nodes.filter((n) => n.kind === 'gate') as Gate[];
      expect(nandGates.every((g) => g.type === 'NAND')).toBe(true);
      const nandVerify = verify(nandNetlist, goldenTT);
      expect(nandVerify.ok).toBe(true);

      // NOR-only
      const norNetlist = toNorOnly(baseNetlist);
      const norGates = norNetlist.nodes.filter((n) => n.kind === 'gate') as Gate[];
      expect(norGates.every((g) => g.type === 'NOR')).toBe(true);
      const norVerify = verify(norNetlist, goldenTT);
      expect(norVerify.ok).toBe(true);
    }
  });

  // Golden Test 3: mux(2) 64 combos, demux(2) addressing, decoder(3) one-hot & disabled
  it('Golden Test 3: mux(2), demux(2), decoder(3) correctness', () => {
    // mux(2): 2 select lines (S1, S0), 4 data lines (D0, D1, D2, D3) -> 64 combos
    const m2 = mux(2);
    expect(m2.inputs).toEqual(['S1', 'S0', 'D0', 'D1', 'D2', 'D3']);
    for (let code = 0; code < 64; code++) {
      const s1 = ((code >> 5) & 1) as 0 | 1;
      const s0 = ((code >> 4) & 1) as 0 | 1;
      const d3 = ((code >> 3) & 1) as 0 | 1;
      const d2 = ((code >> 2) & 1) as 0 | 1;
      const d1 = ((code >> 1) & 1) as 0 | 1;
      const d0 = ((code >> 0) & 1) as 0 | 1;

      const selIdx = (s1 << 1) | s0;
      const dataVals = [d0, d1, d2, d3];
      const expectedY = dataVals[selIdx];

      const out = evaluate(m2, { S1: s1, S0: s0, D0: d0, D1: d1, D2: d2, D3: d3 });
      expect(out.Y).toBe(expectedY);
    }

    // demux(2): data D, select lines S1, S0 -> outputs Y0, Y1, Y2, Y3
    const dm2 = demux(2);
    expect(dm2.inputs).toEqual(['D', 'S1', 'S0']);
    for (let s = 0; s < 4; s++) {
      const s1 = ((s >> 1) & 1) as 0 | 1;
      const s0 = (s & 1) as 0 | 1;
      for (const din of [0, 1] as (0 | 1)[]) {
        const out = evaluate(dm2, { D: din, S1: s1, S0: s0 });
        for (let y = 0; y < 4; y++) {
          const expected = y === s ? din : 0;
          expect(out[`Y${y}`]).toBe(expected);
        }
      }
    }

    // decoder(3): Enable E, A2, A1, A0 -> outputs Y0..Y7
    const dec3 = decoder(3);
    expect(dec3.inputs).toEqual(['E', 'A2', 'A1', 'A0']);

    // When disabled (E = 0), all outputs must be 0
    for (let code = 0; code < 8; code++) {
      const a2 = ((code >> 2) & 1) as 0 | 1;
      const a1 = ((code >> 1) & 1) as 0 | 1;
      const a0 = (code & 1) as 0 | 1;
      const out = evaluate(dec3, { E: 0, A2: a2, A1: a1, A0: a0 });
      for (let y = 0; y < 8; y++) {
        expect(out[`Y${y}`]).toBe(0);
      }
    }

    // When enabled (E = 1), exactly one-hot corresponding to address
    for (let code = 0; code < 8; code++) {
      const a2 = ((code >> 2) & 1) as 0 | 1;
      const a1 = ((code >> 1) & 1) as 0 | 1;
      const a0 = (code & 1) as 0 | 1;
      const out = evaluate(dec3, { E: 1, A2: a2, A1: a1, A0: a0 });
      for (let y = 0; y < 8; y++) {
        expect(out[`Y${y}`]).toBe(y === code ? 1 : 0);
      }
    }
  });

  // Golden Test 4: priorityEncoder(4): inputs D3..D0 = 0110 -> output 10, valid=1; all 0s -> valid=0
  it('Golden Test 4: priorityEncoder(4) truth table and validity', () => {
    const pe = priorityEncoder(4);
    // Inputs: D3, D2, D1, D0
    // Test case: 0110 (D3=0, D2=1, D1=1, D0=0) -> output 10 (Y1=1, Y0=0), V=1
    const res1 = evaluate(pe, { D3: 0, D2: 1, D1: 1, D0: 0 });
    expect(res1.Y1).toBe(1);
    expect(res1.Y0).toBe(0);
    expect(res1.V).toBe(1);

    // All zeros: V=0
    const resZero = evaluate(pe, { D3: 0, D2: 0, D1: 0, D0: 0 });
    expect(resZero.V).toBe(0);

    // D3=1 -> Y1=1, Y0=1, V=1 regardless of other inputs
    const resD3 = evaluate(pe, { D3: 1, D2: 0, D1: 1, D0: 1 });
    expect(resD3.Y1).toBe(1);
    expect(resD3.Y0).toBe(1);
    expect(resD3.V).toBe(1);
  });

  // Golden Test 5: fullAdder all 8 inputs; rippleAdder(4) adds all 256 input pairs with carry out
  it('Golden Test 5: fullAdder and 4-bit rippleAdder', () => {
    const fa = fullAdder();
    for (let code = 0; code < 8; code++) {
      const a = ((code >> 2) & 1) as 0 | 1;
      const b = ((code >> 1) & 1) as 0 | 1;
      const cin = (code & 1) as 0 | 1;

      const sum = a ^ b ^ cin;
      const cout = (a & b) | (cin & (a ^ b));

      const out = evaluate(fa, { A: a, B: b, Cin: cin });
      expect(out.S).toBe(sum);
      expect(out.Cout).toBe(cout);
    }

    const ra4 = rippleAdder(4);
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        const inVals: Record<string, 0 | 1> = {
          A3: ((a >> 3) & 1) as 0 | 1,
          A2: ((a >> 2) & 1) as 0 | 1,
          A1: ((a >> 1) & 1) as 0 | 1,
          A0: (a & 1) as 0 | 1,
          B3: ((b >> 3) & 1) as 0 | 1,
          B2: ((b >> 2) & 1) as 0 | 1,
          B1: ((b >> 1) & 1) as 0 | 1,
          B0: (b & 1) as 0 | 1,
        };

        const out = evaluate(ra4, inVals);
        const sVal = (out.S3 << 3) | (out.S2 << 2) | (out.S1 << 1) | out.S0;
        const cout = out.Cout;

        const expectedTotal = a + b;
        const expectedS = expectedTotal & 0xf;
        const expectedCout = (expectedTotal >> 4) & 1;

        expect(sVal).toBe(expectedS);
        expect(cout).toBe(expectedCout);
      }
    }
  });

  // Golden Test 6: comparator(4): for all 256 pairs, exactly one of GT, EQ, LT is 1 and correct
  it('Golden Test 6: 4-bit magnitude comparator', () => {
    const comp = comparator(4);
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        const inVals: Record<string, 0 | 1> = {
          A3: ((a >> 3) & 1) as 0 | 1,
          A2: ((a >> 2) & 1) as 0 | 1,
          A1: ((a >> 1) & 1) as 0 | 1,
          A0: (a & 1) as 0 | 1,
          B3: ((b >> 3) & 1) as 0 | 1,
          B2: ((b >> 2) & 1) as 0 | 1,
          B1: ((b >> 1) & 1) as 0 | 1,
          B0: (b & 1) as 0 | 1,
        };

        const out = evaluate(comp, inVals);
        const { GT, EQ, LT } = out;

        // Exactly one is high
        expect(GT + EQ + LT).toBe(1);

        if (a > b) {
          expect(GT).toBe(1);
          expect(EQ).toBe(0);
          expect(LT).toBe(0);
        } else if (a === b) {
          expect(GT).toBe(0);
          expect(EQ).toBe(1);
          expect(LT).toBe(0);
        } else {
          expect(GT).toBe(0);
          expect(EQ).toBe(0);
          expect(LT).toBe(1);
        }
      }
    }
  });

  // Golden Test 7: bcdTo7Seg(): digit 8 lights all; digit 1 lights b,c; digit 0 lights a-f not g
  it('Golden Test 7: bcdTo7Seg segment outputs', () => {
    const bcd = bcdTo7Seg();

    // Digit 8: B3=1, B2=0, B1=0, B0=0 -> a,b,c,d,e,f,g all 1
    const out8 = evaluate(bcd, { B3: 1, B2: 0, B1: 0, B0: 0 });
    expect([out8.a, out8.b, out8.c, out8.d, out8.e, out8.f, out8.g]).toEqual([1, 1, 1, 1, 1, 1, 1]);

    // Digit 1: B3=0, B2=0, B1=0, B0=1 -> only b and c are 1
    const out1 = evaluate(bcd, { B3: 0, B2: 0, B1: 0, B0: 1 });
    expect(out1.b).toBe(1);
    expect(out1.c).toBe(1);
    expect(out1.a).toBe(0);
    expect(out1.d).toBe(0);
    expect(out1.e).toBe(0);
    expect(out1.f).toBe(0);
    expect(out1.g).toBe(0);

    // Digit 0: B3=0, B2=0, B1=0, B0=0 -> a-f are 1, g is 0
    const out0 = evaluate(bcd, { B3: 0, B2: 0, B1: 0, B0: 0 });
    expect([out0.a, out0.b, out0.c, out0.d, out0.e, out0.f]).toEqual([1, 1, 1, 1, 1, 1]);
    expect(out0.g).toBe(0);
  });

  // Golden Test 8: functionWithMux on Σm(1,2,4,7) (A,B,C) with A,B as selects yields verifying netlist
  it('Golden Test 8: functionWithMux realization of Σm(1,2,4,7)', () => {
    const tt = truthTableFromMinterms(['A', 'B', 'C'], [1, 2, 4, 7]);
    const { netlist, steps } = functionWithMux(tt, ['A', 'B']);
    expect(steps.length).toBeGreaterThan(0);

    const vResult = verify(netlist, tt);
    expect(vResult.ok).toBe(true);
    expect(vResult.mismatches).toEqual([]);
  });

  // Golden Test 9: Netlist with a combinational loop throws CombinationalLoopError
  it('Golden Test 9: Combinational loop detection', () => {
    // Build loop: g1: AND(A, n2) -> n1; g2: OR(n1, B) -> n2
    const loopNetlist: Netlist = {
      name: 'loop_circuit',
      inputs: ['A', 'B'],
      outputs: ['n1'],
      nodes: [
        { kind: 'gate', id: 'g1', type: 'AND', inputs: ['A', 'n2'], output: 'n1' },
        { kind: 'gate', id: 'g2', type: 'OR', inputs: ['n1', 'B'], output: 'n2' },
      ],
    };

    expect(() => {
      evaluate(loopNetlist, { A: 1, B: 1 });
    }).toThrow(CombinationalLoopError);
  });

  it('halfAdder and 4-to-2 encoder correctness', () => {
    const ha = halfAdder();
    expect(evaluate(ha, { A: 0, B: 0 })).toMatchObject({ S: 0, C: 0 });
    expect(evaluate(ha, { A: 0, B: 1 })).toMatchObject({ S: 1, C: 0 });
    expect(evaluate(ha, { A: 1, B: 0 })).toMatchObject({ S: 1, C: 0 });
    expect(evaluate(ha, { A: 1, B: 1 })).toMatchObject({ S: 0, C: 1 });

    const enc = encoder(2);
    // D0=1 -> Y1=0, Y0=0
    expect(evaluate(enc, { D0: 1, D1: 0, D2: 0, D3: 0 })).toMatchObject({ Y1: 0, Y0: 0 });
    // D1=1 -> Y1=0, Y0=1
    expect(evaluate(enc, { D0: 0, D1: 1, D2: 0, D3: 0 })).toMatchObject({ Y1: 0, Y0: 1 });
    // D2=1 -> Y1=1, Y0=0
    expect(evaluate(enc, { D0: 0, D1: 0, D2: 1, D3: 0 })).toMatchObject({ Y1: 1, Y0: 0 });
    // D3=1 -> Y1=1, Y0=1
    expect(evaluate(enc, { D0: 0, D1: 0, D2: 0, D3: 1 })).toMatchObject({ Y1: 1, Y0: 1 });
  });

  it('minResultToNetlist and truthTableOfNetlist consistency', () => {
    const inputTT = truthTableFromMinterms(['A', 'B'], [1, 2]);
    const minResult = quineMcCluskey(inputTT, 'SOP');
    const nl = minResultToNetlist(minResult);
    const tt = truthTableOfNetlist(nl, ['A', 'B']);
    expect(tt.rows.map((r) => r.out)).toEqual([0, 1, 1, 0]);
  });
});


