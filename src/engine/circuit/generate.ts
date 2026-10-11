/**
 * LDAM Circuit Engine — Netlist Synthesis & Universal Gate Transformation
 * Synthesizes gate-level Netlists from Boolean expressions or MinResult,
 * supporting fan-in decomposition, inverter sharing, and transformation to
 * strictly NAND-only or strictly NOR-only implementations.
 */

import type { Expr, Netlist, Gate, Node, MinResult } from '../types';
import { collectVars } from '../boolean/evaluator';

export class CombinationalLoopError extends Error {
  cycle: string[];
  constructor(cycle: string[]) {
    super(`Combinational loop detected: ${cycle.join(' -> ')}`);
    this.name = 'CombinationalLoopError';
    this.cycle = cycle;
  }
}

let netCounter = 0;
function newNet(prefix = 'n'): string {
  return `${prefix}_${++netCounter}`;
}

let gateCounter = 0;
function newGateId(type: string): string {
  return `g_${type.toLowerCase()}_${++gateCounter}`;
}

/**
 * Decomposes an array of inputs for a gate into a balanced tree if fan-in exceeds maxFanin.
 */
function decomposeTree(
  type: 'AND' | 'OR' | 'NAND' | 'NOR',
  inputs: string[],
  maxFanin: number,
  nodes: Node[]
): string {
  if (inputs.length <= maxFanin) {
    const outNet = newNet();
    nodes.push({
      kind: 'gate',
      id: newGateId(type),
      type,
      inputs: [...inputs],
      output: outNet,
    });
    return outNet;
  }

  // Balanced tree split
  const mid = Math.ceil(inputs.length / 2);
  const leftInputs = inputs.slice(0, mid);
  const rightInputs = inputs.slice(mid);

  const leftOut = decomposeTree(type, leftInputs, maxFanin, nodes);
  const rightOut = decomposeTree(type, rightInputs, maxFanin, nodes);

  const finalOut = newNet();
  nodes.push({
    kind: 'gate',
    id: newGateId(type),
    type,
    inputs: [leftOut, rightOut],
    output: finalOut,
  });
  return finalOut;
}

/**
 * Synthesizes a gate-level Netlist from an AST expression.
 */
export function exprToNetlist(
  expr: Expr,
  opts?: { name?: string; maxFanin?: number; share?: boolean }
): Netlist {
  const inputs = collectVars(expr);
  const nodes: Node[] = [];
  const inverterMap = new Map<string, string>(); // varName -> inverter output net
  const subtermMap = new Map<string, string>();   // expression key -> output net

  function synthesize(e: Expr): string {
    if (opts?.share) {
      const key = JSON.stringify(e);
      if (subtermMap.has(key)) {
        return subtermMap.get(key)!;
      }
    }

    let outNet = '';

    switch (e.t) {
      case 'var':
        outNet = e.name;
        break;

      case 'const': {
        outNet = newNet('const');
        nodes.push({
          kind: 'const',
          id: `c_${e.v}_${++gateCounter}`,
          value: e.v,
          output: outNet,
        });
        break;
      }

      case 'not': {
        // If child is a variable, check inverter reuse
        if (e.a.t === 'var') {
          if (inverterMap.has(e.a.name)) {
            outNet = inverterMap.get(e.a.name)!;
          } else {
            outNet = newNet(`not_${e.a.name}`);
            nodes.push({
              kind: 'gate',
              id: newGateId('NOT'),
              type: 'NOT',
              inputs: [e.a.name],
              output: outNet,
            });
            inverterMap.set(e.a.name, outNet);
          }
        } else {
          const inNet = synthesize(e.a);
          outNet = newNet('not');
          nodes.push({
            kind: 'gate',
            id: newGateId('NOT'),
            type: 'NOT',
            inputs: [inNet],
            output: outNet,
          });
        }
        break;
      }

      case 'and':
      case 'or': {
        const inNets = e.args.map((arg) => synthesize(arg));
        const gateType = e.t === 'and' ? 'AND' : 'OR';

        if (opts?.maxFanin && inNets.length > opts.maxFanin) {
          outNet = decomposeTree(gateType, inNets, opts.maxFanin, nodes);
        } else {
          outNet = newNet(gateType.toLowerCase());
          nodes.push({
            kind: 'gate',
            id: newGateId(gateType),
            type: gateType,
            inputs: inNets,
            output: outNet,
          });
        }
        break;
      }

      case 'xor':
      case 'xnor': {
        const inNets = e.args.map((arg) => synthesize(arg));
        const gateType = e.t === 'xor' ? 'XOR' : 'XNOR';
        outNet = newNet(gateType.toLowerCase());
        nodes.push({
          kind: 'gate',
          id: newGateId(gateType),
          type: gateType,
          inputs: inNets,
          output: outNet,
        });
        break;
      }
    }

    if (opts?.share) {
      subtermMap.set(JSON.stringify(e), outNet);
    }
    return outNet;
  }

  const finalOutputNet = synthesize(expr);

  return {
    name: opts?.name ?? 'synthesized_circuit',
    inputs,
    outputs: [finalOutputNet],
    nodes,
  };
}

/**
 * Directly maps a minimization result (SOP or POS) to a Netlist.
 */
export function minResultToNetlist(r: MinResult): Netlist {
  return exprToNetlist(r.expr, { name: `min_${r.form.toLowerCase()}` });
}

/**
 * Transforms any combinational Netlist into an equivalent strictly NAND-only Netlist.
 * Eliminates double inversions.
 */
export function toNandOnly(netlist: Netlist): Netlist {
  const newNodes: Node[] = [];
  const aliasMap = new Map<string, string>(); // net aliases from eliminated double inversions

  function resolve(net: string): string {
    return aliasMap.has(net) ? resolve(aliasMap.get(net)!) : net;
  }

  for (const node of netlist.nodes) {
    if (node.kind === 'const') {
      newNodes.push({ ...node });
      continue;
    }

    if (node.kind !== 'gate') {
      newNodes.push(node);
      continue;
    }

    const g = node as Gate;
    const resolvedInputs = g.inputs.map(resolve);

    switch (g.type) {
      case 'NAND':
        newNodes.push({
          kind: 'gate',
          id: newGateId('NAND'),
          type: 'NAND',
          inputs: resolvedInputs,
          output: g.output,
        });
        break;

      case 'BUF': {
        const w = newNet('buf_nand');
        newNodes.push({
          kind: 'gate',
          id: newGateId('NAND'),
          type: 'NAND',
          inputs: [resolvedInputs[0], resolvedInputs[0]],
          output: w,
        });
        newNodes.push({
          kind: 'gate',
          id: newGateId('NAND'),
          type: 'NAND',
          inputs: [w, w],
          output: g.output,
        });
        break;
      }

      case 'NOT': {
        // NOT(A) -> NAND(A, A)
        newNodes.push({
          kind: 'gate',
          id: newGateId('NAND'),
          type: 'NAND',
          inputs: [resolvedInputs[0], resolvedInputs[0]],
          output: g.output,
        });
        break;
      }

      case 'AND': {
        // AND(A, B) -> NAND(A, B) followed by NAND(w, w)
        const w = newNet('and_nand');
        newNodes.push({
          kind: 'gate',
          id: newGateId('NAND'),
          type: 'NAND',
          inputs: resolvedInputs,
          output: w,
        });
        newNodes.push({
          kind: 'gate',
          id: newGateId('NAND'),
          type: 'NAND',
          inputs: [w, w],
          output: g.output,
        });
        break;
      }

      case 'OR': {
        // OR(A, B) -> NAND( NOT(A), NOT(B) )
        // where NOT(x) is NAND(x, x)
        const invertedInputs: string[] = [];
        for (const inp of resolvedInputs) {
          const invNet = newNet('or_inv');
          newNodes.push({
            kind: 'gate',
            id: newGateId('NAND'),
            type: 'NAND',
            inputs: [inp, inp],
            output: invNet,
          });
          invertedInputs.push(invNet);
        }
        newNodes.push({
          kind: 'gate',
          id: newGateId('NAND'),
          type: 'NAND',
          inputs: invertedInputs,
          output: g.output,
        });
        break;
      }

      case 'NOR': {
        // NOR(A, B) -> NOT( OR(A, B) )
        const orOut = newNet('nor_or');
        const invertedInputs: string[] = [];
        for (const inp of resolvedInputs) {
          const invNet = newNet('nor_inv');
          newNodes.push({
            kind: 'gate',
            id: newGateId('NAND'),
            type: 'NAND',
            inputs: [inp, inp],
            output: invNet,
          });
          invertedInputs.push(invNet);
        }
        newNodes.push({
          kind: 'gate',
          id: newGateId('NAND'),
          type: 'NAND',
          inputs: invertedInputs,
          output: orOut,
        });
        newNodes.push({
          kind: 'gate',
          id: newGateId('NAND'),
          type: 'NAND',
          inputs: [orOut, orOut],
          output: g.output,
        });
        break;
      }

      case 'XOR': {
        // Standard 4-NAND implementation of XOR(A, B):
        // N1 = NAND(A, B)
        // N2 = NAND(A, N1)
        // N3 = NAND(B, N1)
        // Y  = NAND(N2, N3)
        if (resolvedInputs.length === 2) {
          const a = resolvedInputs[0];
          const b = resolvedInputs[1];
          const n1 = newNet('xor_n1');
          const n2 = newNet('xor_n2');
          const n3 = newNet('xor_n3');

          newNodes.push({ kind: 'gate', id: newGateId('NAND'), type: 'NAND', inputs: [a, b], output: n1 });
          newNodes.push({ kind: 'gate', id: newGateId('NAND'), type: 'NAND', inputs: [a, n1], output: n2 });
          newNodes.push({ kind: 'gate', id: newGateId('NAND'), type: 'NAND', inputs: [b, n1], output: n3 });
          newNodes.push({ kind: 'gate', id: newGateId('NAND'), type: 'NAND', inputs: [n2, n3], output: g.output });
        }
        break;
      }

      case 'XNOR': {
        // XNOR = XOR followed by inverter
        if (resolvedInputs.length === 2) {
          const a = resolvedInputs[0];
          const b = resolvedInputs[1];
          const n1 = newNet('xnor_n1');
          const n2 = newNet('xnor_n2');
          const n3 = newNet('xnor_n3');
          const xorOut = newNet('xnor_xor');

          newNodes.push({ kind: 'gate', id: newGateId('NAND'), type: 'NAND', inputs: [a, b], output: n1 });
          newNodes.push({ kind: 'gate', id: newGateId('NAND'), type: 'NAND', inputs: [a, n1], output: n2 });
          newNodes.push({ kind: 'gate', id: newGateId('NAND'), type: 'NAND', inputs: [b, n1], output: n3 });
          newNodes.push({ kind: 'gate', id: newGateId('NAND'), type: 'NAND', inputs: [n2, n3], output: xorOut });
          newNodes.push({ kind: 'gate', id: newGateId('NAND'), type: 'NAND', inputs: [xorOut, xorOut], output: g.output });
        }
        break;
      }
    }
  }

  // Inversion Cancellation (Double Inverters)
  const prunedNodes: Node[] = [];
  const singleInverterOutput = new Map<string, string>(); // input -> output for NAND(x, x)

  for (const node of newNodes) {
    if (node.kind === 'gate') {
      const g = node as Gate;
      if (g.type === 'NAND' && g.inputs.length === 2 && g.inputs[0] === g.inputs[1]) {
        const inp = resolve(g.inputs[0]);
        // If input is itself the output of a single inverter, cancel!
        if (singleInverterOutput.has(inp)) {
          const originalInput = singleInverterOutput.get(inp)!;
          aliasMap.set(g.output, originalInput);
          continue; // bypass this gate
        }
        singleInverterOutput.set(g.output, inp);
      }
    }
    prunedNodes.push(node);
  }

  // Remap all node inputs and outputs using aliasMap
  const finalNodes = prunedNodes.map((node) => {
    if (node.kind === 'gate') {
      const g = node as Gate;
      return {
        ...g,
        inputs: g.inputs.map(resolve),
      };
    }
    return node;
  });

  return {
    name: `${netlist.name}_nand`,
    inputs: [...netlist.inputs],
    outputs: netlist.outputs.map(resolve),
    nodes: finalNodes,
  };
}

/**
 * Transforms any combinational Netlist into an equivalent strictly NOR-only Netlist.
 * Eliminates double inversions.
 */
export function toNorOnly(netlist: Netlist): Netlist {
  const newNodes: Node[] = [];
  const aliasMap = new Map<string, string>();

  function resolve(net: string): string {
    return aliasMap.has(net) ? resolve(aliasMap.get(net)!) : net;
  }

  for (const node of netlist.nodes) {
    if (node.kind === 'const') {
      newNodes.push({ ...node });
      continue;
    }

    if (node.kind !== 'gate') {
      newNodes.push(node);
      continue;
    }

    const g = node as Gate;
    const resolvedInputs = g.inputs.map(resolve);

    switch (g.type) {
      case 'NOR':
        newNodes.push({
          kind: 'gate',
          id: newGateId('NOR'),
          type: 'NOR',
          inputs: resolvedInputs,
          output: g.output,
        });
        break;

      case 'BUF': {
        const w = newNet('buf_nor');
        newNodes.push({
          kind: 'gate',
          id: newGateId('NOR'),
          type: 'NOR',
          inputs: [resolvedInputs[0], resolvedInputs[0]],
          output: w,
        });
        newNodes.push({
          kind: 'gate',
          id: newGateId('NOR'),
          type: 'NOR',
          inputs: [w, w],
          output: g.output,
        });
        break;
      }

      case 'NOT': {
        // NOT(A) -> NOR(A, A)
        newNodes.push({
          kind: 'gate',
          id: newGateId('NOR'),
          type: 'NOR',
          inputs: [resolvedInputs[0], resolvedInputs[0]],
          output: g.output,
        });
        break;
      }

      case 'OR': {
        // OR(A, B) -> NOR(A, B) followed by NOR(w, w)
        const w = newNet('or_nor');
        newNodes.push({
          kind: 'gate',
          id: newGateId('NOR'),
          type: 'NOR',
          inputs: resolvedInputs,
          output: w,
        });
        newNodes.push({
          kind: 'gate',
          id: newGateId('NOR'),
          type: 'NOR',
          inputs: [w, w],
          output: g.output,
        });
        break;
      }

      case 'AND': {
        // AND(A, B) -> NOR( NOT(A), NOT(B) )
        const invertedInputs: string[] = [];
        for (const inp of resolvedInputs) {
          const invNet = newNet('and_inv');
          newNodes.push({
            kind: 'gate',
            id: newGateId('NOR'),
            type: 'NOR',
            inputs: [inp, inp],
            output: invNet,
          });
          invertedInputs.push(invNet);
        }
        newNodes.push({
          kind: 'gate',
          id: newGateId('NOR'),
          type: 'NOR',
          inputs: invertedInputs,
          output: g.output,
        });
        break;
      }

      case 'NAND': {
        // NAND(A, B) -> NOT( AND(A, B) )
        const andOut = newNet('nand_and');
        const invertedInputs: string[] = [];
        for (const inp of resolvedInputs) {
          const invNet = newNet('nand_inv');
          newNodes.push({
            kind: 'gate',
            id: newGateId('NOR'),
            type: 'NOR',
            inputs: [inp, inp],
            output: invNet,
          });
          invertedInputs.push(invNet);
        }
        newNodes.push({
          kind: 'gate',
          id: newGateId('NOR'),
          type: 'NOR',
          inputs: invertedInputs,
          output: andOut,
        });
        newNodes.push({
          kind: 'gate',
          id: newGateId('NOR'),
          type: 'NOR',
          inputs: [andOut, andOut],
          output: g.output,
        });
        break;
      }

      case 'XOR':
      case 'XNOR': {
        // 4-NOR implementation of XNOR:
        // N1 = NOR(A, B)
        // N2 = NOR(A, N1)
        // N3 = NOR(B, N1)
        // XNOR = NOR(N2, N3)
        // XOR = NOR(XNOR, XNOR)
        if (resolvedInputs.length === 2) {
          const a = resolvedInputs[0];
          const b = resolvedInputs[1];
          const n1 = newNet('xnor_n1');
          const n2 = newNet('xnor_n2');
          const n3 = newNet('xnor_n3');
          const xnorOut = g.type === 'XNOR' ? g.output : newNet('xor_temp');

          newNodes.push({ kind: 'gate', id: newGateId('NOR'), type: 'NOR', inputs: [a, b], output: n1 });
          newNodes.push({ kind: 'gate', id: newGateId('NOR'), type: 'NOR', inputs: [a, n1], output: n2 });
          newNodes.push({ kind: 'gate', id: newGateId('NOR'), type: 'NOR', inputs: [b, n1], output: n3 });
          newNodes.push({ kind: 'gate', id: newGateId('NOR'), type: 'NOR', inputs: [n2, n3], output: xnorOut });

          if (g.type === 'XOR') {
            newNodes.push({ kind: 'gate', id: newGateId('NOR'), type: 'NOR', inputs: [xnorOut, xnorOut], output: g.output });
          }
        }
        break;
      }
    }
  }

  // Inversion Cancellation (Double Inverters)
  const prunedNodes: Node[] = [];
  const singleInverterOutput = new Map<string, string>(); // input -> output for NOR(x, x)

  for (const node of newNodes) {
    if (node.kind === 'gate') {
      const g = node as Gate;
      if (g.type === 'NOR' && g.inputs.length === 2 && g.inputs[0] === g.inputs[1]) {
        const inp = resolve(g.inputs[0]);
        // If input is itself the output of a single inverter, cancel!
        if (singleInverterOutput.has(inp)) {
          const originalInput = singleInverterOutput.get(inp)!;
          aliasMap.set(g.output, originalInput);
          continue; // bypass this gate
        }
        singleInverterOutput.set(g.output, inp);
      }
    }
    prunedNodes.push(node);
  }

  // Remap
  const finalNodes = prunedNodes.map((node) => {
    if (node.kind === 'gate') {
      const g = node as Gate;
      return {
        ...g,
        inputs: g.inputs.map(resolve),
      };
    }
    return node;
  });

  return {
    name: `${netlist.name}_nor`,
    inputs: [...netlist.inputs],
    outputs: netlist.outputs.map(resolve),
    nodes: finalNodes,
  };
}

