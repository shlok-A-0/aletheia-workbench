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
export function characteristicTable(type: FFType): CharacteristicRow[] {
  const rows: CharacteristicRow[] = [];

  switch (type) {
    case 'SR': {
      // Inputs S, R (2 bits) and current Q (1 bit) -> 8 rows
      for (let s of [0, 1] as (0 | 1)[]) {
        for (let r of [0, 1] as (0 | 1)[]) {
          for (let q of [0, 1] as (0 | 1)[]) {
            let nextQ: 0 | 1 | 'x';
            if (s === 1 && r === 1) {
              nextQ = 'x'; // Invalid state
            } else if (s === 1 && r === 0) {
              nextQ = 1;
            } else if (s === 0 && r === 1) {
              nextQ = 0;
            } else {
              nextQ = q; // Hold
            }
            rows.push({ inputs: { S: s, R: r }, q, nextQ });
          }
        }
      }
      break;
    }

    case 'D': {
      // Input D and current Q -> 4 rows
      for (let d of [0, 1] as (0 | 1)[]) {
        for (let q of [0, 1] as (0 | 1)[]) {
          rows.push({ inputs: { D: d }, q, nextQ: d });
        }
      }
      break;
    }

    case 'JK': {
      // Inputs J, K and current Q -> 8 rows
      for (let j of [0, 1] as (0 | 1)[]) {
        for (let k of [0, 1] as (0 | 1)[]) {
          for (let q of [0, 1] as (0 | 1)[]) {
            let nextQ: 0 | 1;
            if (j === 0 && k === 0) {
              nextQ = q;
            } else if (j === 0 && k === 1) {
              nextQ = 0;
            } else if (j === 1 && k === 0) {
              nextQ = 1;
            } else {
              nextQ = q === 1 ? 0 : 1; // Toggle
            }
            rows.push({ inputs: { J: j, K: k }, q, nextQ });
          }
        }
      }
      break;
    }

    case 'T': {
      // Input T and current Q -> 4 rows
      for (let t of [0, 1] as (0 | 1)[]) {
        for (let q of [0, 1] as (0 | 1)[]) {
          const nextQ = (t ^ q) as 0 | 1;
          rows.push({ inputs: { T: t }, q, nextQ });
        }
      }
      break;
    }
  }

  return rows;
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
    case 'D': {
      const d = inputs.D ?? inputs.d ?? 0;
      return d;
    }
    case 'JK': {
      const j = inputs.J ?? inputs.j ?? 0;
      const k = inputs.K ?? inputs.k ?? 0;
      if (j === 0 && k === 0) return q;
      if (j === 0 && k === 1) return 0;
      if (j === 1 && k === 0) return 1;
      return q === 1 ? 0 : 1;
    }
    case 'T': {
      const t = inputs.T ?? inputs.t ?? 0;
      return (t ^ q) as 0 | 1;
    }
  }
}
