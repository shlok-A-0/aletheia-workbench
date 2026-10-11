# LDAM Project — Master Build Prompt for Antigravity

**Project:** Digital Logic Circuit Analyzer, Optimizer & Fault Detection System, with sequential design, IC-level cost and power estimation, timing diagrams and an AI study assistant.

## How to use this file

1. Create the project folder. Put `ldam-project-rules.md` in `.agent/rules/` so it applies to every task.
2. Put this file in the project root as `LDAM_BUILD_PROMPT.md`, so the agent can re-read it.
3. Open a **new conversation for each phase**. Paste **Part A (Master Context)** plus **that phase's block** (the part under "PASTE THIS"). Do not paste the whole file at once.
4. Ask the agent to plan first. Read the plan, correct it, then approve.
5. After each phase: run `npm test` yourself, try the demo, commit, and only then start the next phase.
6. One person does Phase 0 first. After that, phases can be split among members on separate git branches (see the table at the end).

Quota tip: large multi-file work and long test/browser runs use the most quota. Keep each phase to its own slice and do not ask the agent to "build everything".

---

# PART A — MASTER CONTEXT (paste at the start of every phase)

You are building a web application for an LDAM (Logic Design and Applications) university course project. It is an interactive digital-logic design assistant. Read `.agent/rules/ldam-project-rules.md` first; those rules always apply.

## A1. What the finished product does

A student can:
1. Enter a Boolean function as an expression, a list of minterms, a list of maxterms, or a truth table.
2. See the full truth table, SOP and POS forms.
3. See a K-map (2, 3 or 4 variables) with groups highlighted, and the simplified SOP/POS.
4. Run Quine–McCluskey for up to 8 variables, with a step-by-step table and prime-implicant chart.
5. See a gate-level circuit drawn from the simplified expression, toggle inputs, and watch signals propagate.
6. Convert to a NAND-only or NOR-only circuit.
7. Build circuits from standard blocks: MUX, DEMUX, decoder, encoder, half/full adder, 4-bit adder, comparator.
8. Design sequential circuits: SR/D/JK/T flip-flops, counters, shift registers, and finite state machines (Moore and Mealy) from a state table, including state diagram, state reduction, state assignment and excitation tables.
9. Analyze an existing sequential circuit to get its state table and state diagram.
10. Step a clock and see a timing diagram (clock pulses, inputs, flip-flop outputs, state sequence, propagation delay, hazards).
11. Map any circuit onto real 74-series ICs and see IC count, pin count and estimated bill-of-materials cost.
12. See estimated static and dynamic power and transistor count.
13. Compare original, simplified, NAND-only and NOR-only versions on gates, ICs, cost and power.
14. Run stuck-at-0 / stuck-at-1 fault simulation and see which faults are detected.
15. Ask an AI assistant questions; it sees the current design and explains it.
16. See everything on one dashboard.

## A2. Core data contracts (put these in `src/engine/types.ts` in Phase 0; all later phases use them)

```ts
export type NetId = string;

// ---- Boolean expressions ----
export type Expr =
  | { t: 'var'; name: string }                 // single letter A..Z
  | { t: 'const'; v: 0 | 1 }
  | { t: 'not'; a: Expr }
  | { t: 'and'; args: Expr[] }
  | { t: 'or'; args: Expr[] }
  | { t: 'xor'; args: Expr[] }
  | { t: 'xnor'; args: Expr[] };

// ---- Truth table ----
// Variables listed MSB first. Row index i = minterm number. out: 0, 1 or 'x' (don't care).
export interface TruthTable { vars: string[]; rows: { index: number; inputs: (0|1)[]; out: 0|1|'x' }[] }

// ---- Minimization ----
// An implicant over n variables: bits[i] is 0, 1 or '-' (variable eliminated), MSB first.
export interface Implicant { bits: (0|1|'-')[]; covers: number[]; essential?: boolean }
export interface Step { title: string; detail: string; data?: unknown }   // explanation step, rendered by UI and chatbot
export interface MinResult {
  form: 'SOP' | 'POS';
  implicants: Implicant[];       // chosen cover
  expr: Expr;
  text: string;                  // e.g. "A'B + C"
  termCount: number;
  literalCount: number;
  steps: Step[];
}

// ---- Circuits ----
export type GateType = 'AND'|'OR'|'NOT'|'NAND'|'NOR'|'XOR'|'XNOR'|'BUF';
export type FFType = 'SR'|'D'|'JK'|'T';
export interface Gate  { kind:'gate'; id:string; type:GateType; inputs:NetId[]; output:NetId; delay?:number }
export interface Const { kind:'const'; id:string; value:0|1; output:NetId }
export interface FlipFlop {
  kind:'ff'; id:string; type:FFType; edge:'rising'|'falling';
  clk:NetId; d?:NetId; j?:NetId; k?:NetId; s?:NetId; r?:NetId; t?:NetId;
  q:NetId; qn?:NetId; preset?:NetId; clear?:NetId;   // preset/clear are asynchronous, active-high
  init?:0|1;
}
export type BlockType = 'MUX'|'DEMUX'|'DECODER'|'ENCODER'|'PRIORITY_ENCODER'|'HALF_ADDER'|'FULL_ADDER'|'RIPPLE_ADDER'|'COMPARATOR'|'BCD_7SEG';
export interface Block { kind:'block'; id:string; type:BlockType; width?:number;  // e.g. MUX with 2 select lines → width 2
                         pins:Record<string, NetId | NetId[]>; delay?:number }
export type Node = Gate | Const | FlipFlop | Block;
export interface Netlist { name:string; inputs:NetId[]; outputs:NetId[]; clock?:NetId; nodes:Node[] }

// ---- FSM ----
export interface StateTable {
  model: 'moore'|'mealy';
  inputs: string[]; outputs: string[]; states: string[]; reset: string;
  rows: { state:string; input:string /* e.g. "0","1" or "10-" with '-' = any */; next:string; output:string /* bits */ }[];
}

// ---- Simulation / timing ----
export interface Waveform { time:number[]; signals: { name:string; values:(0|1|'x')[]; group:'clock'|'input'|'state'|'output'|'internal' }[]; events: { t:number; label:string }[] }

// ---- Reports ----
export interface CostReport  { ics:{part:string; count:number; unusedGates:number; unitPrice:number; subtotal:number}[]; totalICs:number; totalPins:number; totalCost:number; notes:string[] }
export interface PowerReport { staticW:number; dynamicW:number; totalW:number; transistors:number; perNet:{net:string; alpha:number; capF:number; dynW:number}[]; assumptions:{vcc:number; freqHz:number; defaultCapF:number} }
export interface FaultReport { total:number; detected:number; undetected:{net:string; stuckAt:0|1}[]; coverage:number; minimalTestSet:number[][]; table:{net:string; stuckAt:0|1; detectedBy:number[]}[] }
```

You may add fields, but do not rename or remove these, and do not create competing types.

## A3. Conventions every phase must follow
- Variables are single uppercase letters (A–Z). Order given by the user, MSB first.
- Expression syntax accepted by the parser: `'` postfix NOT, `!` or `~` prefix NOT, `+` or `|` for OR, `.` `*` `&` or juxtaposition (`AB`) for AND, `^` for XOR, `~^` or `XNOR` text for XNOR, parentheses, constants `0` `1`. Precedence: NOT > AND > XOR > OR. Give clear error messages with the position of the problem.
- Limits: Boolean engine and Quine–McCluskey up to 8 variables; K-map UI 2–4 variables; brute-force fault test up to 8 inputs.
- Net naming: input nets use the variable name; internal nets are `n1, n2, …`; flip-flop outputs `Q0, Q1, …` (and `Q0n` for the complement).
- Time in the simulator is integer "ticks". Default gate delay = 1 tick, flip-flop clk-to-Q = 1 tick, one clock period = 20 ticks, 50% duty. All configurable.
- Every explanation the tool shows is produced from `Step[]` data by the engine, never typed by an LLM.

## A4. Teaching tone for UI text
Short, plain English. Use the textbook name for each concept (minterm, prime implicant, essential prime implicant, excitation table, etc.) and a one-line tooltip definition for each.

---

# PHASE 0 — Project scaffold and contracts

**Goal:** an empty but correct skeleton that every later phase builds on.

## PASTE THIS

Set up the project.

1. Create a Vite + React + TypeScript (strict) app. Add Vitest, ESLint, Prettier. Scripts: `dev`, `build`, `test`, `lint`.
2. Create this structure:
```
src/
  engine/
    types.ts            // exactly the contracts in A2
    boolean/            // phase 1
    minimize/           // phase 2
    circuit/            // phase 3
    sequential/         // phase 4
    timing/             // phase 5
    analysis/           // phase 6 (ic, cost, power, optimize, fault)
    index.ts            // re-exports
  ui/
    components/  pages/  hooks/
  data/
    ic-library.json     // phase 6
  App.tsx  main.tsx
server/                 // phase 7: Express chatbot proxy
docs/
.agent/rules/ldam-project-rules.md
```
3. Write `types.ts` from section A2, with a doc comment on every type.
4. Add a minimal app shell: top bar with the project name, a left navigation with these empty pages: Input, Truth Table, K-Map / QM, Circuit, Sequential, Timing, Cost & Power, Faults, Dashboard. Each page just shows its name for now. Add a collapsible chat panel placeholder on the right.
5. Add one trivial engine test to prove Vitest runs.
6. Add `docs/ARCHITECTURE.md` summarizing the data flow: Input → TruthTable → MinResult → Netlist → Waveform / CostReport / PowerReport / FaultReport → Dashboard.

**Acceptance:** `npm run dev` shows the shell; `npm run build`, `npm test`, `npm run lint` all pass. Do not implement any engine logic in this phase.

---

# PHASE 1 — Boolean engine and truth tables (Member 1)

**LDAM concepts:** Boolean algebra, Boolean functions, truth tables, SOP/POS, minterms, maxterms.

## PASTE THIS

Implement `src/engine/boolean/`.

**Functions (exported):**
- `parseExpr(text: string): Expr` — per syntax in A3. Throws `ParseError` with `position` and a readable message.
- `exprToString(e: Expr): string` — canonical text, minimal parentheses, NOT shown as postfix `'`.
- `collectVars(e: Expr): string[]` — sorted alphabetically unless an explicit order is given.
- `evalExpr(e: Expr, assignment: Record<string, 0|1>): 0|1`.
- `truthTableFromExpr(e: Expr, vars?: string[]): TruthTable`.
- `truthTableFromMinterms(vars: string[], minterms: number[], dontCares?: number[]): TruthTable`.
- `truthTableFromMaxterms(vars: string[], maxterms: number[], dontCares?: number[]): TruthTable`.
- `truthTableFromOutputs(vars: string[], outputs: (0|1|'x')[]): TruthTable` (for the "enter a truth table" mode).
- `mintermsOf(tt)`, `maxtermsOf(tt)`, `dontCaresOf(tt)`.
- `canonicalSOP(tt): { expr: Expr; text: string; steps: Step[] }` (sum of minterms, e.g. `A'B'C + ...`) and `canonicalPOS(tt)` (product of maxterms).
- `isEquivalent(a: Expr, b: Expr, vars?: string[]): boolean` — by truth table; needed by all later phases.
- `simplifyAlgebraic(e: Expr): { expr: Expr; steps: Step[] }` — apply named Boolean laws (identity, null, idempotent, complement, absorption, De Morgan, distributive, consensus) one at a time, recording each law in `steps`. It does not need to find the minimum; it must be correct and explainable. Cap iterations to avoid loops.

**Input page (UI):** four tabs — Expression, Minterms, Maxterms, Truth Table (clickable output cells cycling 0 → 1 → x). Show parse errors inline. Output goes to a shared app state used by later pages.

**Truth Table page (UI):** table with minterm index, inputs, output; badges for minterms/maxterms/don't-cares; canonical SOP and POS shown with copy buttons.

**Golden tests (must pass):**
1. `parseExpr("A'B + C")` evaluates correctly for all 8 inputs; `exprToString` round-trips (parse → string → parse gives an equivalent Expr).
2. `truthTableFromMinterms(['A','B','C'],[1,3,5,7])` has outputs `[0,1,0,1,0,1,0,1]`; its maxterms are `[0,2,4,6]`.
3. `canonicalPOS` of that table is `(A+B+C)(A+B'+C)(A'+B+C)(A'+B'+C)`.
4. XOR: `A^B` has minterms `[1,2]`; XNOR has `[0,3]`.
5. De Morgan: `isEquivalent(parseExpr("(AB)'"), parseExpr("A'+B'"))` is true; `isEquivalent(parseExpr("A+B"), parseExpr("AB"))` is false.
6. Errors: `"A+"`, `"(A+B"`, `"A$B"` each throw `ParseError` with a sensible position.
7. Property test: for 50 random expressions over 4 variables, `truthTableFromExpr(parseExpr(exprToString(e)))` equals `truthTableFromExpr(e)`.
8. Don't-cares: `truthTableFromMinterms(['A','B','C','D'],[1,3,7,11,15],[0,2,5])` has don't-care rows exactly at 0, 2, 5.

**Acceptance:** the Input and Truth Table pages work end to end. Write `docs/phase-1.md`.

---

# PHASE 2 — K-map and Quine–McCluskey (Members 1 and 2)

**LDAM concepts:** K-maps, grouping, SOP/POS simplification, don't-cares, tabular minimization, prime implicants, Petrick's method.

## PASTE THIS

Implement `src/engine/minimize/` and the K-Map / QM page.

**Quine–McCluskey (`qm.ts`):**
- `quineMcCluskey(tt: TruthTable, form: 'SOP'|'POS' = 'SOP'): MinResult`.
- Steps: group minterms (plus don't-cares) by number of ones; combine pairs differing in one bit, repeat until no more combine; collect prime implicants; build the prime-implicant chart over the CARE minterms only; take essential prime implicants; cover the rest using row/column dominance and then Petrick's method to find the minimum (fewest terms, then fewest literals).
- Record each combining column, the PI chart and each decision in `steps` (with structured `data` so the UI can draw tables).
- POS: minimize the complement function (maxterms with don't-cares), then apply De Morgan to get the product-of-sums.
- Also export `primeImplicants(tt): Implicant[]` and `allMinimalCovers(tt): MinResult[]` (every minimal solution, capped at 20).

**K-map (`kmap.ts`):**
- `buildKMap(tt: TruthTable): KMap` for 2, 3, 4 variables. Rows and columns in Gray code (00,01,11,10); each cell stores minterm index and value (0/1/x).
- `kmapGroups(tt, form): { groups: {cells:number[]; implicant: Implicant; essential:boolean}[] }` — all prime groups (rectangles of size 1,2,4,8,16, wrapping around edges) and the chosen minimal cover. It must agree in cost with `quineMcCluskey`.
- `kmapSimplify(tt, form): MinResult` built from the chosen groups, with `steps` that say, for each group, which variables are eliminated and why.

**UI:** K-Map page draws the map with Gray-code headers, colored group outlines (wrap-around groups drawn as split outlines at both edges), a selector for SOP/POS, a list of chosen groups with the term each produces, and the final expression. A second tab shows the QM tables and PI chart. A banner says "K-map and QM agree" or flags a mismatch. For more than 4 variables show QM only.

**Golden tests (must pass):**
1. Σm(1,3,5,7) over A,B,C → SOP `C`, 1 term, 1 literal.
2. Σm(1,3,7,11,15) + d(0,2,5) over A,B,C,D → 2 terms, 4 literals. (Valid answers include `CD + A'D` and `A'B' + CD`; test by equivalence on care terms and cost, not by text.)
3. Σm(0,1,2,5,6,7,8,9,10,14) over A,B,C,D → 3 terms, 7 literals (for example `CD' + B'C' + A'BD`; other minimal covers may exist).
4. Σm(4,8,10,11,12,15) + d(9,14) over A,B,C,D → 3 terms, 7 literals (for example `AB' + AC + BC'D'`).
5. All-zeros function → `0`; all-ones function → `1`; a single minterm → that minterm.
6. A 5-variable function, Σm(0,1,2,5,6,7,8,9,10,14,16,21,31): the result must cover every minterm, cover no zero, and have 6 terms and 23 literals.
7. For n ≤ 4, brute force: for 200 random functions (with and without don't-cares) the QM cost equals the true minimum cost found by exhaustive search over all prime-implicant subsets, and the K-map cost equals the QM cost.
8. Wrap-around: the K-map group for F = B'D' (minterms 0,2,8,10) is found as one 4-cell group spanning all four corners.
9. POS of Σm(0,1,2,5,6,7,8,9,10,14): equivalent to the SOP result when compared by truth table.

**Acceptance:** the page works for 2–4 variables (K-map + QM) and 5–8 variables (QM only). Write `docs/phase-2.md`.

---

# PHASE 3 — Circuits, simulator, standard blocks, NAND/NOR (Member 3)

**LDAM concepts:** logic gates, universal gates, combinational logic, MUX/DEMUX, decoders, encoders, adders, circuit verification.

## PASTE THIS

Implement `src/engine/circuit/` and the Circuit page.

**Generation (`generate.ts`):**
- `exprToNetlist(expr: Expr, opts?: { name?: string; maxFanin?: number; share?: boolean }): Netlist` — builds a two-level (AND-OR for SOP, OR-AND for POS) netlist; reuse inverters for repeated complemented inputs; limit fan-in with balanced trees when `maxFanin` is set; share identical sub-terms when `share` is true.
- `minResultToNetlist(r: MinResult): Netlist`.
- `toNandOnly(n: Netlist): Netlist` and `toNorOnly(n: Netlist): Netlist` — convert every gate using standard rules (NOT = NAND with tied inputs; AND = NAND + NAND-inverter; OR = NAND of inverted inputs, etc.), then remove double inversions. Provide `steps` explaining each substitution.

**Simulation (`simulate.ts`) — combinational:**
- `evaluate(n: Netlist, inputs: Record<NetId,0|1>): Record<NetId,0|1>` — topological order; throw `CombinationalLoopError` if a loop exists (flip-flop outputs break loops).
- `truthTableOfNetlist(n: Netlist): TruthTable`.
- `verify(n: Netlist, tt: TruthTable): { ok:boolean; mismatches:number[] }` — don't-care rows are ignored.

**Standard blocks (`blocks.ts`):** each returns a Netlist built from gates (so it can be simulated, costed and fault-tested), and also has a Block form for drawing:
- `mux(selectBits: 1|2|3)`, `demux(selectBits)`, `decoder(n)` with enable, `encoder(n)`, `priorityEncoder(n)`.
- `halfAdder()`, `fullAdder()`, `rippleAdder(bits)`, `comparator(bits)`.
- `bcdTo7Seg()` — outputs a–g for BCD inputs 0–9; inputs 10–15 are don't-cares and are used when minimizing each segment (via Phase 2).
- `functionWithMux(tt: TruthTable, selectVars: string[]): Netlist` — realize any function with a MUX whose data inputs are 0, 1, a variable or its complement (Shannon expansion). Include `steps`.

**UI — Circuit page:**
- Draws the netlist as SVG with standard gate symbols (distinctive shapes for AND, OR, NOT, NAND, NOR, XOR, XNOR; bubble for inversion), left-to-right layered layout, orthogonal wires, net labels. Layout algorithm: assign each node a layer = longest path from inputs; order within layers to reduce crossings (a simple barycenter heuristic is enough).
- Input switches for each input; wires and gate outputs are colored by their logic value; a table shows the current output.
- Buttons: "Original", "Simplified", "NAND-only", "NOR-only". A "Verify against truth table" button runs `verify` and shows pass or the mismatching rows.
- A "Blocks" tab: pick a block, set its size, simulate it.

**Golden tests (must pass):**
1. `exprToNetlist(parse("A'B + C"))` verifies against its truth table; the same for 30 random expressions with n = 3 and 4.
2. For 30 random expressions, `toNandOnly` and `toNorOnly` verify against the same truth table, and contain ONLY NAND (or only NOR) gates.
3. `mux(2)` selects the correct data input for all 64 input combinations. `demux(2)` routes data to exactly the addressed output. `decoder(3)` is one-hot for each input code, and all-zero when disabled.
4. `priorityEncoder(4)`: with inputs D3..D0 = `0110` the output is `10` (highest set input is D2 → binary 10) and "valid" = 1; with all zeros "valid" = 0.
5. `fullAdder()` computes `S = A ⊕ B ⊕ Cin` and `Cout = AB + Cin(A ⊕ B)` for all 8 inputs; `rippleAdder(4)` adds all 256 input pairs correctly with carry out.
6. `comparator(4)`: for all 256 pairs, exactly one of A>B, A=B, A<B is 1 and it is the right one.
7. `bcdTo7Seg()`: digit 8 lights all of a–g; digit 1 lights only b and c; digit 0 lights a–f but not g.
8. `functionWithMux` on Σm(1,2,4,7) (A,B,C) with A,B as selects yields a netlist that verifies.
9. A netlist with a combinational loop throws `CombinationalLoopError`.

**Acceptance:** the Circuit page works for any expression from the Input page, including NAND/NOR conversion and block simulation. Write `docs/phase-3.md`.

---

# PHASE 4 — Sequential logic: flip-flops, counters, FSMs (Members 1, 2, 3)

**LDAM concepts:** latches, flip-flops, characteristic and excitation tables, counters, registers, state tables and diagrams, state reduction, state assignment, Moore/Mealy machines, sequential circuit analysis.

## PASTE THIS

Implement `src/engine/sequential/` and the Sequential page.

**Flip-flop models (`flipflops.ts`):**
- `characteristicTable(type: FFType)` and `excitationTable(type: FFType)` as data (rows) with `characteristicEquation(type)` as text: SR: `Q+ = S + R'Q` (with S·R = 0); D: `Q+ = D`; JK: `Q+ = JQ' + K'Q`; T: `Q+ = T ⊕ Q`. Excitation table gives the required inputs for each transition Q→Q+ (use don't-cares, e.g. JK 0→1: J=1, K=x).
- `nextQ(type, q, inputs): 0|1` used by the simulator. SR with S=R=1 returns `'x'` and raises a visible warning.

**Clocked simulator (`simulate-seq.ts`):**
- `stepClock(n: Netlist, state: Record<NetId,0|1>, inputs: Record<NetId,0|1>): { state; nets }` — on each active edge, sample all flip-flop inputs from the values BEFORE the edge and update every flip-flop simultaneously (no race inside one edge). Asynchronous preset/clear act immediately.
- `runSequence(n, inputSequence: Record<NetId,0|1>[], opts): { states; outputs; nets: Record<NetId,0|1>[] }` — also counts 0→1 and 1→0 transitions per net (used for power in Phase 6).

**Standard circuits (`library.ts`), each returning a Netlist:**
- Counters: synchronous binary up and up/down (n = 2..4), mod-N (N = 3..15) with return-to-zero logic, asynchronous ripple up/down, ring counter, Johnson counter.
- Registers: SISO, SIPO, PISO, universal shift register with mode select.
- For unused states of a mod-N counter, `analyzeUnusedStates` lists them and states whether the counter self-starts.

**FSM design (`fsm.ts`):**
- `validateStateTable(st: StateTable): string[]` — completeness (every state × input combination defined or covered by `-`), determinism, undefined next states.
- `stateDiagramData(st): { nodes; edges }` — edges labeled `input/output` (Mealy) or `input` with the output inside the node (Moore).
- `reduceStates(st): { reduced: StateTable; classes: string[][]; steps: Step[]; implicationTable: ... }` — implication-table method: mark distinguishable pairs by outputs, then propagate through next-state pairs; merge equivalent classes. Include the intermediate tables in `steps`.
- `assignStates(st, strategy: 'binary'|'gray'|'one-hot'): { codes: Record<string,string>; flops:number }`.
- `designFSM(st, ffType: FFType, strategy): { netlist: Netlist; nextStateEquations; flipFlopInputEquations; outputEquations; transitionTable; steps: Step[] }` — builds the state/excitation table, uses Phase 2 (`quineMcCluskey`) with unused codes as don't-cares to minimize every flip-flop input and output, then calls Phase 3 `exprToNetlist` and adds the flip-flops.
- `analyzeCircuit(n: Netlist): { flipFlopInputEquations; nextStateEquations; outputEquations; stateTable: StateTable; unusedStates:string[]; lockUp:boolean; steps: Step[] }` — the REVERSE of design: from a sequential circuit, extract equations, apply characteristic equations, enumerate the state table, and detect unreachable states and lock-up.

**UI — Sequential page (tabs):**
1. **Flip-flops:** pick SR/D/JK/T; show characteristic table, excitation table and equation; a small live simulator with a "clock" button and input toggles.
2. **Counters & registers:** pick a circuit, show the netlist (reuse Phase 3 drawing, extended with flip-flop symbols and a clock triangle), step the clock, show current state in binary and decimal.
3. **FSM designer:** an editable state table (add/remove states and rows), live validation, "Draw state diagram" (SVG, circular layout, curved labeled arrows, self-loops), "Reduce states" (show implication table and merged result), choose state assignment and flip-flop type, "Design" shows excitation table, the minimized equations and the circuit.
4. **Analyze circuit:** choose a circuit from the library (or the one just designed) and show the derived equations, state table and state diagram.

**Golden tests (must pass):**
1. JK characteristic: for all 16 (J,K,Q) combos matches `JQ' + K'Q`. T and D likewise. SR (1,1) returns `'x'`.
2. JK excitation: 0→0 needs J=0,K=x; 0→1 J=1,K=x; 1→0 J=x,K=1; 1→1 J=x,K=0.
3. 2-bit synchronous up-counter with JK flip-flops: `designFSM` gives J0=K0=1 and J1=K1=Q0; running 8 clocks from 00 gives 00,01,10,11,00,01,10,11.
4. 3-bit synchronous up-counter with T flip-flops: T0=1, T1=Q0, T2=Q1Q0; counts 0–7 then wraps.
5. Mod-6 counter (0–5) built with D flip-flops: after state 5 the next state is 0; unused states 6 and 7 are listed; `analyzeUnusedStates` reports whether it self-starts (states 6 and 7 must go to a valid state — check and report; whichever the result is, `analyzeCircuit` must agree with `analyzeUnusedStates`).
6. Simultaneous update (no race within one clock edge): a 2-bit shift register with D1 = Q0 and D0 = serial-in, starting at Q1Q0 = 01 with serial-in held at 0, goes 01 → 10 → 00. (If flip-flops were updated one after another it would wrongly reach 00 after one clock.) A 3-bit serial-in/parallel-out register fed 1,1,0 ends at Q2Q1Q0 = 110 (the first bit shifted in ends up deepest, in Q2).
7. Johnson counter (3-bit) cycles through 6 states: 000,100,110,111,011,001 (shift direction as designed; assert the cycle length 6 and that each state differs from the previous by exactly one bit).
8. Sequence detector for `1011`, Mealy, overlapping: on input stream `1,0,1,1,0,1,1` the output stream is `0,0,0,1,0,0,1`. The designed circuit, simulated, gives the same stream. Using binary and one-hot assignment both pass.
9. State reduction: a state table containing two states with identical outputs and identical next-state behavior reduces by exactly one state; the reduced machine gives the same output stream as the original on 200 random input sequences.
10. `analyzeCircuit(designFSM(st).netlist)` returns a state table that is equivalent to `st` (same output stream on random input sequences). This is the key round-trip test.
11. Incomplete state table (a missing input combination) is reported by `validateStateTable`.

**Acceptance:** all four tabs work. Write `docs/phase-4.md`.

---

# PHASE 5 — Clock pulse and timing diagrams (Member 4)

**LDAM concepts:** clock, edge triggering, propagation delay, setup/hold, hazards, glitches.

## PASTE THIS

Implement `src/engine/timing/` and the Timing page. Use the simulator from Phases 3–4; add an event-driven mode.

**Engine:**
- `simulateTimed(n: Netlist, stimulus: Stimulus, opts: { clockPeriod:number; duty:number; edge:'rising'|'falling'; defaultGateDelay:number; clkToQ:number; endTime:number }): Waveform`.
  - `Stimulus` = list of `{ t:number; net:NetId; value:0|1 }` input changes plus the clock.
  - Event-driven: a gate output changes `delay` ticks after any input change; if an output would change twice within less than its delay window, record the glitch (do not filter it) and add an `event` labelled `glitch` (this makes hazards visible).
  - Flip-flops sample on the active edge and change their output `clkToQ` ticks later.
- `stateSequence(w: Waveform, stateNets: NetId[]): { t:number; state:string }[]` — for labeling state changes ("00 → 01").
- `checkSetupHold(n, w, { setup:number; hold:number }): { violations: {ff:string; t:number; kind:'setup'|'hold'}[] }`.
- `findHazards(n: Netlist): { type:'static-1'|'static-0'|'dynamic'; where:string; fix?:string }[]` — static-1 hazards in a two-level SOP circuit: find adjacent minterms not covered by a common product term; `fix` suggests the consensus term. Use Phase 2 prime implicants.
- `toCSV(w: Waveform): string`.

**UI — Timing page:**
- SVG waveform viewer: time axis with ticks; one row per signal grouped (clock, inputs, state, outputs, internal); digital step waveforms; vertical cursors that show values of all signals at time t; active clock edges marked with arrows; state labels over the state-bus row; glitches highlighted in red; setup/hold violations marked.
- Controls: clock period, duty cycle, rising or falling edge, gate delay, run length, play/pause/step one clock; a stimulus editor (click on an input row to add a change at that time).
- Presets: "2-bit counter", "Sequence detector 1011", "Shift register", "Hazard demo".
- Buttons: Export PNG (render the SVG), Export SVG, Export CSV.

**Golden tests (must pass):**
1. Clock only: period 20, duty 50% → high 10 ticks, low 10 ticks; edges at the right times.
2. 2-bit JK counter (from Phase 4): over 8 clock periods, Q0 toggles at every active edge (+ clk-to-Q), Q1 toggles at every second edge, state sequence 00,01,10,11,00,… with labels.
3. Falling-edge option shifts all state changes to falling edges.
4. Propagation delay: an AND gate with delay 3, whose other input is 1, has its first input go 0→1 at t=10; the output changes at t=13.
5. Hazard: `F = AB + A'C` with B=C=1 and A changing 1→0: a static-1 hazard exists; the simulation with unequal delays shows a glitch to 0; `findHazards` reports it and suggests adding the consensus term `BC`; after adding it the glitch is gone.
6. Setup violation: change D within `setup` ticks before the active edge → one setup violation reported; changing it earlier → none.
7. `toCSV` has one column per signal and one row per tick change.

**Acceptance:** Timing page works for the presets and for any netlist from Phases 3–4. Write `docs/phase-5.md`.

---

# PHASE 6 — IC mapping, cost, power, optimization comparison, fault testing (Member 4)

**LDAM concepts:** gate-level optimization, universal-gate implementation, IC-based implementation, stuck-at fault model.

## PASTE THIS

Implement `src/engine/analysis/` and the Cost & Power and Faults pages.

**IC library (`src/data/ic-library.json`):** an array of ICs:
```json
{ "part":"7400", "family":"74LS", "description":"Quad 2-input NAND", "pins":14,
  "gates":[{"type":"NAND","inputs":2,"count":4}],
  "iccTypicalA": null, "unitPrice": null, "source":"placeholder" }
```
Include at least: 7400 (4×NAND2), 7402 (4×NOR2), 7404 (6×NOT), 7408 (4×AND2), 7432 (4×OR2), 7486 (4×XOR2), 7410 (3×NAND3), 7411 (3×AND3), 7427 (3×NOR3), 7420 (2×NAND4), 74151 (8:1 MUX), 74153 (dual 4:1 MUX), 74138 (3-to-8 decoder/demux), 74139 (dual 2-to-4), 74148 (8-to-3 priority encoder), 7447 (BCD to 7-segment), 7483 (4-bit adder), 7474 (2×D flip-flop), 7476 (2×JK flip-flop), 7490 (decade counter), 74161 (4-bit sync counter), 74194 (4-bit universal shift register). Pin counts: 14 for 7400, 7402, 7404, 7408, 7432, 7486, 7410, 7411, 7427, 7420, 7474, 7490; 16 for 74151, 74153, 74138, 74139, 74148, 7447, 7483, 7476, 74161, 74194. **Leave `iccTypicalA` and `unitPrice` as `null`** with `source:"placeholder"`; the UI must prompt the team to fill them from datasheets and a supplier catalogue, and cost/power show "enter library values" until they do. Provide an editable table in the UI to enter them and save to local storage and export JSON. Do not make up numbers.

**IC mapping (`ic-map.ts`):**
- `mapToICs(n: Netlist, lib: ICLibrary, opts?: { preferBlocks:boolean }): CostReport`.
- Rules: choose the smallest IC type whose gate has at least the needed fan-in (a 2-input gate uses a 2-input IC). Gates wider than the library offers are decomposed into trees. Unused inputs of a used gate are tied to the non-controlling level (AND/NAND → 1, OR/NOR → 0) and noted. Pack gates of the same type into as few ICs as possible. Report unused gates per IC. Flip-flops map to 7474 (D), 7476 (JK); T and SR are made from these with extra gates, noted in `notes`. Blocks map to their IC when `preferBlocks` is true.
- `totalPins`, `totalICs`, and `totalCost = Σ count × unitPrice` (null prices → `totalCost` undefined).

**Power (`power.ts`):**
- `transistorCount(n: Netlist, table = DEFAULT_TRANSISTORS): number` with defaults NOT = 2, NAND_k = 2k, NOR_k = 2k, AND_k = 2k+2, OR_k = 2k+2, XOR2 = XNOR2 = 12, D flip-flop = 20 (editable constants, labelled approximate).
- `staticPower(report: CostReport, vcc: number, lib): number = vcc × Σ (count × iccTypicalA)`.
- `dynamicPower(n: Netlist, activity: Record<NetId, number>, opts: { vdd:number; freqHz:number; defaultCapF:number; capPerNet?:Record<NetId,number> }): { total:number; perNet: ... }` using `P = Σ α_i · C_i · Vdd² · f`, where α_i = (number of 0→1 transitions on net i) / (number of clock cycles or input vectors applied).
- `activityFromSequence(n, sequence): Record<NetId, number>` using the simulator transition counts. For a combinational circuit the sequence is all input vectors in order (or a user-chosen sequence; default = binary count order).
- `powerReport(...)` combining static, dynamic, transistor count and the assumptions used. The UI shows the formula and every assumption next to the result, labeled "estimate".

**Optimization comparison (`optimize.ts`):**
- `compare(variants: {name:string; netlist:Netlist}[], opts): { rows:{name:string; gates:number; gateInputs:number; levels:number; ics:number; pins:number; cost?:number; staticW?:number; dynamicW?:number; transistors:number}[]; best:{gates:string; ics:string; cost?:string; power?:string} }`.
- Variants built for the user: Original (from canonical SOP), Simplified (K-map/QM), NAND-only, NOR-only. `levels` = longest path in gates. Show gate reduction % between original and simplified.

**Fault simulation (`fault.ts`):**
- `faultList(n): {net:string; stuckAt:0|1}[]` — every net, both polarities.
- `simulateWithFault(n, fault, inputs)`: force the net to the stuck value (also on fanout branches of that net as one fault site for this version).
- `runFaultTest(n, vectors?): FaultReport` — default vectors = all input combinations (up to 8 inputs); a fault is detected if some vector makes any primary output differ from the fault-free output. `table` records which vectors detect each fault.
- `minimalTestSet(report)`: greedy set cover over vectors; mark undetected faults as redundant (undetectable) and list them.
- Sequential circuits: apply a given input sequence and compare output streams per clock; keep it simple.

**UI:**
- **Cost & Power page:** editable IC library table, the mapping result as a parts list with a small package diagram per IC (pin numbers 1…14/16, gate groups outlined, unused gates greyed), total ICs, pins, cost, power and transistor count, with inputs for Vcc, Vdd, frequency and capacitance.
- **Compare tab:** side-by-side bar charts (gates, ICs, cost, power) for Original / Simplified / NAND / NOR, with the best marked per metric.
- **Faults page:** pick a net and stuck value to see the faulty circuit with the discrepancy highlighted; a full table of faults × test vectors; coverage %; the minimal test set; undetectable faults listed.

**Golden tests (must pass):**
1. Mapping 5 two-input NAND gates → 2 × 7400 with 3 gates unused; 4 gates → 1 × 7400, none unused; 9 NOT gates → 2 × 7404.
2. Fan-in matching: a 2-input AND gate is mapped to a 7408, not to a 7411 (3-input AND), because a 2-input IC is available. A 3-input AND is mapped to a 7411. A 5-input AND is decomposed into a tree of available gates, and the decomposition is listed in `notes`.
3. Pins: 2 × 7400 + 1 × 7404 → 28 + 14 = 42 pins.
4. `totalCost` with test prices 7400 = 10, 7404 = 12 for (2 × 7400 + 1 × 7404) → 32. With a null price, cost is undefined and the UI shows "enter library values".
5. Transistors: INV = 2, NAND2 = 4, NAND3 = 6, AND2 = 6, OR3 = 8, D flip-flop = 20 with the default table.
6. Dynamic power: one net with α = 0.5, C = 10 pF, Vdd = 5 V, f = 1 MHz → 125 µW (`0.5 × 10e-12 × 25 × 1e6 = 1.25e-4`).
7. Activity: a single inverter driven by a clock for 4 cycles has 4 rising transitions on its input and 4 on its output in 4 cycles → α = 1 on each (counting 0→1 per cycle). The test fixes the counting rule and documents it.
8. Compare: for Σm(1,3,5,7), Original has more gates than Simplified; Simplified has 0 gates (the output is the input C) and the report handles the "wire only" case without dividing by zero.
9. Fault: a 2-input AND gate with output stuck-at-0 is detected only by input 11; stuck-at-1 is detected by 00, 01 or 10; coverage with all 4 vectors is 100%; minimal test set for the AND gate's 6 faults (both inputs and output, s-a-0/s-a-1) has size 3 (for example 01, 10, 11).
10. Redundancy: `F = AB + AB'` implemented as two AND gates, an inverter and an OR gate (without simplifying it to `A`) has the stem of B stuck-at-0 and stuck-at-1 undetectable, because F always equals A. The test builds this circuit, treats the stem of B as one fault site, and asserts that `undetected` contains both faults.

**Acceptance:** all three pages work on any circuit from earlier phases. Write `docs/phase-6.md`.

---

# PHASE 7 — AI study assistant (chatbot) (Member 2)

**LDAM concepts:** (support feature) — explanation of the concepts above.

## PASTE THIS

Implement `server/` and the chat panel. Read the security rules first.

**Server (`server/index.ts`, Node + Express + TypeScript):**
- `POST /api/chat` with body `{ messages: {role:'user'|'assistant'; content:string}[], context: DesignContext, mode: 'explain'|'hint' }`.
- Reads `LLM_API_KEY`, `LLM_MODEL`, `LLM_PROVIDER` from `server/.env`. Put the provider call behind a small adapter (`server/llm/adapter.ts`) so the provider can be changed (default: Gemini API; keep the adapter small so another provider can be dropped in). Provide `.env.example` with empty values and README steps.
- Validation: max 20 messages, max 4,000 characters per message, context truncated to a fixed size; per-IP rate limit; CORS only for the dev origin; never return stack traces or the key.
- System prompt (put in `server/prompt.ts`): you are a tutor for a Logic Design course; only answer digital-logic questions and politely decline others; the numbers in `context` come from the tool's engines and are authoritative — never recompute or contradict them; if the student's question needs a number that is not in `context`, say so; in `hint` mode give a hint or a guiding question first and the full answer only if the student asks again; use the same notation as the tool (A', +, Σm); keep answers short, and explain terms like prime implicant when first used.
- If the key is missing or the call fails, return a clear JSON error `{error:'assistant_unavailable'}`.

**DesignContext (shared type, add to `types.ts`):**
```ts
interface DesignContext {
  page: string;
  function?: { vars:string[]; minterms:number[]; maxterms:number[]; dontCares:number[]; expr?:string };
  minimization?: { form:'SOP'|'POS'; text:string; termCount:number; literalCount:number; steps:Step[] };
  circuit?: { name:string; gates:number; levels:number; netlistSummary:string };
  sequential?: { ffType?:string; stateTable?:StateTable; equations?:string[]; stateSequence?:string[] };
  timing?: { events:{t:number;label:string}[] };
  cost?: Partial<CostReport>; power?: Partial<PowerReport>; faults?: Partial<FaultReport>;
}
```
`buildContext(appState): DesignContext` lives in the frontend and strips anything big or unnecessary.

**Chat panel (UI):**
- Collapsible right panel on every page; message list, input, "Explain this page" and "Give me a hint" buttons, a mode toggle (Explain / Hint), suggested questions that depend on the page (e.g. K-map page: "Why is this group valid?", "Why wasn't this cell grouped?").
- Each assistant message shows a small note "AI explanation — verify with the tool's results".
- Shows a friendly offline message if the server returns `assistant_unavailable`; every other feature must work without the server.

**Tests:**
1. Server rejects oversize input, a missing body, more than 20 messages.
2. Rate limit returns 429 after the configured number of requests.
3. The key never appears in any response, in the client build (after `npm run build`, search `dist/` for the actual key value from `server/.env` and for the text `LLM_API_KEY`; both must be absent), or in git (`.gitignore` must include `.env`, and `git ls-files` must not list any `.env` file).
4. With a mocked adapter: the system prompt and the context are passed through; `hint` mode changes the instruction; off-topic input is passed with the restriction in the system prompt.
5. Frontend: with the server down, the chat panel shows the offline message and the rest of the app works.

**Acceptance:** the assistant answers questions about the current page using the real context. Write `docs/phase-7.md` including how to get and set the key.

---

# PHASE 8 — Dashboard, integration, polish, final demo (Member 4, whole team)

## PASTE THIS

Integrate everything into one coherent app.

1. **Shared state:** one store (React context or a small state library) holding the current function, truth table, MinResult, Netlist variants, sequential design, waveform, cost/power/fault reports. Changing the input recomputes downstream results; heavy work (QM for 8 variables, fault simulation) runs in a Web Worker so the UI doesn't freeze.
2. **Dashboard page:** one scrollable page with cards in the order of the workflow — Input summary, Truth table (collapsed), K-map and QM result, Circuit (small), Simulation verified ✓/✗, Gate/IC/cost/power comparison, Fault coverage, Timing mini-view (if sequential) — each with an "Open" link to its full page. Include "Export report" which produces a printable HTML/PDF-ready page of all results with the assumptions.
3. **Examples menu:** one-click examples — Σm(1,3,5,7); the 4-variable don't-care example; full adder; 4:1 MUX; BCD to 7-segment (one segment); 2-bit JK counter; mod-6 counter; 1011 sequence detector; traffic-light controller (a Moore FSM with 4 states: NS-green, NS-yellow, EW-green, EW-yellow); the hazard demo.
4. **Save / load:** save the full project as JSON file (download/upload) and keep the last session in local storage.
5. **Quality pass:** keyboard accessible controls, labels on all inputs, sufficient contrast, a light/dark theme following the system setting, responsive down to a tablet width, clear empty and error states, a help page that lists every concept with one-line definitions (this doubles as syllabus coverage evidence).
6. **Consistency check:** a hidden "self-test" page that runs all golden examples through the full pipeline and shows green ticks; use it before every demo.
7. **Docs:** `README.md` (setup, scripts, structure, how to add an IC to the library, how to set the LLM key), `docs/USER_GUIDE.md` with screenshots placeholders, `docs/LDAM_MAPPING.md` mapping each syllabus topic to the page and module that implements it.

**Final demo script (the app must support this end to end in under 10 minutes):**
1. Enter F(A,B,C,D) = Σm(1,3,7,11,15) + d(0,2,5): truth table → K-map groups → QM steps (they agree) → expression.
2. Circuit drawn; flip inputs; verify passes; switch to NAND-only; verify passes.
3. Compare view: gates, ICs, cost, power for the four variants.
4. Run fault test; show coverage and minimal test set.
5. Open the 1011 sequence detector: state diagram → reduce states → design with JK flip-flops → circuit → timing diagram with a clock.
6. Analyze that circuit back to a state table (round trip).
7. Show the IC parts list with pin counts.
8. Ask the assistant: "Why does Q1 toggle only when Q0 is 1?" on the counter example.

**Acceptance:** the demo script runs without errors; `npm run build`, `npm test`, `npm run lint` pass; self-test page is all green.

---

# Split between four members (after Phase 0)

| Member | Phases / modules | Branch |
|---|---|---|
| 1 | Phase 1 (Boolean, truth tables); QM in Phase 2; state reduction and analysis helpers in Phase 4 | `m1-boolean-qm` |
| 2 | K-map in Phase 2; sequential equations and FSM design in Phase 4; Phase 7 (chatbot) | `m2-kmap-fsm-chat` |
| 3 | Phase 3 (circuits, blocks, NAND/NOR); flip-flops, counters, simulator in Phase 4 | `m3-circuit-seq` |
| 4 | Phases 5, 6, 8 (timing, IC/cost/power/faults, dashboard) | `m4-analysis-dashboard` |

Phase 4 depends on Phases 2 and 3; Phases 5 and 6 depend on Phase 3 and 4's simulator. Member 4 can start Phases 5 and 6 earlier with small netlists written by hand against the contract in A2 while the others finish.

# Troubleshooting prompts (use when something goes wrong)

- **A test fails and the agent edits the test:** "Do not change the test. Explain why the code disagrees with the expected answer, then fix the code. If you believe the test is wrong, show the hand calculation."
- **The agent starts building the next phase:** "Stop. Only implement the current phase. List what you have done outside this phase and revert it."
- **Agent invents IC prices or currents:** "Remove all invented numbers. Leave them null and `source: placeholder`."
- **Results look right in the UI but you doubt them:** "Write a brute-force checker for this feature and run it on 200 random inputs; report any mismatch."
- **Quota is running low:** "Summarize the current state and the remaining steps of this phase in `docs/handoff.md` so I can continue in a new conversation."
