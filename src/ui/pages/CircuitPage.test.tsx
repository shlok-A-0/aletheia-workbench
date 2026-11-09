import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { parseExpr } from '../../engine/boolean';
import { exprToNetlist } from '../../engine/circuit/generate';
import { useStore } from '../../store';
import { CircuitPage } from './CircuitPage';
import { layoutNetlist } from '../circuitLayout';
import { InputPage } from './InputPage';
import { KMapPage } from './KMapPage';
import { SequentialPage } from './SequentialPage';
import { TruthTablePage } from './TruthTablePage';

function renderPage(page: ReactNode) {
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

describe('page smoke tests', () => {
  it('renders input page and reports malformed minterm indices', () => {
    renderPage(<InputPage />);
    expect(screen.getByRole('heading', { name: /Boolean Function & Input Specification/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Σm Minterms' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. 1, 3, 5, 7'), { target: { value: '1, 1' } });
    fireEvent.click(screen.getByRole('button', { name: /Analyze & Generate Truth Table/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/duplicate minterm index 1/i);
  });

  it('renders the truth-table page', () => {
    renderPage(<TruthTablePage />);
    expect(screen.getByRole('heading', { name: /Truth Table & Canonical SOP \/ POS/i })).toBeInTheDocument();
  });

  it('renders the K-map page', () => {
    renderPage(<KMapPage />);
    expect(screen.getByRole('heading', { name: /K-Map & Quine–McCluskey Minimization/i })).toBeInTheDocument();
  });

  it('renders the circuit page', () => {
    useStore.setState({ parsedExpr: null, minResult: null });
    renderPage(<CircuitPage />);
    expect(screen.getByRole('heading', { name: /Circuit Synthesis & Schematic/i })).toBeInTheDocument();
  });

  it('draws the output wire from the node driving the netlist output', () => {
    const netlist = exprToNetlist(parseExpr("A'B + C"));
    const layout = layoutNetlist(netlist, null);
    const outputWire = layout.wires.find((wire) => wire.toId === `out_${netlist.outputs[0]}`);
    const driver = netlist.nodes.find(
      (node) => node.kind === 'gate' && node.output === netlist.outputs[0]
    );
    expect(driver).toBeDefined();
    expect(outputWire?.fromId).toBe(driver?.id);
  });

  it('marks shared wire sources with junction dots', () => {
    const { container } = renderPage(<CircuitPage />);
    fireEvent.click(screen.getByRole('button', { name: /MSI Blocks/i }));

    expect(container.querySelectorAll('.wire-junction')).toHaveLength(2);
  });

  it('renders the sequential page', () => {
    renderPage(<SequentialPage />);
    expect(screen.getByRole('heading', { name: /Sequential Logic & FSM Synthesis/i })).toBeInTheDocument();
  });

  it('rebuilds direct-table rows when the variable count changes', () => {
    renderPage(<InputPage />);
    fireEvent.click(screen.getByRole('button', { name: '📊 Direct Table' }));
    fireEvent.click(screen.getByRole('button', { name: '8 (ABCDEFGH)' }));
    expect(screen.getAllByRole('row')).toHaveLength(257);
  });
});
