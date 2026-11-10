import { useResults } from '../../pipeline/useResults';

/**
 * Persistent result rail. The payoff (minimised expression, gate count,
 * verification) is visible from every scroll position.
 */
export function ResultRail() {
  const r = useResults();

  return (
    <div className="wb-rail" role="status" aria-live="polite" aria-label="Current result">
      <div className="wb-rail-inner">
        <div className="wb-rail-cell wb-rail-formula">
          <span className="t-label">{r.outputName} =</span>
          <code className="wb-rail-expr" title={r.formula}>
            {r.hasResult ? r.formula : '—'}
          </code>
        </div>
        <div className="wb-rail-cell">
          <span className="t-label">Gates</span>
          <b className="wb-rail-num">{r.hasResult ? r.gateCount : '–'}</b>
        </div>
        <div className="wb-rail-cell">
          <span className="t-label">Literals</span>
          <b className="wb-rail-num">{r.literals ?? '–'}</b>
        </div>
        <div
          className={`wb-badge is-${r.verdict}`}
          title={
            r.verdict === 'verified'
              ? `Circuit matches all ${r.rows} truth-table rows`
              : r.verdict === 'failed'
                ? `Mismatch on rows ${r.mismatches.slice(0, 8).join(', ')}`
                : 'Waiting for a function'
          }
        >
          <span className="wb-badge-dot" aria-hidden="true" />
          {r.verdict === 'verified' ? 'Verified' : r.verdict === 'failed' ? 'Mismatch' : 'No result'}
        </div>
      </div>
    </div>
  );
}
