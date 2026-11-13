import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChatPanel', () => {
  it('explains the current page through the API and annotates the answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'A prime implicant is a maximal group of adjacent 1s.' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    render(<><p>Aletheia circuit tools</p><ChatPanel open page="/kmap" pageLabel="K-Map & QM" onClose={() => {}} /></>);

    fireEvent.click(screen.getByRole('button', { name: 'Explain this page' }));
    expect(await screen.findByText(/A prime implicant is a maximal group/)).toBeInTheDocument();
    expect(screen.getByText(/AI explanation — verify with the tool's results/)).toBeInTheDocument();
    expect(screen.getByText('Aletheia circuit tools')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/chat', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"page":"/kmap"'),
    }));
  });

  it('shows a friendly offline message and leaves the rest of the app usable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<><button>Other circuit tool</button><ChatPanel open page="/circuit" pageLabel="Circuit Schematic" onClose={() => {}} /></>);

    fireEvent.click(screen.getByRole('button', { name: 'Give me a hint' }));
    expect(await screen.findByText(/study assistant is offline right now/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Other circuit tool' })).toBeEnabled();
  });

  it('offers page-specific K-map questions and supports mode selection', () => {
    render(<ChatPanel open page="/kmap" pageLabel="K-Map & QM" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Why is this group valid?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
    expect(screen.getByRole('button', { name: 'Hint' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('treats an HTML error page from a missing /api as offline instead of crashing on JSON.parse', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html><title>Not found</title>', {
      status: 404,
      headers: { 'content-type': 'text/html' },
    })));
    render(<ChatPanel open page="/kmap" pageLabel="K-Map & QM" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain this page' }));
    expect(await screen.findByText(/study assistant is offline/i)).toBeInTheDocument();
  });
});
