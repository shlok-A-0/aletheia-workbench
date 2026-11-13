import type { DesignContext, Netlist } from '../engine/types';
import { mintermsOf, maxtermsOf, dontCaresOf } from '../engine/boolean/truth-table';
import { pathDepth } from '../engine/circuit/simulate';
import type { RootStore } from '../store';

function parseTerms(value: string): number[] {
  return value.split(/[,\s]+/)
    .filter((term) => /^\d+$/.test(term))
    .map(Number)
    .slice(0, 32);
}

function gateLevelCount(netlist: Netlist): number {
  return pathDepth(netlist) ?? 0;
}

export function buildContext(state: RootStore, page: string): DesignContext {
  const context: DesignContext = { page: page.slice(0, 120) };
  if (state.truthTable) {
    context.function = {
      vars: state.truthTable.vars.slice(0, 8),
      minterms: mintermsOf(state.truthTable).slice(0, 32),
      maxterms: maxtermsOf(state.truthTable).slice(0, 32),
      dontCares: dontCaresOf(state.truthTable).slice(0, 32),
      ...(state.inputMode === 'expr' ? { expr: state.rawInput.slice(0, 200) } : {}),
    };
  } else if (state.rawInput.trim()) {
    context.function = {
      vars: state.vars.slice(0, 8),
      minterms: state.inputMode === 'minterms' ? parseTerms(state.mintermsStr) : [],
      maxterms: state.inputMode === 'maxterms' ? parseTerms(state.maxtermsStr) : [],
      dontCares: ['minterms', 'maxterms'].includes(state.inputMode) ? parseTerms(state.dontCaresStr) : [],
      ...(state.inputMode === 'expr' ? { expr: state.rawInput.slice(0, 200) } : {}),
    };
  }

  if (state.minResult) {
    context.minimization = {
      form: state.minResult.form,
      text: state.minResult.text.slice(0, 200),
      termCount: state.minResult.termCount,
      literalCount: state.minResult.literalCount,
      steps: state.minResult.steps.slice(-3).map((step) => ({
        title: step.title.slice(0, 100),
        detail: step.detail.slice(0, 200),
      })),
    };
  }

  const netlist = state.netlists[state.activeVariant] ?? state.designedNetlist;
  if (netlist) {
    const summary = netlist.nodes.slice(0, 12).map((node) => {
      if (node.kind === 'gate') return `${node.output}=${node.type}(${node.inputs.join(',')})`;
      if (node.kind === 'ff') return `${node.q}=${node.type}FF`;
      if (node.kind === 'const') return `${node.output}=${node.value}`;
      return `${node.id}=${node.type} block`;
    }).join('; ');
    context.circuit = {
      name: netlist.name.slice(0, 100),
      gates: netlist.nodes.filter((node) => node.kind === 'gate').length,
      levels: gateLevelCount(netlist),
      netlistSummary: summary.slice(0, 300),
    };
  }

  if (state.stateTable || state.excitationEquations.length || state.outputEquations.length) {
    context.sequential = {
      ffType: state.selectedFF,
      ...(state.stateTable ? {
        stateTable: {
          ...state.stateTable,
          inputs: state.stateTable.inputs.slice(0, 8),
          outputs: state.stateTable.outputs.slice(0, 8),
          states: state.stateTable.states.slice(0, 8),
          rows: state.stateTable.rows.slice(0, 8),
        },
      } : {}),
      equations: [...state.excitationEquations, ...state.outputEquations].slice(0, 8),
    };
  }

  if (state.waveform) {
    context.timing = { events: state.waveform.events.slice(-10).map(({ t, label }) => ({ t, label: label.slice(0, 100) })) };
  }
  if (state.costReport) {
    context.cost = {
      totalICs: state.costReport.totalICs,
      totalPins: state.costReport.totalPins,
      totalCost: state.costReport.totalCost,
      ics: state.costReport.ics.slice(0, 8),
      notes: state.costReport.notes.slice(0, 5),
    };
  }
  if (state.powerReport) {
    context.power = {
      staticW: state.powerReport.staticW,
      dynamicW: state.powerReport.dynamicW,
      totalW: state.powerReport.totalW,
      transistors: state.powerReport.transistors,
      perNet: state.powerReport.perNet.slice(0, 8),
      assumptions: state.powerReport.assumptions,
    };
  }
  if (state.faultReport) {
    context.faults = {
      total: state.faultReport.total,
      detected: state.faultReport.detected,
      coverage: state.faultReport.coverage,
      undetected: state.faultReport.undetected.slice(0, 8),
      minimalTestSet: state.faultReport.minimalTestSet.slice(0, 8),
    };
  }

  while (JSON.stringify(context).length > 1_800) {
    if (context.minimization?.steps.length) context.minimization.steps.shift();
    else if (context.faults?.undetected?.length) context.faults.undetected.pop();
    else if (context.timing?.events.length) context.timing.events.shift();
    else if (context.cost?.notes?.length) context.cost.notes.pop();
    else if (context.sequential?.stateTable?.rows.length) context.sequential.stateTable.rows.pop();
    else if (context.circuit?.netlistSummary) context.circuit.netlistSummary = context.circuit.netlistSummary.slice(0, 150);
    else if (context.function?.minterms.length) context.function.minterms.pop();
    else if (context.function?.maxterms.length) context.function.maxterms.pop();
    else if (context.function?.dontCares.length) context.function.dontCares.pop();
    else if (context.power?.perNet?.length) context.power.perNet.pop();
    else if (context.cost?.ics?.length) context.cost.ics.pop();
    else if (context.faults?.minimalTestSet?.length) context.faults.minimalTestSet.pop();
    else if (context.minimization) delete context.minimization;
    else if (context.sequential) delete context.sequential;
    else if (context.timing) delete context.timing;
    else if (context.cost) delete context.cost;
    else if (context.power) delete context.power;
    else if (context.faults) delete context.faults;
    else if (context.circuit) delete context.circuit;
    else if (context.function?.expr && context.function.expr.length > 100) context.function.expr = context.function.expr.slice(0, 100);
    else if (context.function) delete context.function;
    else break;
  }
  return context;
}
