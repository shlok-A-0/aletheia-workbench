import { expose } from 'comlink';
import { mintermsOf, maxtermsOf, dontCaresOf } from '../engine/boolean';
import { runFaultTest } from '../engine/analysis/fault';
import { findPrimeImplicants, quineMcCluskey } from '../engine/minimize/qm';
import type { Netlist, TruthTable } from '../engine/types';

/**
 * Aletheia Background Engine Worker
 * Long-running tasks (>5 vars QM, fault testing, timed simulations) are delegated here.
 */
export const workerApi = {
  ping: () => 'pong',
  version: () => '1.0.0',
  /** One-form minimisation, used by the live workbench for functions too big to solve on the UI thread. */
  minimize: (table: TruthTable, form: 'SOP' | 'POS') => quineMcCluskey(table, form),
  minimizeTable: (table: TruthTable) => ({
    results: {
      SOP: quineMcCluskey(table, 'SOP'),
      POS: quineMcCluskey(table, 'POS'),
    },
    details: {
      SOP: findPrimeImplicants(mintermsOf(table), dontCaresOf(table), table.vars.length),
      POS: findPrimeImplicants(maxtermsOf(table), dontCaresOf(table), table.vars.length),
    },
    careTerms: {
      SOP: mintermsOf(table),
      POS: maxtermsOf(table),
    },
  }),
  runFaultTest: (netlist: Netlist) => runFaultTest(netlist),
};

expose(workerApi);

export type WorkerApi = typeof workerApi;
