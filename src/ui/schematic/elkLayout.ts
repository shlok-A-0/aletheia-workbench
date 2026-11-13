import type { ElkNode, ElkExtendedEdge, ElkPort, ELK } from 'elkjs/lib/elk-api';
import type { Const, FlipFlop, Gate, GateType, Netlist } from '../../engine/types';

/**
 * Netlist → schematic geometry using ELK (Eclipse Layout Kernel).
 *
 * Why ELK: a layered layout with real ports, dummy nodes for edges that span
 * several layers, iterative crossing minimisation and orthogonal routing.
 * The previous hand-rolled layout had none of these, so wires that skipped a
 * layer ran straight through gate bodies and collinear wires merged.
 */

export type SchematicKind = 'input' | 'const' | 'gate' | 'output' | 'ff';

export interface Pin {
  id: string;
  x: number;
  y: number;
}

export interface SchematicNode {
  id: string;
  kind: SchematicKind;
  gateType?: GateType;
  ffType?: string;
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
  /** Additional output pins if multi-output (e.g. Q and Q' on flip-flops). */
  outPins?: Pin[];
}

import { analyzeWiring, findJunctionDots, wirePath, type Pt } from './wiring';

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
  /** Per edge id: where that wire hops over a wire of another net. */
  hops: Record<string, Pt[]>;
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

/** True when every node is a plain gate, constant, or flip-flop (what the schematic can draw). */
export function isSchematicSupported(netlist: Netlist): boolean {
  return netlist.nodes.every((node) => node.kind === 'gate' || node.kind === 'const' || node.kind === 'ff');
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

/**
 * Gates are laid out in the order they are listed, so list them by where their signals come from:
 * a gate fed by A and B sits above one fed by D and E. This is what keeps wires short and
 * crossings few once the inputs themselves are pinned to A, B, C… order.
 */
export function orderGates(netlist: Netlist, gates: Gate[]): Gate[] {
  const driverOf = new Map<string, Gate>();
  for (const g of gates) driverOf.set(g.output, g);
  const inputIndex = new Map(netlist.inputs.map((n, i) => [n, i] as const));
  const memo = new Map<string, number[]>();
  const sources = (net: string, seen = new Set<string>()): number[] => {
    const hit = memo.get(net);
    if (hit) return hit;
    if (inputIndex.has(net)) return [inputIndex.get(net)!];
    const g = driverOf.get(net);
    if (!g || seen.has(net)) return [];
    seen.add(net);
    const out = g.inputs.flatMap((i) => sources(i, seen));
    memo.set(net, out);
    return out;
  };
  const key = (g: Gate) => {
    const s = sources(g.output);
    return s.length ? s.reduce((a, b) => a + b, 0) / s.length : Number.MAX_SAFE_INTEGER;
  };
  return gates
    .map((g, i) => ({ g, k: key(g), i }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.g);
}

export function buildElkGraph(netlist: Netlist): Built {
  const gates = orderGates(netlist, netlist.nodes.filter((n): n is Gate => n.kind === 'gate'));
  const consts = netlist.nodes.filter((n): n is Const => n.kind === 'const');
  const flops = netlist.nodes.filter((n): n is FlipFlop => n.kind === 'ff');

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
      layoutOptions: {
        ...FIXED_SIDE,
        'elk.layered.layering.layerConstraint': 'FIRST',
      },
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

  for (const f of flops) {
    const ports: ElkPort[] = [];
    let inIdx = 0;
    if (f.type === 'D') {
      ports.push({ id: `${f.id}.d`, layoutOptions: { 'elk.port.side': 'WEST', 'elk.port.index': String(inIdx++) } });
    } else if (f.type === 'T') {
      ports.push({ id: `${f.id}.t`, layoutOptions: { 'elk.port.side': 'WEST', 'elk.port.index': String(inIdx++) } });
    } else if (f.type === 'JK') {
      ports.push({ id: `${f.id}.j`, layoutOptions: { 'elk.port.side': 'WEST', 'elk.port.index': String(inIdx++) } });
    } else if (f.type === 'SR') {
      ports.push({ id: `${f.id}.s`, layoutOptions: { 'elk.port.side': 'WEST', 'elk.port.index': String(inIdx++) } });
    }
    ports.push({ id: `${f.id}.clk`, layoutOptions: { 'elk.port.side': 'WEST', 'elk.port.index': String(inIdx++) } });
    if (f.type === 'JK') {
      ports.push({ id: `${f.id}.k`, layoutOptions: { 'elk.port.side': 'WEST', 'elk.port.index': String(inIdx++) } });
    } else if (f.type === 'SR') {
      ports.push({ id: `${f.id}.r`, layoutOptions: { 'elk.port.side': 'WEST', 'elk.port.index': String(inIdx++) } });
    }

    ports.push({ id: `${f.id}.q`, layoutOptions: { 'elk.port.side': 'EAST', 'elk.port.index': '0' } });
    if (f.qn) {
      ports.push({ id: `${f.id}.qn`, layoutOptions: { 'elk.port.side': 'EAST', 'elk.port.index': '1' } });
    }

    children.push({
      id: f.id,
      width: 64,
      height: 76,
      layoutOptions: { 'elk.portConstraints': 'FIXED_ORDER' },
      ports,
    });
    meta.set(f.id, { id: f.id, kind: 'ff', ffType: f.type, label: `${f.type}-FF`, net: f.q });
    driver.set(f.q, { port: `${f.id}.q`, node: f.id });
    if (f.qn) {
      driver.set(f.qn, { port: `${f.id}.qn`, node: f.id });
    }
  }

  const addEdge = (net: string, toPort: string, toNode: string) => {
    const src = driver.get(net);
    if (!src) return;
    const id = `e${edges.length}`;
    edges.push({ id, sources: [src.port], targets: [toPort] });
    edgeMeta.set(id, { from: src.node, to: toNode, fromPort: src.port, toPort, net });
  };

  for (const g of gates) g.inputs.forEach((net, i) => addEdge(net, `${g.id}.in${i}`, g.id));

  for (const f of flops) {
    if (f.clk) addEdge(f.clk, `${f.id}.clk`, f.id);
    if (f.type === 'D' && f.d) addEdge(f.d, `${f.id}.d`, f.id);
    if (f.type === 'T' && f.t) addEdge(f.t, `${f.id}.t`, f.id);
    if (f.type === 'JK') {
      if (f.j) addEdge(f.j, `${f.id}.j`, f.id);
      if (f.k) addEdge(f.k, `${f.id}.k`, f.id);
    }
    if (f.type === 'SR') {
      if (f.s) addEdge(f.s, `${f.id}.s`, f.id);
      if (f.r) addEdge(f.r, `${f.id}.r`, f.id);
    }
  }

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
      // INTERACTIVE keeps the declared order of the inputs (A, B, C…) top to bottom;
      // LAYER_SWEEP reshuffled them to save a crossing or two, which read as random to students.
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.crossingMinimization.semiInteractive': 'false',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
      // The greedy-switch clean-up pass is what finally swaps inputs out of order.
      'elk.layered.crossingMinimization.greedySwitch.type': 'OFF',
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

/** One dot at every point where a net splits (see wiring.ts for the rules). */
export function findJunctions(edges: SchematicEdge[]): Junction[] {
  return findJunctionDots(edges.map((e) => ({ id: e.id, net: e.net, points: e.points })));
}

/**
 * ELK shuffles the first column to cut crossings, which leaves inputs as A, C, D, B, E.
 * Students read a schematic top-down in variable order, so put the input nodes back into
 * the declared order, reusing the same vertical slots, and slide each input's wires with it.
 */
export function orderInputs(nodes: SchematicNode[], edges: SchematicEdge[], order: string[]): void {
  const inputs = nodes.filter((n) => n.kind === 'input');
  const slots = inputs.map((n) => n.y).sort((a, b) => a - b);
  const wanted = [...inputs].sort((a, b) => order.indexOf(a.net) - order.indexOf(b.net));
  const shift = new Map<string, number>();
  wanted.forEach((n, i) => shift.set(n.id, slots[i] - n.y));
  for (const e of edges) {
    const dy = shift.get(e.from) ?? 0;
    if (dy === 0) continue;
    const pts = e.points;
    const oldY = pts[0].y;
    if (pts.length >= 3 && Math.abs(pts[1].y - oldY) < 0.5) {
      pts[0] = { x: pts[0].x, y: oldY + dy };
      pts[1] = { x: pts[1].x, y: oldY + dy };
    } else {
      // Straight wire: add an elbow so it still ends on its original pin.
      const end = pts[pts.length - 1];
      const midX = (pts[0].x + end.x) / 2;
      e.points = [{ x: pts[0].x, y: oldY + dy }, { x: midX, y: oldY + dy }, { x: midX, y: end.y }, end];
    }
  }
  for (const n of inputs) {
    const dy = shift.get(n.id) ?? 0;
    n.y += dy;
  }
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
    const inPins = ports.filter((p) => !p.id.endsWith('.out') && !p.id.endsWith('.q') && !p.id.endsWith('.qn')).map(toPin);
    const outPorts = ports.filter((p) => p.id.endsWith('.out') || p.id.endsWith('.q') || p.id.endsWith('.qn'));
    const outPin = outPorts[0] ? toPin(outPorts[0]) : null;
    const outPins = outPorts.map(toPin);
    return {
      ...m,
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? 0,
      height: child.height ?? 0,
      inPins,
      outPin,
      outPins,
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

  const wiring = analyzeWiring(edges.map((e) => ({ id: e.id, net: e.net, points: e.points })));
  return {
    nodes,
    edges,
    junctions: wiring.junctions,
    hops: wiring.hops,
    width: laid.width ?? 0,
    height: laid.height ?? 0,
  };
}

/** SVG path through the polyline with rounded corners of radius `r`. */
export function roundedPath(points: { x: number; y: number }[] = [], r = 6): string {
  if (!points || !Array.isArray(points) || points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
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

export const BUBBLE_R = 4;

/** y of the concave back curve of an OR-style gate at height y (0..h). */
export function backCurveX(y: number, h: number, depth: number): number {
  const t = y / h;
  return 2 * t * (1 - t) * depth;
}

export function gateGeometry(type: string, w: number, h: number) {
  const bubble = INVERTING.has(type as GateType) ? BUBBLE_R * 2 : 0;
  const bw = w - bubble;
  const mid = h / 2;
  switch (type) {
    case 'AND':
    case 'NAND':
      return { body: `M0,0 H${bw - mid} A${mid},${mid} 0 0 1 ${bw - mid},${h} H0 Z`, back: null as number | null, shift: 0, bw, bubble };
    case 'OR':
    case 'NOR':
      return { body: `M0,0 Q${bw * 0.55},0 ${bw},${mid} Q${bw * 0.55},${h} 0,${h} Q${bw * 0.28},${mid} 0,0 Z`, back: bw * 0.28, shift: 0, bw, bubble };
    case 'XOR':
    case 'XNOR': {
      const s = 7;
      return {
        body: `M${s},0 Q${bw * 0.55 + s / 2},0 ${bw},${mid} Q${bw * 0.55 + s / 2},${h} ${s},${h} Q${bw * 0.28 + s},${mid} ${s},0 Z`,
        back: bw * 0.28,
        shift: s,
        bw,
        bubble,
      };
    }
    default: // NOT, BUF
      return { body: `M0,0 L${bw},${mid} L0,${h} Z`, back: null, shift: 0, bw, bubble };
  }
}

function escapeXml(unsafe: string): string {
  return String(unsafe ?? '').replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/** Renders an ELK schematic layout directly to a standalone, sharp vector SVG string. */
export function renderSchematicToSvg(layout: SchematicLayout): string {
  const pad = 18;
  const w = Math.max(120, Math.ceil(layout.width + pad * 2));
  const h = Math.max(90, Math.ceil(layout.height + pad * 2));

  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="auto" style="max-height:420px;display:block;margin:12px auto;background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">`;
  out += `<g transform="translate(${pad}, ${pad})">`;

  // 1. Wires
  for (const edge of layout.edges) {
    const d = wirePath(edge.points, layout.hops[edge.id], 4);
    out += `<path d="${d}" fill="none" stroke="#0f172a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />`;
  }

  // 2. Junction dots
  for (const j of layout.junctions) {
    out += `<circle cx="${j.x}" cy="${j.y}" r="3.5" fill="#0f172a" />`;
  }

  // 3. Nodes
  for (const n of layout.nodes) {
    if (n.kind === 'input' || n.kind === 'output' || n.kind === 'const') {
      const isOut = n.kind === 'output';
      const bg = isOut ? '#f8fafc' : n.kind === 'const' ? '#f1f5f9' : '#f8fafc';
      out += `<g transform="translate(${n.x}, ${n.y})">`;
      out += `<rect width="${n.width}" height="${n.height}" rx="3" fill="${bg}" stroke="#0f172a" stroke-width="1.5" />`;
      out += `<text x="${n.width / 2}" y="${n.height / 2 + 4}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="#0f172a">${escapeXml(n.label)}</text>`;
      out += `</g>`;
    } else if (n.kind === 'gate') {
      const type = n.gateType ?? 'AND';
      const geo = gateGeometry(type, n.width, n.height);
      const mid = n.height / 2;

      out += `<g transform="translate(${n.x}, ${n.y})">`;
      if (geo.back !== null) {
        for (const p of n.inPins) {
          out += `<line x1="${p.x}" y1="${p.y}" x2="${geo.shift + backCurveX(p.y, n.height, geo.back)}" y2="${p.y}" stroke="#0f172a" stroke-width="1.8" />`;
        }
      }
      out += `<path d="${geo.body}" fill="#ffffff" stroke="#0f172a" stroke-width="1.8" />`;
      if (geo.shift > 0) {
        out += `<path d="M0,0 Q${geo.bw * 0.28},${mid} 0,${n.height}" fill="none" stroke="#0f172a" stroke-width="1.8" />`;
      }
      if (geo.bubble > 0) {
        out += `<circle cx="${geo.bw + BUBBLE_R}" cy="${mid}" r="${BUBBLE_R}" fill="#ffffff" stroke="#0f172a" stroke-width="1.8" />`;
      }
      const labelX = type === 'NOT' || type === 'BUF' ? n.width * 0.35 : n.width * 0.48;
      const labelText = type === 'BUF' ? 'BUF' : type === 'NOT' ? '' : type;
      if (labelText) {
        out += `<text x="${labelX}" y="${mid + 4}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="700" fill="#64748b">${labelText}</text>`;
      }
      out += `</g>`;
    } else if (n.kind === 'ff') {
      out += `<g transform="translate(${n.x}, ${n.y})">`;
      out += `<rect width="${n.width}" height="${n.height}" rx="3" fill="#ffffff" stroke="#0f172a" stroke-width="1.8" />`;
      out += `<text x="${n.width / 2}" y="18" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="#0f172a">${escapeXml(n.ffType ?? 'FF')}</text>`;
      out += `<path d="M0,${n.height / 2 - 6} L7,${n.height / 2} L0,${n.height / 2 + 6}" fill="none" stroke="#0f172a" stroke-width="1.5" />`;
      out += `<text x="${n.width - 12}" y="22" text-anchor="middle" font-family="monospace" font-size="10" font-weight="700" fill="#0f172a">Q</text>`;
      out += `<text x="${n.width - 12}" y="${n.height - 12}" text-anchor="middle" font-family="monospace" font-size="10" font-weight="700" fill="#64748b">Q'</text>`;
      out += `</g>`;
    }
  }

  out += `</g></svg>`;
  return out;
}

/** Generates a complete standalone SVG circuit schematic for any supported Netlist. */
export async function generateSchematicSvg(netlist: Netlist): Promise<string> {
  if (!isSchematicSupported(netlist)) return '';
  const layout = await layoutSchematic(netlist);
  return renderSchematicToSvg(layout);
}
