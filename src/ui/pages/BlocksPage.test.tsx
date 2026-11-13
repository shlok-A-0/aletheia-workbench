import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BlocksPage } from './BlocksPage';
import { useStore } from '../../store';
import { fullAdder } from '../../engine/circuit/blocks';
import { truthTableOfNetlist } from '../../engine/circuit/simulate';
import { truthTableFromMinterms } from '../../engine/boolean/truth-table';

describe('BlocksPage', () => {
  it('renders function realization mode with derivation steps and MUX sizes', () => {
    useStore.setState({
      truthTable: truthTableFromMinterms(['A', 'B', 'C'], [1, 3, 6, 7]),
    });

    render(<MemoryRouter><BlocksPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /Building Blocks/i })).toBeInTheDocument();
    expect(screen.getByText(/Function Realization using MSI Blocks/i)).toBeInTheDocument();
    expect(screen.getByText(/Shannon Expansion Selection/i)).toBeInTheDocument();

    // Verify MUX options exist for 3 variables
    expect(screen.getByRole('option', { name: /8:1 · 74151/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /4:1 · 74153/i })).toBeInTheDocument();

    // A 4:1 mux on 3 variables lets the student choose which two variables drive the select lines.
    fireEvent.change(screen.getByLabelText('Size · IC'), { target: { value: '2' } });
    const lines = screen.getByLabelText('Select lines');
    expect(screen.getByRole('option', { name: 'A, C' })).toBeInTheDocument();
    fireEvent.change(lines, { target: { value: '1' } });
    expect(screen.getByText(/select = \{A, C\}/i)).toBeInTheDocument();

    // Switch to Decoder + OR
    fireEvent.change(screen.getByLabelText('Block'), { target: { value: 'decoder' } });
    expect(screen.getByText(/Decoder Specification/i)).toBeInTheDocument();
    expect(screen.getByText(/Minterm Collection/i)).toBeInTheDocument();
  });

  it('switches to Standard MSI Library and lists pruned standard blocks without arithmetic', () => {
    render(<MemoryRouter><BlocksPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Parts library/i }));

    // Standard blocks present
    expect(screen.getByRole('button', { name: 'MUX 4:1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decoder 3:8' })).toBeInTheDocument();

    // Arithmetic pruned
    expect(screen.queryByRole('button', { name: 'Half adder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Full adder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ripple adder 4-bit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Comparator 4-bit' })).not.toBeInTheDocument();
  });

  it('provides toggling between textbook MSI block diagram and gate-level expansion', () => {
    useStore.setState({
      truthTable: truthTableFromMinterms(['A', 'B', 'C'], [1, 3, 6, 7]),
    });

    render(<MemoryRouter><BlocksPage /></MemoryRouter>);
    const blockBtn = screen.getByRole('button', { name: /Block diagram/i });
    const gateBtn = screen.getByRole('button', { name: /Gate level/i });
    expect(blockBtn).toBeInTheDocument();
    expect(gateBtn).toBeInTheDocument();

    // Default is block diagram
    expect(screen.getByText(/Figure: /i)).toBeInTheDocument();
    expect(screen.getByText(/Multiplexer Realization/i)).toBeInTheDocument();

    // Toggle to gate-level
    fireEvent.click(gateBtn);
    expect(gateBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('realizes with an active-low decoder + NAND and shows it at gate level', () => {
    useStore.setState({ truthTable: truthTableFromMinterms(['A', 'B', 'C'], [1, 3, 6, 7]) });
    render(<MemoryRouter><BlocksPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Block'), { target: { value: 'decoder' } });
    fireEvent.change(screen.getByLabelText('Outputs'), { target: { value: 'nand' } });
    expect(screen.getByText(/Active-low decoder/i, { selector: 'summary ~ * *, h3, b, strong, p, span' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Block diagram' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gate level' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lets a multi-output design pick an output and realize all of them with one demux', () => {
    const adder = fullAdder();
    useStore.setState({
      truthTable: truthTableOfNetlist(adder, undefined, 0),
      netlists: { original: null, simplified: adder, nand: null, nor: null },
    });
    render(<MemoryRouter><BlocksPage /></MemoryRouter>);
    expect(screen.getByLabelText('Output')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/2 outputs/i);

    fireEvent.change(screen.getByLabelText('Output'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Block'), { target: { value: 'demux' } });
    expect(screen.getByRole('note')).toHaveTextContent(/shared demultiplexer/i);
    expect(screen.getByRole('img', { name: /demultiplexer.*2 output OR gates/i })).toBeInTheDocument();
    // outputs are listed in the live result panel
    for (const name of adder.outputs) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
  });
});

