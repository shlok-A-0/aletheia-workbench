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

    const sampleSvg = '<svg id="test-schematic"><rect width="100" height="100" /></svg>';
    const html = generateLabReportHtml(useStore.getState(), sampleSvg);
    expect(html).toContain('Digital Logic Design Report');
    expect(html).toContain('Aletheia Workbench');
    expect(html).toContain('F = AB + C');
    expect(html).toContain('&Sigma;m(1, 3, 5, 6, 7)');
    expect(html).toContain('Canonical Truth Table');
    expect(html).toContain('3. Circuit Schematic &amp; Implementation');
    expect(html).toContain('<svg id="test-schematic">');
    expect(html).toContain('Component Bill of Materials (74LS TTL)');
    // Automatically populated IC mapping & prices
    expect(html).toContain('7408');
    expect(html).toContain('7432');
    expect(html).toContain('Estimated Total Cost:');
    // Automatically populated fault coverage
    expect(html).toContain('Hardware Verification &amp; Fault Coverage');
    expect(html).toContain('FUNCTIONALLY EQUIVALENT TO TRUTH TABLE');
    expect(html).toContain('@page');
    expect(html).toContain('window.print()');
  });

  it('displays mismatch warning when netlist is not equivalent to truth table', () => {
    useStore.setState({
      rawInput: 'F = AB',
      vars: ['A', 'B'],
      truthTable: truthTableFromMinterms(['A', 'B'], [3]),
      activeVariant: 'simplified',
      netlists: {
        original: null,
        simplified: {
          name: 'buggy_circuit',
          inputs: ['A', 'B'],
          outputs: ['F'],
          nodes: [
            // OR gate instead of AND gate -> mismatch!
            { kind: 'gate', id: 'g1', type: 'OR', inputs: ['A', 'B'], output: 'F' },
          ],
        },
        nand: null,
        nor: null,
      },
    });

    const html = generateLabReportHtml(useStore.getState());
    expect(html).toContain('MISMATCH');
    expect(html).toContain('Verification Mismatch');
  });
});

