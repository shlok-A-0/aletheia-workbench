/**
 * LDAM Sequential Engine — Flip-Flop Models & Tables
 * Implements characteristic & excitation tables, characteristic equations,
 * and next-state transition logic for SR, D, JK, and T flip-flops.
 */

import type { FFType } from '../types';

export interface CharacteristicRow {
  inputs: Record<string, 0 | 1>;
  q: 0 | 1;
  nextQ: 0 | 1 | 'x';
}

export interface ExcitationRow {
  q: 0 | 1;
  nextQ: 0 | 1;
  inputs: Record<string, 0 | 1 | 'x'>;
}

/**
 * Returns the characteristic equation for a flip-flop type as standard text.
 */
export function characteristicEquation(type: FFType): string {
  switch (type) {
    case 'SR':
      return "Q+ = S + R'Q (with S·R = 0)";
    case 'D':
      return 'Q+ = D';
    case 'JK':
      return "Q+ = JQ' + K'Q";
    case 'T':
      return 'Q+ = T ⊕ Q';
  }
}

/**
 * Returns the complete characteristic table for a flip-flop type.
 */
const INPUT_COMBOS: Record<FFType, Record<string, 0 | 1>[]> = {
  SR: [{ S: 0, R: 0 }, { S: 0, R: 1 }, { S: 1, R: 0 }, { S: 1, R: 1 }],
  D: [{ D: 0 }, { D: 1 }],
  JK: [{ J: 0, K: 0 }, { J: 0, K: 1 }, { J: 1, K: 0 }, { J: 1, K: 1 }],
  T: [{ T: 0 }, { T: 1 }],
};

/**
 * Evaluates the next output state Q+ for a flip-flop given current Q and synchronous inputs.
 */
export function nextQ(
  type: FFType,
  q: 0 | 1,
  inputs: Record<string, 0 | 1>
): 0 | 1 | 'x' {
  switch (type) {
    case 'SR': {
      const s = inputs.S ?? inputs.s ?? 0;
      const r = inputs.R ?? inputs.r ?? 0;
      if (s === 1 && r === 1) return 'x';
      if (s === 1) return 1;
      if (r === 1) return 0;
      return q;
    }
    case 'D':
      return inputs.D ?? inputs.d ?? 0;
    case 'JK': {
      const j = inputs.J ?? inputs.j ?? 0;
      const k = inputs.K ?? inputs.k ?? 0;
      return ((j & (1 - q)) | ((1 - k) & q)) as 0 | 1;
    }
    case 'T': {
      const t = inputs.T ?? inputs.t ?? 0;
      return (t ^ q) as 0 | 1;
    }
  }
}

/**
 * Returns the complete characteristic table for a flip-flop type.
 */
export function characteristicTable(type: FFType): CharacteristicRow[] {
  return INPUT_COMBOS[type].flatMap((inputs) =>
    ([0, 1] as const).map((q) => ({ inputs, q, nextQ: nextQ(type, q, inputs) }))
  );
}

/**
 * Returns the excitation table for a flip-flop type across all Q -> Q+ transitions.
 */
export function excitationTable(type: FFType): ExcitationRow[] {
  switch (type) {
    case 'SR':
      return [
        { q: 0, nextQ: 0, inputs: { S: 0, R: 'x' } },
        { q: 0, nextQ: 1, inputs: { S: 1, R: 0 } },
        { q: 1, nextQ: 0, inputs: { S: 0, R: 1 } },
        { q: 1, nextQ: 1, inputs: { S: 'x', R: 0 } },
      ];

    case 'D':
      return [
        { q: 0, nextQ: 0, inputs: { D: 0 } },
        { q: 0, nextQ: 1, inputs: { D: 1 } },
        { q: 1, nextQ: 0, inputs: { D: 0 } },
        { q: 1, nextQ: 1, inputs: { D: 1 } },
      ];

    case 'JK':
      return [
        { q: 0, nextQ: 0, inputs: { J: 0, K: 'x' } },
        { q: 0, nextQ: 1, inputs: { J: 1, K: 'x' } },
        { q: 1, nextQ: 0, inputs: { J: 'x', K: 1 } },
        { q: 1, nextQ: 1, inputs: { J: 'x', K: 0 } },
      ];

    case 'T':
      return [
        { q: 0, nextQ: 0, inputs: { T: 0 } },
        { q: 0, nextQ: 1, inputs: { T: 1 } },
        { q: 1, nextQ: 0, inputs: { T: 1 } },
        { q: 1, nextQ: 1, inputs: { T: 0 } },
      ];
  }
}
