# Phase 4 — Sequential Logic, Clocked Simulator & FSM Synthesis

## Overview
Phase 4 implements sequential logic foundations, flip-flop models, clocked cycle-accurate and event-accurate simulation, standard counter and register libraries, and end-to-end automated Finite State Machine (FSM) synthesis and reverse-engineering.

1. **Flip-Flop Library (`flipflops.ts`):** Complete models for SR, D, JK, and T flip-flops with characteristic tables, excitation tables, characteristic equations, and next-state evaluators (`nextQ`).
2. **Clocked Simulator (`simulate-seq.ts`):** Race-free synchronous simulation with edge detection (`stepClock`), asynchronous active-low/active-high Preset and Clear handling, multi-cycle waveform generation (`runSequence`), and Mealy-machine mid-tick output sampling (`inputChangeOutputs`).
3. **Counters & Registers (`library.ts`):** Gate/FF-level implementations of 2-bit to 4-bit synchronous up/down counters (T and JK flip-flops), Mod-N counters (3..15) with asynchronous reset, ring and Johnson counters, shift registers (SISO, SIPO, PISO, universal 74194 architecture), and lockup / unused state analysis (`analyzeUnusedStates`).
4. **FSM Designer & Circuit Analyzer (`fsm.ts`):**
   - State table validation (`validateStateTable`) checking determinism and completeness.
   - Implication-table state reduction (`reduceStates`) partition algorithms.
   - State assignment (`assignStates`) supporting Minimum-bit Binary, Gray code, and One-hot encodings.
   - Automated synthesis (`designFSM`) using the Phase 2 Quine-McCluskey minimizer to generate minimal flip-flop excitation equations and combinational netlist glue logic.
   - Reverse-engineering (`analyzeCircuit`) extracting state transition graphs and finding lockup states from arbitrary sequential netlists.
5. **Interactive UI (`SequentialPage.tsx`):** Tabbed interface featuring:
   - **Flip-Flops:** Live clock stepping, asynchronous preset/clear toggles, characteristic & excitation tables.
   - **Counters & Shift Registers:** Parameterized generator, live clock control, interactive parallel load, and state transition history.
   - **FSM Designer:** Editable state table, circular SVG state diagram with self-loops and directed arcs, state reduction, encoding selection, and full QM flip-flop synthesis.
   - **Analyze Circuit:** Circuit-to-state diagram extraction and lock-up trap detection.

---

## Public Engine API (`src/engine/sequential/`)

### 1. Flip-Flop Definitions (`flipflops.ts`)
```ts
export type FlipFlopType = 'SR' | 'D' | 'JK' | 'T';

export interface FlipFlopModel {
  type: FlipFlopType;
  inputs: string[];
  characteristicTable: { inputs: Record<string, 0 | 1>; Q_curr: 0 | 1; Q_next: 0 | 1 }[];
  excitationTable: { Q_curr: 0 | 1; Q_next: 0 | 1; inputs: Record<string, 0 | 1 | 'X'> }[];
  equation: string;
}

export function getFlipFlopModel(type: FlipFlopType): FlipFlopModel;
export function nextQ(type: FlipFlopType, inputs: Record<string, 0 | 1>, currentQ: 0 | 1): 0 | 1;
```

### 2. Sequential Simulation (`simulate-seq.ts`)
```ts
export interface SeqNetlist {
  netlist: Netlist;
  flipflops: {
    id: string;
    type: FlipFlopType;
    clkNet: NetId;
    asyncPreNet?: NetId;
    asyncClrNet?: NetId;
    inputs: Record<string, NetId>;
    qNet: NetId;
    qnNet?: NetId;
    trigger?: 'rising' | 'falling';
  }[];
}

export function stepClock(
  circuit: SeqNetlist,
  state: Record<string, 0 | 1>,
  inputs: Record<NetId, 0 | 1>,
  clkEdge: 'rising' | 'falling'
): { nextState: Record<string, 0 | 1>; wireValues: Record<NetId, 0 | 1> };

export function runSequence(
  circuit: SeqNetlist,
  clockCycles: number,
  inputSequence?: Record<NetId, (0 | 1)[]>
): {
  time: number[];
  clock: (0 | 1)[];
  states: Record<string, (0 | 1)[]>;
  wireValues: Record<NetId, (0 | 1)[]>;
  inputChangeOutputs?: Record<NetId, (0 | 1)[]>;
};
```

### 3. Synchronous Counters & Shift Registers (`library.ts`)
```ts
export function syncCounter(bits: 2 | 3 | 4, dir: 'up' | 'down', ffType: 'T' | 'JK'): SeqNetlist;
export function modNCounter(n: number, ffType?: 'T' | 'JK'): SeqNetlist;
export function ringCounter(bits: number): SeqNetlist;
export function johnsonCounter(bits: number): SeqNetlist;
export function shiftRegister(
  bits: number,
  type: 'SISO' | 'SIPO' | 'PISO' | 'universal'
): SeqNetlist;
export function analyzeUnusedStates(circuit: SeqNetlist, validStates: number[]): {
  unusedStates: number[];
  transitions: { from: number; to: number }[];
  selfStarting: boolean;
};
```

### 4. FSM Synthesis & Analysis (`fsm.ts`)
```ts
export function validateStateTable(table: StateTable): { valid: boolean; errors: string[] };
export function stateDiagramData(table: StateTable): {
  nodes: { id: string; label: string; output?: string }[];
  edges: { from: string; to: string; input: string; output?: string }[];
};
export function reduceStates(table: StateTable): {
  reducedTable: StateTable;
  steps: Step[];
  equivalenceClasses: string[][];
};
export function assignStates(
  states: string[],
  method: 'binary' | 'gray' | 'one-hot'
): Record<string, string>;
export function designFSM(
  table: StateTable,
  ffType: FlipFlopType,
  encoding?: 'binary' | 'gray' | 'one-hot'
): FSMDesignResult;
export function analyzeCircuit(circuit: SeqNetlist, inputs: string[]): {
  stateTable: StateTable;
  diagram: ReturnType<typeof stateDiagramData>;
  lockUpStates: string[];
};
```

---

## Verification & Test Results

Executed via `npm test` (`vitest run`):
- **Golden Test 1:** Characteristic & excitation table coverage for all 4 flip-flop types (SR, D, JK, T); invalid SR (1,1) assertion check; `nextQ` matches boolean truth.
- **Golden Test 2:** 3-bit synchronous up-counter using T flip-flops cycles through $000 \to 001 \to \dots \to 111 \to 000$; 3-bit down-counter using JK flip-flops decrements correctly.
- **Golden Test 3:** Mod-6 counter counts $0 \to 1 \to 2 \to 3 \to 4 \to 5 \to 0$; unused states $\{6, 7\}$ transition back to valid count states (self-starting verified).
- **Golden Test 4:** 4-bit SISO shift register propagates input bit-stream across 4 clock edges ($Q_3$ receives $Q_0$ after 4 cycles); 4-bit Johnson counter completes correct length-8 twisted ring sequence ($0000 \to 1000 \to 1100 \dots \to 0000$).
- **Golden Test 5:** FSM synthesis of 1011 sequence detector (overlapping Mealy):
  - Binary encoding: 4 states, 2 flip-flops; synthesizes minimal excitation equations and evaluates input sequence `1,0,1,1,0,1,1` producing output `0,0,0,1,0,0,1`.
  - One-hot encoding: 4 flip-flops, one-hot transition logic synthesized and verified.
- **Golden Test 6:** Implication table state reduction merges equivalent states correctly on classical benchmark tables with step-by-step partition evidence.
- **Golden Test 7:** Round-trip `analyzeCircuit` reconstructs state table and transition graph from synthesized counter / FSM netlist; identifies lock-up traps.
- **Golden Test 8:** Validation error reporting for non-deterministic or incomplete state transition tables.
