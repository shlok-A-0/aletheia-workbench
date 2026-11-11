import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { HelpPage } from './HelpPage';

describe('HelpPage', () => {
  it('renders concepts and every internal link points at a real route', () => {
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(screen.getByText(/Karnaugh maps/i)).toBeInTheDocument();
    const valid = ['/', '/input', '/kmap', '/blocks', '/sequential', '/timing', '/cost-power', '/faults', '/dashboard', '/help', '/selftest', '/truth-table', '/circuit'];
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    for (const h of hrefs) expect(valid).toContain(h);
  });
});
