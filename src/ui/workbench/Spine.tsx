import { useEffect, useState, type ReactElement } from 'react';
import { IconCircuit, IconInput, IconSimplify, IconTable, IconVerify } from './icons';

const SECTIONS: { id: string; label: string; Icon: (p: object) => ReactElement }[] = [
  { id: 'input', label: 'Define', Icon: IconInput },
  { id: 'table', label: 'Truth table', Icon: IconTable },
  { id: 'simplify', label: 'Simplify', Icon: IconSimplify },
  { id: 'circuit', label: 'Circuit', Icon: IconCircuit },
  { id: 'verify', label: 'Verify & export', Icon: IconVerify },
];

/** Minimal icon spine. Expands on hover/focus to show labels; jumps to sections. */
export function Spine() {
  const [active, setActive] = useState('input');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-35% 0px -55% 0px', threshold: [0, 0.01, 0.5] }
    );
    for (const { id } of SECTIONS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="wb-spine" aria-label="Sections">
      <ol>
        {SECTIONS.map(({ id, label, Icon }, i) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className={active === id ? 'is-active' : undefined}
              aria-current={active === id ? 'true' : undefined}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                history.replaceState(null, '', `#${id}`);
              }}
            >
              <Icon />
              <span className="wb-spine-label">
                <i>{String(i + 1).padStart(2, '0')}</i> {label}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
