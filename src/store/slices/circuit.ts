import type { StateCreator } from 'zustand';
import type { Netlist } from '../../engine/types';

export type CircuitVariant = 'original' | 'simplified' | 'nand' | 'nor';

export interface CircuitSlice {
  netlists: Record<CircuitVariant, Netlist | null>;
  activeVariant: CircuitVariant;
  setNetlist: (variant: CircuitVariant, netlist: Netlist | null) => void;
  setActiveVariant: (activeVariant: CircuitVariant) => void;
  resetCircuits: () => void;
}

export const createCircuitSlice: StateCreator<CircuitSlice, [], [], CircuitSlice> = (set) => ({
  netlists: {
    original: null,
    simplified: null,
    nand: null,
    nor: null,
  },
  activeVariant: 'simplified',
  setNetlist: (variant, netlist) =>
    set((state) => ({
      netlists: {
        ...state.netlists,
        [variant]: netlist,
      },
    })),
  setActiveVariant: (activeVariant) => set({ activeVariant }),
  resetCircuits: () =>
    set({
      netlists: { original: null, simplified: null, nand: null, nor: null },
      activeVariant: 'simplified',
    }),
});
