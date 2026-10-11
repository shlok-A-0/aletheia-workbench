import type { StateCreator } from 'zustand';
import type { MinResult, MultiMinResult } from '../../engine/types';

export interface MinimizeSlice {
  minResult: MinResult | null;
  multiMinResult: MultiMinResult | null;
  selectedForm: 'SOP' | 'POS';
  isComputing: boolean;
  setMinResult: (minResult: MinResult | null) => void;
  setMultiMinResult: (multiMinResult: MultiMinResult | null) => void;
  setSelectedForm: (selectedForm: 'SOP' | 'POS') => void;
  setIsComputing: (isComputing: boolean) => void;
  resetMinimize: () => void;
}

export const createMinimizeSlice: StateCreator<MinimizeSlice, [], [], MinimizeSlice> = (set) => ({
  minResult: null,
  multiMinResult: null,
  selectedForm: 'SOP',
  isComputing: false,
  setMinResult: (minResult) => set({ minResult }),
  setMultiMinResult: (multiMinResult) => set({ multiMinResult }),
  setSelectedForm: (selectedForm) => set({ selectedForm }),
  setIsComputing: (isComputing) => set({ isComputing }),
  resetMinimize: () => set({ minResult: null, multiMinResult: null, isComputing: false }),
});
