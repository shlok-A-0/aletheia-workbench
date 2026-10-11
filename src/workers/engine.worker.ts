import { expose } from 'comlink';

/**
 * LDAM Background Engine Worker
 * Long-running tasks (>5 vars QM, fault testing, timed simulations) are delegated here.
 */
export const workerApi = {
  ping: () => 'pong',
  version: () => '1.0.0',
};

expose(workerApi);

export type WorkerApi = typeof workerApi;
