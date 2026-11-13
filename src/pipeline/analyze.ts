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

/** Inline minimisation stays instant up to this many variables; larger functions go to the engine worker. */
export const MAX_INLINE_VARS = 6;
/** The engine's hard ceiling (a 256-row table). */
export const MAX_VARS = 8;

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

/** Minimised result → full analysis (tidy text, every circuit variant). */
export function finishAnalysis(
  table: TruthTable,
  expr: Expr | null,
  form: 'SOP' | 'POS',
  raw: MinResult
): Analysis {
  const min = { ...raw, text: tidyTerms(raw.text) };
  return { vars: table.vars, table, expr, form, min, netlists: buildNetlists(min, expr) };
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
      error: `Functions of more than ${MAX_INLINE_VARS} variables are solved in the background (${table.vars.length} here).`,
    };
  }
  try {
    return { ok: true, analysis: finishAnalysis(table, expr, form, quineMcCluskey(table, form)) };
  } catch (error) {
    return { ok: false, empty: false, error: error instanceof Error ? error.message : String(error) };
  }
}

type ParsedSource =
  | { ok: true; table: TruthTable; expr: Expr | null }
  | { ok: false; error: string; empty: boolean };

/** Typed input → truth table (cheap, even at 8 variables). */
export function parseSource(source: Source): ParsedSource {
  const text = source.text.trim();
  if (!text) return { ok: false, error: '', empty: true };
  try {
    if (source.mode === 'expr') {
      const expr = parseExpr(text);
      const found = collectVars(expr);
      const vars = found.length > 0 ? found : ['A'];
      if (vars.length > MAX_VARS) throw new Error(`The engine supports at most ${MAX_VARS} variables.`);
      return { ok: true, table: truthTableFromExpr(expr, vars), expr };
    }
    const vars = ALPHABET.slice(0, Math.min(source.numVars, MAX_VARS)).split('');
    const care = parseIndexList(text);
    const dontCares = parseIndexList(source.dontCares);
    const table = source.mode === 'minterms'
      ? truthTableFromMinterms(vars, care, dontCares)
      : truthTableFromMaxterms(vars, care, dontCares);
    return { ok: true, table, expr: null };
  } catch (error) {
    const message = error instanceof ParseError || error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, empty: false };
  }
}

export function analyzeSource(source: Source): AnalysisOutcome {
  const parsed = parseSource(source);
  return parsed.ok ? analyzeTable(parsed.table, parsed.expr) : parsed;
}

/** True when this input is too big to minimise on the UI thread. */
export function needsWorker(parsed: ParsedSource): boolean {
  return parsed.ok && parsed.table.vars.length > MAX_INLINE_VARS;
}

export type Minimizer = (table: TruthTable, form: 'SOP' | 'POS') => Promise<MinResult>;

/** The worker-backed minimiser (loaded lazily so the worker only starts when a large function is typed). */
const workerMinimizer: Minimizer = async (table, form) => {
  const { getEngineWorker } = await import('../workers/useEngineWorker');
  return getEngineWorker().minimize(table, form);
};

/** Large-function path: parse is instant, the Quine–McCluskey solve runs off the UI thread. */
export async function analyzeLarge(
  table: TruthTable,
  expr: Expr | null,
  minimize: Minimizer = workerMinimizer,
  form: 'SOP' | 'POS' = 'SOP'
): Promise<AnalysisOutcome> {
  try {
    return { ok: true, analysis: finishAnalysis(table, expr, form, await minimize(table, form)) };
  } catch (error) {
    return { ok: false, empty: false, error: error instanceof Error ? error.message : String(error) };
  }
}

let recomputeSeq = 0;

/**
 * Re-solve an edited table (cell edit, SOP/POS switch) and write the result to the store.
 * Small functions apply synchronously; large ones are solved in the worker, and a result that
 * has been overtaken by a newer edit is dropped.
 */
export function recompute(table: TruthTable, expr: Expr | null, form: 'SOP' | 'POS' = 'SOP'): void {
  const id = ++recomputeSeq;
  if (table.vars.length <= MAX_INLINE_VARS) {
    const out = analyzeTable(table, expr, form);
    if (out.ok) applyAnalysis(out.analysis, null);
    return;
  }
  void analyzeLarge(table, expr, undefined, form).then((out) => {
    if (id === recomputeSeq && out.ok) applyAnalysis(out.analysis, null);
  });
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
