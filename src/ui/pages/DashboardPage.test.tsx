import { cleanup, render, screen } from '@testing-library/react';
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
  it('summarizes the current pipeline without a static example catalog', () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Design Dashboard' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Load a worked example')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save project JSON' })).toBeInTheDocument();
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
