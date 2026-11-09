/**
 * Aletheia Minimization Engine — Karnaugh Map (K-Map)
 * Supports 2, 3, and 4 variables with Gray-code coordinate mapping (00, 01, 11, 10),
 * torus wrap-around group detection (including 4-corner groups), and pedagogical Step[] generation.
 */

import type { TruthTable, MinResult, Implicant, Step } from '../types';
import { mintermsOf, maxtermsOf } from '../boolean/truth-table';
import { quineMcCluskey } from './qm';

export interface KMapCell {
  row: number;
  col: number;
  minterm: number;
  value: 0 | 1 | 'x';
  rowGray: string;
  colGray: string;
  binary: string;
}

export interface KMap {
  numVars: number;
  rowVars: string[];
  colVars: string[];
  rowHeaders: string[]; // e.g. ["00", "01", "11", "10"]
  colHeaders: string[]; // e.g. ["00", "01", "11", "10"]
  grid: KMapCell[][];   // grid[row][col]
}

export interface KMapGroup {
  cells: number[]; // minterm indices
  rowIndices: number[]; // grid row coordinates
  colIndices: number[]; // grid col coordinates
  implicant: Implicant;
  termText: string;
  essential: boolean;
  isCornerGroup?: boolean;
  isEdgeWrapRow?: boolean;
  isEdgeWrapCol?: boolean;
}

const GRAY_1 = ['0', '1'];
const GRAY_2 = ['00', '01', '11', '10'];
const GRAY_3 = ['000', '001', '011', '010', '110', '111', '101', '100'];

/**
 * Builds the 2D Gray-code K-map data structure for 2, 3, or 4 variables.
 */
export function buildKMap(tt: TruthTable): KMap {
  const vars = tt.vars;
  const numVars = vars.length;

  if (numVars < 2 || numVars > 5) {
    throw new Error(`K-Map visual grid supports 2 to 5 variables, got ${numVars}`);
  }

  let rowVars: string[];
  let colVars: string[];
  let rowHeaders: string[];
  let colHeaders: string[];

  if (numVars === 2) {
    rowVars = [vars[0]];
    colVars = [vars[1]];
    rowHeaders = GRAY_1;
    colHeaders = GRAY_1;
  } else if (numVars === 3) {
    rowVars = [vars[0]];
    colVars = [vars[1], vars[2]];
    rowHeaders = GRAY_1;
    colHeaders = GRAY_2;
  } else if (numVars === 4) {
    rowVars = [vars[0], vars[1]];
    colVars = [vars[2], vars[3]];
    rowHeaders = GRAY_2;
    colHeaders = GRAY_2;
  } else {
    rowVars = [vars[0], vars[1]];
    colVars = [vars[2], vars[3], vars[4]];
    rowHeaders = GRAY_2;
    colHeaders = GRAY_3;
  }

  const numRows = rowHeaders.length;
  const numCols = colHeaders.length;
  const grid: KMapCell[][] = [];

  const rowMap = new Map<number, 0 | 1 | 'x'>();
  for (const r of tt.rows) {
    rowMap.set(r.index, r.out);
  }

  for (let r = 0; r < numRows; r++) {
    const rowCells: KMapCell[] = [];
    const rBits = rowHeaders[r];

    for (let c = 0; c < numCols; c++) {
      const cBits = colHeaders[c];
      const binary = rBits + cBits;
      const minterm = Number.parseInt(binary, 2);
      const value = rowMap.get(minterm) ?? 0;

      rowCells.push({
        row: r,
        col: c,
        minterm,
        value,
        rowGray: rBits,
        colGray: cBits,
        binary,
      });
    }
    grid.push(rowCells);
  }

  return {
    numVars,
    rowVars,
    colVars,
    rowHeaders,
    colHeaders,
    grid,
  };
}

/**
 * Checks if a subset of cells can form an implicant and returns its bits.
 */
function cellsToImplicant(
  minterms: number[],
  numVars: number
): Implicant {
  const bits: (0 | 1 | '-')[] = [];
  for (let bit = 0; bit < numVars; bit++) {
    const shift = numVars - 1 - bit;
    let has0 = false;
    let has1 = false;
    for (const m of minterms) {
      const b = (m >> shift) & 1;
      if (b === 0) has0 = true;
      if (b === 1) has1 = true;
    }

    if (has0 && has1) {
      bits.push('-');
    } else if (has1) {
      bits.push(1);
    } else {
      bits.push(0);
    }
  }

  return {
    bits,
    covers: [...minterms].sort((a, b) => a - b),
  };
}

/**
 * Generates all valid rectangular power-of-2 groups on the K-Map torus grid.
 */
export function kmapGroups(
  tt: TruthTable,
  form: 'SOP' | 'POS' = 'SOP'
): { groups: KMapGroup[] } {
  const kmap = buildKMap(tt);
  const numRows = kmap.rowHeaders.length;
  const numCols = kmap.colHeaders.length;
  const numVars = kmap.numVars;

  const targetValue = form === 'SOP' ? 1 : 0;
  const careTerms = form === 'SOP' ? mintermsOf(tt) : maxtermsOf(tt);
  const careSet = new Set(careTerms);

  // Power of 2 dimensions
  const rowSizes = [1, 2, 4, 8].filter((s) => s <= numRows);
  const colSizes = [1, 2, 4, 8].filter((s) => s <= numCols);

  const rawGroups: {
    cells: number[];
    rowIndices: number[];
    colIndices: number[];
    implicant: Implicant;
    isCornerGroup?: boolean;
    isEdgeWrapRow?: boolean;
    isEdgeWrapCol?: boolean;
  }[] = [];

  for (const h of rowSizes) {
    for (const w of colSizes) {
      const groupSize = h * w;
      // Must be power of 2
      if ((groupSize & (groupSize - 1)) !== 0) continue;

      for (let r0 = 0; r0 < numRows; r0++) {
        for (let c0 = 0; c0 < numCols; c0++) {
          const cells: number[] = [];
          const rowIndices: number[] = [];
          const colIndices: number[] = [];
          let valid = true;

          for (let dr = 0; dr < h; dr++) {
            const r = (r0 + dr) % numRows;
            if (!rowIndices.includes(r)) rowIndices.push(r);

            for (let dc = 0; dc < w; dc++) {
              const c = (c0 + dc) % numCols;
              if (!colIndices.includes(c)) colIndices.push(c);

              const cell = kmap.grid[r][c];
              // Cell must match targetValue or be don't care ('x')
              if (cell.value !== targetValue && cell.value !== 'x') {
                valid = false;
                break;
              }
              cells.push(cell.minterm);
            }
            if (!valid) break;
          }

          if (valid && cells.length > 0) {
            const sortedCells = Array.from(new Set(cells)).sort((a, b) => a - b);
            // Must contain at least one care term
            if (sortedCells.some((m) => careSet.has(m))) {
              const imp = cellsToImplicant(sortedCells, numVars);

              const isEdgeWrapRow = rowIndices.includes(0) && rowIndices.includes(numRows - 1) && h > 1 && h < numRows;
              const isEdgeWrapCol = colIndices.includes(0) && colIndices.includes(numCols - 1) && w > 1 && w < numCols;
              const isCornerGroup = isEdgeWrapRow && isEdgeWrapCol && sortedCells.length === 4;

              rawGroups.push({
                cells: sortedCells,
                rowIndices,
                colIndices,
                implicant: imp,
                isCornerGroup,
                isEdgeWrapRow,
                isEdgeWrapCol,
              });
            }
          }
        }
      }
    }
  }

  // Deduplicate and filter non-prime groups (keep maximal groups)
  const primeGroupMap = new Map<string, typeof rawGroups[0]>();
  for (const g of rawGroups) {
    const key = g.cells.join(',');
    if (!primeGroupMap.has(key)) {
      primeGroupMap.set(key, g);
    }
  }

  const uniqueCandidates = Array.from(primeGroupMap.values());
  const primeGroups: typeof rawGroups = [];

  for (let i = 0; i < uniqueCandidates.length; i++) {
    const c1 = uniqueCandidates[i];
    let isSubset = false;

    for (let j = 0; j < uniqueCandidates.length; j++) {
      if (i === j) continue;
      const c2 = uniqueCandidates[j];
      if (c2.cells.length > c1.cells.length) {
        const s2 = new Set(c2.cells);
        if (c1.cells.every((m) => s2.has(m))) {
          isSubset = true;
          break;
        }
      }
    }

    if (!isSubset) {
      primeGroups.push(c1);
    }
  }

  // Use QM's minimal cover algorithm to pick the minimal set of K-map groups
  const qmResult = quineMcCluskey(tt, form);
  const qmCoverBits = new Set(qmResult.implicants.map((pi) => pi.bits.join('')));

  const resultGroups: KMapGroup[] = [];

  for (const pg of primeGroups) {
    const bitStr = pg.implicant.bits.join('');
    if (qmCoverBits.has(bitStr)) {
      // Find term text
      const termLiterals: string[] = [];
      for (let b = 0; b < numVars; b++) {
        const bit = pg.implicant.bits[b];
        const v = tt.vars[b];
        if (form === 'SOP') {
          if (bit === 1) termLiterals.push(v);
          else if (bit === 0) termLiterals.push(`${v}'`);
        } else {
          if (bit === 0) termLiterals.push(v);
          else if (bit === 1) termLiterals.push(`${v}'`);
        }
      }

      const termText =
        form === 'SOP'
          ? termLiterals.join('') || '1'
          : termLiterals.length === 0
            ? '0'
            : termLiterals.length === 1
              ? termLiterals[0]
              : `(${termLiterals.join('+')})`;

      resultGroups.push({
        cells: pg.cells,
        rowIndices: pg.rowIndices,
        colIndices: pg.colIndices,
        implicant: pg.implicant,
        termText,
        essential: Boolean(pg.implicant.essential),
        isCornerGroup: pg.isCornerGroup,
        isEdgeWrapRow: pg.isEdgeWrapRow,
        isEdgeWrapCol: pg.isEdgeWrapCol,
      });
    }
  }

  return { groups: resultGroups };
}

/**
 * Simplifies a Boolean function via K-map grouping, producing MinResult with
 * detailed pedagogical explanation steps explaining which variables were eliminated.
 */
export function kmapSimplify(tt: TruthTable, form: 'SOP' | 'POS' = 'SOP'): MinResult {
  const { groups } = kmapGroups(tt, form);
  const qmResult = quineMcCluskey(tt, form);
  const steps: Step[] = [];

  steps.push({
    title: 'K-Map Coordinate Layout',
    detail: `Plotted ${1 << tt.vars.length} cells in Gray code order across ${tt.vars.join(', ')}.`,
  });

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const eliminatedVars: string[] = [];
    const keptVars: string[] = [];

    for (let b = 0; b < tt.vars.length; b++) {
      if (g.implicant.bits[b] === '-') {
        eliminatedVars.push(tt.vars[b]);
      } else {
        keptVars.push(tt.vars[b]);
      }
    }

    let wrapDesc = '';
    if (g.isCornerGroup) {
      wrapDesc = ' (4-Corner Wrap Group)';
    } else if (g.isEdgeWrapRow || g.isEdgeWrapCol) {
      wrapDesc = ' (Torus Wrap-Around Group)';
    }

    steps.push({
      title: `Group ${i + 1} (${g.cells.length} cells): ${g.termText}${wrapDesc}`,
      detail: `Minterms [${g.cells.join(', ')}] eliminate {${eliminatedVars.join(', ') || 'none'}} because their values alternate. Retained term: ${g.termText}.`,
      data: {
        cells: g.cells,
        term: g.termText,
        eliminated: eliminatedVars,
        retained: keptVars,
      },
    });
  }

  return {
    ...qmResult,
    steps,
  };
}
