import { describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { buildContext } from './buildContext';

describe('buildContext', () => {
  it('builds a concise context from active engine results', () => {
    useStore.setState({
      rawInput: "A'B + C",
      inputMode: 'expr',
      vars: ['A', 'B', 'C'],
      truthTable: {
        vars: ['A', 'B', 'C'],
        rows: Array.from({ length: 8 }, (_, index) => ({
          index,
          inputs: [((index >> 2) & 1), ((index >> 1) & 1), (index & 1)] as (0 | 1)[],
          out: ([1, 2, 3, 5, 7].includes(index) ? 1 : 0) as 0 | 1,
        })),
      },
      minResult: {
        form: 'SOP',
        text: "A'B + C",
        termCount: 2,
        literalCount: 3,
        implicants: [],
        expr: { t: 'const', v: 0 },
        steps: Array.from({ length: 20 }, (_, index) => ({
          title: `Step ${index}`,
          detail: 'explanation',
          data: { values: Array.from({ length: 100 }, () => 'not forwarded') },
        })),
      },
    });

    const context = buildContext(useStore.getState(), '/kmap');
    expect(context.page).toBe('/kmap');
    expect(context.function?.expr).toBe("A'B + C");
    expect(context.function?.minterms).toEqual([1, 2, 3, 5, 7]);
    expect(context.minimization?.text).toBe("A'B + C");
    expect(JSON.stringify(context)).not.toContain('not forwarded');
    expect(JSON.stringify(context).length).toBeLessThan(2_000);
  });

  it('terminates when the function expression alone exceeds the size budget', () => {
    const names = Array.from({ length: 8 }, (_, index) => 'V'.repeat(300) + index);
    useStore.setState({
      rawInput: names.join(' + '),
      inputMode: 'expr',
      vars: names,
      truthTable: null,
      minResult: null,
    });
    const context = buildContext(useStore.getState(), '/');
    expect(JSON.stringify(context).length).toBeLessThan(20_000);
  });
});
