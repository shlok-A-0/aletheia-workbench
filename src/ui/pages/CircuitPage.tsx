import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useStore } from '../../store';
import type { Netlist, Gate, GateType } from '../../engine/types';
import { exprToNetlist, minResultToNetlist, toNandOnly, toNorOnly } from '../../engine/circuit/generate';
import { evaluate, verify, truthTableOfNetlist } from '../../engine/circuit/simulate';
import {
  mux, demux, decoder, encoder, priorityEncoder,
  halfAdder, fullAdder, rippleAdder,
  comparator, bcdTo7Seg,
} from '../../engine/circuit/blocks';
import type { CircuitVariant } from '../../store/slices/circuit';
import { layoutNetlist, type LayoutNode } from '../circuitLayout';

/* ────────────────────── SVG gate shape components ────────────────────── */
const GATE_W = 70;
const GATE_H = 44;
const INPUT_W = 50;
const INPUT_H = 28;

function wireSourceX(from: LayoutNode): number {
  switch (from.type) {
    case 'INPUT': return from.x + INPUT_W / 2;
    case 'CONST': return from.x + 18;
    case 'AND': return from.x + 22;
    case 'NAND': return from.x + 30;
    case 'OR':
    case 'XOR': return from.x + 35;
    case 'NOR':
    case 'XNOR': return from.x + 43;
    case 'NOT': return from.x + 33;
    case 'BUF':
    case 'OUTPUT': return from.x + 25;
  }
}

function wireColor(value?: 0 | 1): string {
  return value === 1 ? '#10b981' : value === 0 ? '#475569' : '#334155';
}

const GateSymbol: React.FC<{
  type: GateType | 'INPUT' | 'CONST' | 'OUTPUT';
  x: number;
  y: number;
  label: string;
  value?: 0 | 1;
  highlighted?: boolean;
}> = ({ type, x, y, label, value, highlighted }) => {
  const fill = highlighted ? 'rgba(0, 210, 255, 0.15)' : 'rgba(255,255,255,0.03)';
  const stroke = value === 1 ? '#10b981' : value === 0 ? '#64748b' : '#475569';
  const textColor = value === 1 ? '#10b981' : value === 0 ? '#94a3b8' : '#94a3b8';

  if (type === 'INPUT') {
    return (
      <g>
        <rect x={x - INPUT_W / 2} y={y - INPUT_H / 2} width={INPUT_W} height={INPUT_H}
          rx={4} fill={fill} stroke={stroke} strokeWidth={1.5} />
        <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle"
          fill={textColor} fontSize={13} fontWeight={600} fontFamily="var(--font-mono)">
          {label}
        </text>
        {value !== undefined && (
          <text x={x + INPUT_W / 2 + 8} y={y + 1} textAnchor="start" dominantBaseline="middle"
            fill={value === 1 ? '#10b981' : '#64748b'} fontSize={11} fontWeight={700} fontFamily="var(--font-mono)">
            {value}
          </text>
        )}
      </g>
    );
  }

  if (type === 'CONST') {
    return (
      <g>
        <rect x={x - 18} y={y - 14} width={36} height={28}
          rx={4} fill="rgba(245,158,11,0.1)" stroke="#f59e0b" strokeWidth={1} />
        <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle"
          fill="#f59e0b" fontSize={14} fontWeight={700} fontFamily="var(--font-mono)">
          {label}
        </text>
      </g>
    );
  }

  if (type === 'OUTPUT') {
    return (
      <g>
        <polygon points={`${x - 20},${y - 14} ${x + 14},${y} ${x - 20},${y + 14}`}
          fill={fill} stroke={stroke} strokeWidth={1.5} />
        <text x={x - 6} y={y + 1} textAnchor="middle" dominantBaseline="middle"
          fill={textColor} fontSize={11} fontWeight={600} fontFamily="var(--font-mono)">
          {label}
        </text>
        {value !== undefined && (
          <text x={x + 20} y={y + 1} textAnchor="start" dominantBaseline="middle"
            fill={value === 1 ? '#10b981' : '#64748b'} fontSize={13} fontWeight={700} fontFamily="var(--font-mono)">
            {value}
          </text>
        )}
      </g>
    );
  }

  // Gate body
  const hw = GATE_W / 2;
  const hh = GATE_H / 2;

  let shapePath = '';
  const gx = x - hw;
  const gy = y - hh;

  switch (type) {
    case 'AND':
    case 'NAND':
      shapePath = `M${gx},${gy} L${gx + hw},${gy} A${hh},${hh} 0 0,1 ${gx + hw},${gy + GATE_H} L${gx},${gy + GATE_H} Z`;
      break;
    case 'OR':
    case 'NOR':
      shapePath = `M${gx},${gy} Q${gx + hw * 0.5},${gy} ${gx + GATE_W},${y} Q${gx + hw * 0.5},${gy + GATE_H} ${gx},${gy + GATE_H} Q${gx + hw * 0.3},${y} ${gx},${gy}`;
      break;
    case 'XOR':
    case 'XNOR':
      shapePath = `M${gx + 5},${gy} Q${gx + hw * 0.5 + 5},${gy} ${gx + GATE_W},${y} Q${gx + hw * 0.5 + 5},${gy + GATE_H} ${gx + 5},${gy + GATE_H} Q${gx + hw * 0.3 + 5},${y} ${gx + 5},${gy}`;
      break;
    case 'NOT':
    case 'BUF':
      shapePath = `M${gx},${gy} L${gx + GATE_W - 10},${y} L${gx},${gy + GATE_H} Z`;
      break;
  }

  return (
    <g>
      <path d={shapePath} fill={fill} stroke={stroke} strokeWidth={1.5} />
      {/* XOR/XNOR extra curve */}
      {(type === 'XOR' || type === 'XNOR') && (
        <path d={`M${gx},${gy} Q${gx + hw * 0.3},${y} ${gx},${gy + GATE_H}`}
          fill="none" stroke={stroke} strokeWidth={1.5} />
      )}
      {/* Inversion bubble */}
      {type === 'NAND' && (
        <circle cx={x + hh + 4} cy={y} r={4} fill="var(--bg-primary)" stroke={stroke} strokeWidth={1.5} />
      )}
      {(type === 'NOR' || type === 'XNOR') && (
        <circle cx={x + hw + 4} cy={y} r={4} fill="var(--bg-primary)" stroke={stroke} strokeWidth={1.5} />
      )}
      {type === 'NOT' && (
        <circle cx={gx + GATE_W - 6} cy={y} r={4} fill="var(--bg-primary)" stroke={stroke} strokeWidth={1.5} />
      )}
      {/* Label */}
      <text x={type === 'NOT' || type === 'BUF' ? x - 12 : x} y={y + 1}
        textAnchor="middle" dominantBaseline="middle"
        fill={textColor} fontSize={10} fontWeight={700} fontFamily="var(--font-mono)">
        {type}
      </text>
    </g>
  );
};

/* ────────────────────── Wire SVG ────────────────────── */

const WireSVG: React.FC<{
  from: LayoutNode;
  to: LayoutNode;
  toInputIdx: number;
  totalInputs: number;
  cornerX?: number;
  value?: 0 | 1;
}> = ({ from, to, toInputIdx, totalInputs, cornerX, value }) => {
  const stroke = wireColor(value);

  // Source point (exact right edge/tip of the source gate)
  const sx = wireSourceX(from);
  const sy = from.y;

  // Target point (left side / input pin of destination gate)
  let tx: number, ty: number;
  if (to.type === 'OUTPUT') {
    tx = to.x - 20;
    ty = to.y;
  } else {
    const spread = Math.min(GATE_H * 0.72, totalInputs > 1 ? GATE_H * 0.72 : 0);
    ty = totalInputs > 1
      ? to.y - spread / 2 + (spread / (totalInputs - 1)) * toInputIdx
      : to.y;

    const baseLeft = to.x - GATE_W / 2;
    if (to.type === 'OR' || to.type === 'NOR') {
      const normDy = Math.min(1, Math.abs(ty - to.y) / (GATE_H / 2));
      const indent = 10.5 * (1 - normDy * normDy);
      tx = baseLeft + indent;
    } else if (to.type === 'XOR' || to.type === 'XNOR') {
      const normDy = Math.min(1, Math.abs(ty - to.y) / (GATE_H / 2));
      const indent = 10.5 * (1 - normDy * normDy);
      tx = baseLeft + 5 + indent;
    } else {
      tx = baseLeft;
    }
  }

  // Orthogonal Manhattan routing (90-degree right angles like standard schematics)
  let pathData: string;
  if (Math.abs(sy - ty) < 1) {
    pathData = `M ${sx} ${sy} L ${tx} ${ty}`;
  } else {
    const cx = cornerX ?? ((sx + tx) / 2);
    pathData = `M ${sx} ${sy} L ${cx} ${sy} L ${cx} ${ty} L ${tx} ${ty}`;
  }

  return (
    <g>
      <path
        d={pathData}
        fill="none"
        stroke={stroke}
        strokeWidth={value === 1 ? 2 : 1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
    </g>
  );
};

const WireJunctions: React.FC<{
  nodes: LayoutNode[];
  wires: ReturnType<typeof layoutNetlist>['wires'];
}> = ({ nodes, wires }) => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const fanout = new Map<string, number>();
  for (const wire of wires) {
    fanout.set(wire.fromId, (fanout.get(wire.fromId) ?? 0) + 1);
  }

  return (
    <g aria-hidden="true" pointerEvents="none">
      {Array.from(fanout, ([nodeId, count]) => {
        if (count < 2) return null;
        const node = nodesById.get(nodeId);
        if (!node) return null;
        return (
          <circle
            className="wire-junction"
            key={nodeId}
            cx={wireSourceX(node)}
            cy={node.y}
            r={3}
            fill={wireColor(node.value)}
            stroke="var(--bg-primary)"
            strokeWidth={1.5}
          />
        );
      })}
    </g>
  );
};

/* ────────────────────── MSI Block data ────────────────────── */

const BLOCK_CATALOG = [
  { key: 'mux1', label: 'MUX 2:1', fn: () => mux(1), desc: '2:1 Multiplexer' },
  { key: 'mux2', label: 'MUX 4:1', fn: () => mux(2), desc: '4:1 Multiplexer' },
  { key: 'demux1', label: 'DEMUX 1:2', fn: () => demux(1), desc: '1:2 Demultiplexer' },
  { key: 'demux2', label: 'DEMUX 1:4', fn: () => demux(2), desc: '1:4 Demultiplexer' },
  { key: 'dec2', label: 'Decoder 2:4', fn: () => decoder(2), desc: '2-to-4 Decoder with Enable' },
  { key: 'dec3', label: 'Decoder 3:8', fn: () => decoder(3), desc: '3-to-8 Decoder with Enable' },
  { key: 'enc4', label: 'Encoder 16→4', fn: () => encoder(4), desc: '16-to-4 Encoder' },
  { key: 'penc4', label: 'Priority Enc 4:2', fn: () => priorityEncoder(4), desc: '4-to-2 Priority Encoder' },
  { key: 'ha', label: 'Half Adder', fn: () => halfAdder(), desc: 'Half Adder (S, Cout)' },
  { key: 'fa', label: 'Full Adder', fn: () => fullAdder(), desc: 'Full Adder (S, Cout)' },
  { key: 'ra4', label: 'Ripple Adder 4-bit', fn: () => rippleAdder(4), desc: '4-bit Ripple Carry Adder' },
  { key: 'cmp4', label: 'Comparator 4-bit', fn: () => comparator(4), desc: '4-bit Magnitude Comparator' },
  { key: 'bcd7', label: 'BCD → 7-Seg', fn: () => bcdTo7Seg(), desc: 'BCD to 7-Segment Display' },
] as const;

/* ────────────────────── Main CircuitPage ────────────────────── */

interface CircuitPageProps {
  /** Which tab to open first. The workbench links straight to the MSI blocks. */
  initialTab?: 'schematic' | 'blocks';
}

export const CircuitPage: React.FC<CircuitPageProps> = ({ initialTab = 'schematic' }) => {
  const {
    parsedExpr,
    truthTable,
    minResult,
    netlists,
    activeVariant,
    setNetlist,
    setActiveVariant,
    setTruthTable,
    setVars,
    setInput,
  } = useStore();

  const [activeTab, setActiveTab] = useState<'schematic' | 'blocks'>(initialTab);
  const [inputOverrides, setInputOverrides] = useState<Record<string, 0 | 1>>({});
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; mismatches: number[] } | null>(null);
  const [deriveSuccess, setDeriveSuccess] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState('ha');
  const [blockOverrides, setBlockOverrides] = useState<Record<string, 0 | 1>>({});
  const [blockSimResult, setBlockSimResult] = useState<Record<string, 0 | 1> | null>(null);
  const [circuitError, setCircuitError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<{
    message: string;
    parsedExpr: typeof parsedExpr;
    minResult: typeof minResult;
  } | null>(null);
  const visibleCircuitError = circuitError ?? (
    generationError?.parsedExpr === parsedExpr && generationError.minResult === minResult
      ? generationError.message
      : null
  );

  // Generate all circuit variants from current expression/minResult
  useEffect(() => {
    try {
      let baseNetlist: Netlist | null = null;
      let simplifiedNetlist: Netlist | null = null;

      if (parsedExpr) {
        baseNetlist = exprToNetlist(parsedExpr, { name: 'original' });
      }
      if (minResult) {
        simplifiedNetlist = minResultToNetlist(minResult);
      }
      if (!simplifiedNetlist && baseNetlist) {
        simplifiedNetlist = baseNetlist;
      }
      if (!baseNetlist && simplifiedNetlist) {
        baseNetlist = simplifiedNetlist;
      }

      setNetlist('original', baseNetlist);
      setNetlist('simplified', simplifiedNetlist);

      if (simplifiedNetlist) {
        setNetlist('nand', toNandOnly(simplifiedNetlist));
        setNetlist('nor', toNorOnly(simplifiedNetlist));
      } else {
        setNetlist('nand', null);
        setNetlist('nor', null);
      }
    } catch (error) {
      setGenerationError({
        message: error instanceof Error ? error.message : String(error),
        parsedExpr,
        minResult,
      });
    }
  }, [parsedExpr, minResult, setNetlist]);

  const currentNetlist = netlists[activeVariant];

  // Derive input values from current netlist inputs and user overrides (pure, no effect setState)
  const inputValues = useMemo(() => {
    if (!currentNetlist) return {};
    const vals: Record<string, 0 | 1> = {};
    for (const inp of currentNetlist.inputs) {
      vals[inp] = inputOverrides[inp] ?? 0;
    }
    return vals;
  }, [currentNetlist, inputOverrides]);

  // Simulate
  const simValues = useMemo(() => {
    if (!currentNetlist || Object.keys(inputValues).length === 0) return null;
    return evaluate(currentNetlist, inputValues);
  }, [currentNetlist, inputValues]);

  const automaticVerification = useMemo(
    () => currentNetlist && truthTable ? verify(currentNetlist, truthTable) : null,
    [currentNetlist, truthTable]
  );

  // Layout
  const layout = useMemo(() => {
    if (!currentNetlist) return null;
    return layoutNetlist(currentNetlist, simValues);
  }, [currentNetlist, simValues]);

  // Stats
  const stats = useMemo(() => {
    if (!currentNetlist) return null;
    const gates = currentNetlist.nodes.filter((n) => n.kind === 'gate') as Gate[];
    const typeCounts: Partial<Record<GateType, number>> = {};
    for (const g of gates) {
      typeCounts[g.type] = (typeCounts[g.type] ?? 0) + 1;
    }
    return {
      totalGates: gates.length,
      literalCount: minResult?.literalCount ?? null,
      nandGates: netlists.nand?.nodes.filter((n) => n.kind === 'gate' && n.type === 'NAND').length ?? null,
      norGates: netlists.nor?.nodes.filter((n) => n.kind === 'gate' && n.type === 'NOR').length ?? null,
      inputs: currentNetlist.inputs.length,
      outputs: currentNetlist.outputs.length,
      typeCounts,
    };
  }, [currentNetlist, minResult, netlists.nand, netlists.nor]);

  const toggleInput = useCallback((name: string) => {
    setInputOverrides((prev) => ({
      ...prev,
      [name]: (prev[name] === 1 ? 0 : 1) as 0 | 1,
    }));
    setVerifyResult(null);
  }, []);

  const handleVerify = useCallback(() => {
    if (!currentNetlist || !truthTable) return;
    try {
      setVerifyResult(verify(currentNetlist, truthTable));
    } catch (error) {
      setCircuitError(error instanceof Error ? error.message : String(error));
    }
  }, [currentNetlist, truthTable]);

  const handleDeriveTruthTable = useCallback(() => {
    if (!currentNetlist) return;
    try {
      const derived = truthTableOfNetlist(currentNetlist);
      setVars(derived.vars);
      setInput(`Circuit: ${currentNetlist.name}`, 'table');
      setTruthTable(derived);
      setDeriveSuccess(true);
      setTimeout(() => setDeriveSuccess(false), 3000);
    } catch (error) {
      setCircuitError(error instanceof Error ? error.message : String(error));
    }
  }, [currentNetlist, setTruthTable, setVars, setInput]);

  // Block tab logic
  const currentBlock = useMemo(() => {
    const entry = BLOCK_CATALOG.find((b) => b.key === selectedBlock);
    if (!entry) return null;
    return entry.fn();
  }, [selectedBlock]);

  const blockInputs = useMemo(() => {
    if (!currentBlock) return {};
    const vals: Record<string, 0 | 1> = {};
    for (const inp of currentBlock.inputs) {
      vals[inp] = blockOverrides[inp] ?? 0;
    }
    return vals;
  }, [currentBlock, blockOverrides]);

  const handleBlockSim = useCallback(() => {
    if (!currentBlock) return;
    try {
      const result = evaluate(currentBlock, blockInputs);
      setBlockSimResult(result);
    } catch (error) {
      setCircuitError(error instanceof Error ? error.message : String(error));
    }
  }, [currentBlock, blockInputs]);

  const toggleBlockInput = useCallback((name: string) => {
    setBlockOverrides((prev) => ({
      ...prev,
      [name]: (prev[name] === 1 ? 0 : 1) as 0 | 1,
    }));
    setBlockSimResult(null);
  }, []);

  const selectBlock = useCallback((key: string) => {
    setSelectedBlock(key);
    setBlockOverrides({});
    setBlockSimResult(null);
  }, []);

  // Block layout
  const blockLayout = useMemo(() => {
    if (!currentBlock) return null;
    const sim = blockSimResult ?? null;
    return layoutNetlist(currentBlock, sim);
  }, [currentBlock, blockSimResult]);


  const variants: { key: CircuitVariant; label: string }[] = [
    { key: 'original', label: 'Original' },
    { key: 'simplified', label: 'Simplified' },
    { key: 'nand', label: 'NAND-only' },
    { key: 'nor', label: 'NOR-only' },
  ];

  const noData = !parsedExpr && !minResult;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Circuit Synthesis & Schematic</h1>
          <p className="page-subtitle">
            Gate-level circuit visualization with live combinational simulation
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="circuit-toolbar">
        <div className="view-toggle-group">
          <button
            className={`btn-toggle ${activeTab === 'schematic' ? 'active' : ''}`}
            onClick={() => setActiveTab('schematic')}
          >
            ⚡ Schematic
          </button>
          <button
            className={`btn-toggle ${activeTab === 'blocks' ? 'active' : ''}`}
            onClick={() => setActiveTab('blocks')}
          >
            🧩 MSI Blocks
          </button>
        </div>

        {activeTab === 'schematic' && (
          <div className="circuit-variant-bar">
            {variants.map((v) => (
              <button
                key={v.key}
                className={`btn-variant ${activeVariant === v.key ? 'active' : ''} ${!netlists[v.key] ? 'disabled' : ''}`}
                onClick={() => netlists[v.key] && setActiveVariant(v.key)}
                disabled={!netlists[v.key]}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {activeTab === 'schematic' && (
        <>
          {visibleCircuitError && <div className="error-banner" role="alert">{visibleCircuitError}</div>}
          {noData ? (
            <div className="card circuit-empty-card">
              <div className="empty-state">
                <span className="empty-icon">⚡</span>
                <h3>No Circuit to Display</h3>
                <p>Enter a Boolean expression on the <strong>Input</strong> page, or simplify with <strong>K-Map / QM</strong> first.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Stats bar */}
              {stats && (
                <div className="circuit-stats-bar">
                  <div className="stat-chip">
                    <span className="stat-label">Gates</span>
                    <span className="stat-value">{stats.totalGates}</span>
                  </div>
                  <div className="stat-chip">
                    <span className="stat-label">Inputs</span>
                    <span className="stat-value">{stats.inputs}</span>
                  </div>
                  <div className="stat-chip">
                    <span className="stat-label">Outputs</span>
                    <span className="stat-value">{stats.outputs}</span>
                  </div>
                  {stats.literalCount !== null && (
                    <div className="stat-chip">
                      <span className="stat-label">Literals</span>
                      <span className="stat-value">{stats.literalCount}</span>
                    </div>
                  )}
                  {stats.nandGates !== null && (
                    <div className="stat-chip">
                      <span className="stat-label">NAND-only gates</span>
                      <span className="stat-value">{stats.nandGates}</span>
                    </div>
                  )}
                  {stats.norGates !== null && (
                    <div className="stat-chip">
                      <span className="stat-label">NOR-only gates</span>
                      <span className="stat-value">{stats.norGates}</span>
                    </div>
                  )}
                  {Object.entries(stats.typeCounts).map(([type, count]) => (
                    <div key={type} className="stat-chip type-chip">
                      <span className="stat-label">{type}</span>
                      <span className="stat-value">{count}</span>
                    </div>
                  ))}
                  <div className="stat-chip variant-chip">
                    <span className="stat-label">Variant</span>
                    <span className="stat-value">{activeVariant}</span>
                  </div>
                </div>
              )}

              {/* Input switches */}
              {currentNetlist && (
                <div className="circuit-input-switches">
                  <span className="switch-label">Input Toggles:</span>
                  {currentNetlist.inputs.map((inp) => (
                    <button
                      key={inp}
                      className={`input-switch ${inputValues[inp] === 1 ? 'on' : 'off'}`}
                      onClick={() => toggleInput(inp)}
                      title={`Toggle ${inp}`}
                    >
                      <span className="switch-name">{inp}</span>
                      <span className="switch-val">{inputValues[inp] ?? 0}</span>
                    </button>
                  ))}
                  {/* Output display */}
                  {simValues && currentNetlist.outputs.map((outNet) => (
                    <div key={outNet} className={`output-indicator ${simValues[outNet] === 1 ? 'high' : 'low'}`}>
                      <span className="out-label">Y</span>
                      <span className="out-val">{simValues[outNet]}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* SVG schematic */}
              {layout && (
                <div className="card circuit-schematic-card">
                  <div className="schematic-viewport">
                    <svg
                      width={layout.width}
                      height={layout.height}
                      viewBox={`0 0 ${layout.width} ${layout.height}`}
                      className="circuit-svg"
                    >
                      {/* Wires */}
                      {layout.wires.map((w, i) => {
                        const fromNode = layout.nodes.find((n) => n.id === w.fromId)!;
                        const toNode = layout.nodes.find((n) => n.id === w.toId)!;
                        if (!fromNode || !toNode) return null;
                        const totalInputs = toNode.inputs.length;
                        return (
                          <WireSVG
                            key={i}
                            from={fromNode}
                            to={toNode}
                            toInputIdx={w.toInputIdx}
                            totalInputs={totalInputs}
                            cornerX={w.cornerX}
                            value={w.value}
                          />
                        );
                      })}
                      {/* Nodes */}
                      {layout.nodes.map((n) => (
                        <GateSymbol
                          key={n.id}
                          type={n.type}
                          x={n.x}
                          y={n.y}
                          label={n.label}
                          value={n.value}
                        />
                      ))}
                      <WireJunctions nodes={layout.nodes} wires={layout.wires} />
                    </svg>
                  </div>
                </div>
              )}

              {/* Circuit action buttons */}
              <div className="circuit-actions">
                {truthTable && (
                  <button className="btn-action btn-verify" onClick={handleVerify}>
                    ✔ Verify Against Truth Table
                  </button>
                )}
                {automaticVerification && (
                  <div className={`verify-badge ${automaticVerification.ok ? 'pass' : 'fail'}`}>
                    {automaticVerification.ok
                      ? '✓ Circuit matches truth table'
                      : `✗ Circuit mismatch at rows: ${automaticVerification.mismatches.slice(0, 10).join(', ')}`}
                  </div>
                )}
                <button className="btn-action btn-sim" onClick={handleDeriveTruthTable}>
                  📊 Derive Truth Table from Circuit
                </button>
                {verifyResult && (
                  <div className={`verify-badge ${verifyResult.ok ? 'pass' : 'fail'}`}>
                    {verifyResult.ok
                      ? '✓ Circuit matches truth table — all rows pass'
                      : `✗ Mismatches at rows: ${verifyResult.mismatches.slice(0, 10).join(', ')}${verifyResult.mismatches.length > 10 ? '…' : ''}`}
                  </div>
                )}
                {deriveSuccess && (
                  <div className="verify-badge pass">
                    ✓ Truth table updated in workspace!
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {activeTab === 'blocks' && (
        <div className="blocks-container">
          {/* Block selector */}
          <div className="card block-selector-card">
            <h3 className="card-title">Standard MSI Blocks</h3>
            <p className="card-subtitle">Select a block to view its gate-level implementation and simulate it.</p>
            <div className="block-grid">
              {BLOCK_CATALOG.map((b) => (
                <button
                  key={b.key}
                  className={`block-chip ${selectedBlock === b.key ? 'active' : ''}`}
                  onClick={() => selectBlock(b.key)}
                  title={b.desc}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {/* Block simulation */}
          {currentBlock && (
            <>
              <div className="circuit-stats-bar">
                <div className="stat-chip">
                  <span className="stat-label">Block</span>
                  <span className="stat-value">{BLOCK_CATALOG.find((b) => b.key === selectedBlock)?.label}</span>
                </div>
                <div className="stat-chip">
                  <span className="stat-label">Gates</span>
                  <span className="stat-value">{currentBlock.nodes.filter((n) => n.kind === 'gate').length}</span>
                </div>
                <div className="stat-chip">
                  <span className="stat-label">Inputs</span>
                  <span className="stat-value">{currentBlock.inputs.length}</span>
                </div>
                <div className="stat-chip">
                  <span className="stat-label">Outputs</span>
                  <span className="stat-value">{currentBlock.outputs.length}</span>
                </div>
              </div>

              <div className="circuit-input-switches">
                <span className="switch-label">Inputs:</span>
                {currentBlock.inputs.map((inp) => (
                  <button
                    key={inp}
                    className={`input-switch ${blockInputs[inp] === 1 ? 'on' : 'off'}`}
                    onClick={() => toggleBlockInput(inp)}
                    title={`Toggle ${inp}`}
                  >
                    <span className="switch-name">{inp}</span>
                    <span className="switch-val">{blockInputs[inp] ?? 0}</span>
                  </button>
                ))}
                <button className="btn-action btn-sim" onClick={handleBlockSim}>
                  ▶ Simulate
                </button>
              </div>

              {/* Block outputs */}
              {blockSimResult && (
                <div className="circuit-input-switches">
                  <span className="switch-label">Outputs:</span>
                  {currentBlock.outputs.map((out) => (
                    <div key={out} className={`output-indicator ${blockSimResult[out] === 1 ? 'high' : 'low'}`}>
                      <span className="out-label">{out}</span>
                      <span className="out-val">{blockSimResult[out] ?? '?'}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Block schematic */}
              {blockLayout && (
                <div className="card circuit-schematic-card">
                  <div className="schematic-viewport">
                    <svg
                      width={blockLayout.width}
                      height={blockLayout.height}
                      viewBox={`0 0 ${blockLayout.width} ${blockLayout.height}`}
                      className="circuit-svg"
                    >
                      {blockLayout.wires.map((w, i) => {
                        const fromNode = blockLayout.nodes.find((n) => n.id === w.fromId)!;
                        const toNode = blockLayout.nodes.find((n) => n.id === w.toId)!;
                        if (!fromNode || !toNode) return null;
                        return (
                          <WireSVG
                            key={i}
                            from={fromNode}
                            to={toNode}
                            toInputIdx={w.toInputIdx}
                            totalInputs={toNode.inputs.length}
                            cornerX={w.cornerX}
                            value={w.value}
                          />
                        );
                      })}
                      {blockLayout.nodes.map((n) => (
                        <GateSymbol
                          key={n.id}
                          type={n.type}
                          x={n.x}
                          y={n.y}
                          label={n.label}
                          value={n.value}
                        />
                      ))}
                      <WireJunctions nodes={blockLayout.nodes} wires={blockLayout.wires} />
                    </svg>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
