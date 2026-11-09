import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from './index';
import {
  createProjectFile,
  loadLastProject,
  parseProjectFile,
  saveLastProject,
} from './project';

afterEach(() => localStorage.clear());

describe('project persistence format', () => {
  it('round-trips the serializable workbench state', () => {
    const initial = useStore.getState();
    const project = parseProjectFile(createProjectFile(initial));
    expect(project.input).toEqual(initial.input);
    expect(project.netlists).toEqual(initial.netlists);
    expect(project.clockPeriod).toBe(initial.clockPeriod);
  });

  it('keeps and restores the last project in browser storage', () => {
    saveLastProject(useStore.getState());
    expect(loadLastProject()?.rawInput).toBe(useStore.getState().rawInput);
  });

  it('rejects invalid and unsupported project files with actionable errors', () => {
    expect(() => parseProjectFile('{')).toThrow('not valid JSON');
    expect(() => parseProjectFile('{"format":"ldam-project","version":2,"state":{}}')).toThrow('Unsupported project version');
    expect(() => parseProjectFile('{"format":"ldam-project","version":1,"state":{}}')).toThrow('incomplete');
  });
});
