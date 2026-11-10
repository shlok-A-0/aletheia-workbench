import {
  ParseError,
  collectVars,
  parseExpr,
  truthTableFromExpr,
  truthTableFromMaxterms,
  truthTableFromMinterms,
} from '../engine/boolean';
import { quineMcCluskey } from '../engine/minimize';
import { exprToNetlist, minResultToNetlist, toNandOnly, toNorOnly } from '../engine/circuit/generate';
import type { Expr, MinResult, Netlist, TruthTable } from '../engine/types';
import { useStore } from '../store';
import type { CircuitVariant } from '../store/slices/circuit';

/**
 * The live pipeline: one pure function turns what the user typed into every
 * downstream artefact (table → minimised form → circuits). The workbench calls
 * it on each (debounced) edit, so there are no Analyze / Proceed buttons.
 */

export type SourceMode = 'expr' | 'minterms' | 'maxterms';

export interface Source {
  mode: SourceMode;
  text: string;
  dontCares: string;
  /** Used by minterms / maxterms; ignored for expressions (derived from the text). */
  numVars: number;
}

/** Inline minimisation stays instant up to this many variables. */
export const MAX_INLINE_VARS = 6;

export interface Analysis {
  vars: string[];
  table: TruthTable;
  expr: Expr | null;
  form: 'SOP' | 'POS';
  min: MinResult;
  netlists: Record<CircuitVariant, Netlist | null>;
}

export type AnalysisOutcome =
  | { ok: true; analysis: Analysis }
  | { ok: false; error: string; empty: boolean };

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function parseIndexList(text: string): number[] {
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  return tokens.map((token) => {
    if (!/^\d+$/.test(token)) throw new Error(`'${token}' is not a whole number.`);
    return Number(token);
  });
}

/**
 * Drop gates whose output feeds nothing (and isn't a circuit output), repeatedly.
 * The NAND/NOR conversions can leave an orphaned inverter pair behind, which
 * would otherwise be drawn as a gate with a dangling output and counted as cost.
 */
export function pruneDeadGates(netlist: Netlist): Netlist {
  let nodes = netlist.nodes;
  for (;;) {
    const used = new Set<string>(netlist.outputs);
    for (const n of nodes) {
      if (n.kind === 'gate') n.inputs.forEach((net) => used.add(net));
      else if ('inputs' in n && Array.isArray(n.inputs)) (n.inputs as string[]).forEach((net) => used.add(net));
    }
    const next = nodes.filter((n) => n.kind !== 'gate' || used.has(n.output));
    if (next.length === nodes.length) break;
    nodes = next;
  }
  return nodes === netlist.nodes ? netlist : { ...netlist, nodes };
}

export function buildNetlists(
  min: MinResult,
  expr: Expr | null
): Record<CircuitVariant, Netlist | null> {
  const simplified = minResultToNetlist(min);
  return {
    original: expr ? exprToNetlist(expr, { name: 'original' }) : simplified,
    simplified,
    nand: pruneDeadGates(toNandOnly(simplified)),
    nor: pruneDeadGates(toNorOnly(simplified)),
  };
}

/**
 * The engine may print the same cover in any term order ("C + A'B"). Students
 * expect alphabetical, so order plain sum-of-products text for display. Product-of-sums
 * text (with parentheses) is left exactly as the engine produced it.
 */
export function tidyTerms(text: string): string {
  if (text.includes('(') || !text.includes(' + ')) return text;
  const key = (term: string) => term.replace(/[^A-Za-z]/g, '');
  return text
    .split(' + ')
    .sort((a, b) => key(a).localeCompare(key(b)) || a.length - b.length)
    .join(' + ');
}

/** Table → minimised result → circuits. Shared by typed input and table edits. */
export function analyzeTable(
  table: TruthTable,
  expr: Expr | null,
  form: 'SOP' | 'POS' = 'SOP'
): AnalysisOutcome {
  if (table.vars.length > MAX_INLINE_VARS) {
    return {
      ok: false,
      empty: false,
      error: `Live mode handles up to ${MAX_INLINE_VARS} variables. Use Advanced input for ${table.vars.length}.`,
    };
  }
  try {
    const raw = quineMcCluskey(table, form);
    const min = { ...raw, text: tidyTerms(raw.text) };
    return {
      ok: true,
      analysis: { vars: table.vars, table, expr, form, min, netlists: buildNetlists(min, expr) },
    };
  } catch (error) {
    return { ok: false, empty: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function analyzeSource(source: Source): AnalysisOutcome {
  const text = source.text.trim();
  if (!text) return { ok: false, error: '', empty: true };
  try {
    if (source.mode === 'expr') {
      const expr = parseExpr(text);
      const found = collectVars(expr);
      const vars = found.length > 0 ? found : ['A'];
      if (vars.length > 8) throw new Error('The engine supports at most 8 variables.');
      return analyzeTable(truthTableFromExpr(expr, vars), expr);
    }
    const vars = ALPHABET.slice(0, source.numVars).split('');
    const care = parseIndexList(text);
    const dontCares = parseIndexList(source.dontCares);
    const table = source.mode === 'minterms'
      ? truthTableFromMinterms(vars, care, dontCares)
      : truthTableFromMaxterms(vars, care, dontCares);
    return analyzeTable(table, null);
  } catch (error) {
    const message = error instanceof ParseError || error instanceof Error ? error.message : String(error);
    return { ok: false, empty: false, error: message };
  }
}

/** Write a successful analysis into the store in one atomic update. */
export function applyAnalysis(analysis: Analysis, source: Source | null): void {
  const { table, vars, expr, form, min, netlists } = analysis;
  const rawInput = source?.text ?? 'Edited table';
  const inputMode = source ? source.mode : 'table';
  const sourceMode = inputMode === 'expr' ? 'expression' : inputMode;
  useStore.setState({
    input: { mode: sourceMode, raw: rawInput, vars } as ReturnType<typeof useStore.getState>['input'],
    rawInput,
    inputMode,
    vars,
    truthTable: table,
    parsedExpr: expr,
    ...(source?.mode === 'minterms' ? { mintermsStr: source.text, dontCaresStr: source.dontCares } : {}),
    ...(source?.mode === 'maxterms' ? { maxtermsStr: source.text, dontCaresStr: source.dontCares } : {}),
    minResult: min,
    multiMinResult: null,
    selectedForm: form,
    isComputing: false,
    netlists,
    activeVariant: 'simplified',
    // Everything downstream of the netlist is now stale.
    waveform: null,
    costReport: null,
    powerReport: null,
    faultReport: null,
  });
}
