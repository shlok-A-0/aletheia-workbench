import {
  bcdTo7Seg,
  fullAdder,
  mux,
  quineMcCluskey,
  truthTableFromMinterms,
  truthTableOfNetlist,
  minResultToNetlist,
  toNandOnly,
  toNorOnly,
  syncCounter,
  modNCounter,
  designFSM,
  analyzeCircuit,
} from '../engine';
import type { Netlist, StateTable, TruthTable } from '../engine/types';
import { useStore, type RootStore } from '../store';

export interface ExampleOption {
  id: string;
  label: string;
  description: string;
}

export const EXAMPLES: ExampleOption[] = [
  { id: 'odd-minterms', label: 'Σm(1,3,5,7)', description: 'Three-variable odd minterms' },
  { id: 'dont-cares', label: 'Four-variable don’t-cares', description: 'QM and K-map with don’t-cares' },
  { id: 'full-adder', label: 'Full adder', description: 'Sum and carry outputs' },
  { id: 'mux', label: '4:1 MUX', description: 'Four data inputs and two select lines' },
  { id: 'bcd', label: 'BCD 7-segment', description: 'A seven-segment decoder example' },
  { id: 'jk-counter', label: '2-bit JK counter', description: 'Synchronous up-counter' },
  { id: 'mod6', label: 'Mod-6 counter', description: 'Self-starting modulo counter' },
  { id: 'detector', label: '1011 sequence detector', description: 'Overlapping Mealy sequence detector' },
  { id: 'traffic', label: 'Traffic-light controller', description: 'Four-state Moore controller' },
  { id: 'hazard', label: 'Static hazard demo', description: 'Unequal gate delays expose a static-1 hazard' },
];

const DETECTOR_1011: StateTable = {
  model: 'mealy',
  inputs: ['X'],
  outputs: ['Z'],
  states: ['S0', 'S1', 'S2', 'S3'],
  reset: 'S0',
  rows: [
    { state: 'S0', input: '0', next: 'S0', output: '0' },
    { state: 'S0', input: '1', next: 'S1', output: '0' },
    { state: 'S1', input: '0', next: 'S2', output: '0' },
    { state: 'S1', input: '1', next: 'S1', output: '0' },
    { state: 'S2', input: '0', next: 'S0', output: '0' },
    { state: 'S2', input: '1', next: 'S3', output: '0' },
    { state: 'S3', input: '0', next: 'S2', output: '0' },
    { state: 'S3', input: '1', next: 'S1', output: '1' },
  ],
};

const TRAFFIC_LIGHT: StateTable = {
  model: 'moore',
  inputs: ['T'],
  outputs: ['NSG', 'NSY', 'EWG', 'EWY'],
  states: ['NS-green', 'NS-yellow', 'EW-green', 'EW-yellow'],
  reset: 'NS-green',
  rows: [
    { state: 'NS-green', input: '0', next: 'NS-yellow', output: '1000' },
    { state: 'NS-green', input: '1', next: 'NS-yellow', output: '1000' },
    { state: 'NS-yellow', input: '0', next: 'EW-green', output: '0100' },
    { state: 'NS-yellow', input: '1', next: 'EW-green', output: '0100' },
    { state: 'EW-green', input: '0', next: 'EW-yellow', output: '0010' },
    { state: 'EW-green', input: '1', next: 'EW-yellow', output: '0010' },
    { state: 'EW-yellow', input: '0', next: 'NS-green', output: '0001' },
    { state: 'EW-yellow', input: '1', next: 'NS-green', output: '0001' },
  ],
};

function hazardNetlist(): Netlist {
  return {
    name: 'static_1_hazard_demo',
    inputs: ['A', 'B', 'C'],
    outputs: ['F'],
    nodes: [
      { kind: 'gate', id: 'not-a', type: 'NOT', inputs: ['A'], output: 'An', delay: 3 },
      { kind: 'gate', id: 'and-ab', type: 'AND', inputs: ['A', 'B'], output: 'AB', delay: 1 },
      { kind: 'gate', id: 'and-anc', type: 'AND', inputs: ['An', 'C'], output: 'AnC', delay: 1 },
      { kind: 'gate', id: 'or-f', type: 'OR', inputs: ['AB', 'AnC'], output: 'F', delay: 5 },
    ],
  };
}

function selectOutputCone(netlist: Netlist, output: string): Netlist {
  const drivers = new Map(netlist.nodes.flatMap((node) =>
    node.kind === 'gate' || node.kind === 'const' ? [[node.output, node] as const] : []
  ));
  const requiredNets = new Set([output]);
  const included = new Set<string>();
  const pending = [output];
  while (pending.length > 0) {
    const net = pending.pop();
    if (!net) continue;
    const driver = drivers.get(net);
    if (!driver || included.has(driver.id)) continue;
    included.add(driver.id);
    if (driver.kind === 'gate') {
      for (const input of driver.inputs) {
        if (!requiredNets.has(input)) {
          requiredNets.add(input);
          pending.push(input);
        }
      }
    }
  }
  return { ...netlist, name: `${netlist.name}_${output}`, outputs: [output], nodes: netlist.nodes.filter((node) => included.has(node.id)) };
}

function clearedState(
  id: string,
  truthTable: TruthTable | null,
  netlist: Netlist | null,
  stateTable: StateTable | null = null,
  inputVars: string[] = truthTable?.vars ?? []
): Partial<RootStore> {
  const minResult = truthTable ? quineMcCluskey(truthTable) : null;
  const synthesized = minResult ? minResultToNetlist(minResult) : null;
  const activeNetlist = netlist ?? synthesized;
  const isSequential = Boolean(activeNetlist?.nodes.some((node) => node.kind === 'ff'));
  const inputLabel = EXAMPLES.find((example) => example.id === id)?.label ?? id;
  return {
    input: { mode: 'table', raw: `Example: ${inputLabel}`, vars: inputVars },
    rawInput: `Example: ${inputLabel}`,
    inputMode: 'table',
    truthTable,
    parsedExpr: null,
    vars: inputVars,
    mintermsStr: truthTable?.rows.filter((row) => row.out === 1).map((row) => row.index).join(', ') ?? '',
    maxtermsStr: truthTable?.rows.filter((row) => row.out === 0).map((row) => row.index).join(', ') ?? '',
    dontCaresStr: truthTable?.rows.filter((row) => row.out === 'x').map((row) => row.index).join(', ') ?? '',
    minResult,
    multiMinResult: null,
    selectedForm: 'SOP',
    isComputing: false,
    netlists: {
      original: netlist,
      simplified: activeNetlist,
      nand: activeNetlist ? toNandOnly(activeNetlist) : null,
      nor: activeNetlist ? toNorOnly(activeNetlist) : null,
    },
    activeVariant: 'simplified',
    stateTable,
    designedNetlist: isSequential ? activeNetlist : null,
    selectedFF: activeNetlist?.nodes.find((node) => node.kind === 'ff')?.type ?? 'D',
    excitationEquations: [],
    outputEquations: [],
    waveform: null,
    stimulus: [],
    costReport: null,
    powerReport: null,
    faultReport: null,
  };
}

function configureCombinational(netlist: Netlist): Partial<RootStore> {
  const table = truthTableOfNetlist(netlist);
  return clearedState(netlist.name, table, netlist);
}

export function loadExample(id: string): string {
  let state: Partial<RootStore>;
  let route = '/input';
  switch (id) {
    case 'odd-minterms':
      state = clearedState(
        id,
        truthTableFromMinterms(['A', 'B', 'C'], [1, 3, 5, 7]),
        null
      );
      break;
    case 'dont-cares': {
      const table = truthTableFromMinterms(['A', 'B', 'C', 'D'], [1, 3, 7, 11, 15], [0, 2, 5]);
      state = clearedState(id, table, null);
      break;
    }
    case 'full-adder':
      state = configureCombinational(fullAdder());
      route = '/circuit';
      break;
    case 'mux':
      state = configureCombinational(mux(2));
      route = '/circuit';
      break;
    case 'bcd': {
      const decoder = bcdTo7Seg();
      const segment = decoder.outputs[0];
      if (!segment) throw new Error('BCD decoder did not provide a segment output.');
      state = configureCombinational(selectOutputCone(decoder, segment));
      route = '/circuit';
      break;
    }
    case 'jk-counter': {
      const netlist = syncCounter(2, 'up', 'JK');
      state = clearedState(id, null, netlist, analyzeCircuit(netlist).stateTable, netlist.inputs);
      route = '/sequential';
      break;
    }
    case 'mod6': {
      const netlist = modNCounter(6);
      state = clearedState(id, null, netlist, analyzeCircuit(netlist).stateTable, netlist.inputs);
      route = '/sequential';
      break;
    }
    case 'detector': {
      const netlist = designFSM(DETECTOR_1011, 'D', 'binary').netlist;
      state = clearedState(id, null, netlist, DETECTOR_1011, netlist.inputs);
      route = '/sequential';
      break;
    }
    case 'traffic': {
      const netlist = designFSM(TRAFFIC_LIGHT, 'D', 'binary').netlist;
      state = clearedState(id, null, netlist, TRAFFIC_LIGHT, netlist.inputs);
      route = '/sequential';
      break;
    }
    case 'hazard':
      state = configureCombinational(hazardNetlist());
      route = '/timing';
      break;
    default:
      throw new Error(`Unknown example: ${id}`);
  }
  useStore.setState(state);
  return route;
}
