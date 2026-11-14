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
import { PageHead } from '../deep/PageHead';
import { standaloneSvg } from '../export/svgExport';
import { outputLabel } from '../schematic/elkLayout';

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

/** Counts a combinational circuit through every input combination, one per clock period, so the waveform is never flat. */
function countThroughInputs(netlist: Netlist, period: number): StimulusEvent[] {
  const n = netlist.inputs.length;
  const events: StimulusEvent[] = [];
  const last = new Map<string, 0 | 1>();
  for (let i = 0; i < 1 << n; i++) {
    netlist.inputs.forEach((name, bit) => {
      const value = ((i >> (n - 1 - bit)) & 1) as 0 | 1;
      if (value !== (last.get(name) ?? 0)) events.push({ t: i * period, net: name, value });
      last.set(name, value);
    });
  }
  return events;
}

function presetStimulus(preset: Preset, period: number, netlist: Netlist | null = null): StimulusEvent[] {
  if (preset === 'current' && netlist && !netlist.nodes.some((node) => node.kind === 'ff') && netlist.inputs.length <= 4) {
    return countThroughInputs(netlist, period);
  }
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

/** A downloaded PNG has a fixed dark backdrop so it reads the same in any theme. */
const EXPORT_BACKGROUND = '#0c0e13';

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
    const st = useStore.getState();
    const initialNetlist = st.netlists.simplified ?? st.netlists.original ?? st.designedNetlist;
    if (initialNetlist?.name.includes('hazard')) return 'hazard';
    return initialNetlist ? 'current' : 'counter';
  });
  const [showInternal, setShowInternal] = useState(false);
  const [variant, setVariant] = useState<'simplified' | 'original' | 'nand' | 'nor'>('simplified');
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
  const [exportOpen, setExportOpen] = useState(false);
  const [waveform, setLocalWaveform] = useState<Waveform | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef(0);
  const pendingSeed = useRef(false);
  const setWaveform = (value: Waveform | null) => {
    setLocalWaveform(value);
    updateStoredWaveform(value);
  };

  const currentNetlist = netlists[variant] ?? netlists.simplified ?? netlists.original;
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
    if (viewportRef.current) {
      const vp = viewportRef.current;
      const cursorX = 100 + playhead * 12;
      const minVisible = vp.scrollLeft + 80;
      const maxVisible = vp.scrollLeft + vp.clientWidth - 80;
      if (cursorX < minVisible || cursorX > maxVisible) {
        vp.scrollLeft = Math.max(0, cursorX - vp.clientWidth / 2);
      }
    }
  }, [playhead]);

  const runSimulation = () => {
    if (!activeNetlist) {
      setError('Choose a preset or generate a circuit before running timing simulation.');
      return;
    }
    try {
      // Never feed the simulator events for inputs this circuit doesn't have.
      const usable = stimulus.filter((item) => activeNetlist.inputs.includes(item.net));
      const result = simulateTimed(activeNetlist, usable, {
        clockPeriod,
        duty: duty / 100,
        edge,
        defaultGateDelay: gateDelay,
        clkToQ,
        endTime: totalDuration,
        // First active edge mid-way through the first period, away from t = 0 where inputs are still settling.
        clockOffset: Math.floor(clockPeriod / 2),
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
    const nl = getPresetNetlist(nextPreset, currentNetlist, designedNetlist);
    const seeded = presetStimulus(nextPreset, clockPeriod, nl);
    setStimulus(seeded);
    if (seeded.length > 0) setTotalDuration(Math.max(totalDuration, (seeded.at(-1)?.t ?? 0) + clockPeriod * 2));
    setError(null);
  };

  // Opening the page on the student's own combinational circuit: seed a stimulus once so there is something to see.
  useEffect(() => {
    // A stimulus left over from another circuit (its nets are gone) is as good as none.
    const stale = activeNetlist ? stimulus.some((item) => !activeNetlist.inputs.includes(item.net)) : false;
    if (preset === 'current' && (stimulus.length === 0 || stale) && activeNetlist) {
      const seeded = presetStimulus('current', clockPeriod, activeNetlist);
      if (seeded.length > 0) {
        pendingSeed.current = true;
        setStimulus(seeded);
        setTotalDuration(Math.max(totalDuration, (seeded.at(-1)?.t ?? 0) + clockPeriod * 2));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Simulate automatically whenever there is a circuit but no waveform (first visit, preset change, edited stimulus).
  useEffect(() => {
    if (pendingSeed.current) {
      pendingSeed.current = false;
      return;
    }
    if (!waveform && activeNetlist && !error) runSimulation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveform, activeNetlist, error, stimulus]);

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
    // The value drawn at the clicked tick: the last sample at or before it.
    let index = 0;
    waveform.time.forEach((time, i) => { if (time <= tick) index = i; });
    const value = signal ? signal.values[index] ?? 0 : 0;
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
    downloadText('aletheia-timing-waveform.svg', standaloneSvg(svg), 'image/svg+xml');
  };

  const exportPng = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    setExportingPng(true);
    try {
      const source = standaloneSvg(svg);
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
        context.fillStyle = EXPORT_BACKGROUND;
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
    internal: 'Internal (between gates)',
  };
  const rowLayout: { name: string; group: SignalGroup; y: number }[] = [];
  let nextY = 34;
  for (const group of groupOrder) {
        if (group === 'internal' && !showInternal) continue;
    if (group === 'clock' && activeFlops.length === 0) continue;
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
  const internalCount = waveform?.signals.filter((signal) => signal.group === 'internal').length ?? 0;
  /** Generated net ids (or_3, and_1…) become the output's real name, F, wherever a student reads them. */
  const shown = (name: string) => {
    // Generated complement nets (qn0_2) read as Q0′ rather than an internal id.
    const complement = /^qn(\d+)(?:_\d+)?$/.exec(name);
    if (complement) return `Q${complement[1]}′`;
    const i = activeNetlist?.outputs.indexOf(name) ?? -1;
    return activeNetlist && i >= 0 ? outputLabel(name, i, activeNetlist.outputs.length) : name;
  };
  const cursorValues = waveform?.signals.filter((signal) => (showInternal || signal.group !== 'internal') && (activeFlops.length > 0 || signal.group !== 'clock')).map((signal) => ({
    name: signal.name,
    label: shown(signal.name),
    value: signalValue(signal, cursorIndex),
  })) ?? [];

  return (
    <div className="page-container dp timing-page">
      <PageHead kicker="02 / Timing" title="Timing Diagrams & Hazards" sub="Clock edges, propagation delay, setup and hold, and visible logic hazards." />

      <section className="dp-panel timing-controls">
        <div className="dp-toolbar">
          <label className="dp-field">
            <span className="t-label">Circuit</span>
            <select aria-label="Preset" value={preset} onChange={(event) => handlePresetChange(event.target.value as Preset)}>
              <option value="current" disabled={!currentNetlist && !designedNetlist}>
                {currentNetlist || designedNetlist ? (currentNetlist ? 'Your circuit' : `Your circuit · ${designedNetlist?.name}`) : 'Your circuit (generate one first)'}
              </option>
              <optgroup label="Examples">
                <option value="counter">2-bit JK counter</option>
                <option value="detector">Sequence detector 1011</option>
                <option value="shift">3-bit SIPO shift register</option>
                <option value="hazard">Hazard demo</option>
              </optgroup>
            </select>
          </label>
          {preset === 'current' && netlists.simplified && (
            <label className="dp-field">
              <span className="t-label">Gate-level version</span>
              <select aria-label="Gate-level version" value={variant} onChange={(event) => {
                setVariant(event.target.value as typeof variant);
                setPlaying(false);
                setWaveform(null);
              }}>
                <option value="simplified">Simplified (minimal SOP)</option>
                <option value="original" disabled={!netlists.original}>As typed (original)</option>
                <option value="nand" disabled={!netlists.nand}>NAND-only</option>
                <option value="nor" disabled={!netlists.nor}>NOR-only</option>
              </select>
            </label>
          )}
        </div>
        <div className="timing-action-row">
          <button className="btn-primary" onClick={runSimulation}>Run simulation</button>
          <button className="btn-secondary" disabled={!waveform} onClick={() => setPlaying((value) => !value)}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button className="btn-secondary" disabled={!waveform}
            onClick={() => setPlayhead((time) => Math.min(totalDuration, time + clockPeriod))}>
            Step one clock
          </button>
          <div className="timing-export">
            <button type="button" className="btn-secondary" disabled={!waveform || exportingPng} aria-haspopup="menu"
              aria-expanded={exportOpen} onClick={() => setExportOpen(!exportOpen)}>
              {exportingPng ? 'Exporting…' : 'Export ▾'}
            </button>
            {exportOpen && (
              <div className="timing-export-menu" role="menu" onKeyDown={(event) => { if (event.key === 'Escape') setExportOpen(false); }}>
                <button type="button" role="menuitem" onClick={() => { setExportOpen(false); exportSvg(); }}>SVG · vector image</button>
                <button type="button" role="menuitem" onClick={() => { setExportOpen(false); void exportPng(); }}>PNG · picture</button>
                <button type="button" role="menuitem"
                  onClick={() => { setExportOpen(false); if (waveform) downloadText('aletheia-timing-waveform.csv', toCSV(waveform), 'text/csv'); }}>
                  CSV · raw data
                </button>
              </div>
            )}
          </div>
        </div>
        <details className="dp-derivation">
          <summary className="t-label">Timing parameters · clock, delays, setup / hold</summary>
          <div className="dp-params">
            <label className="dp-field"><span className="t-label">Clock period (ticks)</span>
              <input type="number" min="2" step="1" value={clockPeriod}
                onChange={(event) => setClockPeriod(Math.max(2, Number(event.target.value) || 2))} />
            </label>
            <label className="dp-field"><span className="t-label">Duty cycle (%)</span>
              <input type="number" min="1" max="99" step="1" value={duty}
                onChange={(event) => setDuty(Math.min(99, Math.max(1, Number(event.target.value) || 50)))} />
            </label>
            <label className="dp-field"><span className="t-label">Active edge</span>
              <select value={edge} onChange={(event) => setEdge(event.target.value as 'rising' | 'falling')}>
                <option value="rising">Rising</option>
                <option value="falling">Falling</option>
              </select>
            </label>
            <label className="dp-field"><span className="t-label">Default gate delay</span>
              <input type="number" min="0" step="1" value={gateDelay}
                onChange={(event) => setGateDelay(Math.max(0, Number(event.target.value) || 0))} />
            </label>
            <label className="dp-field"><span className="t-label">Clock-to-Q delay</span>
              <input type="number" min="0" step="1" value={clkToQ}
                onChange={(event) => setClkToQ(Math.max(0, Number(event.target.value) || 0))} />
            </label>
            <label className="dp-field"><span className="t-label">Run length (ticks)</span>
              <input type="number" min="1" max="1000" step="1" value={totalDuration}
                onChange={(event) => setTotalDuration(Math.min(1000, Math.max(1, Number(event.target.value) || 1)))} />
            </label>
            <label className="dp-field"><span className="t-label">Setup (ticks)</span>
              <input aria-label="Setup ticks" type="number" min="0" value={setup}
                onChange={(event) => setSetup(Math.max(0, Number(event.target.value) || 0))} />
            </label>
            <label className="dp-field"><span className="t-label">Hold (ticks)</span>
              <input aria-label="Hold ticks" type="number" min="0" value={hold}
                onChange={(event) => setHold(Math.max(0, Number(event.target.value) || 0))} />
            </label>
          </div>
        </details>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {!activeNetlist && (
          <p className="dp-note" role="note">No circuit yet. Generate one in the workbench, or pick an example above.</p>
        )}
      </section>

      <section className="dp-panel timing-waveform-card">
        <div className="section-header">
          <div>
            <h2>Waveform viewer</h2>
            <p className="card-subtitle">Click an input row to flip that input at that moment. Transport-delay events are retained so short glitches remain visible.</p>
          </div>
          {waveform && <span className="metric-pill">{waveform.signals.length} signals · {waveform.time.length} time points</span>}
        </div>
        <div className="timing-stimulus-actions">
          <button type="button" className="btn-secondary" disabled={stimulus.length === 0} onClick={() => {
            setStimulus([]);
            setWaveform(null);
          }}>Clear all changes</button>
          <button type="button" className="btn-secondary" onClick={() => {
            const seeded = presetStimulus(preset, clockPeriod, activeNetlist);
            setStimulus(seeded);
            setWaveform(null);
            setError(null);
          }}>Reset to default</button>
          <span className="timing-stimulus-count">{stimulus.length} scheduled change{stimulus.length === 1 ? '' : 's'}</span>
        </div>
        {stimulus.length > 0 && (
          <details className="timing-stimulus-details">
            <summary>Show scheduled changes</summary>
            <div className="timing-stimulus-list" aria-label="Scheduled input changes">
              {Array.from(new Set(stimulus.map((item) => item.t))).map((t) => {
                const group = stimulus.filter((item) => item.t === t);
                return (
                  <span className="timing-stimulus-chip" key={t}>
                    t={t}: {group.map((item) => `${item.net}=${item.value}`).join(' ')}
                    <button aria-label={`Remove input changes at tick ${t}`} onClick={() => {
                      setStimulus(stimulus.filter((item) => item.t !== t));
                      setWaveform(null);
                    }}>×</button>
                  </span>
                );
              })}
            </div>
          </details>
        )}
        {internalCount > 0 && (
          <div className="dp-note timing-internal">
            <label>
              <input type="checkbox" checked={showInternal} onChange={(event) => setShowInternal(event.target.checked)} />{' '}
              Show {internalCount} internal signal{internalCount === 1 ? '' : 's'}
            </label>
            <p>
              <b>Outputs</b> are what your circuit delivers. <b>Internal signals</b> are the gate outputs in between
              (an inverter&apos;s result, each AND term). They never change the truth table, but they show <em>why</em> an
              output glitches, so turn them on when you study hazards.
            </p>
          </div>
        )}
        {!waveform ? (
          <div className="timing-empty-state">Choose a circuit to see its waveforms.</div>
        ) : (
          <>
            <div className="timing-svg-viewport" ref={viewportRef}>
              <svg ref={svgRef} width={svgWidth} height={svgHeight}
                viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="timing-waveform-svg"
                role="img" aria-label="Digital signal timing waveforms">
                <rect width={svgWidth} height={svgHeight} className="timing-bg" />
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
                    const y = value === 1 ? highY : value === 0 ? lowY : (highY + lowY) / 2;
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
                      <text x="12" y={row.y + 17} className="timing-signal-name">{shown(row.name)}</text>
                      <path d={d} className={`timing-signal-path ${row.group}`} pointerEvents="none" />
                      {stateNets[0] === row.name && stateChanges.map((change) => (
                        <text key={`${row.name}-${change.t}`} x={104 + change.t * 12} y={row.y - 1}
                          className="timing-state-label">{change.state}</text>
                      ))}
                    </g>
                  );
                })}
                {(activeFlops.length === 0 ? [] : waveform.events.filter((event) => event.label.startsWith('active-edge:'))).map((event, index) => {
                  const x = 100 + event.t * 12;
                  return (
                    <path key={`edge-${event.t}-${index}`} d={`M ${x - 4} 30 L ${x + 4} 30 L ${x} 37 Z`}
                      className="timing-edge-marker" />
                  );
                })}
                {rowLayout.filter((row) => row.group === 'output' || row.group === 'internal').flatMap((row) => {
                  // A glitch is a pulse on a gate/output wire no wider than two gate delays: the signal
                  // changes and then changes straight back.
                  const signal = waveform.signals.find((candidate) => candidate.name === row.name);
                  if (!signal) return [];
                  const pulses: { x0: number; x1: number; y: number }[] = [];
                  for (let i = 1; i < signal.values.length - 1; i++) {
                    if (signal.values[i] === signal.values[i - 1] || signal.values[i] === 'x') continue;
                    const next = signal.values.findIndex((v, j) => j > i && v !== signal.values[i]);
                    if (next === -1) continue;
                    const width = waveform.time[next] - waveform.time[i];
                    if (signal.values[next] === signal.values[i - 1] && width <= Math.max(2, gateDelay * 2)) {
                      pulses.push({ x0: 100 + waveform.time[i] * 12, x1: 100 + waveform.time[next] * 12, y: row.y });
                    }
                  }
                  return pulses.map((pulse, index) => (
                    <g key={`glitch-${row.name}-${index}`} className="timing-glitch">
                      <rect x={pulse.x0 - 2} y={pulse.y} width={Math.max(6, pulse.x1 - pulse.x0 + 4)} height="26" className="timing-glitch-pulse" />
                      <text x={pulse.x0 - 2} y={pulse.y - 1} className="timing-glitch-label">glitch</text>
                    </g>
                  ));
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
              {cursorValues.map(({ name, label, value }) => (
                <span key={name} data-testid={`timing-value-${name}`}><b>{label}</b>={value}</span>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="timing-results-grid">
        {activeFlops.length > 0 && (
        <section className="dp-panel">
          <h2>State sequence</h2>
          {stateChanges.length > 0 ? (
            <div className="timing-sequence-list">
              {stateChanges.map((change) => <span key={`${change.t}-${change.state}`}>t={change.t} <b>{change.state}</b></span>)}
            </div>
          ) : <p className="timing-note">No state change in this run.</p>}
        </section>
        )}
        <section className="dp-panel">
          <h2>Hazard analysis</h2>
          {hazardWarnings.length > 0 ? hazardWarnings.map((hazard) => (
            <div className="timing-warning" key={`${hazard.where}-${hazard.type}`}>
              <b>{hazard.type.replace('-', ' ')} hazard</b>
              <span>{hazard.where}</span>
              {hazard.fix && <span>Suggested consensus term: <code>{hazard.fix}</code></span>}
            </div>
          )) : <p className="timing-note">No static-1 hazard for a single-input change was found in a recognizable two-level SOP output. (Several inputs changing at once can still glitch, as the waveform shows.)</p>}
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
