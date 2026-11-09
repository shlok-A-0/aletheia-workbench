import type { RootStore } from './index';

const PROJECT_VERSION = 1;
const STORAGE_KEY = 'ldam:last-project';
const MAX_PROJECT_SIZE = 2_000_000;

export type ProjectState = Pick<
  RootStore,
  | 'input'
  | 'rawInput'
  | 'inputMode'
  | 'truthTable'
  | 'parsedExpr'
  | 'vars'
  | 'mintermsStr'
  | 'maxtermsStr'
  | 'dontCaresStr'
  | 'minResult'
  | 'multiMinResult'
  | 'selectedForm'
  | 'isComputing'
  | 'netlists'
  | 'activeVariant'
  | 'stateTable'
  | 'designedNetlist'
  | 'selectedFF'
  | 'excitationEquations'
  | 'outputEquations'
  | 'waveform'
  | 'stimulus'
  | 'clockPeriod'
  | 'totalDuration'
  | 'costReport'
  | 'powerReport'
  | 'faultReport'
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableRecord(value: unknown): boolean {
  return value === null || isRecord(value);
}

function validateProjectState(value: unknown): value is ProjectState {
  if (!isRecord(value)) return false;
  const state = value;
  const input = state.input;
  const netlists = state.netlists;
  if (!isRecord(input) || !isRecord(netlists)) return false;
  if (
    !['expression', 'table', 'minterms', 'maxterms'].includes(String(input.mode)) ||
    typeof input.raw !== 'string' ||
    typeof state.rawInput !== 'string' ||
    !['expr', 'table', 'minterms', 'maxterms'].includes(String(state.inputMode)) ||
    !Array.isArray(state.vars) ||
    state.vars.length > 8 ||
    !state.vars.every((entry) => typeof entry === 'string') ||
    !['SOP', 'POS'].includes(String(state.selectedForm)) ||
    !['original', 'simplified', 'nand', 'nor'].includes(String(state.activeVariant)) ||
    !['SR', 'D', 'JK', 'T'].includes(String(state.selectedFF)) ||
    typeof state.isComputing !== 'boolean' ||
    !Array.isArray(state.excitationEquations) ||
    !state.excitationEquations.every((entry) => typeof entry === 'string') ||
    !Array.isArray(state.outputEquations) ||
    !state.outputEquations.every((entry) => typeof entry === 'string') ||
    !Array.isArray(state.stimulus) ||
    typeof state.clockPeriod !== 'number' ||
    typeof state.totalDuration !== 'number' ||
    !['original', 'simplified', 'nand', 'nor'].every((key) =>
      netlists[key] === null ||
      (isRecord(netlists[key]) && Array.isArray(netlists[key].nodes))
    ) ||
    !isNullableRecord(state.truthTable) ||
    !isNullableRecord(state.parsedExpr) ||
    !isNullableRecord(state.minResult) ||
    !isNullableRecord(state.multiMinResult) ||
    !isNullableRecord(state.stateTable) ||
    !isNullableRecord(state.designedNetlist) ||
    !isNullableRecord(state.waveform) ||
    !isNullableRecord(state.costReport) ||
    !isNullableRecord(state.powerReport) ||
    !isNullableRecord(state.faultReport)
  ) {
    return false;
  }
  return typeof state.mintermsStr === 'string' &&
    typeof state.maxtermsStr === 'string' &&
    typeof state.dontCaresStr === 'string';
}

export function createProjectFile(state: RootStore): string {
  const serializableState: ProjectState = {
    input: state.input,
    rawInput: state.rawInput,
    inputMode: state.inputMode,
    truthTable: state.truthTable,
    parsedExpr: state.parsedExpr,
    vars: state.vars,
    mintermsStr: state.mintermsStr,
    maxtermsStr: state.maxtermsStr,
    dontCaresStr: state.dontCaresStr,
    minResult: state.minResult,
    multiMinResult: state.multiMinResult,
    selectedForm: state.selectedForm,
    isComputing: false,
    netlists: state.netlists,
    activeVariant: state.activeVariant,
    stateTable: state.stateTable,
    designedNetlist: state.designedNetlist,
    selectedFF: state.selectedFF,
    excitationEquations: state.excitationEquations,
    outputEquations: state.outputEquations,
    waveform: state.waveform,
    stimulus: state.stimulus,
    clockPeriod: state.clockPeriod,
    totalDuration: state.totalDuration,
    costReport: state.costReport,
    powerReport: state.powerReport,
    faultReport: state.faultReport,
  };
  return JSON.stringify({ format: 'ldam-project', version: PROJECT_VERSION, state: serializableState }, null, 2);
}

export function parseProjectFile(contents: string): ProjectState {
  if (contents.length > MAX_PROJECT_SIZE) {
    throw new Error(`Project file exceeds the ${MAX_PROJECT_SIZE.toLocaleString()} character limit.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    throw new Error('Project file is not valid JSON.');
  }
  if (!isRecord(parsed) || parsed.format !== 'ldam-project') {
    throw new Error('This is not an Aletheia project file.');
  }
  if (parsed.version !== PROJECT_VERSION) {
    throw new Error(`Unsupported project version: ${String(parsed.version)}.`);
  }
  if (!validateProjectState(parsed.state)) {
    throw new Error('Project data is incomplete or has an unsupported structure.');
  }
  return { ...parsed.state, isComputing: false };
}

export function saveLastProject(state: RootStore): void {
  window.localStorage.setItem(STORAGE_KEY, createProjectFile(state));
}

export function loadLastProject(): ProjectState | null {
  const contents = window.localStorage.getItem(STORAGE_KEY);
  return contents === null ? null : parseProjectFile(contents);
}
