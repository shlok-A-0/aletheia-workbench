import type { Source, SourceMode } from '../pipeline/analyze';

const MODES: SourceMode[] = ['expr', 'minterms', 'maxterms'];
const MAX_TEXT = 400;

/** Query string (without the leading "?") that reopens this exact function. */
export function encodeShare(src: Source): string {
  const p = new URLSearchParams();
  p.set('m', src.mode);
  p.set('f', src.text);
  if (src.mode !== 'expr') {
    if (src.dontCares.trim()) p.set('d', src.dontCares);
    p.set('n', String(src.numVars));
  }
  return p.toString();
}

/** Parses a share query back into a Source, or null when it is absent or malformed. */
export function decodeShare(search: string): Source | null {
  const p = new URLSearchParams(search);
  const mode = p.get('m') as SourceMode | null;
  const text = p.get('f');
  if (!mode || !MODES.includes(mode) || text === null) return null;
  if (text.length === 0 || text.length > MAX_TEXT) return null;
  const dontCares = (p.get('d') ?? '').slice(0, MAX_TEXT);
  const rawN = p.get('n');
  const n = rawN === null ? NaN : Number(rawN);
  const numVars = Number.isInteger(n) ? Math.min(Math.max(n, 2), 8) : 3;
  return { mode, text, dontCares: mode === 'expr' ? '' : dontCares, numVars };
}

export function shareUrl(src: Source, origin = window.location.origin): string {
  return `${origin}/?${encodeShare(src)}`;
}
