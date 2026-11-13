import type { TruthTable } from '../../engine/types';

interface DemuxDiagramProps {
  /** One truth table per output, all over the same variables. */
  tts: TruthTable[];
  outputNames: string[];
  inputs: Record<string, 0 | 1>;
  onToggleInput: (name: string) => void;
  outputValues: Record<string, 0 | 1>;
}

/** Largest variable count drawn as a block symbol; beyond this the gate-level view is clearer. */
export const DEMUX_DIAGRAM_MAX_VARS = 4;

const BOX_X = 150;
const BOX_W = 150;
const OR_X = 470;
const OR_W = 56;

/**
 * Textbook picture of a function built from ONE shared 1-to-2^n demultiplexer (D tied to 1),
 * with one OR gate per output collecting that output's minterm lines.
 */
export function DemuxDiagram({ tts, outputNames, inputs, onToggleInput, outputValues }: DemuxDiagramProps) {
  const vars = tts[0]?.vars ?? [];
  const n = vars.length;
  const lines = 1 << n;
  const spacing = 26;
  const boxY = 28;
  const boxH = Math.max(150, lines * spacing + 24);
  const svgW = 700;
  const svgH = boxH + 56;

  let addr = 0;
  for (const v of vars) addr = (addr << 1) | (inputs[v] ?? 0);

  const lineY = (m: number) => boxY + 22 + m * spacing;
  const minterms = tts.map((tt) => tt.rows.filter((r) => r.out === 1).map((r) => r.index));
  const orH = 44;
  const orGap = Math.max(orH + 16, (boxH - orH) / Math.max(1, tts.length - 1));
  const orTop = (j: number) =>
    tts.length === 1 ? boxY + boxH / 2 - orH / 2 : boxY + 10 + j * Math.min(orGap, 90);

  return (
    <div className="msi-block-container">
      <svg viewBox={`0 0 ${svgW} ${svgH}`} width="100%" className="msi-svg dmx-svg" role="img"
        aria-label={`1 to ${lines} demultiplexer with data input tied to 1 and ${tts.length} output OR gate${tts.length === 1 ? '' : 's'}`}>
        <rect className="dmx-box" x={BOX_X} y={boxY} width={BOX_W} height={boxH} rx={6} />
        <text className="dmx-title" x={BOX_X + BOX_W / 2} y={boxY + boxH / 2 - 6} textAnchor="middle">1 to {lines}</text>
        <text className="dmx-sub" x={BOX_X + BOX_W / 2} y={boxY + boxH / 2 + 16} textAnchor="middle">Demux</text>

        {/* Data pin tied to 1 */}
        <line className="dmx-wire is-on" x1={BOX_X + BOX_W / 2} y1={boxY - 14} x2={BOX_X + BOX_W / 2} y2={boxY} />
        <text className="dmx-pin" x={BOX_X + BOX_W / 2 + 8} y={boxY - 8}>D = 1</text>

        {/* Select inputs (click to toggle) */}
        {vars.map((v, i) => {
          const y = boxY + 32 + i * ((boxH - 64) / Math.max(1, n - 1));
          const bit = inputs[v] ?? 0;
          return (
            <g key={v} className="dmx-input" role="button" tabIndex={0}
              aria-label={`${v} = ${bit}, toggle`}
              onClick={() => onToggleInput(v)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleInput(v); } }}>
              <line className={`dmx-wire${bit === 1 ? ' is-on' : ''}`} x1={96} y1={y} x2={BOX_X} y2={y} />
              <text className="dmx-pin" x={88} y={y + 4} textAnchor="end">{v} = {bit}</text>
              <text className="dmx-pin dmx-pin--dim" x={BOX_X + 8} y={y + 4}>S{n - 1 - i}</text>
            </g>
          );
        })}

        {/* Demux lines, routed to each output OR that uses them */}
        {Array.from({ length: lines }, (_, m) => {
          const y = lineY(m);
          const used = minterms.map((ms) => ms.includes(m));
          const live = m === addr;
          return (
            <g key={m}>
              <line className={`dmx-wire${live ? ' is-on' : ''}${used.some(Boolean) ? '' : ' is-idle'}`}
                x1={BOX_X + BOX_W} y1={y} x2={BOX_X + BOX_W + 28} y2={y} />
              <text className={`dmx-pin dmx-pin--line${live ? ' is-on' : ''}`} x={BOX_X + BOX_W - 8} y={y + 4} textAnchor="end">Y{m}</text>
              {used.map((u, j) => {
                if (!u) return null;
                const targetY = orTop(j) + orH / 2 + (((m % 3) - 1) * 8);
                const busX = BOX_X + BOX_W + 28 + 10 + j * 8;
                return (
                  <polyline key={j} className={`dmx-wire dmx-wire--route${live ? ' is-on' : ''}`} fill="none"
                    points={`${BOX_X + BOX_W + 28},${y} ${busX},${y} ${busX},${targetY} ${OR_X},${targetY}`} />
                );
              })}
            </g>
          );
        })}

        {/* One OR (or tie-off) per output */}
        {tts.map((_, j) => {
          const name = outputNames[j] ?? `Y${j}`;
          const val = outputValues[name];
          const top = orTop(j);
          const ms = minterms[j];
          return (
            <g key={name} transform={`translate(${OR_X}, ${top})`}>
              <path className={`dmx-or${val === 1 ? ' is-on' : ''}`}
                d={`M0,0 Q${OR_W * 0.55},0 ${OR_W},${orH / 2} Q${OR_W * 0.55},${orH} 0,${orH} Q${OR_W * 0.28},${orH / 2} 0,0 Z`} />
              <text className="dmx-pin" x={OR_W * 0.42} y={orH / 2 + 4} textAnchor="middle">{ms.length === 0 ? '0' : ms.length === lines ? '1' : ms.length === 1 ? 'BUF' : 'OR'}</text>
              <line className={`dmx-wire${val === 1 ? ' is-on' : ''}`} x1={OR_W} y1={orH / 2} x2={OR_W + 34} y2={orH / 2} />
              <text className="dmx-out" x={OR_W + 42} y={orH / 2 - 4}>{name}</text>
              <text className={`dmx-val${val === 1 ? ' is-on' : ''}`} x={OR_W + 42} y={orH / 2 + 16}>{val ?? '–'}</text>
            </g>
          );
        })}
      </svg>
      <p className="dp-muted dmx-caption">
        Figure: one shared <strong>1-to-{lines} demultiplexer</strong> with D tied to 1. Each output ORs only its own minterm lines
        {tts.length > 1 ? `, so ${tts.length} outputs share the same demux.` : '.'}
      </p>
    </div>
  );
}
