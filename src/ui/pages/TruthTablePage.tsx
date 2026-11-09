import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import {
  truthTableFromExpr,
  parseExpr,
  mintermsOf,
  maxtermsOf,
  dontCaresOf,
  canonicalSOP,
  canonicalPOS,
} from '../../engine/boolean';
import type { TruthTable } from '../../engine/types';

export const TruthTablePage: React.FC = () => {
  const navigate = useNavigate();
  const { truthTable, setTruthTable } = useStore();

  const defaultTable = useMemo<TruthTable>(() => {
    return truthTableFromExpr(parseExpr("A'B + C"), ['A', 'B', 'C']);
  }, []);

  const activeTable = truthTable ?? defaultTable;
  const [copiedType, setCopiedType] = useState<'sop' | 'pos' | null>(null);

  const minterms = mintermsOf(activeTable);
  const maxterms = maxtermsOf(activeTable);
  const dontCares = dontCaresOf(activeTable);

  const sop = canonicalSOP(activeTable);
  const pos = canonicalPOS(activeTable);

  const toggleRowOutput = (rowIndex: number) => {
    const updatedRows = activeTable.rows.map((row) => {
      if (row.index === rowIndex) {
        const nextVal = row.out === 0 ? 1 : row.out === 1 ? 'x' : 0;
        return { ...row, out: nextVal as 0 | 1 | 'x' };
      }
      return row;
    });

    const newTable: TruthTable = {
      vars: [...activeTable.vars],
      rows: updatedRows,
    };

    setTruthTable(newTable);
  };

  const copyToClipboard = (text: string, type: 'sop' | 'pos') => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Truth Table & Canonical SOP / POS</h1>
        <p className="subtitle">
          Comprehensive truth table evaluation across all 2<sup>{activeTable.vars.length}</sup> minterms,
          with standard Σm / ΠM designations and expanded canonical forms.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Variables</span>
          <span className="stat-value">{activeTable.vars.join(', ')}</span>
          <span className="stat-sub">{activeTable.vars.length} inputs (n)</span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Total Rows</span>
          <span className="stat-value">{activeTable.rows.length}</span>
          <span className="stat-sub">2<sup>{activeTable.vars.length}</sup> combinations</span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Minterms (Σm)</span>
          <span className="stat-value text-emerald">{minterms.length}</span>
          <span className="stat-sub">Indices: {minterms.length > 0 ? minterms.join(', ') : 'None'}</span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Maxterms (ΠM)</span>
          <span className="stat-value text-slate">{maxterms.length}</span>
          <span className="stat-sub">Indices: {maxterms.length > 0 ? maxterms.join(', ') : 'None'}</span>
        </div>

        {dontCares.length > 0 && (
          <div className="stat-card">
            <span className="stat-label">Don't-Cares (d)</span>
            <span className="stat-value text-amber">{dontCares.length}</span>
            <span className="stat-sub">Indices: {dontCares.join(', ')}</span>
          </div>
        )}
      </div>

      {/* Canonical Forms Section */}
      <div className="canonical-cards-grid">
        {/* Canonical SOP */}
        <div className="glass-card canonical-card">
          <div className="card-header">
            <div className="canonical-title">
              <span className="form-tag sop">SOP</span>
              <h3>Canonical Sum of Minterms</h3>
            </div>
            <button
              className="btn-copy"
              onClick={() => copyToClipboard(sop.text, 'sop')}
              title="Copy Canonical SOP to clipboard"
            >
              {copiedType === 'sop' ? '✓ Copied' : '📋 Copy SOP'}
            </button>
          </div>
          <div className="notation-badge">
            Σm({minterms.join(', ')})
          </div>
          <div className="canonical-formula-box">
            <code>{sop.text}</code>
          </div>
        </div>

        {/* Canonical POS */}
        <div className="glass-card canonical-card">
          <div className="card-header">
            <div className="canonical-title">
              <span className="form-tag pos">POS</span>
              <h3>Canonical Product of Maxterms</h3>
            </div>
            <button
              className="btn-copy"
              onClick={() => copyToClipboard(pos.text, 'pos')}
              title="Copy Canonical POS to clipboard"
            >
              {copiedType === 'pos' ? '✓ Copied' : '📋 Copy POS'}
            </button>
          </div>
          <div className="notation-badge">
            ΠM({maxterms.join(', ')})
          </div>
          <div className="canonical-formula-box">
            <code>{pos.text}</code>
          </div>
        </div>
      </div>

      {/* Main Interactive Table */}
      <div className="glass-card table-card">
        <div className="card-header table-card-header">
          <div>
            <h3>Interactive Truth Table</h3>
            <span className="table-subtitle">
              Click any output cell in column <strong>Y</strong> to toggle between <strong>0</strong>, <strong>1</strong>, and <strong>x</strong> (Don't-Care).
            </span>
          </div>
          <div className="legend-pills">
            <span className="legend-pill green">1 = True (Minterm)</span>
            <span className="legend-pill slate">0 = False (Maxterm)</span>
            <span className="legend-pill amber">x = Don't Care</span>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="ldam-table">
            <thead>
              <tr>
                <th className="th-center">Minterm (m)</th>
                <th className="th-center">Binary</th>
                {activeTable.vars.map((v) => (
                  <th key={v} className="th-center">{v}</th>
                ))}
                <th className="th-center">Output (Y)</th>
                <th className="th-left">Designation</th>
              </tr>
            </thead>
            <tbody>
              {activeTable.rows.map((row) => {
                const binaryStr = row.inputs.join('');
                const designation =
                  row.out === 1 ? `m${row.index}` : row.out === 0 ? `M${row.index}` : `d${row.index}`;

                return (
                  <tr key={row.index} className={`row-out-${row.out}`}>
                    <td className="td-center font-mono text-muted">{row.index}</td>
                    <td className="td-center font-mono binary-tag">{binaryStr}</td>
                    {row.inputs.map((val, bIdx) => (
                      <td key={bIdx} className="td-center font-mono bit-val">
                        {val}
                      </td>
                    ))}
                    <td className="td-center">
                      <button
                        className={`out-toggle-btn out-${row.out}`}
                        onClick={() => toggleRowOutput(row.index)}
                        title="Click to toggle (0 → 1 → x)"
                      >
                        {row.out}
                      </button>
                    </td>
                    <td className="td-left designation-cell">
                      <span className={`designation-badge badge-${row.out}`}>{designation}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="action-footer">
        <button
          className="btn-primary-large"
          onClick={() => navigate('/kmap')}
        >
          Proceed to K-Map & Quine–McCluskey Minimizer →
        </button>
      </div>
    </div>
  );
};
