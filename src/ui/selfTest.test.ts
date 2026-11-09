import { describe, expect, it } from 'vitest';
import { runSystemSelfTests } from './selfTest';

describe('system self-test', () => {
  it('passes every deterministic golden pipeline check', () => {
    const results = runSystemSelfTests();
    expect(results.length).toBeGreaterThanOrEqual(6);
    expect(results.filter((result) => !result.passed)).toEqual([]);
  });
});
