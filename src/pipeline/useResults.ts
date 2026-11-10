import { useMemo } from 'react';
import { useStore } from '../store';
import { verify } from '../engine/circuit/simulate';
import type { Gate, GateType, Netlist } from '../engine/types';
import { outputLabel } from '../ui/schematic/elkLayout';

export type Verdict = 'pending' | 'verified' | 'failed';

export interface Results {
  hasResult: boolean;
  /** Minimised expression, e.g. "A'B + C". */
  formula: string;
  /** Name of the output the formula describes: F, or S for a multi-output design. */
  outputName: string;
  form: 'SOP' | 'POS';
  netlist: Netlist | null;
  gateCount: number;
  gateTypes: Partial<Record<GateType, number>>;
  literals: number | null;
  terms: number | null;
  nandGates: number | null;
  norGates: number | null;
  verdict: Verdict;
  rows: number;
  mismatches: number[];
}

function countGates(netlist: Netlist | null, type?: GateType): number | null {
  if (!netlist) return null;
  const gates = netlist.nodes.filter((n): n is Gate => n.kind === 'gate');
  return type ? gates.filter((g) => g.type === type).length : gates.length;
}

/** Everything the result rail, circuit and verify sections need, derived from the store. */
export function useResults(): Results {
  const truthTable = useStore((s) => s.truthTable);
  const minResult = useStore((s) => s.minResult);
  const netlists = useStore((s) => s.netlists);

  return useMemo<Results>(() => {
    const netlist = netlists.simplified;
    let verdict: Verdict = 'pending';
    let mismatches: number[] = [];
    if (netlist && truthTable) {
      try {
        const result = verify(netlist, truthTable);
        verdict = result.ok ? 'verified' : 'failed';
        mismatches = result.mismatches;
      } catch {
        verdict = 'failed';
      }
    }
    const gateTypes: Partial<Record<GateType, number>> = {};
    for (const n of netlist?.nodes ?? []) {
      if (n.kind === 'gate') gateTypes[n.type] = (gateTypes[n.type] ?? 0) + 1;
    }
    return {
      hasResult: Boolean(netlist && truthTable),
      formula: minResult?.text ?? '',
      outputName: netlist && netlist.outputs.length > 0 ? outputLabel(netlist.outputs[0], 0, netlist.outputs.length) : 'F',
      form: minResult?.form ?? 'SOP',
      netlist,
      gateCount: countGates(netlist) ?? 0,
      gateTypes,
      literals: minResult?.literalCount ?? null,
      terms: minResult?.termCount ?? null,
      nandGates: countGates(netlists.nand),
      norGates: countGates(netlists.nor),
      verdict,
      rows: truthTable?.rows.length ?? 0,
      mismatches,
    };
  }, [truthTable, minResult, netlists]);
}
