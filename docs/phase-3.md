# Phase 3 — Circuits, Simulator, Standard MSI Blocks & Universal Gates

## Overview
Phase 3 implements gate-level digital circuit synthesis, combinational simulation, standard MSI block realization, universal gate transformation (NAND-only and NOR-only), and an interactive SVG schematic viewer.

1. **Netlist Synthesis (`generate.ts`):** Converts AST expressions or `MinResult` into two-level and multi-level `Netlist` structures with balanced tree fan-in decomposition and inverter reuse.
2. **Universal Gate Conversions (`generate.ts`):** Converts arbitrary netlists into strictly NAND-only or strictly NOR-only implementations with algebraic substitution and double-inversion cancellation.
3. **Combinational Simulator (`simulate.ts`):** Evaluates netlists in topological dependency order, identifies combinational loops (`CombinationalLoopError`), extracts full truth tables, and verifies equivalence against golden truth tables.
4. **Standard MSI Blocks (`blocks.ts`):** Gate-level implementations of multiplexers, demultiplexers, decoders, encoders, priority encoders, adders (half, full, ripple carry), magnitude comparators, BCD-to-7-segment decoders, and Shannon expansion MUX synthesis.
5. **Interactive UI (`CircuitPage.tsx`):** Renders layered schematics with standard IEEE gate symbols, orthogonal wiring, interactive logic toggles, live wire value color-coding, verification against truth tables, and bidirectional derivation of truth tables into global state.

---

## Public Engine API (`src/engine/circuit/`)

### 1. Generation & Universal Gates (`generate.ts`)
```ts
export function exprToNetlist(
  expr: Expr,
  opts?: { name?: string; maxFanin?: number; share?: boolean; vars?: string[] }
): Netlist;
export function minResultToNetlist(r: MinResult): Netlist;
export function toNandOnly(netlist: Netlist, steps?: Step[]): Netlist;
export function toNorOnly(netlist: Netlist, steps?: Step[]): Netlist;
export class CombinationalLoopError extends Error { cycle: string[]; }
```

### 2. Simulation & Verification (`simulate.ts`)
```ts
export function evaluate(
  netlist: Netlist,
  inputs: Record<NetId, 0 | 1>
): Record<NetId, 0 | 1>;
export function truthTableOfNetlist(netlist: Netlist, targetVars?: string[]): TruthTable;
export function verify(
  netlist: Netlist,
  targetTT: TruthTable
): { ok: boolean; mismatches: number[] };
```

### 3. MSI Blocks Library (`blocks.ts`)
```ts
export function mux(selectBits: 1 | 2 | 3): Netlist;
export function demux(selectBits: 1 | 2 | 3): Netlist;
export function decoder(n: number): Netlist;
export function encoder(n: number): Netlist;
export function priorityEncoder(n?: number): Netlist;
export function halfAdder(): Netlist;
export function fullAdder(): Netlist;
export function rippleAdder(bits?: number): Netlist;
export function comparator(bits?: number): Netlist;
export function bcdTo7Seg(): Netlist;
export function functionWithMux(
  tt: TruthTable,
  selectVars: string[]
): { netlist: Netlist; steps: Step[] };
```

---

## Verification & Test Results

Executed via `npm test` (`vitest run`):
- **Golden Test 1:** `exprToNetlist(parse("A'B + C"))` verifies against its truth table; passes across 30 random expressions ($n=3$ and $n=4$).
- **Golden Test 2:** `toNandOnly` and `toNorOnly` verify against golden truth tables for 30 random expressions and contain strictly NAND / NOR gates.
- **Golden Test 3:** `mux(2)` selects correct inputs across all 64 combinations; `demux(2)` routes data to addressed outputs; `decoder(3)` provides one-hot decoded outputs when enabled and all-zero when disabled.
- **Golden Test 4:** `priorityEncoder(4)`: input `0110` produces output `10` with `V=1`; all-zeros produces `V=0`.
- **Golden Test 5:** `fullAdder()` computes $S = A \oplus B \oplus Cin$ and $Cout = AB + Cin(A \oplus B)$ for all 8 inputs; `rippleAdder(4)` correctly adds all 256 input pairs with carry-out.
- **Golden Test 6:** `comparator(4)`: across all 256 input pairs, exactly one of $GT, EQ, LT$ is 1 and matches $A > B$, $A = B$, or $A < B$.
- **Golden Test 7:** `bcdTo7Seg()`: digit 8 activates all segments $a$–$g$; digit 1 activates only $b, c$; digit 0 activates $a$–$f$ without $g$.
- **Golden Test 8:** `functionWithMux` on $\Sigma m(1,2,4,7)$ with $A,B$ select lines synthesizes a multiplexer circuit that verifies against the golden truth table.
- **Golden Test 9:** Combinational feedback loops detect cycles and throw `CombinationalLoopError`.
- **MSI Blocks:** `halfAdder()` and 4-to-2 `encoder(2)` unit tests pass.
- **MinResult Netlist:** `minResultToNetlist` reproduces the exact truth table of the minimal SOP.
