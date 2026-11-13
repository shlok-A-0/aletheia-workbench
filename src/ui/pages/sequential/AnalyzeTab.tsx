import { useMemo } from 'react';
import { useStore } from '../../../store';
import { analyzeCircuit } from '../../../engine/sequential/fsm';
import { StateDiagramSVG } from './StateDiagram';

interface AnalyzeTabProps {
  /** Lets the empty state send the student to the tab that produces a circuit. */
  onGoto?: (tab: 'counters' | 'fsm') => void;
}

/** Reverse-analyses whatever sequential circuit the student last built (Counters or FSM Designer). */
export function AnalyzeTab({ onGoto }: AnalyzeTabProps) {
  const designedNetlist = useStore((state) => state.designedNetlist);

  const { circuitAnalysis, error } = useMemo(() => {
    if (!designedNetlist) return { circuitAnalysis: null, error: null };
    try {
      return { circuitAnalysis: analyzeCircuit(designedNetlist), error: null };
    } catch (e) {
      return { circuitAnalysis: null, error: e instanceof Error ? e.message : 'Analysis failed' };
    }
  }, [designedNetlist]);

  if (!designedNetlist) {
    return (
      <div className="tab-pane-sequential">
        <div className="dp-panel u-mb-4" role="status">
          <h3 className="card-title">No circuit to analyze yet</h3>
          <p className="card-subtitle">
            This tab works backwards from a flip-flop circuit: it extracts the state table, the next-state equations
            and any unused or lock-up states. Build a circuit first, then come back.
          </p>
          <div className="ff-actions u-mt-3">
            <button type="button" className="btn-primary" onClick={() => onGoto?.('fsm')}>Design an FSM</button>
            <button type="button" className="btn-secondary" onClick={() => onGoto?.('counters')}>Build a counter</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
        <div className="tab-pane-sequential">
          <div className="dp-panel u-mb-4">
            <h3 className="card-title">Analyzing: {designedNetlist.name}</h3>
            <p className="card-subtitle">Extracted from the circuit you last generated. It updates when you generate a new one.</p>
            {error && <div className="verify-badge fail" role="alert">{error}</div>}
          </div>

          {circuitAnalysis && (
            <div className="fsm-grid-layout">
              {/* Derived Equations & Lockup status */}
              <div className="dp-panel">
                <h3 className="card-title">Derived Equations & Reachability</h3>
                <div className="circuit-stats-bar u-mt-3">
                  <div className="dp-stat variant-chip">
                    <span className="stat-label">Model</span>
                    <span className="stat-value">{circuitAnalysis.stateTable.model.toUpperCase()}</span>
                  </div>
                  <div className="dp-stat">
                    <span className="stat-label">Unused States</span>
                    <span className="stat-value">{circuitAnalysis.unusedStates.join(', ') || 'None'}</span>
                  </div>
                  <div className={`dp-stat ${circuitAnalysis.lockUp ? 'variant-chip' : 'type-chip'}`}>
                    <span className="stat-label">Lock-up Trap</span>
                    <span className="stat-value">{circuitAnalysis.lockUp ? 'Detected (Warning)' : 'None (Safe)'}</span>
                  </div>
                </div>

                <div className="table-wrapper u-mt-3">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Flip-Flop Output</th>
                        <th>Excitation Equation</th>
                        <th>Characteristic Next-State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(circuitAnalysis.flipFlopInputEquations).map(([q, eq]) => (
                        <tr key={q}>
                          <td className="mono-cell highlight-cell">{q}</td>
                          <td className="mono-cell">{eq}</td>
                          <td className="mono-cell">{circuitAnalysis.nextStateEquations[`${q}+`]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Extracted State Table */}
              <div className="dp-panel">
                <h3 className="card-title">Extracted State Transition Table</h3>
                <div className="table-wrapper u-maxh-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>State</th>
                        <th>Input</th>
                        <th>Next State</th>
                        <th>Output</th>
                      </tr>
                    </thead>
                    <tbody>
                      {circuitAnalysis.stateTable.rows.map((r, i) => (
                        <tr key={i}>
                          <td className="mono-cell highlight-cell">{r.state}</td>
                          <td className="mono-cell">{r.input}</td>
                          <td className="mono-cell highlight-cell">{r.next}</td>
                          <td className="mono-cell">{r.output}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <StateDiagramSVG st={circuitAnalysis.stateTable} />
              </div>
            </div>
          )}
        </div>
    </>
  );
}
