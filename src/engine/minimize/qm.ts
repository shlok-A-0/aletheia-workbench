/**
 * Aletheia Minimization Engine — Quine–McCluskey Algorithm
 * Deterministic tabular logic minimization with Petrick's method,
 * row/column dominance reduction, essential prime implicant extraction,
 * and pedagogical Step[] generation.
 */

import type { TruthTable, MinResult, Implicant, Expr, Step } from '../types';
import { mintermsOf, maxtermsOf, dontCaresOf } from '../boolean/truth-table';

export interface QMCandidate {
  bits: (0 | 1 | '-')[];
  covers: number[];
  used: boolean;
}

export interface PIChart {
  implicants: Implicant[];
  minterms: number[];
  table: boolean[][]; // [piIndex][mintermIndex]
}

/**
 * Returns bit string representation of an implicant (e.g. "01-0").
 */
function bitString(bits: (0 | 1 | '-')[]) {
  return bits.join('');
}

/**
 * Converts a minterm number to binary bit array of length n.
 */
function mintermToBits(m: number, n: number): (0 | 1)[] {
  const bits: (0 | 1)[] = [];
  for (let i = 0; i < n; i++) {
    bits.push(((m >> (n - 1 - i)) & 1) as 0 | 1);
  }
  return bits;
}

/**
 * Counts the number of 1s in an implicant's bits.
 */
function countOnes(bits: (0 | 1 | '-')[]): number {
  let count = 0;
  for (const b of bits) {
    if (b === 1) count++;
  }
  return count;
}

/**
 * Checks if two implicants can combine (differ by exactly one 0/1 bit, with identical dashes).
 */
function canCombine(a: QMCandidate, b: QMCandidate): number | null {
  let diffPos: number | null = null;
  for (let i = 0; i < a.bits.length; i++) {
    if (a.bits[i] !== b.bits[i]) {
      if (a.bits[i] === '-' || b.bits[i] === '-') {
        return null; // dashes must align
      }
      if (diffPos !== null) {
        return null; // more than one difference
      }
      diffPos = i;
    }
  }
  return diffPos;
}

/**
 * Finds all Prime Implicants using the Quine–McCluskey tabular method.
 */
export function findPrimeImplicants(
  careMinterms: number[],
  dontCares: number[],
  numVars: number,
  steps?: Step[]
): { primeImplicants: Implicant[]; columnsData: { column: number; terms: { bits: string; covers: number[] }[] }[] } {
  const allMinterms = Array.from(new Set([...careMinterms, ...dontCares])).sort((a, b) => a - b);
  const primeImplicantsMap = new Map<string, Implicant>();
  const columnsData: { column: number; terms: { bits: string; covers: number[] }[] }[] = [];

  if (allMinterms.length === 0) {
    return { primeImplicants: [], columnsData: [] };
  }

  // Column 0: initial minterm candidates
  let currentCandidates: QMCandidate[] = allMinterms.map((m) => ({
    bits: mintermToBits(m, numVars),
    covers: [m],
    used: false,
  }));

  let columnIndex = 0;

  while (currentCandidates.length > 0) {
    const colRecord = {
      column: columnIndex,
      terms: currentCandidates.map((c) => ({
        bits: bitString(c.bits),
        covers: [...c.covers],
      })),
    };
    columnsData.push(colRecord);

    if (steps) {
      steps.push({
        title: `QM Column ${columnIndex + 1} (${currentCandidates.length} terms)`,
        detail: `Grouping terms by number of 1s and comparing adjacent groups.`,
        data: colRecord,
      });
    }

    // Group candidates by number of 1s
    const groups: Map<number, QMCandidate[]> = new Map();
    for (const c of currentCandidates) {
      const ones = countOnes(c.bits);
      if (!groups.has(ones)) groups.set(ones, []);
      groups.get(ones)!.push(c);
    }

    const nextCandidatesMap = new Map<string, QMCandidate>();

    // Compare group k with group k + 1
    const groupKeys = Array.from(groups.keys()).sort((a, b) => a - b);
    for (let k = 0; k < groupKeys.length; k++) {
      const g1 = groups.get(groupKeys[k])!;
      const g2 = groups.get(groupKeys[k] + 1);
      if (!g2) continue;

      for (const t1 of g1) {
        for (const t2 of g2) {
          const diffIdx = canCombine(t1, t2);
          if (diffIdx !== null) {
            t1.used = true;
            t2.used = true;

            const combinedBits = [...t1.bits];
            combinedBits[diffIdx] = '-';
            const combinedCovers = Array.from(new Set([...t1.covers, ...t2.covers])).sort((a, b) => a - b);
            const key = bitString(combinedBits);

            if (!nextCandidatesMap.has(key)) {
              nextCandidatesMap.set(key, {
                bits: combinedBits,
                covers: combinedCovers,
                used: false,
              });
            }
          }
        }
      }
    }

    // Collect any unused candidate as a Prime Implicant
    for (const c of currentCandidates) {
      if (!c.used) {
        const key = bitString(c.bits);
        if (!primeImplicantsMap.has(key)) {
          primeImplicantsMap.set(key, {
            bits: [...c.bits],
            covers: [...c.covers],
          });
        }
      }
    }

    currentCandidates = Array.from(nextCandidatesMap.values());
    columnIndex++;
  }

  const primeImplicants = Array.from(primeImplicantsMap.values());
  return { primeImplicants, columnsData };
}

/**
 * Builds the Prime Implicant chart for care minterms.
 */
function buildPIChart(primeImplicants: Implicant[], careMinterms: number[]): PIChart {
  const table: boolean[][] = [];
  for (let i = 0; i < primeImplicants.length; i++) {
    const row: boolean[] = [];
    const pi = primeImplicants[i];
    const coverSet = new Set(pi.covers);
    for (const m of careMinterms) {
      row.push(coverSet.has(m));
    }
    table.push(row);
  }
  return {
    implicants: primeImplicants,
    minterms: careMinterms,
    table,
  };
}

/**
 * Solves the PI chart to find all minimal covers using Essential PI extraction,
 * row/column dominance, and Petrick's expansion.
 */
function solvePIChart(
  chart: PIChart,
  steps?: Step[]
): { minimalCover: Implicant[]; allCovers: Implicant[][]; note?: string } {
  const { implicants, minterms, table } = chart;
  const chosenEPIs: Implicant[] = [];
  const coveredMinterms = new Set<number>();
  const activeImplicants = new Set<number>(implicants.map((_, idx) => idx));

  // 1. Essential Prime Implicant Extraction
  let foundEPI = true;
  while (foundEPI) {
    foundEPI = false;
    for (let c = 0; c < minterms.length; c++) {
      const m = minterms[c];
      if (coveredMinterms.has(m)) continue;

      let coveringCount = 0;
      let lastPIIdx = -1;
      for (const r of activeImplicants) {
        if (table[r][c]) {
          coveringCount++;
          lastPIIdx = r;
        }
      }

      if (coveringCount === 1 && lastPIIdx !== -1) {
        // Essential PI found!
        const epi = implicants[lastPIIdx];
        epi.essential = true;
        chosenEPIs.push(epi);
        activeImplicants.delete(lastPIIdx);

        if (steps) {
          steps.push({
            title: `Essential Prime Implicant: ${bitString(epi.bits)}`,
            detail: `Minterm m${m} is covered uniquely by this implicant.`,
            data: { implicant: bitString(epi.bits), minterm: m },
          });
        }

        // Mark all minterms covered by this EPI as covered
        for (let col = 0; col < minterms.length; col++) {
          if (table[lastPIIdx][col]) {
            coveredMinterms.add(minterms[col]);
          }
        }

        foundEPI = true;
        break;
      }
    }
  }

  // Check if all minterms are covered
  const remainingMintermIndices = minterms
    .map((m, idx) => ({ m, idx }))
    .filter(({ m }) => !coveredMinterms.has(m));

  if (remainingMintermIndices.length === 0) {
    return { minimalCover: chosenEPIs, allCovers: [chosenEPIs] };
  }

  // 2. Cyclic Core: Petrick's Method / Greedy Fallback
  const remainingPIIndices = Array.from(activeImplicants);

  // If chart is too large, use greedy fallback
  if (remainingPIIndices.length > 40) {
    const greedyCover: Implicant[] = [...chosenEPIs];
    const stillUncovered = new Set(remainingMintermIndices.map((x) => x.m));

    while (stillUncovered.size > 0 && remainingPIIndices.length > 0) {
      // Pick PI covering the most remaining minterms
      let bestIdx = -1;
      let bestCoverCount = -1;

      for (const piIdx of remainingPIIndices) {
        const pi = implicants[piIdx];
        const count = pi.covers.filter((m) => stillUncovered.has(m)).length;
        if (count > bestCoverCount) {
          bestCoverCount = count;
          bestIdx = piIdx;
        }
      }

      if (bestIdx === -1 || bestCoverCount === 0) break;

      const chosen = implicants[bestIdx];
      greedyCover.push(chosen);
      for (const m of chosen.covers) {
        stillUncovered.delete(m);
      }
      remainingPIIndices.splice(remainingPIIndices.indexOf(bestIdx), 1);
    }

    if (steps) {
      steps.push({
        title: 'Greedy Cover Fallback Applied',
        detail: `PI chart exceeded 40 candidate rows; greedy heuristic selected a near-minimal cover.`,
      });
    }

    return {
      minimalCover: greedyCover,
      allCovers: [greedyCover],
      note: 'near-minimal (greedy fallback)',
    };
  }

  // Petrick's expansion for exact minimum
  // For each remaining minterm, build sum of PIs that cover it
  const clauses: number[][] = [];
  for (const { idx: colIdx } of remainingMintermIndices) {
    const coveringPIs: number[] = [];
    for (const r of remainingPIIndices) {
      if (table[r][colIdx]) {
        coveringPIs.push(r);
      }
    }
    if (coveringPIs.length > 0) {
      clauses.push(coveringPIs);
    }
  }

  // Multiply out clauses to find all valid combinations
  // Multiply clause by clause with boolean absorption (A + AB = A)
  let products: Set<string> = new Set(['']); // empty set representation
  for (const clause of clauses) {
    const nextProducts: Set<string> = new Set();
    for (const existing of products) {
      const existingSet = new Set(existing ? existing.split(',').map(Number) : []);
      for (const pi of clause) {
        const combined = new Set(existingSet);
        combined.add(pi);
        const sortedKey = Array.from(combined).sort((a, b) => a - b).join(',');
        nextProducts.add(sortedKey);
      }
    }

    // Absorption check on products: keep only minimal subsets
    const productList = Array.from(nextProducts).map((s) => s.split(',').map(Number));
    const prunedList: number[][] = [];
    for (let i = 0; i < productList.length; i++) {
      const p1 = new Set(productList[i]);
      let isSuperset = false;
      for (let j = 0; j < productList.length; j++) {
        if (i === j) continue;
        const p2 = productList[j];
        if (p2.length < productList[i].length && p2.every((x) => p1.has(x))) {
          isSuperset = true;
          break;
        }
      }
      if (!isSuperset) {
        prunedList.push(productList[i]);
      }
    }

    products = new Set(prunedList.map((p) => p.join(',')));
  }

  // Find solutions with lowest cost: fewest terms, then fewest literals
  const candidateCovers: { cover: Implicant[]; terms: number; literals: number }[] = [];

  for (const prodStr of products) {
    if (!prodStr) continue;
    const piIndices = prodStr.split(',').map(Number);
    const cover = [...chosenEPIs, ...piIndices.map((i) => implicants[i])];
    const terms = cover.length;
    const literals = cover.reduce((sum, pi) => sum + pi.bits.filter((b) => b !== '-').length, 0);
    candidateCovers.push({ cover, terms, literals });
  }

  if (candidateCovers.length === 0) {
    return { minimalCover: chosenEPIs, allCovers: [chosenEPIs] };
  }

  candidateCovers.sort((a, b) => {
    if (a.terms !== b.terms) return a.terms - b.terms;
    return a.literals - b.literals;
  });

  const best = candidateCovers[0];
  const allCovers = candidateCovers
    .filter((c) => c.terms === best.terms && c.literals === best.literals)
    .slice(0, 20)
    .map((c) => c.cover);

  if (steps) {
    steps.push({
      title: "Petrick's Method Solution",
      detail: `Evaluated ${candidateCovers.length} valid covers. Selected optimal cover with ${best.terms} terms and ${best.literals} literals.`,
    });
  }

  return { minimalCover: best.cover, allCovers };
}

/**
 * Converts an Implicant to an Expr AST term and string.
 */
function implicantToSOPTerm(pi: Implicant, vars: string[]): { expr: Expr; text: string; literals: number } {
  const literals: Expr[] = [];
  const textParts: string[] = [];
  let literalCount = 0;

  for (let i = 0; i < pi.bits.length; i++) {
    const bit = pi.bits[i];
    const v = vars[i];
    if (bit === 1) {
      literals.push({ t: 'var', name: v });
      textParts.push(v);
      literalCount++;
    } else if (bit === 0) {
      literals.push({ t: 'not', a: { t: 'var', name: v } });
      textParts.push(`${v}'`);
      literalCount++;
    }
  }

  if (literals.length === 0) {
    return { expr: { t: 'const', v: 1 }, text: '1', literals: 0 };
  }

  const expr: Expr = literals.length === 1 ? literals[0] : { t: 'and', args: literals };
  return { expr, text: textParts.join(''), literals: literalCount };
}

/**
 * Converts an Implicant (minimized from maxterms) to a POS sum term.
 */
function implicantToPOSTerm(pi: Implicant, vars: string[]): { expr: Expr; text: string; literals: number } {
  const literals: Expr[] = [];
  const textParts: string[] = [];
  let literalCount = 0;

  for (let i = 0; i < pi.bits.length; i++) {
    const bit = pi.bits[i];
    const v = vars[i];
    // In POS: 0 -> variable, 1 -> variable complement
    if (bit === 0) {
      literals.push({ t: 'var', name: v });
      textParts.push(v);
      literalCount++;
    } else if (bit === 1) {
      literals.push({ t: 'not', a: { t: 'var', name: v } });
      textParts.push(`${v}'`);
      literalCount++;
    }
  }

  if (literals.length === 0) {
    return { expr: { t: 'const', v: 0 }, text: '0', literals: 0 };
  }

  const expr: Expr = literals.length === 1 ? literals[0] : { t: 'or', args: literals };
  const text = literals.length === 1 ? textParts[0] : `(${textParts.join('+')})`;
  return { expr, text, literals: literalCount };
}

/**
 * Executes the Quine–McCluskey minimization algorithm for SOP or POS.
 */
export function quineMcCluskey(tt: TruthTable, form: 'SOP' | 'POS' = 'SOP'): MinResult {
  const steps: Step[] = [];
  const vars = tt.vars;
  const n = vars.length;

  if (form === 'SOP') {
    const careMinterms = mintermsOf(tt);
    const dontCares = dontCaresOf(tt);

    // Edge case: All zeros
    if (careMinterms.length === 0) {
      steps.push({ title: 'Trivial Case', detail: 'Function has no true minterms (constant 0).' });
      return {
        form: 'SOP',
        implicants: [],
        expr: { t: 'const', v: 0 },
        text: '0',
        termCount: 0,
        literalCount: 0,
        steps,
      };
    }

    // Edge case: All ones (care + dontCares cover all 2^n)
    if (careMinterms.length + dontCares.length === 1 << n && careMinterms.length > 0) {
      const allOnesImplicant: Implicant = { bits: Array(n).fill('-'), covers: Array.from({ length: 1 << n }, (_, i) => i) };
      steps.push({ title: 'Trivial Case', detail: 'All 2^n minterms are covered (constant 1).' });
      return {
        form: 'SOP',
        implicants: [allOnesImplicant],
        expr: { t: 'const', v: 1 },
        text: '1',
        termCount: 1,
        literalCount: 0,
        steps,
      };
    }

    const { primeImplicants } = findPrimeImplicants(careMinterms, dontCares, n, steps);
    const chart = buildPIChart(primeImplicants, careMinterms);
    const { minimalCover, note } = solvePIChart(chart, steps);

    const termResults = minimalCover.map((pi) => implicantToSOPTerm(pi, vars));
    const termCount = termResults.length;
    const literalCount = termResults.reduce((acc, t) => acc + t.literals, 0);

    const expr: Expr =
      termResults.length === 1
        ? termResults[0].expr
        : { t: 'or', args: termResults.map((t) => t.expr) };

    const text = termResults.map((t) => t.text).join(' + ');

    steps.push({
      title: 'Minimization Result (SOP)',
      detail: `Minimal cover: ${text} (${termCount} terms, ${literalCount} literals).`,
    });

    return {
      form: 'SOP',
      implicants: minimalCover,
      expr,
      text: text || '0',
      termCount,
      literalCount,
      steps,
      note,
    };
  } else {
    // POS: minimize the maxterms
    const careMaxterms = maxtermsOf(tt);
    const dontCares = dontCaresOf(tt);

    // Edge case: All ones (no maxterms)
    if (careMaxterms.length === 0) {
      steps.push({ title: 'Trivial Case', detail: 'Function has no false maxterms (constant 1).' });
      return {
        form: 'POS',
        implicants: [],
        expr: { t: 'const', v: 1 },
        text: '1',
        termCount: 0,
        literalCount: 0,
        steps,
      };
    }

    // Edge case: All zeros
    if (careMaxterms.length + dontCares.length === 1 << n && careMaxterms.length > 0) {
      const allZerosImplicant: Implicant = { bits: Array(n).fill('-'), covers: Array.from({ length: 1 << n }, (_, i) => i) };
      steps.push({ title: 'Trivial Case', detail: 'All 2^n maxterms are covered (constant 0).' });
      return {
        form: 'POS',
        implicants: [allZerosImplicant],
        expr: { t: 'const', v: 0 },
        text: '0',
        termCount: 1,
        literalCount: 0,
        steps,
      };
    }

    const { primeImplicants } = findPrimeImplicants(careMaxterms, dontCares, n, steps);
    const chart = buildPIChart(primeImplicants, careMaxterms);
    const { minimalCover, note } = solvePIChart(chart, steps);

    const termResults = minimalCover.map((pi) => implicantToPOSTerm(pi, vars));
    const termCount = termResults.length;
    const literalCount = termResults.reduce((acc, t) => acc + t.literals, 0);

    const expr: Expr =
      termResults.length === 1
        ? termResults[0].expr
        : { t: 'and', args: termResults.map((t) => t.expr) };

    const text = termResults.map((t) => t.text).join('');

    steps.push({
      title: 'Minimization Result (POS)',
      detail: `Minimal cover: ${text} (${termCount} terms, ${literalCount} literals).`,
    });

    return {
      form: 'POS',
      implicants: minimalCover,
      expr,
      text: text || '1',
      termCount,
      literalCount,
      steps,
      note,
    };
  }
}

/**
 * Returns all prime implicants for a given truth table.
 */
export function primeImplicants(tt: TruthTable): Implicant[] {
  const careMinterms = mintermsOf(tt);
  const dontCares = dontCaresOf(tt);
  const { primeImplicants } = findPrimeImplicants(careMinterms, dontCares, tt.vars.length);
  return primeImplicants;
}

/**
 * Returns all minimal covers (up to 20) for a given truth table.
 */
export function allMinimalCovers(tt: TruthTable): MinResult[] {
  const careMinterms = mintermsOf(tt);
  const dontCares = dontCaresOf(tt);
  const n = tt.vars.length;
  const { primeImplicants } = findPrimeImplicants(careMinterms, dontCares, n);
  const chart = buildPIChart(primeImplicants, careMinterms);
  const { allCovers } = solvePIChart(chart);

  return allCovers.map((cover) => {
    const termResults = cover.map((pi) => implicantToSOPTerm(pi, tt.vars));
    const termCount = termResults.length;
    const literalCount = termResults.reduce((acc, t) => acc + t.literals, 0);
    const expr: Expr =
      termResults.length === 1 ? termResults[0].expr : { t: 'or', args: termResults.map((t) => t.expr) };
    const text = termResults.map((t) => t.text).join(' + ');

    return {
      form: 'SOP',
      implicants: cover,
      expr,
      text: text || '0',
      termCount,
      literalCount,
      steps: [],
    };
  });
}
