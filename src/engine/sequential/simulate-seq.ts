/**
 * LDAM Sequential Engine — Clocked Sequential Simulator
 * Implements synchronous flip-flop updates with simultaneous edge evaluation,
 * asynchronous preset/clear handling, sequence execution, transition counting,
 * and Mealy intermediate output recording.
 */

import type { Netlist, NetId, FlipFlop } from '../types';
import { evaluate } from '../circuit/simulate';
import { nextQ } from './flipflops';

export interface ClockStepResult {
  state: Record<NetId, 0 | 1>;
  nets: Record<NetId, 0 | 1>;
}

export interface RunSequenceResult {
  states: Record<NetId, 0 | 1>[];
  outputs: Record<NetId, 0 | 1>[];
  nets: Record<NetId, 0 | 1>[];
  transitions: Record<NetId, { rise: number; fall: number }>;
  inputChangeOutputs: { afterTick: number; outputs: Record<NetId, 0 | 1> }[];
}

/**
 * Executes a single active clock edge on a sequential netlist.
 * 1. Evaluates all combinational signals before the clock edge.
 * 2. Samples all flip-flop synchronous inputs simultaneously (no internal race condition).
 * 3. Updates all flip-flops simultaneously.
 * 4. Re-evaluates combinational logic with the new flip-flop outputs.
 */
function applyFlopOutputs(
  flops: FlipFlop[],
  state: Record<NetId, 0 | 1>,
  inputs: Record<NetId, 0 | 1>
): Record<NetId, 0 | 1> {
  const nets: Record<NetId, 0 | 1> = { ...inputs };
  for (const ff of flops) {
    const qVal = state[ff.q] ?? (ff.init ?? 0);
    nets[ff.q] = qVal;
    if (ff.qn) nets[ff.qn] = (1 - qVal) as 0 | 1;
  }
  return nets;
}

/**
 * Executes a single active clock edge on a sequential netlist.
 * 1. Evaluates all combinational signals before the clock edge.
 * 2. Samples all flip-flop synchronous inputs simultaneously (no internal race condition).
 * 3. Updates all flip-flops simultaneously.
 * 4. Re-evaluates combinational logic with the new flip-flop outputs.
 */
export function stepClock(
  netlist: Netlist,
  currentState: Record<NetId, 0 | 1>,
  inputs: Record<NetId, 0 | 1>
): ClockStepResult {
  const flops = netlist.nodes.filter((n) => n.kind === 'ff') as FlipFlop[];

  // 1. Build initial network state with current FF outputs + inputs
  const preEdgeValues = applyFlopOutputs(flops, currentState, inputs);

  // Evaluate all combinational signals prior to clock edge
  const evaluatedPreEdge = evaluate(netlist, preEdgeValues);

  // 2. Sample inputs and compute next Q for every flip-flop simultaneously
  const nextState: Record<NetId, 0 | 1> = {};

  for (const ff of flops) {
    // Check asynchronous preset / clear first
    if (ff.preset && evaluatedPreEdge[ff.preset] === 1) {
      nextState[ff.q] = 1;
      continue;
    }
    if (ff.clear && evaluatedPreEdge[ff.clear] === 1) {
      nextState[ff.q] = 0;
      continue;
    }

    const currentQ = currentState[ff.q] ?? (ff.init ?? 0);
    const ffInputs: Record<string, 0 | 1> = {};

    switch (ff.type) {
      case 'D':
        if (ff.d) ffInputs.D = evaluatedPreEdge[ff.d] ?? 0;
        break;
      case 'T':
        if (ff.t) ffInputs.T = evaluatedPreEdge[ff.t] ?? 0;
        break;
      case 'JK':
        if (ff.j) ffInputs.J = evaluatedPreEdge[ff.j] ?? 0;
        if (ff.k) ffInputs.K = evaluatedPreEdge[ff.k] ?? 0;
        break;
      case 'SR':
        if (ff.s) ffInputs.S = evaluatedPreEdge[ff.s] ?? 0;
        if (ff.r) ffInputs.R = evaluatedPreEdge[ff.r] ?? 0;
        break;
    }

    const calculatedQ = nextQ(ff.type, currentQ, ffInputs);
    nextState[ff.q] = calculatedQ === 'x' ? 0 : calculatedQ;
  }

  // 3. Update network values with the new flip-flop outputs
  const postEdgeValues = applyFlopOutputs(flops, nextState, inputs);

  // 4. Re-evaluate combinational outputs after flip-flops update
  const finalNets = evaluate(netlist, postEdgeValues);

  return {
    state: nextState,
    nets: finalNets,
  };
}

/**
 * Runs a sequence of clock cycles given a series of input vectors.
 * Records states, outputs, and net transition counts (rise/fall).
 */
export function runSequence(
  netlist: Netlist,
  inputSequence: Record<NetId, 0 | 1>[],
  opts?: { resetState?: Record<NetId, 0 | 1> }
): RunSequenceResult {
  const flops = netlist.nodes.filter((n) => n.kind === 'ff') as FlipFlop[];

  // Initialize state
  let currentState: Record<NetId, 0 | 1> = {};
  for (const ff of flops) {
    currentState[ff.q] = opts?.resetState?.[ff.q] ?? ff.init ?? 0;
  }

  const states: Record<NetId, 0 | 1>[] = [];
  const outputs: Record<NetId, 0 | 1>[] = [];
  const netsHistory: Record<NetId, 0 | 1>[] = [];
  const inputChangeOutputs: { afterTick: number; outputs: Record<NetId, 0 | 1> }[] = [];
  const transitions: Record<NetId, { rise: number; fall: number }> = {};

  let prevNets: Record<NetId, 0 | 1> | null = null;

  function recordTransitions(currentNets: Record<NetId, 0 | 1>) {
    if (!prevNets) {
      prevNets = { ...currentNets };
      return;
    }
    for (const [net, val] of Object.entries(currentNets)) {
      if (!transitions[net]) {
        transitions[net] = { rise: 0, fall: 0 };
      }
      const prev = prevNets[net];
      if (prev === 0 && val === 1) transitions[net].rise++;
      if (prev === 1 && val === 0) transitions[net].fall++;
    }
    prevNets = { ...currentNets };
  }

  // Initial step before clock pulses
  if (inputSequence.length > 0) {
    const evaluatedInitial = evaluate(netlist, applyFlopOutputs(flops, currentState, inputSequence[0]));
    recordTransitions(evaluatedInitial);
  }

  for (let tick = 0; tick < inputSequence.length; tick++) {
    const inputVec = inputSequence[tick];

    // For Mealy machines: check outputs with new inputs BEFORE active clock edge
    const preEdgeEvaluated = evaluate(netlist, applyFlopOutputs(flops, currentState, inputVec));
    const preOutputs: Record<NetId, 0 | 1> = {};
    for (const outNet of netlist.outputs) {
      preOutputs[outNet] = preEdgeEvaluated[outNet] ?? 0;
    }
    inputChangeOutputs.push({ afterTick: tick, outputs: preOutputs });

    // Active clock edge: update flip-flops
    const stepResult = stepClock(netlist, currentState, inputVec);
    currentState = stepResult.state;

    // Collect primary outputs
    const currentOutputs: Record<NetId, 0 | 1> = {};
    for (const outNet of netlist.outputs) {
      currentOutputs[outNet] = stepResult.nets[outNet] ?? 0;
    }

    recordTransitions(stepResult.nets);

    states.push({ ...currentState });
    outputs.push(currentOutputs);
    netsHistory.push(stepResult.nets);
  }

  return {
    states,
    outputs,
    nets: netsHistory,
    transitions,
    inputChangeOutputs,
  };
}
