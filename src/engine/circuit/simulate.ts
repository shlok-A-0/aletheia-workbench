/**
 * Aletheia Circuit Engine — Combinational Simulator & Verification
 * Performs topological sort gate evaluation, combinational cycle detection,
 * truth table extraction, and equivalence verification against golden TruthTables.
 */

import type { Netlist, NetId, TruthTable, Gate, Const, FlipFlop } from '../types';
import { CombinationalLoopError } from './generate';

export function gateValue(type: Gate['type'], inVals: (0 | 1)[]): 0 | 1 {
  switch (type) {
    case 'AND': return inVals.every((v) => v === 1) ? 1 : 0;
    case 'OR': return inVals.some((v) => v === 1) ? 1 : 0;
    case 'NOT': return inVals[0] === 1 ? 0 : 1;
    case 'NAND': return inVals.every((v) => v === 1) ? 0 : 1;
    case 'NOR': return inVals.some((v) => v === 1) ? 0 : 1;
    case 'XOR': return (inVals.reduce<number>((acc, v) => acc ^ v, 0) & 1) as 0 | 1;
    case 'XNOR': return ((inVals.reduce<number>((acc, v) => acc ^ v, 0) ^ 1) & 1) as 0 | 1;
    case 'BUF': return inVals[0] ?? 0;
  }
}

/**
 * Evaluates the netlist in topological order given primary input assignments.
 * Throws CombinationalLoopError if a combinational cycle exists.
 */
export function evaluate(
  netlist: Netlist,
  inputs: Record<NetId, 0 | 1>
): Record<NetId, 0 | 1> {
  const values: Record<NetId, 0 | 1> = { ...inputs };

  // Set constants
  for (const node of netlist.nodes) {
    if (node.kind === 'const') {
      const c = node as Const;
      values[c.output] = c.value;
    } else if (node.kind === 'ff') {
      const f = node as FlipFlop;
      const qVal = inputs[f.q] ?? 0;
      values[f.q] = qVal;
      if (f.qn) {
        values[f.qn] = inputs[f.qn] ?? ((1 - qVal) as 0 | 1);
      }
    }
  }

  // Filter combinational gates
  const gates = netlist.nodes.filter((n) => n.kind === 'gate') as Gate[];

  // Dependency graph: gate index -> input net IDs
  const remainingGates = new Set<number>(gates.map((_, idx) => idx));
  let progressed = true;

  while (remainingGates.size > 0 && progressed) {
    progressed = false;

    for (const gIdx of remainingGates) {
      const gate = gates[gIdx];
      const allInputsReady = gate.inputs.every((net) => values[net] !== undefined);

      if (allInputsReady) {
        const inVals = gate.inputs.map((net) => values[net]);
        values[gate.output] = gateValue(gate.type, inVals);
        remainingGates.delete(gIdx);
        progressed = true;
      }
    }
  }

  if (remainingGates.size > 0) {
    // Combinational cycle detected!
    const cyclicGates = Array.from(remainingGates).map((idx) => gates[idx]);
    const cyclicNets = cyclicGates.map((g) => g.output);
    throw new CombinationalLoopError(cyclicNets);
  }

  return values;
}

/**
 * Derives the complete TruthTable of a combinational netlist.
 * If targetVars is provided, generates rows for all combinations of targetVars.
 */
export function truthTableOfNetlist(netlist: Netlist, targetVars?: string[]): TruthTable {
  const vars = targetVars ? [...targetVars] : [...netlist.inputs];
  const numVars = vars.length;
  const numRows = 1 << numVars;
  const primaryOutNet = netlist.outputs[0];

  const rows: TruthTable['rows'] = [];

  for (let i = 0; i < numRows; i++) {
    const inputsMap: Record<NetId, 0 | 1> = {};
    const inputsRow: (0 | 1)[] = [];

    for (let bit = 0; bit < numVars; bit++) {
      const val = ((i >> (numVars - 1 - bit)) & 1) as 0 | 1;
      inputsRow.push(val);
      inputsMap[vars[bit]] = val;
    }

    const state = evaluate(netlist, inputsMap);
    const out = primaryOutNet ? state[primaryOutNet] ?? 0 : 0;

    rows.push({
      index: i,
      inputs: inputsRow,
      out,
    });
  }

  return { vars, rows };
}

/**
 * Verifies a Netlist against a target TruthTable.
 * Evaluates the netlist across targetTT's variable space and ignores don't-care rows.
 */
export function verify(
  netlist: Netlist,
  targetTT: TruthTable
): { ok: boolean; mismatches: number[] } {
  const derivedTT = truthTableOfNetlist(netlist, targetTT.vars);
  const mismatches: number[] = [];

  for (let i = 0; i < targetTT.rows.length; i++) {
    const expected = targetTT.rows[i].out;
    if (expected === 'x') continue; // don't cares are ignored

    const actual = derivedTT.rows[i]?.out;
    if (actual !== expected) {
      mismatches.push(i);
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatches,
  };
}

/**
 * Returns total count of gates in a netlist.
 */
export function gateCount(netlist: Netlist | null): number {
  return netlist?.nodes.filter((node) => node.kind === 'gate').length ?? 0;
}

/**
 * Computes maximum combinational gate depth (levels) from inputs to outputs.
 * Returns null if netlist contains sequential flip-flops or unexpanded blocks.
 */
export function pathDepth(netlist: Netlist | null): number | null {
  if (!netlist || netlist.nodes.some((node) => node.kind === 'ff' || node.kind === 'block')) return null;
  const depthByNet = new Map(netlist.inputs.map((net) => [net, 0]));
  const gates = netlist.nodes.filter((node) => node.kind === 'gate') as Gate[];
  let remaining = [...gates];
  let progressed = true;
  while (remaining.length > 0 && progressed) {
    progressed = false;
    remaining = remaining.filter((gate) => {
      if (!gate.inputs.every((net) => depthByNet.has(net))) return true;
      depthByNet.set(gate.output, 1 + Math.max(0, ...gate.inputs.map((net) => depthByNet.get(net) ?? 0)));
      progressed = true;
      return false;
    });
  }
  return Math.max(0, ...netlist.outputs.map((net) => depthByNet.get(net) ?? 0));
}

