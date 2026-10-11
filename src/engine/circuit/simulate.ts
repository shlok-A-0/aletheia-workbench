/**
 * LDAM Circuit Engine — Combinational Simulator & Verification
 * Performs topological sort gate evaluation, combinational cycle detection,
 * truth table extraction, and equivalence verification against golden TruthTables.
 */

import type { Netlist, NetId, TruthTable, Gate, Const } from '../types';
import { CombinationalLoopError } from './generate';

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
        let outVal: 0 | 1 = 0;

        switch (gate.type) {
          case 'AND':
            outVal = inVals.every((v) => v === 1) ? 1 : 0;
            break;
          case 'OR':
            outVal = inVals.some((v) => v === 1) ? 1 : 0;
            break;
          case 'NOT':
            outVal = inVals[0] === 1 ? 0 : 1;
            break;
          case 'NAND':
            outVal = inVals.every((v) => v === 1) ? 0 : 1;
            break;
          case 'NOR':
            outVal = inVals.some((v) => v === 1) ? 0 : 1;
            break;
          case 'XOR': {
            let acc = 0;
            for (const v of inVals) acc ^= v;
            outVal = (acc & 1) as 0 | 1;
            break;
          }
          case 'XNOR': {
            let acc = 0;
            for (const v of inVals) acc ^= v;
            outVal = ((acc ^ 1) & 1) as 0 | 1;
            break;
          }
          case 'BUF':
            outVal = inVals[0] ?? 0;
            break;
        }

        values[gate.output] = outVal;
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

