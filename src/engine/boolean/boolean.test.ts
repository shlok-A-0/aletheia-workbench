import { describe, it, expect } from 'vitest';
import {
  parseExpr,
  ParseError,
  exprToString,
  collectVars,
  truthTableFromExpr,
  truthTableFromMinterms,
  truthTableFromMaxterms,
  truthTableFromOutputs,
  mintermsOf,
  maxtermsOf,
  dontCaresOf,
  canonicalSOP,
  canonicalPOS,
  isEquivalent,
  simplifyAlgebraic,
} from './index';
import type { Expr } from '../types';

describe('Phase 1 — Boolean Engine Golden Tests', () => {
  // Golden Test 1: parseExpr("A'B + C") evaluates correctly for all 8 inputs; exprToString round-trips
  it('Golden Test 1: parseExpr and round-trip for A\'B + C', () => {
    const expr = parseExpr("A'B + C");
    expect(collectVars(expr)).toEqual(['A', 'B', 'C']);

    const tt = truthTableFromExpr(expr, ['A', 'B', 'C']);
    // Expected truth values for A'B + C:
    // 0: A=0, B=0, C=0 -> 0*0 + 0 = 0
    // 1: A=0, B=0, C=1 -> 0*0 + 1 = 1
    // 2: A=0, B=1, C=0 -> 1*1 + 0 = 1
    // 3: A=0, B=1, C=1 -> 1*1 + 1 = 1
    // 4: A=1, B=0, C=0 -> 0*0 + 0 = 0
    // 5: A=1, B=0, C=1 -> 0*0 + 1 = 1
    // 6: A=1, B=1, C=0 -> 0*1 + 0 = 0
    // 7: A=1, B=1, C=1 -> 0*1 + 1 = 1
    const outputs = tt.rows.map((r) => r.out);
    expect(outputs).toEqual([0, 1, 1, 1, 0, 1, 0, 1]);

    // Round-trip: parse -> string -> parse gives an equivalent Expr
    const str = exprToString(expr);
    const roundTripped = parseExpr(str);
    expect(isEquivalent(expr, roundTripped, ['A', 'B', 'C'])).toBe(true);
  });

  // Golden Test 2: truthTableFromMinterms(['A','B','C'],[1,3,5,7]) has outputs [0,1,0,1,0,1,0,1]; maxterms [0,2,4,6]
  it('Golden Test 2: truthTableFromMinterms outputs and maxterms', () => {
    const tt = truthTableFromMinterms(['A', 'B', 'C'], [1, 3, 5, 7]);
    expect(tt.rows.map((r) => r.out)).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
    expect(mintermsOf(tt)).toEqual([1, 3, 5, 7]);
    expect(maxtermsOf(tt)).toEqual([0, 2, 4, 6]);
  });

  // Golden Test 3: canonicalPOS of that table is (A+B+C)(A+B'+C)(A'+B+C)(A'+B'+C)
  it('Golden Test 3: canonicalPOS format', () => {
    const tt = truthTableFromMinterms(['A', 'B', 'C'], [1, 3, 5, 7]);
    const pos = canonicalPOS(tt);
    expect(pos.text).toBe('(A+B+C)(A+B\'+C)(A\'+B+C)(A\'+B\'+C)');
  });

  // Golden Test 4: XOR A^B has minterms [1,2]; XNOR has [0,3]
  it('Golden Test 4: XOR and XNOR minterms', () => {
    const xorExpr = parseExpr('A ^ B');
    const xorTT = truthTableFromExpr(xorExpr, ['A', 'B']);
    expect(mintermsOf(xorTT)).toEqual([1, 2]);

    const xnorExpr = parseExpr('A ~^ B');
    const xnorTT = truthTableFromExpr(xnorExpr, ['A', 'B']);
    expect(mintermsOf(xnorTT)).toEqual([0, 3]);

    const xnorKeyword = parseExpr('A XNOR B');
    const xnorKeywordTT = truthTableFromExpr(xnorKeyword, ['A', 'B']);
    expect(mintermsOf(xnorKeywordTT)).toEqual([0, 3]);
  });

  // Golden Test 5: De Morgan equivalence
  it('Golden Test 5: De Morgan isEquivalent tests', () => {
    const e1 = parseExpr('(AB)\'');
    const e2 = parseExpr("A' + B'");
    expect(isEquivalent(e1, e2)).toBe(true);

    const e3 = parseExpr('A + B');
    const e4 = parseExpr('AB');
    expect(isEquivalent(e3, e4)).toBe(false);
  });

  // Golden Test 6: Parse errors
  it('Golden Test 6: Syntax errors throw ParseError with position', () => {
    expect(() => parseExpr('A+')).toThrow(ParseError);
    expect(() => parseExpr('(A+B')).toThrow(ParseError);
    expect(() => parseExpr('A$B')).toThrow(ParseError);

    try {
      parseExpr('A$B');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).position).toBe(1);
    }
  });

  // Golden Test 7: Property test on 50 random expressions
  it('Golden Test 7: Property test on 50 random expressions over 4 variables', () => {
    const vars = ['A', 'B', 'C', 'D'];

    function randomExpr(depth: number): Expr {
      if (depth <= 1 || Math.random() < 0.25) {
        if (Math.random() < 0.1) {
          return { t: 'const', v: Math.random() < 0.5 ? 0 : 1 };
        }
        const v = vars[Math.floor(Math.random() * vars.length)];
        return { t: 'var', name: v };
      }

      const opChoice = Math.random();
      if (opChoice < 0.2) {
        return { t: 'not', a: randomExpr(depth - 1) };
      }
      if (opChoice < 0.5) {
        return { t: 'and', args: [randomExpr(depth - 1), randomExpr(depth - 1)] };
      }
      if (opChoice < 0.8) {
        return { t: 'or', args: [randomExpr(depth - 1), randomExpr(depth - 1)] };
      }
      return { t: 'xor', args: [randomExpr(depth - 1), randomExpr(depth - 1)] };
    }

    for (let testRun = 0; testRun < 50; testRun++) {
      const expr = randomExpr(3);
      const str = exprToString(expr);
      const parsed = parseExpr(str);

      const ttOriginal = truthTableFromExpr(expr, vars);
      const ttParsed = truthTableFromExpr(parsed, vars);

      expect(ttParsed.rows.map((r) => r.out)).toEqual(ttOriginal.rows.map((r) => r.out));
    }
  });

  // Golden Test 8: Don't-cares indices
  it('Golden Test 8: Don\'t-cares positioning', () => {
    const tt = truthTableFromMinterms(['A', 'B', 'C', 'D'], [1, 3, 7, 11, 15], [0, 2, 5]);
    expect(dontCaresOf(tt)).toEqual([0, 2, 5]);
    expect(mintermsOf(tt)).toEqual([1, 3, 7, 11, 15]);
  });

  // Additional tests: Algebraic simplification laws
  it('Algebraic simplification: A + A\'B simplifies to A + B', () => {
    const expr = parseExpr("A + A'B");
    const result = simplifyAlgebraic(expr);
    expect(isEquivalent(result.expr, parseExpr('A + B'))).toBe(true);
    expect(result.steps.length).toBeGreaterThan(1);
  });

  it('Algebraic simplification: (A + B)\' simplifies via De Morgan to A\'B\'', () => {
    const expr = parseExpr('(A + B)\'');
    const result = simplifyAlgebraic(expr);
    expect(isEquivalent(result.expr, parseExpr("A'B'"))).toBe(true);
  });

  it('Canonical SOP generation', () => {
    const tt = truthTableFromMinterms(['A', 'B'], [1, 2]);
    const sop = canonicalSOP(tt);
    expect(sop.text).toBe("A'B + AB'");
    expect(sop.steps.length).toBeGreaterThan(0);
  });

  it('truthTableFromMaxterms and truthTableFromOutputs', () => {
    const ttMax = truthTableFromMaxterms(['A', 'B'], [0, 3]);
    expect(mintermsOf(ttMax)).toEqual([1, 2]);
    expect(maxtermsOf(ttMax)).toEqual([0, 3]);

    const ttOut = truthTableFromOutputs(['A', 'B'], [0, 1, 'x', 0]);
    expect(ttOut.rows[2].out).toBe('x');
    expect(ttOut.rows[1].out).toBe(1);
  });
});
