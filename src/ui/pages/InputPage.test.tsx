import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { InputPage } from './InputPage';

const renderPage = () => render(<MemoryRouter><InputPage /></MemoryRouter>);

describe('InputPage', () => {
  it('validates an expression and detects its variables', () => {
    renderPage();
    const box = screen.getByPlaceholderText(/A'B \+ C/);
    fireEvent.change(box, { target: { value: 'A ^ B' } });
    expect(screen.getByText(/Valid syntax/i)).toBeInTheDocument();
  });

  it('flags invalid syntax', () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/A'B \+ C/), { target: { value: 'A + (' } });
    expect(screen.queryByText(/Valid syntax/i)).not.toBeInTheDocument();
  });

  it('switches to minterm entry', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Minterms/i }));
    expect(screen.getByPlaceholderText(/1, 3, 5, 7/)).toBeInTheDocument();
  });
});
