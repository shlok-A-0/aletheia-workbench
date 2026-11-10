import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { evaluate } from '../../engine/circuit/simulate';
import {
  mux, demux, decoder, encoder, priorityEncoder,
  halfAdder, fullAdder, rippleAdder, comparator, bcdTo7Seg,
} from '../../engine/circuit/blocks';
import type { Netlist } from '../../engine/types';
import { PageHead } from '../deep/PageHead';

const SchematicView = lazy(() => import('../schematic/SchematicView'));

interface BlockDef {
  key: string;
  label: string;
  group: string;
  desc: string;
  build: () => Netlist;
}

const BLOCKS: BlockDef[] = [
  { key: 'mux1', label: 'MUX 2:1', group: 'Select', desc: 'Routes one of two inputs to the output.', build: () => mux(1) },
  { key: 'mux2', label: 'MUX 4:1', group: 'Select', desc: 'Routes one of four inputs to the output.', build: () => mux(2) },
  { key: 'demux1', label: 'DEMUX 1:2', group: 'Select', desc: 'Sends one input to one of two outputs.', build: () => demux(1) },
  { key: 'demux2', label: 'DEMUX 1:4', group: 'Select', desc: 'Sends one input to one of four outputs.', build: () => demux(2) },
  { key: 'dec2', label: 'Decoder 2:4', group: 'Decode', desc: 'Two address bits light exactly one of four outputs.', build: () => decoder(2) },
  { key: 'dec3', label: 'Decoder 3:8', group: 'Decode', desc: 'Three address bits light exactly one of eight outputs.', build: () => decoder(3) },
  { key: 'enc4', label: 'Encoder 16→4', group: 'Decode', desc: 'Turns one active line of sixteen into a 4-bit code.', build: () => encoder(4) },
  { key: 'penc4', label: 'Priority 4:2', group: 'Decode', desc: 'Encodes the highest active input of four.', build: () => priorityEncoder(4) },
  { key: 'bcd7', label: 'BCD → 7-seg', group: 'Decode', desc: 'Drives a seven-segment digit from a BCD value.', build: () => bcdTo7Seg() },
  { key: 'ha', label: 'Half adder', group: 'Arithmetic', desc: 'Adds two bits: sum and carry.', build: () => halfAdder() },
  { key: 'fa', label: 'Full adder', group: 'Arithmetic', desc: 'Adds two bits plus a carry-in.', build: () => fullAdder() },
  { key: 'ra4', label: 'Ripple adder 4-bit', group: 'Arithmetic', desc: 'Four full adders chained by their carries.', build: () => rippleAdder(4) },
  { key: 'cmp4', label: 'Comparator 4-bit', group: 'Arithmetic', desc: 'Reports A>B, A=B or A<B for two 4-bit numbers.', build: () => comparator(4) },
];

const GROUPS = ['Select', 'Decode', 'Arithmetic'];

export function BlocksPage() {
  const [key, setKey] = useState('fa');
  const [bits, setBits] = useState<Record<string, 0 | 1>>({});

  const def = BLOCKS.find((b) => b.key === key) ?? BLOCKS[0];
  const netlist = useMemo(() => def.build(), [def]);

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

  const pick = (next: string) => {
    setKey(next);
    setBits({});
  };

  const gateCount = netlist.nodes.filter((n) => n.kind === 'gate').length;

  return (
    <div className="page-container dp">
      <PageHead
        kicker="Blocks / Standard parts"
        title="Building blocks"
        sub="The standard MSI parts, drawn gate by gate. Click an input to flip it and watch the outputs respond."
      />

      <nav className="dp-groups" aria-label="Block library">
        {GROUPS.map((g) => (
          <div className="dp-group" key={g}>
            <span className="t-label">{g}</span>
            <div className="dp-chips">
              {BLOCKS.filter((b) => b.group === g).map((b) => (
                <button key={b.key} type="button" aria-pressed={b.key === key} className={`dp-chip${b.key === key ? ' is-on' : ''}`} onClick={() => pick(b.key)}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <section className="dp-panel">
        <div className="dp-panel-head">
          <div>
            <h2 className="dp-h2">{def.label}</h2>
            <p className="dp-muted">{def.desc}</p>
          </div>
          <ul className="dp-stats">
            <li><span className="t-label">Gates</span><b>{gateCount}</b></li>
            <li><span className="t-label">Inputs</span><b>{netlist.inputs.length}</b></li>
            <li><span className="t-label">Outputs</span><b>{netlist.outputs.length}</b></li>
          </ul>
        </div>

        <div className="dp-io">
          <div className="dp-io-col">
            <span className="t-label">Inputs</span>
            <div className="dp-bits">
              {netlist.inputs.map((n) => (
                <button key={n} type="button" aria-pressed={(bits[n] ?? 0) === 1} className={`dp-bit${(bits[n] ?? 0) === 1 ? ' is-1' : ''}`} onClick={() => toggle(n)}>
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
            <SchematicView key={key} netlist={netlist} inputs={bits} onToggleInput={toggle} height={gateCount > 20 ? 560 : 440} />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
