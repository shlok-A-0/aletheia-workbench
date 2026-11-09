import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Netlist } from '../../engine/types';
import { useStore } from '../../store';
import { CostPowerPage } from './CostPowerPage';

const andCircuit: Netlist = {
  name: 'AND demo',
  inputs: ['A', 'B'],
  outputs: ['Y'],
  nodes: [{ kind: 'gate', id: 'and', type: 'AND', inputs: ['A', 'B'], output: 'Y' }],
};

function loadCircuit() {
  useStore.setState({
    netlists: { original: null, simplified: andCircuit, nand: null, nor: null },
    activeVariant: 'simplified',
    designedNetlist: null,
    parsedExpr: null,
    truthTable: null,
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  useStore.setState({ netlists: { original: null, simplified: null, nand: null, nor: null } });
});

describe('CostPowerPage', () => {
  it('shows IC packages and replaces placeholder cost after entering a price', () => {
    loadCircuit();
    render(<CostPowerPage />);
    expect(screen.getAllByText('7408')).toHaveLength(2);
    expect(screen.getAllByText('Enter library values')).toHaveLength(2);

    fireEvent.change(screen.getByRole('spinbutton', { name: '7408 unit price' }), { target: { value: '4.5' } });
    expect(screen.getByText('4.50')).toBeInTheDocument();
    expect(screen.getAllByText('Enter library values')).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('ldam.ic-library.v1') ?? '[]')).toContainEqual(
      expect.objectContaining({ part: '7408', unitPrice: 4.5 })
    );
  });

  it('renders implementation comparison including a wire-only variant', () => {
    loadCircuit();
    render(<CostPowerPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Compare implementations' }));
    expect(screen.getByText(/Gate reduction from Original to Simplified/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Gate count' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Power estimate (W)' })).toBeInTheDocument();
  });
});
