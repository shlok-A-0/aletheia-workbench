import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TimingPage } from './TimingPage';

describe('TimingPage', () => {
  it('renders the timing controls and starts a preset simulation', () => {
    render(<MemoryRouter><TimingPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /Timing Diagrams & Hazards/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(screen.getByRole('img', { name: /Digital signal timing waveforms/i })).toBeInTheDocument();
    expect(screen.getByText(/State sequence/i)).toBeInTheDocument();
  });

  it('loads the hazard preset with a consensus-term suggestion', () => {
    render(<MemoryRouter><TimingPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Preset'), { target: { value: 'hazard' } });
    expect(screen.getByText(/Suggested consensus term:/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(screen.getByText(/glitches remain visible/i)).toBeInTheDocument();
  });

  it('shows the sequence-detector output for the 1011 preset', () => {
    render(<MemoryRouter><TimingPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Preset'), { target: { value: 'detector' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    fireEvent.change(screen.getByRole('slider', { name: /Cursor/ }), { target: { value: '80' } });
    expect(screen.getByTestId('timing-value-Z')).toHaveTextContent('Z=1');
  });

  it('shows the shifted word for the SIPO preset', () => {
    render(<MemoryRouter><TimingPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Preset'), { target: { value: 'shift' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    fireEvent.change(screen.getByRole('slider', { name: /Cursor/ }), { target: { value: '61' } });
    expect(screen.getByTestId('timing-value-Q2')).toHaveTextContent('Q2=1');
    expect(screen.getByTestId('timing-value-Q1')).toHaveTextContent('Q1=1');
    expect(screen.getByTestId('timing-value-Q0')).toHaveTextContent('Q0=0');
  });
});
