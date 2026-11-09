import React, { useState, useMemo, useCallback } from 'react';
import { useStore } from '../../store';
import type { FFType, StateTable, Netlist, FlipFlop, Gate } from '../../engine/types';
import {
  characteristicTable,
  excitationTable,
  characteristicEquation,
  nextQ,
} from '../../engine/sequential/flipflops';
import { stepClock } from '../../engine/sequential/simulate-seq';
import {
  syncCounter,
  modNCounter,
  ringCounter,
  johnsonCounter,
  shiftRegister,
  analyzeUnusedStates,
} from '../../engine/sequential/library';
import {
  validateStateTable,
  stateDiagramData,
  reduceStates,
  designFSM,
  analyzeCircuit,
} from '../../engine/sequential/fsm';

type SeqTab = 'flipflops' | 'counters' | 'fsm' | 'analyze';

const PRESET_FSMS: { name: string; st: StateTable }[] = [
  {
    name: '1011 Sequence Detector (Mealy)',
    st: {
      model: 'mealy',
      inputs: ['X'],
      outputs: ['Z'],
      states: ['S0', 'S1', 'S2', 'S3'],
      reset: 'S0',
      rows: [
        { state: 'S0', input: '0', next: 'S0', output: '0' },
        { state: 'S0', input: '1', next: 'S1', output: '0' },
        { state: 'S1', input: '0', next: 'S2', output: '0' },
        { state: 'S1', input: '1', next: 'S1', output: '0' },
        { state: 'S2', input: '0', next: 'S0', output: '0' },
        { state: 'S2', input: '1', next: 'S3', output: '0' },
        { state: 'S3', input: '0', next: 'S2', output: '0' },
        { state: 'S3', input: '1', next: 'S1', output: '1' },
      ],
    },
  },
  {
    name: 'Modulo-4 Up Counter (Moore)',
    st: {
      model: 'moore',
      inputs: ['EN'],
      outputs: ['Q1', 'Q0'],
      states: ['A', 'B', 'C', 'D'],
      reset: 'A',
      rows: [
        { state: 'A', input: '0', next: 'A', output: '00' },
        { state: 'A', input: '1', next: 'B', output: '00' },
        { state: 'B', input: '0', next: 'B', output: '01' },
        { state: 'B', input: '1', next: 'C', output: '01' },
        { state: 'C', input: '0', next: 'C', output: '10' },
        { state: 'C', input: '1', next: 'D', output: '10' },
        { state: 'D', input: '0', next: 'D', output: '11' },
        { state: 'D', input: '1', next: 'A', output: '11' },
      ],
    },
  },
  {
    name: 'Reducible 5-State Machine',
    st: {
      model: 'mealy',
      inputs: ['X'],
      outputs: ['Z'],
      states: ['S0', 'S1', 'S2', 'S3', 'S4'],
      reset: 'S0',
      rows: [
        { state: 'S0', input: '0', next: 'S1', output: '0' },
        { state: 'S0', input: '1', next: 'S2', output: '0' },
        { state: 'S1', input: '0', next: 'S3', output: '0' },
        { state: 'S1', input: '1', next: 'S4', output: '1' },
        { state: 'S2', input: '0', next: 'S3', output: '0' },
        { state: 'S2', input: '1', next: 'S4', output: '1' }, // S1 & S2 equivalent!
        { state: 'S3', input: '0', next: 'S0', output: '0' },
        { state: 'S3', input: '1', next: 'S0', output: '0' },
        { state: 'S4', input: '0', next: 'S0', output: '1' },
        { state: 'S4', input: '1', next: 'S0', output: '1' },
      ],
    },
  },
];

/* ────────────────────── State Diagram SVG Component ────────────────────── */

const StateDiagramSVG: React.FC<{ st: StateTable }> = ({ st }) => {
  const { nodes, edges } = useMemo(() => stateDiagramData(st), [st]);

  const count = nodes.length;
  const radius = Math.max(130, Math.min(220, count * 28));
  const width = Math.max(480, (radius + 60) * 2);
  const height = Math.max(380, (radius + 60) * 2);
  const centerX = width / 2;
  const centerY = height / 2;
  const nodeRadius = 26;

  // Circular layout coordinates
  const positions = useMemo(() => {
    return Object.fromEntries(
      nodes.map((n, idx) => {
        const angle = (idx / count) * 2 * Math.PI - Math.PI / 2;
        return [
          n.id,
          {
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle),
          },
        ];
      })
    );
  }, [nodes, count, centerX, centerY, radius]);

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: width }} className="state-diagram-svg">
      <defs>
        <marker
          id="fsm-arrow"
          viewBox="0 0 10 10"
          refX={9}
          refY={5}
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
        </marker>
        <marker
          id="fsm-arrow-self"
          viewBox="0 0 10 10"
          refX={9}
          refY={5}
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#a78bfa" />
        </marker>
      </defs>

      {/* Edges */}
      {edges.map((e, idx) => {
        const from = positions[e.from];
        const to = positions[e.to];
        if (!from || !to) return null;

        if (e.from === e.to) {
          // Self-loop arc
          const lx1 = from.x - 14;
          const ly1 = from.y - nodeRadius;
          const lx2 = from.x + 14;
          const ly2 = from.y - nodeRadius;
          const path = `M ${lx1} ${ly1} C ${from.x - 30} ${from.y - nodeRadius - 40}, ${from.x + 30} ${from.y - nodeRadius - 40}, ${lx2} ${ly2}`;
          return (
            <g key={`edge-${idx}`}>
              <path d={path} fill="none" stroke="#a78bfa" strokeWidth={1.5} markerEnd="url(#fsm-arrow-self)" />
              <text x={from.x} y={from.y - nodeRadius - 26} textAnchor="middle" fill="#c4b5fd" fontSize={10} fontFamily="var(--font-mono)">
                {e.label}
              </text>
            </g>
          );
        }

        // Inter-node curved arc
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.hypot(dx, dy);
        const ux = dx / dist;
        const uy = dy / dist;

        // Offset from border of node
        const sx = from.x + ux * nodeRadius;
        const sy = from.y + uy * nodeRadius;
        const ex = to.x - ux * (nodeRadius + 4);
        const ey = to.y - uy * (nodeRadius + 4);

        // Control point curve
        const midX = (sx + ex) / 2;
        const midY = (sy + ey) / 2;
        const curveOffset = 24;
        const cx = midX - uy * curveOffset;
        const cy = midY + ux * curveOffset;

        return (
          <g key={`edge-${idx}`}>
            <path
              d={`M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`}
              fill="none"
              stroke="#0284c7"
              strokeWidth={1.5}
              markerEnd="url(#fsm-arrow)"
            />
            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              fill="#7dd3fc"
              fontSize={10.5}
              fontWeight={600}
              fontFamily="var(--font-mono)"
            >
              {e.label}
            </text>
          </g>
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const p = positions[n.id];
        if (!p) return null;
        const isReset = n.id === st.reset;
        return (
          <g key={n.id}>
            <circle
              cx={p.x}
              cy={p.y}
              r={nodeRadius}
              fill={isReset ? 'rgba(0, 210, 255, 0.15)' : 'rgba(15, 23, 42, 0.85)'}
              stroke={isReset ? '#00d2ff' : '#475569'}
              strokeWidth={isReset ? 2 : 1.5}
            />
            <text
              x={p.x}
              y={n.output ? p.y - 4 : p.y + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#f8fafc"
              fontSize={12}
              fontWeight={700}
              fontFamily="var(--font-mono)"
            >
              {n.label}
            </text>
            {n.output && (
              <text
                x={p.x}
                y={p.y + 11}
                textAnchor="middle"
                fill="#38bdf8"
                fontSize={9.5}
                fontWeight={600}
                fontFamily="var(--font-mono)"
              >
                /{n.output}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

/* ────────────────────── Main SequentialPage Component ────────────────────── */

export const SequentialPage: React.FC = () => {
  const {
    stateTable,
    setStateTable,
    setDesignedNetlist,
  } = useStore();

  const [activeTab, setActiveTab] = useState<SeqTab>('flipflops');

  /* ──────── Tab 1: Flip-Flops State ──────── */
  const [selectedFF, setSelectedFF] = useState<FFType>('JK');
  const [liveQ, setLiveQ] = useState<0 | 1>(0);
  const [ffInputs, setFfInputs] = useState<Record<string, 0 | 1>>({ J: 0, K: 0, D: 0, T: 0, S: 0, R: 0 });
  const [asyncPreset, setAsyncPreset] = useState(false);
  const [asyncClear, setAsyncClear] = useState(false);
  const [ffWarning, setFFWarning] = useState<string | null>(null);

  const charRows = useMemo(() => characteristicTable(selectedFF), [selectedFF]);
  const excitRows = useMemo(() => excitationTable(selectedFF), [selectedFF]);
  const charEq = useMemo(() => characteristicEquation(selectedFF), [selectedFF]);

  const handleStepFFClock = useCallback(() => {
    if (asyncClear) {
      setLiveQ(0);
      setFFWarning(null);
      return;
    }
    if (asyncPreset) {
      setLiveQ(1);
      setFFWarning(null);
      return;
    }
    if (selectedFF === 'SR' && ffInputs.S === 1 && ffInputs.R === 1) {
      setFFWarning('Invalid SR input S=R=1; state remains unchanged.');
      return;
    }
    setFFWarning(null);
    const nextVal = nextQ(selectedFF, liveQ, ffInputs);
    setLiveQ(nextVal === 'x' ? 0 : nextVal);
  }, [selectedFF, liveQ, ffInputs, asyncPreset, asyncClear]);

  const toggleFFInput = useCallback((name: string) => {
    setFfInputs((prev) => ({
      ...prev,
      [name]: prev[name] === 1 ? 0 : 1,
    }));
  }, []);

  /* ──────── Tab 2: Standard Sequential Circuits State ──────── */
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

  /* ──────── Tab 3: FSM Designer State ──────── */
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

  /* ──────── Tab 4: Reverse Circuit Analysis State ──────── */
  const [analysisNetlistKey, setAnalysisNetlistKey] = useState('current');
  const [circuitAnalysis, setCircuitAnalysis] = useState<ReturnType<typeof analyzeCircuit> | null>(null);

  const handleRunAnalysis = useCallback(() => {
    let targetNL: Netlist | null = null;
    if (analysisNetlistKey === 'current') {
      targetNL = designResult?.netlist ?? null;
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
  }, [analysisNetlistKey, designResult]);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sequential Logic & FSM Synthesis</h1>
          <p className="page-subtitle">
            Flip-flop models, clocked counters & registers, implication state reduction, and automated FSM design
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="circuit-toolbar">
        <div className="view-toggle-group">
          <button
            className={`btn-toggle ${activeTab === 'flipflops' ? 'active' : ''}`}
            onClick={() => setActiveTab('flipflops')}
          >
            🔄 Flip-Flops
          </button>
          <button
            className={`btn-toggle ${activeTab === 'counters' ? 'active' : ''}`}
            onClick={() => setActiveTab('counters')}
          >
            ⏱ Counters & Registers
          </button>
          <button
            className={`btn-toggle ${activeTab === 'fsm' ? 'active' : ''}`}
            onClick={() => setActiveTab('fsm')}
          >
            📐 FSM Designer
          </button>
          <button
            className={`btn-toggle ${activeTab === 'analyze' ? 'active' : ''}`}
            onClick={() => setActiveTab('analyze')}
          >
            🔍 Analyze Circuit
          </button>
        </div>
      </div>

      {/* TAB 1: FLIP-FLOPS */}
      {activeTab === 'flipflops' && (
        <div className="tab-pane-sequential">
          {/* FF Type Selector Chips */}
          <div className="circuit-variant-bar" style={{ marginBottom: 16 }}>
            {(['SR', 'D', 'JK', 'T'] as FFType[]).map((type) => (
              <button
                key={type}
                className={`btn-variant ${selectedFF === type ? 'active' : ''}`}
                onClick={() => setSelectedFF(type)}
              >
                {type} Flip-Flop
              </button>
            ))}
          </div>

          <div className="circuit-stats-bar">
            <div className="stat-chip variant-chip">
              <span className="stat-label">Characteristic Equation</span>
              <span className="stat-value">{charEq}</span>
            </div>
          </div>

          <div className="ff-grid-layout">
            {/* Live Interactive Simulator */}
            <div className="card ff-card">
              <h3 className="card-title">Live Simulator</h3>
              <p className="card-subtitle">Set inputs and trigger an active clock transition</p>

              <div className="ff-live-state-box">
                <div className="ff-state-badge">
                  <span className="state-label">Q</span>
                  <span className={`state-digit ${liveQ === 1 ? 'high' : 'low'}`}>{liveQ}</span>
                </div>
                <div className="ff-state-badge">
                  <span className="state-label">Q'</span>
                  <span className={`state-digit ${liveQ === 0 ? 'high' : 'low'}`}>{liveQ === 1 ? 0 : 1}</span>
                </div>
              </div>

              <div className="circuit-input-switches" style={{ justifyContent: 'center', marginTop: 12 }}>
                {selectedFF === 'D' && (
                  <button
                    className={`input-switch ${ffInputs.D === 1 ? 'on' : 'off'}`}
                    onClick={() => toggleFFInput('D')}
                  >
                    <span className="switch-name">D</span>
                    <span className="switch-val">{ffInputs.D ?? 0}</span>
                  </button>
                )}
                {selectedFF === 'T' && (
                  <button
                    className={`input-switch ${ffInputs.T === 1 ? 'on' : 'off'}`}
                    onClick={() => toggleFFInput('T')}
                  >
                    <span className="switch-name">T</span>
                    <span className="switch-val">{ffInputs.T ?? 0}</span>
                  </button>
                )}
                {selectedFF === 'JK' && (
                  <>
                    <button
                      className={`input-switch ${ffInputs.J === 1 ? 'on' : 'off'}`}
                      onClick={() => toggleFFInput('J')}
                    >
                      <span className="switch-name">J</span>
                      <span className="switch-val">{ffInputs.J ?? 0}</span>
                    </button>
                    <button
                      className={`input-switch ${ffInputs.K === 1 ? 'on' : 'off'}`}
                      onClick={() => toggleFFInput('K')}
                    >
                      <span className="switch-name">K</span>
                      <span className="switch-val">{ffInputs.K ?? 0}</span>
                    </button>
                  </>
                )}
                {selectedFF === 'SR' && (
                  <>
                    <button
                      className={`input-switch ${ffInputs.S === 1 ? 'on' : 'off'}`}
                      onClick={() => toggleFFInput('S')}
                    >
                      <span className="switch-name">S</span>
                      <span className="switch-val">{ffInputs.S ?? 0}</span>
                    </button>
                    <button
                      className={`input-switch ${ffInputs.R === 1 ? 'on' : 'off'}`}
                      onClick={() => toggleFFInput('R')}
                    >
                      <span className="switch-name">R</span>
                      <span className="switch-val">{ffInputs.R ?? 0}</span>
                    </button>
                  </>
                )}
              </div>

              <div className="circuit-input-switches" style={{ justifyContent: 'center', marginTop: 10 }}>
                <label>
                  <input type="checkbox" checked={asyncPreset} onChange={(event) => setAsyncPreset(event.target.checked)} />
                  Async preset
                </label>
                <label>
                  <input type="checkbox" checked={asyncClear} onChange={(event) => setAsyncClear(event.target.checked)} />
                  Async clear
                </label>
              </div>
              {ffWarning && <div className="verify-badge fail" role="alert">{ffWarning}</div>}

              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <button className="btn-action btn-sim" onClick={handleStepFFClock}>
                  ⚡ Pulse Clock
                </button>
              </div>
            </div>

            {/* Characteristic Table */}
            <div className="card ff-card">
              <h3 className="card-title">Characteristic Table</h3>
              <p className="card-subtitle">Next state Q+ given current Q and synchronous inputs</p>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {Object.keys(charRows[0]?.inputs ?? {}).map((k) => (
                        <th key={k}>{k}</th>
                      ))}
                      <th>Q(t)</th>
                      <th>Q(t+1)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charRows.map((r, i) => (
                      <tr key={i}>
                        {Object.values(r.inputs).map((v, j) => (
                          <td key={j} className="mono-cell">{v}</td>
                        ))}
                        <td className="mono-cell">{r.q}</td>
                        <td className="mono-cell highlight-cell">{r.nextQ}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Excitation Table */}
            <div className="card ff-card">
              <h3 className="card-title">Excitation Table</h3>
              <p className="card-subtitle">Required inputs to drive state transition Q → Q+</p>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Q(t)</th>
                      <th>Q(t+1)</th>
                      {Object.keys(excitRows[0]?.inputs ?? {}).map((k) => (
                        <th key={k}>{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {excitRows.map((r, i) => (
                      <tr key={i}>
                        <td className="mono-cell">{r.q}</td>
                        <td className="mono-cell">{r.nextQ}</td>
                        {Object.values(r.inputs).map((v, j) => (
                          <td key={j} className="mono-cell highlight-cell">{v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: COUNTERS & REGISTERS */}
      {activeTab === 'counters' && (
        <div className="tab-pane-sequential">
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 className="card-title">Circuit Catalog</h3>
            <div className="block-grid">
              {Object.entries(standardCircuits).map(([key, item]) => (
                <button
                  key={key}
                  className={`block-chip ${selectedCircuitKey === key ? 'active' : ''}`}
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
                <div className="stat-chip">
                  <span className="stat-label">Clock Pulses</span>
                  <span className="stat-value">{circuitClockCount}</span>
                </div>
                <div className="stat-chip variant-chip">
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
                <div className="stat-chip type-chip">
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
                <div className="circuit-actions" style={{ marginLeft: 'auto', marginBottom: 0 }}>
                  <button className="btn-action btn-sim" onClick={handleStepCircuit}>
                    ⚡ Step Clock
                  </button>
                  <button className="btn-action" onClick={handleResetCircuit}>
                    ↺ Reset
                  </button>
                </div>
              </div>

              {/* State History Log */}
              {circuitStateHistory.length > 0 && (
                <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
                  <span className="switch-label">Transition Sequence:</span>
                  <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
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
                <div className="card" style={{ marginBottom: 16 }}>
                  <h3 className="card-title">Unused States & Self-Starting Analysis</h3>
                  <div className="circuit-stats-bar" style={{ marginTop: 8 }}>
                    <div className="stat-chip">
                      <span className="stat-label">Unused States</span>
                      <span className="stat-value">{unusedStatesInfo.unused.join(', ') || 'None'}</span>
                    </div>
                    <div className="stat-chip type-chip">
                      <span className="stat-label">Self-Starting</span>
                      <span className="stat-value">{unusedStatesInfo.selfStarting ? 'Yes (Pass)' : 'No (Lockup)'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Circuit Gates Summary */}
              <div className="card">
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
      )}

      {/* TAB 3: FSM DESIGNER */}
      {activeTab === 'fsm' && (
        <div className="tab-pane-sequential">
          {/* Preset Buttons */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 className="card-title">Load FSM Presets</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              {PRESET_FSMS.map((p) => (
                <button
                  key={p.name}
                  className="btn-action"
                  onClick={() => handleLoadPreset(p.st)}
                >
                  📁 {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Validation Banner */}
          {fsmValidationErrors.length > 0 ? (
            <div className="verify-badge fail" style={{ marginBottom: 16 }}>
              {fsmValidationErrors.map((err, i) => (
                <div key={i}>✗ {err}</div>
              ))}
            </div>
          ) : (
            <div className="verify-badge pass" style={{ marginBottom: 16 }}>
              ✓ State table is complete, deterministic, and valid
            </div>
          )}

          <div className="fsm-grid-layout">
            {/* Left: State Table */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="card-title">State Transition Table ({fsmStateTable.model.toUpperCase()})</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-action btn-sim" onClick={handleReduceStates}>
                    📉 Reduce States
                  </button>
                </div>
              </div>

              <div className="table-wrapper" style={{ marginTop: 10 }}>
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
                <div style={{ marginTop: 14 }}>
                  <div className="verify-badge pass">
                    {reductionResult.classes.every((group) => group.length === 1)
                      ? `✓ Already minimal (${reductionResult.reduced.states.length} states).`
                      : `✓ Reduced from ${reductionResult.classes.reduce((count, group) => count + group.length, 0)} to ${reductionResult.reduced.states.length} states.`}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    Equivalence classes: {reductionResult.classes.map((c) => `{${c.join(', ')}}`).join(', ')}
                  </div>
                </div>
              )}
            </div>

            {/* Right: State Diagram SVG */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <h3 className="card-title" style={{ alignSelf: 'flex-start' }}>State Transition Diagram</h3>
              <StateDiagramSVG st={fsmStateTable} />
            </div>
          </div>

          {/* Design Settings Bar */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3 className="card-title">Automated Synthesis Configuration</h3>
            <div className="circuit-toolbar" style={{ marginTop: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="switch-label">Flip-Flop Type:</span>
                {(['D', 'T', 'JK'] as FFType[]).map((ff) => (
                  <button
                    key={ff}
                    className={`btn-variant ${fsmDesignFF === ff ? 'active' : ''}`}
                    onClick={() => setFsmDesignFF(ff)}
                  >
                    {ff}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="switch-label">State Encoding:</span>
                {(['binary', 'gray', 'one-hot'] as const).map((strat) => (
                  <button
                    key={strat}
                    className={`btn-variant ${fsmStrategy === strat ? 'active' : ''}`}
                    onClick={() => setFsmStrategy(strat)}
                  >
                    {strat}
                  </button>
                ))}
              </div>

              <button className="btn-action btn-verify" onClick={handleDesignFSM}>
                ⚡ Synthesize Gate-Level Netlist
              </button>
            </div>
          </div>

          {/* Synthesis Results */}
          {designResult && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 className="card-title">Synthesized Excitation & Output Equations</h3>
              <div className="circuit-stats-bar" style={{ marginTop: 10 }}>
                {Object.entries(designResult.flipFlopInputEquations).map(([inp, eq]) => (
                  <div key={inp} className="stat-chip variant-chip">
                    <span className="stat-label">{inp}</span>
                    <span className="stat-value">{eq || '0'}</span>
                  </div>
                ))}
                {Object.entries(designResult.outputEquations).map(([out, eq]) => (
                  <div key={out} className="stat-chip type-chip">
                    <span className="stat-label">{out}</span>
                    <span className="stat-value">{eq || '0'}</span>
                  </div>
                ))}
              </div>
              <div className="verify-badge pass" style={{ marginTop: 10 }}>
                ✓ Generated Netlist with {designResult.netlist.nodes.length} nodes saved to global workspace!
              </div>
              <div className="circuit-stats-bar" style={{ marginTop: 10 }}>
                {designResult.netlist.nodes
                  .filter((node): node is FlipFlop => node.kind === 'ff')
                  .map((ff) => (
                    <div className="stat-chip variant-chip" key={ff.id} aria-label={`${ff.type} flip-flop ${ff.q}`}>
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
      )}

      {/* TAB 4: REVERSE CIRCUIT ANALYSIS */}
      {activeTab === 'analyze' && (
        <div className="tab-pane-sequential">
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 className="card-title">Select Target Circuit for Analysis</h3>
            <div className="circuit-variant-bar" style={{ marginTop: 8 }}>
              <button
                className={`btn-variant ${analysisNetlistKey === 'current' ? 'active' : ''}`}
                onClick={() => setAnalysisNetlistKey('current')}
              >
                Synthesized FSM
              </button>
              <button
                className={`btn-variant ${analysisNetlistKey === 'mod6' ? 'active' : ''}`}
                onClick={() => setAnalysisNetlistKey('mod6')}
              >
                Mod-6 Counter
              </button>
              <button
                className={`btn-variant ${analysisNetlistKey === 'johnson3' ? 'active' : ''}`}
                onClick={() => setAnalysisNetlistKey('johnson3')}
              >
                3-bit Johnson Counter
              </button>
              <button
                className={`btn-variant ${analysisNetlistKey === 'sync_jk' ? 'active' : ''}`}
                onClick={() => setAnalysisNetlistKey('sync_jk')}
              >
                2-bit Sync Counter
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn-action btn-sim" onClick={handleRunAnalysis}>
                🔍 Run Circuit Reverse Analysis
              </button>
            </div>
          </div>

          {circuitAnalysis && (
            <div className="fsm-grid-layout">
              {/* Derived Equations & Lockup status */}
              <div className="card">
                <h3 className="card-title">Derived Equations & Reachability</h3>
                <div className="circuit-stats-bar" style={{ marginTop: 10 }}>
                  <div className="stat-chip variant-chip">
                    <span className="stat-label">Model</span>
                    <span className="stat-value">{circuitAnalysis.stateTable.model.toUpperCase()}</span>
                  </div>
                  <div className="stat-chip">
                    <span className="stat-label">Unused States</span>
                    <span className="stat-value">{circuitAnalysis.unusedStates.join(', ') || 'None'}</span>
                  </div>
                  <div className={`stat-chip ${circuitAnalysis.lockUp ? 'variant-chip' : 'type-chip'}`}>
                    <span className="stat-label">Lock-up Trap</span>
                    <span className="stat-value">{circuitAnalysis.lockUp ? 'Detected (Warning)' : 'None (Safe)'}</span>
                  </div>
                </div>

                <div className="table-wrapper" style={{ marginTop: 12 }}>
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
              <div className="card">
                <h3 className="card-title">Extracted State Transition Table</h3>
                <div className="table-wrapper" style={{ maxHeight: 320, overflowY: 'auto' }}>
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
      )}
    </div>
  );
};
