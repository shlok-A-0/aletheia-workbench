import type { StateCreator } from 'zustand';
import type { CostReport, PowerReport, FaultReport } from '../../engine/types';

export interface AnalysisSlice {
  costReport: CostReport | null;
  powerReport: PowerReport | null;
  faultReport: FaultReport | null;
  setCostReport: (costReport: CostReport | null) => void;
  setPowerReport: (powerReport: PowerReport | null) => void;
  setFaultReport: (faultReport: FaultReport | null) => void;
  resetAnalysis: () => void;
}

export const createAnalysisSlice: StateCreator<AnalysisSlice, [], [], AnalysisSlice> = (set) => ({
  costReport: null,
  powerReport: null,
  faultReport: null,
  setCostReport: (costReport) => set({ costReport }),
  setPowerReport: (powerReport) => set({ powerReport }),
  setFaultReport: (faultReport) => set({ faultReport }),
  resetAnalysis: () => set({ costReport: null, powerReport: null, faultReport: null }),
});
