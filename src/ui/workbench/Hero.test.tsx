import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { Hero } from './Hero';

describe('Hero first load', () => {
  afterEach(() => vi.useRealTimers());

  it('builds the default function for a first-time visitor (no table yet)', () => {
    vi.useFakeTimers();
    // Fresh store: default rawInput is non-empty but nothing has been derived yet.
    useStore.setState({ truthTable: null, minResult: null });
    render(<MemoryRouter><Hero /></MemoryRouter>);
    act(() => { vi.advanceTimersByTime(50); });
    expect(useStore.getState().truthTable).not.toBeNull();
    expect(useStore.getState().minResult?.text).toBeTruthy();
  });
});
