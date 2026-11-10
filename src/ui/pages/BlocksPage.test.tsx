import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlocksPage } from './BlocksPage';
import { useStore } from '../../store';
import { truthTableFromMinterms } from '../../engine/boolean/truth-table';

describe('BlocksPage', () => {
  it('renders function realization mode with derivation steps and MUX sizes', () => {
    useStore.setState({
      truthTable: truthTableFromMinterms(['A', 'B', 'C'], [1, 3, 6, 7]),
    });

    render(<BlocksPage />);
    expect(screen.getByRole('heading', { name: /Building Blocks/i })).toBeInTheDocument();
    expect(screen.getByText(/Function Realization using MSI Blocks/i)).toBeInTheDocument();
    expect(screen.getByText(/Shannon Expansion Selection/i)).toBeInTheDocument();

    // Verify MUX options exist for 3 variables
    expect(screen.getByRole('button', { name: /8:1 MUX \(Full Select\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /4:1 MUX \(Select: A, B\)/i })).toBeInTheDocument();

    // Switch to Decoder + OR
    fireEvent.click(screen.getByRole('button', { name: /Decoder \+ OR Gate/i }));
    expect(screen.getByText(/Decoder Specification/i)).toBeInTheDocument();
    expect(screen.getByText(/Minterm Collection/i)).toBeInTheDocument();
  });

  it('switches to Standard MSI Library and lists pruned standard blocks without arithmetic', () => {
    render(<BlocksPage />);
    fireEvent.click(screen.getByRole('button', { name: /Standard MSI Library/i }));

    // Standard blocks present
    expect(screen.getByRole('button', { name: 'MUX 4:1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decoder 3:8' })).toBeInTheDocument();

    // Arithmetic pruned
    expect(screen.queryByRole('button', { name: 'Half adder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Full adder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ripple adder 4-bit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Comparator 4-bit' })).not.toBeInTheDocument();
  });
});
