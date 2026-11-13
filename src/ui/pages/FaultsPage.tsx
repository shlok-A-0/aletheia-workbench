import { useEffect, useMemo, useState } from 'react';
import type { Expr, Netlist, TruthTable } from '../../engine/types';
import {
  exprToNetlist,
  minResultToNetlist,
  quineMcCluskey,
  runFaultTest,
  simulateWithFault,
  type FaultReport,
} from '../../engine';
import { useStore } from '../../store';
import { getEngineWorker } from '../../workers/useEngineWorker';
import { Link } from 'react-router-dom';
import { PageHead } from '../deep/PageHead';

const NO_INPUTS: string[] = [];

function getInputNetlist(
  netlists: Record<'original' | 'simplified' | 'nand' | 'nor', Netlist | null>,
  activeVariant: 'original' | 'simplified' | 'nand' | 'nor',
  designed: Netlist | null,
  parsed: Expr | null,
  table: TruthTable | null
): Netlist | null {
  if (netlists[activeVariant]) return netlists[activeVariant];
  if (designed) return designed;
  if (parsed) return exprToNetlist(parsed, { name: 'input_circuit' });
  if (table) return minResultToNetlist(quineMcCluskey(table));
  return null;
}

export function FaultsPage() {
  const state = useStore();
  const setFaultReport = useStore((store) => store.setFaultReport);
  const netlist = useMemo(
    () => getInputNetlist(state.netlists, state.activeVariant, state.designedNetlist, state.parsedExpr, state.truthTable),
    [state.netlists, state.activeVariant, state.designedNetlist, state.parsedExpr, state.truthTable]
  );
  const [selectedNet, setSelectedNet] = useState('');
  const [stuckAt, setStuckAt] = useState<0 | 1>(0);
  const [vector, setVector] = useState<(0 | 1)[]>([]);
  const [workerReport, setWorkerReport] = useState<{
    netlist: Netlist;
    report: FaultReport | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!netlist || netlist.inputs.length <= 5) return;
    let current = true;
    void Promise.resolve()
      .then(() => getEngineWorker().runFaultTest(netlist))
      .then((report) => {
        if (current) setWorkerReport({ netlist, report, error: '' });
      })
      .catch((error: unknown) => {
        if (current) setWorkerReport({
          netlist,
          report: null,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => { current = false; };
  }, [netlist]);
  const backgroundReport = workerReport?.netlist === netlist ? workerReport : null;
  const reportResult = useMemo((): { report: FaultReport | null; error: string; loading: boolean } => {
    if (!netlist) return { report: null, error: '', loading: false };
    if (netlist.inputs.length > 5) {
      return backgroundReport
        ? { report: backgroundReport.report, error: backgroundReport.error, loading: false }
        : { report: null, error: '', loading: true };
    }
    try {
      return { report: runFaultTest(netlist), error: '', loading: false };
    } catch (error) {
      return { report: null, error: error instanceof Error ? error.message : String(error), loading: false };
    }
  }, [netlist, backgroundReport]);
  const report = reportResult.report;
  const effectiveNet = selectedNet || report?.table[0]?.net || '';
  const fault = report?.table.find((entry) => entry.net === effectiveNet && entry.stuckAt === stuckAt)
    ?? report?.table.find((entry) => entry.stuckAt === stuckAt)
    ?? report?.table[0];
  const inputs = netlist?.inputs ?? NO_INPUTS;
  const normalizedVector = inputs.map((_, index) => vector[index] ?? 0);

  useEffect(() => {
    setFaultReport(report);
  }, [report, setFaultReport]);

  const discrepancy = useMemo(() => {
    if (!netlist || !fault) return null;
    if (netlist.nodes.some((node) => node.kind === 'ff')) return { sequential: true as const };
    try {
      const inputMap = Object.fromEntries(inputs.map((net, index) => [net, normalizedVector[index]]));
      const good = simulateWithFault(netlist, { net: '', stuckAt: 0 }, inputMap);
      const faulty = simulateWithFault(netlist, fault, inputMap);
      return { good, faulty };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [netlist, fault, inputs, normalizedVector]);

  function updateInput(index: number, value: 0 | 1) {
    setVector((previous) => {
      const next = inputs.map((_, bit) => previous[bit] ?? 0);
      next[index] = value;
      return next;
    });
  }

  if (!netlist) {
    return (
      <div className="page-container dp">
        <PageHead kicker="05 / Faults" title="Fault Testing & Test Vectors" sub="Detect stuck-at faults and find a compact set of test vectors." />
        <section className="dp-panel dp-empty"><p>Nothing to test yet. Define a function and its circuit appears here.</p><Link className="btn-primary" to="/">Open the workbench</Link></section>
      </div>
    );
  }

  return (
    <div className="page-container dp">
      <PageHead kicker="05 / Faults" title="Fault Testing & Test Vectors" sub="Stuck-at-0/1 injection, output discrepancy, fault coverage, and greedy test-set reduction." />
      {reportResult.error && <p className="p6-error" role="alert">{reportResult.error}</p>}
      {reportResult.loading && <p className="dp-panel" role="status" aria-busy="true">Running the fault analysis in the engine Web Worker…</p>}
      {report && (
        <>
          <section className="dp-panel">
            <div className="dp-panel-head">
              <div>
                <h3 className="dp-h2">Inject a stuck-at fault</h3>
                <p className="dp-muted">
                  A stuck-at fault pretends one wire is welded to 0 or 1. Fault sites are every input and every gate
                  output, because any of those wires can fail. Pick a site and an input pattern: if the output differs
                  from the healthy circuit, that pattern detects the fault.
                </p>
              </div>
            </div>
            <div className="dp-toolbar">
              <label className="dp-field">
                <span className="t-label">Fault site</span>
                <select value={fault?.net ?? selectedNet} onChange={(event) => setSelectedNet(event.target.value)}>
                  {report.table.filter((entry) => entry.stuckAt === 0).map((entry) => <option key={entry.net} value={entry.net}>{entry.net}</option>)}
                </select>
              </label>
              <fieldset className="dp-field dp-radios">
                <legend className="t-label">Stuck value</legend>
                <span className="dp-radio-row">
                  {[0, 1].map((value) => (
                    <label key={value}><input type="radio" name="stuck-at-value" checked={stuckAt === value}
                      onChange={() => setStuckAt(value as 0 | 1)} /> SA{value}</label>
                  ))}
                </span>
              </fieldset>
              {inputs.map((net, index) => (
                <label key={net} className="dp-field dp-field--sm">
                  <span className="t-label">Input {net}</span>
                  <select aria-label={`Input ${net}`} value={normalizedVector[index]}
                    onChange={(event) => updateInput(index, Number(event.target.value) as 0 | 1)}>
                    <option value={0}>0</option><option value={1}>1</option>
                  </select>
                </label>
              ))}
            </div>
            {discrepancy && ('sequential' in discrepancy
              ? <p className="dp-note">This design has flip-flops, so a single-vector check would never clock them. Coverage below is measured over a clocked input sequence instead.</p>
              : 'error' in discrepancy
              ? <p className="p6-error">{discrepancy.error}</p>
              : (
                <div className="p6-output-comparison">
                  {netlist.outputs.map((output) => {
                    const changed = discrepancy.good[output] !== discrepancy.faulty[output];
                    return <div className={changed ? 'fault-output mismatch' : 'fault-output'} key={output}>
                      <strong>{output}</strong><span>Good: {discrepancy.good[output] ?? 'x'}</span>
                      <span>Faulty: {discrepancy.faulty[output] ?? 'x'}</span>
                      <b>{changed ? 'Mismatch' : 'No discrepancy'}</b>
                    </div>;
                  })}
                </div>
              ))}
          </section>

          <section className="dp-panel">
            <div className="dp-panel-head">
              <div>
                <h3 className="dp-h2">Fault coverage</h3>
                <p className="dp-muted">Each row is one fault; a ✓ means that input pattern (column) exposes it at an output. Click a row to inspect it above.</p>
              </div>
            </div>
            <div className="p6-stat-grid">
              <div><span>Detected</span><strong>{report.detected} / {report.total}</strong></div>
              <div><span>Coverage</span><strong>{report.coverage.toFixed(1)}%</strong></div>
              <div><span>Minimal test vectors</span><strong>{report.minimalTestSet.length}</strong></div>
              <div><span>Undetectable</span><strong>{report.undetected.length}</strong></div>
            </div>
            <div className="table-wrapper">
              <table className="ldam-table fault-matrix">
                <thead><tr><th>Net</th><th>Fault</th>{report.testVectors?.map((bits, index) =>
                  <th key={index} aria-label={`Vector ${index}`}>{bits.join('')}</th>)}</tr></thead>
                <tbody>{report.table.map((entry) => {
                  const isSelected = fault?.net === entry.net && fault?.stuckAt === entry.stuckAt;
                  return (
                    <tr
                      key={`${entry.net}-${entry.stuckAt}`}
                      className={isSelected ? 'is-selected' : ''}
                      onClick={() => {
                        setSelectedNet(entry.net);
                        setStuckAt(entry.stuckAt);
                      }}
                      title="Click row to inspect this fault's discrepancy above"
                    >
                      <td className="fault-net-cell">
                        {isSelected && <span className="fault-active-dot" aria-hidden="true">▶</span>}
                        <span>{entry.net}</span>
                      </td>
                      <td className="fault-type-cell">SA{entry.stuckAt}</td>
                      {report.testVectors?.map((_, index) => (
                        <td
                          key={index}
                          className={entry.detectedBy.includes(index) ? 'cell-detected' : 'cell-miss'}
                        >
                          {entry.detectedBy.includes(index) ? <span className="fault-detected" aria-label="detected">✓</span> : '—'}
                        </td>
                      ))}
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </section>

          <section className="dp-panel">
            <div className="dp-panel-head">
              <div>
                <h3 className="dp-h2">Greedy minimal test set</h3>
                <p className="dp-muted">The fewest input patterns that still catch every detectable fault, picked greedily.</p>
              </div>
            </div>
            {report.minimalTestSet.length === 0
              ? <p>No detectable faults require test vectors.</p>
              : <ol className="dp-vectors">{report.minimalTestSet.map((bits, index) =>
                  <li key={index} className="dp-bit is-1"><b>{bits.join('')}</b> <span>{inputs.map((net, bit) => `${net}=${bits[bit]}`).join(' ')}</span></li>
                )}</ol>}
            {report.undetected.length > 0 && (
              <div className="p6-undetected"><strong>Undetectable / redundant faults</strong>
                <ul>{report.undetected.map((entry) => <li key={`${entry.net}-${entry.stuckAt}`}>{entry.net} stuck-at-{entry.stuckAt}</li>)}</ul>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
