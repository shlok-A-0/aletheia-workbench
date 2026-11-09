import { wrap, type Remote } from 'comlink';
import type { WorkerApi } from './engine.worker';

let workerInstance: Remote<WorkerApi> | null = null;

/**
 * Access the singleton Web Worker instance for engine computations.
 * All worker methods return Promises via Comlink's Remote proxy.
 */
export function getEngineWorker(): Remote<WorkerApi> {
  if (!workerInstance) {
    if (typeof Worker === 'undefined') {
      throw new Error('This browser does not support Web Workers required for large analyses.');
    }
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance = wrap<WorkerApi>(worker);
  }
  return workerInstance;
}
