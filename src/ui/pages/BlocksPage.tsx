import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { evaluate } from '../../engine/circuit/simulate';
import {
  mux,
  demux,
  decoder,
  encoder,
  priorityEncoder,
  bcdTo7Seg,
  functionWithMux,
  functionWithDecoder,
  functionWithDecoderNand,
} from '../../engine/circuit/blocks';
import { truthTableFromMinterms } from '../../engine/boolean/truth-table';
import type { Netlist, TruthTable } from '../../engine/types';
import { Link } from 'react-router-dom';
import { PageHead } from '../deep/PageHead';
import { MsiBlockDiagram } from '../blocks/MsiBlockDiagram';

const SchematicView = lazy(() => import('../schematic/SchematicView'));

interface GalleryBlockDef {
  key: string;
  label: string;
  group: 'Select' | 'Decode';
  desc: string;
  build: () => Netlist;
}

const GALLERY_BLOCKS: GalleryBlockDef[] = [
  { key: 'mux1', label: 'MUX 2:1', group: 'Select', desc: 'Routes one of two data inputs to the output.', build: () => mux(1) },
  { key: 'mux2', label: 'MUX 4:1', group: 'Select', desc: 'Routes one of four data inputs to the output using 2 select lines.', build: () => mux(2) },
  { key: 'mux3', label: 'MUX 8:1', group: 'Select', desc: 'Routes one of eight data inputs to the output using 3 select lines.', build: () => mux(3) },
  { key: 'demux1', label: 'DEMUX 1:2', group: 'Select', desc: 'Sends one input to one of two outputs based on 1 select line.', build: () => demux(1) },
  { key: 'demux2', label: 'DEMUX 1:4', group: 'Select', desc: 'Sends one input to one of four outputs based on 2 select lines.', build: () => demux(2) },
  { key: 'demux3', label: 'DEMUX 1:8', group: 'Select', desc: 'Sends one input to one of eight outputs based on 3 select lines.', build: () => demux(3) },
  { key: 'dec2', label: 'Decoder 2:4', group: 'Decode', desc: 'Two address bits activate exactly one of four outputs.', build: () => decoder(2) },
  { key: 'dec3', label: 'Decoder 3:8', group: 'Decode', desc: 'Three address bits activate exactly one of eight outputs.', build: () => decoder(3) },
  { key: 'enc4', label: 'Encoder 16→4', group: 'Decode', desc: 'Encodes one active line of sixteen into a 4-bit binary code.', build: () => encoder(4) },
  { key: 'penc4', label: 'Priority 4:2', group: 'Decode', desc: 'Encodes the highest-order active input of four.', build: () => priorityEncoder(4) },
  { key: 'bcd7', label: 'BCD → 7-seg', group: 'Decode', desc: 'Decodes a 4-bit BCD digit into 7-segment display segments.', build: () => bcdTo7Seg() },
];

const GALLERY_GROUPS = ['Select', 'Decode'] as const;

const PRESET_FUNCTIONS: { label: string; vars: string[]; minterms: number[] }[] = [
  { label: 'Σm(1,3,6,7)', vars: ['A', 'B', 'C'], minterms: [1, 3, 6, 7] },
  { label: 'Majority (AB+BC+AC)', vars: ['A', 'B', 'C'], minterms: [3, 5, 6, 7] },
  { label: 'Odd parity (A ^ B ^ C)', vars: ['A', 'B', 'C'], minterms: [1, 2, 4, 7] },
  { label: '2-var XOR (A ^ B)', vars: ['A', 'B'], minterms: [1, 2] },
];

const DEFAULT_SAMPLE_TT: TruthTable = truthTableFromMinterms(['A', 'B', 'C'], [1, 3, 6, 7]);

const NO_OUTPUTS: string[] = [];

type ImplTarget = 'mux' | 'decoder' | 'decoder-nand';

export function BlocksPage() {
  const storeTT = useStore((state) => state.truthTable);
  // Select the stable array itself: a fresh `?? []` each render would loop the store subscription.
  const workbenchOutputs = useStore((state) => state.netlists.simplified?.outputs) ?? NO_OUTPUTS;
  const [pageMode, setPageMode] = useState<'implement' | 'gallery'>('implement');
  const [presetTT, setPresetTT] = useState<TruthTable | null>(null);
  const [presetLabel, setPresetLabel] = useState('');

  // Implementation settings
  const [implTarget, setImplTarget] = useState<ImplTarget>('mux');
  const [selectedMuxConfigIdx, setSelectedMuxConfigIdx] = useState(0);

  // Gallery settings
  const [galleryKey, setGalleryKey] = useState('mux2');

  // Diagram representation view ('block' = textbook MSI symbol, 'gate' = gate-level expansion)
  const [diagramView, setDiagramView] = useState<'block' | 'gate'>('block');

  // Live input bits for simulation
  const [bits, setBits] = useState<Record<string, 0 | 1>>({});

  const activeTT = presetTT ?? (storeTT && storeTT.vars.length >= 1 ? storeTT : DEFAULT_SAMPLE_TT);
  const isSample = !presetTT && (!storeTT || storeTT.vars.length < 1);

  // Clear preset override whenever the workbench synthesizes a new truth table
  const [prevStoreTT, setPrevStoreTT] = useState(storeTT);
  if (storeTT !== prevStoreTT) {
    setPrevStoreTT(storeTT);
    setPresetTT(null);
  }

  // Available MUX configurations based on truth table variables
  const muxConfigs = useMemo(() => {
    const vars = activeTT.vars;
    const n = vars.length;
    const configs: { label: string; desc: string; selectVars: string[] }[] = [];

    if (n === 1) {
      configs.push({
        label: '2:1 MUX (Full Select)',
        desc: `Select = ${vars[0]}, inputs tied to constants 0 or 1.`,
        selectVars: [vars[0]],
      });
    } else if (n === 2) {
      configs.push({
        label: '4:1 MUX (Full Select)',
        desc: `Select = {${vars.join(', ')}}, inputs tied to 0 or 1.`,
        selectVars: [...vars],
      });
      configs.push({
        label: '2:1 MUX (Shannon Expansion)',
        desc: `Select = ${vars[0]}, Data lines driven by ${vars[1]} / ${vars[1]}'.`,
        selectVars: [vars[0]],
      });
    } else if (n === 3) {
      configs.push({
        label: '8:1 MUX (Full Select)',
        desc: `Select = {${vars.join(', ')}}, inputs tied to 0 or 1.`,
        selectVars: [...vars],
      });
      configs.push({
        label: `4:1 MUX (Select: ${vars[0]}, ${vars[1]})`,
        desc: `Shannon expansion: residual variable is ${vars[2]}.`,
        selectVars: [vars[0], vars[1]],
      });
      configs.push({
        label: `4:1 MUX (Select: ${vars[1]}, ${vars[2]})`,
        desc: `Shannon expansion: residual variable is ${vars[0]}.`,
        selectVars: [vars[1], vars[2]],
      });
      configs.push({
        label: `2:1 MUX (Select: ${vars[0]})`,
        desc: `Shannon expansion: residual variables are ${vars[1]}, ${vars[2]}.`,
        selectVars: [vars[0]],
      });
    } else {
      // 4+ variables
      configs.push({
        label: `8:1 MUX (Select: ${vars.slice(0, 3).join(', ')})`,
        desc: `Shannon expansion with 3 select lines.`,
        selectVars: vars.slice(0, 3),
      });
      configs.push({
        label: `4:1 MUX (Select: ${vars.slice(0, 2).join(', ')})`,
        desc: `Shannon expansion with 2 select lines.`,
        selectVars: vars.slice(0, 2),
      });
    }

    return configs;
  }, [activeTT]);

  // Safe index
  const safeMuxIdx = Math.min(selectedMuxConfigIdx, Math.max(0, muxConfigs.length - 1));
  const activeMuxConfig = muxConfigs[safeMuxIdx] ?? muxConfigs[0];

  // Synthesize or retrieve netlist depending on pageMode
  const { netlist, steps, label, desc } = useMemo(() => {
    if (pageMode === 'implement') {
      if (implTarget === 'mux') {
        const { netlist: nl, steps: st } = functionWithMux(activeTT, activeMuxConfig.selectVars);
        return {
          netlist: nl,
          steps: st,
          label: `${activeMuxConfig.label} Realization`,
          desc: activeMuxConfig.desc,
        };
      } else if (implTarget === 'decoder-nand') {
        const { netlist: nl, steps: st } = functionWithDecoderNand(activeTT);
        return {
          netlist: nl,
          steps: st,
          label: `${activeTT.vars.length}-to-${1 << activeTT.vars.length} Active-low Decoder + NAND/AND Realization`,
          desc: `74138-style decoder with the cheaper of NAND (F=1 rows) or AND (F=0 rows) for F(${activeTT.vars.join(', ')}).`,
        };
      } else {
        const { netlist: nl, steps: st } = functionWithDecoder(activeTT);
        return {
          netlist: nl,
          steps: st,
          label: `${activeTT.vars.length}-to-${1 << activeTT.vars.length} Decoder + OR Realization`,
          desc: `Full canonical minterm decoder implementation for F(${activeTT.vars.join(', ')}).`,
        };
      }
    } else {
      const gDef = GALLERY_BLOCKS.find((b) => b.key === galleryKey) ?? GALLERY_BLOCKS[0];
      return {
        netlist: gDef.build(),
        steps: [],
        label: gDef.label,
        desc: gDef.desc,
      };
    }
  }, [pageMode, implTarget, activeMuxConfig, activeTT, galleryKey]);

  // The active-low decoder has no dedicated block symbol, so it is always shown at gate level.
  const noBlockSymbol = pageMode === 'implement' && implTarget === 'decoder-nand';
  const shownView = noBlockSymbol ? 'gate' : diagramView;

  // Live output evaluation
  const values = useMemo(() => {
    const inputs: Record<string, 0 | 1> = {};
    for (const name of netlist.inputs) inputs[name] = bits[name] ?? 0;
    try {
      return evaluate(netlist, inputs);
    } catch {
      return {} as Record<string, 0 | 1>;
    }
  }, [netlist, bits]);

  const toggle = useCallback((name: string) => {
    setBits((prev) => ({ ...prev, [name]: prev[name] === 1 ? 0 : 1 }));
  }, []);

  const gateCount = netlist.nodes.filter((n) => n.kind === 'gate').length;

  return (
    <div className="page-container dp">
      <PageHead
        kicker="05 / Blocks & MSI Realization"
        title="Building Blocks"
        sub="Implement any Boolean expression using Multiplexers and Decoders, or inspect standard MSI parts."
      />

      <div className="wb-seg dp-mode" role="group" aria-label="Blocks mode">
        {([['implement', 'Implement a function'], ['gallery', 'Parts library']] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={pageMode === m}
            className={pageMode === m ? 'is-on' : undefined}
            onClick={() => {
              setPageMode(m);
              setBits({});
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {pageMode === 'implement' ? (
        <section className="dp-panel dp-panel--spaced">
          <div className="dp-panel-head">
            <div>
              <h2 className="dp-h2">Function Realization using MSI Blocks</h2>
              <p className="dp-muted">
                {isSample
                  ? <>Showing the sample F(A, B, C) = Σm(1, 3, 6, 7). <Link to="/">Type your own function in the workbench</Link> to map it here.</>
                  : `Active Function: F(${activeTT.vars.join(', ')}) with ${activeTT.rows.filter((r) => r.out === 1).length} active minterms.`}
              </p>
            </div>
          </div>

          {!presetTT && workbenchOutputs.length > 1 && (
            <p className="dp-note" role="note">
              Your design has {workbenchOutputs.length} outputs ({workbenchOutputs.join(', ')}). This page realizes the first one, {workbenchOutputs[0]}, as a single-output function.
            </p>
          )}

          <div className="dp-toolbar">
            <label className="dp-field">
              <span className="t-label">Function</span>
              <select
                value={presetTT ? presetLabel : ''}
                onChange={(e) => {
                  const p = PRESET_FUNCTIONS.find((x) => x.label === e.target.value);
                  setPresetTT(p ? truthTableFromMinterms(p.vars, p.minterms) : null);
                  setPresetLabel(p?.label ?? '');
                  setSelectedMuxConfigIdx(0);
                  setBits({});
                }}
              >
                <option value="">From the workbench</option>
                {PRESET_FUNCTIONS.map((p) => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="dp-field">
              <span className="t-label">Block</span>
              <select
                value={implTarget}
                onChange={(e) => {
                  setImplTarget(e.target.value as ImplTarget);
                  setBits({});
                }}
              >
                <option value="mux">Multiplexer</option>
                <option value="decoder">Decoder + OR</option>
                <option value="decoder-nand">Active-low decoder + NAND</option>
              </select>
            </label>
            {implTarget === 'mux' && (
              <label className="dp-field">
                <span className="t-label">MUX size</span>
                <select
                  value={safeMuxIdx}
                  onChange={(e) => {
                    setSelectedMuxConfigIdx(Number(e.target.value));
                    setBits({});
                  }}
                >
                  {muxConfigs.map((cfg, idx) => (
                    <option key={cfg.label} value={idx}>{cfg.label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Derivation Steps Summary */}
          {steps.length > 0 && (
            <details className="dp-derivation">
              <summary className="t-label">
                How it was derived · {implTarget === 'mux' ? 'Shannon expansion' : implTarget === 'decoder' ? 'minterm mapping' : 'active-low minterm mapping'}
              </summary>
              <ol>
                {steps.map((st, i) => (
                  <li key={i}><b>{st.title}:</b> {st.detail}</li>
                ))}
              </ol>
            </details>
          )}
        </section>
      ) : (
        /* Standard MSI Catalog Selector */
        <nav className="dp-groups" aria-label="Block library">
          {GALLERY_GROUPS.map((g) => (
            <div className="dp-group" key={g}>
              <span className="t-label">{g}</span>
              <div className="dp-chips">
                {GALLERY_BLOCKS.filter((b) => b.group === g).map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    aria-pressed={b.key === galleryKey}
                    className={`dp-chip${b.key === galleryKey ? ' is-on' : ''}`}
                    onClick={() => {
                      setGalleryKey(b.key);
                      setBits({});
                    }}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      )}

      {/* Schematic & Live I/O Panel */}
      <section className="dp-panel">
        <div className="dp-panel-head">
          <div>
            <h2 className="dp-h2">{label}</h2>
            <p className="dp-muted">{desc}</p>
          </div>
          <ul className="dp-stats">
            <li><span className="t-label">Gates</span><b>{gateCount}</b></li>
            <li><span className="t-label">Inputs</span><b>{netlist.inputs.length}</b></li>
            <li><span className="t-label">Outputs</span><b>{netlist.outputs.length}</b></li>
          </ul>
        </div>

        <div className="dp-io">
          <div className="dp-io-col">
            <span className="t-label">Inputs · click to toggle</span>
            <div className="dp-bits">
              {netlist.inputs.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={(bits[n] ?? 0) === 1}
                  className={`dp-bit${(bits[n] ?? 0) === 1 ? ' is-1' : ''}`}
                  onClick={() => toggle(n)}
                >
                  <span>{n}</span><b>{bits[n] ?? 0}</b>
                </button>
              ))}
            </div>
          </div>
          <div className="dp-io-col">
            <span className="t-label">Outputs</span>
            <div className="dp-bits">
              {netlist.outputs.map((n) => (
                <div key={n} className={`dp-bit dp-bit--out${values[n] === 1 ? ' is-1' : ''}`}>
                  <span>{n}</span><b>{values[n] ?? '–'}</b>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="wb-seg wb-seg--sm dp-mode" role="group" aria-label="Diagram style">
          {([['block', 'Block diagram'], ['gate', 'Gate level']] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={shownView === m}
              className={shownView === m ? 'is-on' : undefined}
              disabled={m === 'block' && noBlockSymbol}
              title={m === 'block' && noBlockSymbol ? 'This realization is shown at gate level' : undefined}
              onClick={() => setDiagramView(m)}
            >
              {label}
            </button>
          ))}
        </div>

        {shownView === 'block' ? (
          <div className="dp-diagram">
            <MsiBlockDiagram
              mode={pageMode}
              implTarget={implTarget}
              activeTT={activeTT}
              selectVars={activeMuxConfig?.selectVars ?? []}
              galleryKey={galleryKey}
              inputs={bits}
              onToggleInput={toggle}
              outputValues={values}
              steps={steps}
            />
          </div>
        ) : (
          <div className="wb-schematic dp-schematic">
            <Suspense fallback={<div className="sch-empty">Routing wires…</div>}>
              <SchematicView
                key={`${pageMode}-${implTarget}-${safeMuxIdx}-${galleryKey}`}
                netlist={netlist}
                inputs={bits}
                onToggleInput={toggle}
                height={gateCount > 20 ? 560 : 440}
              />
            </Suspense>
          </div>
        )}
      </section>
    </div>
  );
}
