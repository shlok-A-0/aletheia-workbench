/**
 * LDAM Boolean Engine — Canonical Forms & Expression Serializer
 * Generates Canonical SOP (sum of minterms) and Canonical POS (product of maxterms),
 * and converts Expr AST to clean, minimal-parenthesis Boolean algebraic text.
 */

import type { Expr, TruthTable, Step } from '../types';
import { mintermsOf, maxtermsOf } from './truth-table';

/**
 * Precedence levels for AST to string formatting:
 * 4: Primary / NOT
 * 3: AND
 * 2: XOR / XNOR
 * 1: OR
 */
function getPrecedence(e: Expr): number {
  switch (e.t) {
    case 'var':
    case 'const':
      return 5;
    case 'not':
      return 4;
    case 'and':
      return 3;
    case 'xor':
    case 'xnor':
      return 2;
    case 'or':
      return 1;
  }
}

/**
 * Serializes an Expr AST into canonical Boolean algebraic notation.
 * Uses postfix ' for NOT, juxtaposition or minimal parentheses for AND,
 * and + for OR.
 */
export function exprToString(e: Expr): string {
  switch (e.t) {
    case 'var':
      return e.name;

    case 'const':
      return e.v.toString();

    case 'not': {
      const childPrec = getPrecedence(e.a);
      if (e.a.t === 'var' || e.a.t === 'const') {
        return `${exprToString(e.a)}'`;
      }
      // If child is already NOT, wrap to avoid confusing A'' with A
      if (e.a.t === 'not') {
        return `(${exprToString(e.a)})'`;
      }
      if (childPrec < 4) {
        return `(${exprToString(e.a)})'`;
      }
      return `${exprToString(e.a)}'`;
    }

    case 'and': {
      if (e.args.length === 0) return '1';
      return e.args
        .map((arg) => {
          const argPrec = getPrecedence(arg);
          if (argPrec < 3) {
            return `(${exprToString(arg)})`;
          }
          return exprToString(arg);
        })
        .join('');
    }

    case 'or': {
      if (e.args.length === 0) return '0';
      return e.args.map((arg) => exprToString(arg)).join(' + ');
    }

    case 'xor': {
      if (e.args.length === 0) return '0';
      return e.args
        .map((arg) => {
          const argPrec = getPrecedence(arg);
          if (argPrec < 2) {
            return `(${exprToString(arg)})`;
          }
          return exprToString(arg);
        })
        .join(' ^ ');
    }

    case 'xnor': {
      if (e.args.length === 0) return '1';
      return e.args
        .map((arg) => {
          const argPrec = getPrecedence(arg);
          if (argPrec < 2) {
            return `(${exprToString(arg)})`;
          }
          return exprToString(arg);
        })
        .join(' ~^ ');
    }
  }
}

/**
 * Constructs Canonical SOP (Sum of Minterms) from a TruthTable.
 * Returns AST, canonical text, and derivation steps.
 */
export function canonicalSOP(tt: TruthTable): { expr: Expr; text: string; steps: Step[] } {
  const minterms = mintermsOf(tt);
  const vars = tt.vars;
  const n = vars.length;
  const steps: Step[] = [];

  if (minterms.length === 0) {
    steps.push({
      title: 'No true minterms',
      detail: 'The function evaluates to 0 for all input combinations.',
    });
    return { expr: { t: 'const', v: 0 }, text: '0', steps };
  }

  const andTerms: Expr[] = [];
  const textTerms: string[] = [];

  for (const m of minterms) {
    const literals: Expr[] = [];
    const literalStrings: string[] = [];

    for (let bit = 0; bit < n; bit++) {
      const varName = vars[bit];
      const bitVal = (m >> (n - 1 - bit)) & 1;

      if (bitVal === 1) {
        literals.push({ t: 'var', name: varName });
        literalStrings.push(varName);
      } else {
        literals.push({ t: 'not', a: { t: 'var', name: varName } });
        literalStrings.push(`${varName}'`);
      }
    }

    const termExpr: Expr = literals.length === 1 ? literals[0] : { t: 'and', args: literals };
    const termText = literalStrings.join('');

    andTerms.push(termExpr);
    textTerms.push(termText);

    steps.push({
      title: `Minterm m${m}`,
      detail: `Binary ${m.toString(2).padStart(n, '0')} corresponds to product term ${termText}`,
      data: { minterm: m, term: termText },
    });
  }

  const finalExpr: Expr = andTerms.length === 1 ? andTerms[0] : { t: 'or', args: andTerms };
  const finalText = textTerms.join(' + ');

  steps.push({
    title: 'Canonical SOP Expression',
    detail: `Sum of minterms: Σm(${minterms.join(', ')}) = ${finalText}`,
  });

  return { expr: finalExpr, text: finalText, steps };
}

/**
 * Constructs Canonical POS (Product of Maxterms) from a TruthTable.
 * Returns AST, canonical text (e.g. "(A+B+C)(A+B'+C)"), and derivation steps.
 */
export function canonicalPOS(tt: TruthTable): { expr: Expr; text: string; steps: Step[] } {
  const maxterms = maxtermsOf(tt);
  const vars = tt.vars;
  const n = vars.length;
  const steps: Step[] = [];

  if (maxterms.length === 0) {
    steps.push({
      title: 'No false maxterms',
      detail: 'The function evaluates to 1 for all input combinations.',
    });
    return { expr: { t: 'const', v: 1 }, text: '1', steps };
  }

  const orTerms: Expr[] = [];
  const textTerms: string[] = [];

  for (const M of maxterms) {
    const literals: Expr[] = [];
    const literalStrings: string[] = [];

    for (let bit = 0; bit < n; bit++) {
      const varName = vars[bit];
      const bitVal = (M >> (n - 1 - bit)) & 1;

      // In maxterm: 0 corresponds to variable, 1 corresponds to complemented variable
      if (bitVal === 0) {
        literals.push({ t: 'var', name: varName });
        literalStrings.push(varName);
      } else {
        literals.push({ t: 'not', a: { t: 'var', name: varName } });
        literalStrings.push(`${varName}'`);
      }
    }

    const termExpr: Expr = literals.length === 1 ? literals[0] : { t: 'or', args: literals };
    const termText = `(${literalStrings.join('+')})`;

    orTerms.push(termExpr);
    textTerms.push(termText);

    steps.push({
      title: `Maxterm M${M}`,
      detail: `Binary ${M.toString(2).padStart(n, '0')} corresponds to sum term ${termText}`,
      data: { maxterm: M, term: termText },
    });
  }

  const finalExpr: Expr = orTerms.length === 1 ? orTerms[0] : { t: 'and', args: orTerms };
  const finalText = textTerms.join('');

  steps.push({
    title: 'Canonical POS Expression',
    detail: `Product of maxterms: ΠM(${maxterms.join(', ')}) = ${finalText}`,
  });

  return { expr: finalExpr, text: finalText, steps };
}
