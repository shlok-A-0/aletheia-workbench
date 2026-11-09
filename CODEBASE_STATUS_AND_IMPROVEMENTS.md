# Codebase Audit & Status Report

**Repository:** Aletheia Workbench (`aletheia-workbench`)  
**Stack:** React 19 · Vite 8 · TypeScript 6.0 · Zustand 5 · Comlink 4 · Express 5 · Vitest 5  
**Audit Standard:** `/ponytail-audit` & `/ponytail-review` (Lean Senior Developer Audit)  
**Assumed Load:** Single-user desktop/coursework tool running locally, with an optional local Node/Express AI study assistant proxying to Gemini.

---

### What this repo does:
Aletheia Workbench is an educational digital logic design tool. It takes Boolean expressions or truth tables, minimizes them using Karnaugh Maps and Quine–McCluskey, synthesizes gate-level netlists (including NAND-only and NOR-only conversions), simulates synchronous sequential circuits and FSMs, tests for timing hazards, performs stuck-at fault testing, and maps circuits to 74-series TTL ICs.

---

## Part 1: Review of Recent Changes

### What the recent changes did:
Fixed 12 high-priority issues from the initial scan:
- Eliminated the fault coverage `* 100` double-multiplication bug in `DashboardPage.tsx` (e.g. `7500%` → `75.0%`).
- Converted the detached promise in `server/index.ts` to `async/await` with client-disconnect response guards and capped the rate-limiter map.
- Removed unbounded recursion in `generate.ts` `resolve()` with an iterative loop.
- Eliminated dead worker guard code in `useEngineWorker.ts`.
- Stopped background re-renders in `ChatPanel.tsx` by scoping the store subscription.
- Prevented perpetual loading spinners on reloaded projects by forcing `isComputing: false` during serialization and load.
- Deduplicated `pathDepth` and `gateCount` into `simulate.ts`.
- Accelerated timed simulation in `timing/index.ts` by replacing $O(N \log N)$ loop re-sorting with binary insertion.
- Moved project auto-load from a module-level side effect into a standard React mount hook in `App.tsx`.
- Removed the foreign `test_memory.py` file and added ignore rules to `.gitignore`.

**Review Verdict:** Clean, minimal diffs. All 114 Vitest tests pass across 19 suites, and TypeScript reports zero errors on both client and server.

---

## Part 2: Repo Audit & Current Status

### Must Fix

1. **Exposed secret in local root `.env`** (`.env:L3`)
   - **What this is:** A root-level `.env` file containing `BACKBOARD_API_KEY=espr_mwBQz...`.
   - **Problem:** Although `.gitignore` covers `.env`, keeping active API tokens in root files risks accidental leak via zip sharing, git force-adds, or scanner tools.
   - **Fix:** Move any required server keys into `server/.env` (which is already gitignored) and delete the root `.env` file or blank the key.
   - **If we skip it:** The secret could be shared unintentionally if the project folder is zipped or uploaded.

---

### Should Fix

2. **Datasheet parameters empty in IC Library** (`src/data/ic-library.json:L1-24`)
   - **What this is:** The catalog of 22 standard 74LS-series logic chips used for bill-of-materials and power estimation.
   - **Problem:** Every part has `"iccTypicalA": null` and `"unitPrice": null`. The IC Mapping page and Dashboard currently show `"price unavailable"` and `"static component unavailable"`.
   - **Fix:** Populate `iccTypicalA` (in Amperes) and `unitPrice` (in USD) using the datasheet extraction prompt provided in the previous step.
   - **If we skip it:** The Cost & Power page cannot compute actual monetary costs or static power consumption.

3. **Multi-output minimization has no UI interface** (`src/engine/minimize/multi-qm.ts:L9`)
   - **What this is:** Engine support for minimizing multiple Boolean outputs simultaneously and identifying shared logic terms.
   - **Problem:** The engine function `multiOutputQM` is fully tested and working, but `InputPage.tsx` only accepts single-output truth tables.
   - **Fix:** Connect multi-output mode during the upcoming UI overhaul, or document it as an engine-only capability.
   - **If we skip it:** Users cannot take advantage of multi-output sharing in the UI.

4. **Unimplemented design import proposal file** (`PHASE_9_IMPORT_REVIEW.md:L1-85`)
   - **What this is:** A 85-line architecture notes file describing a file import pipeline for Verilog/schematics.
   - **Problem:** The README explicitly marks this feature as not implemented. Keeping speculative design proposals alongside active code creates confusion for new developers.
   - **Fix:** Move to a `docs/proposals/` folder or delete if not planned for the near term.
   - **If we skip it:** Contributors might assume the import feature is partially implemented.

---

### Nice to Have

5. **Monolithic CSS architecture ready for UI modernisation** (`src/App.css:L1-450`, `src/index.css:L1-200`)
   - **What this is:** Global CSS sheets styling all tabs, buttons, grids, and dialogs.
   - **Problem:** Styles are coupled into two large flat files with ad-hoc utility classes (`p6-chart`, `glass-card`, `circuit-variant-bar`), making targeted visual refreshes tedious.
   - **Fix:** Refactor into Tailwind CSS or scoped CSS modules during your planned visual aesthetic redesign.
   - **If we skip it:** CSS specificity clashes remain likely when changing individual page layouts.

6. **State diagram SVG fixed viewBox** (`src/ui/pages/SequentialPage.tsx:L122`)
   - **What this is:** SVG renderer for finite state machine diagrams.
   - **Problem:** Uses a fixed `480×380` viewBox. For machines with more than 6 states, labels and transition arcs can overlap.
   - **Fix:** Scale radius dynamically with `nodes.length` or add simple pan/zoom controls.
   - **If we skip it:** Complex FSMs with many states look cluttered.

---

## Verdict & Health Check

- **Verdict:** **Healthy. Ready for UI redesign.**
- **Test Suite:** 19/19 files passed (114/114 unit & integration tests).
- **TypeScript:** 0 compile errors across both client (`tsconfig.app.json`) and server (`tsconfig.server.json`).
- **Lean:** Removed 1 foreign file, deduplicated depth calculations across 2 pages, and eliminated dead Comlink wrappers.

---

## What You Need to Do Next (Action Checklist)

1. **Populate Datasheet Values (Your Friend):**
   - Provide your friend with the prompt from the previous step.
   - Replace [`src/data/ic-library.json`](file:///c:/Users/shlok/Desktop/college/ldm/cp/ldam-app/src/data/ic-library.json) with Claude's extracted JSON to activate live cost and static power figures.

2. **Setup Local AI Assistant (Optional):**
   - If using the AI tutor chat feature: copy `server/.env.example` to `server/.env` and insert a Gemini API key.
   - Remove or rotate the placeholder key currently in root `.env`.

3. **Proceed with UI Redesign:**
   - The entire core logic (parsers, QM, K-Map, Netlist synthesis, sequential simulation, fault testing, timing, workers, and Zustand store) is completely stable, decoupled, and covered by automated tests.
   - You can safely hand the UI components (`src/ui/pages/` and CSS) to another AI for an aesthetic overhaul without worrying about breaking digital logic algorithms.
