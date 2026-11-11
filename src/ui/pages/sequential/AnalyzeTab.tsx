import { useState, useCallback } from 'react';
import { useStore } from '../../../store';
import type { Netlist } from '../../../engine/types';
import { syncCounter, modNCounter, johnsonCounter } from '../../../engine/sequential/library';
import { analyzeCircuit } from '../../../engine/sequential/fsm';
import { StateDiagramSVG } from './StateDiagram';

export function AnalyzeTab() {
  const designedNetlist = useStore((state) => state.designedNetlist);
  const [analysisNetlistKey, setAnalysisNetlistKey] = useState('current');
  const [circuitAnalysis, setCircuitAnalysis] = useState<ReturnType<typeof analyzeCircuit> | null>(null);

  const handleRunAnalysis = useCallback(() => {
    let targetNL: Netlist | null = null;
    if (analysisNetlistKey === 'current') {
      targetNL = designedNetlist;
    } else if (analysisNetlistKey === 'mod6') {
      targetNL = modNCounter(6);
    } else if (analysisNetlistKey === 'johnson3') {
      targetNL = johnsonCounter(3);
    } else {
      targetNL = syncCounter(2, 'up', 'JK');
    }

    if (targetNL) {
      const res = analyzeCircuit(targetNL);
      setCircuitAnalysis(res);
    }
  }, [analysisNetlistKey, designedNetlist]);

  return (
    <>
        <div className="tab-pane-sequential">
          <div className="dp-panel u-mb-4">
            <h3 className="card-title">Select Target Circuit for Analysis</h3>
            <div className="wb-seg u-mt-2">
              <button
                className={analysisNetlistKey === 'current' ? 'is-on' : undefined}
                onClick={() => setAnalysisNetlistKey('current')}
              >
                Synthesized FSM
              </button>
              <button
                className={analysisNetlistKey === 'mod6' ? 'is-on' : undefined}
                onClick={() => setAnalysisNetlistKey('mod6')}
              >
                Mod-6 Counter
              </button>
              <button
                className={analysisNetlistKey === 'johnson3' ? 'is-on' : undefined}
                onClick={() => setAnalysisNetlistKey('johnson3')}
              >
                3-bit Johnson Counter
              </button>
              <button
                className={analysisNetlistKey === 'sync_jk' ? 'is-on' : undefined}
                onClick={() => setAnalysisNetlistKey('sync_jk')}
              >
                2-bit Sync Counter
              </button>
            </div>
            <div className="u-mt-3">
              <button className="btn-primary" onClick={handleRunAnalysis}>
                Run Circuit Reverse Analysis
              </button>
            </div>
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
