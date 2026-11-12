/**
 * Aletheia Circuit Engine — Standard MSI Blocks Library
 * Gate-level synthesizers for common MSI blocks (Multiplexers, Demultiplexers,
 * Decoders, Priority Encoders, Adders, Comparators, BCD-to-7-Segment, and MUX realization).
 */

import type { Netlist, Node, TruthTable, Step } from '../types';
import { quineMcCluskey } from '../minimize/qm';
import { truthTableFromMinterms } from '../boolean/truth-table';
import { exprToNetlist } from './generate';

export interface BlockNameGenerator {
  net(p?: string): string;
  gate(t?: string): string;
}

export function createBlockNameGenerator(): BlockNameGenerator {
  let netCounter = 0;
  let gateCounter = 0;
  return {
    net: (p = 'bn') => `${p}_${++netCounter}`,
    gate: (t = 'g') => `${t.toLowerCase()}_${++gateCounter}`,
  };
}

/**
 * Multiplexer (MUX) with selectBits (1, 2, or 3).
 * Inputs: Select lines (S(k-1)..S0), followed by Data lines (D0..D(2^k - 1)).
 * Output: Y.
 */
export function mux(selectBits: 1 | 2 | 3, names = createBlockNameGenerator()): Netlist {
  const bNet = (p = 'bn') => names.net(p);
  const bGateId = (t = 'g') => names.gate(t);
  const numSelect = selectBits;
  const numData = 1 << numSelect;

  const selectInputs: string[] = [];
  for (let i = numSelect - 1; i >= 0; i--) {
    selectInputs.push(`S${i}`);
  }

  const dataInputs: string[] = [];
  for (let i = 0; i < numData; i++) {
    dataInputs.push(`D${i}`);
  }

  const inputs = [...selectInputs, ...dataInputs];
  const nodes: Node[] = [];

  // Inverters for select lines
  const notS: string[] = [];
  for (let i = 0; i < numSelect; i++) {
    const sName = selectInputs[i];
    const sInv = bNet(`not_${sName}`);
    nodes.push({
      kind: 'gate',
      id: bGateId('NOT'),
      type: 'NOT',
      inputs: [sName],
      output: sInv,
    });
    notS.push(sInv);
  }

  // AND gates for each data line
  const andOutputs: string[] = [];
  for (let d = 0; d < numData; d++) {
    const andInputs: string[] = [dataInputs[d]];
    for (let sIdx = 0; sIdx < numSelect; sIdx++) {
      const bitVal = (d >> (numSelect - 1 - sIdx)) & 1;
      andInputs.push(bitVal === 1 ? selectInputs[sIdx] : notS[sIdx]);
    }
    const andOut = bNet(`mux_and_${d}`);
    nodes.push({
      kind: 'gate',
      id: bGateId('AND'),
      type: 'AND',
      inputs: andInputs,
      output: andOut,
    });
    andOutputs.push(andOut);
  }

  // Final OR gate
  const yOut = 'Y';
  nodes.push({
    kind: 'gate',
    id: bGateId('OR'),
    type: 'OR',
    inputs: andOutputs,
    output: yOut,
  });

  return {
    name: `mux_${numData}_to_1`,
    inputs,
    outputs: [yOut],
    nodes,
  };
}

/**
 * Demultiplexer (DEMUX) with selectBits (1, 2, or 3).
 * Inputs: Data input D, followed by Select lines S(k-1)..S0.
 * Outputs: Y0..Y(2^k - 1).
 */
export function demux(selectBits: 1 | 2 | 3, names = createBlockNameGenerator()): Netlist {
  const bNet = (p = 'bn') => names.net(p);
  const bGateId = (t = 'g') => names.gate(t);
  const numSelect = selectBits;
  const numOutputs = 1 << numSelect;

  const selectInputs: string[] = [];
  for (let i = numSelect - 1; i >= 0; i--) {
    selectInputs.push(`S${i}`);
  }

  const inputs = ['D', ...selectInputs];
  const outputs: string[] = [];
  const nodes: Node[] = [];

  // Inverters for select lines
  const notS: string[] = [];
  for (let i = 0; i < numSelect; i++) {
    const sName = selectInputs[i];
    const sInv = bNet(`not_${sName}`);
    nodes.push({
      kind: 'gate',
      id: bGateId('NOT'),
      type: 'NOT',
      inputs: [sName],
      output: sInv,
    });
    notS.push(sInv);
  }

  // AND gates for each output
  for (let o = 0; o < numOutputs; o++) {
    const outName = `Y${o}`;
    outputs.push(outName);

    const andInputs = ['D'];
    for (let sIdx = 0; sIdx < numSelect; sIdx++) {
      const bitVal = (o >> (numSelect - 1 - sIdx)) & 1;
      andInputs.push(bitVal === 1 ? selectInputs[sIdx] : notS[sIdx]);
    }

    nodes.push({
      kind: 'gate',
      id: bGateId('AND'),
      type: 'AND',
      inputs: andInputs,
      output: outName,
    });
  }

  return {
    name: `demux_1_to_${numOutputs}`,
    inputs,
    outputs,
    nodes,
  };
}

/**
 * n-to-2^n Decoder with Enable line E.
 * Inputs: E (Enable), A(n-1)..A0.
 * Outputs: Y0..Y(2^n - 1).
 */
export function decoder(n: number, names = createBlockNameGenerator()): Netlist {
  const bNet = (p = 'bn') => names.net(p);
  const bGateId = (t = 'g') => names.gate(t);
  const numOutputs = 1 << n;
  const inVars: string[] = [];
  for (let i = n - 1; i >= 0; i--) inVars.push(`A${i}`);

  const inputs = ['E', ...inVars];
  const outputs: string[] = [];
  const nodes: Node[] = [];

  const notA: string[] = [];
  for (let i = 0; i < n; i++) {
    const aName = inVars[i];
    const aInv = bNet(`not_${aName}`);
    nodes.push({
      kind: 'gate',
      id: bGateId('NOT'),
      type: 'NOT',
      inputs: [aName],
      output: aInv,
    });
    notA.push(aInv);
  }

  for (let o = 0; o < numOutputs; o++) {
    const outName = `Y${o}`;
    outputs.push(outName);

    const andInputs = ['E'];
    for (let bit = 0; bit < n; bit++) {
      const bitVal = (o >> (n - 1 - bit)) & 1;
      andInputs.push(bitVal === 1 ? inVars[bit] : notA[bit]);
    }

    nodes.push({
      kind: 'gate',
      id: bGateId('AND'),
      type: 'AND',
      inputs: andInputs,
      output: outName,
    });
  }

  return {
    name: `decoder_${n}_to_${numOutputs}`,
    inputs,
    outputs,
    nodes,
  };
}

/**
 * Standard 2^n to n binary encoder.
 */
export function encoder(n: number, names = createBlockNameGenerator()): Netlist {
  const bGateId = (t = 'g') => names.gate(t);
  const numInputs = 1 << n;
  const inputs: string[] = [];
  for (let i = 0; i < numInputs; i++) inputs.push(`D${i}`);

  const outputs: string[] = [];
  for (let i = n - 1; i >= 0; i--) outputs.push(`Y${i}`);

  const nodes: Node[] = [];

  for (let bit = 0; bit < n; bit++) {
    const orInputs: string[] = [];
    for (let d = 0; d < numInputs; d++) {
      if (((d >> bit) & 1) === 1) {
        orInputs.push(`D${d}`);
      }
    }
    const outName = `Y${bit}`;
    nodes.push({
      kind: 'gate',
      id: bGateId('OR'),
      type: 'OR',
      inputs: orInputs,
      output: outName,
    });
  }

  return {
    name: `encoder_${numInputs}_to_${n}`,
    inputs,
    outputs,
    nodes,
  };
}

/**
 * 4-to-2 Priority Encoder.
 * Inputs: D3, D2, D1, D0 (D3 is highest priority).
 * Outputs: Y1, Y0, V (Valid flag).
 */
export function priorityEncoder(n = 4, names = createBlockNameGenerator()): Netlist {
  const bNet = (p = 'bn') => names.net(p);
  const bGateId = (t = 'g') => names.gate(t);
  if (n !== 4) {
    throw new Error('Priority encoder currently implemented for 4 inputs');
  }

  const inputs = ['D3', 'D2', 'D1', 'D0'];
  const outputs = ['Y1', 'Y0', 'V'];
  const nodes: Node[] = [];

  // V = D3 + D2 + D1 + D0
  nodes.push({
    kind: 'gate',
    id: bGateId('OR'),
    type: 'OR',
    inputs: ['D3', 'D2', 'D1', 'D0'],
    output: 'V',
  });

  // Y1 = D3 + D2
  nodes.push({
    kind: 'gate',
    id: bGateId('OR'),
    type: 'OR',
    inputs: ['D3', 'D2'],
    output: 'Y1',
  });

  // Y0 = D3 + D2' * D1
  const notD2 = bNet('not_D2');
  nodes.push({
    kind: 'gate',
    id: bGateId('NOT'),
    type: 'NOT',
    inputs: ['D2'],
    output: notD2,
  });

  const termD2nD1 = bNet('term_d2n_d1');
  nodes.push({
    kind: 'gate',
    id: bGateId('AND'),
    type: 'AND',
    inputs: [notD2, 'D1'],
    output: termD2nD1,
  });

  nodes.push({
    kind: 'gate',
    id: bGateId('OR'),
    type: 'OR',
    inputs: ['D3', termD2nD1],
    output: 'Y0',
  });

  return {
    name: 'priority_encoder_4_to_2',
    inputs,
    outputs,
    nodes,
  };
}

/**
 * 1-bit Half Adder.
 * S = A ^ B, C = A * B.
 */
export function halfAdder(names = createBlockNameGenerator()): Netlist {
  const bGateId = (t = 'g') => names.gate(t);
  const nodes: Node[] = [
    { kind: 'gate', id: bGateId('XOR'), type: 'XOR', inputs: ['A', 'B'], output: 'S' },
    { kind: 'gate', id: bGateId('AND'), type: 'AND', inputs: ['A', 'B'], output: 'C' },
  ];
  return {
    name: 'half_adder',
    inputs: ['A', 'B'],
    outputs: ['S', 'C'],
    nodes,
  };
}

/**
 * 1-bit Full Adder.
 * S = A ^ B ^ Cin.
 * Cout = AB + Cin(A ^ B).
 */
export function fullAdder(names = createBlockNameGenerator()): Netlist {
  const bNet = (p = 'bn') => names.net(p);
  const bGateId = (t = 'g') => names.gate(t);
  const axorb = bNet('axorb');
  const term1 = bNet('ab');
  const term2 = bNet('cin_axorb');

  const nodes: Node[] = [
    { kind: 'gate', id: bGateId('XOR'), type: 'XOR', inputs: ['A', 'B'], output: axorb },
    { kind: 'gate', id: bGateId('XOR'), type: 'XOR', inputs: [axorb, 'Cin'], output: 'S' },
    { kind: 'gate', id: bGateId('AND'), type: 'AND', inputs: ['A', 'B'], output: term1 },
    { kind: 'gate', id: bGateId('AND'), type: 'AND', inputs: ['Cin', axorb], output: term2 },
    { kind: 'gate', id: bGateId('OR'), type: 'OR', inputs: [term1, term2], output: 'Cout' },
  ];

  return {
    name: 'full_adder',
    inputs: ['A', 'B', 'Cin'],
    outputs: ['S', 'Cout'],
    nodes,
  };
}

/**
 * n-bit Ripple Carry Adder.
 * Adds A(n-1)..A0 and B(n-1)..B0 with carry-out.
 */
export function rippleAdder(bits = 4, names = createBlockNameGenerator()): Netlist {
  const bNet = (p = 'bn') => names.net(p);
  const bGateId = (t = 'g') => names.gate(t);
  const inputs: string[] = [];
  for (let i = bits - 1; i >= 0; i--) inputs.push(`A${i}`);
  for (let i = bits - 1; i >= 0; i--) inputs.push(`B${i}`);

  const outputs: string[] = [];
  for (let i = bits - 1; i >= 0; i--) outputs.push(`S${i}`);
  outputs.push('Cout');

  const nodes: Node[] = [];
  let carryNet = bNet('cin_0');

  // Initial Cin = 0
  nodes.push({
    kind: 'const',
    id: bGateId('c_cin0'),
    value: 0,
    output: carryNet,
  });

  for (let i = 0; i < bits; i++) {
    const a = `A${i}`;
    const b = `B${i}`;
    const s = `S${i}`;
    const nextCarry = i === bits - 1 ? 'Cout' : bNet(`c_${i + 1}`);

    const axorb = bNet(`axorb_${i}`);
    const termAB = bNet(`ab_${i}`);
    const termCin = bNet(`cin_${i}`);

    nodes.push({ kind: 'gate', id: bGateId('XOR'), type: 'XOR', inputs: [a, b], output: axorb });
    nodes.push({ kind: 'gate', id: bGateId('XOR'), type: 'XOR', inputs: [axorb, carryNet], output: s });
    nodes.push({ kind: 'gate', id: bGateId('AND'), type: 'AND', inputs: [a, b], output: termAB });
    nodes.push({ kind: 'gate', id: bGateId('AND'), type: 'AND', inputs: [carryNet, axorb], output: termCin });
    nodes.push({ kind: 'gate', id: bGateId('OR'), type: 'OR', inputs: [termAB, termCin], output: nextCarry });

    carryNet = nextCarry;
  }

  return {
    name: `ripple_adder_${bits}bit`,
    inputs,
    outputs,
    nodes,
  };
}

/**
 * n-bit Magnitude Comparator.
 * Outputs: GT (A > B), EQ (A == B), LT (A < B).
 */
export function comparator(bits = 4, names = createBlockNameGenerator()): Netlist {
  const bNet = (p = 'bn') => names.net(p);
  const bGateId = (t = 'g') => names.gate(t);
  const aInputs: string[] = [];
  const bInputs: string[] = [];
  for (let i = bits - 1; i >= 0; i--) aInputs.push(`A${i}`);
  for (let i = bits - 1; i >= 0; i--) bInputs.push(`B${i}`);

  const inputs = [...aInputs, ...bInputs];
  const outputs = ['GT', 'EQ', 'LT'];
  const nodes: Node[] = [];

  // Bitwise XNOR: eq_i = A_i ~^ B_i
  const bitEq: string[] = [];
  const notB: string[] = [];
  const notA: string[] = [];

  for (let i = 0; i < bits; i++) {
    const eqNet = bNet(`eq_${i}`);
    nodes.push({
      kind: 'gate',
      id: bGateId('XNOR'),
      type: 'XNOR',
      inputs: [`A${i}`, `B${i}`],
      output: eqNet,
    });
    bitEq.push(eqNet);

    const nbNet = bNet(`not_b_${i}`);
    nodes.push({ kind: 'gate', id: bGateId('NOT'), type: 'NOT', inputs: [`B${i}`], output: nbNet });
    notB.push(nbNet);

    const naNet = bNet(`not_a_${i}`);
    nodes.push({ kind: 'gate', id: bGateId('NOT'), type: 'NOT', inputs: [`A${i}`], output: naNet });
    notA.push(naNet);
  }

  // EQ = eq_0 * eq_1 * ... * eq_(n-1)
  nodes.push({
    kind: 'gate',
    id: bGateId('AND'),
    type: 'AND',
    inputs: bitEq,
    output: 'EQ',
  });

  // GT = A(n-1)B'(n-1) + eq(n-1)A(n-2)B'(n-2) + ...
  const gtTerms: string[] = [];
  for (let i = bits - 1; i >= 0; i--) {
    const termInputs: string[] = [`A${i}`, notB[i]];
    for (let j = bits - 1; j > i; j--) {
      termInputs.push(bitEq[j]);
    }
    const tNet = bNet(`gt_term_${i}`);
    nodes.push({ kind: 'gate', id: bGateId('AND'), type: 'AND', inputs: termInputs, output: tNet });
    gtTerms.push(tNet);
  }
  nodes.push({ kind: 'gate', id: bGateId('OR'), type: 'OR', inputs: gtTerms, output: 'GT' });

  // LT = A'(n-1)B(n-1) + eq(n-1)A'(n-2)B(n-2) + ...
  const ltTerms: string[] = [];
  for (let i = bits - 1; i >= 0; i--) {
    const termInputs: string[] = [notA[i], `B${i}`];
    for (let j = bits - 1; j > i; j--) {
      termInputs.push(bitEq[j]);
    }
    const tNet = bNet(`lt_term_${i}`);
    nodes.push({ kind: 'gate', id: bGateId('AND'), type: 'AND', inputs: termInputs, output: tNet });
    ltTerms.push(tNet);
  }
  nodes.push({ kind: 'gate', id: bGateId('OR'), type: 'OR', inputs: ltTerms, output: 'LT' });

  return {
    name: `comparator_${bits}bit`,
    inputs,
    outputs,
    nodes,
  };
}

/**
 * BCD to 7-Segment Decoder.
 * Inputs: B3, B2, B1, B0 (BCD representation 0–9).
 * Outputs: a, b, c, d, e, f, g.
 */
export function bcdTo7Seg(names = createBlockNameGenerator()): Netlist {
  const bNet = (p = 'bn') => names.net(p);
  const bGateId = (t = 'g') => names.gate(t);
  const inputs = ['B3', 'B2', 'B1', 'B0'];
  const outputs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const nodes: Node[] = [];

  // Minterms for 7-segments standard BCD active-high (digits 0–9):
  // 0 -> abcdef, 1 -> bc, 2 -> abdeg, 3 -> abcdg, 4 -> bcfg,
  // 5 -> acdfg, 6 -> acdefg, 7 -> abc, 8 -> abcdefg, 9 -> abcdfg
  const segMinterms: Record<string, number[]> = {
    a: [0, 2, 3, 5, 6, 7, 8, 9],
    b: [0, 1, 2, 3, 4, 7, 8, 9],
    c: [0, 1, 3, 4, 5, 6, 7, 8, 9],
    d: [0, 2, 3, 5, 6, 8, 9],
    e: [0, 2, 6, 8],
    f: [0, 4, 5, 6, 8, 9],
    g: [2, 3, 4, 5, 6, 8, 9],
  };
  const dontCares = [10, 11, 12, 13, 14, 15];

  // Inverters for inputs
  const notB: Record<string, string> = {};
  for (const b of inputs) {
    const nb = bNet(`not_${b}`);
    nodes.push({ kind: 'gate', id: bGateId('NOT'), type: 'NOT', inputs: [b], output: nb });
    notB[b] = nb;
  }

  // Shared product term map: termKey -> output net
  const sharedTermMap = new Map<string, string>();

  function getTermNet(bits: (0 | 1 | '-')[]): string {
    const key = bits.join('');
    if (sharedTermMap.has(key)) {
      return sharedTermMap.get(key)!;
    }

    const termInputs: string[] = [];
    for (let bit = 0; bit < 4; bit++) {
      const bVal = bits[bit];
      const inName = inputs[bit];
      if (bVal === 1) {
        termInputs.push(inName);
      } else if (bVal === 0) {
        termInputs.push(notB[inName]);
      }
    }

    if (termInputs.length === 0) {
      const const1 = bNet('const_1');
      nodes.push({ kind: 'const', id: bGateId('c1'), value: 1, output: const1 });
      sharedTermMap.set(key, const1);
      return const1;
    }

    if (termInputs.length === 1) {
      sharedTermMap.set(key, termInputs[0]);
      return termInputs[0];
    }

    const andOut = bNet(`and_term_${key.replace(/-/g, 'x')}`);
    nodes.push({
      kind: 'gate',
      id: bGateId('AND'),
      type: 'AND',
      inputs: termInputs,
      output: andOut,
    });
    sharedTermMap.set(key, andOut);
    return andOut;
  }

  // Minimize each segment with QM and synthesize with shared terms
  for (const seg of outputs) {
    const tt = truthTableFromMinterms(inputs, segMinterms[seg], dontCares);
    const minRes = quineMcCluskey(tt, 'SOP');

    const orInputs: string[] = [];
    for (const imp of minRes.implicants) {
      orInputs.push(getTermNet(imp.bits));
    }

    if (orInputs.length === 0) {
      nodes.push({ kind: 'const', id: bGateId('c0'), value: 0, output: seg });
    } else if (orInputs.length === 1) {
      nodes.push({
        kind: 'gate',
        id: bGateId('BUF'),
        type: 'BUF',
        inputs: [orInputs[0]],
        output: seg,
      });
    } else {
      nodes.push({
        kind: 'gate',
        id: bGateId('OR'),
        type: 'OR',
        inputs: orInputs,
        output: seg,
      });
    }
  }

  return {
    name: 'bcd_to_7seg',
    inputs,
    outputs,
    nodes,
  };
}

/**
 * Realizes any arbitrary Boolean function using a Multiplexer (Shannon expansion).
 * selectVars: variables chosen as MUX select lines.
 * Data inputs: 0, 1, residual variable, or complemented residual variable.
 */
export function functionWithMux(
  tt: TruthTable,
  selectVars: string[],
  names = createBlockNameGenerator()
): { netlist: Netlist; steps: Step[] } {
  const bNet = (p = 'bn') => names.net(p);
  const bGateId = (t = 'g') => names.gate(t);
  const steps: Step[] = [];
  const allVars = tt.vars;

  for (const sv of selectVars) {
    if (!allVars.includes(sv)) {
      throw new Error(`Select variable '${sv}' is not in truth table variables: ${allVars.join(', ')}`);
    }
  }

  const k = selectVars.length;
  if (k < 1 || k > 3) {
    throw new Error(`functionWithMux supports 1 to 3 select variables, got ${k}`);
  }

  const numDataLines = 1 << k;
  const residualVars = allVars.filter((v) => !selectVars.includes(v));

  steps.push({
    title: 'Shannon Expansion Selection',
    detail: `Selected ${selectVars.join(', ')} as MUX select lines (${k} lines → ${numDataLines}:1 MUX). Residual variables: {${residualVars.join(', ') || 'none'}}.`,
  });

  const muxCircuit = mux(k as 1 | 2 | 3, names);
  const nodes: Node[] = [...muxCircuit.nodes];

  // Inverter map for residual variables
  const invMap = new Map<string, string>();
  function getInv(vName: string): string {
    if (invMap.has(vName)) return invMap.get(vName)!;
    const invNet = bNet(`not_${vName}`);
    nodes.push({
      kind: 'gate',
      id: bGateId('NOT'),
      type: 'NOT',
      inputs: [vName],
      output: invNet,
    });
    invMap.set(vName, invNet);
    return invNet;
  }

  const aliasMap = new Map<string, string>();

  // Map each MUX select line S_i to selectVars
  for (let i = 0; i < k; i++) {
    aliasMap.set(`S${i}`, selectVars[k - 1 - i]);
  }

  // Constants 0 and 1
  const const0 = bNet('const_0');
  const const1 = bNet('const_1');
  nodes.push({ kind: 'const', id: bGateId('c0'), value: 0, output: const0 });
  nodes.push({ kind: 'const', id: bGateId('c1'), value: 1, output: const1 });

  // For each select combination d, evaluate truth values across residual vars
  for (let d = 0; d < numDataLines; d++) {
    // Collect rows in tt where selectVars match d
    const matchingRows = tt.rows.filter((row) => {
      let matches = true;
      for (let sIdx = 0; sIdx < k; sIdx++) {
        const bitVal = (d >> (k - 1 - sIdx)) & 1;
        const vName = selectVars[sIdx];
        const vColIdx = allVars.indexOf(vName);
        if (row.inputs[vColIdx] !== bitVal) {
          matches = false;
          break;
        }
      }
      return matches;
    });

    let assignedNet = const0;
    let label = '0';

    if (residualVars.length === 0) {
      const val = matchingRows[0]?.out === 1 ? 1 : 0;
      assignedNet = val === 1 ? const1 : const0;
      label = val.toString();
    } else {
      const all0 = matchingRows.every((r) => r.out === 0);
      const all1 = matchingRows.every((r) => r.out === 1);

      if (all0) {
        assignedNet = const0;
        label = '0';
      } else if (all1) {
        assignedNet = const1;
        label = '1';
      } else if (residualVars.length === 1) {
        const rName = residualVars[0];
        const rColIdx = allVars.indexOf(rName);
        const outAt0 = matchingRows.find((r) => r.inputs[rColIdx] === 0)?.out;
        const outAt1 = matchingRows.find((r) => r.inputs[rColIdx] === 1)?.out;
        if (outAt0 === 0 && outAt1 === 1) {
          assignedNet = rName;
          label = rName;
        } else if (outAt0 === 1 && outAt1 === 0) {
          assignedNet = getInv(rName);
          label = `${rName}'`;
        }
      } else {
        // >= 2 residual variables: minimize sub-function with QM and synthesize
        const subTT: TruthTable = {
          vars: [...residualVars],
          rows: matchingRows.map((r, idx) => ({
            index: idx,
            inputs: residualVars.map((v) => r.inputs[allVars.indexOf(v)]),
            out: r.out,
          })),
        };
        const minSub = quineMcCluskey(subTT, 'SOP');
        label = minSub.text;

        if (minSub.expr.t === 'var') {
          assignedNet = minSub.expr.name;
        } else if (minSub.expr.t === 'not' && minSub.expr.a.t === 'var') {
          assignedNet = getInv(minSub.expr.a.name);
        } else {
          const subNetlist = exprToNetlist(minSub.expr, { name: `mux_d${d}`, names });
          for (const subNode of subNetlist.nodes) {
            nodes.push(subNode);
          }
          assignedNet = subNetlist.outputs[0];
        }
      }
    }

    aliasMap.set(`D${d}`, assignedNet);
    steps.push({
      title: `Data Input D${d}`,
      detail: `When (${selectVars.join('')} = ${d.toString(2).padStart(k, '0')}), output is ${label}.`,
    });
  }

  // Update nodes with remapped nets
  const remappedNodes = nodes.map((node) => {
    if (node.kind === 'gate') {
      const g = node;
      return {
        ...g,
        inputs: g.inputs.map((inp) => aliasMap.get(inp) ?? inp),
      };
    }
    return node;
  });

  return {
    netlist: {
      name: `func_mux_${numDataLines}to1`,
      inputs: [...allVars],
      outputs: ['Y'],
      nodes: remappedNodes,
    },
    steps,
  };
}

/**
 * Realizes one or more functions of the same variables with ONE shared demultiplexer.
 * The demux data input D is tied to 1 and the variables drive its select lines, so line Yi
 * carries 1 only for input combination i. Each function then ORs the lines of its own minterms,
 * so extra outputs cost one OR gate each instead of a whole extra decoder.
 */
export function functionsWithDemux(
  tts: TruthTable[],
  outputNames: string[] = [],
  names = createBlockNameGenerator()
): { netlist: Netlist; steps: Step[] } {
  if (tts.length === 0) throw new Error('functionsWithDemux needs at least one truth table.');
  const allVars = tts[0].vars;
  const n = allVars.length;
  const numLines = 1 << n;
  const bNet = (p = 'bn') => names.net(p);
  const bGateId = (t = 'g') => names.gate(t);
  const outs = tts.map((_, i) => outputNames[i] ?? (tts.length === 1 ? 'Y' : `Y${i}`));

  const steps: Step[] = [
    {
      title: 'Demultiplexer',
      detail: `One 1-to-${numLines} demux: data input D is tied to 1 and {${allVars.join(', ')}} drive the select lines, so line Yi is 1 only for input combination i.`,
    },
  ];

  const nodes: Node[] = [];
  const d = bNet('demux_D');
  nodes.push({ kind: 'const', id: bGateId('D1'), value: 1, output: d });
  const notVars: string[] = [];
  for (const v of allVars) {
    const inv = bNet(`not_${v}`);
    nodes.push({ kind: 'gate', id: bGateId('NOT'), type: 'NOT', inputs: [v], output: inv });
    notVars.push(inv);
  }
  const lines: string[] = [];
  for (let o = 0; o < numLines; o++) {
    const line = bNet(`dmx_y${o}`);
    lines.push(line);
    const ins = [d];
    for (let bit = 0; bit < n; bit++) {
      ins.push(((o >> (n - 1 - bit)) & 1) === 1 ? allVars[bit] : notVars[bit]);
    }
    nodes.push({ kind: 'gate', id: bGateId('AND'), type: 'AND', inputs: ins, output: line });
  }

  tts.forEach((tt, j) => {
    const minterms = tt.rows.filter((r) => r.out === 1).map((r) => r.index);
    const out = outs[j];
    steps.push({
      title: `Output ${out}`,
      detail: minterms.length === 0
        ? `${out} is identically 0, tied to constant 0.`
        : minterms.length === numLines
          ? `${out} is identically 1, tied to constant 1.`
          : `${out} = OR of lines Y${minterms.join(', Y')}  (Σm(${minterms.join(', ')})).`,
    });
    if (minterms.length === 0) {
      nodes.push({ kind: 'const', id: bGateId('c0'), value: 0, output: out });
    } else if (minterms.length === numLines) {
      nodes.push({ kind: 'const', id: bGateId('c1'), value: 1, output: out });
    } else if (minterms.length === 1) {
      nodes.push({ kind: 'gate', id: bGateId('BUF'), type: 'BUF', inputs: [lines[minterms[0]]], output: out });
    } else {
      nodes.push({ kind: 'gate', id: bGateId('OR'), type: 'OR', inputs: minterms.map((m) => lines[m]), output: out });
    }
  });

  return {
    netlist: { name: `func_demux_1to${numLines}`, inputs: [...allVars], outputs: outs, nodes },
    steps,
  };
}

/**
 * Realizes a function with an active-LOW n-to-2^n decoder (74138 style) plus one gate.
 * Active-low outputs are 0 for the selected line, so:
 *   F = NAND(outputs of the minterms where F=1), or
 *   F = AND(outputs of the minterms where F=0).
 * The side with fewer terms is used, which is what a designer wiring a real 74138 would do.
 */
export function functionWithDecoderNand(
  tt: TruthTable,
  names = createBlockNameGenerator()
): { netlist: Netlist; steps: Step[] } {
  const bNet = (p = 'bn') => names.net(p);
  const bGateId = (t = 'g') => names.gate(t);
  const allVars = tt.vars;
  const n = allVars.length;
  const numOutputs = 1 << n;
  const ones = tt.rows.filter((r) => r.out === 1).map((r) => r.index);
  const zeros = tt.rows.filter((r) => r.out !== 1).map((r) => r.index);
  const useNand = ones.length <= zeros.length;
  const chosen = useNand ? ones : zeros;

  const steps: Step[] = [
    {
      title: 'Active-low decoder',
      detail: `Variables {${allVars.join(', ')}} drive an active-low ${n}-to-${numOutputs} decoder: the selected output goes to 0, all others stay 1.`,
    },
    {
      title: 'Choose the cheaper side',
      detail: useNand
        ? `F=1 on ${ones.length} row(s) and F=0 on ${zeros.length}. Use one NAND over the F=1 outputs: Σm(${ones.join(', ')}).`
        : `F=0 on ${zeros.length} row(s) and F=1 on ${ones.length}. Use one AND over the F=0 outputs: F is 1 unless a zero row is selected, ΠM(${zeros.join(', ')}).`,
    },
  ];

  const nodes: Node[] = [];
  const notVars: string[] = [];
  for (let i = 0; i < n; i++) {
    const inv = bNet(`not_${allVars[i]}`);
    nodes.push({ kind: 'gate', id: bGateId('NOT'), type: 'NOT', inputs: [allVars[i]], output: inv });
    notVars.push(inv);
  }
  const lines: string[] = [];
  for (let o = 0; o < numOutputs; o++) {
    const out = bNet(`dec_n${o}`);
    lines.push(out);
    const ins: string[] = [];
    for (let bit = 0; bit < n; bit++) {
      ins.push(((o >> (n - 1 - bit)) & 1) === 1 ? allVars[bit] : notVars[bit]);
    }
    nodes.push({ kind: 'gate', id: bGateId('NAND'), type: 'NAND', inputs: ins.length > 1 ? ins : [ins[0], ins[0]], output: out });
  }

  const y = 'Y';
  if (ones.length === 0) {
    nodes.push({ kind: 'const', id: bGateId('c0'), value: 0, output: y });
  } else if (zeros.length === 0) {
    nodes.push({ kind: 'const', id: bGateId('c1'), value: 1, output: y });
  } else if (chosen.length === 1) {
    // One active-low line: F=1 rows -> invert it; F=0 rows -> pass it through.
    nodes.push({
      kind: 'gate',
      id: bGateId(useNand ? 'NOT' : 'BUF'),
      type: useNand ? 'NOT' : 'BUF',
      inputs: [lines[chosen[0]]],
      output: y,
    });
  } else {
    nodes.push({
      kind: 'gate',
      id: bGateId(useNand ? 'NAND' : 'AND'),
      type: useNand ? 'NAND' : 'AND',
      inputs: chosen.map((m) => lines[m]),
      output: y,
    });
  }

  return {
    netlist: { name: `func_decoder_nand_${n}to${numOutputs}`, inputs: [...allVars], outputs: [y], nodes },
    steps,
  };
}

/**
 * Realizes any arbitrary Boolean function using an n-to-2^n Decoder + OR gate.
 * Inputs: original variables.
 * Output: Y.
 */
export function functionWithDecoder(
  tt: TruthTable,
  names = createBlockNameGenerator()
): { netlist: Netlist; steps: Step[] } {
  const bNet = (p = 'bn') => names.net(p);
  const bGateId = (t = 'g') => names.gate(t);
  const steps: Step[] = [];
  const allVars = tt.vars;
  const n = allVars.length;
  const numOutputs = 1 << n;

  const minterms = tt.rows.filter((r) => r.out === 1).map((r) => r.index);

  steps.push({
    title: 'Decoder Specification',
    detail: `Input variables {${allVars.join(', ')}} (${n} variables) require an active-high ${n}-to-${numOutputs} decoder.`,
  });
  steps.push({
    title: 'Minterm Collection',
    detail: minterms.length > 0
      ? `Active minterms for F=1: Σm(${minterms.join(', ')}). These decoder outputs feed the output OR gate.`
      : 'Function is identically 0. Output tied to constant 0.',
  });

  const nodes: Node[] = [];

  // Enable constant 1
  const const1 = bNet('enable_1');
  nodes.push({ kind: 'const', id: bGateId('e1'), value: 1, output: const1 });

  // Inverters for input variables
  const notVars: string[] = [];
  for (let i = 0; i < n; i++) {
    const vName = allVars[i];
    const vInv = bNet(`not_${vName}`);
    nodes.push({
      kind: 'gate',
      id: bGateId('NOT'),
      type: 'NOT',
      inputs: [vName],
      output: vInv,
    });
    notVars.push(vInv);
  }

  // Decoder minterm AND gates (each Y_i)
  const decoderOutputs: string[] = [];
  for (let o = 0; o < numOutputs; o++) {
    const outNet = bNet(`dec_m${o}`);
    decoderOutputs.push(outNet);
    const andInputs: string[] = [const1];
    for (let bit = 0; bit < n; bit++) {
      const bitVal = (o >> (n - 1 - bit)) & 1;
      andInputs.push(bitVal === 1 ? allVars[bit] : notVars[bit]);
    }
    nodes.push({
      kind: 'gate',
      id: bGateId('AND'),
      type: 'AND',
      inputs: andInputs,
      output: outNet,
    });
  }

  // Final OR gate or constant
  const yOut = 'Y';
  if (minterms.length === 0) {
    nodes.push({ kind: 'const', id: bGateId('c0'), value: 0, output: yOut });
  } else if (minterms.length === numOutputs) {
    nodes.push({ kind: 'const', id: bGateId('c1'), value: 1, output: yOut });
  } else if (minterms.length === 1) {
    nodes.push({
      kind: 'gate',
      id: bGateId('BUF'),
      type: 'BUF',
      inputs: [decoderOutputs[minterms[0]]],
      output: yOut,
    });
  } else {
    nodes.push({
      kind: 'gate',
      id: bGateId('OR'),
      type: 'OR',
      inputs: minterms.map((m) => decoderOutputs[m]),
      output: yOut,
    });
  }

  return {
    netlist: {
      name: `func_decoder_${n}to${numOutputs}`,
      inputs: [...allVars],
      outputs: [yOut],
      nodes,
    },
    steps,
  };
}
