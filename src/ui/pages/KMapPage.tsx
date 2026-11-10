import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import {
  buildKMap,
  kmapGroups,
  kmapSimplify,
  quineMcCluskey,
  findPrimeImplicants,
} from '../../engine/minimize';
import { truthTableFromExpr, parseExpr, mintermsOf, maxtermsOf, dontCaresOf } from '../../engine/boolean';
import type { TruthTable } from '../../engine/types';
import { getEngineWorker } from '../../workers/useEngineWorker';
import type { WorkerApi } from '../../workers/engine.worker';

type WorkerMinimization = Awaited<ReturnType<WorkerApi['minimizeTable']>>;
type StoredWorkerResult =
  | { table: TruthTable; result: WorkerMinimization; error?: never }
  | { table: TruthTable; result?: never; error: string };

interface KMapPageProps {
  /** Rendered inside the workbench: no page header, no Back / Proceed buttons. */
  embedded?: boolean;
}

export const KMapPage: React.FC<KMapPageProps> = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { truthTable, selectedForm, setSelectedForm, setMinResult } = useStore();

  const [form, setForm] = useState<'SOP' | 'POS'>(selectedForm);
  const [activeTab, setActiveTab] = useState<'kmap' | 'qm'>('kmap');
  const [hoveredGroup, setHoveredGroup] = useState<number | null>(null);
  const [includeDontCares, setIncludeDontCares] = useState(true);
  const [storedWorkerResult, setStoredWorkerResult] = useState<StoredWorkerResult | null>(null);

  const defaultTable = useMemo<TruthTable>(() => {
    return truthTableFromExpr(parseExpr("A'B + C"), ['A', 'B', 'C']);
  }, []);

  const activeTable = truthTable ?? defaultTable;
  const numVars = activeTable.vars.length;
  const canRenderKMap = numVars >= 2 && numVars <= 5;
  const minimizationTable = useMemo(() => {
    if (includeDontCares) return activeTable;
    const fixedValue = form === 'SOP' ? 0 : 1;
    return {
      vars: [...activeTable.vars],
      rows: activeTable.rows.map((row) => ({
        ...row,
        out: row.out === 'x' ? fixedValue : row.out,
      })),
    } as TruthTable;
  }, [activeTable, form, includeDontCares]);

  const needsWorker = numVars > 5;
  useEffect(() => {
    if (!needsWorker) return;
    let current = true;
    void Promise.resolve()
      .then(() => getEngineWorker().minimizeTable(minimizationTable))
      .then((result) => {
        if (current) setStoredWorkerResult({ table: minimizationTable, result });
      }).catch((error: unknown) => {
        if (current) setStoredWorkerResult({
          table: minimizationTable,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => { current = false; };
  }, [needsWorker, minimizationTable]);

  const workerResult = storedWorkerResult?.table === minimizationTable ? storedWorkerResult : null;
  const localResults = useMemo(() => {
    if (needsWorker) return null;
    const sop = quineMcCluskey(minimizationTable, 'SOP');
    const pos = quineMcCluskey(minimizationTable, 'POS');
    const dontCares = dontCaresOf(minimizationTable);
    return {
      results: { SOP: sop, POS: pos },
      details: {
        SOP: findPrimeImplicants(mintermsOf(minimizationTable), dontCares, minimizationTable.vars.length),
        POS: findPrimeImplicants(maxtermsOf(minimizationTable), dontCares, minimizationTable.vars.length),
      },
      careTerms: {
        SOP: mintermsOf(minimizationTable),
        POS: maxtermsOf(minimizationTable),
      },
    };
  }, [minimizationTable, needsWorker]);
  const results = workerResult?.result ?? localResults;
  const qmResult = results?.results[form] ?? null;

  const kmapData = useMemo(() => {
    if (!canRenderKMap) return null;
    return buildKMap(minimizationTable);
  }, [minimizationTable, canRenderKMap]);

  const kmapGroupData = useMemo(() => {
    if (!canRenderKMap) return null;
    return kmapGroups(minimizationTable, form);
  }, [minimizationTable, form, canRenderKMap]);

  const kmapSimpResult = useMemo(() => {
    if (!canRenderKMap) return qmResult;
    if (!qmResult) return null;
    return kmapSimplify(minimizationTable, form);
  }, [minimizationTable, form, canRenderKMap, qmResult]);

  const sopResult = results?.results.SOP ?? null;
  const posResult = results?.results.POS ?? null;
  const qmDetails = results
    ? {
      ...results.details[form],
      careTerms: results.careTerms[form],
    }
    : null;

  const handleFormChange = (newForm: 'SOP' | 'POS') => {
    setForm(newForm);
    setSelectedForm(newForm);
  };

  const handleProceedToCircuit = () => {
    setMinResult(kmapSimpResult);
    navigate('/circuit');
  };

  const groupColors = [
    'rgba(0, 210, 255, 0.25)',
    'rgba(16, 185, 129, 0.25)',
    'rgba(245, 158, 11, 0.25)',
    'rgba(236, 72, 153, 0.25)',
    'rgba(168, 85, 247, 0.25)',
    'rgba(239, 68, 68, 0.25)',
  ];

  if (!qmResult || !sopResult || !posResult || !qmDetails || !kmapSimpResult) {
    const workerError = workerResult && 'error' in workerResult ? workerResult.error : null;
    return (
      <div className="page-container">
        {!embedded && (
          <div className="page-header">
            <h1>K-Map &amp; Quine–McCluskey Minimization</h1>
            <p className="subtitle">Eight-variable minimization runs in the engine Web Worker.</p>
          </div>
        )}
        <section className="glass-card" role={workerError ? 'alert' : 'status'} aria-busy={!workerError}>
          {workerError ?? 'Minimizing the current truth table in the background…'}
        </section>
      </div>
    );
  }

  return (
    <div className="page-container">
      {!embedded && (
        <div className="page-header">
          <h1>K-Map & Quine–McCluskey Minimization</h1>
          <p className="subtitle">
            Visual Gray-code Karnaugh map grouping and deterministic Quine–McCluskey tabular reduction
            with Petrick's expansion.
          </p>
        </div>
      )}

      {/* Control Toolbar */}
      <div className="kmap-toolbar">
        <div className="form-toggle-group">
          <button
            className={`btn-toggle ${form === 'SOP' ? 'active' : ''}`}
            onClick={() => handleFormChange('SOP')}
          >
            Sum of Products (SOP)
          </button>
          <button
            className={`btn-toggle ${form === 'POS' ? 'active' : ''}`}
            onClick={() => handleFormChange('POS')}
          >
            Product of Sums (POS)
          </button>
        </div>
        <label className="kmap-dont-care-toggle">
          <input
            type="checkbox"
            checked={includeDontCares}
            onChange={(event) => setIncludeDontCares(event.target.checked)}
          />
          Use don't-cares
        </label>

        <div className="view-toggle-group">
          <button
            className={`tab-btn ${activeTab === 'kmap' ? 'active' : ''}`}
            onClick={() => setActiveTab('kmap')}
            disabled={!canRenderKMap}
          >
            🗺️ K-Map View {canRenderKMap ? `(${numVars} vars)` : '(2–5 vars only)'}
          </button>
          <button
            className={`tab-btn ${activeTab === 'qm' ? 'active' : ''}`}
            onClick={() => setActiveTab('qm')}
          >
            📊 Quine–McCluskey Tables
          </button>
        </div>
      </div>

      {/* Result Hero Banner */}
      <div className="glass-card result-hero-card">
        <div className="result-hero-left">
          <div className="hero-tag">Minimized {form} Expression</div>
          <div className="hero-formula">
            <code>{kmapSimpResult.text}</code>
          </div>
          <div className="hero-metrics">
            <span className="metric-pill">
              <strong>{kmapSimpResult.termCount}</strong> terms
            </span>
            <span className="metric-pill">
              <strong>{kmapSimpResult.literalCount}</strong> literals
            </span>
            <span className="metric-pill agreement">
              ✓ K-Map & QM Agree (Optimal Minimal Cover)
            </span>
            <span className="metric-pill">SOP: <code>{sopResult.text}</code></span>
            <span className="metric-pill">POS: <code>{posResult.text}</code></span>
            {kmapSimpResult.note && (
              <span className="metric-pill note">{kmapSimpResult.note}</span>
            )}
          </div>
        </div>
      </div>

      {/* TAB 1: K-MAP VIEW */}
      {activeTab === 'kmap' && canRenderKMap && kmapData && kmapGroupData && (
        <div className="kmap-view-layout">
          {/* Visual K-Map Grid */}
          <div className="glass-card kmap-grid-card">
            <div className="card-header">
              <h3>Gray-Code Map Grid</h3>
              <span className="info-tag">
                {kmapData.rowVars.join('')} (Rows) \ {kmapData.colVars.join('')} (Cols)
              </span>
            </div>

            <div className="kmap-grid-wrapper">
              <table className="kmap-table">
                <thead>
                  <tr>
                    <th className="corner-header">
                      <span className="row-var-label">{kmapData.rowVars.join('')}</span>
                      <span className="diag-slash">\</span>
                      <span className="col-var-label">{kmapData.colVars.join('')}</span>
                    </th>
                    {kmapData.colHeaders.map((ch, idx) => (
                      <th key={idx} className="col-header-cell">
                        {ch}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {kmapData.grid.map((rowCells, rIdx) => (
                    <tr key={rIdx}>
                      <th className="row-header-cell">{kmapData.rowHeaders[rIdx]}</th>
                      {rowCells.map((cell) => {
                        const matchingGroupIndices = kmapGroupData.groups
                          .map((g, gIdx) => (g.cells.includes(cell.minterm) ? gIdx : -1))
                          .filter((i) => i !== -1);

                        const isHovered =
                          hoveredGroup !== null &&
                          kmapGroupData.groups[hoveredGroup]?.cells.includes(cell.minterm);

                        const primaryColor =
                          matchingGroupIndices.length > 0
                            ? groupColors[matchingGroupIndices[0] % groupColors.length]
                            : 'transparent';

                        return (
                          <td
                            key={cell.col}
                            className={`kmap-cell val-${cell.value} ${isHovered ? 'cell-hovered' : ''}`}
                            style={{ backgroundColor: primaryColor }}
                            onMouseEnter={() => setHoveredGroup(matchingGroupIndices[0] ?? null)}
                          >
                            <span className="cell-minterm">m{cell.minterm}</span>
                            <span className="cell-val">{cell.value}</span>
                            {matchingGroupIndices.length > 0 && (
                              <div className="group-indicators">
                                {matchingGroupIndices.map((gi) => (
                                  <span key={gi} className="group-dot" title={`Group ${gi + 1}`}>
                                    G{gi + 1}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Grouping Breakdown Sidebar */}
          <div className="glass-card kmap-groups-card">
            <div className="card-header">
              <h3>Chosen Prime Groups ({kmapGroupData.groups.length})</h3>
              <span className="info-tag">Hover a group to highlight its cells</span>
            </div>

            <div className="groups-list">
              {kmapGroupData.groups.map((g, idx) => (
                <div
                  key={idx}
                  className={`group-card ${hoveredGroup === idx ? 'hovered' : ''} ${g.essential ? 'essential-group' : ''}`}
                  onMouseEnter={() => setHoveredGroup(idx)}
                  onMouseLeave={() => setHoveredGroup(null)}
                  onClick={() => setHoveredGroup(hoveredGroup === idx ? null : idx)}
                  onFocus={() => setHoveredGroup(idx)}
                  tabIndex={0}
                >
                  <div className="group-card-header">
                    <span className="group-badge" style={{ backgroundColor: groupColors[idx % groupColors.length] }}>
                      G{idx + 1}
                    </span>
                    <code className="group-term">{g.termText}</code>
                    {g.essential && <span className="epi-badge">Essential</span>}
                    {g.isCornerGroup && <span className="wrap-tag corner">4 Corners</span>}
                    {(g.isEdgeWrapRow || g.isEdgeWrapCol) && !g.isCornerGroup && (
                      <span className="wrap-tag wrap">Wrap-Around</span>
                    )}
                  </div>
                  <div className="group-card-body">
                    <div className="detail-item">
                      <span>Covered Minterms:</span>
                      <code>[{g.cells.join(', ')}]</code>
                    </div>
                    <div className="detail-item">
                      <span>Implicant:</span>
                      <code>{g.implicant.bits.join('')}</code>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Explanation Steps */}
            <div className="steps-accordion">
              <div className="steps-title">Minimization Derivation Steps:</div>
              {kmapSimpResult.steps.map((s, idx) => (
                <div key={idx} className="step-row">
                  <span className="step-num">{idx + 1}</span>
                  <div className="step-body">
                    <div className="step-rule">{s.title}</div>
                    <div className="step-desc">{s.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'kmap' && !canRenderKMap && (
        <div className="glass-card" style={{ padding: '24px', textAlign: 'center' }}>
          <h3>K-Map Visualization Unavailable ({minimizationTable.vars.length} Variables)</h3>
          <p style={{ marginTop: '8px', color: 'var(--text-secondary)' }}>
            The visual Karnaugh map grid supports 2 to 5 variables.
            Please switch to the <strong>Quine–McCluskey Tables</strong> tab above to view the tabular minimization.
          </p>
        </div>
      )}

      {/* TAB 2: QUINE–MCCLUSKEY VIEW */}
      {activeTab === 'qm' && (
        <div className="qm-view-layout">
          {/* Combining Columns */}
          <div className="glass-card qm-columns-card">
            <div className="card-header">
              <h3>Quine–McCluskey Combining Columns</h3>
              <span className="info-tag">Iterative single-bit adjacency reduction</span>
            </div>

            <div className="columns-grid">
              {qmDetails.columnsData.map((col) => (
                <div key={col.column} className="qm-column-box">
                  <div className="qm-column-title">Column {col.column + 1} ({col.terms.length} terms)</div>
                  <div className="terms-list">
                    {col.terms.map((t, tIdx) => (
                      <div key={tIdx} className="qm-term-row">
                        <code className="term-bits">{t.bits}</code>
                        <span className="term-covers">m({t.covers.join(',')})</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Prime Implicant Coverage Chart */}
          <div className="glass-card qm-chart-card">
            <div className="card-header">
              <h3>Prime Implicant Coverage Chart</h3>
              <span className="info-tag">Rows: Prime Implicants | Columns: Care Minterms</span>
            </div>

            <div className="table-wrapper">
              <table className="ldam-table pi-chart-table">
                <thead>
                  <tr>
                    <th>Prime Implicant</th>
                    <th>Covers</th>
                    {qmDetails.careTerms.map((m) => (
                      <th key={m} className="th-center">
                        m{m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {qmDetails.primeImplicants.map((pi, piIdx) => {
                    const isEssential = Boolean(pi.essential);
                    const coverSet = new Set(pi.covers);

                    return (
                      <tr
                        key={piIdx}
                        className={`${isEssential ? 'essential-row' : ''} ${
                          hoveredGroup !== null &&
                          kmapGroupData?.groups[hoveredGroup]?.implicant.bits.join('') === pi.bits.join('')
                            ? 'selected-group-row'
                            : ''
                        }`}
                        onMouseEnter={() => {
                          const index = kmapGroupData?.groups.findIndex(
                            (group) => group.implicant.bits.join('') === pi.bits.join('')
                          );
                          setHoveredGroup(index !== undefined && index >= 0 ? index : null);
                        }}
                      >
                        <td>
                          <code className="font-mono">{pi.bits.join('')}</code>
                          {isEssential && <span className="epi-badge">EPI</span>}
                        </td>
                        <td className="text-muted font-mono">{pi.covers.join(', ')}</td>
                        {qmDetails.careTerms.map((m) => (
                          <td key={m} className="td-center">
                            {coverSet.has(m) ? <span className="check-mark">✕</span> : '·'}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Action Footer */}
      {!embedded && (
        <div className="action-footer">
          <button className="btn-secondary" onClick={() => navigate('/truth-table')}>
            ← Back to Truth Table
          </button>
          <button className="btn-primary-large" onClick={handleProceedToCircuit}>
            Synthesize Circuit Schematic →
          </button>
        </div>
      )}
    </div>
  );
};
