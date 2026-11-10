import { describe, expect, it } from 'vitest';
import { generateLabReportHtml } from './labReport';
import { useStore } from '../../store';
import { truthTableFromMinterms } from '../../engine/boolean/truth-table';

describe('generateLabReportHtml', () => {
  it('generates a complete publication-ready college lab design report', () => {
    useStore.setState({
      rawInput: 'F = AB + C',
      vars: ['A', 'B', 'C'],
      truthTable: truthTableFromMinterms(['A', 'B', 'C'], [1, 3, 5, 6, 7]),
      activeVariant: 'simplified',
      netlists: {
        original: null,
        simplified: {
          name: 'simplified_circuit',
          inputs: ['A', 'B', 'C'],
          outputs: ['F'],
          nodes: [
            { kind: 'gate', id: 'g1', type: 'AND', inputs: ['A', 'B'], output: 'ab' },
            { kind: 'gate', id: 'g2', type: 'OR', inputs: ['ab', 'C'], output: 'F' },
          ],
        },
        nand: null,
        nor: null,
      },
    });

    const html = generateLabReportHtml(useStore.getState());
    expect(html).toContain('Digital Logic Design Report');
    expect(html).toContain('Aletheia Workbench');
    expect(html).toContain('F = AB + C');
    expect(html).toContain('&Sigma;m(1, 3, 5, 6, 7)');
    expect(html).toContain('Canonical Truth Table');
    expect(html).toContain('Component Bill of Materials');
    expect(html).toContain('FUNCTIONALLY EQUIVALENT TO TRUTH TABLE');
    expect(html).toContain('@page');
    expect(html).toContain('window.print()');
  });
});
