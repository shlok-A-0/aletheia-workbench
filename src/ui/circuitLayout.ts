import type { Netlist, Gate, Const, GateType } from '../engine/types';

export interface LayoutNode {
  id: string;
  type: GateType | 'INPUT' | 'CONST' | 'OUTPUT';
  label: string;
  layer: number;
  order: number;
  x: number;
  y: number;
  inputs: string[];
  output: string;
  value?: 0 | 1;
}

export interface LayoutWire {
  fromId: string;
  toId: string;
  toInputIdx: number;
  net: string;
  value?: 0 | 1;
  cornerX?: number;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  wires: LayoutWire[];
  width: number;
  height: number;
}

const LAYER_GAP = 210;
const NODE_GAP = 92;
const PAD_LEFT = 90;
const PAD_TOP = 60;

export function layoutNetlist(
  netlist: Netlist,
  simValues: Record<string, 0 | 1> | null
): LayoutResult {
  const gates = netlist.nodes.filter((n) => n.kind === 'gate') as Gate[];
  const consts = netlist.nodes.filter((n) => n.kind === 'const') as Const[];

  const netToNode = new Map<string, string>();
  for (const g of gates) netToNode.set(g.output, g.id);
  for (const c of consts) netToNode.set(c.output, c.id);

  const gateById = new Map<string, Gate>();
  for (const g of gates) gateById.set(g.id, g);

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
  const layoutNodes: LayoutNode[] = [];

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

  const layerBuckets = new Map<number, string[]>();
  for (const g of gates) {
    const lyr = layerOf.get(g.id) ?? 0;
    if (!layerBuckets.has(lyr)) layerBuckets.set(lyr, []);
    layerBuckets.get(lyr)!.push(g.id);
  }

  const orderMap = new Map<string, number>();
  for (const ln of layoutNodes) orderMap.set(ln.id, ln.order);

  for (let lyr = 0; lyr <= maxLayer; lyr++) {
    const ids = layerBuckets.get(lyr) ?? [];
    const barycenters: { id: string; bc: number }[] = ids.map((gId) => {
      const g = gateById.get(gId)!;
      let sumOrders = 0;
      let countPreds = 0;
      for (const inp of g.inputs) {
        const predId = netToNode.get(inp);
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

  const totalLayers = maxLayer + 3;
  for (const n of layoutNodes) {
    const layerIdx = n.layer + 1;
    n.x = PAD_LEFT + layerIdx * LAYER_GAP;
    const group = layerGroups.get(n.layer)!;
    const groupHeight = group.length * NODE_GAP;
    const startY = PAD_TOP + (maxNodesInLayer * NODE_GAP - groupHeight) / 2;
    n.y = startY + n.order * NODE_GAP;
  }

  const wires: LayoutWire[] = [];
  const nodeByOutput = new Map<string, LayoutNode>();
  for (const n of layoutNodes) {
    if (n.type !== 'OUTPUT') nodeByOutput.set(n.output, n);
  }

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

  // Allocate dedicated vertical tracks (cornerX) per channel to prevent overlapping wires
  const wiresByChannel = new Map<number, { wire: LayoutWire; from: LayoutNode; to: LayoutNode }[]>();

  for (const w of wires) {
    const fromNode = layoutNodes.find((n) => n.id === w.fromId);
    const toNode = layoutNodes.find((n) => n.id === w.toId);
    if (!fromNode || !toNode) continue;

    const channel = fromNode.type === 'INPUT' ? -1 : toNode.layer - 1;
    if (!wiresByChannel.has(channel)) wiresByChannel.set(channel, []);
    wiresByChannel.get(channel)!.push({ wire: w, from: fromNode, to: toNode });
  }

  for (const [channel, group] of wiresByChannel) {
    const turning = group.filter((item) => Math.abs(item.from.y - item.to.y) >= 1);
    turning.sort((a, b) => {
      if (a.to.y !== b.to.y) return a.to.y - b.to.y;
      if (a.wire.toInputIdx !== b.wire.toInputIdx) return a.wire.toInputIdx - b.wire.toInputIdx;
      return a.from.y - b.from.y;
    });

    const m = turning.length;
    if (m === 0) continue;

    const channelLeft = channel === -1
      ? PAD_LEFT + 25 + 20
      : (PAD_LEFT + (channel + 1) * LAYER_GAP) + 40;
    const channelRight = (PAD_LEFT + (channel + 2) * LAYER_GAP) - 40;
    const center = (channelLeft + channelRight) / 2;
    const maxSpan = Math.max(0, channelRight - channelLeft);
    const spacing = Math.min(18, Math.max(12, maxSpan / (m + 1)));

    turning.forEach((item, idx) => {
      item.wire.cornerX = center + (idx - (m - 1) / 2) * spacing;
    });
  }

  const width = PAD_LEFT + totalLayers * LAYER_GAP + 60;
  const height = PAD_TOP + maxNodesInLayer * NODE_GAP + 40;

  return { nodes: layoutNodes, wires, width: Math.max(width, 400), height: Math.max(height, 200) };
}
