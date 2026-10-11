# Phase 1 — Boolean Engine and Truth Tables

## Overview
Phase 1 implements the core mathematical and pedagogical foundation of the LDAM workbench. It parses Boolean expressions into an Abstract Syntax Tree (AST), evaluates expressions deterministically, converts between multiple representations (minterms, maxterms, direct output vectors), computes Canonical SOP / POS forms, and provides step-by-step algebraic simplification.

---

## Public Engine API (`src/engine/boolean/`)

### 1. Parser (`parser.ts`)
```ts
export class ParseError extends Error {
  position: number;
}
export function parseExpr(text: string): Expr;
```
- **Supported Syntax:**
  - Variables: Single uppercase letters `A`–`Z`
  - Postfix NOT: `'` (e.g., `A'`, `(A+B)'`)
  - Prefix NOT: `!`, `~`, `NOT`
  - AND: `.`, `*`, `&`, `AND`, and implicit juxtaposition (`AB` $\to$ `A * B`, `A'B` $\to$ `A' * B`, `(A+B)(C+D)` $\to$ `(A+B) * (C+D)`)
  - OR: `+`, `|`, `OR`
  - XOR: `^`, `XOR`
  - XNOR: `~^`, `@`, `XNOR`
  - Constants: `0`, `1`
  - Precedence: `NOT > AND > XOR/XNOR > OR` (Parentheses override precedence).
  - Throws `ParseError` with zero-indexed `position`.

### 2. Evaluator & Equivalence (`evaluator.ts`)
```ts
export function collectVars(e: Expr): string[];
export function evalExpr(e: Expr, assignment: Record<string, 0 | 1>): 0 | 1;
export function isEquivalent(a: Expr, b: Expr, vars?: string[]): boolean;
```
- Deterministic Boolean tree evaluation without external dependencies.
- `collectVars` orders variables alphabetically (MSB first).
- `isEquivalent` validates full equivalence over all $2^n$ assignments.

### 3. Truth Table Builder (`truth-table.ts`)
```ts
export function truthTableFromExpr(e: Expr, vars?: string[]): TruthTable;
export function truthTableFromMinterms(vars: string[], minterms: number[], dontCares?: number[]): TruthTable;
export function truthTableFromMaxterms(vars: string[], maxterms: number[], dontCares?: number[]): TruthTable;
export function truthTableFromOutputs(vars: string[], outputs: (0 | 1 | 'x')[]): TruthTable;
export function mintermsOf(tt: TruthTable): number[];
export function maxtermsOf(tt: TruthTable): number[];
export function dontCaresOf(tt: TruthTable): number[];
```
- Full support for care and don't-care (`'x'`) outputs.
- Row index $i$ corresponds directly to the minterm binary pattern (MSB in variable index 0).

### 4. Canonical Forms & Serializer (`canonical.ts`)
```ts
export function exprToString(e: Expr): string;
export function canonicalSOP(tt: TruthTable): { expr: Expr; text: string; steps: Step[] };
export function canonicalPOS(tt: TruthTable): { expr: Expr; text: string; steps: Step[] };
```
- Canonical SOP produces the expanded Sum of Minterms ($\Sigma m$) with individual derivation steps.
- Canonical POS produces the expanded Product of Maxterms ($\Pi M$) with individual derivation steps.
- `exprToString` serializes AST with minimal parentheses using postfix `'` notation.

### 5. Algebraic Simplification (`algebraic.ts`)
```ts
export function simplifyAlgebraic(expr: Expr): { expr: Expr; steps: Step[] };
```
- Applies standard Boolean theorems:
  - Involution: $(A')' = A$
  - Identity: $A + 0 = A$, $A \cdot 1 = A$
  - Annulment / Null: $A + 1 = 1$, $A \cdot 0 = 0$
  - Idempotent: $A + A = A$, $A \cdot A = A$
  - Complementarity: $A + A' = 1$, $A \cdot A' = 0$
  - De Morgan's Laws: $(A + B)' = A'B'$, $(AB)' = A' + B'$
  - Absorption: $A + AB = A$, $A(A + B) = A$
  - Redundancy / Negative Absorption: $A + A'B = A + B$, $A' + AB = A' + B$
- Cycle guard: Terminates when an expression hash has already been encountered or after 100 rounds.

---

## User Interface

- **Input Page (`/input`):**
  - **Expression Tab:** Formula input with live syntax verification, operator toolbar, LDAM lab presets, and interactive algebraic reduction accordion.
  - **Minterms Tab:** Variable count selector, $\Sigma m$ indices, and $d$ don't-care indices.
  - **Maxterms Tab:** Variable count selector, $\Pi M$ indices, and $d$ don't-care indices.
  - **Direct Table Tab:** Live editable table cycling cell values `0 -> 1 -> x`.
- **Truth Table Page (`/truth-table`):**
  - Table grid with binary minterm column and editable output buttons.
  - Summary metric cards ($n$, $2^n$ rows, $\Sigma m$ count, $\Pi M$ count, $d$ count).
  - Canonical SOP and POS cards with 1-click clipboard copy.

---

## Verification & Tests

Executed via `pnpm test`:
- **Golden Test 1:** `parseExpr("A'B + C")` evaluations and round-trip equivalence passed.
- **Golden Test 2:** `truthTableFromMinterms(['A','B','C'], [1,3,5,7])` outputs and maxterms $[0,2,4,6]$ passed.
- **Golden Test 3:** Canonical POS matching `(A+B+C)(A+B'+C)(A'+B+C)(A'+B'+C)` passed.
- **Golden Test 4:** XOR $[1,2]$ and XNOR $[0,3]$ minterms passed.
- **Golden Test 5:** De Morgan equivalence check passed.
- **Golden Test 6:** ParseError position throwing on invalid syntax (`A+`, `(A+B`, `A$B`) passed.
- **Golden Test 7:** Property test across 50 random 4-variable expressions passed.
- **Golden Test 8:** Don't-cares placement test passed.
- **Algebraic Tests:** $A + A'B \to A + B$ and $(A + B)' \to A'B'$ passed.
