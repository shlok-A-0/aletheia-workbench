import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../store';
import { createProjectFile } from '../../store/project';
import { useResults } from '../../pipeline/useResults';
import { Section } from './Section';
import { IconArrow } from './icons';

const DEEPER: { to: string; title: string; text: string }[] = [
  { to: '/cost-power', title: 'Cost & power', text: 'IC count and switching power' },
  { to: '/faults', title: 'Fault testing', text: 'Stuck-at coverage and test vectors' },
  { to: '/timing', title: 'Timing & hazards', text: 'Waveforms and static hazards' },
  { to: '/sequential', title: 'Sequential / FSM', text: 'Flip-flops, counters, state machines' },
];

function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function VerifySection() {
  const r = useResults();
  const [note, setNote] = useState<string | null>(null);

  const exportProject = () => {
    try {
      download('aletheia-project.json', createProjectFile(useStore.getState()), 'application/json');
      setNote('Project saved as aletheia-project.json');
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  const verdictText = r.verdict === 'verified' ? 'VERIFIED' : r.verdict === 'failed' ? 'MISMATCH' : 'NO RESULT';
  const detail =
    r.verdict === 'verified'
      ? `${r.rows} of ${r.rows} truth-table rows match the circuit. Don't-cares are ignored.`
      : r.verdict === 'failed'
        ? `Rows that disagree: ${r.mismatches.slice(0, 12).join(', ')}${r.mismatches.length > 12 ? '…' : ''}`
        : 'Define a function and it is checked against its circuit automatically.';

  return (
    <Section
      id="verify"
      index="05"
      label="Verify & export"
      title="Proof, then take it with you."
    >
      <div className={`wb-verdict is-${r.verdict}`} role="status">
        <p className="wb-verdict-word echo" data-text={verdictText}>{verdictText}</p>
        <p className="wb-verdict-detail">{detail}</p>
      </div>

      <ul className="wb-grid4">
        <li><span className="t-label">Gates</span><b>{r.hasResult ? r.gateCount : '–'}</b></li>
        <li><span className="t-label">Literals</span><b>{r.literals ?? '–'}</b></li>
        <li><span className="t-label">NAND-only gates</span><b>{r.nandGates ?? '–'}</b></li>
        <li><span className="t-label">NOR-only gates</span><b>{r.norGates ?? '–'}</b></li>
      </ul>

      <div className="wb-export">
        <button type="button" className="wb-btn-primary" onClick={exportProject} disabled={!r.hasResult}>
          Export project <IconArrow />
        </button>
        <Link className="wb-btn-ghost" to="/dashboard">Printable report</Link>
        {note && <span className="wb-note" role="status">{note}</span>}
      </div>

      <div className="wb-deeper">
        <p className="t-label">Go deeper</p>
        <ul>
          {DEEPER.map((d) => (
            <li key={d.to}>
              <Link to={d.to}>
                <b>{d.title}</b>
                <span>{d.text}</span>
                <IconArrow />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
