import { describe, expect, it } from 'vitest';
import type { Netlist, StateTable } from '../types';
import { syncCounter, designFSM } from '../sequential';
import { checkSetupHold, findHazards, simulateTimed, stateSequence, toCSV } from './index';

const options = {
  clockPeriod: 20,
  duty: 0.5,
  edge: 'rising' as const,
  defaultGateDelay: 1,
  clkToQ: 1,
  endTime: 40,
};

describe('Phase 5 — timed simulation and waveform tools', () => {
  it('generates a periodic clock with the requested high and low durations', () => {
    const waveform = simulateTimed(
      { name: 'clock', inputs: ['CLK'], outputs: [], clock: 'CLK', nodes: [] },
      [],
      options
    );
    const clock = waveform.signals.find((signal) => signal.name === 'CLK');
    expect(clock?.values[waveform.time.indexOf(0)]).toBe(1);
    expect(clock?.values[waveform.time.indexOf(10)]).toBe(0);
    expect(clock?.values[waveform.time.indexOf(20)]).toBe(1);
    expect(waveform.events).toContainEqual({ t: 10, label: 'clock-edge:falling' });
  });

  it('simulates a synchronous counter and labels its state sequence', () => {
    const netlist = syncCounter(2, 'up', 'JK');
    const waveform = simulateTimed(netlist, [], { ...options, endTime: 160 });
    const sequence = stateSequence(waveform, ['Q1', 'Q0']);
    expect(sequence.slice(0, 9).map((item) => item.state)).toEqual([
      '00', '01', '10', '11', '00', '01', '10', '11', '00',
    ]);
    const q0 = waveform.signals.find((signal) => signal.name === 'Q0');
    const q1 = waveform.signals.find((signal) => signal.name === 'Q1');
    const q0Changes = waveform.time.filter((_, index) => index > 0 && q0?.values[index] !== q0?.values[index - 1]);
    const q1Changes = waveform.time.filter((_, index) => index > 0 && q1?.values[index] !== q1?.values[index - 1]);
    expect(q0Changes.slice(0, 4)).toEqual([1, 21, 41, 61]);
    expect(q1Changes.slice(0, 2)).toEqual([21, 61]);
  });

  it('moves state changes to falling edges when selected', () => {
    const netlist = syncCounter(1, 'up', 'T');
    const waveform = simulateTimed(netlist, [], { ...options, edge: 'falling', endTime: 30 });
    const q0 = waveform.signals.find((signal) => signal.name === 'Q0');
    const firstChange = waveform.time.find((_, index) => index > 0 && q0?.values[index] !== q0?.values[index - 1]);
    expect(firstChange).toBe(11);
  });

  it('samples a flip-flop clocked by a derived net edge', () => {
    const netlist: Netlist = {
      name: 'derived-clock',
      inputs: ['CLK'],
      outputs: ['Q1', 'Q0'],
      clock: 'CLK',
      nodes: [
        { kind: 'const', id: 'one', value: 1, output: 'ONE' },
        { kind: 'ff', id: 'ff0', type: 'T', edge: 'rising', clk: 'CLK', t: 'ONE', q: 'Q0', init: 0 },
        { kind: 'ff', id: 'ff1', type: 'T', edge: 'rising', clk: 'Q0', t: 'ONE', q: 'Q1', init: 0 },
      ],
    };
    const waveform = simulateTimed(netlist, [], { ...options, endTime: 50 });
    const q1 = waveform.signals.find((signal) => signal.name === 'Q1');
    expect(waveform.time.filter((_, index) => index > 0 && q1?.values[index] !== q1?.values[index - 1]))
      .toEqual([2, 42]);
  });

  it('applies combinational propagation delay', () => {
    const netlist: Netlist = {
      name: 'delayed-and',
      inputs: ['A', 'B'],
      outputs: ['F'],
      nodes: [{ kind: 'gate', id: 'g1', type: 'AND', inputs: ['A', 'B'], output: 'F', delay: 3 }],
    };
    const waveform = simulateTimed(netlist, [{ t: 10, net: 'A', value: 1 }, { t: 0, net: 'B', value: 1 }], {
      ...options,
      endTime: 20,
    });
    const output = waveform.signals.find((signal) => signal.name === 'F');
    const firstHigh = waveform.time.find((_, index) => output?.values[index] === 1);
    expect(firstHigh).toBe(13);
  });

  it('detects a static-1 hazard and preserves its short output glitch', () => {
    const netlist: Netlist = {
      name: 'hazard-demo',
      inputs: ['A', 'B', 'C'],
      outputs: ['F'],
      nodes: [
        { kind: 'gate', id: 'not-a', type: 'NOT', inputs: ['A'], output: 'An', delay: 3 },
        { kind: 'gate', id: 'ab', type: 'AND', inputs: ['A', 'B'], output: 'AB', delay: 1 },
        { kind: 'gate', id: 'anc', type: 'AND', inputs: ['An', 'C'], output: 'AnC', delay: 1 },
        { kind: 'gate', id: 'sum', type: 'OR', inputs: ['AB', 'AnC'], output: 'F', delay: 5 },
      ],
    };
    expect(findHazards(netlist)).toEqual([
      { type: 'static-1', where: 'F: adjacent minterms 3 and 7', fix: 'BC' },
    ]);

    const waveform = simulateTimed(netlist, [
      { t: 0, net: 'A', value: 1 },
      { t: 0, net: 'B', value: 1 },
      { t: 0, net: 'C', value: 1 },
      { t: 10, net: 'A', value: 0 },
    ], { ...options, endTime: 30 });
    expect(waveform.events.some((event) => event.label === 'glitch:F')).toBe(true);
    const output = waveform.signals.find((signal) => signal.name === 'F');
    expect(output?.values).toContain(0);
    expect(output?.values).toContain(1);
  });

  it('eliminates the static-1 glitch when the consensus term is added', () => {
    const netlist: Netlist = {
      name: 'hazard-free',
      inputs: ['A', 'B', 'C'],
      outputs: ['F'],
      nodes: [
        { kind: 'gate', id: 'not-a', type: 'NOT', inputs: ['A'], output: 'An', delay: 3 },
        { kind: 'gate', id: 'and-ab', type: 'AND', inputs: ['A', 'B'], output: 'AB', delay: 1 },
        { kind: 'gate', id: 'and-anc', type: 'AND', inputs: ['An', 'C'], output: 'AnC', delay: 1 },
        { kind: 'gate', id: 'and-bc', type: 'AND', inputs: ['B', 'C'], output: 'BC', delay: 1 },
        { kind: 'gate', id: 'or-f', type: 'OR', inputs: ['AB', 'AnC', 'BC'], output: 'F', delay: 5 },
      ],
    };
    const waveform = simulateTimed(netlist, [
      { t: 0, net: 'A', value: 1 },
      { t: 0, net: 'B', value: 1 },
      { t: 0, net: 'C', value: 1 },
      { t: 10, net: 'A', value: 0 },
    ], { ...options, endTime: 30 });
    expect(findHazards(netlist)).toEqual([]);
    expect(waveform.events.some((event) => event.label === 'glitch:F')).toBe(false);
    const output = waveform.signals.find((signal) => signal.name === 'F');
    const afterTransition = waveform.time
      .map((time, index) => ({ time, value: output?.values[index] }))
      .filter((point) => point.time >= 10);
    expect(afterTransition.every((point) => point.value === 1)).toBe(true);
  });

  it('checks setup and hold violations against sampled data inputs', () => {
    const netlist: Netlist = {
      name: 'dff',
      inputs: ['CLK', 'D'],
      outputs: ['Q'],
      clock: 'CLK',
      nodes: [{
        kind: 'ff', id: 'ff0', type: 'D', edge: 'rising', clk: 'CLK', d: 'D', q: 'Q', init: 0,
      }],
    };
    const setupViolation = simulateTimed(netlist, [{ t: 19, net: 'D', value: 1 }], {
      ...options,
      endTime: 40,
    });
    expect(checkSetupHold(netlist, setupViolation, { setup: 2, hold: 2 }).violations)
      .toContainEqual({ ff: 'ff0', t: 20, kind: 'setup' });

    const clean = simulateTimed(netlist, [{ t: 15, net: 'D', value: 1 }], { ...options, endTime: 40 });
    expect(checkSetupHold(netlist, clean, { setup: 2, hold: 2 }).violations).toEqual([]);

    const holdViolation = simulateTimed(netlist, [{ t: 21, net: 'D', value: 1 }], { ...options, endTime: 40 });
    expect(checkSetupHold(netlist, holdViolation, { setup: 2, hold: 2 }).violations)
      .toContainEqual({ ff: 'ff0', t: 20, kind: 'hold' });
  });

  it('serializes a CSV column per signal with snapshots at each change time', () => {
    const netlist: Netlist = {
      name: 'buffer',
      inputs: ['A'],
      outputs: ['F'],
      nodes: [{ kind: 'gate', id: 'buf', type: 'BUF', inputs: ['A'], output: 'F' }],
    };
    const waveform = simulateTimed(netlist, [{ t: 4, net: 'A', value: 1 }], { ...options, endTime: 10 });
    const csv = toCSV(waveform);
    expect(csv.split('\n')[0]).toBe('time,"A","CLK","F"');
    expect(csv).toContain('4,1,1,0');
  });

  it('supports synthesis of the sequence-detector timing preset', () => {
    const stateTable: StateTable = {
      model: 'mealy',
      inputs: ['X'],
      outputs: ['Z'],
      states: ['S0', 'S1'],
      reset: 'S0',
      rows: [
        { state: 'S0', input: '0', next: 'S0', output: '0' },
        { state: 'S0', input: '1', next: 'S1', output: '0' },
        { state: 'S1', input: '0', next: 'S0', output: '0' },
        { state: 'S1', input: '1', next: 'S1', output: '1' },
      ],
    };
    const result = designFSM(stateTable);
    expect(result.netlist.nodes.some((node) => node.kind === 'ff')).toBe(true);
    const waveform = simulateTimed(result.netlist, [
      { t: 1, net: 'X', value: 1 },
      { t: 21, net: 'X', value: 0 },
      { t: 41, net: 'X', value: 1 },
      { t: 61, net: 'X', value: 1 },
    ], { ...options, endTime: 100 });
    const output = waveform.signals.find((signal) => signal.name === 'Z');
    const values = [20, 40, 60, 80].map((time) => {
      const index = waveform.time.indexOf(time);
      return output?.values[index];
    });
    expect(values).toEqual([0, 0, 0, 1]);
  });
});
