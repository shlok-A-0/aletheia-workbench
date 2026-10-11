import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useStore } from '../../store';
import type { Netlist, Gate, Const, GateType } from '../../engine/types';
import { exprToNetlist, minResultToNetlist, toNandOnly, toNorOnly } from '../../engine/circuit/generate';
import { evaluate, verify, truthTableOfNetlist } from '../../engine/circuit/simulate';
import {
  mux, demux, decoder, encoder, priorityEncoder,
  halfAdder, fullAdder, rippleAdder,
  comparator, bcdTo7Seg,
} from '../../engine/circuit/blocks';
import type { CircuitVariant } from '../../store/slices/circuit';


/* ────────────────────── Layout types ────────────────────── */

interface LayoutNode {
  id: string;
  type: GateType | 'INPUT' | 'CONST' | 'OUTPUT';
  label: string;
  layer: number;
  order: number;
  x: number;
  y: number;
  inputs: string[];   // net ids
  output: string;     // net id
  value?: 0 | 1;
}

interface LayoutWire {
  fromId: string;
  toId: string;
  toInputIdx: number;
  net: string;
  value?: 0 | 1;
}

/* ──────── Gate symbol constants ──────── */
const GATE_W = 70;
const GATE_H = 44;
const LAYER_GAP = 140;
const NODE_GAP = 64;
const PAD_LEFT = 100;
const PAD_TOP = 60;
const INPUT_W = 50;
const INPUT_H = 28;

/* ────────────────────── Layout algorithm ────────────────────── */

function layoutNetlist(
  netlist: Netlist,
  simValues: Record<string, 0 | 1> | null
): { nodes: LayoutNode[]; wires: LayoutWire[]; width: number; height: number } {
  const gates = netlist.nodes.filter((n) => n.kind === 'gate') as Gate[];
  const consts = netlist.nodes.filter((n) => n.kind === 'const') as Const[];

  // Map output net -> node
  const netToNode = new Map<string, string>();
  for (const g of gates) netToNode.set(g.output, g.id);
  for (const c of consts) netToNode.set(c.output, c.id);

  // Compute layers via longest path from inputs
  const gateById = new Map<string, Gate>();
  for (const g of gates) gateById.set(g.id, g);
  const constById = new Map<string, Const>();
  for (const c of consts) constById.set(c.id, c);

  const layerOf = new Map<string, number>();

  function getLayer(gateId: string): number {
    if (layerOf.has(gateId)) return layerOf.get(gateId)!;
    const g = gateById.get(gateId);
    if (!g) return 0;
    let maxPred = 0;
    for (const inp of g.inputs) {
      const predId = netToNode.get(inp);
      if (predId && gateById.has(predId)) {
        maxPred = Math.max(maxPred, getLayer(predId) + 1);
      }
    }
    layerOf.set(gateId, maxPred);
    return maxPred;
  }

  for (const g of gates) getLayer(g.id);

  const maxLayer = Math.max(0, ...Array.from(layerOf.values()));

  // Build layout nodes
  const layoutNodes: LayoutNode[] = [];

  // Input nodes at layer -1
  for (let i = 0; i < netlist.inputs.length; i++) {
    const net = netlist.inputs[i];
    layoutNodes.push({
      id: `in_${net}`,
      type: 'INPUT',
      label: net,
      layer: -1,
      order: i,
      x: 0,
      y: 0,
      inputs: [],
      output: net,
      value: simValues ? simValues[net] : undefined,
    });
  }

  // Const nodes at layer -1
  for (let i = 0; i < consts.length; i++) {
    const c = consts[i];
    layoutNodes.push({
      id: c.id,
      type: 'CONST',
      label: String(c.value),
      layer: -1,
      order: netlist.inputs.length + i,
      x: 0,
      y: 0,
      inputs: [],
      output: c.output,
      value: c.value,
    });
  }

  // Gate nodes
  // Group by layer for ordering
  const layerBuckets = new Map<number, string[]>();
  for (const g of gates) {
    const lyr = layerOf.get(g.id) ?? 0;
    if (!layerBuckets.has(lyr)) layerBuckets.set(lyr, []);
    layerBuckets.get(lyr)!.push(g.id);
  }

  // Barycenter heuristic: order nodes in each layer by average position of predecessors
  const orderMap = new Map<string, number>();
  // Assign initial orders for inputs
  for (const ln of layoutNodes) orderMap.set(ln.id, ln.order);

  for (let lyr = 0; lyr <= maxLayer; lyr++) {
    const ids = layerBuckets.get(lyr) ?? [];
    const barycenters: { id: string; bc: number }[] = ids.map((gId) => {
      const g = gateById.get(gId)!;
      let sumOrders = 0;
      let countPreds = 0;
      for (const inp of g.inputs) {
        const predId = netToNode.get(inp);
        // Check input nodes too
        const inputNodeId = `in_${inp}`;
        if (predId && orderMap.has(predId)) {
          sumOrders += orderMap.get(predId)!;
          countPreds++;
        } else if (orderMap.has(inputNodeId)) {
          sumOrders += orderMap.get(inputNodeId)!;
          countPreds++;
        }
      }
      return { id: gId, bc: countPreds > 0 ? sumOrders / countPreds : 0 };
    });
    barycenters.sort((a, b) => a.bc - b.bc);
    barycenters.forEach((item, idx) => orderMap.set(item.id, idx));
  }

  for (const g of gates) {
    const lyr = layerOf.get(g.id) ?? 0;
    layoutNodes.push({
      id: g.id,
      type: g.type,
      label: g.type,
      layer: lyr,
      order: orderMap.get(g.id) ?? 0,
      x: 0,
      y: 0,
      inputs: g.inputs,
      output: g.output,
      value: simValues ? simValues[g.output] : undefined,
    });
  }

  // Output nodes at maxLayer + 1
  for (let i = 0; i < netlist.outputs.length; i++) {
    const net = netlist.outputs[i];
    layoutNodes.push({
      id: `out_${net}`,
      type: 'OUTPUT',
      label: `Y${netlist.outputs.length > 1 ? i : ''}`,
      layer: maxLayer + 1,
      order: i,
      x: 0,
      y: 0,
      inputs: [net],
      output: net,
      value: simValues ? simValues[net] : undefined,
    });
  }

  // Assign x/y positions
  const layerGroups = new Map<number, LayoutNode[]>();
  for (const n of layoutNodes) {
    if (!layerGroups.has(n.layer)) layerGroups.set(n.layer, []);
    layerGroups.get(n.layer)!.push(n);
  }

  for (const [, group] of layerGroups) {
    group.sort((a, b) => a.order - b.order);
    group.forEach((n, i) => (n.order = i));
  }

  let maxNodesInLayer = 0;
  for (const [, group] of layerGroups) {
    maxNodesInLayer = Math.max(maxNodesInLayer, group.length);
  }

  const totalLayers = maxLayer + 3; // -1, 0..maxLayer, maxLayer+1
  for (const n of layoutNodes) {
    const layerIdx = n.layer + 1; // shift so -1 becomes 0
    n.x = PAD_LEFT + layerIdx * LAYER_GAP;
    const group = layerGroups.get(n.layer)!;
    const groupHeight = group.length * NODE_GAP;
    const startY = PAD_TOP + (maxNodesInLayer * NODE_GAP - groupHeight) / 2;
    n.y = startY + n.order * NODE_GAP;
  }

  // Build wires
  const wires: LayoutWire[] = [];
  const nodeByOutput = new Map<string, LayoutNode>();
  for (const n of layoutNodes) nodeByOutput.set(n.output, n);
  // For gates with input nets: find the output node for each input net
  const nodeById = new Map<string, LayoutNode>();
  for (const n of layoutNodes) nodeById.set(n.id, n);

  for (const n of layoutNodes) {
    if (n.type === 'INPUT' || n.type === 'CONST') continue;
    for (let i = 0; i < n.inputs.length; i++) {
      const inNet = n.inputs[i];
      const srcNode = nodeByOutput.get(inNet);
      if (srcNode) {
        wires.push({
          fromId: srcNode.id,
          toId: n.id,
          toInputIdx: i,
          net: inNet,
          value: simValues ? simValues[inNet] : undefined,
        });
      }
    }
  }

  const width = PAD_LEFT + totalLayers * LAYER_GAP + 60;
  const height = PAD_TOP + maxNodesInLayer * NODE_GAP + 40;

  return { nodes: layoutNodes, wires, width: Math.max(width, 400), height: Math.max(height, 200) };
}

/* ────────────────────── SVG gate shape components ────────────────────── */

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
  const isInverted = type === 'NOT' || type === 'NAND' || type === 'NOR' || type === 'XNOR';

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
      {isInverted && type !== 'NOT' && (
        <circle cx={x + hw + 5} cy={y} r={4} fill="var(--bg-primary)" stroke={stroke} strokeWidth={1.5} />
      )}
      {type === 'NOT' && (
        <circle cx={gx + GATE_W - 5} cy={y} r={4} fill="var(--bg-primary)" stroke={stroke} strokeWidth={1.5} />
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
  value?: 0 | 1;
}> = ({ from, to, toInputIdx, totalInputs, value }) => {
  const stroke = value === 1 ? '#10b981' : value === 0 ? '#475569' : '#334155';

  // Source point (right side of the source gate)
  let sx: number, sy: number;
  if (from.type === 'INPUT') {
    sx = from.x + INPUT_W / 2;
    sy = from.y;
  } else if (from.type === 'CONST') {
    sx = from.x + 18;
    sy = from.y;
  } else {
    sx = from.x + GATE_W / 2 + (
      (from.type === 'NAND' || from.type === 'NOR' || from.type === 'XNOR') ? 9 :
      from.type === 'NOT' ? 4 : 0
    );
    sy = from.y;
  }

  // Target point (left side of the destination gate, spread for multi-input)
  let tx: number, ty: number;
  if (to.type === 'OUTPUT') {
    tx = to.x - 20;
    ty = to.y;
  } else {
    tx = to.x - GATE_W / 2;
    const spread = Math.min(GATE_H * 0.7, (totalInputs > 1 ? GATE_H * 0.7 : 0));
    ty = totalInputs > 1
      ? to.y - spread / 2 + (spread / (totalInputs - 1)) * toInputIdx
      : to.y;
  }

  // Orthogonal routing
  const midX = (sx + tx) / 2;

  return (
    <path
      d={`M${sx},${sy} C${midX},${sy} ${midX},${ty} ${tx},${ty}`}
      fill="none"
      stroke={stroke}
      strokeWidth={value === 1 ? 2 : 1.2}
      opacity={0.8}
    />
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
  { key: 'enc4', label: 'Encoder 4:2', fn: () => encoder(4), desc: '4-to-2 Encoder' },
  { key: 'penc4', label: 'Priority Enc 4:2', fn: () => priorityEncoder(4), desc: '4-to-2 Priority Encoder' },
  { key: 'ha', label: 'Half Adder', fn: () => halfAdder(), desc: 'Half Adder (S, Cout)' },
  { key: 'fa', label: 'Full Adder', fn: () => fullAdder(), desc: 'Full Adder (S, Cout)' },
  { key: 'ra4', label: 'Ripple Adder 4-bit', fn: () => rippleAdder(4), desc: '4-bit Ripple Carry Adder' },
  { key: 'cmp4', label: 'Comparator 4-bit', fn: () => comparator(4), desc: '4-bit Magnitude Comparator' },
  { key: 'bcd7', label: 'BCD → 7-Seg', fn: () => bcdTo7Seg(), desc: 'BCD to 7-Segment Display' },
] as const;

/* ────────────────────── Main CircuitPage ────────────────────── */

export const CircuitPage: React.FC = () => {
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

  const [activeTab, setActiveTab] = useState<'schematic' | 'blocks'>('schematic');
  const [inputOverrides, setInputOverrides] = useState<Record<string, 0 | 1>>({});
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; mismatches: number[] } | null>(null);
  const [deriveSuccess, setDeriveSuccess] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState('ha');
  const [blockOverrides, setBlockOverrides] = useState<Record<string, 0 | 1>>({});
  const [blockSimResult, setBlockSimResult] = useState<Record<string, 0 | 1> | null>(null);

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
        try { setNetlist('nand', toNandOnly(simplifiedNetlist)); } catch { setNetlist('nand', null); }
        try { setNetlist('nor', toNorOnly(simplifiedNetlist)); } catch { setNetlist('nor', null); }
      } else {
        setNetlist('nand', null);
        setNetlist('nor', null);
      }
    } catch {
      // expression might be invalid
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
    try {
      return evaluate(currentNetlist, inputValues);
    } catch {
      return null;
    }
  }, [currentNetlist, inputValues]);

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
      inputs: currentNetlist.inputs.length,
      outputs: currentNetlist.outputs.length,
      typeCounts,
    };
  }, [currentNetlist]);

  const toggleInput = useCallback((name: string) => {
    setInputOverrides((prev) => ({
      ...prev,
      [name]: (prev[name] === 1 ? 0 : 1) as 0 | 1,
    }));
    setVerifyResult(null);
  }, []);

  const handleVerify = useCallback(() => {
    if (!currentNetlist || !truthTable) return;
    const result = verify(currentNetlist, truthTable);
    setVerifyResult(result);
  }, [currentNetlist, truthTable]);

  const handleDeriveTruthTable = useCallback(() => {
    if (!currentNetlist) return;
    const derived = truthTableOfNetlist(currentNetlist);
    setTruthTable(derived);
    setVars(derived.vars);
    setInput(`Circuit: ${currentNetlist.name}`, 'table');
    setDeriveSuccess(true);
    setTimeout(() => setDeriveSuccess(false), 3000);
  }, [currentNetlist, setTruthTable, setVars, setInput]);

  // Block tab logic
  const currentBlock = useMemo(() => {
    const entry = BLOCK_CATALOG.find((b) => b.key === selectedBlock);
    if (!entry) return null;
    try {
      return entry.fn();
    } catch {
      return null;
    }
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
    } catch {
      setBlockSimResult(null);
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
