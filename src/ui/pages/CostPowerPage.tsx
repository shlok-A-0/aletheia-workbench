import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Expr, Netlist, TruthTable } from '../../engine/types';
import {
  DEFAULT_IC_LIBRARY,
  activityFromSequence,
  compare,
  dynamicPower,
  mapToICs,
  minResultToNetlist,
  quineMcCluskey,
  staticPower,
  toNandOnly,
  toNorOnly,
  transistorCount,
  type ICDefinition,
  type ICLibrary,
} from '../../engine';
import type { ComparisonRow } from '../../engine/analysis/optimize';
import { exprToNetlist } from '../../engine/circuit/generate';
import { useStore } from '../../store';
import { PageHead } from '../deep/PageHead';

const STORAGE_KEY = 'ldam.ic-library.v1';

function isLibrary(value: unknown): value is ICLibrary {
  return Array.isArray(value) && value.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const item = entry as ICDefinition;
    const validValue = (candidate: unknown) => candidate === null ||
      (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0);
    return typeof item.part === 'string' &&
      Array.isArray(item.gates) &&
      validValue(item.unitPrice) &&
      validValue(item.iccTypicalA);
  });
}

function loadLibrary(): { library: ICLibrary; error: string } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { library: DEFAULT_IC_LIBRARY, error: '' };
    const parsed: unknown = JSON.parse(stored);
    if (!isLibrary(parsed)) throw new Error('Saved IC library data has an invalid format.');
    const savedByPart = new Map(parsed.map((ic) => [ic.part, ic]));
    return {
      library: DEFAULT_IC_LIBRARY.map((ic) => {
        const saved = savedByPart.get(ic.part);
        return saved ? { ...ic, unitPrice: saved.unitPrice, iccTypicalA: saved.iccTypicalA } : ic;
      }),
      error: '',
    };
  } catch (error) {
    return {
      library: DEFAULT_IC_LIBRARY,
      error: `Could not load the saved IC library: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function canonicalSop(table: TruthTable): Expr {
  const terms: Expr[] = table.rows.filter((row) => row.out === 1).map((row) => ({
    t: 'and',
    args: table.vars.map((name, index): Expr => row.inputs[index] === 1
      ? { t: 'var', name }
      : { t: 'not', a: { t: 'var', name } }),
  }));
  if (terms.length === 0) return { t: 'const', v: 0 };
  if (terms.length === 1) return terms[0];
  return { t: 'or', args: terms };
}

function inputCircuit(parsed: Expr | null, table: TruthTable | null): Netlist | null {
  if (parsed) return exprToNetlist(parsed, { name: 'input_circuit' });
  if (table) return minResultToNetlist(quineMcCluskey(table));
  return null;
}

function netlistsForComparison(
  known: Record<'original' | 'simplified' | 'nand' | 'nor', Netlist | null>,
  parsed: Expr | null,
  table: TruthTable | null,
  fallback: Netlist | null
): { name: string; netlist: Netlist }[] {
  const original = known.original ?? (table
    ? exprToNetlist(canonicalSop(table), { name: 'original' })
    : parsed ? exprToNetlist(parsed, { name: 'original' }) : fallback);
  const simplified = known.simplified ?? (table
    ? minResultToNetlist(quineMcCluskey(table))
    : parsed ? exprToNetlist(parsed, { name: 'simplified' }) : fallback);
  if (!original || !simplified) return [];
  if ([original, simplified].some((netlist) => netlist.nodes.some((node) => node.kind === 'block'))) {
    return [];
  }
  return [
    { name: 'Original', netlist: original },
    { name: 'Simplified', netlist: simplified },
    { name: 'NAND', netlist: known.nand ?? toNandOnly(simplified) },
    { name: 'NOR', netlist: known.nor ?? toNorOnly(simplified) },
  ];
}

function saveLibrary(library: ICLibrary): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}

function PackageDiagram({ ic, unused }: { ic: ICDefinition; unused: number }) {
  const half = ic.pins / 2;
  const leftPins = Array.from({ length: half }, (_, index) => index + 1);
  const rightPins = Array.from({ length: half }, (_, index) => ic.pins - index);
  return (
    <div className="ic-package" aria-label={`${ic.part} ${ic.pins}-pin package`}>
      <div className="ic-pin-column">{leftPins.map((pin) => <span key={pin}>{pin}</span>)}</div>
      <div className="ic-package-body">
        <strong>{ic.part}</strong>
        {ic.gates.map((gate) => (
          <span className="ic-gate-group" key={`${gate.type}-${gate.inputs}`}>
            {gate.count} × {gate.type}{gate.inputs}
          </span>
        ))}
        {unused > 0 && <span className="ic-gate-group unused">{unused} unused</span>}
      </div>
      <div className="ic-pin-column">{rightPins.map((pin) => <span key={pin}>{pin}</span>)}</div>
    </div>
  );
}

function MetricChart({ title, rows, field, best }: {
  title: string;
  rows: ComparisonRow[];
  field: 'gates' | 'ics' | 'cost' | 'powerW';
  best?: string;
}) {
  const numeric = rows.map((row) => row[field]).filter((value): value is number => typeof value === 'number');
  const max = Math.max(1, ...numeric);
  return (
    <div className="p6-chart">
      <h4>{title}</h4>
      {rows.map((row) => {
        const value = row[field];
        return (
          <div className="p6-chart-row" key={row.name}>
            <span>{row.name}</span>
            <div className="p6-chart-track">
              {typeof value === 'number' && <i style={{ width: `${Math.max(2, (value / max) * 100)}%` }} />}
            </div>
            <strong>{typeof value === 'number' ? Number(value.toPrecision(3)).toString() : '—'}</strong>
            {best?.split(', ').includes(row.name) && <span className="p6-best-badge">Best</span>}
          </div>
        );
      })}
    </div>
  );
}

export function CostPowerPage() {
  const state = useStore();
  const setCostReport = useStore((store) => store.setCostReport);
  const setPowerReport = useStore((store) => store.setPowerReport);
  const [initialLibrary] = useState(loadLibrary);
  const [library, setLibrary] = useState(initialLibrary.library);
  const [libraryError, setLibraryError] = useState(initialLibrary.error);
  const [tab, setTab] = useState<'cost' | 'compare'>('cost');
  const [vcc, setVcc] = useState(5);
  const [vdd, setVdd] = useState(5);
  const [freqHz, setFreqHz] = useState(1e6);
  const [capPf, setCapPf] = useState(10);

  const currentNetlist = state.netlists[state.activeVariant] ?? state.designedNetlist ??
    inputCircuit(state.parsedExpr, state.truthTable);
  const mappingResult = useMemo(() => {
    if (!currentNetlist) return { report: null, error: '' };
    try {
      return { report: mapToICs(currentNetlist, library, { preferBlocks: true }), error: '' };
    } catch (error) {
      return { report: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [currentNetlist, library]);
  const report = mappingResult.report;
  const activityResult = useMemo(() => {
    if (!currentNetlist) return { activity: {}, error: '' };
    try {
      if (currentNetlist.nodes.some((node) => node.kind === 'block')) {
        throw new Error('Dynamic power estimation requires an expanded gate-level netlist.');
      }
      const vectorCount = 1 << Math.min(currentNetlist.inputs.length, 8);
      const sequence = Array.from({ length: vectorCount }, (_, index) =>
        Object.fromEntries(currentNetlist.inputs.map((net, bit) => [
          net,
          ((index >> (currentNetlist.inputs.length - bit - 1)) & 1) as 0 | 1,
        ]))
      );
      return { activity: activityFromSequence(currentNetlist, sequence), error: '' };
    } catch (error) {
      return { activity: {}, error: error instanceof Error ? error.message : String(error) };
    }
  }, [currentNetlist]);
  const activity = activityResult.activity;
  const dynamicResult = useMemo(() => {
    if (!currentNetlist || activityResult.error) return { value: null, error: activityResult.error };
    try {
      return {
        value: dynamicPower(currentNetlist, activity, { vdd, freqHz, defaultCapF: capPf * 1e-12 }),
        error: '',
      };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [currentNetlist, activity, activityResult.error, vdd, freqHz, capPf]);
  const dynamic = dynamicResult.value;
  const staticW = report ? staticPower(report, vcc, library) : undefined;
  const transistorResult = useMemo(() => {
    if (!currentNetlist) return { value: null, error: '' };
    try {
      return { value: transistorCount(currentNetlist), error: '' };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [currentNetlist]);
  const variants = netlistsForComparison(state.netlists, state.parsedExpr, state.truthTable, currentNetlist);
  const comparisonResult = useMemo(() => {
    if (variants.length === 0) return { value: null, error: '' };
    try {
      return {
        value: compare(variants, {
          library,
          power: { vdd, freqHz, defaultCapF: capPf * 1e-12 },
          vcc,
        }),
        error: '',
      };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [variants, library, vdd, freqHz, capPf, vcc]);
  const comparison = comparisonResult.value;

  useEffect(() => {
    setCostReport(report);
    setPowerReport(currentNetlist && dynamic ? {
      staticW,
      dynamicW: dynamic.total,
      totalW: staticW === undefined ? undefined : staticW + dynamic.total,
      transistors: transistorResult.value ?? 0,
      perNet: dynamic.perNet,
      assumptions: { vcc, freqHz, defaultCapF: capPf * 1e-12 },
    } : null);
  }, [report, currentNetlist, dynamic, staticW, transistorResult.value, vcc, freqHz, capPf, setCostReport, setPowerReport]);

  function updateValue(part: string, key: 'unitPrice' | 'iccTypicalA', rawValue: string) {
    const value = rawValue.trim() === '' ? null : Number(rawValue);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setLibraryError(`${key === 'unitPrice' ? 'Unit price' : 'Typical supply current'} must be a non-negative number or blank.`);
      return;
    }
    const updated = library.map((ic) => ic.part === part ? { ...ic, [key]: value, source: 'user-entered' } : ic);
    try {
      saveLibrary(updated);
      setLibrary(updated);
      setLibraryError('');
    } catch (error) {
      setLibraryError(`Could not save the IC library: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function exportLibrary() {
    const blob = new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'aletheia-ic-library.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function onNumberChange(setter: (value: number) => void) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      if (Number.isFinite(value) && value >= 0) setter(value);
    };
  }

  return (
    <div className="page-container dp">
      <PageHead kicker="03 / Cost and power" title="IC Mapping, Cost & Power" sub="Estimate a parts list and compare implementation cost, switching power, and gate count." />

      <div className="p6-tab-row" role="tablist" aria-label="IC cost, power, and comparison">
        <button role="tab" aria-selected={tab === 'cost'} onClick={() => setTab('cost')}>Cost &amp; Power</button>
        <button role="tab" aria-selected={tab === 'compare'} onClick={() => setTab('compare')}>Compare implementations</button>
      </div>

      {tab === 'cost' ? (
        <>
          <section className="glass-card p6-library-card">
            <div className="card-header">
              <h3>Editable 74-series IC library</h3>
              <button type="button" onClick={exportLibrary}>Export JSON</button>
            </div>
            <p>Values are placeholders; enter typical ICC from a datasheet and unit prices from a supplier catalogue. Blank values remain unknown.</p>
            {libraryError && <p className="p6-error" role="alert">{libraryError}</p>}
            <div className="table-wrapper">
              <table className="ldam-table">
                <thead><tr><th>Part</th><th>Description</th><th>Pins</th><th>ICC typical (A)</th><th>Unit price</th></tr></thead>
                <tbody>
                  {library.map((ic) => (
                    <tr key={ic.part}>
                      <td>{ic.part}</td><td>{ic.description}</td><td>{ic.pins}</td>
                      <td><input aria-label={`${ic.part} typical ICC`} type="number" min="0" step="any" value={ic.iccTypicalA ?? ''} onChange={(event) => updateValue(ic.part, 'iccTypicalA', event.target.value)} /></td>
                      <td><input aria-label={`${ic.part} unit price`} type="number" min="0" step="any" value={ic.unitPrice ?? ''} onChange={(event) => updateValue(ic.part, 'unitPrice', event.target.value)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="glass-card">
            <div className="card-header"><h3>Parts list and package diagram</h3></div>
            {mappingResult.error && <p className="p6-error" role="alert">{mappingResult.error}</p>}
            {!currentNetlist || !report ? (
              <p>{currentNetlist ? 'Mapping is unavailable for this netlist.' : 'Define a function in the workbench first, then its parts list appears here.'}</p>
            ) : (
              <>
                <p>Design: <strong>{currentNetlist.name}</strong></p>
                <div className="p6-stat-grid">
                  <div><span>Total ICs</span><strong>{report.totalICs}</strong></div>
                  <div><span>Total pins</span><strong>{report.totalPins}</strong></div>
                  <div><span>Estimated cost</span><strong>{report.totalCost === undefined ? 'Enter library values' : report.totalCost.toFixed(2)}</strong></div>
                  <div><span>Transistors</span><strong>{transistorResult.value ?? 'Unavailable'}</strong><small>{transistorResult.error || 'approximate model'}</small></div>
                </div>
                <div className="p6-package-grid">
                  {report.ics.flatMap((entry) => Array.from({ length: entry.count }, (_, index) => {
                    const ic = library.find((candidate) => candidate.part === entry.part)!;
                    const capacity = ic.gates.reduce((sum, gate) => sum + gate.count, 0);
                    const unused = Math.max(0, entry.unusedGates - index * capacity);
                    return <PackageDiagram key={`${entry.part}-${index}`} ic={ic} unused={unused} />;
                  }))}
                </div>
                <ul className="p6-notes">{report.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
              </>
            )}
          </section>

          <section className="glass-card">
            <div className="card-header"><h3>Power estimate</h3></div>
            {dynamicResult.error && <p className="p6-error" role="alert">{dynamicResult.error}</p>}
            <p className="p6-formula"><strong>Dynamic:</strong> P = Σ α × C × Vdd² × f. All results are estimates under the assumptions shown.</p>
            <div className="p6-control-grid">
              <label>Vcc (V)<input aria-label="Vcc volts" type="number" min="0" value={vcc} onChange={onNumberChange(setVcc)} /></label>
              <label>Vdd (V)<input aria-label="Vdd volts" type="number" min="0" value={vdd} onChange={onNumberChange(setVdd)} /></label>
              <label>Frequency (Hz)<input aria-label="Frequency hertz" type="number" min="0" value={freqHz} onChange={onNumberChange(setFreqHz)} /></label>
              <label>Default capacitance (pF)<input aria-label="Default capacitance picofarads" type="number" min="0" value={capPf} onChange={onNumberChange(setCapPf)} /></label>
            </div>
            <div className="p6-stat-grid">
              <div><span>Static power (Vcc × Σ count × ICC)</span><strong>{staticW === undefined ? 'Enter library values' : `${(staticW * 1e3).toPrecision(3)} mW`}</strong></div>
              <div><span>Dynamic switching estimate</span><strong>{dynamic ? `${(dynamic.total * 1e6).toPrecision(3)} µW` : '—'}</strong></div>
              <div><span>Activity factor source</span><strong>Binary input-vector order</strong></div>
            </div>
            <p className="p6-assumptions">Assumptions: Vcc {vcc} V; Vdd {vdd} V; {freqHz} Hz; default capacitance {capPf} pF; α is measured as rising transitions per applied vector/cycle; transistor figures are approximate.</p>
          </section>
        </>
      ) : (
        <section className="glass-card">
          <div className="card-header"><h3>Implementation comparison</h3></div>
          {comparisonResult.error && <p className="p6-error" role="alert">{comparisonResult.error}</p>}
          {!comparison ? <p>{currentNetlist?.nodes.some((node) => node.kind === 'block')
            ? 'Comparison requires expanded gate-level netlists; raw block variants are not compared.'
            : 'Generate a circuit from an input or truth table first.'}</p> : (
            <>
              {(() => {
                const original = comparison.rows.find((row) => row.name === 'Original')?.gates ?? 0;
                const simplified = comparison.rows.find((row) => row.name === 'Simplified')?.gates ?? 0;
                const reduction = original === 0 ? 0 : ((original - simplified) / original) * 100;
                return <p className="p6-reduction">Gate reduction from Original to Simplified: <strong>{reduction.toFixed(1)}%</strong></p>;
              })()}
              <div className="p6-chart-grid">
                <MetricChart title="Gate count" rows={comparison.rows} field="gates" best={comparison.best.gates} />
                <MetricChart title="IC packages" rows={comparison.rows} field="ics" best={comparison.best.ics} />
                <MetricChart title="Estimated cost" rows={comparison.rows} field="cost" best={comparison.best.cost} />
                <MetricChart title="Power estimate (W)" rows={comparison.rows} field="powerW" best={comparison.best.power} />
              </div>
              <div className="table-wrapper">
                <table className="ldam-table">
                  <thead><tr><th>Variant</th><th>Gates</th><th>Gate inputs</th><th>Levels</th><th>ICs</th><th>Pins</th><th>Cost</th><th>Transistors</th></tr></thead>
                  <tbody>{comparison.rows.map((row) => (
                    <tr key={row.name}><td>{row.name}</td><td>{row.gates}</td><td>{row.gateInputs}</td><td>{row.levels}</td><td>{row.ics}</td><td>{row.pins}</td><td>{row.cost ?? 'Enter library values'}</td><td>{row.transistors}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
