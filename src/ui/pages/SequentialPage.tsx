import React, { useState } from 'react';
import { PageHead } from '../deep/PageHead';
import { FlipFlopsTab } from './sequential/FlipFlopsTab';
import { CountersTab } from './sequential/CountersTab';
import { FsmTab } from './sequential/FsmTab';
import { AnalyzeTab } from './sequential/AnalyzeTab';

type SeqTab = 'flipflops' | 'counters' | 'fsm' | 'analyze';

const TABS: { id: SeqTab; label: string }[] = [
  { id: 'flipflops', label: 'Flip-Flops' },
  { id: 'counters', label: 'Counters & Registers' },
  { id: 'fsm', label: 'FSM Designer' },
  { id: 'analyze', label: 'Analyze Circuit' },
];

export const SequentialPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SeqTab>('flipflops');

  return (
    <div className="page-container dp">
      <PageHead kicker="01 / Sequential" title="Sequential Logic & FSM Synthesis" sub="Flip-flop models, clocked counters & registers, implication state reduction, and automated FSM design" />

      <div className="dp-controls">
        <div className="wb-seg" role="group" aria-label="Sequential tools">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={activeTab === t.id}
              className={activeTab === t.id ? 'is-on' : undefined}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'flipflops' && <FlipFlopsTab />}
      {activeTab === 'counters' && <CountersTab />}
      {activeTab === 'fsm' && <FsmTab />}
      {activeTab === 'analyze' && <AnalyzeTab onGoto={setActiveTab} />}
    </div>
  );
};
