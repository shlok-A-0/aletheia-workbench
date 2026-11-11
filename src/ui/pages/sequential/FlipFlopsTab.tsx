import { useState, useMemo, useCallback } from 'react';
import type { FFType } from '../../../engine/types';
import { characteristicTable, excitationTable, characteristicEquation, nextQ } from '../../../engine/sequential/flipflops';

export function FlipFlopsTab() {
  const [selectedFF, setSelectedFF] = useState<FFType>('JK');
  const [liveQ, setLiveQ] = useState<0 | 1>(0);
  const [ffInputs, setFfInputs] = useState<Record<string, 0 | 1>>({ J: 1, K: 1, D: 1, T: 1, S: 1, R: 0 });
  const [asyncPreset, setAsyncPreset] = useState(false);
  const [asyncClear, setAsyncClear] = useState(false);
  const [ffWarning, setFFWarning] = useState<string | null>(null);

  const charRows = useMemo(() => characteristicTable(selectedFF), [selectedFF]);
  const excitRows = useMemo(() => excitationTable(selectedFF), [selectedFF]);
  const charEq = useMemo(() => characteristicEquation(selectedFF), [selectedFF]);

  const [ffHistory, setFfHistory] = useState<{ q: 0 | 1; note: string }[]>([{ q: 0, note: 'reset' }]);
  const [ffPulse, setFfPulse] = useState(0);

  /** What the next clock edge will do, shown live so the button never feels dead. */
  const ffPreview = useMemo<{ next: 0 | 1; note: string; warn?: string }>(() => {
    if (asyncClear) return { next: 0, note: 'async clear forces Q = 0' };
    if (asyncPreset) return { next: 1, note: 'async preset forces Q = 1' };
    if (selectedFF === 'SR' && ffInputs.S === 1 && ffInputs.R === 1) {
      return { next: liveQ, note: 'invalid S = R = 1, state held', warn: 'Invalid SR input S=R=1; state remains unchanged.' };
    }
    const n = nextQ(selectedFF, liveQ, ffInputs);
    const next: 0 | 1 = n === 'x' ? 0 : n;
    return { next, note: next === liveQ ? 'hold' : next === 1 ? 'set' : 'reset' };
  }, [selectedFF, liveQ, ffInputs, asyncPreset, asyncClear]);

  const handleStepFFClock = useCallback(() => {
    setFFWarning(ffPreview.warn ?? null);
    setLiveQ(ffPreview.next);
    setFfPulse((n) => n + 1);
    setFfHistory((h) => [...h.slice(-15), { q: ffPreview.next, note: ffPreview.note }]);
  }, [ffPreview]);

  const resetFF = useCallback(() => {
    setLiveQ(0);
    setFfPulse(0);
    setFFWarning(null);
    setFfHistory([{ q: 0, note: 'reset' }]);
  }, []);

  const toggleFFInput = useCallback((name: string) => {
    setFfInputs((prev) => ({
      ...prev,
      [name]: prev[name] === 1 ? 0 : 1,
    }));
  }, []);

  return (
    <>
        <div className="tab-pane-sequential">
          {/* FF Type Selector Chips */}
          <div className="wb-seg u-mb-4">
            {(['SR', 'D', 'JK', 'T'] as FFType[]).map((type) => (
              <button
                key={type}
                className={selectedFF === type ? 'is-on' : undefined}
                onClick={() => setSelectedFF(type)}
              >
                {type} Flip-Flop
              </button>
            ))}
          </div>

          <ul className="dp-stats">
            <li className="dp-stat">
              <span className="stat-label">Characteristic equation</span>
              <b className="stat-value">{charEq}</b>
            </li>
          </ul>

          <div className="ff-grid-layout">
            {/* Live Interactive Simulator */}
            <div className="dp-panel ff-card">
              <h3 className="card-title">Live Simulator</h3>
              <p className="card-subtitle">Set inputs and trigger an active clock transition</p>

              <div className="ff-live-state-box">
                <div className="ff-state-badge">
                  <span className="state-label">Q</span>
                  <span className={`state-digit ${liveQ === 1 ? 'high' : 'low'}`}>{liveQ}</span>
                </div>
                <div className="ff-state-badge">
                  <span className="state-label">Q'</span>
                  <span className={`state-digit ${liveQ === 0 ? 'high' : 'low'}`}>{liveQ === 1 ? 0 : 1}</span>
                </div>
              </div>

              <div className="circuit-input-switches u-center-row u-mt-3">
                {selectedFF === 'D' && (
                  <button
                    className={`input-switch ${ffInputs.D === 1 ? 'on' : 'off'}`}
                    onClick={() => toggleFFInput('D')}
                  >
                    <span className="switch-name">D</span>
                    <span className="switch-val">{ffInputs.D ?? 0}</span>
                  </button>
                )}
                {selectedFF === 'T' && (
                  <button
                    className={`input-switch ${ffInputs.T === 1 ? 'on' : 'off'}`}
                    onClick={() => toggleFFInput('T')}
                  >
                    <span className="switch-name">T</span>
                    <span className="switch-val">{ffInputs.T ?? 0}</span>
                  </button>
                )}
                {selectedFF === 'JK' && (
                  <>
                    <button
                      className={`input-switch ${ffInputs.J === 1 ? 'on' : 'off'}`}
                      onClick={() => toggleFFInput('J')}
                    >
                      <span className="switch-name">J</span>
                      <span className="switch-val">{ffInputs.J ?? 0}</span>
                    </button>
                    <button
                      className={`input-switch ${ffInputs.K === 1 ? 'on' : 'off'}`}
                      onClick={() => toggleFFInput('K')}
                    >
                      <span className="switch-name">K</span>
                      <span className="switch-val">{ffInputs.K ?? 0}</span>
                    </button>
                  </>
                )}
                {selectedFF === 'SR' && (
                  <>
                    <button
                      className={`input-switch ${ffInputs.S === 1 ? 'on' : 'off'}`}
                      onClick={() => toggleFFInput('S')}
                    >
                      <span className="switch-name">S</span>
                      <span className="switch-val">{ffInputs.S ?? 0}</span>
                    </button>
                    <button
                      className={`input-switch ${ffInputs.R === 1 ? 'on' : 'off'}`}
                      onClick={() => toggleFFInput('R')}
                    >
                      <span className="switch-name">R</span>
                      <span className="switch-val">{ffInputs.R ?? 0}</span>
                    </button>
                  </>
                )}
              </div>

              <div className="circuit-input-switches u-center-row u-mt-3">
                <label>
                  <input type="checkbox" checked={asyncPreset} onChange={(event) => setAsyncPreset(event.target.checked)} />
                  Async preset
                </label>
                <label>
                  <input type="checkbox" checked={asyncClear} onChange={(event) => setAsyncClear(event.target.checked)} />
                  Async clear
                </label>
              </div>
              {ffWarning && <div className="verify-badge fail" role="alert">{ffWarning}</div>}

              <p className="ff-preview" aria-live="polite">
                On the next edge: Q <b>{liveQ}</b> <span aria-hidden="true">→</span> <b className={ffPreview.next === 1 ? 'is-1' : undefined}>{ffPreview.next}</b>
                <span className="ff-note"> {ffPreview.note}</span>
              </p>
              <div className="ff-actions">
                <button type="button" className="btn-primary" onClick={handleStepFFClock}>
                  Pulse clock{ffPulse > 0 ? ` · ${ffPulse}` : ''}
                </button>
                <button type="button" className="btn-secondary" onClick={resetFF}>Reset</button>
              </div>
              <div className="ff-wave" aria-label="Q history, oldest first">
                {ffHistory.map((h, i) => (
                  <span key={i} className={`ff-step${h.q === 1 ? ' is-1' : ''}`} title={`edge ${i}: Q=${h.q} (${h.note})`} />
                ))}
              </div>
            </div>

            {/* Characteristic Table */}
            <div className="dp-panel ff-card">
              <h3 className="card-title">Characteristic Table</h3>
              <p className="card-subtitle">Next state Q+ given current Q and synchronous inputs</p>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {Object.keys(charRows[0]?.inputs ?? {}).map((k) => (
                        <th key={k}>{k}</th>
                      ))}
                      <th>Q(t)</th>
                      <th>Q(t+1)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charRows.map((r, i) => (
                      <tr key={i}>
                        {Object.values(r.inputs).map((v, j) => (
                          <td key={j} className="mono-cell">{v}</td>
                        ))}
                        <td className="mono-cell">{r.q}</td>
                        <td className="mono-cell highlight-cell">{r.nextQ}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Excitation Table */}
            <div className="dp-panel ff-card">
              <h3 className="card-title">Excitation Table</h3>
              <p className="card-subtitle">Required inputs to drive state transition Q → Q+</p>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Q(t)</th>
                      <th>Q(t+1)</th>
                      {Object.keys(excitRows[0]?.inputs ?? {}).map((k) => (
                        <th key={k}>{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {excitRows.map((r, i) => (
                      <tr key={i}>
                        <td className="mono-cell">{r.q}</td>
                        <td className="mono-cell">{r.nextQ}</td>
                        {Object.values(r.inputs).map((v, j) => (
                          <td key={j} className="mono-cell highlight-cell">{v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
    </>
  );
}
