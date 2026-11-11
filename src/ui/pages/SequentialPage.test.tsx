import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SequentialPage } from './SequentialPage';

const renderPage = () => render(<MemoryRouter><SequentialPage /></MemoryRouter>);

describe('SequentialPage', () => {
  it('opens on flip-flops and shows the characteristic equation', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Sequential Logic/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Flip-Flops$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Characteristic equation/i)).toBeInTheDocument();
  });

  it('Pulse clock advances the flip-flop and Reset clears it', () => {
    renderPage();
    const pulse = screen.getByRole('button', { name: /Pulse clock/i });
    fireEvent.click(pulse);
    expect(screen.getByRole('button', { name: /Pulse clock · 1/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('button', { name: /^Pulse clock$/i })).toBeInTheDocument();
  });

  it('switches between all four tabs', () => {
    renderPage();
    for (const tab of [/Counters & Registers/, /FSM Designer/, /Analyze Circuit/, /^Flip-Flops$/]) {
      fireEvent.click(screen.getByRole('button', { name: tab }));
      expect(screen.getByRole('button', { name: tab })).toHaveAttribute('aria-pressed', 'true');
    }
  });
});
