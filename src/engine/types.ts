/**
 * Aletheia core data contracts.
 */

// ─── Identifiers ────────────────────────────────────────────────────────────

/** A net (wire) identifier in a Netlist. Input nets use the variable name (e.g. "A"); internal nets are "n1", "n2", … */
export type NetId = string;

// ─── Boolean Expressions ─────────────────────────────────────────────────────

/**
 * A Boolean expression AST.
 * Variables are single uppercase letters A–Z.
 */
export type Expr =
  | { t: 'var';  name: string }          // single letter A..Z
  | { t: 'const'; v: 0 | 1 }
  | { t: 'not';  a: Expr }
  | { t: 'and';  args: Expr[] }
  | { t: 'or';   args: Expr[] }
  | { t: 'xor';  args: Expr[] }
  | { t: 'xnor'; args: Expr[] };

// ─── Truth Table ─────────────────────────────────────────────────────────────

/**
 * A truth table for a single-output Boolean function.
 * vars: variable names MSB-first (e.g. ['A','B','C']).
 * Row index i = minterm number.
 * out: 0, 1 or 'x' (don't care).
 */
export interface TruthTable {
  vars: string[];
  rows: { index: number; inputs: (0 | 1)[]; out: 0 | 1 | 'x' }[];
}

// ─── Minimization ────────────────────────────────────────────────────────────

/**
 * A prime implicant over n variables.
 * bits[i] is 0, 1 or '-' (variable eliminated), MSB-first.
 * covers: list of minterm indices this implicant covers.
 */
export interface Implicant {
  bits: (0 | 1 | '-')[];
  covers: number[];
  essential?: boolean;
  /** Bitmask: which outputs (in a multi-output problem) this implicant covers. */
  outputMask?: number;
}

/**
 * A single explanation step, produced by engine functions.
 * The UI and chatbot both consume this; never produce raw HTML here.
 */
export interface Step {
  title: string;
  detail: string;
  data?: unknown;  // structured data for table/diagram rendering
}

/**
 * The result of Boolean minimization (K-map or Quine–McCluskey).
 * note: present when result is near-minimal (greedy fallback was used).
 */
export interface MinResult {
  form: 'SOP' | 'POS';
  implicants: Implicant[];   // chosen cover
  expr: Expr;
  text: string;              // e.g. "A'B + C"
  termCount: number;
  literalCount: number;
  steps: Step[];
  note?: string;             // e.g. "near-minimal (greedy fallback)"
}

/**
 * Result of multi-output minimization.
 * results[i] corresponds to outputs[i].
 * sharedTerms: implicants shared by ≥ 2 outputs (implement as shared AND gates).
 */
export interface MultiMinResult {
  results: MinResult[];
  sharedTerms: Implicant[];
}

// ─── Circuits ────────────────────────────────────────────────────────────────

/** The type of a basic logic gate. */
export type GateType = 'AND' | 'OR' | 'NOT' | 'NAND' | 'NOR' | 'XOR' | 'XNOR' | 'BUF';

/** The type of a flip-flop. */
export type FFType = 'SR' | 'D' | 'JK' | 'T';

/** A logic gate node in a Netlist. */
export interface Gate {
  kind: 'gate';
  id: string;
  type: GateType;
  inputs: NetId[];
  output: NetId;
  delay?: number;
  /** Maximum fan-out annotation (informational, not used for correctness). */
  maxFanout?: number;
}

/** A constant (0 or 1) driver node. */
export interface Const {
  kind: 'const';
  id: string;
  value: 0 | 1;
  output: NetId;
}

/** A clocked flip-flop node. */
export interface FlipFlop {
  kind: 'ff';
  id: string;
  type: FFType;
  edge: 'rising' | 'falling';
  clk: NetId;
  d?: NetId;
  j?: NetId;
  k?: NetId;
  s?: NetId;
  r?: NetId;
  t?: NetId;
  q: NetId;
  qn?: NetId;
  /** Asynchronous preset (active-high). */
  preset?: NetId;
  /** Asynchronous clear (active-high). */
  clear?: NetId;
  init?: 0 | 1;
}

/** Standard MSI block type. */
export type BlockType =
  | 'MUX' | 'DEMUX' | 'DECODER' | 'ENCODER' | 'PRIORITY_ENCODER'
  | 'HALF_ADDER' | 'FULL_ADDER' | 'RIPPLE_ADDER' | 'COMPARATOR' | 'BCD_7SEG';

/** A standard MSI block node. e.g. MUX with 2 select lines → width 2. */
export interface Block {
  kind: 'block';
  id: string;
  type: BlockType;
  width?: number;
  pins: Record<string, NetId | NetId[]>;
  delay?: number;
}

/** Any node in a Netlist. */
export type Node = Gate | Const | FlipFlop | Block;

/**
 * A gate-level netlist.
 * inputs: primary input net IDs.
 * outputs: primary output net IDs.
 * clock: the clock net ID (if sequential).
 */
export interface Netlist {
  name: string;
  inputs: NetId[];
  outputs: NetId[];
  clock?: NetId;
  nodes: Node[];
}

// ─── FSM ─────────────────────────────────────────────────────────────────────

/**
 * A state table for a Moore or Mealy finite state machine.
 * input string may use '-' as wildcard (matches any bit).
 */
export interface StateTable {
  model: 'moore' | 'mealy';
  inputs: string[];
  outputs: string[];
  states: string[];
  reset: string;
  rows: {
    state: string;
    input: string;   // e.g. "0", "1", "10-" with '-' = any
    next: string;
    output: string;  // bit string, e.g. "01"
  }[];
}

// ─── Simulation / Timing ─────────────────────────────────────────────────────

/**
 * A digital waveform produced by the timed simulator.
 * time[i]: tick at which signals[*].values[i] takes effect.
 */
export interface Waveform {
  time: number[];
  signals: {
    name: string;
    values: (0 | 1 | 'x')[];
    group: 'clock' | 'input' | 'state' | 'output' | 'internal';
  }[];
  events: { t: number; label: string }[];
}

/**
 * A stimulus event for the timed simulator.
 */
export interface StimulusEvent {
  t: number;
  net: NetId;
  value: 0 | 1;
}

// ─── Reports ─────────────────────────────────────────────────────────────────

/**
 * Bill-of-materials cost report after IC mapping.
 * totalCost is undefined when any IC has a null unitPrice.
 */
export interface CostReport {
  ics: {
    part: string;
    count: number;
    unusedGates: number;
    unitPrice: number | null;
    subtotal: number | null;
  }[];
  totalICs: number;
  totalPins: number;
  totalCost: number | undefined;
  notes: string[];
}

/** Estimated power consumption report. */
export interface PowerReport {
  staticW: number | undefined;
  dynamicW: number;
  totalW: number | undefined;
  transistors: number;
  perNet: { net: string; alpha: number; capF: number; dynW: number }[];
  assumptions: { vcc: number; freqHz: number; defaultCapF: number };
}

/** Stuck-at fault simulation report. */
export interface FaultReport {
  total: number;
  detected: number;
  undetected: { net: string; stuckAt: 0 | 1 }[];
  coverage: number;
  minimalTestSet: number[][];
  table: { net: string; stuckAt: 0 | 1; detectedBy: number[] }[];
  /** Test vectors in netlist.inputs order, retained so the minimal set is interpretable. */
  testVectors?: (0 | 1)[][];
}

// ─── AI Chatbot Context ───────────────────────────────────────────────────────

/**
 * Design context sent to the AI assistant.
 * buildContext(appState) in the frontend strips large fields before sending.
 * Max serialized size: 2000 characters.
 */
export interface DesignContext {
  page: string;
  function?: {
    vars: string[];
    minterms: number[];
    maxterms: number[];
    dontCares: number[];
    expr?: string;
  };
  minimization?: {
    form: 'SOP' | 'POS';
    text: string;
    termCount: number;
    literalCount: number;
    steps: Step[];  // trimmed to last 5 in buildContext()
  };
  circuit?: {
    name: string;
    gates: number;
    levels: number;
    netlistSummary: string;
  };
  sequential?: {
    ffType?: string;
    stateTable?: StateTable;
    equations?: string[];
    stateSequence?: string[];
  };
  timing?: { events: { t: number; label: string }[] };
  cost?: Partial<CostReport>;
  power?: Partial<PowerReport>;
  faults?: Partial<FaultReport>;
}

// ─── Worker Status ─────────────────────────────────────────────────────────────

/** Status of a heavy background computation running in the engine Web Worker. */
export type WorkerStatus = 'idle' | 'running' | 'done' | 'error';
