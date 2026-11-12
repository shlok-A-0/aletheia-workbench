import { lazy, Suspense, useCallback, useState } from 'react';
import { useStore } from '../../store';

const SchematicView = lazy(() => import('../schematic/SchematicView'));

/**
 * A live circuit for the function in the box, visible before the first scroll.
 * It is the real schematic: click an input to flip it, drag a gate to rearrange.
 */
export function HeroPreview() {
  const netlist = useStore((s) => s.netlists.simplified);
  const [inputs, setInputs] = useState<Record<string, 0 | 1>>({});
  const toggle = useCallback((name: string) => {
    setInputs((prev) => ({ ...prev, [name]: prev[name] === 1 ? 0 : 1 }));
  }, []);

  if (!netlist) return null;
  return (
    <aside className="wb-preview" aria-label="Live circuit preview">
      <div className="wb-preview-bar">
        <span>live circuit</span>
        <span>click inputs · drag gates</span>
      </div>
      <div className="wb-preview-body">
        <Suspense fallback={<div className="sch-empty">Routing wires…</div>}>
          <SchematicView netlist={netlist} inputs={inputs} onToggleInput={toggle} height={250} />
        </Suspense>
      </div>
    </aside>
  );
}
