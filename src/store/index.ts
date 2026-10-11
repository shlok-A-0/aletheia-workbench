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

export const useStore = create<RootStore>()((...a) => ({
  ...createInputSlice(...a),
  ...createMinimizeSlice(...a),
  ...createCircuitSlice(...a),
  ...createSequentialSlice(...a),
  ...createTimingSlice(...a),
  ...createAnalysisSlice(...a),
}));
