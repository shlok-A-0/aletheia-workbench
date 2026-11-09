import { describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { EXAMPLES, loadExample } from './examples';

describe('worked examples', () => {
  it('loads every documented example into the shared store', () => {
    for (const example of EXAMPLES) {
      const route = loadExample(example.id);
      const state = useStore.getState();
      expect(route).toMatch(/^\//);
      expect(state.rawInput).toContain('Example:');
      expect(state.netlists.simplified || state.stateTable).toBeTruthy();
    }
  });
});
