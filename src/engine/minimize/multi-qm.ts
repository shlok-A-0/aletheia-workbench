/**
 * LDAM Minimization Engine — Multi-Output Quine–McCluskey
 * Minimizes multiple Boolean functions simultaneously (e.g. BCD to 7-segment decoder)
 * by detecting and tagging prime implicants shared across multiple outputs.
 */

import type { TruthTable, MinResult, MultiMinResult, Implicant } from '../types';
import { quineMcCluskey } from './qm';

export function multiOutputQM(
  outputs: { name: string; tt: TruthTable }[]
): MultiMinResult {
  const results: MinResult[] = [];
  const termUsageMap = new Map<string, { count: number; implicant: Implicant }>();

  for (const { tt } of outputs) {
    const res = quineMcCluskey(tt, 'SOP');
    results.push(res);

    for (const imp of res.implicants) {
      const bitStr = imp.bits.join('');
      if (!termUsageMap.has(bitStr)) {
        termUsageMap.set(bitStr, { count: 1, implicant: imp });
      } else {
        termUsageMap.get(bitStr)!.count++;
      }
    }
  }

  const sharedTerms: Implicant[] = [];
  for (const [, item] of termUsageMap) {
    if (item.count > 1) {
      sharedTerms.push(item.implicant);
    }
  }

  return {
    results,
    sharedTerms,
  };
}
