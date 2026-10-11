/**
 * LDAM Circuit Engine — Standard MSI Blocks Library
 * Gate-level synthesizers for common MSI blocks (Multiplexers, Demultiplexers,
 * Decoders, Priority Encoders, Adders, Comparators, BCD-to-7-Segment, and MUX realization).
 */

import type { Netlist, Node, TruthTable, Step } from '../types';

let blockNetCounter = 0;
function bNet(p = 'bn'): string {
  return `${p}_${++blockNetCounter}`;
}

let blockGateCounter = 0;
function bGateId(t = 'g'): string {
  return `${t.toLowerCase()}_${++blockGateCounter}`;
}

/**
 * Multiplexer (MUX) with selectBits (1, 2, or 3).
 * Inputs: Select lines (S(k-1)..S0), followed by Data lines (D0..D(2^k - 1)).
 * Output: Y.
 */
export function mux(selectBits: 1 | 2 | 3): Netlist {
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
export function demux(selectBits: 1 | 2 | 3): Netlist {
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
export function decoder(n: number): Netlist {
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
export function encoder(n: number): Netlist {
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
export function priorityEncoder(n = 4): Netlist {
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
export function halfAdder(): Netlist {
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
export function fullAdder(): Netlist {
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
export function rippleAdder(bits = 4): Netlist {
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
    id: `c_cin0_${++blockGateCounter}`,
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
export function comparator(bits = 4): Netlist {
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
export function bcdTo7Seg(): Netlist {
  const inputs = ['B3', 'B2', 'B1', 'B0'];
  const outputs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const nodes: Node[] = [];

  // Minterms for 7-segments standard BCD active-high:
  // Digit 0 (0000): a,b,c,d,e,f
  // Digit 1 (0001): b,c
  // Digit 2 (0010): a,b,d,e,g
  // Digit 3 (0011): a,b,c,d,g
  // Digit 4 (0100): b,c,f,g
  // Digit 5 (0101): a,c,d,f,g
  // Digit 6 (0110): a,c,d,e,f,g
  // Digit 7 (0111): a,b,c
  // Digit 8 (1000): a,b,c,d,e,f,g
  // Digit 9 (1001): a,b,c,d,f,g
  const segMinterms: Record<string, number[]> = {
    a: [0, 2, 3, 5, 7, 8, 9],
    b: [0, 1, 2, 3, 4, 7, 8, 9],
    c: [0, 1, 3, 4, 5, 6, 7, 8, 9],
    d: [0, 2, 3, 5, 6, 8, 9],
    e: [0, 2, 6, 8],
    f: [0, 4, 5, 6, 8, 9],
    g: [2, 3, 4, 5, 6, 8, 9],
  };

  const notB: string[] = [];
  for (let i = 0; i < 4; i++) {
    const nb = bNet(`not_b${i}`);
    nodes.push({ kind: 'gate', id: bGateId('NOT'), type: 'NOT', inputs: [`B${i}`], output: nb });
    notB.push(nb);
  }

  // Synthesize each segment as sum of minterms
  for (const seg of outputs) {
    const mList = segMinterms[seg];
    const andTerms: string[] = [];

    for (const m of mList) {
      const termInputs: string[] = [];
      for (let bit = 0; bit < 4; bit++) {
        const val = (m >> (3 - bit)) & 1;
        termInputs.push(val === 1 ? `B${3 - bit}` : notB[3 - bit]);
      }
      const andOut = bNet(`seg_${seg}_m${m}`);
      nodes.push({ kind: 'gate', id: bGateId('AND'), type: 'AND', inputs: termInputs, output: andOut });
      andTerms.push(andOut);
    }

    nodes.push({ kind: 'gate', id: bGateId('OR'), type: 'OR', inputs: andTerms, output: seg });
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
  selectVars: string[]
): { netlist: Netlist; steps: Step[] } {
  const steps: Step[] = [];
  const allVars = tt.vars;
  const residualVars = allVars.filter((v) => !selectVars.includes(v));

  const k = selectVars.length;
  const numDataLines = 1 << k;

  steps.push({
    title: 'Shannon Expansion Selection',
    detail: `Selected ${selectVars.join(', ')} as MUX select lines (${k} lines → ${numDataLines}:1 MUX). Residual variables: {${residualVars.join(', ') || 'none'}}.`,
  });

  const muxCircuit = mux(k as 1 | 2 | 3);
  const nodes: Node[] = [...muxCircuit.nodes];

  // Inverter for residual variable if needed
  let residualNotNet: string | null = null;
  if (residualVars.length === 1) {
    residualNotNet = bNet(`not_${residualVars[0]}`);
    nodes.push({
      kind: 'gate',
      id: bGateId('NOT'),
      type: 'NOT',
      inputs: [residualVars[0]],
      output: residualNotNet,
    });
  }

  const aliasMap = new Map<string, string>();

  // Map each MUX select line S_i to selectVars
  for (let i = 0; i < k; i++) {
    aliasMap.set(`S${i}`, selectVars[k - 1 - i]);
  }

  // Constants 0 and 1
  const const0 = bNet('const_0');
  const const1 = bNet('const_1');
  nodes.push({ kind: 'const', id: `c0_${++blockGateCounter}`, value: 0, output: const0 });
  nodes.push({ kind: 'const', id: `c1_${++blockGateCounter}`, value: 1, output: const1 });

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
    } else if (residualVars.length === 1) {
      const rName = residualVars[0];
      const rColIdx = allVars.indexOf(rName);

      const outAt0 = matchingRows.find((r) => r.inputs[rColIdx] === 0)?.out;
      const outAt1 = matchingRows.find((r) => r.inputs[rColIdx] === 1)?.out;

      if (outAt0 === 0 && outAt1 === 0) {
        assignedNet = const0;
        label = '0';
      } else if (outAt0 === 1 && outAt1 === 1) {
        assignedNet = const1;
        label = '1';
      } else if (outAt0 === 0 && outAt1 === 1) {
        assignedNet = rName;
        label = rName;
      } else if (outAt0 === 1 && outAt1 === 0) {
        assignedNet = residualNotNet!;
        label = `${rName}'`;
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
