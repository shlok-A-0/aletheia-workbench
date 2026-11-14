import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { evaluate, truthTableOfNetlist } from '../../engine/circuit/simulate';
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
  functionsWithDemux,
} from '../../engine/circuit/blocks';
import { truthTableFromMinterms } from '../../engine/boolean/truth-table';
import type { Netlist, TruthTable } from '../../engine/types';
import { Link } from 'react-router-dom';
import { PageHead } from '../deep/PageHead';
import { DemuxDiagram, DEMUX_DIAGRAM_MAX_VARS } from '../blocks/DemuxDiagram';
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

/** Real 7400-series multiplexers, by number of select lines. */
const MUX_ICS: Record<number, string> = {
  1: '74157 · quad',
  2: '74153 · dual',
  3: '74151',
  4: '74150',
};

/** Real decoder/demultiplexer ICs, by number of address lines. */
const DECODER_ICS: Record<number, string> = {
  2: '74139 · dual 2-to-4',
  3: '74138 · 3-to-8',
  4: '74154 · 4-to-16',
};

/** All k-element subsets of `items`, in order. */
function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

const DEFAULT_SAMPLE_TT: TruthTable = truthTableFromMinterms(['A', 'B', 'C'], [1, 3, 6, 7]);

const NO_OUTPUTS: string[] = [];

type ImplTarget = 'mux' | 'decoder' | 'decoder-nand' | 'demux';

export function BlocksPage() {
  const storeTT = useStore((state) => state.truthTable);
  // Select the stable array itself: a fresh `?? []` each render would loop the store subscription.
  const workbenchNetlist = useStore((state) => state.netlists.simplified);
  const workbenchOutputs = workbenchNetlist?.outputs ?? NO_OUTPUTS;
  const [outputIdx, setOutputIdx] = useState(0);
  const [pageMode, setPageMode] = useState<'implement' | 'gallery'>('implement');

  // Implementation settings: block family, decoder output style, MUX size (select lines) and which variables select.
  const [blockType, setBlockType] = useState<'mux' | 'decoder' | 'demux'>('mux');
  const [decoderStyle, setDecoderStyle] = useState<'or' | 'nand'>('or');
  const [muxK, setMuxK] = useState(0); // 0 = largest size that fits
  const [muxCombo, setMuxCombo] = useState(0);
  const implTarget: ImplTarget =
    blockType === 'decoder' ? (decoderStyle === 'nand' ? 'decoder-nand' : 'decoder') : blockType;

  // Gallery settings
  const [galleryKey, setGalleryKey] = useState('mux2');

  // Diagram representation view ('block' = textbook MSI symbol, 'gate' = gate-level expansion)
  const [diagramView, setDiagramView] = useState<'block' | 'gate'>('block');

  // Live input bits for simulation
  const [bits, setBits] = useState<Record<string, 0 | 1>>({});

  // One truth table per output of the workbench design, so every output can be realized, not just the first.
  const workbenchTTs = useMemo(() => {
    if (!storeTT || storeTT.vars.length < 1 || !workbenchNetlist || workbenchOutputs.length < 2) return null;
    try {
      return workbenchOutputs.map((_, i) => truthTableOfNetlist(workbenchNetlist, storeTT.vars, i));
    } catch {
      return null;
    }
  }, [storeTT, workbenchNetlist, workbenchOutputs]);
  const safeOutputIdx = Math.min(outputIdx, Math.max(0, (workbenchTTs?.length ?? 1) - 1));

  const activeTT = workbenchTTs?.[safeOutputIdx] ?? (storeTT && storeTT.vars.length >= 1 ? storeTT : DEFAULT_SAMPLE_TT);
  const isSample = !storeTT || storeTT.vars.length < 1;

  // MUX sizes: one per real IC, from 2:1 up to 16:1, never wider than the function has variables.
  const muxSizes = useMemo(
    () => Array.from({ length: Math.min(4, activeTT.vars.length) }, (_, i) => i + 1),
    [activeTT],
  );
  const safeK = muxK >= 1 && muxK <= muxSizes.length ? muxK : muxSizes[muxSizes.length - 1];
  // Which variables drive the select lines (only a choice when the MUX is smaller than the function).
  const muxCombos = useMemo(() => combinations(activeTT.vars, safeK), [activeTT, safeK]);
  const safeCombo = Math.min(muxCombo, Math.max(0, muxCombos.length - 1));
  const activeMuxConfig = useMemo(() => {
    const selectVars = muxCombos[safeCombo] ?? activeTT.vars.slice(0, safeK);
    const residual = activeTT.vars.filter((v) => !selectVars.includes(v));
    return {
      label: `${1 << safeK}:1 MUX`,
      selectVars,
      desc: residual.length === 0
        ? `Select = {${selectVars.join(', ')}}; every data input is tied to 0 or 1 straight from the truth table.`
        : `Shannon expansion: select = {${selectVars.join(', ')}}; each data input is a function of {${residual.join(', ')}}.`,
    };
  }, [muxCombos, safeCombo, activeTT, safeK]);
  const safeMuxIdx = `${safeK}-${safeCombo}`;

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
      } else if (implTarget === 'demux') {
        const tts = workbenchTTs ?? [activeTT];
        const { netlist: nl, steps: st } = functionsWithDemux(tts, workbenchTTs ? [...workbenchOutputs] : []);
        return {
          netlist: nl,
          steps: st,
          label: `1-to-${1 << activeTT.vars.length} Demultiplexer + OR Realization`,
          desc: tts.length > 1
            ? `One shared demux (D = 1) feeds an OR gate for each of the ${tts.length} outputs.`
            : `Demux with D tied to 1 routes a 1 to the selected line; ORing the minterm lines gives F(${activeTT.vars.join(', ')}).`,
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
  }, [pageMode, implTarget, activeMuxConfig, activeTT, galleryKey, workbenchTTs, workbenchOutputs]);

  // The active-low decoder has no dedicated block symbol, so it is always shown at gate level.
  const noBlockSymbol =
    pageMode === 'implement' &&
    (implTarget === 'decoder-nand' || (implTarget === 'demux' && activeTT.vars.length > DEMUX_DIAGRAM_MAX_VARS));
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

          {workbenchTTs && (
            <p className="dp-note" role="note">
              Your design has {workbenchOutputs.length} outputs ({workbenchOutputs.join(', ')}).{' '}
              {implTarget === 'demux'
                ? 'One shared demultiplexer realizes all of them at once.'
                : `Pick which output to realize, or choose Demultiplexer + OR to build all ${workbenchOutputs.length} together.`}
            </p>
          )}

          <div className="dp-toolbar">
            <label className="dp-field">
              <span className="t-label">Block</span>
              <select
                value={blockType}
                onChange={(e) => {
                  setBlockType(e.target.value as 'mux' | 'decoder' | 'demux');
                  setBits({});
                }}
              >
                <option value="mux">Multiplexer</option>
                <option value="decoder">Decoder</option>
                <option value="demux">Demultiplexer</option>
              </select>
            </label>
            {workbenchTTs && blockType !== 'demux' && (
              <label className="dp-field">
                <span className="t-label">Output</span>
                <select
                  value={safeOutputIdx}
                  onChange={(e) => {
                    setOutputIdx(Number(e.target.value));
                    setBits({});
                  }}
                >
                  {workbenchOutputs.map((name, i) => (
                    <option key={name} value={i}>{name}</option>
                  ))}
                </select>
              </label>
            )}
            {blockType === 'mux' && (
              <>
                <label className="dp-field">
                  <span className="t-label">Size · IC</span>
                  <select
                    value={safeK}
                    onChange={(e) => {
                      setMuxK(Number(e.target.value));
                      setMuxCombo(0);
                      setBits({});
                    }}
                  >
                    {muxSizes.map((k) => (
                      <option key={k} value={k}>{1 << k}:1 · {MUX_ICS[k]}</option>
                    ))}
                  </select>
                </label>
                {muxCombos.length > 1 && (
                  <label className="dp-field">
                    <span className="t-label">Select lines</span>
                    <select
                      value={safeCombo}
                      onChange={(e) => {
                        setMuxCombo(Number(e.target.value));
                        setBits({});
                      }}
                    >
                      {muxCombos.map((c, i) => (
                        <option key={c.join('')} value={i}>{c.join(', ')}</option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {blockType === 'decoder' && (
              <label className="dp-field">
                <span className="t-label">Outputs</span>
                <select
                  value={decoderStyle}
                  onChange={(e) => {
                    setDecoderStyle(e.target.value as 'or' | 'nand');
                    setBits({});
                  }}
                >
                  <option value="or">Active-high + OR</option>
                  <option value="nand">Active-low (74138) + NAND</option>
                </select>
              </label>
            )}
            {blockType !== 'mux' && (
              <div className="dp-field">
                <span className="t-label">Size · IC</span>
                <span className="dp-muted">
                  {activeTT.vars.length}-to-{1 << activeTT.vars.length} · {DECODER_ICS[activeTT.vars.length] ?? 'no single IC; cascade smaller decoders with enables'}
                </span>
              </div>
            )}
          </div>

          {/* Derivation Steps Summary */}
          {steps.length > 0 && (
            <details className="dp-derivation">
              <summary className="t-label">
                How it was derived · {implTarget === 'mux' ? 'Shannon expansion' : implTarget === 'decoder' ? 'minterm mapping' : implTarget === 'demux' ? 'shared demux lines' : 'active-low minterm mapping'}
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
            {pageMode === 'implement' && implTarget === 'demux' ? (
              <DemuxDiagram
                tts={workbenchTTs ?? [activeTT]}
                outputNames={netlist.outputs}
                inputs={bits}
                onToggleInput={toggle}
                outputValues={values}
              />
            ) : (
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
            )}
          </div>
        ) : (
          <div className="wb-schematic dp-schematic">
            <Suspense fallback={<div className="sch-empty">Routing wires…</div>}>
              <SchematicView
                key={`${pageMode}-${implTarget}-${safeMuxIdx}-${safeOutputIdx}-${galleryKey}`}
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
