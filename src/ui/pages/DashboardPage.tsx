import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../store';
import { createProjectFile, parseProjectFile } from '../../store/project';
import { EXAMPLES, loadExample } from '../examples';
import { gateCount, pathDepth, specifiedPathDelay, verify } from '../../engine/circuit/simulate';
import { PageHead } from '../deep/PageHead';
import { openPrintableLabReport } from '../export/labReport';

function escaped(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function downloadFile(name: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function printableReport(state: ReturnType<typeof useStore.getState>): string {
  const current = state.netlists[state.activeVariant] ?? state.netlists.simplified ?? state.netlists.original;
  const rows = [
    ['Input', state.rawInput || 'No input specified'],
    ['Variables', state.vars.join(', ') || '—'],
    ['Minterms', state.truthTable?.rows.filter((row) => row.out === 1).map((row) => row.index).join(', ') || '—'],
    ['Minimized form', state.minResult?.text ?? 'Not computed'],
    ['Circuit', current?.name ?? 'Not synthesized'],
    ['Gate count', String(gateCount(current))],
    ['IC packages', String(state.costReport?.totalICs ?? 'Not computed')],
    ['Estimated total power (W)', String(state.powerReport?.totalW ?? 'Not available')],
    ['Fault coverage', state.faultReport ? `${(state.faultReport.coverage * 100).toFixed(1)}%` : 'Not computed'],
    ['Timing events', String(state.waveform?.events.length ?? 'Not computed')],
  ];
  const reportRows = rows.map(([label, value]) =>
    `<tr><th>${escaped(label)}</th><td>${escaped(value)}</td></tr>`
  ).join('');
  const truthTable = state.truthTable
    ? `<table><thead><tr>${state.truthTable.vars.map((name) => `<th>${escaped(name)}</th>`).join('')}<th>F</th></tr></thead><tbody>${state.truthTable.rows.map((row) =>
      `<tr>${row.inputs.map((bit) => `<td>${bit}</td>`).join('')}<td>${row.out}</td></tr>`
    ).join('')}</tbody></table>`
    : '<p>No truth table generated.</p>';
  const variants = Object.entries(state.netlists).map(([name, netlist]) =>
    `<tr><th>${escaped(name)}</th><td>${escaped(netlist?.name ?? 'Unavailable')}</td><td>${gateCount(netlist)}</td><td>${pathDepth(netlist) ?? '—'}</td><td>${specifiedPathDelay(netlist) ?? 'Unavailable'}</td></tr>`
  ).join('');
  const netlistDetails = Object.entries(state.netlists).map(([name, netlist]) => {
    const nodeRows = netlist?.nodes.map((node) => {
      const operation = node.kind === 'gate'
        ? `${node.type}(${node.inputs.join(', ')})`
        : node.kind === 'const'
          ? `CONST ${node.value}`
          : node.kind === 'ff'
            ? `${node.type} FF; clock ${node.clk}; D/J/K/T inputs as wired`
            : `${node.type} block`;
      const output = node.kind === 'ff' ? node.q : node.kind === 'block' ? Object.keys(node.pins).join(', ') : node.output;
      return `<tr><td>${escaped(node.id)}</td><td>${escaped(operation)}</td><td>${escaped(output)}</td></tr>`;
    }).join('') ?? '';
    return `<h3>${escaped(name)} — ${escaped(netlist?.name ?? 'not generated')}</h3>${nodeRows ? `<table><thead><tr><th>Node</th><th>Function</th><th>Output</th></tr></thead><tbody>${nodeRows}</tbody></table>` : '<p>No netlist available.</p>'}`;
  }).join('');
  const minimizationSteps = state.minResult?.steps.map((step) =>
    `<li><strong>${escaped(step.title)}</strong>: ${escaped(step.detail)}</li>`
  ).join('') ?? '';
  const powerRows = state.powerReport?.perNet.map((entry) =>
    `<tr><td>${escaped(entry.net)}</td><td>${entry.alpha}</td><td>${entry.capF}</td><td>${entry.dynW}</td></tr>`
  ).join('') ?? '';
  const icRows = state.costReport?.ics.map((item) =>
    `<tr><td>${escaped(item.part)}</td><td>${item.count}</td><td>${item.unusedGates}</td><td>${item.subtotal ?? 'Not priced'}</td></tr>`
  ).join('') ?? '';
  const costNotes = state.costReport?.notes.map((note) => `<li>${escaped(note)}</li>`).join('') ?? '';
  const undetectedFaults = state.faultReport?.undetected.map((fault) =>
    `<li>${escaped(fault.net)} stuck-at-${fault.stuckAt}</li>`
  ).join('') ?? '';
  const stateRows = state.stateTable?.rows.map((row) =>
    `<tr><td>${escaped(row.state)}</td><td>${escaped(row.input)}</td><td>${escaped(row.next)}</td><td>${escaped(row.output)}</td></tr>`
  ).join('') ?? '';
  const waveformEvents = state.waveform?.events.map((event) =>
    `<li>t=${event.t}: ${escaped(event.label)}</li>`
  ).join('') ?? '';
  const assumptions = state.powerReport?.assumptions
    ? `Vcc ${state.powerReport.assumptions.vcc} V; frequency ${state.powerReport.assumptions.freqHz} Hz; default capacitance ${state.powerReport.assumptions.defaultCapF} F.`
    : 'No power assumptions recorded.';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Aletheia Design Report</title><style>
body{font:16px/1.5 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#172033}
h1{margin-bottom:.2rem}p{color:#475569}table{border-collapse:collapse;width:100%;margin:1rem 0}
th,td{border:1px solid #cbd5e1;padding:.6rem;text-align:left}th{width:13rem;background:#f1f5f9}
@media print{body{margin:0;max-width:none}.no-print{display:none}}
</style></head><body><h1>Aletheia Design Report</h1>
<p>Generated ${new Date().toLocaleString()}</p><table>${reportRows}</table>
<h2>Truth table</h2>${truthTable}
<h2>Implementation comparison</h2><table><thead><tr><th>Variant</th><th>Netlist</th><th>Gates</th><th>Depth</th><th>Specified delay</th></tr></thead><tbody>${variants}</tbody></table>
<h2>Netlist details</h2>${netlistDetails}
<h2>Minimization derivation</h2><p>${escaped(state.minResult?.text ?? 'Not computed')}</p><ol>${minimizationSteps || '<li>No minimization steps recorded.</li>'}</ol>
<h2>IC bill of materials</h2><table><thead><tr><th>Part</th><th>Count</th><th>Unused gates</th><th>Subtotal</th></tr></thead><tbody>${icRows || '<tr><td colspan="4">Not computed</td></tr>'}</tbody></table>
<ul>${costNotes || '<li>No IC-mapping notes recorded.</li>'}</ul>
<h2>Power estimate by net</h2><table><thead><tr><th>Net</th><th>Activity</th><th>Capacitance (F)</th><th>Dynamic power (W)</th></tr></thead><tbody>${powerRows || '<tr><td colspan="4">Not computed</td></tr>'}</tbody></table>
<h2>Sequential state table</h2><p>${state.stateTable ? `${escaped(state.stateTable.model)} machine; reset ${escaped(state.stateTable.reset)}` : 'Not computed'}</p><table><thead><tr><th>State</th><th>Input</th><th>Next</th><th>Output</th></tr></thead><tbody>${stateRows || '<tr><td colspan="4">No state table recorded.</td></tr>'}</tbody></table>
<h2>Fault analysis</h2><p>${state.faultReport ? `${state.faultReport.detected} of ${state.faultReport.total} detected; minimal vectors: ${escaped(JSON.stringify(state.faultReport.minimalTestSet))}` : 'Not computed'}</p><ul>${undetectedFaults || '<li>None recorded</li>'}</ul>
<h2>Timing events</h2><ul>${waveformEvents || '<li>Not computed</li>'}</ul>
<h2>Assumptions</h2><p>${escaped(assumptions)}</p>
<h2>Notes</h2><p>Verify generated circuit results against the truth table. Cost and power values depend on the selected library and stated assumptions.</p>
<button class="no-print" onclick="window.print()">Print / Save as PDF</button></body></html>`;
}

export function DashboardPage() {
  const state = useStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedExample, setSelectedExample] = useState(EXAMPLES[0].id);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const currentNetlist = state.netlists[state.activeVariant]
    ?? state.netlists.simplified
    ?? state.netlists.original;
  const comparison = useMemo(() => ({
    original: gateCount(state.netlists.original),
    simplified: gateCount(state.netlists.simplified),
    nand: gateCount(state.netlists.nand),
    nor: gateCount(state.netlists.nor),
  }), [state.netlists]);
  const verification = useMemo(() => {
    if (!currentNetlist || !state.truthTable || currentNetlist.nodes.some((node) => node.kind === 'ff')) {
      return { result: null, error: null };
    }
    try {
      return { result: verify(currentNetlist, state.truthTable), error: null };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [currentNetlist, state.truthTable]);

  const chooseExample = () => {
    try {
      loadExample(selectedExample);
      setNotice({ kind: 'success', text: `${EXAMPLES.find((item) => item.id === selectedExample)?.label ?? 'Example'} loaded.` });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  };

  const saveProject = () => {
    try {
      downloadFile('aletheia-project.json', createProjectFile(state), 'application/json');
      setNotice({ kind: 'success', text: 'Project JSON downloaded.' });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  };

  const loadProject = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Project file exceeds the 2,000,000 character limit.');
      const project = parseProjectFile(await file.text());
      useStore.setState(project);
      setNotice({ kind: 'success', text: `Loaded ${file.name}.` });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const openReport = () => {
    try {
      downloadFile('aletheia-design-report.html', printableReport(state), 'text/html');
      setNotice({ kind: 'success', text: 'Printable HTML report downloaded.' });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  };

  const minterms = state.truthTable?.rows.filter((row) => row.out === 1).map((row) => row.index) ?? [];
  const cards = [
    { title: '1. Input summary', path: '/input', value: state.rawInput || 'No function entered', detail: `${state.vars.length} variables: ${state.vars.join(', ') || '—'}` },
    { title: '2. Truth table', path: '/truth-table', value: state.truthTable ? `${state.truthTable.rows.length} rows` : 'Not generated', detail: `${minterms.length} minterms` },
    { title: '3. K-map and QM', path: '/kmap', value: state.minResult?.text ?? 'Not minimized', detail: state.minResult ? `${state.minResult.termCount} terms · ${state.minResult.literalCount} literals` : 'Minimize the current function' },
    { title: '4. Circuit', path: '/circuit', value: currentNetlist?.name ?? 'Not synthesized', detail: `${gateCount(currentNetlist)} gates · ${currentNetlist?.outputs.length ?? 0} outputs` },
  ];

  return (
    <div className="page-container dp dashboard-page">
      <PageHead kicker="Report / Dashboard" title="Design Dashboard" sub="A compact view of the current design, with links into each analysis stage." />

      <section className="dp-panel dashboard-toolbar" aria-label="Project actions">
        <div>
          <label htmlFor="example-picker">Load a worked example</label>
          <select id="example-picker" value={selectedExample} onChange={(event) => setSelectedExample(event.target.value)}>
            {EXAMPLES.map((example) => <option key={example.id} value={example.id}>{example.label} — {example.description}</option>)}
          </select>
          <button className="btn-primary" onClick={chooseExample}>Load example</button>
        </div>
        <div className="dashboard-actions">
          <button className="btn-secondary" onClick={saveProject}>Save project JSON</button>
          <button className="btn-secondary" onClick={() => fileInput.current?.click()}>Load project JSON</button>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            aria-label="Choose an Aletheia project JSON file"
            onChange={(event) => void loadProject(event.target.files?.[0])}
          />
          <button className="btn-primary" onClick={() => openPrintableLabReport(state)}>Print / Save PDF</button>
          <button className="btn-secondary" onClick={openReport}>Download HTML</button>
        </div>
      </section>
      {notice && <p className={`dashboard-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}

      <section className="dashboard-grid" aria-label="Design workflow summary">
        {cards.slice(0, 1).map((card) => (
          <article className="dp-panel dashboard-card" key={card.title}>
            <div className="dashboard-card-head"><h2>{card.title}</h2><Link to={card.path}>Open</Link></div>
            <strong>{card.value}</strong><p>{card.detail}</p>
          </article>
        ))}
        {cards.slice(1, 2).map((card) => (
          <article className="dp-panel dashboard-card" key={card.title}>
            <div className="dashboard-card-head"><h2>{card.title}</h2><Link to={card.path}>Open</Link></div>
            <strong>{card.value}</strong><p>{card.detail}</p>
            {state.truthTable && <details><summary>View table rows</summary><div className="dashboard-table-scroll">
              <table><thead><tr>{state.truthTable.vars.map((variable) => <th key={variable}>{variable}</th>)}<th>F</th></tr></thead>
                <tbody>{state.truthTable.rows.map((row) => <tr key={row.index}>{row.inputs.map((bit, index) => <td key={`${row.index}-${index}`}>{bit}</td>)}<td>{row.out}</td></tr>)}</tbody>
              </table>
            </div></details>}
          </article>
        ))}
        {cards.slice(2).map((card) => (
          <article className="dp-panel dashboard-card" key={card.title}>
            <div className="dashboard-card-head"><h2>{card.title}</h2><Link to={card.path}>Open</Link></div>
            <strong className="dashboard-formula">{card.value}</strong><p>{card.detail}</p>
          </article>
        ))}

        <article className="dp-panel dashboard-card">
          <div className="dashboard-card-head"><h2>5. Simulation verification</h2><Link to="/circuit">Open</Link></div>
          <strong className={verification.result ? (verification.result.ok ? 'text-emerald' : 'text-rose') : ''}>
            {verification.result ? (verification.result.ok ? 'Verified ✓' : `Mismatch ✗ (${verification.result.mismatches.length})`) : verification.error ? 'Verification error' : 'Not available'}
          </strong>
          <p>{verification.error ?? (verification.result ? 'The selected circuit was checked against every defined truth-table row.' : 'Synthesize a combinational circuit and truth table to verify equivalence.')}</p>
        </article>

        <article className="dp-panel dashboard-card">
          <div className="dashboard-card-head"><h2>6. Gate / IC / cost / power</h2><Link to="/cost-power">Open</Link></div>
          <div className="variant-counts">
            {Object.entries(comparison).map(([variant, count]) => <span key={variant}>{variant}: <b>{count}</b> gates</span>)}
          </div>
          <p>Selected circuit depth: {pathDepth(currentNetlist) ?? 'unavailable'} gates · explicit path delay: {specifiedPathDelay(currentNetlist) ?? 'not specified'}</p>
          <p>{state.costReport ? `${state.costReport.totalICs} IC packages · ${state.costReport.totalCost === undefined ? 'price unavailable' : `total ${state.costReport.totalCost}`}` : 'IC estimate not computed'}</p>
          <p>{state.powerReport ? `Estimated power: ${state.powerReport.totalW === undefined ? 'static component unavailable' : `${state.powerReport.totalW} W`}` : 'Power estimate not computed'}</p>
        </article>

        <article className="dp-panel dashboard-card">
          <div className="dashboard-card-head"><h2>7. Fault coverage</h2><Link to="/faults">Open</Link></div>
          <strong>{state.faultReport ? `${state.faultReport.coverage.toFixed(1)}%` : 'Not tested'}</strong>
          <p>{state.faultReport ? `${state.faultReport.detected}/${state.faultReport.total} faults detected · ${state.faultReport.minimalTestSet.length} test vectors` : 'Run stuck-at fault analysis on the circuit.'}</p>
        </article>

        {state.designedNetlist && (
          <article className="dp-panel dashboard-card">
            <div className="dashboard-card-head"><h2>8. Timing and state sequence</h2><Link to="/timing">Open</Link></div>
            <strong>{state.waveform ? `${state.waveform.events.length} timing events` : state.stateTable?.model.toUpperCase() ?? 'Sequential design'}</strong>
            <p>{state.waveform ? `Duration ${state.waveform.time.at(-1) ?? 0} ticks` : `${state.designedNetlist.nodes.filter((node) => node.kind === 'ff').length} flip-flops in ${state.designedNetlist.name}`}</p>
          </article>
        )}
      </section>

      <section className="dp-panel dashboard-footer">
        <h2>Continue the workflow</h2>
        <div className="dashboard-links">
          <Link to="/selftest">Run system self-test</Link>
          <Link to="/help">Browse the concept guide</Link>
          <Link to="/sequential">Analyze sequential logic</Link>
          <Link to="/timing">Explore timing and hazards</Link>
        </div>
      </section>
    </div>
  );
}
