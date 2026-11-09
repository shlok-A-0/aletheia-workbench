import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useStore } from '../../store';
import { DashboardPage } from './DashboardPage';

afterEach(() => {
  cleanup();
  useStore.getState().resetInput();
  useStore.getState().resetMinimize();
  useStore.getState().resetCircuits();
  useStore.getState().resetSequential();
  useStore.getState().resetTiming();
  useStore.getState().resetAnalysis();
});

describe('DashboardPage', () => {
  it('summarizes the current pipeline and loads a worked example', () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Design Dashboard' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Load a worked example'), { target: { value: 'odd-minterms' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
    expect(screen.getByRole('status')).toHaveTextContent('Σm(1,3,5,7) loaded.');
    expect(useStore.getState().truthTable?.rows.filter((row) => row.out === 1).map((row) => row.index))
      .toEqual([1, 3, 5, 7]);
  });

  it('renders fault coverage correctly without double-multiplying percentage', () => {
    useStore.getState().setFaultReport({
      total: 4,
      detected: 3,
      undetected: [{ net: 'n1', stuckAt: 0 }],
      coverage: 75.0,
      minimalTestSet: [[1, 0]],
      table: [],
    });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.queryByText('7500.0%')).toBeNull();
  });
});
