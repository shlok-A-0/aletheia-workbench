import { describe, expect, it } from 'vitest';
import { quineMcCluskey } from '../engine/minimize';
import { analyzeLarge, MAX_INLINE_VARS, needsWorker, parseSource, recompute } from './analyze';
import { useStore } from '../store';

const source = (text: string) => ({ mode: 'expr' as const, text, dontCares: '', numVars: 3 });

describe('large functions', () => {
  it('parses 7 and 8 variable expressions instantly but flags them for the worker', () => {
    const seven = parseSource(source('A&B&C | D&E&F | G'));
    expect(seven.ok && seven.table.vars.length).toBe(7);
    expect(needsWorker(seven)).toBe(true);
    expect(needsWorker(parseSource(source('A&B')))).toBe(false);
    expect(MAX_INLINE_VARS).toBe(6);
    const nine = parseSource(source('A&B&C&D&E&F&G&H&I'));
    expect(nine.ok).toBe(false);
  });

  it('solves through the injected minimiser and builds every circuit variant', async () => {
    const parsed = parseSource(source('A&B&C | D&E&F | G'));
    if (!parsed.ok) throw new Error('parse failed');
    let calls = 0;
    const out = await analyzeLarge(parsed.table, parsed.expr, async (t, f) => {
      calls++;
      return quineMcCluskey(t, f);
    });
    expect(calls).toBe(1);
    expect(out.ok && out.analysis.vars).toHaveLength(7);
    expect(out.ok && out.analysis.netlists.simplified).not.toBeNull();
  });

  it('reports a worker failure instead of throwing', async () => {
    const parsed = parseSource(source('A&B&C | D&E&F | G'));
    if (!parsed.ok) throw new Error('parse failed');
    const out = await analyzeLarge(parsed.table, parsed.expr, async () => { throw new Error('worker died'); });
    expect(out).toEqual({ ok: false, empty: false, error: 'worker died' });
  });

  it('recompute keeps small edits synchronous', () => {
    const parsed = parseSource(source('A&B'));
    if (!parsed.ok) throw new Error('parse failed');
    recompute(parsed.table, parsed.expr);
    expect(useStore.getState().vars).toEqual(['A', 'B']);
  });
});
