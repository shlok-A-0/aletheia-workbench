import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BaseEdge,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Netlist } from '../../engine/types';
import { evaluate } from '../../engine/circuit/simulate';
import {
  BUBBLE_R,
  backCurveX,
  gateGeometry,
  isSchematicSupported,
  layoutSchematic,
  roundedPath,
  type SchematicLayout,
  type SchematicNode,
} from './elkLayout';

type Bit = 0 | 1 | undefined;

interface TerminalData extends Record<string, unknown> {
  node: SchematicNode;
  value: Bit;
  onToggle?: (net: string) => void;
}

interface GateData extends Record<string, unknown> {
  node: SchematicNode;
  value: Bit;
}

interface WireData extends Record<string, unknown> {
  points: { x: number; y: number }[];
  value: Bit;
}

const pinStyle = (x: number, y: number, side: 'l' | 'r') => ({
  position: 'absolute' as const,
  left: x,
  top: y,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  background: 'transparent',
  transform: side === 'l' ? 'translate(-50%, -50%)' : 'translate(-50%, -50%)',
});

const GateNode = memo(function GateNode({ data }: NodeProps<Node<GateData>>) {
  const { node, value } = data;
  const { width: w, height: h } = node;
  const type = node.gateType ?? 'AND';
  const geo = gateGeometry(type, w, h);
  const cls = value === 1 ? 'sch-gate is-1' : value === 0 ? 'sch-gate is-0' : 'sch-gate';
  const mid = h / 2;

  return (
    <div className={cls} style={{ width: w, height: h }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="visible" aria-label={`${type} gate`}>
        {/* stubs from the left pins to the concave back of OR / XOR bodies */}
        {geo.back !== null &&
          node.inPins.map((p) => (
            <line key={p.id} className="sch-stub" x1={p.x} y1={p.y} x2={geo.shift + backCurveX(p.y, h, geo.back!) } y2={p.y} />
          ))}
        <path className="sch-body" d={geo.body} />
        {geo.shift > 0 && (
          <path className="sch-body-extra" d={`M0,0 Q${geo.bw * 0.28},${mid} 0,${h}`} fill="none" />
        )}
        {geo.bubble > 0 && <circle className="sch-bubble" cx={geo.bw + BUBBLE_R} cy={mid} r={BUBBLE_R} />}
      </svg>
      <span className="sch-gate-label" style={{ left: type === 'NOT' || type === 'BUF' ? '34%' : '48%' }}>
        {type === 'BUF' ? 'BUF' : type === 'NOT' ? '' : type}
      </span>
      {node.inPins.map((p) => (
        <Handle key={p.id} id={p.id} type="target" position={Position.Left} style={pinStyle(p.x, p.y, 'l')} isConnectable={false} />
      ))}
      {node.outPin && (
        <Handle id={node.outPin.id} type="source" position={Position.Right} style={pinStyle(node.outPin.x, node.outPin.y, 'r')} isConnectable={false} />
      )}
    </div>
  );
});

const TerminalNode = memo(function TerminalNode({ data }: NodeProps<Node<TerminalData>>) {
  const { node, value, onToggle } = data;
  const isInput = node.kind === 'input';
  const isConst = node.kind === 'const';
  const bit = isConst ? (Number(node.label) as 0 | 1) : value;
  const cls = ['sch-term', isInput ? 'is-input' : isConst ? 'is-const' : 'is-output', bit === 1 ? 'is-1' : bit === 0 ? 'is-0' : '']
    .filter(Boolean)
    .join(' ');
  const body = (
    <>
      <span className="sch-term-name">{node.label}</span>
      {bit !== undefined && <span className="sch-term-bit">{bit}</span>}
    </>
  );
  return (
    <div className={cls} style={{ width: node.width, height: node.height }}>
      {isInput && onToggle ? (
        <button
          type="button"
          className="sch-term-hit nodrag nopan"
          onClick={() => onToggle(node.net)}
          aria-pressed={value === 1}
          aria-label={`Input ${node.label}: ${value ?? 0}. Click to toggle`}
        >
          {body}
        </button>
      ) : (
        <div className="sch-term-hit">{body}</div>
      )}
      {node.inPins.map((p) => (
        <Handle key={p.id} id={p.id} type="target" position={Position.Left} style={pinStyle(p.x, p.y, 'l')} isConnectable={false} />
      ))}
      {node.outPin && (
        <Handle id={node.outPin.id} type="source" position={Position.Right} style={pinStyle(node.outPin.x, node.outPin.y, 'r')} isConnectable={false} />
      )}
    </div>
  );
});

/** Draws exactly the orthogonal route ELK computed, in lime when the net is 1. */
const WireEdge = memo(function WireEdge({ id, data }: EdgeProps<Edge<WireData>>) {
  if (!data) return null;
  const cls = data.value === 1 ? 'sch-wire is-1' : data.value === 0 ? 'sch-wire is-0' : 'sch-wire';
  return <BaseEdge id={id} path={roundedPath(data.points, 6)} className={cls} interactionWidth={0} />;
});

interface FFData extends Record<string, unknown> {
  node: SchematicNode;
  value: Bit;
}

const FFNode = memo(function FFNode({ data }: NodeProps<Node<FFData>>) {
  const { node, value } = data;
  const { width: w, height: h } = node;
  const ffType = node.ffType ?? 'D';
  const cls = value === 1 ? 'sch-ff is-1' : value === 0 ? 'sch-ff is-0' : 'sch-ff';

  return (
    <div
      className={cls}
      style={{
        width: w,
        height: h,
        position: 'relative',
        background: 'var(--surface)',
        border: '1.5px solid var(--line-strong)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          height: '100%',
          padding: '4px 6px',
          boxSizing: 'border-box',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          color: 'var(--text-1)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-2)' }}>
            {ffType === 'JK' ? 'J' : ffType === 'T' ? 'T' : 'D'}
          </span>
          <span style={{ fontWeight: 700, color: value === 1 ? 'var(--signal-ink)' : 'var(--text-1)' }}>
            Q
          </span>
        </div>
        <div style={{ textAlign: 'center', fontSize: '9px', color: 'var(--text-3)', letterSpacing: '0.05em' }}>
          {ffType}-FF
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '10px', color: 'var(--text-2)' }}>
            <svg width="8" height="10" viewBox="0 0 8 10">
              <path d="M0,1 L7,5 L0,9" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            CLK
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>
            {ffType === 'JK' ? 'K' : node.outPins && node.outPins.length > 1 ? "Q'" : ''}
          </span>
        </div>
      </div>
      {node.inPins.map((p) => (
        <Handle key={p.id} id={p.id} type="target" position={Position.Left} style={pinStyle(p.x, p.y, 'l')} isConnectable={false} />
      ))}
      {node.outPin && (
        <Handle id={node.outPin.id} type="source" position={Position.Right} style={pinStyle(node.outPin.x, node.outPin.y, 'r')} isConnectable={false} />
      )}
      {node.outPins?.map((p) => (
        <Handle key={p.id} id={p.id} type="source" position={Position.Right} style={pinStyle(p.x, p.y, 'r')} isConnectable={false} />
      ))}
    </div>
  );
});

const nodeTypes = { gate: GateNode, terminal: TerminalNode, ff: FFNode };
const edgeTypes = { wire: WireEdge };

function toFlow(
  layout: SchematicLayout,
  values: Record<string, 0 | 1> | null,
  onToggle: (net: string) => void
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = layout.nodes.map((n) => ({
    id: n.id,
    type: n.kind === 'gate' ? 'gate' : n.kind === 'ff' ? 'ff' : 'terminal',
    position: { x: n.x, y: n.y },
    width: n.width,
    height: n.height,
    draggable: false,
    selectable: false,
    data: { node: n, value: values?.[n.net], onToggle: n.kind === 'input' ? onToggle : undefined },
  }));
  const edges: Edge[] = layout.edges.map((e) => ({
    id: e.id,
    type: 'wire',
    source: e.from,
    target: e.to,
    sourceHandle: e.fromPort,
    targetHandle: e.toPort,
    selectable: false,
    focusable: false,
    data: { points: e.points, value: values?.[e.net] },
  }));
  return { nodes, edges };
}

export interface SchematicViewProps {
  netlist: Netlist;
  /** Input name → current value. Missing names default to 0. */
  inputs?: Record<string, 0 | 1>;
  onToggleInput?: (name: string) => void;
  height?: number;
}

function Inner({ netlist, inputs = {}, onToggleInput, height = 420 }: SchematicViewProps) {
  const [layout, setLayout] = useState<SchematicLayout | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    layoutSchematic(netlist).then(
      (next) => { if (live) { setError(null); setLayout(next); } },
      (err: unknown) => { if (live) setError(err instanceof Error ? err.message : String(err)); }
    );
    return () => { live = false; };
  }, [netlist]);

  const values = useMemo(() => {
    try {
      const full: Record<string, 0 | 1> = {};
      for (const name of netlist.inputs) full[name] = inputs[name] ?? 0;
      return evaluate(netlist, full);
    } catch {
      return null;
    }
  }, [netlist, inputs]);

  const toggle = useCallback((net: string) => {
    onToggleInput?.(net);
  }, [onToggleInput]);

  const flow = useMemo(() => (layout ? toFlow(layout, values, toggle) : null), [layout, values, toggle]);

  if (error) return <div className="sch-empty" role="alert">Could not lay out this circuit: {error}</div>;
  if (!flow || !layout) return <div className="sch-empty">Routing wires…</div>;

  // Fit the whole schematic into view, but never blow small circuits up past 1.15x.
  const aspect = layout.width / Math.max(1, layout.height);
  const frame = Math.max(260, Math.min(height, layout.height + 80));

  return (
    <div className="sch-frame" style={{ height: frame }} data-aspect={aspect.toFixed(2)}>
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1.15 }}
        minZoom={0.3}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        panOnScroll={false}
        panOnDrag
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      />
    </div>
  );
}

/** Auto-laid-out, IEEE-symbol schematic. Click an input terminal to toggle it. */
export function SchematicView(props: SchematicViewProps) {
  if (!isSchematicSupported(props.netlist)) {
    return (
      <div className="sch-empty">
        This design uses flip-flops or MSI blocks. Open it on the Sequential page to see its schematic.
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}

export default SchematicView;
