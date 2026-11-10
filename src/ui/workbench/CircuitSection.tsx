import { lazy, Suspense, useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../store';
import type { CircuitVariant } from '../../store/slices/circuit';
import { useResults } from '../../pipeline/useResults';
import { Section } from './Section';

// React Flow + ELK are the heaviest dependencies; load them only when needed.
const SchematicView = lazy(() => import('../schematic/SchematicView'));

const VARIANTS: { id: CircuitVariant; label: string; hint: string }[] = [
  { id: 'simplified', label: 'Simplified', hint: 'Minimal AND/OR' },
  { id: 'original', label: 'Original', hint: 'As typed' },
  { id: 'nand', label: 'NAND only', hint: 'Universal gate' },
  { id: 'nor', label: 'NOR only', hint: 'Universal gate' },
];

export function CircuitSection() {
  const results = useResults();
  const netlists = useStore((s) => s.netlists);
  const variant = useStore((s) => s.activeVariant);
  const setVariant = useStore((s) => s.setActiveVariant);
  const [inputs, setInputs] = useState<Record<string, 0 | 1>>({});

  const toggle = useCallback((name: string) => {
    setInputs((prev) => ({ ...prev, [name]: prev[name] === 1 ? 0 : 1 }));
  }, []);

  const netlist = netlists[variant] ?? results.netlist;

  // Count the circuit that is actually on screen, not always the simplified one.
  const gateTypes: Record<string, number> = {};
  for (const n of netlist?.nodes ?? []) {
    if (n.kind === 'gate') gateTypes[n.type] = (gateTypes[n.type] ?? 0) + 1;
  }

  return (
    <Section
      id="circuit"
      index="04"
      label="Circuit"
      title="Your circuit, routed."
      lede="Wires are auto-routed to avoid crossings. Click an input to flip it and watch the signal travel: lime is logic 1."
    >
      {!netlist ? (
        <p className="wb-empty">Your schematic appears here as soon as there is a function.</p>
      ) : (
        <>
          <div className="wb-toolbar">
            <div className="wb-seg wb-seg--sm" role="group" aria-label="Circuit style">
              {VARIANTS.map((v) => (
                <button key={v.id} type="button" title={v.hint} aria-pressed={variant === v.id} className={variant === v.id ? 'is-on' : undefined} onClick={() => setVariant(v.id)}>
                  {v.label}
                </button>
              ))}
            </div>
            <ul className="wb-legend" aria-label="Legend">
              <li><i className="lg lg-1" /> logic 1</li>
              <li><i className="lg lg-0" /> logic 0</li>
              <li>click an input to toggle</li>
            </ul>
          </div>

          <div className="wb-schematic">
            <Suspense fallback={<div className="sch-empty">Routing wires…</div>}>
              <SchematicView netlist={netlist} inputs={inputs} onToggleInput={toggle} />
            </Suspense>
          </div>

          <ul className="wb-gate-chips" aria-label="Gate count by type">
            {Object.entries(gateTypes).map(([type, count]) => (
              <li key={type}><span className="t-label">{type}</span><b>{count}</b></li>
            ))}
            <li className="wb-gate-link">
              <Link to="/blocks">Standard blocks: MUX, decoders, MSI realization →</Link>
            </li>
          </ul>
        </>
      )}
    </Section>
  );
}
