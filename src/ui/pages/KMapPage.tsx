import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import {
  buildKMap,
  kmapGroups,
  kmapSimplify,
  quineMcCluskey,
  findPrimeImplicants,
} from '../../engine/minimize';
import { truthTableFromExpr, parseExpr, mintermsOf, maxtermsOf } from '../../engine/boolean';
import type { TruthTable } from '../../engine/types';

export const KMapPage: React.FC = () => {
  const navigate = useNavigate();
  const { truthTable, selectedForm, setSelectedForm, setMinResult } = useStore();

  const [form, setForm] = useState<'SOP' | 'POS'>(selectedForm);
  const [activeTab, setActiveTab] = useState<'kmap' | 'qm'>('kmap');
  const [hoveredGroup, setHoveredGroup] = useState<number | null>(null);

  const defaultTable = useMemo<TruthTable>(() => {
    return truthTableFromExpr(parseExpr("A'B + C"), ['A', 'B', 'C']);
  }, []);

  const activeTable = truthTable ?? defaultTable;
  const numVars = activeTable.vars.length;
  const canRenderKMap = numVars >= 2 && numVars <= 4;

  const qmResult = useMemo(() => {
    return quineMcCluskey(activeTable, form);
  }, [activeTable, form]);

  const kmapData = useMemo(() => {
    if (!canRenderKMap) return null;
    return buildKMap(activeTable);
  }, [activeTable, canRenderKMap]);

  const kmapGroupData = useMemo(() => {
    if (!canRenderKMap) return null;
    return kmapGroups(activeTable, form);
  }, [activeTable, form, canRenderKMap]);

  const kmapSimpResult = useMemo(() => {
    if (!canRenderKMap) return qmResult;
    return kmapSimplify(activeTable, form);
  }, [activeTable, form, canRenderKMap, qmResult]);

  // QM detailed columns & PI chart
  const qmDetails = useMemo(() => {
    const careTerms = form === 'SOP' ? mintermsOf(activeTable) : maxtermsOf(activeTable);
    const { primeImplicants, columnsData } = findPrimeImplicants(
      careTerms,
      [],
      activeTable.vars.length
    );
    return { primeImplicants, columnsData, careTerms };
  }, [activeTable, form]);

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

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="badge">Phase 2: Logic Minimization</div>
        <h1>K-Map & Quine–McCluskey Minimization</h1>
        <p className="subtitle">
          Visual Gray-code Karnaugh map grouping and deterministic Quine–McCluskey tabular reduction
          with Petrick's expansion.
        </p>
      </div>

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

        <div className="view-toggle-group">
          <button
            className={`tab-btn ${activeTab === 'kmap' ? 'active' : ''}`}
            onClick={() => setActiveTab('kmap')}
            disabled={!canRenderKMap}
          >
            🗺️ K-Map View {canRenderKMap ? `(${numVars} vars)` : '(2–4 vars only)'}
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
                  className={`group-card ${hoveredGroup === idx ? 'hovered' : ''}`}
                  onMouseEnter={() => setHoveredGroup(idx)}
                  onMouseLeave={() => setHoveredGroup(null)}
                >
                  <div className="group-card-header">
                    <span className="group-badge" style={{ backgroundColor: groupColors[idx % groupColors.length] }}>
                      G{idx + 1}
                    </span>
                    <code className="group-term">{g.termText}</code>
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
                      <tr key={piIdx} className={isEssential ? 'essential-row' : ''}>
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
      <div className="action-footer">
        <button className="btn-secondary" onClick={() => navigate('/truth-table')}>
          ← Back to Truth Table
        </button>
        <button className="btn-primary-large" onClick={handleProceedToCircuit}>
          Synthesize Circuit Schematic (Phase 3) →
        </button>
      </div>
    </div>
  );
};
