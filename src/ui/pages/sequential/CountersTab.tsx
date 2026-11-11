import React, { useState, useMemo, useCallback } from 'react';
import type { Netlist, FlipFlop, Gate } from '../../../engine/types';
import { stepClock } from '../../../engine/sequential/simulate-seq';
import { syncCounter, modNCounter, ringCounter, johnsonCounter, shiftRegister, analyzeUnusedStates } from '../../../engine/sequential/library';
import { SchematicView } from './lazy';

export function CountersTab() {
  const [selectedCircuitKey, setSelectedCircuitKey] = useState('sync_jk_2');
  const [circuitClockCount, setCircuitClockCount] = useState(0);
  const [circuitStateHistory, setCircuitStateHistory] = useState<string[]>([]);
  const [currentCircuitState, setCurrentCircuitState] = useState<Record<string, 0 | 1>>({});
  const [circuitInputValues, setCircuitInputValues] = useState<Record<string, 0 | 1>>({});

  const standardCircuits = useMemo<Record<string, { label: string; getNetlist: () => Netlist }>>(() => ({
    sync_jk_2: { label: '2-bit Sync Up (JK-FF)', getNetlist: () => syncCounter(2, 'up', 'JK') },
    sync_t_3: { label: '3-bit Sync Up (T-FF)', getNetlist: () => syncCounter(3, 'up', 'T') },
    sync_t_4: { label: '4-bit Sync Up (T-FF)', getNetlist: () => syncCounter(4, 'up', 'T') },
    sync_down_3: { label: '3-bit Sync Down (T-FF)', getNetlist: () => syncCounter(3, 'down', 'T') },
    sync_updown_3: { label: '3-bit Sync Up/Down (JK-FF)', getNetlist: () => syncCounter(3, 'updown', 'JK') },
    mod6_d: { label: 'Mod-6 Counter (0–5, D-FF)', getNetlist: () => modNCounter(6) },
    mod10_d: { label: 'Mod-10 BCD Counter (0–9)', getNetlist: () => modNCounter(10) },
    ring_4: { label: '4-bit Ring Counter', getNetlist: () => ringCounter(4) },
    johnson_3: { label: '3-bit Johnson Counter', getNetlist: () => johnsonCounter(3) },
    sipo_4: { label: '4-bit SIPO Shift Register', getNetlist: () => shiftRegister('SIPO', 4) },
    universal_4: { label: '4-bit Universal Shift Reg', getNetlist: () => shiftRegister('universal', 4) },
  }), []);

  const activeCircuitNetlist = useMemo(() => {
    const entry = standardCircuits[selectedCircuitKey];
    return entry ? entry.getNetlist() : null;
  }, [selectedCircuitKey, standardCircuits]);

  const unusedStatesInfo = useMemo(() => {
    if (selectedCircuitKey.startsWith('mod6_d')) {
      return analyzeUnusedStates(modNCounter(6), ['000', '001', '010', '011', '100', '101']);
    }
    if (selectedCircuitKey.startsWith('mod10_d')) {
      const valid = Array.from({ length: 10 }, (_, i) => i.toString(2).padStart(4, '0'));
      return analyzeUnusedStates(modNCounter(10), valid);
    }
    return null;
  }, [selectedCircuitKey]);

  const handleStepCircuit = useCallback(() => {
    if (!activeCircuitNetlist) return;
    const dummyInputs: Record<string, 0 | 1> = { ...circuitInputValues, CLK: 1 };
    for (const inp of activeCircuitNetlist.inputs) {
      if (inp !== 'CLK') dummyInputs[inp] ??= 0;
    }
    const res = stepClock(activeCircuitNetlist, currentCircuitState, dummyInputs);
    setCurrentCircuitState(res.state);

    const flops = activeCircuitNetlist.nodes.filter((n) => n.kind === 'ff') as FlipFlop[];
    const stateBits = flops
      .slice()
      .reverse()
      .map((f) => res.state[f.q] ?? 0)
      .join('');
    setCircuitStateHistory((prev) => [...prev.slice(-15), stateBits]);
    setCircuitClockCount((c) => c + 1);
  }, [activeCircuitNetlist, currentCircuitState, circuitInputValues]);

  const handleResetCircuit = useCallback(() => {
    if (!activeCircuitNetlist) return;
    const flops = activeCircuitNetlist.nodes.filter((n) => n.kind === 'ff') as FlipFlop[];
    const initVals: Record<string, 0 | 1> = {};
    for (const f of flops) initVals[f.q] = f.init ?? 0;
    setCurrentCircuitState(initVals);
    setCircuitClockCount(0);
    setCircuitStateHistory([]);
  }, [activeCircuitNetlist]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space' || e.code === 'ArrowRight') {
        e.preventDefault();
        handleStepCircuit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleStepCircuit]);

  return (
    <>
        <div className="tab-pane-sequential">
          <div className="dp-panel u-mb-4">
            <h3 className="card-title">Circuit Catalog</h3>
            <div className="dp-chips">
              {Object.entries(standardCircuits).map(([key, item]) => (
                <button
                  key={key}
                  className={`dp-chip ${selectedCircuitKey === key ? 'is-on' : ''}`}
                  onClick={() => {
                    setSelectedCircuitKey(key);
                    setCurrentCircuitState({});
                    setCircuitClockCount(0);
                    setCircuitStateHistory([]);
                    setCircuitInputValues(Object.fromEntries(
                      item.getNetlist().inputs.filter((input) => input !== 'CLK').map((input) => [input, 0])
                    ));
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {activeCircuitNetlist && (
            <>
              {/* Stepper Toolbar */}
              {activeCircuitNetlist.inputs.filter((input) => input !== 'CLK').length > 0 && (
                <div className="circuit-input-switches">
                  <span className="switch-label">Circuit inputs:</span>
                  {activeCircuitNetlist.inputs.filter((input) => input !== 'CLK').map((input) => (
                    <button
                      key={input}
                      className={`input-switch ${(circuitInputValues[input] ?? 0) === 1 ? 'on' : 'off'}`}
                      onClick={() => setCircuitInputValues((current) => ({
                        ...current,
                        [input]: current[input] === 1 ? 0 : 1,
                      }))}
                    >
                      <span className="switch-name">{input}</span>
                      <span className="switch-val">{circuitInputValues[input] ?? 0}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="circuit-stats-bar">
                <div className="dp-stat">
                  <span className="stat-label">Clock Pulses</span>
                  <span className="stat-value">{circuitClockCount}</span>
                </div>
                <div className="dp-stat variant-chip">
                  <span className="stat-label">Current State (Binary)</span>
                  <span className="stat-value">
                    {activeCircuitNetlist.nodes
                      .filter((n) => n.kind === 'ff')
                      .slice()
                      .reverse()
                      .map((f) => currentCircuitState[(f as FlipFlop).q] ?? 0)
                      .join('') || '0'}
                  </span>
                </div>
                <div className="dp-stat type-chip">
                  <span className="stat-label">Decimal Value</span>
                  <span className="stat-value">
                    {(() => {
                      const flops = activeCircuitNetlist.nodes.filter((n) => n.kind === 'ff') as FlipFlop[];
                      let dec = 0;
                      for (let i = 0; i < flops.length; i++) {
                        dec |= (currentCircuitState[flops[i].q] ?? 0) << i;
                      }
                      return dec;
                    })()}
                  </span>
                </div>
                <div className="circuit-actions u-ml-auto">
                  <button className="btn-primary" onClick={handleStepCircuit}>
                    Step Clock
                  </button>
                  <button className="btn-secondary" onClick={handleResetCircuit}>
                    ↺ Reset
                  </button>
                </div>
              </div>

              {/* State History Log */}
              {circuitStateHistory.length > 0 && (
                <div className="dp-panel u-mb-4 u-pad-compact">
                  <span className="switch-label">Transition Sequence:</span>
                  <div className="u-chips u-mt-1">
                    {circuitStateHistory.map((s, idx) => (
                      <span key={idx} className="seq-badge">
                        {s} {idx < circuitStateHistory.length - 1 ? '→' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Unused State Analysis Card if Mod-N */}
              {unusedStatesInfo && (
                <div className="dp-panel u-mb-4">
                  <h3 className="card-title">Unused States & Self-Starting Analysis</h3>
                  <div className="circuit-stats-bar u-mt-2">
                    <div className="dp-stat">
                      <span className="stat-label">Unused States</span>
                      <span className="stat-value">{unusedStatesInfo.unused.join(', ') || 'None'}</span>
                    </div>
                    <div className="dp-stat type-chip">
                      <span className="stat-label">Self-Starting</span>
                      <span className="stat-value">{unusedStatesInfo.selfStarting ? 'Yes (Pass)' : 'No (Lockup)'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Circuit Gates Summary */}
              <div className="dp-panel u-mb-4">
                <h3 className="card-title">Circuit Schematic</h3>
                <div className="wb-schematic dp-schematic dp-schematic--sm">
                  <React.Suspense fallback={<div className="sch-empty">Routing circuit diagram…</div>}>
                    <SchematicView
                      key={selectedCircuitKey}
                      netlist={activeCircuitNetlist}
                      inputs={{ ...circuitInputValues, ...currentCircuitState }}
                      height={380}
                    />
                  </React.Suspense>
                </div>
              </div>

              <div className="dp-panel">
                <h3 className="card-title">Synthesized Netlist Nodes</h3>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Node ID</th>
                        <th>Kind</th>
                        <th>Type</th>
                        <th>Inputs / Pins</th>
                        <th>Output Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeCircuitNetlist.nodes.map((n) => (
                        <tr key={n.id}>
                          <td className="mono-cell">{n.id}</td>
                          <td>{n.kind}</td>
                          <td className="mono-cell highlight-cell">{n.kind === 'gate' ? (n as Gate).type : n.kind === 'ff' ? (n as FlipFlop).type : '-'}</td>
                          <td className="mono-cell">
                            {n.kind === 'gate'
                              ? (n as Gate).inputs.join(', ')
                              : n.kind === 'ff'
                              ? `CLK=${(n as FlipFlop).clk}, D=${(n as FlipFlop).d ?? '-'}`
                              : '-'}
                          </td>
                          <td className="mono-cell">
                            {n.kind === 'gate' ? (n as Gate).output : n.kind === 'ff' ? (n as FlipFlop).q : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
    </>
  );
}
