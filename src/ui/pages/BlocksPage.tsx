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
} from '../../engine/circuit/blocks';
import { truthTableFromMinterms } from '../../engine/boolean/truth-table';
import type { Netlist, TruthTable } from '../../engine/types';
import { PageHead } from '../deep/PageHead';

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

const DEFAULT_SAMPLE_TT: TruthTable = truthTableFromMinterms(['A', 'B', 'C'], [1, 3, 6, 7]);

export function BlocksPage() {
  const storeTT = useStore((state) => state.truthTable);
  const [pageMode, setPageMode] = useState<'implement' | 'gallery'>('implement');

  // Implementation settings
  const [implTarget, setImplTarget] = useState<'mux' | 'decoder'>('mux');
  const [selectedMuxConfigIdx, setSelectedMuxConfigIdx] = useState(0);

  // Gallery settings
  const [galleryKey, setGalleryKey] = useState('mux2');

  // Live input bits for simulation
  const [bits, setBits] = useState<Record<string, 0 | 1>>({});

  const activeTT = storeTT && storeTT.vars.length >= 1 ? storeTT : DEFAULT_SAMPLE_TT;
  const isSample = !storeTT || storeTT.vars.length < 1;

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

      {/* Top mode switcher */}
      <div className="dp-chips" style={{ marginBottom: 'var(--space-6)' }}>
        <button
          type="button"
          className={`dp-chip ${pageMode === 'implement' ? 'is-on' : ''}`}
          onClick={() => {
            setPageMode('implement');
            setBits({});
          }}
        >
          Implement Expression (MUX / Decoder)
        </button>
        <button
          type="button"
          className={`dp-chip ${pageMode === 'gallery' ? 'is-on' : ''}`}
          onClick={() => {
            setPageMode('gallery');
            setBits({});
          }}
        >
          Standard MSI Library
        </button>
      </div>

      {pageMode === 'implement' ? (
        <section className="dp-panel" style={{ marginBottom: 'var(--space-6)' }}>
          <div className="dp-panel-head">
            <div>
              <h2 className="dp-h2">Function Realization using MSI Blocks</h2>
              <p className="dp-muted">
                {isSample
                  ? 'Showing sample function F(A, B, C) = Σm(1, 3, 6, 7). Enter an expression on the Workbench to map your own function.'
                  : `Active Function: F(${activeTT.vars.join(', ')}) with ${activeTT.rows.filter((r) => r.out === 1).length} active minterms.`}
              </p>
            </div>
          </div>

          {/* Implementation target selector */}
          <div className="dp-groups" style={{ marginBottom: 0 }}>
            <div className="dp-group">
              <span className="t-label">MSI Block</span>
              <div className="dp-chips">
                <button
                  type="button"
                  className={`dp-chip ${implTarget === 'mux' ? 'is-on' : ''}`}
                  onClick={() => {
                    setImplTarget('mux');
                    setBits({});
                  }}
                >
                  Multiplexer (MUX)
                </button>
                <button
                  type="button"
                  className={`dp-chip ${implTarget === 'decoder' ? 'is-on' : ''}`}
                  onClick={() => {
                    setImplTarget('decoder');
                    setBits({});
                  }}
                >
                  Decoder + OR Gate
                </button>
              </div>
            </div>

            {implTarget === 'mux' && (
              <div className="dp-group">
                <span className="t-label">MUX Size</span>
                <div className="dp-chips">
                  {muxConfigs.map((cfg, idx) => (
                    <button
                      key={cfg.label}
                      type="button"
                      className={`dp-chip ${safeMuxIdx === idx ? 'is-on' : ''}`}
                      onClick={() => {
                        setSelectedMuxConfigIdx(idx);
                        setBits({});
                      }}
                    >
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Derivation Steps Summary */}
          {steps.length > 0 && (
            <div className="card" style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--inset)' }}>
              <span className="t-label" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                Derivation Steps ({implTarget === 'mux' ? 'Shannon Expansion' : 'Minterm Mapping'})
              </span>
              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {steps.map((st, i) => (
                  <div key={i} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
                    <b style={{ color: 'var(--text-1)' }}>{st.title}:</b> {st.detail}
                  </div>
                ))}
              </div>
            </div>
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
            <span className="t-label">Inputs (Click to toggle)</span>
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
      </section>
    </div>
  );
}
