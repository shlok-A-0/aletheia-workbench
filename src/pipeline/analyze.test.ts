import { afterEach, describe, expect, it } from 'vitest';
import { verify } from '../engine/circuit/simulate';
import { useStore } from '../store';
import { analyzeSource, analyzeTable, applyAnalysis, pruneDeadGates, tidyTerms, type Source } from './analyze';

const expr = (text: string): Source => ({ mode: 'expr', text, dontCares: '', numVars: 3 });
/** Term order is the engine's choice; compare the set of product terms. */
const terms = (text: string) => text.split(' + ').sort();

afterEach(() => {
  useStore.getState().resetInput();
  useStore.getState().resetMinimize();
  useStore.getState().resetCircuits();
});

describe('live pipeline', () => {
  it("turns A'B + C into a verified, minimised circuit", () => {
    const out = analyzeSource(expr("A'B + C"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const { analysis } = out;
    expect(analysis.vars).toEqual(['A', 'B', 'C']);
    expect(terms(analysis.min.text)).toEqual(["A'B", 'C']);
    expect(verify(analysis.netlists.simplified!, analysis.table).ok).toBe(true);
    expect(verify(analysis.netlists.nand!, analysis.table).ok).toBe(true);
    expect(verify(analysis.netlists.nor!, analysis.table).ok).toBe(true);
  });

  it('minimises a redundant expression and keeps the original circuit for comparison', () => {
    const out = analyzeSource(expr("AB + AB' + A'B"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.analysis.min.literalCount).toBe(2);
    const original = out.analysis.netlists.original!;
    const simplified = out.analysis.netlists.simplified!;
    expect(original.nodes.length).toBeGreaterThan(simplified.nodes.length);
  });

  it('builds from minterms with don’t-cares', () => {
    const out = analyzeSource({ mode: 'minterms', text: '1, 3, 7, 11, 15', dontCares: '0, 2, 5', numVars: 4 });
    expect(out.ok).toBe(true);
    if (out.ok) expect(verify(out.analysis.netlists.simplified!, out.analysis.table).ok).toBe(true);
  });

  it('builds from maxterms', () => {
    const out = analyzeSource({ mode: 'maxterms', text: '0, 4, 6', dontCares: '', numVars: 3 });
    expect(out.ok).toBe(true);
  });

  it('reports bad input instead of throwing, and treats blank as empty', () => {
    const bad = analyzeSource(expr('A +* B'));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.length).toBeGreaterThan(0);

    const dup = analyzeSource({ mode: 'minterms', text: '1, 1', dontCares: '', numVars: 3 });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatch(/duplicate minterm index 1/i);

    const junk = analyzeSource({ mode: 'minterms', text: '1, x', dontCares: '', numVars: 3 });
    expect(junk.ok).toBe(false);

    const blank = analyzeSource(expr('   '));
    expect(blank).toMatchObject({ ok: false, empty: true });
  });

  it('refuses more than 6 variables inline, with a pointer to Advanced input', () => {
    const out = analyzeSource(expr('A+B+C+D+E+F+G'));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/Advanced input/);
  });

  it("shows terms alphabetically, so A'B + C stays A'B + C", () => {
    const out = analyzeSource(expr("A'B + C"));
    expect(out.ok && out.analysis.min.text).toBe("A'B + C");
    expect(tidyTerms("C + A'B")).toBe("A'B + C");
    expect(tidyTerms("(A + B')(C)")).toBe("(A + B')(C)"); // POS untouched
    expect(tidyTerms('A')).toBe('A');
  });

  it('leaves no dangling gate in the NAND-only or NOR-only circuits', () => {
    const out = analyzeSource(expr("A'B + C"));
    if (!out.ok) throw new Error('setup failed');
    for (const key of ['nand', 'nor'] as const) {
      const nl = out.analysis.netlists[key]!;
      const used = new Set<string>(nl.outputs);
      for (const n of nl.nodes) if (n.kind === 'gate') n.inputs.forEach((i) => used.add(i));
      const dead = nl.nodes.filter((n) => n.kind === 'gate' && !used.has(n.output));
      expect(dead).toEqual([]);
      expect(verify(nl, out.analysis.table).ok).toBe(true);
    }
    // A'B + C needs 4 NAND gates (not 5): NOT A, NAND(A',B), NOT C-as-NAND, final NAND.
    expect(out.analysis.netlists.nand!.nodes.filter((n) => n.kind === 'gate').length).toBeLessThanOrEqual(4);
  });

  it('pruneDeadGates keeps a fully-connected netlist untouched', () => {
    const out = analyzeSource(expr('AB + C'));
    if (!out.ok) throw new Error('setup failed');
    const nl = out.analysis.netlists.simplified!;
    expect(pruneDeadGates(nl)).toBe(nl);
  });

  it('re-minimises as POS', () => {
    const sop = analyzeSource(expr("A'B + C"));
    if (!sop.ok) throw new Error('setup failed');
    const pos = analyzeTable(sop.analysis.table, sop.analysis.expr, 'POS');
    expect(pos.ok).toBe(true);
    if (pos.ok) {
      expect(pos.analysis.form).toBe('POS');
      expect(verify(pos.analysis.netlists.simplified!, pos.analysis.table).ok).toBe(true);
    }
  });

  it('applies atomically to the store and clears stale downstream reports', () => {
    useStore.getState().setFaultReport({
      total: 1, detected: 1, undetected: [], coverage: 100, minimalTestSet: [], table: [],
    });
    const source = expr("A'B + C");
    const out = analyzeSource(source);
    if (!out.ok) throw new Error('setup failed');
    applyAnalysis(out.analysis, source);
    const s = useStore.getState();
    expect(s.truthTable?.vars).toEqual(['A', 'B', 'C']);
    expect(terms(s.minResult?.text ?? '')).toEqual(["A'B", 'C']);
    expect(s.netlists.simplified).not.toBeNull();
    expect(s.faultReport).toBeNull();
    expect(s.rawInput).toBe("A'B + C");
  });
});
