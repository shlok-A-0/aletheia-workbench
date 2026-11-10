import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Hero } from './Hero';
import { ResultRail } from './ResultRail';
import { Spine } from './Spine';
import { TruthSection } from './TruthSection';
import { SimplifySection } from './SimplifySection';
import { CircuitSection } from './CircuitSection';
import { VerifySection } from './VerifySection';
import './workbench.css';

/**
 * The whole combinational flow as one continuous scroll:
 * define → truth table → simplify → circuit → verify & export.
 */
export function Workbench() {
  const { hash } = useLocation();

  // Deep links such as /#circuit (and the old /circuit, /kmap… redirects).
  useEffect(() => {
    if (!hash) return;
    const id = hash.slice(1);
    let attempts = 0;
    const scrollToTarget = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (attempts < 12) {
        attempts++;
        window.setTimeout(scrollToTarget, 50);
      }
    };
    const t = window.setTimeout(scrollToTarget, 40);
    return () => window.clearTimeout(t);
  }, [hash]);

  return (
    <div className="wb">
      <ResultRail />
      <Spine />
      <div className="wb-flow">
        <Hero />
        <div className="wb-inner">
          <TruthSection />
          <SimplifySection />
          <CircuitSection />
          <VerifySection />
        </div>
      </div>
    </div>
  );
}

export default Workbench;
