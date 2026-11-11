import React, { useState, useMemo, useCallback } from 'react';
import { useStore } from '../../../store';
import type { FFType, StateTable, FlipFlop } from '../../../engine/types';
import { validateStateTable, reduceStates, designFSM } from '../../../engine/sequential/fsm';
import { SchematicView } from './lazy';
import { StateDiagramSVG } from './StateDiagram';
import { PRESET_FSMS } from './presets';

export function FsmTab() {
  const { stateTable, setStateTable, setDesignedNetlist } = useStore();
  const [fsmStateTable, setFsmStateTable] = useState<StateTable>(stateTable ?? PRESET_FSMS[0].st);
  const [fsmDesignFF, setFsmDesignFF] = useState<FFType>('D');
  const [fsmStrategy, setFsmStrategy] = useState<'binary' | 'gray' | 'one-hot'>('binary');
  const [designResult, setDesignResult] = useState<ReturnType<typeof designFSM> | null>(null);
  const [reductionResult, setReductionResult] = useState<ReturnType<typeof reduceStates> | null>(null);

  const fsmValidationErrors = useMemo(() => validateStateTable(fsmStateTable), [fsmStateTable]);

  const updateFSMRow = useCallback((rowIndex: number, field: 'next' | 'output', value: string) => {
    setFsmStateTable((current) => ({
      ...current,
      rows: current.rows.map((row, index) => index === rowIndex ? { ...row, [field]: value } : row),
    }));
    setDesignResult(null);
    setReductionResult(null);
  }, [setFsmStateTable, setDesignResult, setReductionResult]);

  const handleLoadPreset = useCallback((preset: StateTable) => {
    setFsmStateTable(preset);
    setDesignResult(null);
    setReductionResult(null);
  }, []);

  const handleReduceStates = useCallback(() => {
    const res = reduceStates(fsmStateTable);
    setReductionResult(res);
    setFsmStateTable(res.reduced);
  }, [fsmStateTable]);

  const handleDesignFSM = useCallback(() => {
    if (fsmValidationErrors.length > 0) return;
    const result = designFSM(fsmStateTable, fsmDesignFF, fsmStrategy);
    setDesignResult(result);
    setStateTable(fsmStateTable);
    setDesignedNetlist(result.netlist);
  }, [fsmStateTable, fsmDesignFF, fsmStrategy, fsmValidationErrors, setStateTable, setDesignedNetlist]);

  return (
    <>
        <div className="tab-pane-sequential">
          {/* Preset Buttons */}
          <div className="dp-panel u-mb-4">
            <h3 className="card-title">Load FSM Presets</h3>
            <div className="u-wrap u-mt-2">
              {PRESET_FSMS.map((p) => (
                <button
                  key={p.name}
                  className="btn-secondary"
                  onClick={() => handleLoadPreset(p.st)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Validation Banner */}
          {fsmValidationErrors.length > 0 ? (
            <div className="verify-badge fail u-mb-4">
              {fsmValidationErrors.map((err, i) => (
                <div key={i}>✗ {err}</div>
              ))}
            </div>
          ) : (
            <div className="verify-badge pass u-mb-4">
              ✓ State table is complete, deterministic, and valid
            </div>
          )}

          <div className="fsm-grid-layout">
            {/* Left: State Table */}
            <div className="dp-panel">
              <div className="u-between">
                <h3 className="card-title">State Transition Table ({fsmStateTable.model.toUpperCase()})</h3>
                <div className="u-row u-row--tight">
                  <button className="btn-primary" onClick={handleReduceStates}>
                    Reduce States
                  </button>
                </div>
              </div>

              <div className="table-wrapper u-mt-3">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Present State</th>
                      <th>Input</th>
                      <th>Next State</th>
                      <th>Output</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fsmStateTable.rows.map((r, i) => (
                      <tr key={i}>
                        <td className="mono-cell highlight-cell">{r.state}</td>
                        <td className="mono-cell">{r.input}</td>
                        <td>
                          <select
                            aria-label={`Next state for row ${i + 1}`}
                            value={r.next}
                            onChange={(event) => updateFSMRow(i, 'next', event.target.value)}
                          >
                            {fsmStateTable.states.map((state) => <option key={state} value={state}>{state}</option>)}
                          </select>
                        </td>
                        <td>
                          <input
                            aria-label={`Output for row ${i + 1}`}
                            className="text-field"
                            value={r.output}
                            onChange={(event) => updateFSMRow(i, 'output', event.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* State Reduction Feedback */}
              {reductionResult && (
                <div className="u-mt-3">
                  <div className="verify-badge pass">
                    {reductionResult.classes.every((group) => group.length === 1)
                      ? `✓ Already minimal (${reductionResult.reduced.states.length} states).`
                      : `✓ Reduced from ${reductionResult.classes.reduce((count, group) => count + group.length, 0)} to ${reductionResult.reduced.states.length} states.`}
                  </div>
                  <div className="u-caption u-muted u-mt-1">
                    Equivalence classes: {reductionResult.classes.map((c) => `{${c.join(', ')}}`).join(', ')}
                  </div>
                </div>
              )}
            </div>

            {/* Right: State Diagram SVG */}
            <div className="dp-panel u-col-center">
              <h3 className="card-title u-self-start">State Transition Diagram</h3>
              <StateDiagramSVG st={fsmStateTable} />
            </div>
          </div>

          {/* Design Settings Bar */}
          <div className="dp-panel u-mt-4">
            <h3 className="card-title">Automated Synthesis Configuration</h3>
            <div className="dp-controls u-my-3">
              <div className="u-row">
                <span className="switch-label">Flip-Flop Type:</span>
                {(['D', 'T', 'JK'] as FFType[]).map((ff) => (
                  <button
                    key={ff}
                    className={fsmDesignFF === ff ? 'is-on' : undefined}
                    onClick={() => setFsmDesignFF(ff)}
                  >
                    {ff}
                  </button>
                ))}
              </div>

              <div className="u-row">
                <span className="switch-label">State Encoding:</span>
                {(['binary', 'gray', 'one-hot'] as const).map((strat) => (
                  <button
                    key={strat}
                    className={fsmStrategy === strat ? 'is-on' : undefined}
                    onClick={() => setFsmStrategy(strat)}
                  >
                    {strat}
                  </button>
                ))}
              </div>

              <button className="btn-primary" onClick={handleDesignFSM}>
                Synthesize Gate-Level Netlist
              </button>
            </div>
          </div>

          {/* Synthesis Results */}
          {designResult && (
            <div className="dp-panel u-mt-4">
              <h3 className="card-title">Synthesized Excitation & Output Equations</h3>
              <div className="circuit-stats-bar u-mt-3">
                {Object.entries(designResult.flipFlopInputEquations).map(([inp, eq]) => (
                  <div key={inp} className="dp-stat variant-chip">
                    <span className="stat-label">{inp}</span>
                    <span className="stat-value">{eq || '0'}</span>
                  </div>
                ))}
                {Object.entries(designResult.outputEquations).map(([out, eq]) => (
                  <div key={out} className="dp-stat type-chip">
                    <span className="stat-label">{out}</span>
                    <span className="stat-value">{eq || '0'}</span>
                  </div>
                ))}
              </div>
              <div className="verify-badge pass u-mt-3">
                ✓ Generated Netlist with {designResult.netlist.nodes.length} nodes saved to global workspace!
              </div>
              <div className="dp-panel u-mt-4">
                <h3 className="card-title">Synthesized Circuit Schematic</h3>
                <div className="wb-schematic dp-schematic">
                  <React.Suspense fallback={<div className="sch-empty">Routing synthesized FSM schematic…</div>}>
                    <SchematicView
                      key={`fsm-${designResult.netlist.name}-${fsmDesignFF}-${fsmStrategy}`}
                      netlist={designResult.netlist}
                      height={440}
                    />
                  </React.Suspense>
                </div>
              </div>
              <div className="circuit-stats-bar u-mt-3">
                {designResult.netlist.nodes
                  .filter((node): node is FlipFlop => node.kind === 'ff')
                  .map((ff) => (
                    <div className="dp-stat variant-chip" key={ff.id} aria-label={`${ff.type} flip-flop ${ff.q}`}>
                      <span className="stat-label">{ff.type} · CLK</span>
                      <span className="stat-value">{ff.q} / {ff.qn ?? `${ff.q}′`}</span>
                    </div>
                  ))}
              </div>
              <h4>Transition and Excitation Table</h4>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>{Object.keys(designResult.transitionTable[0] ?? {}).map((key) => <th key={key}>{key}</th>)}</tr>
                  </thead>
                  <tbody>
                    {designResult.transitionTable.map((row, index) => (
                      <tr key={index}>
                        {Object.values(row).map((value, cellIndex) => <td key={cellIndex} className="mono-cell">{String(value)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
    </>
  );
}
