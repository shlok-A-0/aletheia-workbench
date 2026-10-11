import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import {
  parseExpr,
  exprToString,
  collectVars,
  truthTableFromExpr,
  truthTableFromMinterms,
  truthTableFromMaxterms,
  truthTableFromOutputs,
  simplifyAlgebraic,
  ParseError,
} from '../../engine/boolean';
import type { Step, TruthTable } from '../../engine/types';

export const InputPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    rawInput,
    inputMode,
    truthTable,
    mintermsStr,
    maxtermsStr,
    dontCaresStr,
    vars,
    setInput,
    setTruthTable,
    setParsedExpr,
    setVars,
    setMintermsStr,
    setMaxtermsStr,
    setDontCaresStr,
  } = useStore();

  const [activeTab, setActiveTab] = useState<'expr' | 'minterms' | 'maxterms' | 'table'>(inputMode);
  const [exprText, setExprText] = useState(rawInput);

  // Minterms / Maxterms state
  const [numVars, setNumVars] = useState<number>(3);
  const [mInput, setMInput] = useState(mintermsStr);
  const [maxInput, setMaxInput] = useState(maxtermsStr);
  const [dInput, setDInput] = useState(dontCaresStr);

  // Table direct edit state
  const [tableOutputs, setTableOutputs] = useState<(0 | 1 | 'x')[]>(() => {
    if (truthTable && truthTable.rows.length === 1 << numVars) {
      return truthTable.rows.map((r) => r.out);
    }
    return Array(1 << numVars).fill(0);
  });

  // Algebraic Simplification State
  const [simpSteps, setSimpSteps] = useState<Step[] | null>(null);
  const [simpResultText, setSimpResultText] = useState<string | null>(null);

  // Purely derived validation state
  const validation = useMemo(() => {
    if (activeTab !== 'expr') {
      return { error: null, detectedVars: vars };
    }
    const trimmed = exprText.trim();
    if (!trimmed) {
      return { error: null, detectedVars: ['A'] };
    }
    try {
      const ast = parseExpr(trimmed);
      const vList = collectVars(ast);
      return {
        error: null,
        detectedVars: vList.length > 0 ? vList : ['A'],
        ast,
      };
    } catch (err) {
      return {
        error: err instanceof ParseError ? err.message : (err as Error).message,
        detectedVars: vars,
        ast: null,
      };
    }
  }, [activeTab, exprText, vars]);

  const insertOperator = (op: string) => {
    setExprText((prev) => prev + op);
  };

  const handleSimp = () => {
    try {
      const ast = parseExpr(exprText);
      const res = simplifyAlgebraic(ast);
      setSimpResultText(exprToString(res.expr));
      setSimpSteps(res.steps);
    } catch {
      // ignore if invalid
    }
  };

  const parseNumberList = (str: string): number[] => {
    return str
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => !Number.isNaN(n));
  };

  const getVariableNames = (count: number): string[] => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return alphabet.slice(0, count).split('');
  };

  const handleGenerateAndProceed = () => {
    let generatedTT: TruthTable;

    if (activeTab === 'expr') {
      const ast = parseExpr(exprText);
      const vList = collectVars(ast);
      const finalVars = vList.length > 0 ? vList : ['A'];
      generatedTT = truthTableFromExpr(ast, finalVars);
      setInput(exprText, 'expr');
      setParsedExpr(ast);
      setVars(finalVars);
    } else if (activeTab === 'minterms') {
      const vList = getVariableNames(numVars);
      const minterms = parseNumberList(mInput);
      const dontCares = parseNumberList(dInput);
      generatedTT = truthTableFromMinterms(vList, minterms, dontCares);
      setInput(mInput, 'minterms');
      setMintermsStr(mInput);
      setDontCaresStr(dInput);
      setVars(vList);
    } else if (activeTab === 'maxterms') {
      const vList = getVariableNames(numVars);
      const maxterms = parseNumberList(maxInput);
      const dontCares = parseNumberList(dInput);
      generatedTT = truthTableFromMaxterms(vList, maxterms, dontCares);
      setInput(maxInput, 'maxterms');
      setMaxtermsStr(maxInput);
      setDontCaresStr(dInput);
      setVars(vList);
    } else {
      const vList = getVariableNames(numVars);
      generatedTT = truthTableFromOutputs(vList, tableOutputs);
      setInput('Direct Table', 'table');
      setVars(vList);
    }

    setTruthTable(generatedTT);
    navigate('/truth-table');
  };

  const toggleOutputCell = (index: number) => {
    setTableOutputs((prev) => {
      const next = [...prev];
      const cur = next[index];
      next[index] = cur === 0 ? 1 : cur === 1 ? 'x' : 0;
      return next;
    });
  };

  const loadPreset = (_name: string, expr: string) => {
    setExprText(expr);
    setActiveTab('expr');
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="badge">Phase 1: Input Specification</div>
        <h1>Boolean Function & Input Specification</h1>
        <p className="subtitle">
          Specify your logic function through algebraic formulas, standard minterm/maxterm
          indices, or direct truth table output editing.
        </p>
      </div>

      {/* Tabs */}
      <div className="input-tabs">
        <button
          className={`tab-btn ${activeTab === 'expr' ? 'active' : ''}`}
          onClick={() => setActiveTab('expr')}
        >
          📝 Boolean Expression
        </button>
        <button
          className={`tab-btn ${activeTab === 'minterms' ? 'active' : ''}`}
          onClick={() => setActiveTab('minterms')}
        >
          Σm Minterms
        </button>
        <button
          className={`tab-btn ${activeTab === 'maxterms' ? 'active' : ''}`}
          onClick={() => setActiveTab('maxterms')}
        >
          ΠM Maxterms
        </button>
        <button
          className={`tab-btn ${activeTab === 'table' ? 'active' : ''}`}
          onClick={() => setActiveTab('table')}
        >
          📊 Direct Table
        </button>
      </div>

      {/* TAB 1: EXPRESSION */}
      {activeTab === 'expr' && (
        <div className="glass-card input-card">
          <div className="card-header">
            <h3>Boolean Algebraic Expression</h3>
            <span className="info-tag">Supports A-Z, NOT ('), AND, OR (+), XOR (^), XNOR (~^)</span>
          </div>

          <div className="formula-input-wrapper">
            <input
              type="text"
              className={`formula-input ${validation.error ? 'input-error' : ''}`}
              value={exprText}
              onChange={(e) => setExprText(e.target.value)}
              placeholder="e.g. A'B + C or A ^ B"
              spellCheck={false}
            />
          </div>

          {validation.error ? (
            <div className="error-banner">
              <span className="error-icon">⚠️</span>
              <span>{validation.error}</span>
            </div>
          ) : (
            <div className="success-banner">
              <span className="success-icon">✓</span>
              <span>
                Valid syntax. Detected variables: <strong>{validation.detectedVars.join(', ')}</strong> ({1 << validation.detectedVars.length} rows)
              </span>
            </div>
          )}

          {/* Quick-insert toolbar */}
          <div className="operator-toolbar">
            <span className="toolbar-label">Quick Symbols:</span>
            <button className="op-chip" onClick={() => insertOperator("'")}>NOT (')</button>
            <button className="op-chip" onClick={() => insertOperator(' + ')}>OR (+)</button>
            <button className="op-chip" onClick={() => insertOperator(' * ')}>AND (*)</button>
            <button className="op-chip" onClick={() => insertOperator(' ^ ')}>XOR (^)</button>
            <button className="op-chip" onClick={() => insertOperator(' ~^ ')}>XNOR (~^)</button>
            <button className="op-chip" onClick={() => insertOperator('(')}>(</button>
            <button className="op-chip" onClick={() => insertOperator(')')}>)</button>
          </div>

          {/* Presets */}
          <div className="presets-container">
            <span className="toolbar-label">LDAM Lab Presets:</span>
            <button className="preset-chip" onClick={() => loadPreset('Adder', 'A ^ B ^ C')}>
              Full Adder Sum (A ^ B ^ C)
            </button>
            <button className="preset-chip" onClick={() => loadPreset('Mux', "S'A + SB")}>
              2:1 MUX (S'A + SB)
            </button>
            <button className="preset-chip" onClick={() => loadPreset('Majority', 'AB + BC + AC')}>
              Majority Vote (AB + BC + AC)
            </button>
            <button className="preset-chip" onClick={() => loadPreset('Absorption', "A + A'B")}>
              Absorption (A + A'B)
            </button>
          </div>

          {/* Algebraic Simplification Trigger */}
          <div className="algebraic-section">
            <button
              className="btn-secondary"
              onClick={handleSimp}
              disabled={Boolean(validation.error) || !exprText.trim()}
            >
              ⚡ Run Algebraic Theorem Simplification
            </button>

            {simpResultText && simpSteps && (
              <div className="simplification-results">
                <div className="simp-header">
                  <strong>Simplified Result: </strong>
                  <code className="simp-result-code">{simpResultText}</code>
                </div>
                <div className="steps-accordion">
                  <div className="steps-title">Derivation Steps ({simpSteps.length}):</div>
                  {simpSteps.map((s, idx) => (
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
            )}
          </div>
        </div>
      )}

      {/* TAB 2: MINTERMS */}
      {activeTab === 'minterms' && (
        <div className="glass-card input-card">
          <div className="card-header">
            <h3>Canonical Minterms Specification (Σm)</h3>
          </div>

          <div className="var-count-selector">
            <label>Number of Variables (n):</label>
            <div className="count-btns">
              {[2, 3, 4, 5, 6].map((cnt) => (
                <button
                  key={cnt}
                  className={`btn-count ${numVars === cnt ? 'active' : ''}`}
                  onClick={() => setNumVars(cnt)}
                >
                  {cnt} ({getVariableNames(cnt).join('')})
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Minterm Indices (comma-separated, 0 to {(1 << numVars) - 1}):</label>
            <input
              type="text"
              className="text-field"
              value={mInput}
              onChange={(e) => setMInput(e.target.value)}
              placeholder="e.g. 1, 3, 5, 7"
            />
          </div>

          <div className="form-group">
            <label>Don't-Care Indices (optional d, 0 to {(1 << numVars) - 1}):</label>
            <input
              type="text"
              className="text-field"
              value={dInput}
              onChange={(e) => setDInput(e.target.value)}
              placeholder="e.g. 0, 2"
            />
          </div>
        </div>
      )}

      {/* TAB 3: MAXTERMS */}
      {activeTab === 'maxterms' && (
        <div className="glass-card input-card">
          <div className="card-header">
            <h3>Canonical Maxterms Specification (ΠM)</h3>
          </div>

          <div className="var-count-selector">
            <label>Number of Variables (n):</label>
            <div className="count-btns">
              {[2, 3, 4, 5, 6].map((cnt) => (
                <button
                  key={cnt}
                  className={`btn-count ${numVars === cnt ? 'active' : ''}`}
                  onClick={() => setNumVars(cnt)}
                >
                  {cnt} ({getVariableNames(cnt).join('')})
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Maxterm Indices (comma-separated, 0 to {(1 << numVars) - 1}):</label>
            <input
              type="text"
              className="text-field"
              value={maxInput}
              onChange={(e) => setMaxInput(e.target.value)}
              placeholder="e.g. 0, 2, 4, 6"
            />
          </div>

          <div className="form-group">
            <label>Don't-Care Indices (optional d, 0 to {(1 << numVars) - 1}):</label>
            <input
              type="text"
              className="text-field"
              value={dInput}
              onChange={(e) => setDInput(e.target.value)}
              placeholder="e.g. 1, 5"
            />
          </div>
        </div>
      )}

      {/* TAB 4: DIRECT TABLE */}
      {activeTab === 'table' && (
        <div className="glass-card input-card">
          <div className="card-header">
            <h3>Direct Truth Table Output Editor</h3>
            <span className="info-tag">Click any cell in the Output (Y) column to cycle: 0 → 1 → x</span>
          </div>

          <div className="var-count-selector">
            <label>Variables:</label>
            <div className="count-btns">
              {[2, 3, 4].map((cnt) => (
                <button
                  key={cnt}
                  className={`btn-count ${numVars === cnt ? 'active' : ''}`}
                  onClick={() => {
                    setNumVars(cnt);
                    setTableOutputs(Array(1 << cnt).fill(0));
                  }}
                >
                  {cnt} ({getVariableNames(cnt).join('')})
                </button>
              ))}
            </div>
          </div>

          <div className="quick-table-scroll">
            <table className="ldam-table">
              <thead>
                <tr>
                  <th>Row</th>
                  {getVariableNames(numVars).map((v) => (
                    <th key={v}>{v}</th>
                  ))}
                  <th>Output (Y) [Click to Toggle]</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 1 << numVars }).map((_, idx) => {
                  const outVal = tableOutputs[idx] ?? 0;
                  return (
                    <tr key={idx}>
                      <td className="row-idx">{idx}</td>
                      {getVariableNames(numVars).map((_, bit) => {
                        const val = (idx >> (numVars - 1 - bit)) & 1;
                        return <td key={bit} className="bit-cell">{val}</td>;
                      })}
                      <td className="interactive-out-cell">
                        <button
                          className={`out-toggle-btn out-${outVal}`}
                          onClick={() => toggleOutputCell(idx)}
                        >
                          {outVal}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Action Footer */}
      <div className="action-footer">
        <button
          className="btn-primary-large"
          onClick={handleGenerateAndProceed}
          disabled={activeTab === 'expr' && Boolean(validation.error)}
        >
          🚀 Analyze & Generate Truth Table →
        </button>
      </div>
    </div>
  );
};
