/**
 * LDAM Sequential Engine — Standard Sequential Circuits Library
 * Gate/Flip-flop level synthesizers for standard sequential building blocks:
 * Synchronous/Asynchronous Counters, Mod-N Counters, Ring & Johnson Counters,
 * Shift Registers (SISO, SIPO, PISO, Universal), and unused state analysis.
 */

import type { Netlist, Node, FlipFlop } from '../types';
import { stepClock } from './simulate-seq';

let seqNetCounter = 0;
function sNet(prefix = 'sn'): string {
  return `${prefix}_${++seqNetCounter}`;
}

let seqIdCounter = 0;
function sId(t = 'node'): string {
  return `${t}_${++seqIdCounter}`;
}

/**
 * Synchronous Binary Counter (2, 3, or 4 bits).
 * Generates an up or up/down counter using T or JK flip-flops.
 */
export function syncCounter(
  bits = 3,
  dir: 'up' | 'down' = 'up',
  ffType: 'T' | 'JK' = 'T'
): Netlist {
  const inputs: string[] = ['CLK'];
  const outputs: string[] = [];
  for (let i = bits - 1; i >= 0; i--) outputs.push(`Q${i}`);

  const nodes: Node[] = [];
  const const1 = sNet('const_1');
  nodes.push({ kind: 'const', id: sId('c1'), value: 1, output: const1 });

  // T0 / (J0, K0) is always 1
  if (ffType === 'T') {
    nodes.push({
      kind: 'ff',
      id: sId('ff_0'),
      type: 'T',
      edge: 'rising',
      clk: 'CLK',
      t: const1,
      q: 'Q0',
      qn: sNet('qn0'),
      init: 0,
    });
  } else {
    nodes.push({
      kind: 'ff',
      id: sId('ff_0'),
      type: 'JK',
      edge: 'rising',
      clk: 'CLK',
      j: const1,
      k: const1,
      q: 'Q0',
      qn: sNet('qn0'),
      init: 0,
    });
  }

  let prevTerm = dir === 'up' ? 'Q0' : sNet('qn0');

  for (let i = 1; i < bits; i++) {
    const qName = `Q${i}`;
    const qnName = sNet(`qn${i}`);
    const tNet = i === 1 ? prevTerm : sNet(`t_${i}`);

    if (i > 1) {
      // AND with previous stage output
      const trigger = dir === 'up' ? `Q${i - 1}` : sNet(`qn${i - 1}`);
      nodes.push({
        kind: 'gate',
        id: sId('AND'),
        type: 'AND',
        inputs: [prevTerm, trigger],
        output: tNet,
      });
      prevTerm = tNet;
    }

    if (ffType === 'T') {
      nodes.push({
        kind: 'ff',
        id: sId(`ff_${i}`),
        type: 'T',
        edge: 'rising',
        clk: 'CLK',
        t: tNet,
        q: qName,
        qn: qnName,
        init: 0,
      });
    } else {
      nodes.push({
        kind: 'ff',
        id: sId(`ff_${i}`),
        type: 'JK',
        edge: 'rising',
        clk: 'CLK',
        j: tNet,
        k: tNet,
        q: qName,
        qn: qnName,
        init: 0,
      });
    }
  }

  return {
    name: `sync_counter_${bits}bit_${dir}_${ffType.toLowerCase()}`,
    inputs,
    outputs,
    clock: 'CLK',
    nodes,
  };
}

/**
 * Mod-N Counter (N = 3..15) with synchronous/asynchronous clear return-to-zero logic.
 */
export function modNCounter(n: number): Netlist {
  const bits = Math.ceil(Math.log2(n));
  const inputs: string[] = ['CLK'];
  const outputs: string[] = [];
  for (let i = bits - 1; i >= 0; i--) outputs.push(`Q${i}`);

  const nodes: Node[] = [];
  const const1 = sNet('const_1');
  const const0 = sNet('const_0');
  nodes.push({ kind: 'const', id: sId('c1'), value: 1, output: const1 });
  nodes.push({ kind: 'const', id: sId('c0'), value: 0, output: const0 });

  // When counter reaches N - 1 (or N for async clear), detect condition
  // Standard LDAM synchronous Mod-N: next state is (Q + 1) mod N.
  // D flip-flops: D_i = nextStateFunction(Q).
  const numStates = 1 << bits;

  for (let bit = 0; bit < bits; bit++) {
    // Collect minterms of Q where next state bit is 1
    const activeMinterms: number[] = [];
    for (let s = 0; s < numStates; s++) {
      let nextS = s < n ? (s + 1) % n : 0; // Unused states wrap to 0 (self-starting)
      if (((nextS >> bit) & 1) === 1) {
        activeMinterms.push(s);
      }
    }

    let dNet = const0;

    if (activeMinterms.length > 0) {
      const orInputs: string[] = [];
      for (const m of activeMinterms) {
        const andInputs: string[] = [];
        for (let b = 0; b < bits; b++) {
          const bitVal = (m >> b) & 1;
          const qName = `Q${b}`;
          if (bitVal === 1) {
            andInputs.push(qName);
          } else {
            const notQ = sNet(`not_${qName}_m${m}`);
            nodes.push({ kind: 'gate', id: sId('NOT'), type: 'NOT', inputs: [qName], output: notQ });
            andInputs.push(notQ);
          }
        }
        const termNet = sNet(`m_${m}_bit${bit}`);
        nodes.push({ kind: 'gate', id: sId('AND'), type: 'AND', inputs: andInputs, output: termNet });
        orInputs.push(termNet);
      }

      dNet = sNet(`d_${bit}`);
      nodes.push({ kind: 'gate', id: sId('OR'), type: 'OR', inputs: orInputs, output: dNet });
    }

    nodes.push({
      kind: 'ff',
      id: sId(`ff_${bit}`),
      type: 'D',
      edge: 'rising',
      clk: 'CLK',
      d: dNet,
      q: `Q${bit}`,
      qn: sNet(`qn${bit}`),
      init: 0,
    });
  }

  return {
    name: `mod_${n}_counter`,
    inputs,
    outputs,
    clock: 'CLK',
    nodes,
  };
}

/**
 * Ring Counter (n bits).
 * Circulates a single '1' bit through a ring shift register.
 */
export function ringCounter(bits = 4): Netlist {
  const inputs = ['CLK'];
  const outputs: string[] = [];
  for (let i = bits - 1; i >= 0; i--) outputs.push(`Q${i}`);

  const nodes: Node[] = [];

  for (let i = 0; i < bits; i++) {
    const qName = `Q${i}`;
    const prevQ = i === 0 ? `Q${bits - 1}` : `Q${i - 1}`;
    nodes.push({
      kind: 'ff',
      id: sId(`ff_ring_${i}`),
      type: 'D',
      edge: 'rising',
      clk: 'CLK',
      d: prevQ,
      q: qName,
      qn: sNet(`qn${i}`),
      init: i === 0 ? 1 : 0, // Starts at 00...01
    });
  }

  return {
    name: `ring_counter_${bits}bit`,
    inputs,
    outputs,
    clock: 'CLK',
    nodes,
  };
}

/**
 * Johnson Counter (Twisted Ring Counter, n bits).
 * MSB receives the complement of LSB: Q(n-1) <= ~Q(0), Q(i) <= Q(i+1).
 * Cycles through 2*n states (e.g., 3-bit: 000, 100, 110, 111, 011, 001).
 */
export function johnsonCounter(bits = 3): Netlist {
  const inputs = ['CLK'];
  const outputs: string[] = [];
  for (let i = bits - 1; i >= 0; i--) outputs.push(`Q${i}`);

  const nodes: Node[] = [];

  // Complement of Q0 is fed into MSB (Q_(bits-1))
  const notQ0 = sNet('not_Q0');
  nodes.push({ kind: 'gate', id: sId('NOT'), type: 'NOT', inputs: ['Q0'], output: notQ0 });

  for (let i = 0; i < bits; i++) {
    const qName = `Q${i}`;
    // Left-shift Johnson: Q_(bits-1) gets notQ0, Q_(i) gets Q_(i+1)
    const nextD = i === bits - 1 ? notQ0 : `Q${i + 1}`;
    nodes.push({
      kind: 'ff',
      id: sId(`ff_johnson_${i}`),
      type: 'D',
      edge: 'rising',
      clk: 'CLK',
      d: nextD,
      q: qName,
      qn: sNet(`qn${i}`),
      init: 0,
    });
  }

  return {
    name: `johnson_counter_${bits}bit`,
    inputs,
    outputs,
    clock: 'CLK',
    nodes,
  };
}

/**
 * Shift Register (SISO, SIPO, PISO, PIPO, Universal).
 */
export function shiftRegister(
  type: 'SISO' | 'SIPO' | 'PISO' | 'universal',
  bits = 4
): Netlist {
  const nodes: Node[] = [];

  switch (type) {
    case 'SISO': {
      // Inputs: CLK, Din. Output: Dout (Q_(bits-1))
      for (let i = 0; i < bits; i++) {
        const nextD = i === 0 ? 'Din' : `Q${i - 1}`;
        nodes.push({
          kind: 'ff',
          id: sId(`ff_siso_${i}`),
          type: 'D',
          edge: 'rising',
          clk: 'CLK',
          d: nextD,
          q: `Q${i}`,
          qn: sNet(`qn${i}`),
          init: 0,
        });
      }
      return {
        name: `shift_register_siso_${bits}bit`,
        inputs: ['CLK', 'Din'],
        outputs: [`Q${bits - 1}`],
        clock: 'CLK',
        nodes,
      };
    }

    case 'SIPO': {
      // Inputs: CLK, Din. Outputs: Q0..Q(bits-1)
      const outputs: string[] = [];
      for (let i = bits - 1; i >= 0; i--) outputs.push(`Q${i}`);

      for (let i = 0; i < bits; i++) {
        const nextD = i === 0 ? 'Din' : `Q${i - 1}`;
        nodes.push({
          kind: 'ff',
          id: sId(`ff_sipo_${i}`),
          type: 'D',
          edge: 'rising',
          clk: 'CLK',
          d: nextD,
          q: `Q${i}`,
          qn: sNet(`qn${i}`),
          init: 0,
        });
      }
      return {
        name: `shift_register_sipo_${bits}bit`,
        inputs: ['CLK', 'Din'],
        outputs,
        clock: 'CLK',
        nodes,
      };
    }

    case 'PISO': {
      // Inputs: CLK, LOAD, D0..D(bits-1), Din (serial in)
      const inputs = ['CLK', 'LOAD'];
      for (let i = 0; i < bits; i++) inputs.push(`D${i}`);

      const notLoad = sNet('not_load');
      nodes.push({ kind: 'gate', id: sId('NOT'), type: 'NOT', inputs: ['LOAD'], output: notLoad });

      for (let i = 0; i < bits; i++) {
        const loadTerm = sNet(`load_d${i}`);
        const shiftTerm = sNet(`shift_d${i}`);
        const combinedD = sNet(`d_in_${i}`);

        // LOAD * D_i
        nodes.push({ kind: 'gate', id: sId('AND'), type: 'AND', inputs: ['LOAD', `D${i}`], output: loadTerm });

        // notLoad * ShiftIn
        const shiftIn = i === 0 ? sNet('c0') : `Q${i - 1}`;
        if (i === 0) {
          nodes.push({ kind: 'const', id: sId('c0'), value: 0, output: shiftIn });
        }
        nodes.push({ kind: 'gate', id: sId('AND'), type: 'AND', inputs: [notLoad, shiftIn], output: shiftTerm });

        // Combined D = loadTerm + shiftTerm
        nodes.push({ kind: 'gate', id: sId('OR'), type: 'OR', inputs: [loadTerm, shiftTerm], output: combinedD });

        nodes.push({
          kind: 'ff',
          id: sId(`ff_piso_${i}`),
          type: 'D',
          edge: 'rising',
          clk: 'CLK',
          d: combinedD,
          q: `Q${i}`,
          qn: sNet(`qn${i}`),
          init: 0,
        });
      }

      return {
        name: `shift_register_piso_${bits}bit`,
        inputs,
        outputs: [`Q${bits - 1}`],
        clock: 'CLK',
        nodes,
      };
    }

    case 'universal': {
      // 4-bit Universal Shift Register: Mode S1, S0 (00=Hold, 01=Shift-Right, 10=Shift-Left, 11=Parallel Load)
      const inputs = ['CLK', 'S1', 'S0', 'SR_IN', 'SL_IN'];
      for (let i = 0; i < bits; i++) inputs.push(`D${i}`);

      const outputs: string[] = [];
      for (let i = bits - 1; i >= 0; i--) outputs.push(`Q${i}`);

      const notS1 = sNet('not_s1');
      const notS0 = sNet('not_s0');
      nodes.push({ kind: 'gate', id: sId('NOT'), type: 'NOT', inputs: ['S1'], output: notS1 });
      nodes.push({ kind: 'gate', id: sId('NOT'), type: 'NOT', inputs: ['S0'], output: notS0 });

      for (let i = 0; i < bits; i++) {
        // 4 MUX AND-terms
        const t0 = sNet(`t0_${i}`); // Hold: Q_i
        const t1 = sNet(`t1_${i}`); // Shift-Right: Q_(i-1) or SR_IN
        const t2 = sNet(`t2_${i}`); // Shift-Left: Q_(i+1) or SL_IN
        const t3 = sNet(`t3_${i}`); // Parallel Load: D_i

        const inRight = i === 0 ? 'SR_IN' : `Q${i - 1}`;
        const inLeft = i === bits - 1 ? 'SL_IN' : `Q${i + 1}`;

        nodes.push({ kind: 'gate', id: sId('AND'), type: 'AND', inputs: [notS1, notS0, `Q${i}`], output: t0 });
        nodes.push({ kind: 'gate', id: sId('AND'), type: 'AND', inputs: [notS1, 'S0', inRight], output: t1 });
        nodes.push({ kind: 'gate', id: sId('AND'), type: 'AND', inputs: ['S1', notS0, inLeft], output: t2 });
        nodes.push({ kind: 'gate', id: sId('AND'), type: 'AND', inputs: ['S1', 'S0', `D${i}`], output: t3 });

        const dIn = sNet(`d_${i}`);
        nodes.push({ kind: 'gate', id: sId('OR'), type: 'OR', inputs: [t0, t1, t2, t3], output: dIn });

        nodes.push({
          kind: 'ff',
          id: sId(`ff_uni_${i}`),
          type: 'D',
          edge: 'rising',
          clk: 'CLK',
          d: dIn,
          q: `Q${i}`,
          qn: sNet(`qn${i}`),
          init: 0,
        });
      }

      return {
        name: `universal_shift_register_${bits}bit`,
        inputs,
        outputs,
        clock: 'CLK',
        nodes,
      };
    }
  }
}

/**
 * Evaluates unused states of a sequential circuit (e.g. Mod-N counter).
 * Detects whether unused states enter the valid state sequence (self-starting).
 */
export function analyzeUnusedStates(
  netlist: Netlist,
  validStates: string[]
): { unused: string[]; selfStarting: boolean; nextStates: Record<string, string> } {
  const flops = netlist.nodes.filter((n) => n.kind === 'ff') as FlipFlop[];
  const numFlops = flops.length;
  const totalStates = 1 << numFlops;

  const validSet = new Set(validStates);
  const unused: string[] = [];
  const nextStates: Record<string, string> = {};

  // Map all possible binary state vectors
  for (let code = 0; code < totalStates; code++) {
    const bitStr = code.toString(2).padStart(numFlops, '0');
    if (!validSet.has(bitStr)) {
      unused.push(bitStr);
    }

    // Prepare state mapping: Q(numFlops - 1) .. Q0
    const stateObj: Record<string, 0 | 1> = {};
    for (let bit = 0; bit < numFlops; bit++) {
      const qVal = ((code >> bit) & 1) as 0 | 1;
      stateObj[`Q${bit}`] = qVal;
    }

    // Step clock with all inputs 0
    const zeroInputs: Record<string, 0 | 1> = {};
    for (const inp of netlist.inputs) {
      if (inp !== 'CLK') zeroInputs[inp] = 0;
    }

    const { state: nextStateObj } = stepClock(netlist, stateObj, zeroInputs);

    let nextCode = 0;
    for (let bit = 0; bit < numFlops; bit++) {
      const val = nextStateObj[`Q${bit}`] ?? 0;
      nextCode |= val << bit;
    }
    nextStates[bitStr] = nextCode.toString(2).padStart(numFlops, '0');
  }

  // Check if every unused state eventually enters validSet within totalStates steps
  let selfStarting = true;
  for (const startState of unused) {
    let curr = startState;
    let entersValid = false;
    for (let step = 0; step < totalStates; step++) {
      curr = nextStates[curr];
      if (validSet.has(curr)) {
        entersValid = true;
        break;
      }
    }
    if (!entersValid) {
      selfStarting = false;
      break;
    }
  }

  return {
    unused,
    selfStarting,
    nextStates,
  };
}
