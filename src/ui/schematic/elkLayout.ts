import type { ElkNode, ElkExtendedEdge, ElkPort, ELK } from 'elkjs/lib/elk-api';
import type { Const, Gate, GateType, Netlist } from '../../engine/types';

/**
 * Netlist → schematic geometry using ELK (Eclipse Layout Kernel).
 *
 * Why ELK: a layered layout with real ports, dummy nodes for edges that span
 * several layers, iterative crossing minimisation and orthogonal routing.
 * The previous hand-rolled layout had none of these, so wires that skipped a
 * layer ran straight through gate bodies and collinear wires merged.
 */

export type SchematicKind = 'input' | 'const' | 'gate' | 'output';

export interface Pin {
  id: string;
  x: number;
  y: number;
}

export interface SchematicNode {
  id: string;
  kind: SchematicKind;
  gateType?: GateType;
  label: string;
  /** Net whose value this node displays (its output net, or the net it sinks). */
  net: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Input pins, node-relative. */
  inPins: Pin[];
  /** Output pin, node-relative (absent for output terminals). */
  outPin: Pin | null;
}

export interface SchematicEdge {
  id: string;
  from: string;
  to: string;
  /** Pin ids (match SchematicNode pins) so the renderer can attach handles. */
  fromPort: string;
  toPort: string;
  net: string;
  /** Absolute polyline: start, bends…, end. */
  points: { x: number; y: number }[];
}

export interface Junction {
  x: number;
  y: number;
  net: string;
}

export interface SchematicLayout {
  nodes: SchematicNode[];
  edges: SchematicEdge[];
  junctions: Junction[];
  width: number;
  height: number;
}

const INVERTING: ReadonlySet<GateType> = new Set(['NAND', 'NOR', 'XNOR', 'NOT']);
const COMMUTATIVE: ReadonlySet<GateType> = new Set(['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR']);

export const TERMINAL_W = 56;
export const TERMINAL_H = 32;

export function gateSize(type: GateType, fanIn: number): { width: number; height: number } {
  if (type === 'NOT' || type === 'BUF') return { width: 56, height: 38 };
  return { width: INVERTING.has(type) ? 80 : 72, height: Math.max(46, 16 * fanIn + 14) };
}

/** True when every node is a plain gate or constant (what the schematic can draw). */
export function isSchematicSupported(netlist: Netlist): boolean {
  return netlist.nodes.every((node) => node.kind === 'gate' || node.kind === 'const');
}

/** Engine-generated net names (or_3, and_1, n2…) are noise; show F / F1… instead. */
const GENERATED_NET = /^(and|or|not|nand|nor|xor|xnor|buf|const|net|n|w|t|y)_?\d+$/i;

export function outputLabel(net: string, index: number, total: number): string {
  if (/^[A-Za-z][A-Za-z0-9_]{0,5}$/.test(net) && !GENERATED_NET.test(net)) return net;
  return total > 1 ? `F${index + 1}` : 'F';
}

interface Built {
  graph: ElkNode;
  meta: Map<string, Omit<SchematicNode, 'x' | 'y' | 'width' | 'height' | 'inPins' | 'outPin'>>;
  /** ELK edge id → { from node, to node, net } */
  edgeMeta: Map<string, { from: string; to: string; fromPort: string; toPort: string; net: string }>;
}

const FIXED_SIDE = { 'elk.portConstraints': 'FIXED_SIDE' };

export function buildElkGraph(netlist: Netlist): Built {
  const gates = netlist.nodes.filter((n): n is Gate => n.kind === 'gate');
  const consts = netlist.nodes.filter((n): n is Const => n.kind === 'const');

  const children: ElkNode[] = [];
  const edges: ElkExtendedEdge[] = [];
  const meta: Built['meta'] = new Map();
  const edgeMeta: Built['edgeMeta'] = new Map();
  /** net → output port id of its driver, plus the driver node id */
  const driver = new Map<string, { port: string; node: string }>();

  for (const net of netlist.inputs) {
    const id = `in:${net}`;
    children.push({
      id,
      width: TERMINAL_W,
      height: TERMINAL_H,
      layoutOptions: { ...FIXED_SIDE, 'elk.layered.layering.layerConstraint': 'FIRST' },
      ports: [{ id: `${id}.out`, layoutOptions: { 'elk.port.side': 'EAST' } }],
    });
    meta.set(id, { id, kind: 'input', label: net, net });
    driver.set(net, { port: `${id}.out`, node: id });
  }

  for (const c of consts) {
    const id = c.id;
    children.push({
      id,
      width: 40,
      height: TERMINAL_H,
      layoutOptions: { ...FIXED_SIDE, 'elk.layered.layering.layerConstraint': 'FIRST' },
      ports: [{ id: `${id}.out`, layoutOptions: { 'elk.port.side': 'EAST' } }],
    });
    meta.set(id, { id, kind: 'const', label: String(c.value), net: c.output });
    driver.set(c.output, { port: `${id}.out`, node: id });
  }

  for (const g of gates) {
    const { width, height } = gateSize(g.type, g.inputs.length);
    const ports: ElkPort[] = g.inputs.map((_, i) => ({
      id: `${g.id}.in${i}`,
      layoutOptions: { 'elk.port.side': 'WEST', 'elk.port.index': String(i) },
    }));
    ports.push({ id: `${g.id}.out`, layoutOptions: { 'elk.port.side': 'EAST' } });
    children.push({
      id: g.id,
      width,
      height,
      // Commutative gates may permute pins to avoid crossings; others keep order.
      layoutOptions: COMMUTATIVE.has(g.type) ? FIXED_SIDE : { 'elk.portConstraints': 'FIXED_ORDER' },
      ports,
    });
    meta.set(g.id, { id: g.id, kind: 'gate', gateType: g.type, label: g.type, net: g.output });
    driver.set(g.output, { port: `${g.id}.out`, node: g.id });
  }

  const addEdge = (net: string, toPort: string, toNode: string) => {
    const src = driver.get(net);
    if (!src) return;
    const id = `e${edges.length}`;
    edges.push({ id, sources: [src.port], targets: [toPort] });
    edgeMeta.set(id, { from: src.node, to: toNode, fromPort: src.port, toPort, net });
  };

  for (const g of gates) g.inputs.forEach((net, i) => addEdge(net, `${g.id}.in${i}`, g.id));

  netlist.outputs.forEach((net, i) => {
    const id = `out:${net}:${i}`;
    children.push({
      id,
      width: TERMINAL_W,
      height: TERMINAL_H,
      layoutOptions: { ...FIXED_SIDE, 'elk.layered.layering.layerConstraint': 'LAST' },
      ports: [{ id: `${id}.in`, layoutOptions: { 'elk.port.side': 'WEST' } }],
    });
    meta.set(id, { id, kind: 'output', label: outputLabel(net, i, netlist.outputs.length), net });
    addEdge(net, `${id}.in`, id);
  });

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.mergeEdges': 'true',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.crossingMinimization.semiInteractive': 'false',
      'elk.layered.thoroughness': '30',
      'elk.layered.spacing.nodeNodeBetweenLayers': '84',
      'elk.layered.spacing.edgeNodeBetweenLayers': '28',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
      'elk.spacing.nodeNode': '34',
      'elk.spacing.edgeNode': '22',
      'elk.spacing.edgeEdge': '14',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
    },
    children,
    edges,
  };

  return { graph, meta, edgeMeta };
}

let elkInstance: Promise<ELK> | null = null;

function getElk(): Promise<ELK> {
  // Dynamic import keeps the ~1 MB ELK bundle out of the initial page load.
  elkInstance ??= import('elkjs/lib/elk.bundled.js').then(({ default: Elk }) => new Elk());
  return elkInstance;
}

const same = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

/** One dot where two or more wires leave the same pin and then split. */
export function findJunctions(edges: SchematicEdge[]): Junction[] {
  const bySource = new Map<string, SchematicEdge[]>();
  for (const e of edges) {
    const key = `${e.from}|${e.net}`;
    bySource.set(key, [...(bySource.get(key) ?? []), e]);
  }
  const junctions: Junction[] = [];
  for (const group of bySource.values()) {
    if (group.length < 2) continue;
    let common = 0;
    const first = group[0].points;
    while (
      common < first.length &&
      group.every((e) => common < e.points.length && same(e.points[common], first[common]))
    ) common++;
    const at = first[Math.max(0, common - 1)];
    junctions.push({ x: at.x, y: at.y, net: group[0].net });
  }
  return junctions;
}

export async function layoutSchematic(netlist: Netlist): Promise<SchematicLayout> {
  const { graph, meta, edgeMeta } = buildElkGraph(netlist);
  const elk = await getElk();
  const laid = await elk.layout(graph);

  const nodes: SchematicNode[] = (laid.children ?? []).map((child) => {
    const m = meta.get(child.id)!;
    const ports = child.ports ?? [];
    const toPin = (p: ElkPort): Pin => ({
      id: p.id,
      x: (p.x ?? 0) + (p.width ?? 0) / 2,
      y: (p.y ?? 0) + (p.height ?? 0) / 2,
    });
    const inPins = ports.filter((p) => !p.id.endsWith('.out')).map(toPin);
    const outPort = ports.find((p) => p.id.endsWith('.out'));
    return {
      ...m,
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? 0,
      height: child.height ?? 0,
      inPins,
      outPin: outPort ? toPin(outPort) : null,
    };
  });

  const edges: SchematicEdge[] = (laid.edges ?? []).flatMap((edge) => {
    const section = edge.sections?.[0];
    const em = edgeMeta.get(edge.id);
    if (!section || !em) return [];
    return [{
      id: edge.id,
      ...em,
      points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint],
    }];
  });

  return {
    nodes,
    edges,
    junctions: findJunctions(edges),
    width: laid.width ?? 0,
    height: laid.height ?? 0,
  };
}

/** SVG path through the polyline with rounded corners of radius `r`. */
export function roundedPath(points: { x: number; y: number }[], r = 6): string {
  if (points.length === 0) return '';
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const k = Math.min(r, inLen / 2, outLen / 2);
    if (k < 0.5) { d += ` L${cur.x},${cur.y}`; continue; }
    const ax = cur.x - ((cur.x - prev.x) / inLen) * k;
    const ay = cur.y - ((cur.y - prev.y) / inLen) * k;
    const bx = cur.x + ((next.x - cur.x) / outLen) * k;
    const by = cur.y + ((next.y - cur.y) / outLen) * k;
    d += ` L${ax},${ay} Q${cur.x},${cur.y} ${bx},${by}`;
  }
  const last = points[points.length - 1];
  if (points.length > 1) d += ` L${last.x},${last.y}`;
  return d;
}
