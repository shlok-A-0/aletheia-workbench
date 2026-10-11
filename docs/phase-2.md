# Phase 2 — K-Map and Quine–McCluskey Minimization

## Overview
Phase 2 implements the core logic minimization engines:
1. **Quine–McCluskey (Tabular Method):** Deterministic adjacency pairing, essential prime implicant extraction, and Petrick's expansion for exact minimal covers (with greedy fallback if PI chart $> 40$).
2. **Karnaugh Map (K-Map):** Gray-code 2D coordinate mapping ($00, 01, 11, 10$) for 2, 3, and 4 variables, with torus wrap-around group detection (including 4-corner groups) and step-by-step variable elimination explanations.
3. **Multi-Output QM:** Minimizes multi-output circuits (e.g. 7-segment decoders) with tagged implicants sharing AND gates.

---

## Public Engine API (`src/engine/minimize/`)

### 1. Quine–McCluskey (`qm.ts`)
```ts
export function quineMcCluskey(tt: TruthTable, form?: 'SOP' | 'POS'): MinResult;
export function primeImplicants(tt: TruthTable): Implicant[];
export function allMinimalCovers(tt: TruthTable): MinResult[];
```
- Groups minterms by number of 1s, combines adjacent single-bit differences iteratively.
- Generates Prime Implicants and builds the PI coverage chart.
- Solves for Essential Prime Implicants and expands cyclic cores using Petrick's method.
- Evaluates cost: fewest terms, then fewest literals.
- Supports both SOP and POS (minimizing maxterms).

### 2. Karnaugh Map (`kmap.ts`)
```ts
export function buildKMap(tt: TruthTable): KMap;
export function kmapGroups(tt: TruthTable, form?: 'SOP' | 'POS'): { groups: KMapGroup[] };
export function kmapSimplify(tt: TruthTable, form?: 'SOP' | 'POS'): MinResult;
```
- Builds Gray-code 2D grid coordinates for 2, 3, and 4 variables.
- Detects rectangular subcubes of size $1, 2, 4, 8, 16$ with torus wrap-around at all grid borders.
- Correctly recognizes corner groups (e.g., $B'D'$ over minterms $0, 2, 8, 10$).
- Agrees in minimal cost with Quine–McCluskey.

### 3. Multi-Output Minimization (`multi-qm.ts`)
```ts
export function multiOutputQM(outputs: { name: string; tt: TruthTable }[]): MultiMinResult;
```
- Minimizes multiple output functions simultaneously.
- Identifies and tags shared prime implicants to save physical logic gates.

---

## Verification & Test Results

Executed via `pnpm test`:
- **Golden Test 1:** $\Sigma m(1,3,5,7)$ over $A,B,C \to C$ (1 term, 1 literal) passed.
- **Golden Test 2:** $\Sigma m(1,3,7,11,15) + d(0,2,5)$ over $A,B,C,D \to 2$ terms, 4 literals passed.
- **Golden Test 3:** $\Sigma m(0,1,2,5,6,7,8,9,10,14) \to 3$ terms, 7 literals passed.
- **Golden Test 4:** $\Sigma m(4,8,10,11,12,15) + d(9,14) \to 3$ terms, 7 literals passed.
- **Golden Test 5:** Trivial cases (all-zeros $\to 0$, all-ones $\to 1$, single minterm) passed.
- **Golden Test 6:** 5-variable function $\Sigma m(0,1,2,5,6,7,8,9,10,14,16,21,31)$ verified for exact care coverage and 0-non-coverage passed.
- **Golden Test 7:** K-Map cost equals QM cost passed across 2 to 4 variables.
- **Golden Test 8:** Torus wrap-around detects 4-corner group for $B'D'$ (minterms $0, 2, 8, 10$) passed.
- **Golden Test 9:** POS of $\Sigma m(0,1,2,5,6,7,8,9,10,14)$ equivalent to SOP passed.
- **Multi-Output QM:** Shared prime implicants extraction passed.
