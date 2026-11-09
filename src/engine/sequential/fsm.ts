/**
 * Aletheia Sequential Engine — FSM Synthesis, Analysis & State Reduction
 * Implements state table validation, state diagram extraction,
 * implication-table state reduction, state assignment (binary, gray, one-hot),
 * automated FSM design synthesis using Quine-McCluskey, and circuit reverse analysis.
 */

import type { StateTable, Netlist, FFType, Step, Node, FlipFlop, Gate } from '../types';
import { excitationTable, nextQ } from './flipflops';
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
      if (!/^[01]*$/.test(r.output)) {
        errors.push(`Row for state '${r.state}' has a non-binary output '${r.output}'.`);
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

  const edgeLabels = new Map<string, { from: string; to: string; labels: string[] }>();
  for (const r of st.rows) {
    const label = st.model === 'mealy' ? `${r.input} / ${r.output}` : r.input;
    const key = `${r.state}\u0000${r.next}`;
    const edge = edgeLabels.get(key);
    if (edge) edge.labels.push(label);
    else edgeLabels.set(key, { from: r.state, to: r.next, labels: [label] });
  }

  const edges = Array.from(edgeLabels.values(), ({ from, to, labels }) => ({
    from,
    to,
    label: labels.join(', '),
  }));
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
    st.states.forEach((s, i) => {
      codes[s] = '0'.repeat(numStates - 1 - i) + '1' + '0'.repeat(i);
    });
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
  const reservedNets = new Set([
    'CLK',
    ...st.inputs,
    ...Array.from({ length: flops }, (_, i) => [`Q${i}`, `qn${i}`]).flat(),
  ]);
  const conflictingOutput = st.outputs.find((name) => reservedNets.has(name));
  if (conflictingOutput) {
    throw new Error(`FSM output '${conflictingOutput}' conflicts with an internal or input net.`);
  }
  let internalName = 0;
  const names = {
    net: (prefix = 'n') => `_int_${prefix}_${++internalName}`,
    gate: (type = 'g') => `_int_${type.toLowerCase()}_${++internalName}`,
  };

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
    const netlistFragment = exprToNetlist(minRes.expr, { name: ffInName, names });
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

    const netlistFragment = exprToNetlist(minRes.expr, { name: outName, names });
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

  // Add the flip-flop nodes with initial values matching the reset state encoding
  const resetCode = codes[st.reset] ?? '0'.repeat(flops);
  for (let f = 0; f < flops; f++) {
    const qName = `Q${f}`;
    const qnName = `qn${f}`;
    const initVal = (parseInt(resetCode[flops - 1 - f], 10) || 0) as 0 | 1;

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
          init: initVal,
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
          init: initVal,
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
          init: initVal,
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
          init: initVal,
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
  const flops = (netlist.nodes.filter((n) => n.kind === 'ff') as FlipFlop[]).sort((a, b) => {
    const ma = a.q.match(/\d+/) ?? a.id.match(/\d+/);
    const mb = b.q.match(/\d+/) ?? b.id.match(/\d+/);
    if (ma && mb) {
      const na = parseInt(ma[0], 10);
      const nb = parseInt(mb[0], 10);
      if (na !== nb) return na - nb;
    }
    return a.q.localeCompare(b.q);
  });
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

  if (numFlops === 0) {
    return {
      flipFlopInputEquations: {},
      nextStateEquations: {},
      outputEquations: {},
      stateTable: {
        model: 'moore',
        inputs: [...primaryInputs],
        outputs: [...netlist.outputs],
        states: [],
        reset: '',
        rows: [],
      },
      unusedStates: [],
      lockUp: false,
      steps,
    };
  }

  // Variables for truth tables: state variables (MSB to LSB: Q(n-1)..Q0) followed by primary inputs
  const varNames: string[] = [];
  for (let f = numFlops - 1; f >= 0; f--) {
    varNames.push(flops[f].q);
  }
  for (const inp of primaryInputs) {
    varNames.push(inp);
  }

  const numTotalVars = numFlops + numInputBits;
  const totalCombos = 1 << numTotalVars;

  // Identify FF input targets
  const ffInputTargets: { name: string; driverNet?: string }[] = [];
  for (let f = 0; f < numFlops; f++) {
    const ff = flops[f];
    const idx = ff.q.match(/\d+/)?.[0] ?? `${f}`;
    switch (ff.type) {
      case 'D':
        ffInputTargets.push({ name: `D${idx}`, driverNet: ff.d });
        break;
      case 'T':
        ffInputTargets.push({ name: `T${idx}`, driverNet: ff.t });
        break;
      case 'JK':
        ffInputTargets.push({ name: `J${idx}`, driverNet: ff.j });
        ffInputTargets.push({ name: `K${idx}`, driverNet: ff.k });
        break;
      case 'SR':
        ffInputTargets.push({ name: `S${idx}`, driverNet: ff.s });
        ffInputTargets.push({ name: `R${idx}`, driverNet: ff.r });
        break;
    }
  }

  const ffInputVectors: Record<string, (0 | 1)[]> = {};
  for (const target of ffInputTargets) {
    ffInputVectors[target.name] = [];
  }

  const nextQVectors: Record<string, (0 | 1)[]> = {};
  for (let f = 0; f < numFlops; f++) {
    nextQVectors[`${flops[f].q}+`] = [];
  }

  const primaryOutputVectors: Record<string, (0 | 1)[]> = {};
  for (const outNet of netlist.outputs) {
    primaryOutputVectors[outNet] = [];
  }

  function resolveNetVal(net: string | undefined, evaluated: Record<string, 0 | 1>): 0 | 1 {
    if (net === undefined) return 0;
    if (net === '1') return 1;
    if (net === '0') return 0;
    return evaluated[net] ?? 0;
  }

  // Evaluate across all state and input combinations
  for (let comboIdx = 0; comboIdx < totalCombos; comboIdx++) {
    const inCode = comboIdx & ((1 << numInputBits) - 1);
    const stateCode = (comboIdx >> numInputBits) & ((1 << numFlops) - 1);

    const simVals: Record<string, 0 | 1> = {};

    for (let b = 0; b < numInputBits; b++) {
      const bitVal = ((inCode >> (numInputBits - 1 - b)) & 1) as 0 | 1;
      const inputNet = primaryInputs[b];
      if (inputNet !== undefined) simVals[inputNet] = bitVal;
    }

    for (let f = 0; f < numFlops; f++) {
      const qBit = ((stateCode >> f) & 1) as 0 | 1;
      simVals[flops[f].q] = qBit;
      const qn = flops[f].qn;
      if (qn !== undefined) {
        simVals[qn] = (1 - qBit) as 0 | 1;
      }
    }

    const evaluated = evaluate(netlist, simVals);

    // Record FF inputs
    for (const target of ffInputTargets) {
      ffInputVectors[target.name].push(resolveNetVal(target.driverNet, evaluated));
    }

    // Record next state bits
    for (let f = 0; f < numFlops; f++) {
      const ff = flops[f];
      const currentQ = simVals[ff.q];
      const ffInputs: Record<string, 0 | 1> = {};
      if (ff.d) ffInputs.D = resolveNetVal(ff.d, evaluated);
      if (ff.t) ffInputs.T = resolveNetVal(ff.t, evaluated);
      if (ff.j) ffInputs.J = resolveNetVal(ff.j, evaluated);
      if (ff.k) ffInputs.K = resolveNetVal(ff.k, evaluated);
      if (ff.s) ffInputs.S = resolveNetVal(ff.s, evaluated);
      if (ff.r) ffInputs.R = resolveNetVal(ff.r, evaluated);

      const nq = nextQ(ff.type, currentQ, ffInputs);
      const resolvedQ = nq === 'x' ? 0 : nq;
      nextQVectors[`${ff.q}+`].push(resolvedQ);
    }

    // Record primary outputs
    for (const outNet of netlist.outputs) {
      primaryOutputVectors[outNet].push(resolveNetVal(outNet, evaluated));
    }
  }

  // Derive real minimized equations
  const flipFlopInputEquations: Record<string, string> = {};
  for (const target of ffInputTargets) {
    const tt = truthTableFromOutputs(varNames, ffInputVectors[target.name]);
    const minRes = quineMcCluskey(tt, 'SOP');
    flipFlopInputEquations[target.name] = minRes.text;
  }

  const nextStateEquations: Record<string, string> = {};
  for (let f = 0; f < numFlops; f++) {
    const qKey = `${flops[f].q}+`;
    const tt = truthTableFromOutputs(varNames, nextQVectors[qKey]);
    const minRes = quineMcCluskey(tt, 'SOP');
    nextStateEquations[qKey] = minRes.text;
  }

  const outputEquations: Record<string, string> = {};
  for (const outNet of netlist.outputs) {
    const tt = truthTableFromOutputs(varNames, primaryOutputVectors[outNet]);
    const minRes = quineMcCluskey(tt, 'SOP');
    outputEquations[outNet] = minRes.text;
  }

  // Determine Moore vs Mealy: Mealy if any output depends on any primary input
  let isMealy = false;
  if (numInputBits > 0 && netlist.outputs.length > 0) {
    for (const outNet of netlist.outputs) {
      for (let stateCode = 0; stateCode < numStates; stateCode++) {
        const baseIdx = stateCode << numInputBits;
        const firstVal = primaryOutputVectors[outNet][baseIdx];
        for (let inCode = 1; inCode < numInputCombos; inCode++) {
          if (primaryOutputVectors[outNet][baseIdx | inCode] !== firstVal) {
            isMealy = true;
            break;
          }
        }
        if (isMealy) break;
      }
      if (isMealy) break;
    }
  }
  const model: 'moore' | 'mealy' = isMealy ? 'mealy' : 'moore';

  // Build state table rows
  const stateNames = Array.from({ length: numStates }, (_, c) => `S${c}`);
  const rows: StateTable['rows'] = [];

  for (let stateCode = 0; stateCode < numStates; stateCode++) {
    const sName = `S${stateCode}`;
    for (let inCode = 0; inCode < numInputCombos; inCode++) {
      const inStr = inCode.toString(2).padStart(numInputBits, '0');
      const comboIdx = (stateCode << numInputBits) | inCode;

      let nextStateCode = 0;
      for (let f = 0; f < numFlops; f++) {
        const nq = nextQVectors[`${flops[f].q}+`][comboIdx];
        nextStateCode |= nq << f;
      }
      const nextStateName = `S${nextStateCode}`;

      let outStr = '';
      for (const outNet of netlist.outputs) {
        outStr += primaryOutputVectors[outNet][comboIdx].toString();
      }

      rows.push({
        state: sName,
        input: inStr,
        next: nextStateName,
        output: outStr || '0',
      });
    }
  }

  // Reset state from flip-flop init values
  let resetCode = 0;
  for (let f = 0; f < numFlops; f++) {
    const initBit = (flops[f].init ?? 0) as 0 | 1;
    resetCode |= initBit << f;
  }
  const resetStateName = `S${resetCode}`;

  // Reachable states from reset
  const reachable = new Set<string>();
  reachable.add(resetStateName);

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

  const unusedStates = stateNames.filter((s) => !reachable.has(s));

  // Lock-up detection:
  // 1. Any state (unused or reachable) that can NEVER re-enter the reachable set
  const canReachReachable = new Set<string>(reachable);
  let backChanged = true;
  while (backChanged) {
    backChanged = false;
    for (const r of rows) {
      if (canReachReachable.has(r.next) && !canReachReachable.has(r.state)) {
        canReachReachable.add(r.state);
        backChanged = true;
      }
    }
  }

  let lockUp = false;
  for (const s of stateNames) {
    if (!canReachReachable.has(s)) {
      lockUp = true;
      break;
    }
  }

  // 2. Plus any state in a multi-state reachable machine that loops to itself on every input without exit
  if (!lockUp && reachable.size > 1) {
    for (const s of reachable) {
      const sRows = rows.filter((r) => r.state === s);
      if (sRows.length > 0 && sRows.every((r) => r.next === s)) {
        lockUp = true;
        break;
      }
    }
  }

  steps.push({
    title: 'State Reachability Analysis',
    detail: `Found ${reachable.size} reachable state(s) and ${unusedStates.length} unused state(s). Lockup detected: ${lockUp}. Model: ${model}.`,
  });

  return {
    flipFlopInputEquations,
    nextStateEquations,
    outputEquations,
    stateTable: {
      model,
      inputs: [...primaryInputs],
      outputs: [...netlist.outputs],
      states: stateNames,
      reset: resetStateName,
      rows,
    },
    unusedStates,
    lockUp,
    steps,
  };
}
