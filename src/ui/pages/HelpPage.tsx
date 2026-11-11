import { Link } from 'react-router-dom';
import { PageHead } from '../deep/PageHead';

const concepts = [
  { name: 'Boolean variables and expressions', page: 'Boolean Input', path: '/input', description: 'Represent binary conditions and combine them with Boolean operators.' },
  { name: 'Truth tables and canonical forms', page: 'Truth Table', path: '/truth-table', description: 'List every input combination and express a function as minterms or maxterms.' },
  { name: 'Karnaugh maps', page: 'K-Map & QM', path: '/kmap', description: 'Group adjacent cells in Gray-code order to simplify a Boolean function visually.' },
  { name: 'Quine–McCluskey minimization', page: 'K-Map & QM', path: '/kmap', description: 'Systematically combine minterms and select a minimal implicant cover.' },
  { name: 'SOP and POS', page: 'K-Map & QM', path: '/kmap', description: 'Sum-of-products ORs product terms; product-of-sums ANDs sum terms.' },
  { name: 'Don’t-care conditions', page: 'Boolean Input', path: '/input', description: 'Mark input combinations whose output may be chosen to simplify the circuit.' },
  { name: 'Combinational circuits', page: 'Circuit Schematic', path: '/circuit', description: 'Compute outputs solely from the current values of the inputs.' },
  { name: 'MSI blocks', page: 'Building Blocks', path: '/blocks', description: 'Use standard functional blocks such as multiplexers, decoders, and encoders, or realize expressions with MUX.' },
  { name: 'Sequential circuits and flip-flops', page: 'Sequential / FSM', path: '/sequential', description: 'Store state and update it on clock edges using D, JK, T, or SR flip-flops.' },
  { name: 'Finite-state machines', page: 'Sequential / FSM', path: '/sequential', description: 'Model behavior as states, input-dependent transitions, and outputs.' },
  { name: 'Moore and Mealy machines', page: 'Sequential / FSM', path: '/sequential', description: 'Moore outputs depend on state; Mealy outputs depend on state and current input.' },
  { name: 'Timing and propagation delay', page: 'Timing & Hazards', path: '/timing', description: 'Track when signals change as gate and flip-flop delays take effect.' },
  { name: 'Static hazards', page: 'Timing & Hazards', path: '/timing', description: 'Identify temporary output glitches caused by unequal signal path delays.' },
  { name: 'IC mapping and cost', page: 'IC Cost & Power', path: '/cost-power', description: 'Map gates to available integrated circuits and estimate package counts and cost.' },
  { name: 'Dynamic power', page: 'IC Cost & Power', path: '/cost-power', description: 'Estimate switching power using activity, capacitance, voltage, and frequency assumptions.' },
  { name: 'Stuck-at faults', page: 'Fault Testing', path: '/faults', description: 'Model a wire that is permanently logic 0 or logic 1 and find detecting vectors.' },
  { name: 'Equivalence verification', page: 'Circuit Schematic', path: '/circuit', description: 'Compare a synthesized circuit against its truth table for every defined input row.' },
  { name: 'AI Study Assistant', page: 'AI Assistant', path: '/dashboard', description: 'Ask for an explanation or hint using a compact summary of the current design.' },
];

export function HelpPage() {
  return (
    <div className="page-container dp">
      <PageHead kicker="Learn / Concepts" title="Concept Guide" sub="A quick map from core digital-logic concepts to the workbench tools that demonstrate them." />
      <div className="concept-grid">
        {concepts.map((concept) => (
          <article className="dp-panel concept-card" key={concept.name}>
            <h2>{concept.name}</h2>
            <p>{concept.description}</p>
            <Link to={concept.path}>Open {concept.page}</Link>
          </article>
        ))}
      </div>
    </div>
  );
}
