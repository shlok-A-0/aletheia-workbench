/**
 * LDAM Sequential Engine — FSM Synthesis, Analysis & State Reduction
 * Implements state table validation, state diagram extraction,
 * implication-table state reduction, state assignment (binary, gray, one-hot),
 * automated FSM design synthesis using Quine-McCluskey, and circuit reverse analysis.
 */

import type { StateTable, Netlist, FFType, Step, Node, FlipFlop, Gate } from '../types';
import { excitationTable, characteristicEquation, nextQ } from './flipflops';
import { quineMcCluskey } from '../minimize/qm';
import { truthTableFromOutputs } from '../boolean/truth-table';
import { exprToNetlist } from '../circuit/generate';
import { evaluate } from '../circuit/simulate';

export interface StateDiagramData {
  nodes: { id: string; label: string; output?: string }[];
  edges: { from: string; to: string; label: string }[];
}

export interface StateReductionResult {
  reduced: StateTable;
  classes: string[][];
  steps: Step[];
}

export interface StateAssignmentResult {
  codes: Record<string, string>;
  flops: number;
}

export interface FSMDesignResult {
  netlist: Netlist;
  nextStateEquations: Record<string, string>;
  flipFlopInputEquations: Record<string, string>;
  outputEquations: Record<string, string>;
  transitionTable: Record<string, unknown>[];
  steps: Step[];
}

export interface CircuitAnalysisResult {
  flipFlopInputEquations: Record<string, string>;
  nextStateEquations: Record<string, string>;
  outputEquations: Record<string, string>;
  stateTable: StateTable;
  unusedStates: string[];
  lockUp: boolean;
  steps: Step[];
}

/**
 * Validates a StateTable for completeness, determinism, and valid transitions.
 */
export function validateStateTable(st: StateTable): string[] {
  const errors: string[] = [];
  const stateSet = new Set(st.states);

  if (st.states.length === 0) {
    errors.push('State table contains no states.');
    return errors;
  }

  if (!stateSet.has(st.reset)) {
    errors.push(`Reset state '${st.reset}' is not in the declared states list.`);
  }

  const numInputBits = st.inputs.length;
  const numInputCombos = 1 << numInputBits;

  // Check each state for completeness and determinism
  for (const state of st.states) {
    const stateRows = st.rows.filter((r) => r.state === state);
    const coveredCombos = new Set<number>();

    for (const r of stateRows) {
      if (!stateSet.has(r.next)) {
        errors.push(`State '${state}' transitions to undefined next state '${r.next}'.`);
      }

      if (r.output.length !== st.outputs.length) {
        errors.push(
          `Row for state '${state}' with input '${r.input}' has output length ${r.output.length}, expected ${st.outputs.length}.`
        );
      }

      // Expand wildcard input string
      const matchedIndices: number[] = [];
      for (let code = 0; code < numInputCombos; code++) {
        let matches = true;
        for (let b = 0; b < numInputBits; b++) {
          const bitVal = ((code >> (numInputBits - 1 - b)) & 1).toString();
          const patternChar = r.input[b];
          if (patternChar !== '-' && patternChar !== bitVal) {
            matches = false;
            break;
          }
        }
        if (matches) matchedIndices.push(code);
      }

      for (const idx of matchedIndices) {
        if (coveredCombos.has(idx)) {
          errors.push(
            `Non-deterministic transition for state '${state}' on input combination ${idx.toString(2).padStart(numInputBits, '0')}.`
          );
        }
        coveredCombos.add(idx);
      }
    }

    if (coveredCombos.size < numInputCombos) {
      const missingCount = numInputCombos - coveredCombos.size;
      errors.push(
        `State '${state}' is incomplete: missing transitions for ${missingCount} input combination(s).`
      );
    }
  }

  return errors;
}

/**
 * Extracts nodes and edges for rendering state diagrams.
 */
export function stateDiagramData(st: StateTable): StateDiagramData {
  const nodes = st.states.map((s) => {
    // For Moore machine: find output for this state (all rows have same output)
    const matchingRow = st.rows.find((r) => r.state === s);
    const output = st.model === 'moore' ? matchingRow?.output : undefined;
    return {
      id: s,
      label: s,
      output,
    };
  });

  const edges: { from: string; to: string; label: string }[] = [];
  for (const r of st.rows) {
    const label = st.model === 'mealy' ? `${r.input} / ${r.output}` : r.input;
    edges.push({
      from: r.state,
      to: r.next,
      label,
    });
  }

  return { nodes, edges };
}

/**
 * Reduces a StateTable using the Implication Table partition refinement method.
 */
export function reduceStates(st: StateTable): StateReductionResult {
  const steps: Step[] = [];
  const numStates = st.states.length;
  const numInputBits = st.inputs.length;
  const numInputCombos = 1 << numInputBits;

  steps.push({
    title: 'Initial State Reduction Inspection',
    detail: `State table has ${numStates} states and ${numInputBits} input line(s). Model: ${st.model}.`,
  });

  // Expand wildcard rows into exact input mappings for each state
  // state -> combo (0..2^m - 1) -> { next, output }
  const stateTransitions = new Map<string, Map<number, { next: string; output: string }>>();

  for (const s of st.states) {
    const comboMap = new Map<number, { next: string; output: string }>();
    const rows = st.rows.filter((r) => r.state === s);

    for (let code = 0; code < numInputCombos; code++) {
      for (const r of rows) {
        let matches = true;
        for (let b = 0; b < numInputBits; b++) {
          const bitVal = ((code >> (numInputBits - 1 - b)) & 1).toString();
          const patternChar = r.input[b];
          if (patternChar !== '-' && patternChar !== bitVal) {
            matches = false;
            break;
          }
        }
        if (matches) {
          comboMap.set(code, { next: r.next, output: r.output });
          break;
        }
      }
    }
    stateTransitions.set(s, comboMap);
  }

  // Compatibility matrix: pair (s1, s2) -> boolean (true = currently compatible)
  const compatible = new Map<string, boolean>();
  function pairKey(s1: string, s2: string): string {
    return s1 < s2 ? `${s1}::${s2}` : `${s2}::${s1}`;
  }

  // 1. Initial output compatibility check
  for (let i = 0; i < numStates; i++) {
    for (let j = i + 1; j < numStates; j++) {
      const s1 = st.states[i];
      const s2 = st.states[j];
      const m1 = stateTransitions.get(s1)!;
      const m2 = stateTransitions.get(s2)!;

      let outMatch = true;
      for (let code = 0; code < numInputCombos; code++) {
        const out1 = m1.get(code)?.output;
        const out2 = m2.get(code)?.output;
        if (out1 !== out2) {
          outMatch = false;
          break;
        }
      }
      compatible.set(pairKey(s1, s2), outMatch);
    }
  }

  // 2. Iterative implication propagation
  let changed = true;
  let iteration = 0;
  while (changed) {
    changed = false;
    iteration++;

    for (let i = 0; i < numStates; i++) {
      for (let j = i + 1; j < numStates; j++) {
        const s1 = st.states[i];
        const s2 = st.states[j];
        const key = pairKey(s1, s2);
        if (!compatible.get(key)) continue;

        const m1 = stateTransitions.get(s1)!;
        const m2 = stateTransitions.get(s2)!;

        // Check implied next state pairs
        for (let code = 0; code < numInputCombos; code++) {
          const next1 = m1.get(code)!.next;
          const next2 = m2.get(code)!.next;

          if (next1 !== next2) {
            const nextKey = pairKey(next1, next2);
            if (compatible.get(nextKey) === false) {
              compatible.set(key, false);
              changed = true;
              break;
            }
          }
        }
      }
    }
  }

  steps.push({
    title: 'Implication Table Convergence',
    detail: `State compatibility converged in ${iteration} round(s).`,
  });

  // 3. Equivalence Classes formation
  const parent = new Map<string, string>();
  for (const s of st.states) parent.set(s, s);

  function find(s: string): string {
    if (parent.get(s) === s) return s;
    const root = find(parent.get(s)!);
    parent.set(s, root);
    return root;
  }

  function union(s1: string, s2: string) {
    const r1 = find(s1);
    const r2 = find(s2);
    if (r1 !== r2) parent.set(r1, r2);
  }

  for (let i = 0; i < numStates; i++) {
    for (let j = i + 1; j < numStates; j++) {
      const s1 = st.states[i];
      const s2 = st.states[j];
      if (compatible.get(pairKey(s1, s2))) {
        union(s1, s2);
      }
    }
  }

  const classBuckets = new Map<string, string[]>();
  for (const s of st.states) {
    const root = find(s);
    if (!classBuckets.has(root)) classBuckets.set(root, []);
    classBuckets.get(root)!.push(s);
  }

  const classes = Array.from(classBuckets.values()).map((c) => c.sort());

  // Map old state -> representative state name
  const repMap = new Map<string, string>();
  for (const cls of classes) {
    const repName = cls[0]; // Use first state as representative
    for (const member of cls) repMap.set(member, repName);
  }

  const reducedStates = classes.map((c) => c[0]);
  const reducedReset = repMap.get(st.reset)!;

  // Build reduced rows
  const reducedRows: StateTable['rows'] = [];
  for (const rep of reducedStates) {
    const origRows = st.rows.filter((r) => r.state === rep);
    for (const r of origRows) {
      reducedRows.push({
        state: rep,
        input: r.input,
        next: repMap.get(r.next)!,
        output: r.output,
      });
    }
  }

  steps.push({
    title: 'Reduced State Partition',
    detail: `Formed ${classes.length} equivalence classes: ${classes.map((c) => `{${c.join(', ')}}`).join(', ')}.`,
  });

  return {
    reduced: {
      model: st.model,
      inputs: [...st.inputs],
      outputs: [...st.outputs],
      states: reducedStates,
      reset: reducedReset,
      rows: reducedRows,
    },
    classes,
    steps,
  };
}

/**
 * Assigns binary codes to states using binary, Gray, or one-hot encoding.
 */
export function assignStates(
  st: StateTable,
  strategy: 'binary' | 'gray' | 'one-hot' = 'binary'
): StateAssignmentResult {
  const numStates = st.states.length;
  const codes: Record<string, string> = {};

  if (strategy === 'one-hot') {
    for (let i = 0; i < numStates; i++) {
      const codeArr = new Array(numStates).fill('0');
      codeArr[numStates - 1 - i] = '1';
      codes[st.states[i]] = codeArr.join('');
    }
    return { codes, flops: numStates };
  }

  const numFlops = Math.max(1, Math.ceil(Math.log2(numStates)));

  // Generate Gray codes
  function getGrayCode(n: number): string {
    const grayVal = n ^ (n >> 1);
    return grayVal.toString(2).padStart(numFlops, '0');
  }

  for (let i = 0; i < numStates; i++) {
    if (strategy === 'gray') {
      codes[st.states[i]] = getGrayCode(i);
    } else {
      codes[st.states[i]] = i.toString(2).padStart(numFlops, '0');
    }
  }

  return { codes, flops: numFlops };
}

/**
 * Synthesizes an entire FSM into excitation equations and a gate-level Netlist.
 */
export function designFSM(
  st: StateTable,
  ffType: FFType = 'D',
  strategy: 'binary' | 'gray' | 'one-hot' = 'binary'
): FSMDesignResult {
  const steps: Step[] = [];
  const { codes, flops } = assignStates(st, strategy);

  steps.push({
    title: 'State Assignment',
    detail: `Assigned ${strategy} codes using ${flops} flip-flops (${ffType} type).`,
    data: codes,
  });

  const numInputBits = st.inputs.length;
  const numTotalInputs = flops + numInputBits;
  const totalCombos = 1 << numTotalInputs;

  // Variables list: Q(flops-1)..Q0, In(m-1)..In0
  const varNames: string[] = [];
  for (let i = flops - 1; i >= 0; i--) varNames.push(`Q${i}`);
  for (const inp of st.inputs) varNames.push(inp);

  // Map codes to state names
  const codeToState = new Map<string, string>();
  for (const [name, code] of Object.entries(codes)) {
    codeToState.set(code, name);
  }

  // Excitation lookup table
  const excitLookup = new Map<string, Record<string, 0 | 1 | 'x'>>();
  for (const row of excitationTable(ffType)) {
    excitLookup.set(`${row.q}->${row.nextQ}`, row.inputs);
  }

  // FF inputs to synthesize: e.g. D0..D(k-1), or J0,K0..
  const ffInputNames: string[] = [];
  for (let i = 0; i < flops; i++) {
    switch (ffType) {
      case 'D':
        ffInputNames.push(`D${i}`);
        break;
      case 'T':
        ffInputNames.push(`T${i}`);
        break;
      case 'JK':
        ffInputNames.push(`J${i}`, `K${i}`);
        break;
      case 'SR':
        ffInputNames.push(`S${i}`, `R${i}`);
        break;
    }
  }

  // Tables of output vectors across all 2^(flops + inputs) combos
  const ffTargetOutputs: Record<string, (0 | 1 | 'x')[]> = {};
  for (const name of ffInputNames) ffTargetOutputs[name] = new Array(totalCombos).fill('x');

  const primaryOutputs: Record<string, (0 | 1 | 'x')[]> = {};
  for (const outName of st.outputs) primaryOutputs[outName] = new Array(totalCombos).fill('x');

  const transitionTable: Record<string, unknown>[] = [];

  for (let codeIdx = 0; codeIdx < totalCombos; codeIdx++) {
    const qCode = ((codeIdx >> numInputBits) & ((1 << flops) - 1))
      .toString(2)
      .padStart(flops, '0');
    const inCode = (codeIdx & ((1 << numInputBits) - 1))
      .toString(2)
      .padStart(numInputBits, '0');

    const currState = codeToState.get(qCode);
    if (!currState) {
      // Unused state code -> don't cares
      continue;
    }

    // Find matching transition
    const matchingRow = st.rows.find((r) => {
      if (r.state !== currState) return false;
      for (let b = 0; b < numInputBits; b++) {
        if (r.input[b] !== '-' && r.input[b] !== inCode[b]) return false;
      }
      return true;
    });

    if (!matchingRow) continue;

    const nextState = matchingRow.next;
    const nextCode = codes[nextState];
    const outBitStr = matchingRow.output;

    // Record transition row
    const rowRecord: Record<string, unknown> = {
      state: currState,
      code: qCode,
      input: inCode,
      nextState,
      nextCode,
      output: outBitStr,
    };

    // Set primary outputs
    for (let o = 0; o < st.outputs.length; o++) {
      const bitVal = outBitStr[o] === '1' ? 1 : 0;
      primaryOutputs[st.outputs[o]][codeIdx] = bitVal;
    }

    // Set flip-flop excitations
    for (let f = 0; f < flops; f++) {
      const qBit = parseInt(qCode[flops - 1 - f], 10) as 0 | 1;
      const nextQBit = parseInt(nextCode[flops - 1 - f], 10) as 0 | 1;
      const reqInputs = excitLookup.get(`${qBit}->${nextQBit}`) ?? {};

      switch (ffType) {
        case 'D':
          ffTargetOutputs[`D${f}`][codeIdx] = reqInputs.D ?? nextQBit;
          rowRecord[`D${f}`] = reqInputs.D ?? nextQBit;
          break;
        case 'T':
          ffTargetOutputs[`T${f}`][codeIdx] = reqInputs.T ?? (qBit ^ nextQBit);
          rowRecord[`T${f}`] = reqInputs.T;
          break;
        case 'JK':
          ffTargetOutputs[`J${f}`][codeIdx] = reqInputs.J ?? 'x';
          ffTargetOutputs[`K${f}`][codeIdx] = reqInputs.K ?? 'x';
          rowRecord[`J${f}`] = reqInputs.J;
          rowRecord[`K${f}`] = reqInputs.K;
          break;
        case 'SR':
          ffTargetOutputs[`S${f}`][codeIdx] = reqInputs.S ?? 'x';
          ffTargetOutputs[`R${f}`][codeIdx] = reqInputs.R ?? 'x';
          rowRecord[`S${f}`] = reqInputs.S;
          rowRecord[`R${f}`] = reqInputs.R;
          break;
      }
    }

    transitionTable.push(rowRecord);
  }

  // Minimize equations using Quine-McCluskey
  const flipFlopInputEquations: Record<string, string> = {};
  const nextStateEquations: Record<string, string> = {};
  const outputEquations: Record<string, string> = {};
  const nodes: Node[] = [];

  // Flip-flop inputs
  const ffDrivingNets: Record<string, string> = {};

  for (const ffInName of ffInputNames) {
    const outputsVec = ffTargetOutputs[ffInName];
    const tt = truthTableFromOutputs(varNames, outputsVec);
    const minRes = quineMcCluskey(tt, 'SOP');
    flipFlopInputEquations[ffInName] = minRes.text;

    // Synthesize combinational logic
    const netlistFragment = exprToNetlist(minRes.expr, { name: ffInName });
    for (const node of netlistFragment.nodes) {
      nodes.push(node);
    }
    ffDrivingNets[ffInName] = netlistFragment.outputs[0];
  }

  // Next-state equations
  for (let f = 0; f < flops; f++) {
    switch (ffType) {
      case 'D':
        nextStateEquations[`Q${f}+`] = flipFlopInputEquations[`D${f}`] || `D${f}`;
        break;
      case 'T':
        nextStateEquations[`Q${f}+`] = `${flipFlopInputEquations[`T${f}`]} ⊕ Q${f}`;
        break;
      case 'JK':
        nextStateEquations[`Q${f}+`] = `J${f}Q${f}' + K${f}'Q${f}`;
        break;
      case 'SR':
        nextStateEquations[`Q${f}+`] = `S${f} + R${f}'Q${f}`;
        break;
    }
  }

  // Primary outputs
  for (const outName of st.outputs) {
    const outputsVec = primaryOutputs[outName];
    const tt = truthTableFromOutputs(varNames, outputsVec);
    const minRes = quineMcCluskey(tt, 'SOP');
    outputEquations[outName] = minRes.text;

    const netlistFragment = exprToNetlist(minRes.expr, { name: outName });
    for (const node of netlistFragment.nodes) {
      nodes.push(node);
    }
    const fragOut = netlistFragment.outputs[0];
    if (fragOut !== outName) {
      nodes.push({
        kind: 'gate',
        id: `buf_${outName}`,
        type: 'BUF',
        inputs: [fragOut],
        output: outName,
      });
    }
  }

  // Add the flip-flop nodes
  for (let f = 0; f < flops; f++) {
    const qName = `Q${f}`;
    const qnName = `qn${f}`;

    switch (ffType) {
      case 'D':
        nodes.push({
          kind: 'ff',
          id: `ff_d_${f}`,
          type: 'D',
          edge: 'rising',
          clk: 'CLK',
          d: ffDrivingNets[`D${f}`],
          q: qName,
          qn: qnName,
          init: 0,
        });
        break;
      case 'T':
        nodes.push({
          kind: 'ff',
          id: `ff_t_${f}`,
          type: 'T',
          edge: 'rising',
          clk: 'CLK',
          t: ffDrivingNets[`T${f}`],
          q: qName,
          qn: qnName,
          init: 0,
        });
        break;
      case 'JK':
        nodes.push({
          kind: 'ff',
          id: `ff_jk_${f}`,
          type: 'JK',
          edge: 'rising',
          clk: 'CLK',
          j: ffDrivingNets[`J${f}`],
          k: ffDrivingNets[`K${f}`],
          q: qName,
          qn: qnName,
          init: 0,
        });
        break;
      case 'SR':
        nodes.push({
          kind: 'ff',
          id: `ff_sr_${f}`,
          type: 'SR',
          edge: 'rising',
          clk: 'CLK',
          s: ffDrivingNets[`S${f}`],
          r: ffDrivingNets[`R${f}`],
          q: qName,
          qn: qnName,
          init: 0,
        });
        break;
    }
  }

  steps.push({
    title: 'Excitation Equations Synthesis',
    detail: `Synthesized equations for ${ffInputNames.join(', ')} and primary outputs.`,
    data: { flipFlopInputEquations, outputEquations },
  });

  return {
    netlist: {
      name: `fsm_${st.model}_designed`,
      inputs: ['CLK', ...st.inputs],
      outputs: [...st.outputs],
      clock: 'CLK',
      nodes,
    },
    nextStateEquations,
    flipFlopInputEquations,
    outputEquations,
    transitionTable,
    steps,
  };
}

/**
 * Analyzes a sequential circuit Netlist to extract flip-flop equations,
 * state transition table, unreachable states, and lock-up detection.
 */
export function analyzeCircuit(netlist: Netlist): CircuitAnalysisResult {
  const steps: Step[] = [];
  const flops = netlist.nodes.filter((n) => n.kind === 'ff') as FlipFlop[];
  const gates = netlist.nodes.filter((n) => n.kind === 'gate') as Gate[];
  const numFlops = flops.length;
  const numStates = 1 << numFlops;

  const primaryInputs = netlist.inputs.filter((i) => i !== 'CLK' && i !== netlist.clock);
  const numInputBits = primaryInputs.length;
  const numInputCombos = 1 << numInputBits;

  steps.push({
    title: 'Circuit Identification',
    detail: `Identified ${numFlops} flip-flop(s) and ${gates.length} logic gate(s). Primary inputs: {${primaryInputs.join(', ') || 'none'}}.`,
  });

  // FF Equations & Output Equations
  const flipFlopInputEquations: Record<string, string> = {};
  const nextStateEquations: Record<string, string> = {};
  const outputEquations: Record<string, string> = {};

  for (let f = 0; f < numFlops; f++) {
    const ff = flops[f];
    const qName = ff.q;
    flipFlopInputEquations[qName] = ff.d ?? ff.t ?? (ff.j ? `J=${ff.j}, K=${ff.k}` : 'unknown');
    nextStateEquations[`${qName}+`] = characteristicEquation(ff.type);
  }

  for (const outNet of netlist.outputs) {
    outputEquations[outNet] = `f(${outNet})`;
  }

  // Enumerate state transitions
  const stateNames: string[] = [];
  for (let c = 0; c < numStates; c++) {
    stateNames.push(`S${c}`);
  }

  const rows: StateTable['rows'] = [];
  const reachable = new Set<string>();
  reachable.add('S0'); // Reset state S0

  for (let stateCode = 0; stateCode < numStates; stateCode++) {
    const sName = `S${stateCode}`;

    for (let inCode = 0; inCode < numInputCombos; inCode++) {
      const inStr = inCode.toString(2).padStart(numInputBits, '0');

      // Setup inputs and current FF values
      const simVals: Record<string, 0 | 1> = {};
      for (let b = 0; b < numInputBits; b++) {
        const bitVal = ((inCode >> (numInputBits - 1 - b)) & 1) as 0 | 1;
        simVals[primaryInputs[b]] = bitVal;
      }
      for (let f = 0; f < numFlops; f++) {
        const qBit = ((stateCode >> (numFlops - 1 - f)) & 1) as 0 | 1;
        simVals[flops[f].q] = qBit;
        if (flops[f].qn) simVals[flops[f].qn] = qBit === 1 ? 0 : 1;
      }

      // Evaluate combinational nets
      const evaluated = evaluate(netlist, simVals);

      // Compute next Q for each flip flop
      let nextStateCode = 0;
      for (let f = 0; f < numFlops; f++) {
        const ff = flops[f];
        const currentQ = simVals[ff.q];
        const ffInputs: Record<string, 0 | 1> = {};
        if (ff.d) ffInputs.D = evaluated[ff.d] ?? 0;
        if (ff.t) ffInputs.T = evaluated[ff.t] ?? 0;
        if (ff.j) ffInputs.J = evaluated[ff.j] ?? 0;
        if (ff.k) ffInputs.K = evaluated[ff.k] ?? 0;
        if (ff.s) ffInputs.S = evaluated[ff.s] ?? 0;
        if (ff.r) ffInputs.R = evaluated[ff.r] ?? 0;

        const nq = nextQ(ff.type, currentQ, ffInputs);
        const resolvedQ = nq === 'x' ? 0 : nq;
        nextStateCode |= resolvedQ << (numFlops - 1 - f);
      }

      const nextStateName = `S${nextStateCode}`;
      if (reachable.has(sName)) {
        reachable.add(nextStateName);
      }

      // Compute primary outputs
      let outStr = '';
      for (const outNet of netlist.outputs) {
        outStr += (evaluated[outNet] ?? 0).toString();
      }

      rows.push({
        state: sName,
        input: inStr,
        next: nextStateName,
        output: outStr || '0',
      });
    }
  }

  // Propagate full reachable set
  let reachableChanged = true;
  while (reachableChanged) {
    reachableChanged = false;
    for (const r of rows) {
      if (reachable.has(r.state) && !reachable.has(r.next)) {
        reachable.add(r.next);
        reachableChanged = true;
      }
    }
  }

  const unusedStates: string[] = [];
  for (const s of stateNames) {
    if (!reachable.has(s)) unusedStates.push(s);
  }

  // Lock-up check: does any state in the reachable set form an inescapable single-state trap
  // with no way to progress, or have non-deterministic/deadlock transitions?
  let lockUp = false;
  for (const s of reachable) {
    const sRows = rows.filter((r) => r.state === s);
    if (sRows.every((r) => r.next === s && r.next !== 'S0')) {
      lockUp = true;
      break;
    }
  }

  steps.push({
    title: 'State Reachability Analysis',
    detail: `Found ${reachable.size} reachable state(s) and ${unusedStates.length} unused state(s). Lockup detected: ${lockUp}.`,
  });

  return {
    flipFlopInputEquations,
    nextStateEquations,
    outputEquations,
    stateTable: {
      model: 'mealy',
      inputs: [...primaryInputs],
      outputs: [...netlist.outputs],
      states: stateNames,
      reset: 'S0',
      rows,
    },
    unusedStates,
    lockUp,
    steps,
  };
}
