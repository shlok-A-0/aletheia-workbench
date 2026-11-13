import type { FlipFlop, Gate, NetId, Netlist, StimulusEvent, Waveform } from '../types';
import { evaluate, truthTableOfNetlist, gateValue } from '../circuit/simulate';
import { primeImplicants } from '../minimize/qm';
import { nextQ } from '../sequential/flipflops';

export interface TimedSimulationOptions {
  clockPeriod: number;
  duty: number;
  edge: 'rising' | 'falling';
  defaultGateDelay: number;
  clkToQ: number;
  endTime: number;
  /** Time of the first rising edge (default 0). A non-zero offset keeps the first edge away from t = 0, when inputs are still settling. */
  clockOffset?: number;
}

interface ScheduledEvent {
  t: number;
  priority: number;
  order: number;
  kind: 'input' | 'clock' | 'gate' | 'flop';
  net?: NetId;
  value?: 0 | 1;
  changes?: Record<NetId, 0 | 1>;
  label?: string;
}

export interface SetupHoldResult {
  violations: { ff: string; t: number; kind: 'setup' | 'hold' }[];
}

function validateOptions(opts: TimedSimulationOptions): void {
  if (!Number.isFinite(opts.clockPeriod) || opts.clockPeriod <= 0) {
    throw new Error('clockPeriod must be a positive finite number.');
  }
  if (!Number.isFinite(opts.duty) || opts.duty <= 0 || opts.duty >= 1) {
    throw new Error('duty must be a fraction greater than 0 and less than 1.');
  }
  for (const [name, value] of [
    ['defaultGateDelay', opts.defaultGateDelay],
    ['clkToQ', opts.clkToQ],
    ['endTime', opts.endTime],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative finite number.`);
    }
  }
}

/**
 * Simulates a gate-level netlist with transport delays so short pulses remain visible.
 * The supplied edge option selects the active edge for every flip-flop in this run.
 * Duty is a fraction (0.5 means 50%).
 */
export function simulateTimed(
  netlist: Netlist,
  stimulus: StimulusEvent[],
  opts: TimedSimulationOptions
): Waveform {
  validateOptions(opts);
  const gates = netlist.nodes.filter((node): node is Gate => node.kind === 'gate');
  const flops = netlist.nodes.filter((node): node is FlipFlop => node.kind === 'ff');
  const clockNet = netlist.clock ?? flops[0]?.clk ?? 'CLK';
  const unsupported = netlist.nodes.find((node) => node.kind === 'block');
  if (unsupported) throw new Error(`Timed simulation does not support node kind: ${unsupported.kind}.`);

  for (const event of stimulus) {
    if (!Number.isFinite(event.t) || event.t < 0) throw new Error('Stimulus times must be non-negative finite numbers.');
    if (!netlist.inputs.includes(event.net)) {
      throw new Error(`Stimulus net '${event.net}' is not a primary input.`);
    }
  }

  const initialInputs: Record<NetId, 0 | 1> = {};
  for (const input of netlist.inputs) initialInputs[input] = 0;
  initialInputs[clockNet] = 0;
  const initialState: Record<NetId, 0 | 1> = {};
  for (const ff of flops) initialState[ff.q] = ff.init ?? 0;
  const initialNets = { ...initialInputs, ...initialState };
  for (const ff of flops) {
    if (ff.qn) initialNets[ff.qn] = (1 - initialState[ff.q]) as 0 | 1;
  }

  const values = { ...initialNets };
  for (const node of netlist.nodes) {
    if (node.kind === 'const') values[node.output] = node.value;
  }
  // Evaluate once to reject combinational cycles and establish the initial settled state.
  const initialEvaluation = evaluate(netlist, values);
  Object.assign(values, initialEvaluation);

  const transitions = new Map<NetId, { t: number; value: 0 | 1 }[]>();
  const allNets = new Set<NetId>([
    ...netlist.inputs,
    ...netlist.outputs,
    ...Object.keys(values),
    ...flops.flatMap((ff) => [ff.q, ...(ff.qn ? [ff.qn] : [])]),
  ]);
  for (const net of allNets) {
    transitions.set(net, [{ t: 0, value: net === clockNet ? 0 : (values[net] ?? 0) }]);
  }

  const events: Waveform['events'] = [];
  const lastGateTransition = new Map<NetId, number>();
  const queue: ScheduledEvent[] = [];
  let order = 0;
  const compareEvents = (a: ScheduledEvent, b: ScheduledEvent) =>
    a.t - b.t || a.priority - b.priority || a.order - b.order;
  const schedule = (event: Omit<ScheduledEvent, 'order'>) => {
    if (event.t > opts.endTime) return;
    const item: ScheduledEvent = { ...event, order: order++ };
    let low = 0;
    let high = queue.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (compareEvents(queue[mid], item) <= 0) low = mid + 1;
      else high = mid;
    }
    queue.splice(low, 0, item);
  };

  for (const event of stimulus) {
    if (event.net !== clockNet && event.t <= opts.endTime) {
      schedule({ ...event, kind: 'input', priority: 0 });
    }
  }

  const highTime = opts.clockPeriod * opts.duty;
  for (let rise = opts.clockOffset ?? 0; rise <= opts.endTime; rise += opts.clockPeriod) {
    schedule({
      t: rise,
      kind: 'clock',
      priority: 1,
      net: clockNet,
      value: 1,
      label: 'clock-edge:rising',
    });
    const fall = rise + highTime;
    if (fall <= opts.endTime) {
      schedule({
        t: fall,
        kind: 'clock',
        priority: 1,
        net: clockNet,
        value: 0,
        label: 'clock-edge:falling',
      });
    }
  }

  const scheduleAffectedGates = (changedNets: NetId[], now: number) => {
    const affected = new Set<Gate>();
    for (const changedNet of changedNets) {
      for (const gate of gates) {
        if (gate.inputs.includes(changedNet)) affected.add(gate);
      }
    }
    for (const gate of affected) {
      const gateInputs = gate.inputs.map((net) => values[net]);
      if (gateInputs.some((value) => value === undefined)) continue;
      const delay = gate.delay ?? opts.defaultGateDelay;
      if (!Number.isFinite(delay) || delay < 0) throw new Error(`Gate '${gate.id}' has an invalid delay.`);
      schedule({
        t: now + delay,
        kind: 'gate',
        priority: 2,
        net: gate.output,
        value: gateValue(gate.type, gateInputs as (0 | 1)[]),
      });
    }
  };

  const applyChanges = (changes: Record<NetId, 0 | 1>, now: number, gateNet?: NetId) => {
    const changed: { net: NetId; previous: 0 | 1 | undefined; value: 0 | 1 }[] = [];
    for (const [net, value] of Object.entries(changes)) {
      if (values[net] === value) continue;
      const previous = values[net];
      values[net] = value;
      changed.push({ net, previous, value });
      const history = transitions.get(net) ?? [];
      history.push({ t: now, value });
      transitions.set(net, history);
      allNets.add(net);

      if (gateNet === net) {
        const previousTime = lastGateTransition.get(net);
        const gate = gates.find((candidate) => candidate.output === net);
        const delay = gate?.delay ?? opts.defaultGateDelay;
        if (previousTime !== undefined && now - previousTime < delay) {
          events.push({ t: now, label: `glitch:${net}` });
        }
        lastGateTransition.set(net, now);
      }
    }
    if (changed.length > 0) {
      scheduleAffectedGates(changed.map((item) => item.net), now);
      for (const item of changed) sampleFlopsAtClockChange(item.net, item.previous, item.value, now);
    }
    return changed;
  };

  const queueFlopUpdate = (ff: FlipFlop, now: number, currentNets: Record<NetId, 0 | 1>) => {
    if ((ff.clear && currentNets[ff.clear] === 1) || (ff.preset && currentNets[ff.preset] === 1)) return;
    const q = values[ff.q] ?? ff.init ?? 0;
    const inputValues: Record<string, 0 | 1> = {};
    if (ff.d) inputValues.D = currentNets[ff.d] ?? 0;
    if (ff.j) inputValues.J = currentNets[ff.j] ?? 0;
    if (ff.k) inputValues.K = currentNets[ff.k] ?? 0;
    if (ff.s) inputValues.S = currentNets[ff.s] ?? 0;
    if (ff.r) inputValues.R = currentNets[ff.r] ?? 0;
    if (ff.t) inputValues.T = currentNets[ff.t] ?? 0;
    const next = nextQ(ff.type, q, inputValues);
    if (ff.type === 'SR' && inputValues.S === 1 && inputValues.R === 1) {
      events.push({ t: now, label: `warning:SR-invalid:${ff.id}` });
      return;
    }
    if (next === 'x') return;
    const changes: Record<NetId, 0 | 1> = { [ff.q]: next };
    if (ff.qn) changes[ff.qn] = (1 - next) as 0 | 1;
    schedule({ t: now + opts.clkToQ, kind: 'flop', priority: 3, changes });
  };

  const scheduleAsyncControls = (now: number) => {
    for (const ff of flops) {
      if (ff.clear && values[ff.clear] === 1 && (values[ff.q] ?? ff.init ?? 0) !== 0) {
        const changes: Record<NetId, 0 | 1> = { [ff.q]: 0 };
        if (ff.qn) changes[ff.qn] = 1;
        schedule({ t: now, kind: 'flop', priority: 3, changes, label: `async-clear:${ff.id}` });
      } else if (ff.preset && values[ff.preset] === 1 && (values[ff.q] ?? ff.init ?? 0) !== 1) {
        const changes: Record<NetId, 0 | 1> = { [ff.q]: 1 };
        if (ff.qn) changes[ff.qn] = 0;
        schedule({ t: now, kind: 'flop', priority: 3, changes, label: `async-preset:${ff.id}` });
      }
    }
  };

  const sampleFlopsAtClockChange = (
    net: NetId,
    previous: 0 | 1 | undefined,
    value: 0 | 1,
    now: number
  ) => {
    if (previous === undefined) return;
    const isActiveEdge = opts.edge === 'rising'
      ? previous === 0 && value === 1
      : previous === 1 && value === 0;
    if (!isActiveEdge) return;
    events.push({ t: now, label: `active-edge:${opts.edge}:${net}` });
    for (const ff of flops) {
      if (ff.clk !== net) continue;
      events.push({ t: now, label: `sample:${ff.id}:${ff.clk}` });
      queueFlopUpdate(ff, now, values);
    }
  };

  let processed = 0;
  const maxEvents = Math.max(10000, (stimulus.length + Math.ceil(opts.endTime / opts.clockPeriod) * 2 + 1) * 1000);

  while (queue.length > 0) {
    if (++processed > maxEvents) throw new Error('Timed simulation exceeded its event limit; check for zero-delay feedback.');
    const event = queue.shift();
    if (!event) break;

    if (event.kind === 'input' || event.kind === 'clock') {
      const net = event.net;
      const value = event.value;
      if (net === undefined || value === undefined) continue;
      applyChanges({ [net]: value }, event.t);

      if (event.kind === 'clock') {
        if (event.label) events.push({ t: event.t, label: event.label });
        scheduleAsyncControls(event.t);
      } else {
        scheduleAsyncControls(event.t);
      }
    } else if (event.kind === 'gate' && event.net !== undefined && event.value !== undefined) {
      applyChanges({ [event.net]: event.value }, event.t, event.net);
      scheduleAsyncControls(event.t);
    } else if (event.kind === 'flop' && event.changes) {
      applyChanges(event.changes, event.t);
      if (event.label) events.push({ t: event.t, label: event.label });
    }
  }

  for (const net of allNets) {
    if (!transitions.has(net)) transitions.set(net, [{ t: 0, value: values[net] ?? 0 }]);
  }
  const time = Array.from(new Set([
    0,
    opts.endTime,
    ...Array.from(transitions.values()).flatMap((history) => history.map((change) => change.t)),
  ])).sort((a, b) => a - b);
  const signals: Waveform['signals'] = Array.from(allNets).sort().map((net) => {
    const history = transitions.get(net) ?? [];
    let current: 0 | 1 | 'x' = history[0]?.value ?? 0;
    let cursor = 0;
    const signal = net === clockNet
      ? 'clock'
      : netlist.inputs.includes(net)
        ? 'input'
        : flops.some((ff) => ff.q === net || ff.qn === net)
          ? 'state'
          : netlist.outputs.includes(net)
            ? 'output'
            : 'internal';
    return {
      name: net,
      group: signal,
      values: time.map((t) => {
        while (cursor + 1 < history.length && (history[cursor + 1]?.t ?? Infinity) <= t) {
          cursor++;
          current = history[cursor]?.value ?? current;
        }
        return current;
      }),
    };
  });

  return {
    time,
    signals,
    events: events.sort((a, b) => a.t - b.t),
  };
}

/** Returns the state-bus value at time zero and every later state transition. */
export function stateSequence(waveform: Waveform, stateNets: NetId[]): { t: number; state: string }[] {
  if (stateNets.length === 0) return [];
  const signals = stateNets.map((net) => waveform.signals.find((signal) => signal.name === net));
  if (signals.some((signal) => signal === undefined)) {
    throw new Error(`State net not found in waveform: ${stateNets.find((net) => !waveform.signals.some((signal) => signal.name === net))}.`);
  }
  let previous = '';
  const sequence: { t: number; state: string }[] = [];
  waveform.time.forEach((t, index) => {
    const state = signals.map((signal) => signal?.values[index] ?? 'x').join('');
    if (state !== previous) {
      sequence.push({ t, state });
      previous = state;
    }
  });
  return sequence;
}

/** Checks setup and hold windows around active clock edges. */
export function checkSetupHold(
  netlist: Netlist,
  waveform: Waveform,
  limits: { setup: number; hold: number }
): SetupHoldResult {
  if (limits.setup < 0 || limits.hold < 0 || !Number.isFinite(limits.setup) || !Number.isFinite(limits.hold)) {
    throw new Error('Setup and hold limits must be non-negative finite numbers.');
  }
  const violations: SetupHoldResult['violations'] = [];
  for (const ff of netlist.nodes.filter((node): node is FlipFlop => node.kind === 'ff')) {
    const dataNets = ff.type === 'D' && ff.d
      ? [ff.d]
      : ff.type === 'T' && ff.t
        ? [ff.t]
        : ff.type === 'JK'
          ? [ff.j, ff.k].filter((net): net is NetId => net !== undefined)
          : [ff.s, ff.r].filter((net): net is NetId => net !== undefined);
    for (const edge of waveform.events.filter((event) => event.label === `sample:${ff.id}:${ff.clk}`)) {
      for (const net of dataNets) {
        const signal = waveform.signals.find((candidate) => candidate.name === net);
        if (!signal) continue;
        for (let i = 1; i < waveform.time.length; i++) {
          if (signal.values[i] === signal.values[i - 1]) continue;
          const delta = waveform.time[i] - edge.t;
          // Data must be stable for `setup` before the edge and for `hold` after it; changing exactly
          // that long before/after is legal, so the comparisons are strict.
          if (delta <= 0 && -delta < limits.setup) {
            violations.push({ ff: ff.id, t: edge.t, kind: 'setup' });
            break;
          }
          if (delta > 0 && delta < limits.hold) {
            violations.push({ ff: ff.id, t: edge.t, kind: 'hold' });
            break;
          }
        }
      }
    }
  }
  const unique = new Map(violations.map((violation) => [
    `${violation.ff}:${violation.t}:${violation.kind}`,
    violation,
  ]));
  return { violations: Array.from(unique.values()).sort((a, b) => a.t - b.t || a.ff.localeCompare(b.ff)) };
}

/** Finds static-1 hazards in a recognizable two-level SOP implementation. */
export function findHazards(netlist: Netlist): { type: 'static-1' | 'static-0' | 'dynamic'; where: string; fix?: string }[] {
  if (netlist.nodes.some((node) => node.kind === 'ff' || node.kind === 'block')) return [];
  const output = netlist.outputs[0];
  if (!output) return [];
  const byOutput = new Map(netlist.nodes.flatMap((node) => {
    if (node.kind === 'gate') return [[node.output, node] as const];
    return [];
  }));
  const finalGate = byOutput.get(output);
  if (finalGate?.kind !== 'gate' || finalGate.type !== 'OR' || finalGate.inputs.length < 2) return [];

  const literals = new Map<string, { variable: string; polarity: 0 | 1 }>();
  for (const input of netlist.inputs) literals.set(input, { variable: input, polarity: 1 });
  for (const node of netlist.nodes) {
    if (node.kind !== 'gate' || node.type !== 'NOT' || node.inputs.length !== 1) continue;
    const source = literals.get(node.inputs[0] ?? '');
    if (source) literals.set(node.output, { variable: source.variable, polarity: (1 - source.polarity) as 0 | 1 });
  }

  const cubes: { bits: (0 | 1 | '-')[]; covers: Set<number> }[] = [];
  for (const term of finalGate.inputs) {
    const driver = byOutput.get(term);
    const termLiterals = driver?.kind === 'gate' && driver.type === 'AND'
      ? driver.inputs.map((net) => literals.get(net))
      : [literals.get(term)];
    if (termLiterals.some((literal) => literal === undefined)) return [];
    const bits = netlist.inputs.map((input) => {
      const literal = termLiterals.find((entry) => entry?.variable === input);
      return literal ? literal.polarity : '-';
    });
    const covers = new Set<number>();
    for (let minterm = 0; minterm < (1 << netlist.inputs.length); minterm++) {
      const matches = bits.every((bit, index) =>
        bit === '-' || bit === ((minterm >> (netlist.inputs.length - 1 - index)) & 1)
      );
      if (matches) covers.add(minterm);
    }
    cubes.push({ bits, covers });
  }

  const table = truthTableOfNetlist(netlist, netlist.inputs);
  const primes = primeImplicants(table);
  const onSet = new Set(table.rows.filter((row) => row.out === 1).map((row) => row.index));
  const hazards: { type: 'static-1' | 'static-0' | 'dynamic'; where: string; fix?: string }[] = [];
  for (const minterm of onSet) {
    for (let bit = 0; bit < netlist.inputs.length; bit++) {
      const adjacent = minterm ^ (1 << bit);
      if (adjacent <= minterm || !onSet.has(adjacent)) continue;
      if (!primes.some((prime) => prime.covers.includes(minterm) && prime.covers.includes(adjacent))) continue;
      if (cubes.some((cube) => cube.covers.has(minterm) && cube.covers.has(adjacent))) continue;
      const literalsForFix = netlist.inputs.flatMap((name, index) => {
        if (index === netlist.inputs.length - 1 - bit) return [];
        const value = (minterm >> (netlist.inputs.length - 1 - index)) & 1;
        return [`${name}${value === 0 ? "'" : ''}`];
      });
      const fix = literalsForFix.join('');
      hazards.push({
        type: 'static-1',
        where: `${output}: adjacent minterms ${minterm} and ${adjacent}`,
        ...(fix ? { fix } : {}),
      });
    }
  }
  return hazards;
}

/** Emits CSV snapshots at every recorded signal transition. */
export function toCSV(waveform: Waveform): string {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const header = ['time', ...waveform.signals.map((signal) => escape(signal.name))].join(',');
  const rows = waveform.time.map((time, index) => [
    String(time),
    ...waveform.signals.map((signal) => String(signal.values[index] ?? 'x')),
  ].join(','));
  return [header, ...rows].join('\n');
}
