import type { StateCreator } from 'zustand';
import type { TruthTable, Expr } from '../../engine/types';

export type InputSource =
  | { mode: 'expression'; raw: string; vars?: string[] }
  | { mode: 'table'; raw: string; vars?: string[] }
  | { mode: 'minterms'; raw: string; vars?: string[]; dontCares?: string }
  | { mode: 'maxterms'; raw: string; vars?: string[]; dontCares?: string };

export interface InputSlice {
  input: InputSource;
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
  input: { mode: 'expression', raw: "A'B + C" },
  rawInput: "A'B + C",
  inputMode: 'expr',
  truthTable: null,
  parsedExpr: null,
  vars: ['A', 'B', 'C'],
  mintermsStr: '1, 2, 3, 5, 7',
  maxtermsStr: '0, 4, 6',
  dontCaresStr: '',
  setInput: (rawInput, mode) =>
    set((state) => {
      const resolvedMode = mode ?? state.inputMode;
      const sourceMode = resolvedMode === 'expr' ? 'expression' : resolvedMode;
      return {
        rawInput,
        inputMode: resolvedMode,
        input: { mode: sourceMode, raw: rawInput, vars: state.vars },
      };
    }),
  setTruthTable: (truthTable) => set({ truthTable }),
  setParsedExpr: (parsedExpr) => set({ parsedExpr }),
  setVars: (vars) => set({ vars }),
  setMintermsStr: (mintermsStr) =>
    set((state) => ({
      mintermsStr,
      ...(state.input.mode === 'minterms' ? { input: { ...state.input, raw: mintermsStr } } : {}),
    })),
  setMaxtermsStr: (maxtermsStr) =>
    set((state) => ({
      maxtermsStr,
      ...(state.input.mode === 'maxterms' ? { input: { ...state.input, raw: maxtermsStr } } : {}),
    })),
  setDontCaresStr: (dontCaresStr) =>
    set((state) => ({
      dontCaresStr,
      ...((state.input.mode === 'minterms' || state.input.mode === 'maxterms')
        ? { input: { ...state.input, dontCares: dontCaresStr } }
        : {}),
    })),
  resetInput: () =>
    set({
      rawInput: '',
      inputMode: 'expr',
      input: { mode: 'expression', raw: '' },
      truthTable: null,
      parsedExpr: null,
      mintermsStr: '',
      maxtermsStr: '',
      dontCaresStr: '',
    }),
});
