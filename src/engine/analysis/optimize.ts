import type { Netlist } from '../types';
import { DEFAULT_IC_LIBRARY, mapToICs, type ICLibrary } from './ic-map';
import { activityFromSequence, dynamicPower, staticPower, transistorCount, type DynamicPowerOptions } from './power';

export interface ComparisonVariant {
  name: string;
  netlist: Netlist;
}

export interface CompareOptions {
  library?: ICLibrary;
  activity?: Record<string, number>;
  power?: DynamicPowerOptions;
  vcc?: number;
}

export interface ComparisonRow {
  name: string;
  gates: number;
  gateInputs: number;
  levels: number;
  ics: number;
  pins: number;
  cost?: number;
  staticW?: number;
  dynamicW?: number;
  powerW?: number;
  transistors: number;
}

function gateLevels(netlist: Netlist): number {
  const gates = netlist.nodes.filter((node) => node.kind === 'gate');
  const producers = new Map(gates.map((gate) => [gate.output, gate]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  function level(net: string): number {
    const producer = producers.get(net);
    if (!producer) return 0;
    if (memo.has(net)) return memo.get(net)!;
    if (visiting.has(net)) throw new Error(`Combinational loop detected while calculating levels at ${net}.`);
    visiting.add(net);
    const value = 1 + Math.max(0, ...producer.inputs.map(level));
    visiting.delete(net);
    memo.set(net, value);
    return value;
  }

  return Math.max(0, ...netlist.outputs.map(level));
}

function winner(rows: ComparisonRow[], metric: keyof ComparisonRow): string | undefined {
  const candidates = rows.filter((row) => typeof row[metric] === 'number');
  if (candidates.length === 0) return undefined;
  const lowest = Math.min(...candidates.map((row) => row[metric] as number));
  return candidates.filter((row) => row[metric] === lowest).map((row) => row.name).join(', ');
}

export function compare(
  variants: ComparisonVariant[],
  opts: CompareOptions = {}
): {
  rows: ComparisonRow[];
  best: { gates: string; ics: string; cost?: string; power?: string };
} {
  const library = opts.library ?? DEFAULT_IC_LIBRARY;
  const rows = variants.map(({ name, netlist }) => {
    const costReport = mapToICs(netlist, library);
    const row: ComparisonRow = {
      name,
      gates: netlist.nodes.filter((node) => node.kind === 'gate').length,
      gateInputs: netlist.nodes.reduce(
        (sum, node) => sum + (node.kind === 'gate' ? node.inputs.length : 0),
        0
      ),
      levels: gateLevels(netlist),
      ics: costReport.totalICs,
      pins: costReport.totalPins,
      transistors: transistorCount(netlist),
    };
    if (costReport.totalCost !== undefined) row.cost = costReport.totalCost;
    if (opts.vcc !== undefined) {
      const staticW = staticPower(costReport, opts.vcc, library);
      if (staticW !== undefined) row.staticW = staticW;
    }
    if (opts.power) {
      const activity = opts.activity ?? activityFromSequence(
        netlist,
        Array.from({ length: 1 << Math.min(netlist.inputs.length, 8) }, (_, index) =>
          Object.fromEntries(netlist.inputs.map((net, bit) => [
            net,
            ((index >> (netlist.inputs.length - bit - 1)) & 1) as 0 | 1,
          ]))
        )
      );
      row.dynamicW = dynamicPower(netlist, activity, opts.power).total;
    }
    if (row.staticW !== undefined && row.dynamicW !== undefined) {
      row.powerW = row.staticW + row.dynamicW;
    }
    return row;
  });
  const gates = winner(rows, 'gates');
  const ics = winner(rows, 'ics');
  const cost = winner(rows, 'cost');
  const power = winner(rows, 'powerW');
  if (!gates || !ics) throw new Error('Comparison requires at least one variant.');
  return {
    rows,
    best: { gates, ics, ...(cost ? { cost } : {}), ...(power ? { power } : {}) },
  };
}
