import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, shareUrl } from './share';

describe('share links', () => {
  it('round-trips an expression, including quotes, plus and caret', () => {
    const src = { mode: 'expr' as const, text: "A'B + C ^ (D*E)", dontCares: '', numVars: 3 };
    expect(decodeShare(encodeShare(src))).toEqual(src);
  });
  it('round-trips minterms with don\'t cares and var count', () => {
    const src = { mode: 'minterms' as const, text: '1, 3, 5, 7', dontCares: '0, 2', numVars: 4 };
    expect(decodeShare(`?${encodeShare(src)}`)).toEqual(src);
  });
  it('rejects missing, unknown or oversized input', () => {
    expect(decodeShare('')).toBeNull();
    expect(decodeShare('?m=evil&f=A')).toBeNull();
    expect(decodeShare('?m=expr')).toBeNull();
    expect(decodeShare(`?m=expr&f=${'A'.repeat(500)}`)).toBeNull();
  });
  it('clamps the variable count', () => {
    expect(decodeShare('?m=minterms&f=1&n=99')?.numVars).toBe(6);
    expect(decodeShare('?m=minterms&f=1&n=1')?.numVars).toBe(2);
  });
  it('builds a full URL', () => {
    expect(shareUrl({ mode: 'expr', text: 'A+B', dontCares: '', numVars: 2 }, 'https://x.test')).toBe('https://x.test/?m=expr&f=A%2BB');
  });
});
