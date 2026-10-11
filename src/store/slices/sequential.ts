import type { StateCreator } from 'zustand';
import type { StateTable, Netlist, FFType } from '../../engine/types';

export interface SequentialSlice {
  stateTable: StateTable | null;
  designedNetlist: Netlist | null;
  selectedFF: FFType;
  excitationEquations: string[];
  outputEquations: string[];
  setStateTable: (stateTable: StateTable | null) => void;
  setDesignedNetlist: (designedNetlist: Netlist | null) => void;
  setSelectedFF: (selectedFF: FFType) => void;
  setEquations: (excitation: string[], output: string[]) => void;
  resetSequential: () => void;
}

export const createSequentialSlice: StateCreator<SequentialSlice, [], [], SequentialSlice> = (set) => ({
  stateTable: null,
  designedNetlist: null,
  selectedFF: 'D',
  excitationEquations: [],
  outputEquations: [],
  setStateTable: (stateTable) => set({ stateTable }),
  setDesignedNetlist: (designedNetlist) => set({ designedNetlist }),
  setSelectedFF: (selectedFF) => set({ selectedFF }),
  setEquations: (excitationEquations, outputEquations) =>
    set({ excitationEquations, outputEquations }),
  resetSequential: () =>
    set({
      stateTable: null,
      designedNetlist: null,
      selectedFF: 'D',
      excitationEquations: [],
      outputEquations: [],
    }),
});
