import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Netlist } from '../../engine/types';
import { useStore } from '../../store';
import { FaultsPage } from './FaultsPage';

const { runFaultTestInWorker } = vi.hoisted(() => ({
  runFaultTestInWorker: vi.fn(),
}));

vi.mock('../../workers/useEngineWorker', () => ({
  getEngineWorker: () => ({ runFaultTest: runFaultTestInWorker }),
}));

const andCircuit: Netlist = {
  name: 'AND demo',
  inputs: ['A', 'B'],
  outputs: ['Y'],
  nodes: [{ kind: 'gate', id: 'and', type: 'AND', inputs: ['A', 'B'], output: 'Y' }],
};

const largeCircuit: Netlist = {
  name: 'Large input demo',
  inputs: ['A', 'B', 'C', 'D', 'E', 'F'],
  outputs: ['Y'],
  nodes: [{ kind: 'gate', id: 'and', type: 'AND', inputs: ['A', 'B', 'C', 'D', 'E', 'F'], output: 'Y' }],
};

afterEach(() => {
  cleanup();
  useStore.setState({ netlists: { original: null, simplified: null, nand: null, nor: null } });
});

describe('FaultsPage', () => {
  beforeEach(() => {
    runFaultTestInWorker.mockReset();
    runFaultTestInWorker.mockResolvedValue({
      total: 0,
      detected: 0,
      undetected: [],
      coverage: 0,
      minimalTestSet: [],
      table: [],
      testVectors: [],
    });
  });

  it('reports full coverage and marks an output discrepancy when a fault is detected', () => {
    useStore.setState({
      netlists: { original: null, simplified: andCircuit, nand: null, nor: null },
      activeVariant: 'simplified',
      designedNetlist: null,
      parsedExpr: null,
      truthTable: null,
    });
    render(<FaultsPage />);
    expect(screen.getByText('100.0%')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Fault site'), { target: { value: 'Y' } });
    fireEvent.change(screen.getByLabelText('Input A'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Input B'), { target: { value: '1' } });
    expect(screen.getByText('Mismatch')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Greedy minimal test set' })).toBeInTheDocument();

    // Verify row selection and clicking in fault matrix table
    const sa1Rows = screen.getAllByText('SA1');
    expect(sa1Rows.length).toBeGreaterThan(0);
    fireEvent.click(sa1Rows[0]);
    // The active selection dot ▶ should be displayed for selected row
    expect(screen.getByText('▶')).toBeInTheDocument();
  });

  it('runs fault analysis for more than five inputs in the engine worker', async () => {
    useStore.setState({
      netlists: { original: null, simplified: largeCircuit, nand: null, nor: null },
      activeVariant: 'simplified',
      designedNetlist: null,
      parsedExpr: null,
      truthTable: null,
    });

    render(<FaultsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Running the fault analysis in the engine Web Worker');
    expect(await screen.findByRole('heading', { name: 'Fault coverage' })).toBeInTheDocument();
    expect(runFaultTestInWorker).toHaveBeenCalledWith(largeCircuit);
  });
});
