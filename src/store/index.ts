import { create } from 'zustand';
import { createInputSlice, type InputSlice } from './slices/input';
import { createMinimizeSlice, type MinimizeSlice } from './slices/minimize';
import { createCircuitSlice, type CircuitSlice } from './slices/circuit';
import { createSequentialSlice, type SequentialSlice } from './slices/sequential';
import { createTimingSlice, type TimingSlice } from './slices/timing';
import { createAnalysisSlice, type AnalysisSlice } from './slices/analysis';

export type RootStore = InputSlice &
  MinimizeSlice &
  CircuitSlice &
  SequentialSlice &
  TimingSlice &
  AnalysisSlice;

export const useStore = create<RootStore>()((...a) => {
  const [set, get] = a;
  const clearDerivedResults = {
    truthTable: null,
    parsedExpr: null,
    minResult: null,
    multiMinResult: null,
    netlists: { original: null, simplified: null, nand: null, nor: null },
    stateTable: null,
    designedNetlist: null,
    excitationEquations: [],
    outputEquations: [],
    waveform: null,
    costReport: null,
    powerReport: null,
    faultReport: null,
  };

  return {
    ...createInputSlice(...a),
    ...createMinimizeSlice(...a),
    ...createCircuitSlice(...a),
    ...createSequentialSlice(...a),
    ...createTimingSlice(...a),
    ...createAnalysisSlice(...a),
    setInput: (rawInput, mode) => {
      const resolvedMode = mode ?? get().inputMode;
      const sourceMode = resolvedMode === 'expr' ? 'expression' : resolvedMode;
      set({
        ...clearDerivedResults,
        rawInput,
        inputMode: resolvedMode,
        input: {
          mode: sourceMode,
          raw: rawInput,
          vars: get().vars,
          ...(resolvedMode === 'minterms' || resolvedMode === 'maxterms'
            ? { dontCares: get().dontCaresStr }
            : {}),
        },
      });
    },
    setVars: (vars) => {
      const input = { ...get().input, vars };
      set({ ...clearDerivedResults, vars, input });
    },
    setTruthTable: (truthTable) => set({ ...clearDerivedResults, truthTable }),
  };
});
