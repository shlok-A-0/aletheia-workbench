import type { RootStore } from '../../store';
import { gateCount, pathDepth, specifiedPathDelay, verify } from '../../engine/circuit/simulate';
import { DEFAULT_IC_LIBRARY, mapToICs } from '../../engine/analysis/ic-map';
import { runFaultTest } from '../../engine/analysis/fault';
import { generateSchematicSvg } from '../schematic/elkLayout';

function escaped(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] ?? c);
}

/** Section 7: the FSM / sequential circuit the student designed, when there is one. */
function sequentialSection(state: RootStore, sequentialSvg?: string, stateDiagramSvg?: string): string {
  const net = state.designedNetlist;
  if (!net) return '';
  const st = state.stateTable;
  const ffs = net.nodes.filter((n) => n.kind === 'ff').length;
  const rows = st?.rows.map((r) => `<tr><td class="bold-cell">${escaped(r.state)}</td><td>${escaped(r.input)}</td><td>${escaped(r.next)}</td><td>${escaped(r.output)}</td></tr>`).join('') ?? '';
  const diagram = st ? (stateDiagramSvg ?? '') : '';
  const equations = [...state.excitationEquations, ...state.outputEquations];
  return `
    <h2>7. Sequential Design</h2>
    <p>${st ? `${escaped(st.model === 'moore' ? 'Moore' : 'Mealy')} machine with ${st.states.length} states` : 'Sequential circuit'}, implemented with ${ffs} flip-flop${ffs === 1 ? '' : 's'} and ${gateCount(net)} gates.</p>
    ${diagram ? `<div class="schematic-container" style="page-break-inside:avoid;margin-bottom:14px;text-align:center;">${diagram}</div>` : ''}
    ${st ? `<table>
      <thead><tr><th>Present state</th><th>Input (${escaped(st.inputs.join(', '))})</th><th>Next state</th><th>Output (${escaped(st.outputs.join(', '))})</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>` : ''}
    ${equations.length > 0 ? `<h3>Flip-flop input and output equations</h3><ul class="eqs">${equations.map((e) => `<li><code>${escaped(e)}</code></li>`).join('')}</ul>` : ''}
    ${sequentialSvg ? `<h3>Sequential circuit schematic</h3><div class="schematic-container" style="page-break-inside:avoid;margin-bottom:14px;">${sequentialSvg}</div>` : ''}`;
}

export function generateLabReportHtml(
  state: RootStore,
  schematicSvg?: string,
  sequentialSvg?: string,
  stateDiagramSvg?: string
): string {
  const minterms =
    state.truthTable?.rows.filter((r) => r.out === 1).map((r) => r.index).join(', ') || 'None';

  // Active netlist for cost, fault analysis, and diagram
  const activeNetlist = state.activeVariant
    ? state.netlists[state.activeVariant]
    : (state.netlists.simplified ?? state.netlists.original ?? state.designedNetlist);

  // Truth table HTML (up to 32 rows to fit cleanly on report)
  const ttRows = state.truthTable?.rows.slice(0, 32).map((r) =>
    `<tr>${r.inputs.map((b) => `<td>${b}</td>`).join('')}<td class="bold-cell">${r.out}</td></tr>`
  ).join('') ?? '';

  const ttHeaders = state.truthTable?.vars.map((v) => `<th>${escaped(v)}</th>`).join('') ?? '';

  // Implementation comparison table
  const variantRows = Object.entries(state.netlists).map(([name, nl]) => {
    if (!nl) return '';
    return `<tr>
      <td class="bold-cell">${escaped(name.toUpperCase())}</td>
      <td>${escaped(nl.name)}</td>
      <td>${gateCount(nl)}</td>
      <td>${pathDepth(nl) ?? '—'}</td>
      <td>${specifiedPathDelay(nl) ? `${specifiedPathDelay(nl)} ns` : '—'}</td>
    </tr>`;
  }).filter(Boolean).join('');

  // IC bill of materials table (calculate on-the-fly if not already in store)
  let costReport = state.costReport;
  if (!costReport && activeNetlist) {
    try {
      costReport = mapToICs(activeNetlist, DEFAULT_IC_LIBRARY, { preferBlocks: true });
    } catch {
      // fallback
    }
  }

  const icRows = costReport?.ics.map((ic) => `
    <tr>
      <td class="bold-cell">${escaped(ic.part)}</td>
      <td>${ic.count}</td>
      <td>${ic.unusedGates}</td>
      <td>${ic.unitPrice !== null && ic.unitPrice !== undefined ? `$${ic.unitPrice.toFixed(2)}` : '—'}</td>
      <td>${ic.subtotal !== null && ic.subtotal !== undefined ? `$${ic.subtotal.toFixed(2)}` : '—'}</td>
    </tr>
  `).join('') ?? '<tr><td colspan="5">No IC mapping generated.</td></tr>';

  // Fault coverage (calculate on-the-fly for <= 6 inputs if not already in store)
  let faultReport = state.faultReport;
  if (!faultReport && activeNetlist && activeNetlist.inputs.length <= 6) {
    try {
      faultReport = runFaultTest(activeNetlist);
    } catch {
      // fallback
    }
  }

  const faultCov = faultReport
    ? `${faultReport.coverage.toFixed(1)}%`
    : 'Not computed';

  // Hardware verification against truth table
  const vResult = (activeNetlist && state.truthTable) ? verify(activeNetlist, state.truthTable) : null;
  const isVerified = vResult?.ok ?? false;

  const testVectors = faultReport?.minimalTestSet?.map((v) =>
    `<code>[${v.join(', ')}]</code>`
  ).join(', ') || 'None';

  // Minimization steps
  const qmSteps = state.minResult?.steps.map((st) =>
    `<li><strong>${escaped(st.title)}:</strong> ${escaped(st.detail)}</li>`
  ).join('') ?? '<li>No derivation steps recorded.</li>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Aletheia Design Report — ${escaped(state.rawInput || 'Logic Synthesis')}</title>
  <style>
    @page {
      size: A4;
      margin: 15mm;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #0f172a;
      background: #fff;
      margin: 0;
      padding: 0;
    }
    .no-print-bar {
      background: #0f172a;
      color: #fff;
      padding: 10px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 999;
    }
    .print-btn {
      background: #a3e635;
      color: #000;
      border: 0;
      font-weight: 700;
      font-size: 13px;
      padding: 8px 16px;
      cursor: pointer;
      border-radius: 4px;
    }
    .print-btn:hover { background: #84cc16; }
    .report-paper {
      max-width: 820px;
      margin: 20px auto;
      padding: 24px;
    }
    .report-header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .report-title h1 {
      font-size: 22px;
      margin: 0 0 4px;
      text-transform: uppercase;
      letter-spacing: -0.01em;
    }
    .report-title p {
      margin: 0;
      font-size: 12px;
      color: #64748b;
    }
    .meta-box {
      text-align: right;
      font-size: 11px;
      color: #64748b;
    }
    .meta-box strong { color: #0f172a; }
    h2 {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-left: 3px solid #0f172a;
      padding-left: 8px;
      margin: 18px 0 8px;
      color: #0f172a;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0 16px;
      font-size: 12px;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 6px 10px;
      text-align: left;
    }
    th {
      background: #f1f5f9;
      font-weight: 600;
      color: #334155;
    }
    .bold-cell { font-weight: 700; }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      page-break-inside: avoid;
    }
    .stat-chip {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 8px 12px;
      margin-bottom: 8px;
      border-radius: 4px;
    }
    .stat-chip strong { display: block; font-size: 11px; color: #64748b; text-transform: uppercase; }
    .stat-chip span { font-size: 14px; font-weight: 700; color: #0f172a; }
    ol, ul { margin: 6px 0 14px; padding-left: 20px; font-size: 12px; color: #334155; }
    li { margin-bottom: 4px; }
    .verdict-box {
      border: 1.5px solid #16a34a;
      background: #f0fdf4;
      color: #166534;
      padding: 10px 14px;
      font-weight: 700;
      border-radius: 4px;
      margin: 14px 0;
    }
    @media print {
      .no-print-bar { display: none; }
      body { margin: 0; padding: 0; background: #fff; }
      .report-paper { max-width: 100%; margin: 0; padding: 0; }
    }
    .state-diagram-svg .sd-edge { fill: none; stroke: #334155; stroke-width: 1.5; }
    .state-diagram-svg .sd-arrow { fill: #334155; }
    .state-diagram-svg .sd-node { fill: #ffffff; stroke: #334155; stroke-width: 2; }
    .state-diagram-svg .sd-node.is-reset { stroke-width: 4; }
    .state-diagram-svg text { fill: #0f172a; font-family: monospace; }
    .state-diagram-svg .sd-label { paint-order: stroke; stroke: #ffffff; stroke-width: 4px; }
    ul.eqs { font-size: 13px; line-height: 1.7; }
  </style>
</head>
<body>
  <div class="no-print-bar">
    <div><strong>Aletheia Design Document</strong> &mdash; Printable College Lab Report</div>
    <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
  </div>

  <div class="report-paper">
    <header class="report-header">
      <div class="report-title">
        <h1>Digital Logic Design Report</h1>
        <p>Aletheia Workbench &bull; Logic Design &amp; Microprocessors (LDM)</p>
      </div>
      <div class="meta-box">
        <div>Generated: <strong>${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</strong></div>
        <div>Status: <strong>${isVerified ? 'Synthesis Verified' : 'Verification Mismatch'}</strong></div>
      </div>
    </header>

    <h2>1. Design Specification</h2>
    <div class="grid-2">
      <div>
        <div class="stat-chip">
          <strong>Specification Input</strong>
          <span>${escaped(state.rawInput || 'F = Active Function')}</span>
        </div>
        <div class="stat-chip">
          <strong>Input Variables</strong>
          <span>${escaped(state.vars.join(', ') || '—')} (${state.vars.length} variables)</span>
        </div>
      </div>
      <div>
        <div class="stat-chip">
          <strong>Canonical Minterms</strong>
          <span>&Sigma;m(${escaped(minterms)})</span>
        </div>
        <div class="stat-chip">
          <strong>Minimized Expression (QM)</strong>
          <span>${escaped(state.minResult?.text ?? 'F = Computed')}</span>
        </div>
      </div>
    </div>

    <h2>2. Canonical Truth Table</h2>
    ${
      state.truthTable
        ? `<table>
            <thead><tr>${ttHeaders}<th>F</th></tr></thead>
            <tbody>${ttRows}</tbody>
          </table>
          ${state.truthTable.rows.length > 32 ? `<p style="font-size:11px;color:#64748b;">Showing first 32 of ${state.truthTable.rows.length} rows.</p>` : ''}`
        : '<p>No truth table available.</p>'
    }

    <h2>3. Circuit Schematic &amp; Implementation</h2>
    ${
      schematicSvg
        ? `<div class="schematic-container" style="page-break-inside:avoid;margin-bottom:14px;">
            ${schematicSvg}
          </div>`
        : ''
    }
    <table>
      <thead>
        <tr>
          <th>Variant</th>
          <th>Netlist</th>
          <th>Total Gates</th>
          <th>Logic Depth</th>
          <th>Critical Path</th>
        </tr>
      </thead>
      <tbody>
        ${variantRows || '<tr><td colspan="5">No synthesized variants available.</td></tr>'}
      </tbody>
    </table>

    <h2>4. Component Bill of Materials (74LS TTL)</h2>
    <table>
      <thead>
        <tr>
          <th>Part</th>
          <th>Package Count</th>
          <th>Unused Gates</th>
          <th>Unit Price</th>
          <th>Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${icRows}
      </tbody>
      ${
        costReport?.totalCost !== undefined
          ? `<tfoot>
              <tr>
                <th colspan="4" style="text-align:right;">Estimated Total Cost:</th>
                <th class="bold-cell">$${costReport.totalCost.toFixed(2)}</th>
              </tr>
            </tfoot>`
          : ''
      }
    </table>

    <h2>5. Hardware Verification &amp; Fault Coverage</h2>
    ${
      isVerified
        ? `<div class="verdict-box">
            &#10003; Verification Status: FUNCTIONALLY EQUIVALENT TO TRUTH TABLE (100% Match)
          </div>`
        : `<div class="verdict-box" style="border-color:#ef4444;background:#fef2f2;color:#b91c1c;">
            &#10007; Verification Status: ${vResult ? `MISMATCH (${vResult.mismatches.length} row(s) differ from Truth Table)` : 'NOT VERIFIED'}
          </div>`
    }
    <div class="grid-2">
      <div class="stat-chip">
        <strong>Stuck-At Fault Coverage</strong>
        <span>${faultCov}</span>
      </div>
      <div class="stat-chip">
        <strong>Minimal Test Vectors</strong>
        <span style="font-size:12px;font-family:monospace;">${testVectors}</span>
      </div>
    </div>

    <h2>6. Minimization Derivation Steps</h2>
    <ol>
      ${qmSteps}
    </ol>

    ${sequentialSection(state, sequentialSvg, stateDiagramSvg)}

    <footer style="margin-top:30px;border-top:1px solid #cbd5e1;padding-top:12px;font-size:11px;color:#94a3b8;display:flex;justify-content:space-between;">
      <span>Aletheia Workbench &bull; Generated from live synthesis netlist</span>
    </footer>
  </div>

  <script>
    // Automatically trigger print dialog after page renders
    function triggerPrint() {
      setTimeout(function() {
        try { window.print(); } catch (_) {}
      }, 300);
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      triggerPrint();
    } else {
      window.addEventListener('load', triggerPrint);
    }
  </script>
</body>
</html>`;
}

export async function openPrintableLabReport(state: RootStore): Promise<void> {
  // 1. Open window synchronously to avoid browser popup blockers
  let win: Window | null = null;
  try {
    win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (win) {
      win.document.open();
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Preparing Lab Report...</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:40px;color:#334155;text-align:center;background:#f8fafc;}h2{margin:0 0 8px;color:#0f172a;}p{margin:0;font-size:13px;color:#64748b;}</style></head><body><h2>Preparing Aletheia Lab Report...</h2><p>Rendering vector schematic and compiling Bill of Materials.</p></body></html>`);
      win.document.close();
    }
  } catch {
    // Popup might be blocked or running headless
  }

  // 2. Generate vector schematic SVG
  const activeNetlist = state.activeVariant
    ? state.netlists[state.activeVariant]
    : (state.netlists.simplified ?? state.netlists.original ?? state.designedNetlist);

  let svg = '';
  if (activeNetlist) {
    try {
      svg = await generateSchematicSvg(activeNetlist);
    } catch {
      // Non-fatal if schematic layout is unsupported
    }
  }

  // The designed sequential circuit gets its own schematic unless it is already the main one above.
  let sequentialSvg = '';
  if (state.designedNetlist && state.designedNetlist !== activeNetlist) {
    try {
      sequentialSvg = await generateSchematicSvg(state.designedNetlist);
    } catch {
      // Non-fatal
    }
  }

  // The state diagram is a React component; render it to markup on demand so the server renderer
  // stays out of the main bundle.
  let stateDiagramSvg = '';
  if (state.stateTable && state.designedNetlist) {
    try {
      const [{ createElement }, { renderToStaticMarkup }, { StateDiagramSVG }] = await Promise.all([
        import('react'),
        import('react-dom/server'),
        import('../pages/sequential/StateDiagram'),
      ]);
      stateDiagramSvg = renderToStaticMarkup(createElement(StateDiagramSVG, { st: state.stateTable }));
    } catch {
      // Non-fatal
    }
  }

  // 3. Generate full lab report HTML
  const html = generateLabReportHtml(state, svg, sequentialSvg, stateDiagramSvg);

  // 4. Update the opened window
  try {
    if (win && !win.closed) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      return;
    }
  } catch {
    // Popup communication failed
  }

  // Fallback: direct file download if popup blocked
  try {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aletheia-lab-report-${Date.now()}.html`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    // ignore
  }
}

