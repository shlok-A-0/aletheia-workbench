import { lazy, Suspense, useState } from 'react';
import { useStore } from '../../store';
import { mintermsOf } from '../../engine/boolean';
import { analyzeTable, applyAnalysis } from '../../pipeline/analyze';
import { useResults } from '../../pipeline/useResults';
import { Section } from './Section';

// The full K-map / Quine–McCluskey explorer is heavy, so it loads on demand.
const KMapPage = lazy(() => import('../pages/KMapPage').then((m) => ({ default: m.KMapPage })));

export function SimplifySection() {
  const results = useResults();
  const table = useStore((s) => s.truthTable);
  const expr = useStore((s) => s.parsedExpr);
  const [showSteps, setShowSteps] = useState(false);

  const setForm = (form: 'SOP' | 'POS') => {
    if (!table || form === results.form) return;
    const out = analyzeTable(table, expr, form);
    if (out.ok) applyAnalysis(out.analysis, null);
  };

  const minterms = table ? mintermsOf(table).length : 0;

  return (
    <Section
      id="simplify"
      index="03"
      label="Simplify"
      title="The shortest form that still works."
      lede="Quine–McCluskey finds the minimal cover. Flip between sum-of-products and product-of-sums."
    >
      {!results.hasResult ? (
        <p className="wb-empty">Nothing to simplify yet.</p>
      ) : (
        <>
          <div className="wb-formula-card">
            <div className="wb-seg wb-seg--sm" role="group" aria-label="Minimisation form">
              {(['SOP', 'POS'] as const).map((f) => (
                <button key={f} type="button" aria-pressed={results.form === f} className={results.form === f ? 'is-on' : undefined} onClick={() => setForm(f)}>
                  {f}
                </button>
              ))}
            </div>
            <p className="wb-formula" aria-label={`Minimised expression ${results.formula}`}>
              <span className="wb-formula-eq">F =</span> {results.formula}
            </p>
            <ul className="wb-stats">
              <li><b>{minterms}</b><span className="t-label">minterms in</span></li>
              <li><b>{results.terms}</b><span className="t-label">{results.form === 'SOP' ? 'product terms' : 'sum terms'} out</span></li>
              <li><b>{results.literals}</b><span className="t-label">literals</span></li>
            </ul>
          </div>

          <details className="wb-details" onToggle={(e) => setShowSteps((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>
              <span>Show the K-map and every QM step</span>
              <span className="wb-details-plus" aria-hidden="true">+</span>
            </summary>
            {showSteps && (
              <div className="wb-embed">
                <Suspense fallback={<p className="wb-empty">Loading K-map…</p>}>
                  <KMapPage embedded />
                </Suspense>
              </div>
            )}
          </details>
        </>
      )}
    </Section>
  );
}
