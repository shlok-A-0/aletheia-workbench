import type { Block, CostReport, FFType, Gate, GateType, Netlist } from '../types';
import defaultLibrary from '../../data/ic-library.json';

export interface ICDefinition {
  part: string;
  family: string;
  description: string;
  pins: number;
  gates: { type: string; inputs: number; count: number }[];
  iccTypicalA: number | null;
  unitPrice: number | null;
  source: string;
}

export type ICLibrary = ICDefinition[];
export const DEFAULT_IC_LIBRARY: ICLibrary = defaultLibrary;

interface Allocation {
  part: ICDefinition;
  used: number;
}

function findGateChip(type: string, inputs: number, library: ICLibrary): ICDefinition | undefined {
  return library
    .filter((ic) => ic.gates.some((gate) => gate.type === type && gate.inputs >= inputs))
    .sort((a, b) => {
      const aSize = Math.min(...a.gates.filter((g) => g.type === type && g.inputs >= inputs).map((g) => g.inputs));
      const bSize = Math.min(...b.gates.filter((g) => g.type === type && g.inputs >= inputs).map((g) => g.inputs));
      return aSize - bSize || a.pins - b.pins || a.part.localeCompare(b.part);
    })[0];
}

function allocate(part: ICDefinition, allocations: Map<string, Allocation>, _notes: string[]): void {
  const allocation = allocations.get(part.part) ?? { part, used: 0 };
  allocation.used++;
  allocations.set(part.part, allocation);
}

function decomposeWideGate(gate: Gate, library: ICLibrary, allocations: Map<string, Allocation>, notes: string[]): void {
  const reductionType = gate.type === 'NAND' ? 'AND' : gate.type === 'NOR' ? 'OR' : gate.type;
  const supported = library.flatMap((ic) =>
    ic.gates.filter((entry) => entry.type === reductionType).map((entry) => ({ ic, fanIn: entry.inputs }))
  ).sort((a, b) => b.fanIn - a.fanIn || a.ic.pins - b.ic.pins);
  const maxFanIn = supported[0]?.fanIn;
  if (!maxFanIn || maxFanIn < 2) {
    throw new Error(`No IC implementation available for ${gate.type}${gate.inputs.length}.`);
  }

  let remainingInputs = gate.inputs.length;
  const decomposition: string[] = [];
  while (remainingInputs > maxFanIn) {
    const available = supported.find((candidate) => candidate.fanIn === maxFanIn)!;
    allocate(available.ic, allocations, notes);
    remainingInputs -= maxFanIn - 1;
    decomposition.push(`${reductionType}${maxFanIn}`);
  }
  const finalType = gate.type === 'NAND' || gate.type === 'NOR' ? gate.type : reductionType;
  const finalPart = findGateChip(finalType, Math.max(2, remainingInputs), library);
  if (!finalPart) throw new Error(`No IC implementation available for ${gate.type}${remainingInputs}.`);
  allocate(finalPart, allocations, notes);
  decomposition.push(`${finalType}${Math.max(2, remainingInputs)}`);
  notes.push(`${gate.id} (${gate.type}${gate.inputs.length}) decomposed as ${decomposition.join(' + ')}.`);
}

function mapBlock(block: Block, library: ICLibrary): ICDefinition | undefined {
  const byType: Record<Block['type'], string[]> = {
    MUX: ['74151', '74153'],
    DEMUX: ['74138', '74139'],
    DECODER: ['74138', '74139'],
    ENCODER: ['74148'],
    PRIORITY_ENCODER: ['74148'],
    HALF_ADDER: ['7483'],
    FULL_ADDER: ['7483'],
    RIPPLE_ADDER: ['7483'],
    COMPARATOR: [],
    BCD_7SEG: ['7447'],
  };
  const preferred = byType[block.type];
  if (block.type === 'MUX') {
    const part = (block.width ?? 0) >= 3 ? '74151' : '74153';
    return library.find((ic) => ic.part === part);
  }
  if (block.type === 'DECODER' || block.type === 'DEMUX') {
    const part = (block.width ?? 0) >= 3 ? '74138' : '74139';
    return library.find((ic) => ic.part === part);
  }
  return preferred.map((part) => library.find((ic) => ic.part === part)).find(Boolean);
}

function mapFlipFlop(type: FFType, library: ICLibrary): ICDefinition | undefined {
  const preferred = type === 'D' ? '7474' : '7476';
  return library.find((ic) => ic.part === preferred);
}

export function mapToICs(
  netlist: Netlist,
  library: ICLibrary = DEFAULT_IC_LIBRARY,
  opts: { preferBlocks?: boolean } = {}
): CostReport {
  const allocations = new Map<string, Allocation>();
  const notes: string[] = [];

  for (const node of netlist.nodes) {
    if (node.kind === 'const') continue;
    if (node.kind === 'block') {
      if (!opts.preferBlocks) {
        throw new Error(`Block ${node.id} (${node.type}) must be expanded before gate-level IC mapping.`);
      }
      const part = mapBlock(node, library);
      if (!part) throw new Error(`No IC mapping available for block ${node.type}.`);
      allocate(part, allocations, notes);
      continue;
    }
    if (node.kind === 'ff') {
      const part = mapFlipFlop(node.type, library);
      if (!part) throw new Error(`No IC mapping available for ${node.type} flip-flops.`);
      allocate(part, allocations, notes);
      if (node.type === 'T' || node.type === 'SR') {
        notes.push(`${node.type} flip-flop ${node.id} is implemented using a JK device with additional gates.`);
        const supportGate = findGateChip('NAND', 2, library);
        if (!supportGate) throw new Error(`No NAND2 IC is available for ${node.type} flip-flop conversion.`);
        allocate(supportGate, allocations, notes);
        allocate(supportGate, allocations, notes);
      }
      continue;
    }

    const gate = node as Gate;
    const type: GateType = gate.type;
    let part = findGateChip(type, gate.inputs.length, library);
    if (!part && gate.type === 'XNOR') {
      const xorChip = findGateChip('XOR', 2, library);
      const invChip = findGateChip('NOT', 1, library);
      if (!xorChip || !invChip) throw new Error('No IC implementation available for XNOR2.');
      for (let i = 1; i < gate.inputs.length; i++) allocate(xorChip, allocations, notes);
      allocate(invChip, allocations, notes);
      notes.push(`${gate.id} (XNOR${gate.inputs.length}) is implemented as an XOR chain followed by an inverter.`);
      continue;
    }
    if (!part && (gate.type === 'XOR' || gate.type === 'XNOR') && gate.inputs.length > 2) {
      const xorChip = findGateChip('XOR', 2, library);
      if (!xorChip) throw new Error('No IC implementation available for XOR2.');
      for (let i = 1; i < gate.inputs.length; i++) allocate(xorChip, allocations, notes);
      if (gate.type === 'XNOR') {
        const inverter = findGateChip('NOT', 1, library);
        if (!inverter) throw new Error('No IC implementation available for XNOR2.');
        allocate(inverter, allocations, notes);
      }
      notes.push(`${gate.id} (${gate.type}${gate.inputs.length}) is implemented as a binary XOR chain${gate.type === 'XNOR' ? ' followed by an inverter' : ''}.`);
      continue;
    }
    if (!part && gate.inputs.length > 1) {
      decomposeWideGate(gate, library, allocations, notes);
      continue;
    }
    if (!part) throw new Error(`No IC implementation available for ${gate.type}${gate.inputs.length}.`);
    allocate(part, allocations, notes);
    const matchedGate = part.gates.find((entry) => entry.type === gate.type && entry.inputs >= gate.inputs.length);
    if (matchedGate && matchedGate.inputs > gate.inputs.length) {
      const tie = ['AND', 'NAND'].includes(gate.type) ? '1' : '0';
      notes.push(`${gate.id}: tie ${matchedGate.inputs - gate.inputs.length} unused input(s) to ${tie}.`);
    }
  }

  let allPricesKnown = true;
  let totalPins = 0;
  const ics = Array.from(allocations.values()).sort((a, b) => a.part.part.localeCompare(b.part.part)).map(({ part, used }) => {
    const capacity = part.gates.reduce((sum, gate) => sum + gate.count, 0);
    const count = Math.ceil(used / capacity);
    const unusedGates = count * capacity - used;
    totalPins += count * part.pins;
    const subtotal = part.unitPrice === null ? null : count * part.unitPrice;
    if (subtotal === null) allPricesKnown = false;
    return { part: part.part, count, unusedGates, unitPrice: part.unitPrice, subtotal };
  });

  return {
    ics,
    totalICs: ics.reduce((sum, entry) => sum + entry.count, 0),
    totalPins,
    totalCost: allPricesKnown ? ics.reduce((sum, entry) => sum + (entry.subtotal ?? 0), 0) : undefined,
    notes,
  };
}
