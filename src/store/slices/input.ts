import type { StateCreator } from 'zustand';
import type { TruthTable, Expr } from '../../engine/types';

export interface InputSlice {
  rawInput: string;
  inputMode: 'expr' | 'minterms' | 'maxterms' | 'table';
  truthTable: TruthTable | null;
  parsedExpr: Expr | null;
  vars: string[];
  mintermsStr: string;
  maxtermsStr: string;
  dontCaresStr: string;
  setInput: (rawInput: string, mode?: 'expr' | 'minterms' | 'maxterms' | 'table') => void;
  setTruthTable: (truthTable: TruthTable | null) => void;
  setParsedExpr: (expr: Expr | null) => void;
  setVars: (vars: string[]) => void;
  setMintermsStr: (s: string) => void;
  setMaxtermsStr: (s: string) => void;
  setDontCaresStr: (s: string) => void;
  resetInput: () => void;
}

export const createInputSlice: StateCreator<InputSlice, [], [], InputSlice> = (set) => ({
  rawInput: "A'B + C",
  inputMode: 'expr',
  truthTable: null,
  parsedExpr: null,
  vars: ['A', 'B', 'C'],
  mintermsStr: '1, 2, 3, 5, 7',
  maxtermsStr: '0, 4, 6',
  dontCaresStr: '',
  setInput: (rawInput, mode) =>
    set((state) => ({
      rawInput,
      inputMode: mode ?? state.inputMode,
    })),
  setTruthTable: (truthTable) => set({ truthTable }),
  setParsedExpr: (parsedExpr) => set({ parsedExpr }),
  setVars: (vars) => set({ vars }),
  setMintermsStr: (mintermsStr) => set({ mintermsStr }),
  setMaxtermsStr: (maxtermsStr) => set({ maxtermsStr }),
  setDontCaresStr: (dontCaresStr) => set({ dontCaresStr }),
  resetInput: () =>
    set({
      rawInput: '',
      truthTable: null,
      parsedExpr: null,
      mintermsStr: '',
      maxtermsStr: '',
      dontCaresStr: '',
    }),
});
