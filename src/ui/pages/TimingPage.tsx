import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useStore } from '../../store';
import type { NetId, Netlist, StateTable, StimulusEvent, Waveform } from '../../engine/types';
import {
  checkSetupHold,
  designFSM,
  findHazards,
  shiftRegister,
  simulateTimed,
  stateSequence,
  syncCounter,
  toCSV,
} from '../../engine';

const DEFAULTS = {
  duty: 50,
  edge: 'rising' as const,
  gateDelay: 1,
  clkToQ: 1,
  setup: 1,
  hold: 1,
};

const DETECTOR_1011: StateTable = {
  model: 'mealy',
  inputs: ['X'],
  outputs: ['Z'],
  states: ['S0', 'S1', 'S2', 'S3'],
  reset: 'S0',
  rows: [
    { state: 'S0', input: '0', next: 'S0', output: '0' },
    { state: 'S0', input: '1', next: 'S1', output: '0' },
    { state: 'S1', input: '0', next: 'S2', output: '0' },
    { state: 'S1', input: '1', next: 'S1', output: '0' },
    { state: 'S2', input: '0', next: 'S0', output: '0' },
    { state: 'S2', input: '1', next: 'S3', output: '0' },
    { state: 'S3', input: '0', next: 'S2', output: '0' },
    { state: 'S3', input: '1', next: 'S1', output: '1' },
  ],
};

type Preset = 'counter' | 'detector' | 'shift' | 'hazard' | 'current';
type SignalGroup = Waveform['signals'][number]['group'];

function hazardDemo(): Netlist {
  return {
    name: 'F = AB + A\u2032C (static-1 hazard)',
    inputs: ['A', 'B', 'C'],
    outputs: ['F'],
    nodes: [
      { kind: 'gate', id: 'not-a', type: 'NOT', inputs: ['A'], output: 'An', delay: 3 },
      { kind: 'gate', id: 'and-ab', type: 'AND', inputs: ['A', 'B'], output: 'AB', delay: 1 },
      { kind: 'gate', id: 'and-anc', type: 'AND', inputs: ['An', 'C'], output: 'AnC', delay: 1 },
      { kind: 'gate', id: 'or-f', type: 'OR', inputs: ['AB', 'AnC'], output: 'F', delay: 5 },
    ],
  };
}

function getPresetNetlist(
  preset: Preset,
  currentNetlist: Netlist | null,
  designedNetlist: Netlist | null
): Netlist | null {
  switch (preset) {
    case 'counter': return syncCounter(2, 'up', 'JK');
    case 'detector': return designFSM(DETECTOR_1011, 'D', 'binary').netlist;
    case 'shift': return shiftRegister('SIPO', 3);
    case 'hazard': return hazardDemo();
    case 'current': return currentNetlist ?? designedNetlist;
  }
}

function presetStimulus(preset: Preset, period: number): StimulusEvent[] {
  if (preset === 'hazard') {
    return [
      { t: 0, net: 'A', value: 1 },
      { t: 0, net: 'B', value: 1 },
      { t: 0, net: 'C', value: 1 },
      { t: 10, net: 'A', value: 0 },
    ];
  }
  if (preset === 'detector') {
    return [
      { t: 1, net: 'X', value: 1 },
      { t: period + 1, net: 'X', value: 0 },
      { t: period * 2 + 1, net: 'X', value: 1 },
      { t: period * 3 + 1, net: 'X', value: 1 },
    ];
  }
  if (preset === 'shift') {
    return [
      { t: 1, net: 'Din', value: 1 },
      { t: period + 1, net: 'Din', value: 1 },
      { t: period * 2 + 1, net: 'Din', value: 0 },
    ];
  }
  return [];
}

function downloadText(name: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function signalValue(signal: Waveform['signals'][number], time: number): 0 | 1 | 'x' {
  return signal.values[time] ?? 0;
}

export function TimingPage() {
  const {
    netlists,
    designedNetlist,
    stimulus,
    clockPeriod,
    totalDuration,
    setWaveform: updateStoredWaveform,
    setStimulus,
    setClockPeriod,
    setTotalDuration,
  } = useStore();
  const [preset, setPreset] = useState<Preset>(() => {
    const initialNetlist = useStore.getState().netlists.simplified
      ?? useStore.getState().netlists.original;
    return initialNetlist?.name.includes('hazard') ? 'hazard' : 'counter';
  });
  const [duty, setDuty] = useState(DEFAULTS.duty);
  const [edge, setEdge] = useState<'rising' | 'falling'>(DEFAULTS.edge);
  const [gateDelay, setGateDelay] = useState(DEFAULTS.gateDelay);
  const [clkToQ, setClkToQ] = useState(DEFAULTS.clkToQ);
  const [setup, setSetup] = useState(DEFAULTS.setup);
  const [hold, setHold] = useState(DEFAULTS.hold);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingPng, setExportingPng] = useState(false);
  const [waveform, setLocalWaveform] = useState<Waveform | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const playheadRef = useRef(0);
  const setWaveform = (value: Waveform | null) => {
    setLocalWaveform(value);
    updateStoredWaveform(value);
  };

  const currentNetlist = netlists.simplified ?? netlists.original;
  const activeNetlist = useMemo(
    () => getPresetNetlist(preset, currentNetlist, designedNetlist),
    [preset, currentNetlist, designedNetlist]
  );
  const activeFlops = useMemo(
    () => activeNetlist?.nodes.filter((node) => node.kind === 'ff') ?? [],
    [activeNetlist]
  );
  const stateNets = useMemo(() => {
    if (!activeNetlist) return [];
    const qNets = new Set(activeFlops.map((flop) => flop.q));
    const outputStateNets = activeNetlist.outputs.filter((output) => qNets.has(output));
    return outputStateNets.length > 0
      ? outputStateNets
      : activeFlops.map((flop) => flop.q).reverse();
  }, [activeNetlist, activeFlops]);
  const stateChanges = useMemo(
    () => waveform && stateNets.length > 0 ? stateSequence(waveform, stateNets) : [],
    [waveform, stateNets]
  );
  const hazardWarnings = useMemo(
    () => activeNetlist ? findHazards(activeNetlist) : [],
    [activeNetlist]
  );
  const timingViolations = useMemo(
    () => waveform && activeNetlist
      ? checkSetupHold(activeNetlist, waveform, { setup, hold }).violations
      : [],
    [waveform, activeNetlist, setup, hold]
  );

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const next = Math.min(totalDuration, playheadRef.current + 1);
      playheadRef.current = next;
      setPlayhead(next);
      if (next >= totalDuration) setPlaying(false);
    }, 150);
    return () => window.clearInterval(timer);
  }, [playing, totalDuration]);

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  const runSimulation = () => {
    if (!activeNetlist) {
      setError('Choose a preset or generate a circuit before running timing simulation.');
      return;
    }
    try {
      const result = simulateTimed(activeNetlist, stimulus, {
        clockPeriod,
        duty: duty / 100,
        edge,
        defaultGateDelay: gateDelay,
        clkToQ,
        endTime: totalDuration,
      });
      setWaveform(result);
      playheadRef.current = 0;
      setPlayhead(0);
      setError(null);
    } catch (simulationError) {
      setWaveform(null);
      setError(simulationError instanceof Error ? simulationError.message : String(simulationError));
    }
  };

  const handlePresetChange = (nextPreset: Preset) => {
    setPreset(nextPreset);
    setPlaying(false);
    playheadRef.current = 0;
    setPlayhead(0);
    setWaveform(null);
    setStimulus(presetStimulus(nextPreset, clockPeriod));
    setError(null);
  };

  const addInputChange = (net: NetId, event: MouseEvent<SVGRectElement>) => {
    if (!waveform || !activeNetlist?.inputs.includes(net)) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const width = svg.viewBox.baseVal.width || rect.width;
    const x = event.clientX - rect.left;
    const scale = width / rect.width;
    const tick = Math.max(0, Math.min(totalDuration, Math.round((x * scale - 100) / 12)));
    const signal = waveform.signals.find((item) => item.name === net);
    const index = waveform.time.findIndex((time) => time >= tick);
    const value = signal ? signal.values[Math.max(0, index - 1)] ?? 0 : 0;
    const next = (1 - (value === 'x' ? 0 : value)) as 0 | 1;
    const remaining = stimulus.filter((item) => item.net !== net || item.t !== tick);
    setStimulus([...remaining, { t: tick, net, value: next }].sort((a, b) => a.t - b.t));
    setWaveform(null);
    playheadRef.current = tick;
    setPlayhead(tick);
    setError(null);
  };

  const exportSvg = () => {
    const svg = svgRef.current;
    if (!svg) return;
    downloadText('aletheia-timing-waveform.svg', new XMLSerializer().serializeToString(svg), 'image/svg+xml');
  };

  const exportPng = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    setExportingPng(true);
    try {
      const source = new XMLSerializer().serializeToString(svg);
      const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
      try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('The SVG waveform could not be rendered as a PNG.'));
          image.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = svg.viewBox.baseVal.width;
        canvas.height = svg.viewBox.baseVal.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('PNG export is unavailable because a canvas context could not be created.');
        context.fillStyle = '#101827';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG encoding failed.')), 'image/png');
        });
        const pngUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = pngUrl;
        anchor.download = 'aletheia-timing-waveform.png';
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(pngUrl), 0);
        setError(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setExportingPng(false);
    }
  };

  const groupOrder: SignalGroup[] = ['clock', 'input', 'state', 'output', 'internal'];
  const groupLabels: Record<SignalGroup, string> = {
    clock: 'Clock',
    input: 'Inputs',
    state: 'State',
    output: 'Outputs',
    internal: 'Internal signals',
  };
  const rowLayout: { name: string; group: SignalGroup; y: number }[] = [];
  let nextY = 34;
  for (const group of groupOrder) {
    const groupSignals = (waveform?.signals ?? []).filter((signal) => signal.group === group);
    if (groupSignals.length === 0) continue;
    nextY += 20;
    for (const signal of groupSignals) {
      rowLayout.push({ name: signal.name, group, y: nextY });
      nextY += 30;
    }
  }
  const svgWidth = Math.max(760, 130 + totalDuration * 12);
  const svgHeight = Math.max(160, nextY + 28);
  const tickStep = Math.max(1, Math.floor(clockPeriod / 2));
  const cursorIndex = waveform
    ? Math.max(0, waveform.time.findLastIndex((time) => time <= playhead))
    : 0;
  const cursorValues = waveform?.signals.map((signal) => ({
    name: signal.name,
    value: signalValue(signal, cursorIndex),
  })) ?? [];

  return (
    <div className="page-container timing-page">
      <div className="page-header">
        <div>
          <h1>Timing Diagrams &amp; Hazards</h1>
          <p className="page-subtitle">Clock edges, propagation delay, setup and hold, and visible logic hazards.</p>
        </div>
      </div>

      <section className="card timing-controls">
        <div className="timing-control-grid">
          <label>Preset
            <select value={preset} onChange={(event) => handlePresetChange(event.target.value as Preset)}>
              <option value="counter">2-bit JK counter</option>
              <option value="detector">Sequence detector 1011</option>
              <option value="shift">3-bit SIPO shift register</option>
              <option value="hazard">Hazard demo</option>
              <option value="current">Current circuit / FSM</option>
            </select>
          </label>
          <label>Clock period (ticks)
            <input type="number" min="2" step="1" value={clockPeriod}
              onChange={(event) => setClockPeriod(Math.max(2, Number(event.target.value) || 2))} />
          </label>
          <label>Duty cycle (%)
            <input type="number" min="1" max="99" step="1" value={duty}
              onChange={(event) => setDuty(Math.min(99, Math.max(1, Number(event.target.value) || 50)))} />
          </label>
          <label>Active edge
            <select value={edge} onChange={(event) => setEdge(event.target.value as 'rising' | 'falling')}>
              <option value="rising">Rising</option>
              <option value="falling">Falling</option>
            </select>
          </label>
          <label>Default gate delay
            <input type="number" min="0" step="1" value={gateDelay}
              onChange={(event) => setGateDelay(Math.max(0, Number(event.target.value) || 0))} />
          </label>
          <label>Clock-to-Q delay
            <input type="number" min="0" step="1" value={clkToQ}
              onChange={(event) => setClkToQ(Math.max(0, Number(event.target.value) || 0))} />
          </label>
          <label>Run length (ticks)
            <input type="number" min="1" max="1000" step="1" value={totalDuration}
              onChange={(event) => setTotalDuration(Math.min(1000, Math.max(1, Number(event.target.value) || 1)))} />
          </label>
          <label>Setup / hold (ticks)
            <span className="timing-window-inputs">
              <input aria-label="Setup ticks" type="number" min="0" value={setup}
                onChange={(event) => setSetup(Math.max(0, Number(event.target.value) || 0))} />
              <input aria-label="Hold ticks" type="number" min="0" value={hold}
                onChange={(event) => setHold(Math.max(0, Number(event.target.value) || 0))} />
            </span>
          </label>
        </div>
        <div className="timing-action-row">
          <button className="btn-primary-large" onClick={runSimulation}>Run simulation</button>
          <button className="btn-secondary" disabled={!waveform} onClick={() => setPlaying((value) => !value)}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button className="btn-secondary" disabled={!waveform}
            onClick={() => setPlayhead((time) => Math.min(totalDuration, time + clockPeriod))}>
            Step one clock
          </button>
          <button className="btn-secondary" disabled={!waveform} onClick={exportSvg}>Export SVG</button>
          <button className="btn-secondary" disabled={!waveform || exportingPng} onClick={() => void exportPng()}>
            {exportingPng ? 'Exporting PNG…' : 'Export PNG'}
          </button>
          <button className="btn-secondary" disabled={!waveform}
            onClick={() => waveform && downloadText('aletheia-timing-waveform.csv', toCSV(waveform), 'text/csv')}>
            Export CSV
          </button>
        </div>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {!activeNetlist && (
          <p className="timing-note">No generated circuit is available yet. Choose one of the built-in presets.</p>
        )}
      </section>

      <section className="card timing-stimulus-card">
        <div className="section-header">
          <div>
            <h2>Input stimulus</h2>
            <p className="card-subtitle">Click an input row in the waveform to toggle it at that time.</p>
          </div>
          <span className="info-tag">{stimulus.length} scheduled changes</span>
        </div>
        {stimulus.length === 0 ? (
          <p className="timing-note">No manual input changes. Inputs start at 0 unless set below.</p>
        ) : (
          <div className="timing-stimulus-list">
            {stimulus.map((item, index) => (
              <span className="timing-stimulus-chip" key={`${item.net}-${item.t}-${index}`}>
                t={item.t}: {item.net}={item.value}
                <button aria-label={`Remove ${item.net} change at tick ${item.t}`} onClick={() => {
                  setStimulus(stimulus.filter((_, itemIndex) => itemIndex !== index));
                  setWaveform(null);
                }}>×</button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card timing-waveform-card">
        <div className="section-header">
          <div>
            <h2>Waveform viewer</h2>
            <p className="card-subtitle">Transport-delay events are retained so short glitches remain visible.</p>
          </div>
          {waveform && <span className="metric-pill">{waveform.signals.length} signals · {waveform.time.length} time points</span>}
        </div>
        {!waveform ? (
          <div className="timing-empty-state">Run the simulation to inspect the digital waveforms.</div>
        ) : (
          <>
            <div className="timing-svg-viewport">
              <svg ref={svgRef} width={svgWidth} height={svgHeight}
                viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="timing-waveform-svg"
                role="img" aria-label="Digital signal timing waveforms">
                <rect width={svgWidth} height={svgHeight} fill="#101827" />
                <text x="12" y="19" className="timing-axis-label">Signal</text>
                <line x1="100" x2={svgWidth - 12} y1="28" y2="28" className="timing-axis" />
                {Array.from({ length: Math.floor(totalDuration / tickStep) + 1 }, (_, index) => index * tickStep)
                  .filter((time) => time <= totalDuration)
                  .map((time) => {
                    const x = 100 + time * 12;
                    return (
                      <g key={`tick-${time}`}>
                        <line x1={x} x2={x} y1="26" y2={svgHeight - 12} className="timing-grid-line" />
                        <text x={x + 3} y="20" className="timing-tick-label">{time}</text>
                      </g>
                    );
                  })}
                {rowLayout.map((row, rowIndex) => {
                  const signal = waveform.signals.find((item) => item.name === row.name);
                  if (!signal) return null;
                  const previousGroup = rowLayout[rowIndex - 1]?.group;
                  const highY = row.y + 4;
                  const lowY = row.y + 19;
                  const d = signal.values.map((value, index) => {
                    const x = 100 + (waveform.time[index] ?? 0) * 12;
                    const y = value === 1 ? highY : lowY;
                    if (index === 0) return `M ${x} ${y}`;
                    return `H ${x} V ${y}`;
                  }).join(' ');
                  const isInput = row.group === 'input';
                  return (
                    <g key={`row-${row.name}`}>
                      {previousGroup !== row.group && (
                        <text x="12" y={row.y - 7} className="timing-group-label">{groupLabels[row.group]}</text>
                      )}
                      <rect x="0" y={row.y} width={svgWidth} height="26" className="timing-row-background"
                        onClick={isInput ? (event) => addInputChange(row.name, event) : undefined}
                        style={isInput ? { cursor: 'crosshair' } : undefined} />
                      <text x="12" y={row.y + 17} className="timing-signal-name">{row.name}</text>
                      <path d={d} className={`timing-signal-path ${row.group}`} pointerEvents="none" />
                      {stateNets[0] === row.name && stateChanges.map((change) => (
                        <text key={`${row.name}-${change.t}`} x={104 + change.t * 12} y={row.y - 1}
                          className="timing-state-label">{change.state}</text>
                      ))}
                    </g>
                  );
                })}
                {waveform.events.filter((event) => event.label.startsWith('active-edge:')).map((event, index) => {
                  const x = 100 + event.t * 12;
                  return (
                    <path key={`edge-${event.t}-${index}`} d={`M ${x - 4} 30 L ${x + 4} 30 L ${x} 37 Z`}
                      className="timing-edge-marker" />
                  );
                })}
                {waveform.events.filter((event) => event.label.startsWith('glitch:')).map((event, index) => {
                  const x = 100 + event.t * 12;
                  return <line key={`glitch-${event.t}-${index}`} x1={x} x2={x} y1="28" y2={svgHeight - 12}
                    className="timing-glitch-marker" />;
                })}
                {timingViolations.map((violation, index) => {
                  const x = 100 + violation.t * 12;
                  return <path key={`violation-${violation.ff}-${violation.t}-${index}`}
                    d={`M ${x - 4} ${svgHeight - 8} L ${x + 4} ${svgHeight - 8} L ${x} ${svgHeight - 16} Z`}
                    className="timing-violation-marker" />;
                })}
                <line x1={100 + playhead * 12} x2={100 + playhead * 12} y1="24" y2={svgHeight - 12}
                  className="timing-cursor" />
              </svg>
            </div>
            <div className="timing-playhead-row">
              <label htmlFor="timing-playhead">Cursor: t={playhead}</label>
              <input id="timing-playhead" type="range" min="0" max={totalDuration} value={playhead}
                onChange={(event) => setPlayhead(Number(event.target.value))} />
            </div>
            <div className="timing-value-strip" aria-live="polite">
              {cursorValues.map(({ name, value }) => (
                <span key={name} data-testid={`timing-value-${name}`}><b>{name}</b>={value}</span>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="timing-results-grid">
        <section className="card">
          <h2>State sequence</h2>
          {stateChanges.length > 0 ? (
            <div className="timing-sequence-list">
              {stateChanges.map((change) => <span key={`${change.t}-${change.state}`}>t={change.t} <b>{change.state}</b></span>)}
            </div>
          ) : <p className="timing-note">This preset has no state outputs.</p>}
        </section>
        <section className="card">
          <h2>Hazard analysis</h2>
          {hazardWarnings.length > 0 ? hazardWarnings.map((hazard) => (
            <div className="timing-warning" key={`${hazard.where}-${hazard.type}`}>
              <b>{hazard.type.replace('-', ' ')} hazard</b>
              <span>{hazard.where}</span>
              {hazard.fix && <span>Suggested consensus term: <code>{hazard.fix}</code></span>}
            </div>
          )) : <p className="timing-note">No static-1 hazard was found in a recognizable two-level SOP output.</p>}
          {timingViolations.length > 0 && (
            <div className="timing-warning" role="status">
              <b>Setup / hold violations</b>
              {timingViolations.map((violation, index) => (
                <span key={`${violation.ff}-${violation.t}-${violation.kind}-${index}`}>
                  {violation.ff} at t={violation.t}: {violation.kind}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
