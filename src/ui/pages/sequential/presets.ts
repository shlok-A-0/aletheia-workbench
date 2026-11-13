import type { StateTable } from '../../../engine/types';

export const PRESET_FSMS: { name: string; st: StateTable }[] = [
  {
    name: '1011 Sequence Detector (Mealy)',
    st: {
      model: 'mealy',
      inputs: ['X'],
      outputs: ['Z'],
      states: ['S0', 'S1', 'S2', 'S3'],
      reset: 'S0',
      rows: [
        { state: 'S0', input: '0', next: 'S0', output: '0' },
        { state: 'S0', input: '1', next: 'S1', output: '0' },
        { state: 'S1', input: '0', next: 'S2', output: '0' },
        { state: 'S1', input: '1', next: 'S1', output: '0' },
        { state: 'S2', input: '0', next: 'S0', output: '0' },
        { state: 'S2', input: '1', next: 'S3', output: '0' },
        { state: 'S3', input: '0', next: 'S2', output: '0' },
        { state: 'S3', input: '1', next: 'S1', output: '1' },
      ],
    },
  },
  {
    name: 'Modulo-4 Up Counter (Moore)',
    st: {
      model: 'moore',
      inputs: ['EN'],
      outputs: ['Q1', 'Q0'],
      states: ['A', 'B', 'C', 'D'],
      reset: 'A',
      rows: [
        { state: 'A', input: '0', next: 'A', output: '00' },
        { state: 'A', input: '1', next: 'B', output: '00' },
        { state: 'B', input: '0', next: 'B', output: '01' },
        { state: 'B', input: '1', next: 'C', output: '01' },
        { state: 'C', input: '0', next: 'C', output: '10' },
        { state: 'C', input: '1', next: 'D', output: '10' },
        { state: 'D', input: '0', next: 'D', output: '11' },
        { state: 'D', input: '1', next: 'A', output: '11' },
      ],
    },
  },
  {
    name: 'Reducible 5-State Machine',
    st: {
      model: 'mealy',
      inputs: ['X'],
      outputs: ['Z'],
      states: ['S0', 'S1', 'S2', 'S3', 'S4'],
      reset: 'S0',
      rows: [
        { state: 'S0', input: '0', next: 'S1', output: '0' },
        { state: 'S0', input: '1', next: 'S2', output: '0' },
        { state: 'S1', input: '0', next: 'S3', output: '0' },
        { state: 'S1', input: '1', next: 'S4', output: '1' },
        { state: 'S2', input: '0', next: 'S3', output: '0' },
        { state: 'S2', input: '1', next: 'S4', output: '1' }, // S1 & S2 equivalent!
        { state: 'S3', input: '0', next: 'S0', output: '0' },
        { state: 'S3', input: '1', next: 'S0', output: '0' },
        { state: 'S4', input: '0', next: 'S0', output: '1' },
        { state: 'S4', input: '1', next: 'S0', output: '1' },
      ],
    },
  },
];

/* ────────────────────── State Diagram SVG Component ────────────────────── */

