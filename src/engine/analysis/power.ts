import type { CostReport, NetId, Netlist, PowerReport } from '../types';
import { evaluate } from '../circuit/simulate';
import { runSequence } from '../sequential/simulate-seq';
import { DEFAULT_IC_LIBRARY, type ICLibrary } from './ic-map';

export type TransistorTable = Record<string, number>;

export const DEFAULT_TRANSISTORS: TransistorTable = {
  NOT: 2,
  NAND_2: 4,
  NAND_3: 6,
  NAND_4: 8,
  NOR_2: 4,
  NOR_3: 6,
  NOR_4: 8,
  AND_2: 6,
  AND_3: 8,
  AND_4: 10,
  OR_2: 6,
  OR_3: 8,
  OR_4: 10,
  XOR_2: 12,
  XNOR_2: 12,
  BUF: 2,
  FF_D: 20,
  FF_JK: 20,
  FF_SR: 20,
  FF_T: 20,
};

export function transistorCount(netlist: Netlist, table = DEFAULT_TRANSISTORS): number {
  let count = 0;
  for (const node of netlist.nodes) {
    if (node.kind === 'gate') {
      if (node.type === 'NOT' || node.type === 'BUF') {
        const configured = table[node.type];
        if (configured === undefined) throw new Error(`No transistor estimate configured for ${node.type}.`);
        count += configured;
        continue;
      }
      if (node.type === 'XOR' || node.type === 'XNOR') {
        const xor2 = table.XOR_2;
        if (xor2 === undefined) throw new Error('No transistor estimate configured for XOR_2.');
        count += xor2 * Math.max(0, node.inputs.length - 1);
        if (node.type === 'XNOR' && node.inputs.length > 2) {
          const inverter = table.NOT;
          if (inverter === undefined) throw new Error('No transistor estimate configured for NOT.');
          count += inverter;
        }
        continue;
      }
      const key = `${node.type}_${node.inputs.length}`;
      const configured = table[key] ?? (
        node.type === 'NAND' || node.type === 'NOR'
          ? 2 * node.inputs.length
          : node.type === 'AND' || node.type === 'OR'
            ? 2 * node.inputs.length + 2
            : undefined
      );
      if (configured === undefined) throw new Error(`No transistor estimate configured for ${key}.`);
      count += configured;
    } else if (node.kind === 'ff') {
      const key = `FF_${node.type}`;
      const configured = table[key];
      if (configured === undefined) throw new Error(`No transistor estimate configured for ${key}.`);
      count += configured;
    } else if (node.kind === 'block') {
      throw new Error(`Transistor estimate is unavailable for unexpanded block ${node.id}.`);
    }
  }
  return count;
}

export function staticPower(report: CostReport, vcc: number, library: ICLibrary = DEFAULT_IC_LIBRARY): number | undefined {
  if (!Number.isFinite(vcc) || vcc < 0) throw new Error('Vcc must be a finite non-negative value.');
  let current = 0;
  for (const entry of report.ics) {
    const ic = library.find((candidate) => candidate.part === entry.part);
    if (!ic) throw new Error(`IC ${entry.part} is missing from the selected library.`);
    if (ic.iccTypicalA === null) return undefined;
    current += entry.count * ic.iccTypicalA;
  }
  return vcc * current;
}

export interface DynamicPowerOptions {
  vdd: number;
  freqHz: number;
  defaultCapF: number;
  capPerNet?: Record<NetId, number>;
}

export interface DynamicPowerResult {
  total: number;
  perNet: { net: string; alpha: number; capF: number; dynW: number }[];
}

export function dynamicPower(
  _netlist: Netlist,
  activity: Record<NetId, number>,
  opts: DynamicPowerOptions
): DynamicPowerResult {
  if (![opts.vdd, opts.freqHz, opts.defaultCapF].every(Number.isFinite) ||
      opts.vdd < 0 || opts.freqHz < 0 || opts.defaultCapF < 0) {
    throw new Error('Vdd, frequency, and capacitance must be finite non-negative values.');
  }
  const perNet = Object.entries(activity).sort(([a], [b]) => a.localeCompare(b)).map(([net, alpha]) => {
    const capF = opts.capPerNet?.[net] ?? opts.defaultCapF;
    if (!Number.isFinite(alpha) || alpha < 0 || !Number.isFinite(capF) || capF < 0) {
      throw new Error(`Invalid activity or capacitance for net ${net}.`);
    }
    return { net, alpha, capF, dynW: alpha * capF * opts.vdd ** 2 * opts.freqHz };
  });
  return { total: perNet.reduce((sum, entry) => sum + entry.dynW, 0), perNet };
}

function allNets(netlist: Netlist): NetId[] {
  const nets = new Set<NetId>([...netlist.inputs, ...netlist.outputs]);
  for (const node of netlist.nodes) {
    if (node.kind === 'gate' || node.kind === 'const') nets.add(node.output);
    else if (node.kind === 'ff') {
      nets.add(node.q);
      if (node.qn) nets.add(node.qn);
    } else {
      for (const pin of Object.values(node.pins)) {
        for (const net of Array.isArray(pin) ? pin : [pin]) nets.add(net);
      }
    }
  }
  return [...nets];
}

export function activityFromSequence(
  netlist: Netlist,
  sequence: Record<NetId, 0 | 1>[]
): Record<NetId, number> {
  if (sequence.length === 0) return Object.fromEntries(allNets(netlist).map((net) => [net, 0]));
  const riseCounts: Record<NetId, number> = {};
  let denominator = sequence.length;

  if (netlist.nodes.some((node) => node.kind === 'ff')) {
    const result = runSequence(netlist, sequence);
    for (const [net, transitions] of Object.entries(result.transitions)) riseCounts[net] = transitions.rise;
  } else {
    let previous: Record<NetId, 0 | 1> = Object.fromEntries(allNets(netlist).map((net) => [net, 0]));
    for (const vector of sequence) {
      const values = evaluate(netlist, vector);
      for (const net of allNets(netlist)) {
        const value = values[net];
        if (value === undefined) continue;
        if (previous[net] === 0 && value === 1) riseCounts[net] = (riseCounts[net] ?? 0) + 1;
      }
      previous = values;
    }
    const clockNet = netlist.clock ?? netlist.inputs.find((net) => net.toUpperCase() === 'CLK');
    if (clockNet && (riseCounts[clockNet] ?? 0) > 0) denominator = riseCounts[clockNet];
  }

  return Object.fromEntries(allNets(netlist).map((net) => [
    net,
    Math.min(1, (riseCounts[net] ?? 0) / denominator),
  ]));
}

export function powerReport(
  netlist: Netlist,
  cost: CostReport,
  activity: Record<NetId, number>,
  opts: DynamicPowerOptions & { vcc: number },
  library: ICLibrary = DEFAULT_IC_LIBRARY,
  table = DEFAULT_TRANSISTORS
): PowerReport {
  const stat = staticPower(cost, opts.vcc, library);
  const dynamic = dynamicPower(netlist, activity, opts);
  return {
    staticW: stat,
    dynamicW: dynamic.total,
    totalW: stat === undefined ? undefined : stat + dynamic.total,
    transistors: transistorCount(netlist, table),
    perNet: dynamic.perNet,
    assumptions: { vcc: opts.vcc, freqHz: opts.freqHz, defaultCapF: opts.defaultCapF },
  };
}
