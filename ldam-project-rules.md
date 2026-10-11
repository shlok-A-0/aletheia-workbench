# LDAM Project Rules — Digital Logic Circuit Analyzer
<!-- Save as: .agent/rules/ldam-project-rules.md in the workspace root. These rules apply to every task. -->

## What this project is
A web app for a Logic Design and Applications (LDAM) course. It takes a Boolean function or a sequential-circuit specification and runs it through: truth table → K-map / Quine–McCluskey → simplified expression → circuit → simulation → timing diagram → optimization → NAND/NOR → IC mapping, cost and power → fault testing. It also has an AI study assistant. It is an educational tool; correctness and explainability matter more than visual flash.

The full feature list is in `LDAM_BUILD_PROMPT.md`. Build ONE phase at a time. Do not start a later phase unless asked.

## Stack (fixed — do not change without asking)
- Vite + React + TypeScript (strict mode) for the frontend.
- The logic engine lives in `src/engine/` as PURE TypeScript: no React, no DOM, no network, no randomness. It must run in plain Node so it can be unit-tested.
- Vitest for tests. ESLint + Prettier.
- Node + Express in `server/` for the chatbot proxy only. Nothing else needs a backend.
- Circuits and timing diagrams are drawn as inline SVG in React components. No heavy diagram or charting libraries unless asked.
- Keep dependencies minimal. Ask before adding any package that is not a dev tool.

## Architecture rules
1. Engine modules talk to each other only through the types in `src/engine/types.ts` (Expr, TruthTable, Implicant, MinResult, Netlist, StateTable, Waveform, CostReport, PowerReport, FaultReport). Never invent a second format for the same thing. If a type must change, change it in one place and update every user.
2. The UI never contains logic. It calls engine functions and renders results.
3. Every engine function is deterministic and has unit tests next to it (`*.test.ts`).
4. A circuit is always a `Netlist` (JSON). Simulation, drawing, IC mapping, power and fault testing all read the same Netlist.
5. Engines return explanation steps (`steps: Step[]`) as data, not strings of HTML, so the UI and the chatbot can both use them.

## Correctness rules (most important)
- NEVER mark a task done without running `npm test` and showing the result. If tests fail, fix the code; do not edit a test to make it pass unless the test is wrong and you explain why.
- Minimization results are checked by EQUIVALENCE and COST, not by exact text. Several minimal covers can exist. A result is correct if (a) it equals the function on every care minterm and (b) its term count and literal count equal the true minimum (verified by brute force in the tests for n ≤ 4).
- Use Gray-code order (00, 01, 11, 10) for K-map axes. K-maps wrap around at the edges.
- Don't-care terms may be used to enlarge groups but never have to be covered.
- Convention: minterm index uses the FIRST variable as the most significant bit (A is MSB in F(A,B,C)).
- Do not invent datasheet numbers. IC prices, supply currents and capacitances in the component library are PLACEHOLDERS marked `source: "placeholder"` until the team fills them from real datasheets and a supplier catalogue. Show a visible "estimate" label in the UI wherever they are used.
- Cost and power are ESTIMATES for comparing designs. Say so in the UI.

## Security rules
- The LLM API key lives only in `server/.env` and is read only by the server. Never put it in client code, in git, or in a Vite `VITE_` variable. Commit `server/.env.example` with an empty value.
- The chat endpoint must validate input length, rate-limit per IP, and never echo the key or stack traces to the client.

## Working style
- Before writing code for a phase: post a short plan (files you will create, functions and their signatures, test list) and wait for approval.
- Work in small steps. After each step run the relevant tests.
- When a phase is finished, give: what was built, how to run it, test output, and anything you could not do or are unsure about. Be honest about gaps.
- Commit at the end of each phase with a message like `phase-2: K-map and Quine–McCluskey`.
- Prefer clear, commented code over clever code. A student on the team must be able to read it. Add a header comment to each engine file naming the LDAM concept it implements.
- Do not delete or rewrite working code from earlier phases unless the current phase requires it; if so, say why.

## Definition of done (for every phase)
1. Code builds with no TypeScript errors (`npm run build`).
2. `npm test` passes, including the golden tests listed for the phase.
3. Lint passes.
4. A short `docs/phase-N.md` describes the public functions and how to use them.
5. The phase can be demonstrated in the UI (when the phase includes UI).
