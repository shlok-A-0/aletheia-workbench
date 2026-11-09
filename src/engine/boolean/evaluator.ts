/**
 * Aletheia Boolean Engine — Evaluator & Equivalence Checker
 * Evaluates AST against variable truth assignments, collects variables,
 * and checks Boolean equivalence by comparing truth table evaluations.
 */

import type { Expr } from '../types';

/**
 * Collects all unique variables appearing in the expression AST.
 * Returned array is sorted alphabetically (MSB-first convention).
 */
export function collectVars(e: Expr): string[] {
  const varsSet = new Set<string>();

  function walk(node: Expr) {
    switch (node.t) {
      case 'var':
        varsSet.add(node.name);
        break;
      case 'const':
        break;
      case 'not':
        walk(node.a);
        break;
      case 'and':
      case 'or':
      case 'xor':
      case 'xnor':
        for (const child of node.args) {
          walk(child);
        }
        break;
    }
  }

  walk(e);
  return Array.from(varsSet).sort();
}

/**
 * Evaluates an AST expression given a variable assignment mapping.
 * Any unassigned variable defaults to 0.
 */
export function evalExpr(e: Expr, assignment: Record<string, 0 | 1>): 0 | 1 {
  switch (e.t) {
    case 'var':
      return assignment[e.name] ?? 0;
    case 'const':
      return e.v;
    case 'not':
      return evalExpr(e.a, assignment) === 1 ? 0 : 1;
    case 'and': {
      for (const arg of e.args) {
        if (evalExpr(arg, assignment) === 0) return 0;
      }
      return 1;
    }
    case 'or': {
      for (const arg of e.args) {
        if (evalExpr(arg, assignment) === 1) return 1;
      }
      return 0;
    }
    case 'xor': {
      let result = 0;
      for (const arg of e.args) {
        result ^= evalExpr(arg, assignment);
      }
      return (result & 1) as 0 | 1;
    }
    case 'xnor': {
      let result = 0;
      for (const arg of e.args) {
        result ^= evalExpr(arg, assignment);
      }
      return ((result ^ 1) & 1) as 0 | 1;
    }
  }
}

/**
 * Checks whether two expressions are logically equivalent by evaluating both
 * across all 2^n combinations of their variables.
 */
export function isEquivalent(a: Expr, b: Expr, vars?: string[]): boolean {
  const variables = vars ?? Array.from(new Set([...collectVars(a), ...collectVars(b)])).sort();
  const n = variables.length;
  const numRows = 1 << n;

  for (let i = 0; i < numRows; i++) {
    const assignment: Record<string, 0 | 1> = {};
    for (let bit = 0; bit < n; bit++) {
      // MSB is variables[0]
      const val = ((i >> (n - 1 - bit)) & 1) as 0 | 1;
      assignment[variables[bit]] = val;
    }

    if (evalExpr(a, assignment) !== evalExpr(b, assignment)) {
      return false;
    }
  }

  return true;
}
