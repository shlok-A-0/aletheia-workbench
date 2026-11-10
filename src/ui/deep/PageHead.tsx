import type { ReactNode } from 'react';

interface PageHeadProps {
  /** Mono caption above the title, e.g. "03 / Timing". */
  kicker: string;
  title: string;
  sub?: string;
  children?: ReactNode;
}

/** Shared header for every deep-dive page: mono kicker, big title, one-line lede. */
export function PageHead({ kicker, title, sub, children }: PageHeadProps) {
  return (
    <header className="dp-head">
      <span className="dp-kicker t-label">{kicker}</span>
      <h1 className="dp-title">{title}</h1>
      {sub && <p className="dp-sub">{sub}</p>}
      {children}
    </header>
  );
}
