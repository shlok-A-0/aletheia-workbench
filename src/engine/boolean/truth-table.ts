/**
 * LDAM Boolean Engine — Truth Table Construction & Inspection
 * Converts between expressions, minterms, maxterms, and truth tables.
 */

import type { Expr, TruthTable } from '../types';
import { collectVars, evalExpr } from './evaluator';

/**
 * Generates a full TruthTable from an AST expression.
 * If vars is omitted, variables are collected from the expression (MSB first).
 */
export function truthTableFromExpr(e: Expr, vars?: string[]): TruthTable {
  let variables = vars ? [...vars] : collectVars(e);
  if (variables.length === 0) {
    variables = ['A'];
  }

  const n = variables.length;
  const numRows = 1 << n;
  const rows: TruthTable['rows'] = [];

  for (let i = 0; i < numRows; i++) {
    const inputs: (0 | 1)[] = [];
    const assignment: Record<string, 0 | 1> = {};

    for (let bit = 0; bit < n; bit++) {
      const val = ((i >> (n - 1 - bit)) & 1) as 0 | 1;
      inputs.push(val);
      assignment[variables[bit]] = val;
    }

    const out = evalExpr(e, assignment);
    rows.push({ index: i, inputs, out });
  }

  return { vars: variables, rows };
}

/**
 * Generates a TruthTable from minterms and optional don't-cares.
 */
export function truthTableFromMinterms(
  vars: string[],
  minterms: number[],
  dontCares: number[] = []
): TruthTable {
  const n = vars.length;
  const numRows = 1 << n;
  const mSet = new Set(minterms);
  const dSet = new Set(dontCares);
  const rows: TruthTable['rows'] = [];

  for (let i = 0; i < numRows; i++) {
    const inputs: (0 | 1)[] = [];
    for (let bit = 0; bit < n; bit++) {
      inputs.push(((i >> (n - 1 - bit)) & 1) as 0 | 1);
    }

    let out: 0 | 1 | 'x' = 0;
    if (dSet.has(i)) {
      out = 'x';
    } else if (mSet.has(i)) {
      out = 1;
    }

    rows.push({ index: i, inputs, out });
  }

  return { vars: [...vars], rows };
}

/**
 * Generates a TruthTable from maxterms and optional don't-cares.
 */
export function truthTableFromMaxterms(
  vars: string[],
  maxterms: number[],
  dontCares: number[] = []
): TruthTable {
  const n = vars.length;
  const numRows = 1 << n;
  const MSet = new Set(maxterms);
  const dSet = new Set(dontCares);
  const rows: TruthTable['rows'] = [];

  for (let i = 0; i < numRows; i++) {
    const inputs: (0 | 1)[] = [];
    for (let bit = 0; bit < n; bit++) {
      inputs.push(((i >> (n - 1 - bit)) & 1) as 0 | 1);
    }

    let out: 0 | 1 | 'x' = 1;
    if (dSet.has(i)) {
      out = 'x';
    } else if (MSet.has(i)) {
      out = 0;
    }

    rows.push({ index: i, inputs, out });
  }

  return { vars: [...vars], rows };
}

/**
 * Generates a TruthTable from an array of outputs.
 */
export function truthTableFromOutputs(vars: string[], outputs: (0 | 1 | 'x')[]): TruthTable {
  const n = vars.length;
  const expectedRows = 1 << n;
  if (outputs.length !== expectedRows) {
    throw new Error(
      `Output length mismatch: expected ${expectedRows} outputs for ${n} variables, got ${outputs.length}`
    );
  }

  const rows: TruthTable['rows'] = [];
  for (let i = 0; i < expectedRows; i++) {
    const inputs: (0 | 1)[] = [];
    for (let bit = 0; bit < n; bit++) {
      inputs.push(((i >> (n - 1 - bit)) & 1) as 0 | 1);
    }
    rows.push({ index: i, inputs, out: outputs[i] });
  }

  return { vars: [...vars], rows };
}

/** Returns the list of minterm indices where output is 1. */
export function mintermsOf(tt: TruthTable): number[] {
  return tt.rows.filter((r) => r.out === 1).map((r) => r.index);
}

/** Returns the list of maxterm indices where output is 0. */
export function maxtermsOf(tt: TruthTable): number[] {
  return tt.rows.filter((r) => r.out === 0).map((r) => r.index);
}

/** Returns the list of don't-care indices where output is 'x'. */
export function dontCaresOf(tt: TruthTable): number[] {
  return tt.rows.filter((r) => r.out === 'x').map((r) => r.index);
}
