import { Component, memo, useCallback, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  BaseEdge,
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  useReactFlow,
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
  type SchematicLayout,
  type SchematicNode,
} from './elkLayout';
import { rerouteWire, type Offsets } from './dragRoute';
import { analyzeWiring, wirePath, type Pt } from './wiring';

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
  net: string;
  /** Where this wire hops over a wire of another net. */
  hops: Pt[];
  /** Junction dots drawn with this wire (one wire per net carries each dot). */
  dots: Pt[];
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
  if (!data || !data.points || data.points.length < 2) return null;
  const cls = data.value === 1 ? 'sch-wire is-1' : data.value === 0 ? 'sch-wire is-0' : 'sch-wire';
  return (
    <>
      <BaseEdge id={id} path={wirePath(data.points, data.hops, 6)} className={cls} interactionWidth={0} />
      {data.dots.map((d) => (
        <circle key={`${d.x},${d.y}`} cx={d.x} cy={d.y} r={3.2} className={data.value === 1 ? 'sch-dot is-1' : 'sch-dot'} />
      ))}
    </>
  );
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
    <div className={cls} style={{ width: w, height: h }}>
      <div className="sch-ff-body">
        <div className="sch-ff-row">
          <span className="sch-ff-pin">
            {ffType === 'JK' ? 'J' : ffType === 'T' ? 'T' : 'D'}
          </span>
          <span className={`sch-ff-q${value === 1 ? ' is-1' : ''}`}>Q</span>
        </div>
        <div className="sch-ff-type">{ffType}-FF</div>
        <div className="sch-ff-row">
          <span className="sch-ff-pin sch-ff-clk">
            <svg width="8" height="10" viewBox="0 0 8 10">
              <path d="M0,1 L7,5 L0,9" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            CLK
          </span>
          <span className="sch-ff-pin sch-ff-pin--dim">
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
    data: { points: e.points, value: values?.[e.net], net: e.net, hops: [], dots: [] },
  }));
  return { nodes, edges };
}

/** Computes junction dots and crossing hops for the wires as currently drawn. */
function withWiring(edges: Edge[]): Edge[] {
  const wiring = analyzeWiring(edges.map((e) => ({ id: e.id, net: (e.data as WireData).net, points: (e.data as WireData).points })));
  const carrier = new Map<string, string>(); // net -> first wire of that net, which draws the net's dots
  for (const e of edges) if (!carrier.has((e.data as WireData).net)) carrier.set((e.data as WireData).net, e.id);
  return edges.map((e) => {
    const d = e.data as WireData;
    return {
      ...e,
      data: {
        ...d,
        hops: wiring.hops[e.id] ?? [],
        dots: wiring.junctions.filter((j) => j.net === d.net && carrier.get(j.net) === e.id).map(({ x, y }) => ({ x, y })),
      },
    };
  });
}

export interface SchematicViewProps {
  netlist: Netlist;
  /** Input name → current value. Missing names default to 0. */
  inputs?: Record<string, 0 | 1>;
  onToggleInput?: (name: string) => void;
  height?: number;
}

function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <Panel position="bottom-right" className="sch-zoom" aria-label="Zoom controls">
      <button type="button" onClick={() => void zoomIn({ duration: 150 })} aria-label="Zoom in" title="Zoom in">+</button>
      <button type="button" onClick={() => void zoomOut({ duration: 150 })} aria-label="Zoom out" title="Zoom out">−</button>
      <button type="button" onClick={() => void fitView({ padding: 0.08, maxZoom: 1.15, duration: 200 })} aria-label="Fit circuit to view" title="Fit to view">Fit</button>
    </Panel>
  );
}

function Inner({ netlist, inputs = {}, onToggleInput, height = 420 }: SchematicViewProps) {
  const [layout, setLayout] = useState<SchematicLayout | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Gates the user dragged: id -> distance moved from the auto-layout position.
  const [offsets, setOffsets] = useState<Offsets>({});

  useEffect(() => {
    let live = true;
    layoutSchematic(netlist).then(
      (next) => { if (live) { setError(null); setOffsets({}); setLayout(next); } },
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

  const flow = useMemo(() => {
    if (!layout) return null;
    const base = toFlow(layout, values, toggle);
    const moved = Object.keys(offsets).length > 0;
    const obstacles = layout.nodes.map((n) => {
      const o = offsets[n.id];
      return { x: n.x + (o?.dx ?? 0), y: n.y + (o?.dy ?? 0), width: n.width, height: n.height };
    });
    return {
      nodes: base.nodes.map((n) => {
        const o = offsets[n.id];
        const isInput = (n.data as TerminalData).node?.kind === 'input';
        return {
          ...n,
          draggable: !isInput,
          position: o ? { x: n.position.x + o.dx, y: n.position.y + o.dy } : n.position,
        };
      }),
      edges: withWiring(
        moved
          ? base.edges.map((e) => ({
              ...e,
              data: { ...(e.data as WireData), points: rerouteWire((e.data as WireData).points, offsets[e.source], offsets[e.target], obstacles) },
            }))
          : base.edges
      ),
    };
  }, [layout, values, toggle, offsets]);

  const onNodeDrag = useCallback((_: unknown, node: Node) => {
    const home = layout?.nodes.find((n) => n.id === node.id);
    if (!home) return;
    setOffsets((prev) => ({ ...prev, [node.id]: { dx: node.position.x - home.x, dy: node.position.y - home.y } }));
  }, [layout]);

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
        nodesDraggable
        onNodeDrag={onNodeDrag}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        panOnScroll={false}
        panOnDrag
        preventScrolling={false}
      >
        <ZoomControls />
      </ReactFlow>
      {Object.keys(offsets).length > 0 && (
        <button type="button" className="btn-secondary sch-reset" onClick={() => setOffsets({})}>
          Reset layout
        </button>
      )}
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class SchematicErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error('Schematic layout rendering error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="sch-empty" role="alert">
          Schematic preview could not be rendered: {this.state.message}
        </div>
      );
    }
    return this.props.children;
  }
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
    <SchematicErrorBoundary>
      <ReactFlowProvider>
        <Inner {...props} />
      </ReactFlowProvider>
    </SchematicErrorBoundary>
  );
}

export default SchematicView;
