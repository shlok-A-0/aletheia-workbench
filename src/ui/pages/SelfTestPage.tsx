import { useState } from 'react';
import { runSystemSelfTests } from '../selfTest';

export function SelfTestPage() {
  const [results, setResults] = useState(runSystemSelfTests);
  const passed = results.filter((result) => result.passed).length;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>System Self-Test</h1>
        <p className="subtitle">Deterministic golden examples exercise minimization, circuit conversion, simulation, and sequential analysis.</p>
      </div>
      <section className="glass-card selftest-summary" aria-live="polite">
        <strong>{passed}/{results.length} checks passing</strong>
        <button className="btn-primary" onClick={() => setResults(runSystemSelfTests())}>Run again</button>
      </section>
      <ul className="selftest-list">
        {results.map((result) => (
          <li className={`glass-card selftest-result ${result.passed ? 'passed' : 'failed'}`} key={result.name}>
            <span aria-label={result.passed ? 'Passed' : 'Failed'}>{result.passed ? '✓' : '✗'}</span>
            <div><strong>{result.name}</strong><p>{result.detail}</p></div>
          </li>
        ))}
      </ul>
    </div>
  );
}
