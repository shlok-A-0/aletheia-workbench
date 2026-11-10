# Aletheia Workbench — Product Roadmap & Status

This document tracks all completed fixes, active UX & architectural enhancements, and remaining tasks for the Aletheia Workbench digital logic suite.

---

## 1. Completed Milestones

- [x] **Timing Waveform Cursor Auto-Scroll**
  - Viewport auto-scrolls horizontally to keep the cursor centered when scrubbing past visible boundaries (e.g., $t > 77$).
- [x] **74LS IC Library Datasheet Integration**
  - All 22 74LS-series parts in `src/data/ic-library.json` populated with verified typical supply current ($I_{CC}$) and real industrial unit prices ($USD) with datasheet citations (Texas Instruments SN74LS series).
  - All unit & integration tests updated and passing.
- [x] **Blocks Page Evolution (MSI Logic Implementation & Pruning)**
  - Pruned the Arithmetic section (Half/Full Adder, Ripple Adder, Comparator) to keep focus sharp.
  - Added **"Implement Expression"** mode:
    - **Multiplexer (MUX) Realization**:
      - User can choose MUX size ($2^n:1$ direct or $2^{n-1}:1$ / $2^{n-2}:1$ via Shannon expansion).
      - Displays derivation steps detailing Shannon decomposition equations and $D_i$ input assignments.
      - Live interactive gate-level schematic in `SchematicView` with clickable inputs.
    - **Decoder Realization**:
      - $n$-to-$2^n$ decoder with active minterms feeding an OR gate.
      - Derivation steps showing active minterms $\sum m(\dots)$.
      - Live interactive gate-level schematic in `SchematicView`.
  - Added MUX 8:1 and DEMUX 1:8 to the Standard MSI Library gallery.
- [x] **Sequential Circuit Schematics**
  - Extended `elkLayout.ts` and `SchematicView.tsx` with standard Flip-Flop (`kind: 'ff'`) symbol support ($D, T, JK, SR$) with CLK triangle, input ports, and $Q / Q'$ output ports.
  - Embedded live interactive schematics in `SequentialPage.tsx`:
    - **Counters & Shift Registers Tab**: Live schematic updates state dynamically on "Step Clock" or "Reset".
    - **FSM Designer Tab**: Renders synthesized FSM circuit schematic directly alongside the State Diagram.

---

## 2. Recommended UX Enhancements (Next Iteration)

1. **One-Click Example Expressions on Deep-Dive Pages**:
   - When visiting Blocks or Cost pages without an expression, provide instant one-click chips (e.g. `F = AB + A'C`, `Majority F = AB + BC + AC`, `XOR Parity`) instead of an empty disabled state.
2. **Keyboard Controls for Stepping**:
   - `Space` or `→` key to trigger "Step Clock" in both the Sequential and Timing simulators.
3. **Downloadable Schematics & Netlists**:
   - Export synthesized MUX/Decoder and Sequential netlists as Verilog HDL or SVG for college lab submissions.
4. **Interactive Shannon Expansion Visualizer**:
   - Visual tree showing $F = x \cdot F_{x} + x' \cdot F_{x'}$ breakdown.

---

## 3. Verification & QA Matrix

| Target | Command | Status |
|:---|:---|:---:|
| TypeScript Compiler | `pnpm run typecheck` | Passing (0 errors) |
| Test Suite (133 tests) | `pnpm test` | Passing (22 suites, 133 tests) |
