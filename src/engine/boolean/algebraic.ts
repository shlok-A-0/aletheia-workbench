/**
 * Aletheia Boolean Engine — Algebraic Simplification
 * Applies named Boolean algebraic theorems step-by-step, recording pedagogical
 * explanation steps and guarding against infinite loops with cycle detection.
 */

import type { Expr, Step } from '../types';
import { exprToString } from './canonical';
import { isEquivalent } from './evaluator';

/**
 * Checks if two expressions are structurally identical.
 */
function areExprEqual(a: Expr, b: Expr): boolean {
  if (a.t !== b.t) return false;
  switch (a.t) {
    case 'var':
      return b.t === 'var' && a.name === b.name;
    case 'const':
      return b.t === 'const' && a.v === b.v;
    case 'not':
      return b.t === 'not' && areExprEqual(a.a, b.a);
    case 'and':
    case 'or':
    case 'xor':
    case 'xnor': {
      if (b.t !== a.t || a.args.length !== b.args.length) return false;
      // AND/OR/XOR/XNOR are commutative: match arguments as a multiset.
      const used = new Array<boolean>(b.args.length).fill(false);
      for (const arg of a.args) {
        const hit = b.args.findIndex((other, j) => !used[j] && areExprEqual(arg, other));
        if (hit === -1) return false;
        used[hit] = true;
      }
      return true;
    }
  }
}

/**
 * Checks if an expression is the complement of another.
 * E.g., not(A) is complement of A; A is complement of not(A).
 */
function isComplement(a: Expr, b: Expr): boolean {
  if (a.t === 'not' && areExprEqual(a.a, b)) return true;
  if (b.t === 'not' && areExprEqual(b.a, a)) return true;
  return false;
}

/**
 * Flattens nested associative operations:
 * (A + (B + C)) -> (A + B + C)
 * (A · (B · C)) -> (A · B · C)
 */
function flattenAssociative(e: Expr): Expr {
  if (e.t === 'or') {
    const flatArgs: Expr[] = [];
    for (const arg of e.args) {
      const flattened = flattenAssociative(arg);
      if (flattened.t === 'or') {
        flatArgs.push(...flattened.args);
      } else {
        flatArgs.push(flattened);
      }
    }
    return flatArgs.length === 1 ? flatArgs[0] : { t: 'or', args: flatArgs };
  }

  if (e.t === 'and') {
    const flatArgs: Expr[] = [];
    for (const arg of e.args) {
      const flattened = flattenAssociative(arg);
      if (flattened.t === 'and') {
        flatArgs.push(...flattened.args);
      } else {
        flatArgs.push(flattened);
      }
    }
    return flatArgs.length === 1 ? flatArgs[0] : { t: 'and', args: flatArgs };
  }

  if (e.t === 'not') {
    return { t: 'not', a: flattenAssociative(e.a) };
  }

  return e;
}

interface RewriteResult {
  expr: Expr;
  changed: boolean;
  rule?: string;
  detail?: string;
}

/**
 * Tries to apply a single Boolean theorem anywhere in the expression tree.
 */
function tryApplyOneLaw(e: Expr): RewriteResult {
  // 1. Involution (Double Negation): (A')' = A
  if (e.t === 'not' && e.a.t === 'not') {
    return {
      expr: e.a.a,
      changed: true,
      rule: 'Involution (Double Negation)',
      detail: `Simplified (${exprToString(e.a)})' to ${exprToString(e.a.a)}`,
    };
  }

  // 2. Constants under NOT: 0' = 1, 1' = 0
  if (e.t === 'not' && e.a.t === 'const') {
    const nextVal: 0 | 1 = e.a.v === 0 ? 1 : 0;
    return {
      expr: { t: 'const', v: nextVal },
      changed: true,
      rule: 'Complement of Constant',
      detail: `${e.a.v}' = ${nextVal}`,
    };
  }

  // 3. De Morgan's Laws:
  // (A + B + ...)' = A' · B' · ...
  if (e.t === 'not' && e.a.t === 'or') {
    const newArgs = e.a.args.map((arg): Expr => ({ t: 'not', a: arg }));
    const newExpr: Expr = { t: 'and', args: newArgs };
    return {
      expr: newExpr,
      changed: true,
      rule: "De Morgan's Law",
      detail: `Transformed (${exprToString(e.a)})' to ${exprToString(newExpr)}`,
    };
  }

  // (A · B · ...)' = A' + B' + ...
  if (e.t === 'not' && e.a.t === 'and') {
    const newArgs = e.a.args.map((arg): Expr => ({ t: 'not', a: arg }));
    const newExpr: Expr = { t: 'or', args: newArgs };
    return {
      expr: newExpr,
      changed: true,
      rule: "De Morgan's Law",
      detail: `Transformed (${exprToString(e.a)})' to ${exprToString(newExpr)}`,
    };
  }

  // 4. OR laws
  if (e.t === 'or') {
    // Single child: or([A]) -> A
    if (e.args.length === 1) {
      return { expr: e.args[0], changed: true, rule: 'Identity', detail: 'Single operand' };
    }

    // Annulment / Null law: A + 1 = 1
    if (e.args.some((a) => a.t === 'const' && a.v === 1)) {
      return {
        expr: { t: 'const', v: 1 },
        changed: true,
        rule: 'Annulment (Null Law)',
        detail: `Any term OR 1 equals 1`,
      };
    }

    // Identity law: remove 0 from OR (A + 0 = A)
    const withoutZeros = e.args.filter((a) => !(a.t === 'const' && a.v === 0));
    if (withoutZeros.length !== e.args.length) {
      const nextExpr: Expr =
        withoutZeros.length === 0
          ? { t: 'const', v: 0 }
          : withoutZeros.length === 1
            ? withoutZeros[0]
            : { t: 'or', args: withoutZeros };
      return {
        expr: nextExpr,
        changed: true,
        rule: 'Identity Law',
        detail: `Removed identity element 0 from OR expression`,
      };
    }

    // Idempotent law: remove duplicates (A + A = A)
    const uniqueArgs: Expr[] = [];
    let hadDup = false;
    for (const arg of e.args) {
      if (uniqueArgs.some((u) => areExprEqual(u, arg))) {
        hadDup = true;
      } else {
        uniqueArgs.push(arg);
      }
    }
    if (hadDup) {
      const nextExpr: Expr =
        uniqueArgs.length === 1 ? uniqueArgs[0] : { t: 'or', args: uniqueArgs };
      return {
        expr: nextExpr,
        changed: true,
        rule: 'Idempotent Law',
        detail: `Eliminated redundant duplicate terms: ${exprToString(e)} = ${exprToString(nextExpr)}`,
      };
    }

    // Complementarity law: A + A' = 1
    for (let i = 0; i < e.args.length; i++) {
      for (let j = i + 1; j < e.args.length; j++) {
        if (isComplement(e.args[i], e.args[j])) {
          return {
            expr: { t: 'const', v: 1 },
            changed: true,
            rule: 'Complementarity Law',
            detail: `${exprToString(e.args[i])} + ${exprToString(e.args[j])} = 1`,
          };
        }
      }
    }

    // Absorption laws:
    // A + AB = A
    for (let i = 0; i < e.args.length; i++) {
      const termA = e.args[i];
      for (let j = 0; j < e.args.length; j++) {
        if (i === j) continue;
        const termB = e.args[j];
        if (termB.t === 'and') {
          // If termB contains termA, termB is absorbed
          if (termB.args.some((sub) => areExprEqual(sub, termA))) {
            const remaining = e.args.filter((_, idx) => idx !== j);
            const nextExpr: Expr =
              remaining.length === 1 ? remaining[0] : { t: 'or', args: remaining };
            return {
              expr: nextExpr,
              changed: true,
              rule: 'Absorption Law',
              detail: `${exprToString(termA)} + ${exprToString(termB)} = ${exprToString(termA)}`,
            };
          }
        }
      }
    }

    // Negative Absorption / Redundancy rule:
    // A + A'B = A + B
    // A' + AB = A' + B
    for (let i = 0; i < e.args.length; i++) {
      const termA = e.args[i];
      for (let j = 0; j < e.args.length; j++) {
        if (i === j) continue;
        const termB = e.args[j];
        if (termB.t === 'and') {
          const complementIdx = termB.args.findIndex((sub) => isComplement(sub, termA));
          if (complementIdx !== -1) {
            // Remove the complemented literal from termB
            const newTermBArgs = termB.args.filter((_, idx) => idx !== complementIdx);
            const simplifiedTermB: Expr =
              newTermBArgs.length === 1 ? newTermBArgs[0] : { t: 'and', args: newTermBArgs };
            const newOrArgs = e.args.map((arg, idx) => (idx === j ? simplifiedTermB : arg));
            const nextExpr: Expr = { t: 'or', args: newOrArgs };
            return {
              expr: nextExpr,
              changed: true,
              rule: 'Redundancy Law (Negative Absorption)',
              detail: `${exprToString(termA)} + ${exprToString(termB)} = ${exprToString(termA)} + ${exprToString(simplifiedTermB)}`,
            };
          }
        }
      }
    }
  }

  // 5. AND laws
  if (e.t === 'and') {
    // Single child: and([A]) -> A
    if (e.args.length === 1) {
      return { expr: e.args[0], changed: true, rule: 'Identity', detail: 'Single operand' };
    }

    // Annulment / Null law: A · 0 = 0
    if (e.args.some((a) => a.t === 'const' && a.v === 0)) {
      return {
        expr: { t: 'const', v: 0 },
        changed: true,
        rule: 'Annulment (Null Law)',
        detail: `Any term AND 0 equals 0`,
      };
    }

    // Identity law: remove 1 from AND (A · 1 = A)
    const withoutOnes = e.args.filter((a) => !(a.t === 'const' && a.v === 1));
    if (withoutOnes.length !== e.args.length) {
      const nextExpr: Expr =
        withoutOnes.length === 0
          ? { t: 'const', v: 1 }
          : withoutOnes.length === 1
            ? withoutOnes[0]
            : { t: 'and', args: withoutOnes };
      return {
        expr: nextExpr,
        changed: true,
        rule: 'Identity Law',
        detail: `Removed identity element 1 from AND expression`,
      };
    }

    // Idempotent law: remove duplicates (A · A = A)
    const uniqueArgs: Expr[] = [];
    let hadDup = false;
    for (const arg of e.args) {
      if (uniqueArgs.some((u) => areExprEqual(u, arg))) {
        hadDup = true;
      } else {
        uniqueArgs.push(arg);
      }
    }
    if (hadDup) {
      const nextExpr: Expr =
        uniqueArgs.length === 1 ? uniqueArgs[0] : { t: 'and', args: uniqueArgs };
      return {
        expr: nextExpr,
        changed: true,
        rule: 'Idempotent Law',
        detail: `Eliminated redundant duplicate factors: ${exprToString(e)} = ${exprToString(nextExpr)}`,
      };
    }

    // Complementarity law: A · A' = 0
    for (let i = 0; i < e.args.length; i++) {
      for (let j = i + 1; j < e.args.length; j++) {
        if (isComplement(e.args[i], e.args[j])) {
          return {
            expr: { t: 'const', v: 0 },
            changed: true,
            rule: 'Complementarity Law',
            detail: `${exprToString(e.args[i])} · ${exprToString(e.args[j])} = 0`,
          };
        }
      }
    }

    // Absorption laws: A(A + B) = A
    for (let i = 0; i < e.args.length; i++) {
      const termA = e.args[i];
      for (let j = 0; j < e.args.length; j++) {
        if (i === j) continue;
        const termB = e.args[j];
        if (termB.t === 'or') {
          if (termB.args.some((sub) => areExprEqual(sub, termA))) {
            const remaining = e.args.filter((_, idx) => idx !== j);
            const nextExpr: Expr =
              remaining.length === 1 ? remaining[0] : { t: 'and', args: remaining };
            return {
              expr: nextExpr,
              changed: true,
              rule: 'Absorption Law',
              detail: `${exprToString(termA)}(${exprToString(termB)}) = ${exprToString(termA)}`,
            };
          }
        }
      }
    }
  }

  // 6. Recursively rewrite children
  if (e.t === 'not') {
    const childRes = tryApplyOneLaw(e.a);
    if (childRes.changed) {
      return {
        expr: { t: 'not', a: childRes.expr },
        changed: true,
        rule: childRes.rule,
        detail: childRes.detail,
      };
    }
  } else if (e.t === 'and' || e.t === 'or' || e.t === 'xor' || e.t === 'xnor') {
    for (let i = 0; i < e.args.length; i++) {
      const childRes = tryApplyOneLaw(e.args[i]);
      if (childRes.changed) {
        const nextArgs = [...e.args];
        nextArgs[i] = childRes.expr;
        return {
          expr: { t: e.t, args: nextArgs } as Expr,
          changed: true,
          rule: childRes.rule,
          detail: childRes.detail,
        };
      }
    }
  }

  return { expr: e, changed: false };
}

/**
 * Simplifies a Boolean expression using standard algebraic theorems.
 * Records each law applied in steps.
 * Halts when no further reduction occurs, when an AST state repeats,
 * or after 100 rounds.
 */
export function simplifyAlgebraic(expr: Expr): { expr: Expr; steps: Step[] } {
  let current = flattenAssociative(expr);
  const steps: Step[] = [];
  const visited = new Set<string>();
  const MAX_ROUNDS = 100;

  visited.add(exprToString(current));

  steps.push({
    title: 'Initial Expression',
    detail: `Starting with: ${exprToString(current)}`,
  });

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const rewrite = tryApplyOneLaw(current);
    if (!rewrite.changed) {
      break;
    }

    const nextFlattened = flattenAssociative(rewrite.expr);
    const serialized = exprToString(nextFlattened);

    steps.push({
      title: rewrite.rule ?? `Step ${round}`,
      detail: rewrite.detail ?? `Applied simplification to yield: ${serialized}`,
      data: { before: exprToString(current), after: serialized },
    });

    if (visited.has(serialized)) {
      steps.push({
        title: 'Simplification Complete',
        detail: 'Simplification halted: recurring state detected.',
      });
      current = nextFlattened;
      break;
    }

    visited.add(serialized);
    current = nextFlattened;

    if (round === MAX_ROUNDS) {
      steps.push({
        title: 'Simplification Halted',
        detail: `Simplification halted: reached maximum iteration limit (${MAX_ROUNDS} rounds).`,
      });
    }
  }

  // Safety check: verify logical equivalence with original
  if (!isEquivalent(expr, current)) {
    // If an unintended mismatch occurred, safely revert
    return {
      expr,
      steps: [
        {
          title: 'Simplification Rollback',
          detail: 'Preserved original expression to guarantee strict logical equivalence.',
        },
      ],
    };
  }

  return { expr: current, steps };
}
