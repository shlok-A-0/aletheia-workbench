/**
 * Aletheia Sequential Engine — Clocked Sequential Simulator
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
  warnings: string[];
}

export interface RunSequenceResult {
  states: Record<NetId, 0 | 1>[];
  outputs: Record<NetId, 0 | 1>[];
  nets: Record<NetId, 0 | 1>[];
  transitions: Record<NetId, { rise: number; fall: number }>;
  inputChangeOutputs: { afterTick: number; outputs: Record<NetId, 0 | 1> }[];
  warnings: string[];
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
 * Net-level sequential stepping function.
 * Evaluates level-sensitive asynchronous preset/clear immediately,
 * detects active clock edges (rising / falling) per flip-flop based on transition
 * from prevNets to current nets, propagates ripple clocking through derived stages,
 * and reports warnings for invalid conditions (such as SR with S=R=1).
 */
export function stepClockNets(
  netlist: Netlist,
  currentState: Record<NetId, 0 | 1>,
  prevNets: Record<NetId, 0 | 1>,
  newInputs: Record<NetId, 0 | 1>
): ClockStepResult {
  const flops = netlist.nodes.filter((n) => n.kind === 'ff') as FlipFlop[];
  const warnings: string[] = [];

  // 1. Initial combinational evaluation with current state and new inputs
  let currNets = evaluate(netlist, applyFlopOutputs(flops, currentState, newInputs));
  const nextState: Record<NetId, 0 | 1> = { ...currentState };

  // 2. Asynchronous preset / clear act immediately (level-sensitive)
  let asyncChanged = false;
  for (const ff of flops) {
    if (ff.clear && currNets[ff.clear] === 1) {
      if (nextState[ff.q] !== 0) {
        nextState[ff.q] = 0;
        asyncChanged = true;
      }
    } else if (ff.preset && currNets[ff.preset] === 1) {
      if (nextState[ff.q] !== 1) {
        nextState[ff.q] = 1;
        asyncChanged = true;
      }
    }
  }

  if (asyncChanged) {
    currNets = evaluate(netlist, applyFlopOutputs(flops, nextState, newInputs));
  }

  // 3. Active clock edges and ripple clock propagation
  const triggeredFlops = new Set<string>();
  const lastKnownNets: Record<NetId, 0 | 1> = { ...prevNets };
  let edgeProgressed = true;
  let rippleDepth = 0;
  const maxRippleDepth = flops.length + 10;

  while (edgeProgressed && rippleDepth < maxRippleDepth) {
    edgeProgressed = false;
    rippleDepth++;
    const newlyTriggered: { ff: FlipFlop; nextQVal: 0 | 1 }[] = [];

    for (const ff of flops) {
      if (triggeredFlops.has(ff.id)) continue;

      // Preset / clear active at edge wins over clock edge
      if (ff.clear && currNets[ff.clear] === 1) continue;
      if (ff.preset && currNets[ff.preset] === 1) continue;

      const clkNet = ff.clk ?? netlist.clock ?? 'CLK';
      const prevClk = lastKnownNets[clkNet] ?? 0;
      const currClk = currNets[clkNet] ?? 0;

      const edge = ff.edge ?? 'rising';
      const isActiveEdge =
        (edge === 'rising' && prevClk === 0 && currClk === 1) ||
        (edge === 'falling' && prevClk === 1 && currClk === 0);

      if (isActiveEdge) {
        triggeredFlops.add(ff.id);
        edgeProgressed = true;

        const currentQ = nextState[ff.q] ?? (ff.init ?? 0);
        const ffInputs: Record<string, 0 | 1> = {};

        switch (ff.type) {
          case 'D':
            if (ff.d) ffInputs.D = currNets[ff.d] ?? 0;
            break;
          case 'T':
            if (ff.t) ffInputs.T = currNets[ff.t] ?? 0;
            break;
          case 'JK':
            if (ff.j) ffInputs.J = currNets[ff.j] ?? 0;
            if (ff.k) ffInputs.K = currNets[ff.k] ?? 0;
            break;
          case 'SR':
            if (ff.s) ffInputs.S = currNets[ff.s] ?? 0;
            if (ff.r) ffInputs.R = currNets[ff.r] ?? 0;
            break;
        }

        if (ff.type === 'SR' && ffInputs.S === 1 && ffInputs.R === 1) {
          warnings.push(`SR flip-flop '${ff.id}' entered invalid state S=1, R=1; state kept unchanged.`);
          newlyTriggered.push({ ff, nextQVal: currentQ });
        } else {
          const calculatedQ = nextQ(ff.type, currentQ, ffInputs);
          const resolvedQ = calculatedQ === 'x' ? currentQ : calculatedQ;
          newlyTriggered.push({ ff, nextQVal: resolvedQ });
        }
      }
    }

    if (newlyTriggered.length > 0) {
      for (const [k, v] of Object.entries(currNets)) {
        lastKnownNets[k] = v;
      }
      for (const item of newlyTriggered) {
        nextState[item.ff.q] = item.nextQVal;
      }
      currNets = evaluate(netlist, applyFlopOutputs(flops, nextState, newInputs));
    }
  }

  return {
    state: nextState,
    nets: currNets,
    warnings,
  };
}

/**
 * Executes a single active clock edge helper on a sequential netlist.
 */
export function stepClock(
  netlist: Netlist,
  currentState: Record<NetId, 0 | 1>,
  inputs: Record<NetId, 0 | 1>
): ClockStepResult {
  const flops = netlist.nodes.filter((n) => n.kind === 'ff') as FlipFlop[];
  const clkNet = netlist.clock ?? 'CLK';

  // Check if primary flip-flops are falling-edge triggered
  const primaryFlops = flops.filter((ff) => !ff.clk || ff.clk === clkNet);
  const isFalling = primaryFlops.some((ff) => ff.edge === 'falling');

  let prevClk: 0 | 1;
  let currClk: 0 | 1;
  if (inputs[clkNet] !== undefined) {
    currClk = inputs[clkNet];
    prevClk = (1 - currClk) as 0 | 1;
  } else {
    currClk = isFalling ? 0 : 1;
    prevClk = isFalling ? 1 : 0;
  }

  const prevInputs: Record<NetId, 0 | 1> = { ...inputs, [clkNet]: prevClk };
  const currInputs: Record<NetId, 0 | 1> = { ...inputs, [clkNet]: currClk };

  const prevNets = evaluate(netlist, applyFlopOutputs(flops, currentState, prevInputs));
  return stepClockNets(netlist, currentState, prevNets, currInputs);
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
  const allWarnings: string[] = [];

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
    if (stepResult.warnings.length > 0) {
      allWarnings.push(...stepResult.warnings);
    }

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
    warnings: allWarnings,
  };
}
