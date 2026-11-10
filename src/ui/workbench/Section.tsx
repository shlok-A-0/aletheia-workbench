import type { ReactNode } from 'react';
import { useReveal } from './useReveal';

interface SectionProps {
  id: string;
  index: string;
  label: string;
  title: string;
  /** One calm line under the title. */
  lede?: string;
  children: ReactNode;
}

/** Every workbench section: mono index + label, big quiet title, content. */
export function Section({ id, index, label, title, lede, children }: SectionProps) {
  const ref = useReveal<HTMLElement>();
  return (
    <section id={id} ref={ref} className="wb-section reveal" aria-labelledby={`${id}-title`}>
      <header className="wb-section-head">
        <p className="t-label">
          <span className="wb-index">{index}</span> / {label}
        </p>
        <h2 id={`${id}-title`} className="wb-title glitch" data-text={title}>
          {title}
        </h2>
        {lede && <p className="wb-lede">{lede}</p>}
      </header>
      {children}
    </section>
  );
}
