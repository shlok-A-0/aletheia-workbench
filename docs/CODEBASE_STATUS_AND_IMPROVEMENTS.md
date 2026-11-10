# Codebase Audit & Status Report

**Repository:** Aletheia Workbench (`aletheia-workbench`)  
**Branch:** `ui/neo-brutalist-overhaul`  
**Stack:** React 19 · Vite 8 · TypeScript 6.0 · Zustand 5 · Comlink 4 · Express 5 · Vitest 5 · React Flow 12 · ELKjs 0.12  
**Audit Standard:** `/ponytail-audit` & `/ponytail-review` (Lean Senior Developer Review)  
**Assumed Load:** Single-user desktop/coursework tool running locally in the browser, with an optional local Node/Express study assistant server proxying to Gemini.

---

### What this repo does:
Aletheia Workbench is an interactive digital logic workbench for computer engineering and logic design coursework. It takes Boolean expressions or truth tables, minimizes them with Karnaugh Maps and Quine–McCluskey, synthesizes gate-level netlists (discrete AND/OR, universal NAND/NOR, and MSI MUX/Decoder implementations), simulates synchronous sequential circuits and FSMs with live schematics, detects timing hazards, generates stuck-at fault test vectors, and calculates physical bill-of-materials costs using verified 74LS TTL IC datasheets.

---

## Part 1: Review of Recent Changes (`/ponytail-review`)

### What this change does:
1. **MSI Function Realization & Arithmetic Pruning (`BlocksPage.tsx`):**
   - Pruned arithmetic blocks (adders, comparators) to focus strictly on logic implementation.
   - Added user-configurable MUX realization (8:1 full select, 4:1 Shannon expansion with residual variables, 2:1 tree) and canonical Decoder + OR gate realization.
   - Wired live interactive schematics with clickable input toggle buttons and Shannon decomposition steps.
2. **Sequential Circuit Schematics (`elkLayout.ts`, `SchematicView.tsx`, `SequentialPage.tsx`):**
   - Added standard Flip-Flop symbol layout support ($D, T, JK, SR$) with clock triangles, data inputs, and $Q/Q'$ outputs.
   - Embedded live interactive schematics into the Sequential tab for both standard counters (updating on every clock step) and synthesized FSMs.
   - Updated `evaluate()` in `simulate.ts` to initialize flip-flop states so sequential feedback excitation logic evaluates cleanly without spurious loop errors.
3. **IC Library Datasheet Parameters (`ic-library.json`):**
   - Replaced all null values across 22 74LS chips with verified Texas Instruments datasheet supply currents ($I_{CC}$) and industrial unit prices with citations.
4. **Waveform Viewer Cursor Auto-Scroll (`TimingPage.tsx`):**
   - Attached an auto-scrolling viewport observer so scrubbing the playhead past $t \approx 77$ smoothly centers the cursor.

### Review Verdict:
**Ship.** All 133 Vitest tests pass across 22 test suites. TypeScript compiles with 0 errors across client and server configs. All changes are minimal, backward-compatible, and follow the neo-brutalist design system.

---

## Part 2: Whole-Repo Audit (`/ponytail-audit`)

### Must Fix
*None. All previous audit findings (fault coverage scaling, rate limiting, detached promises, unbounded recursive trees, empty datasheet values, and timing cursor tracking) are resolved and verified.*

---

### Should Fix

1. **Multi-output minimization has no UI input** (`src/engine/minimize/multi-qm.ts:L9-L30`)
   - **What this is:** Engine support for minimizing multiple Boolean outputs simultaneously (e.g. $F_1, F_2$) and identifying shared logic gates.
   - **Problem:** The engine function `multiOutputQM` is fully implemented and tested, but the hero input form only takes single-output expressions or single-column truth tables.
   - **Fix:** Keep as an engine utility for future multi-output extensions, or document in the Help page as an engine-level capability.
   - **If we skip it:** Multi-output gate sharing remains accessible only via engine tests rather than the interactive UI.

2. **Large K-Map variable notice is post-hoc** (`src/ui/pages/KMapPage.tsx:L32-L38`)
   - **What this is:** K-Map grid rendering for minimized expressions.
   - **Problem:** While expressions with > 5 variables correctly show an advisory banner directing students to Quine–McCluskey, the Workbench hero input allows typing 6+ variables before warning the user.
   - **Fix:** Add a tiny hint in the hero input when $> 5$ unique variable names are typed ("K-Map visualization is optimal for 2–5 variables").
   - **If we skip it:** Students typing 6+ variables only see the limitation after scrolling down or navigating to the deep-dive page.

3. **Port collision on abrupt terminal exit** (`package.json:L7`)
   - **What this is:** The local Vite development server on port 5173.
   - **Problem:** If a terminal tab is closed without SIGINT, the node process can remain orphaned on 5173, causing subsequent launches to silently bump to 5174.
   - **Fix:** Added port cleanup documentation in the running guide (`Stop-Process -Id <PID> -Force`).
   - **If we skip it:** Users might wonder why their browser tab at 5173 isn't updating if a zombie server is holding the port.

---

### Nice to Have

4. **One-click sample chips on deep-dive pages** (`src/ui/pages/BlocksPage.tsx:L45-L50`)
   - **What this is:** Quick expressions for users who visit a deep-dive URL directly.
   - **Problem:** While `BlocksPage` has an automatic 3-variable sample fallback when no workbench expression is active, adding 2–3 preset chips (`Majority`, `Parity`, `Mux 4:1`) right on the card allows instant experimentation without navigating back to the hero.
   - **Fix:** Add a small preset toolbar above the derivation card.
   - **If we skip it:** Minor UX convenience only; users can already type any expression on the Workbench.

5. **Keyboard shortcuts for clock stepping** (`src/ui/pages/SequentialPage.tsx:L750`)
   - **What this is:** Stepping the clock in sequential counter simulations.
   - **Problem:** Users must click the "Step Clock" button with the mouse repeatedly.
   - **Fix:** Add a `keydown` listener for `Space` or `ArrowRight` when the counter tab is active.
   - **If we skip it:** Clock pulsing works normally via button clicks.

---

### Verdict:
**Healthy. Ship.**

- **Test Suite:** 22 suites, 133 tests passing (100% green).
- **Type Safety:** 0 TypeScript diagnostics across client and server.
- **Lean Delta:** -4 unused arithmetic MSI blocks pruned, 74LS IC library fully grounded in real electrical data, flip-flop schematics unified into standard ELK layout pipeline without external layout dependencies.
- **Not checked:** Production CDN asset caching headers (since this is deployed as a local college lab tool / desktop web app).
