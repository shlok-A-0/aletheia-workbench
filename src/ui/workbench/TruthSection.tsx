import { useStore } from '../../store';
import { dontCaresOf, maxtermsOf, mintermsOf } from '../../engine/boolean';
import type { TruthTable } from '../../engine/types';
import { analyzeTable, applyAnalysis } from '../../pipeline/analyze';
import { Section } from './Section';

type Out = 0 | 1 | 'x';

const fmt = (list: number[]) => (list.length ? list.join(', ') : '—');

export function TruthSection() {
  const table = useStore((s) => s.truthTable);
  const expr = useStore((s) => s.parsedExpr);

  const cycle = (index: number) => {
    if (!table) return;
    const rows = table.rows.map((row) =>
      row.index === index ? { ...row, out: (row.out === 0 ? 1 : row.out === 1 ? 'x' : 0) as Out } : row
    );
    const next: TruthTable = { vars: [...table.vars], rows };
    // Editing a cell makes the typed expression stale, so the table becomes the source.
    const out = analyzeTable(next, null);
    if (out.ok) applyAnalysis(out.analysis, null);
  };

  return (
    <Section
      id="table"
      index="02"
      label="Truth table"
      title="Every case, laid out."
      lede="Click any output to cycle 0 → 1 → don't-care. Everything below rebuilds instantly."
    >
      {!table ? (
        <p className="wb-empty">Type a function above and its truth table appears here.</p>
      ) : (
        <div className="wb-table-grid">
          <div className="wb-table-wrap" tabIndex={0} role="region" aria-label="Truth table">
            <table className="wb-table">
              <thead>
                <tr>
                  <th scope="col" className="wb-th-idx">#</th>
                  {table.vars.map((v) => (
                    <th key={v} scope="col">{v}</th>
                  ))}
                  <th scope="col" className="wb-th-out">F</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={row.index}>
                    <th scope="row" className="wb-th-idx">{row.index}</th>
                    {table.vars.map((_, i) => {
                      const bit = (row.index >> (table.vars.length - 1 - i)) & 1;
                      return <td key={i} className={bit ? 'b1' : 'b0'}>{bit}</td>;
                    })}
                    <td className="wb-td-out">
                      <button
                        type="button"
                        className={`wb-out o-${row.out}`}
                        onClick={() => cycle(row.index)}
                        aria-label={`Row ${row.index} output ${row.out === 'x' ? "don't care" : row.out}. Click to change`}
                      >
                        {row.out === 'x' ? 'X' : row.out}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="wb-facts">
            <div>
              <dt className="t-label">Minterms Σm</dt>
              <dd>{fmt(mintermsOf(table))}</dd>
            </div>
            <div>
              <dt className="t-label">Maxterms ΠM</dt>
              <dd>{fmt(maxtermsOf(table))}</dd>
            </div>
            <div>
              <dt className="t-label">Don't cares d</dt>
              <dd>{fmt(dontCaresOf(table))}</dd>
            </div>
            <div>
              <dt className="t-label">Source</dt>
              <dd>{expr ? 'Expression' : 'Table / indices'}</dd>
            </div>
          </dl>
        </div>
      )}
    </Section>
  );
}
