import type { FaultReport, NetId, Netlist, Node } from '../types';
import { CombinationalLoopError } from '../circuit/generate';
import { evaluate } from '../circuit/simulate';
import { runSequence } from '../sequential/simulate-seq';

export type FaultVector = Record<NetId, 0 | 1> | (0 | 1)[];
export interface StuckAtFault {
  net: string;
  stuckAt: 0 | 1;
}

function netNames(netlist: Netlist): NetId[] {
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
  return [...nets].sort();
}

export function faultList(netlist: Netlist): StuckAtFault[] {
  return netNames(netlist).flatMap((net) => [
    { net, stuckAt: 0 as const },
    { net, stuckAt: 1 as const },
  ]);
}

function resolveVector(netlist: Netlist, vector: FaultVector): Record<NetId, 0 | 1> {
  if (Array.isArray(vector)) {
    if (vector.length !== netlist.inputs.length) {
      throw new Error(`Input vector length ${vector.length} does not match ${netlist.inputs.length} inputs.`);
    }
    return Object.fromEntries(netlist.inputs.map((net, index) => [net, vector[index]]));
  }
  return { ...vector };
}

export function simulateWithFault(
  netlist: Netlist,
  fault: StuckAtFault,
  inputs: FaultVector
): Record<NetId, 0 | 1> {
  if (netlist.nodes.some((node) => node.kind === 'block')) {
    throw new Error('Fault simulation requires a gate-level netlist; expand blocks first.');
  }
  const forced = fault.net;
  const values: Record<NetId, 0 | 1> = { ...resolveVector(netlist, inputs) };
  if (netlist.inputs.includes(forced)) values[forced] = fault.stuckAt;

  for (const node of netlist.nodes) {
    if (node.kind === 'const') values[node.output] = node.output === forced ? fault.stuckAt : node.value;
    if (node.kind === 'ff') {
      values[node.q] = node.q === forced ? fault.stuckAt : (node.init ?? 0);
      if (node.qn) values[node.qn] = node.qn === forced ? fault.stuckAt : (1 - (node.init ?? 0)) as 0 | 1;
    }
  }

  const gates = netlist.nodes.filter((node) => node.kind === 'gate');
  const remaining = new Set(gates.map((_, index) => index));
  let progressed = true;
  while (remaining.size > 0 && progressed) {
    progressed = false;
    for (const index of remaining) {
      const gate = gates[index];
      if (gate.kind !== 'gate' || !gate.inputs.every((net) => values[net] !== undefined)) continue;
      const args = gate.inputs.map((net) => values[net]);
      let output: 0 | 1;
      switch (gate.type) {
        case 'AND': output = args.every((value) => value === 1) ? 1 : 0; break;
        case 'NAND': output = args.every((value) => value === 1) ? 0 : 1; break;
        case 'OR': output = args.some((value) => value === 1) ? 1 : 0; break;
        case 'NOR': output = args.some((value) => value === 1) ? 0 : 1; break;
        case 'NOT': output = args[0] === 1 ? 0 : 1; break;
        case 'BUF': output = args[0]; break;
        case 'XOR':
        case 'XNOR': {
          const parity = args.reduce<number>((acc, value) => acc ^ value, 0);
          output = (gate.type === 'XOR' ? parity : parity ^ 1) as 0 | 1;
          break;
        }
      }
      values[gate.output] = gate.output === forced ? fault.stuckAt : output;
      remaining.delete(index);
      progressed = true;
    }
  }
  if (remaining.size > 0) {
    const cycle = [...remaining].map((index) => (gates[index] as Node & { output: string }).output);
    throw new CombinationalLoopError(cycle);
  }
  return values;
}

function defaultVectors(netlist: Netlist): Record<NetId, 0 | 1>[] {
  if (netlist.inputs.length > 8) {
    throw new Error(`Default fault testing supports at most 8 inputs; got ${netlist.inputs.length}. Supply explicit vectors.`);
  }
  const count = 1 << netlist.inputs.length;
  return Array.from({ length: count }, (_, index) =>
    Object.fromEntries(netlist.inputs.map((net, bit) => [
      net,
      ((index >> (netlist.inputs.length - bit - 1)) & 1) as 0 | 1,
    ]))
  );
}

function applyFaultToNetlist(netlist: Netlist, fault: StuckAtFault): Netlist {
  let replacedDriver = false;
  const nodes = netlist.nodes.flatMap((node) => {
    if ((node.kind === 'gate' || node.kind === 'const') && node.output === fault.net) {
      replacedDriver = true;
      return [{ kind: 'const' as const, id: `fault_${node.id}`, value: fault.stuckAt, output: fault.net }];
    }
    if (node.kind === 'ff' && (node.q === fault.net || node.qn === fault.net)) {
      replacedDriver = true;
      return [node, {
        kind: 'const' as const,
        id: `fault_${node.id}_${fault.net}`,
        value: fault.stuckAt,
        output: fault.net,
      }];
    }
    return [node];
  });
  return { ...netlist, nodes: replacedDriver ? nodes : [...nodes] };
}

function applyInputFault(vector: Record<NetId, 0 | 1>, fault: StuckAtFault): Record<NetId, 0 | 1> {
  return Object.hasOwn(vector, fault.net) ? { ...vector, [fault.net]: fault.stuckAt } : vector;
}

export function minimalTestSet(report: Pick<FaultReport, 'table' | 'undetected' | 'testVectors'>): number[][] {
  const uncovered = new Set(report.table.map((_, index) => index).filter((index) =>
    report.table[index].detectedBy.length > 0
  ));
  const selected: number[][] = [];
  while (uncovered.size > 0) {
    const coverage = new Map<number, number[]>();
    for (const faultIndex of uncovered) {
      for (const vector of report.table[faultIndex].detectedBy) {
        const vectorCoverage = coverage.get(vector) ?? [];
        vectorCoverage.push(faultIndex);
        coverage.set(vector, vectorCoverage);
      }
    }
    const bestVector = [...coverage.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])[0]?.[0];
    if (bestVector === undefined) break;
    selected.push([bestVector]);
    for (const faultIndex of coverage.get(bestVector) ?? []) uncovered.delete(faultIndex);
  }
  return selected.map(([index]) =>
    report.testVectors?.[index] ?? [index]
  );
}

export function runFaultTest(netlist: Netlist, vectors?: FaultVector[]): FaultReport {
  if (netlist.nodes.some((node) => node.kind === 'block')) {
    throw new Error('Fault simulation requires a gate-level netlist; expand blocks first.');
  }
  const testVectors = vectors ?? defaultVectors(netlist);
  const namedVectors = testVectors.map((vector) => resolveVector(netlist, vector));
  const faults = faultList(netlist);
  const isSequential = netlist.nodes.some((node) => node.kind === 'ff');
  const goodOutputs = isSequential ? runSequence(netlist, namedVectors).outputs : undefined;
  const combinationalGood = !isSequential ? namedVectors.map((vector) => evaluate(netlist, vector)) : undefined;
  const table = faults.map((fault) => {
    if (isSequential && goodOutputs) {
      const faultyNetlist = applyFaultToNetlist(netlist, fault);
      const faultyInputs = namedVectors.map((input) => applyInputFault(input, fault));
      const faultyOutputs = runSequence(faultyNetlist, faultyInputs).outputs;
      return {
        ...fault,
        detectedBy: goodOutputs.flatMap((good, index) =>
          netlist.outputs.some((net) => good[net] !== faultyOutputs[index]?.[net]) ? [index] : []
        ),
      };
    }
    return {
      ...fault,
      detectedBy: namedVectors.flatMap((vector, index) => {
        const good = combinationalGood![index];
        const faulty = simulateWithFault(netlist, fault, vector);
        return netlist.outputs.some((net) => good[net] !== faulty[net]) ? [index] : [];
      }),
    };
  });
  const detected = table.filter((entry) => entry.detectedBy.length > 0).length;
  const undetected = table.filter((entry) => entry.detectedBy.length === 0)
    .map(({ net, stuckAt }) => ({ net, stuckAt }));
  const partial: FaultReport = {
    total: faults.length,
    detected,
    undetected,
    coverage: faults.length === 0 ? 100 : (detected / faults.length) * 100,
    minimalTestSet: [],
    table,
    testVectors: namedVectors.map((vector) => netlist.inputs.map((net) => vector[net])),
  };
  partial.minimalTestSet = minimalTestSet(partial);
  return partial;
}
