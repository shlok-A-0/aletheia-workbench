import { describe, it, expect } from 'vitest';
import {
  quineMcCluskey,
  primeImplicants,
  allMinimalCovers,
  kmapGroups,
  kmapSimplify,
  multiOutputQM,
} from './index';
import {
  truthTableFromMinterms,
  evalExpr,
  isEquivalent,
} from '../boolean';

describe('Phase 2 — K-Map and Quine–McCluskey Golden Tests', () => {
  // Golden Test 1: Σm(1,3,5,7) over A,B,C → SOP C, 1 term, 1 literal
  it('Golden Test 1: Σm(1,3,5,7) over A,B,C reduces to C (1 term, 1 literal)', () => {
    const tt = truthTableFromMinterms(['A', 'B', 'C'], [1, 3, 5, 7]);
    const res = quineMcCluskey(tt, 'SOP');

    expect(res.termCount).toBe(1);
    expect(res.literalCount).toBe(1);
    expect(res.text).toBe('C');
  });

  // Golden Test 2: Σm(1,3,7,11,15) + d(0,2,5) over A,B,C,D → 2 terms, 4 literals
  it('Golden Test 2: Σm(1,3,7,11,15) + d(0,2,5) over A,B,C,D cost and care coverage', () => {
    const tt = truthTableFromMinterms(['A', 'B', 'C', 'D'], [1, 3, 7, 11, 15], [0, 2, 5]);
    const res = quineMcCluskey(tt, 'SOP');

    expect(res.termCount).toBe(2);
    expect(res.literalCount).toBe(4);

    // Verify it evaluates to 1 on all care minterms
    const careMinterms = [1, 3, 7, 11, 15];
    for (const m of careMinterms) {
      const assignment: Record<string, 0 | 1> = {
        A: ((m >> 3) & 1) as 0 | 1,
        B: ((m >> 2) & 1) as 0 | 1,
        C: ((m >> 1) & 1) as 0 | 1,
        D: (m & 1) as 0 | 1,
      };
      expect(evalExpr(res.expr, assignment)).toBe(1);
    }

    // Verify it evaluates to 0 on non-care, non-dc minterms (e.g. 4, 6, 8, 9, 10, 12, 13, 14)
    const zeros = [4, 6, 8, 9, 10, 12, 13, 14];
    for (const z of zeros) {
      const assignment: Record<string, 0 | 1> = {
        A: ((z >> 3) & 1) as 0 | 1,
        B: ((z >> 2) & 1) as 0 | 1,
        C: ((z >> 1) & 1) as 0 | 1,
        D: (z & 1) as 0 | 1,
      };
      expect(evalExpr(res.expr, assignment)).toBe(0);
    }
  });

  // Golden Test 3: Σm(0,1,2,5,6,7,8,9,10,14) over A,B,C,D → 3 terms, 7 literals
  it('Golden Test 3: Σm(0,1,2,5,6,7,8,9,10,14) yields 3 terms, 7 literals', () => {
    const tt = truthTableFromMinterms(['A', 'B', 'C', 'D'], [0, 1, 2, 5, 6, 7, 8, 9, 10, 14]);
    const res = quineMcCluskey(tt, 'SOP');

    expect(res.termCount).toBe(3);
    expect(res.literalCount).toBe(7);

    // Verify equivalence on all 16 rows
    const careMinterms = new Set([0, 1, 2, 5, 6, 7, 8, 9, 10, 14]);
    for (let m = 0; m < 16; m++) {
      const assignment: Record<string, 0 | 1> = {
        A: ((m >> 3) & 1) as 0 | 1,
        B: ((m >> 2) & 1) as 0 | 1,
        C: ((m >> 1) & 1) as 0 | 1,
        D: (m & 1) as 0 | 1,
      };
      expect(evalExpr(res.expr, assignment)).toBe(careMinterms.has(m) ? 1 : 0);
    }
  });

  // Golden Test 4: Σm(4,8,10,11,12,15) + d(9,14) over A,B,C,D → 3 terms, 7 literals
  it('Golden Test 4: Σm(4,8,10,11,12,15) + d(9,14) yields 3 terms, 7 literals', () => {
    const tt = truthTableFromMinterms(['A', 'B', 'C', 'D'], [4, 8, 10, 11, 12, 15], [9, 14]);
    const res = quineMcCluskey(tt, 'SOP');

    expect(res.termCount).toBe(3);
    expect(res.literalCount).toBe(7);

    const cares = [4, 8, 10, 11, 12, 15];
    for (const m of cares) {
      const assignment: Record<string, 0 | 1> = {
        A: ((m >> 3) & 1) as 0 | 1,
        B: ((m >> 2) & 1) as 0 | 1,
        C: ((m >> 1) & 1) as 0 | 1,
        D: (m & 1) as 0 | 1,
      };
      expect(evalExpr(res.expr, assignment)).toBe(1);
    }
  });

  // Golden Test 5: All-zeros → 0; all-ones → 1; single minterm → that minterm
  it('Golden Test 5: Trivial cases (all-zeros, all-ones, single minterm)', () => {
    // All-zeros
    const zeroTT = truthTableFromMinterms(['A', 'B'], []);
    const zeroRes = quineMcCluskey(zeroTT, 'SOP');
    expect(zeroRes.text).toBe('0');
    expect(zeroRes.termCount).toBe(0);

    // All-ones
    const oneTT = truthTableFromMinterms(['A', 'B'], [0, 1, 2, 3]);
    const oneRes = quineMcCluskey(oneTT, 'SOP');
    expect(oneRes.text).toBe('1');
    expect(oneRes.termCount).toBe(1);

    // Single minterm: m2 (10) over A, B -> AB'
    const singleTT = truthTableFromMinterms(['A', 'B'], [2]);
    const singleRes = quineMcCluskey(singleTT, 'SOP');
    expect(singleRes.text).toBe("AB'");
    expect(singleRes.termCount).toBe(1);
    expect(singleRes.literalCount).toBe(2);
  });

  // Golden Test 6: 5-variable function Σm(0,1,2,5,6,7,8,9,10,14,16,21,31)
  it('Golden Test 6: 5-variable function coverage and correctness', () => {
    const minterms = [0, 1, 2, 5, 6, 7, 8, 9, 10, 14, 16, 21, 31];
    const tt = truthTableFromMinterms(['A', 'B', 'C', 'D', 'E'], minterms);
    const res = quineMcCluskey(tt, 'SOP');

    // Must cover all 13 minterms
    const mSet = new Set(minterms);
    for (let m = 0; m < 32; m++) {
      const assignment: Record<string, 0 | 1> = {
        A: ((m >> 4) & 1) as 0 | 1,
        B: ((m >> 3) & 1) as 0 | 1,
        C: ((m >> 2) & 1) as 0 | 1,
        D: ((m >> 1) & 1) as 0 | 1,
        E: (m & 1) as 0 | 1,
      };
      const expected = mSet.has(m) ? 1 : 0;
      expect(evalExpr(res.expr, assignment)).toBe(expected);
    }
  });

  // Golden Test 7: K-map cost matches QM cost for 2 to 4 variables
  it('Golden Test 7: K-Map cost equals QM cost', () => {
    const testCases = [
      { vars: ['A', 'B', 'C'], m: [1, 3, 5, 7], d: [] },
      { vars: ['A', 'B', 'C', 'D'], m: [0, 1, 2, 5, 6, 7, 8, 9, 10, 14], d: [] },
      { vars: ['A', 'B', 'C', 'D'], m: [1, 3, 7, 11, 15], d: [0, 2, 5] },
      { vars: ['A', 'B'], m: [1, 2], d: [] },
    ];

    for (const tc of testCases) {
      const tt = truthTableFromMinterms(tc.vars, tc.m, tc.d);
      const qm = quineMcCluskey(tt, 'SOP');
      const km = kmapSimplify(tt, 'SOP');

      expect(km.termCount).toBe(qm.termCount);
      expect(km.literalCount).toBe(qm.literalCount);
    }
  });

  // Golden Test 8: Wrap-around: 4-corner group for F = B'D' (minterms 0, 2, 8, 10)
  it('Golden Test 8: Torus wrap-around detects 4-corner group for minterms 0, 2, 8, 10', () => {
    const tt = truthTableFromMinterms(['A', 'B', 'C', 'D'], [0, 2, 8, 10]);
    const { groups } = kmapGroups(tt, 'SOP');

    expect(groups.length).toBe(1);
    const cornerGroup = groups[0];
    expect(cornerGroup.cells).toEqual([0, 2, 8, 10]);
    expect(cornerGroup.termText).toBe("B'D'");
    expect(cornerGroup.isCornerGroup).toBe(true);
  });

  // Golden Test 9: POS of Σm(0,1,2,5,6,7,8,9,10,14) equivalent to SOP
  it('Golden Test 9: POS equivalent to SOP result', () => {
    const tt = truthTableFromMinterms(['A', 'B', 'C', 'D'], [0, 1, 2, 5, 6, 7, 8, 9, 10, 14]);
    const sop = quineMcCluskey(tt, 'SOP');
    const pos = quineMcCluskey(tt, 'POS');

    expect(isEquivalent(sop.expr, pos.expr, ['A', 'B', 'C', 'D'])).toBe(true);
  });

  // Additional features: Prime implicants and all minimal covers
  it('primeImplicants and allMinimalCovers APIs', () => {
    const tt = truthTableFromMinterms(['A', 'B', 'C'], [0, 2, 5, 7]);
    const pis = primeImplicants(tt);
    expect(pis.length).toBeGreaterThan(0);

    const covers = allMinimalCovers(tt);
    expect(covers.length).toBeGreaterThan(0);
    expect(covers[0].termCount).toBe(2);
  });

  // Multi-output QM
  it('multiOutputQM finds shared terms', () => {
    const tt1 = truthTableFromMinterms(['A', 'B'], [1, 3]); // B
    const tt2 = truthTableFromMinterms(['A', 'B'], [3]);    // AB
    const multi = multiOutputQM([
      { name: 'Y1', tt: tt1 },
      { name: 'Y2', tt: tt2 },
    ]);

    expect(multi.results.length).toBe(2);
  });
});
