import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import { EXAMPLES, loadExample } from '../examples';
import { analyzeSource, applyAnalysis, type Source, type SourceMode } from '../../pipeline/analyze';
import { useResults } from '../../pipeline/useResults';
import { IconArrow } from './icons';

const DEFAULT_EXPR = "A'B + C";
const OPS: [string, string][] = [["'", 'NOT'], [' + ', 'OR'], [' * ', 'AND'], [' ^ ', 'XOR'], ['(', ''], [')', '']];
const MODES: { id: SourceMode; label: string }[] = [
  { id: 'expr', label: 'Expression' },
  { id: 'minterms', label: 'Minterms' },
  { id: 'maxterms', label: 'Maxterms' },
];
/** Examples that live on this page; the rest open their own page. */
const INLINE_ROUTES = new Set(['/', '/#circuit']);

function initialSource(): Source {
  const s = useStore.getState();
  const typed = s.inputMode === 'expr' && s.rawInput && !/^(Example|Circuit):/.test(s.rawInput);
  return {
    mode: 'expr',
    text: typed ? s.rawInput : DEFAULT_EXPR,
    dontCares: '',
    numVars: Math.min(Math.max(s.vars.length, 2), 6),
  };
}

export function Hero() {
  const navigate = useNavigate();
  const results = useResults();
  const [src, setSrc] = useState<Source>(initialSource);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const timer = useRef(0);
  const field = useRef<HTMLInputElement | null>(null);

  const run = useCallback((next: Source, delay = 160) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const out = analyzeSource(next);
      if (out.ok) {
        applyAnalysis(out.analysis, next);
        setError(null);
      } else {
        // Keep the previous result on screen; just explain what's wrong.
        setError(out.empty ? null : out.error);
      }
    }, delay);
  }, []);

  // A fresh page is never empty: build the default function straight away.
  useEffect(() => {
    if (!useStore.getState().truthTable) run(src, 0);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch: Partial<Source>) => {
    const next = { ...src, ...patch };
    setSrc(next);
    setLoaded(null);
    run(next);
  };

  const insert = (token: string) => {
    const el = field.current;
    const start = el?.selectionStart ?? src.text.length;
    const end = el?.selectionEnd ?? src.text.length;
    update({ text: src.text.slice(0, start) + token + src.text.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + token.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const pickExample = (id: string) => {
    const label = EXAMPLES.find((e) => e.id === id)?.label ?? id;
    window.clearTimeout(timer.current);
    const route = loadExample(id);
    setError(null);
    if (INLINE_ROUTES.has(route)) {
      setLoaded(label);
      setSrc((s) => ({ ...s, text: '' }));
      if (route === '/#circuit') {
        requestAnimationFrame(() => document.getElementById('circuit')?.scrollIntoView({ behavior: 'smooth' }));
      }
    } else {
      navigate(route);
    }
  };

  const isExpr = src.mode === 'expr';
  const status = error
    ? { cls: 'is-error', text: error }
    : loaded
      ? { cls: 'is-ok', text: `${loaded} loaded. Type to replace it.` }
      : results.hasResult
        ? { cls: 'is-ok', text: `${results.formula}  ·  ${results.gateCount} gates  ·  ${results.literals} literals` }
        : { cls: '', text: 'Type a function to begin.' };

  return (
    <section id="input" className="wb-hero" aria-label="Define a function">
      <div className="wb-hero-chrome" aria-hidden="true">
        <span>{'//'} aletheia / logic workbench</span>
        <span>live · no submit button</span>
      </div>
      <span className="wb-px" style={{ top: '16%', left: '2.2%' }} aria-hidden="true" />
      <span className="wb-px wb-px--sm" style={{ top: '31%', left: '93%' }} aria-hidden="true" />
      <span className="wb-px" style={{ top: '64%', left: '3%' }} aria-hidden="true" />
      <span className="wb-px wb-px--sm" style={{ top: '82%', left: '88%' }} aria-hidden="true" />

      <div className="wb-hero-body">
        <h1 className="wb-hero-title echo" data-text={'LOGIC IN.\nCIRCUIT OUT.'}>
          LOGIC IN.
          <br />
          CIRCUIT OUT.
        </h1>

        <div className="wb-console">
          <div className="wb-console-bar">
            <div className="wb-seg" role="tablist" aria-label="Input type">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={src.mode === m.id}
                  className={src.mode === m.id ? 'is-on' : undefined}
                  onClick={() => update({ mode: m.id, text: m.id === 'expr' ? DEFAULT_EXPR : '1, 3, 5, 7' })}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {!isExpr && (
              <label className="wb-vars">
                <span className="t-label">Vars</span>
                <select value={src.numVars} onChange={(e) => update({ numVars: Number(e.target.value) })}>
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label className="wb-field">
            <span className="wb-field-eq">{isExpr ? 'F =' : src.mode === 'minterms' ? 'Σm' : 'ΠM'}</span>
            <input
              ref={field}
              value={src.text}
              onChange={(e) => update({ text: e.target.value })}
              placeholder={loaded ? `${loaded}` : isExpr ? "A'B + C" : '1, 3, 5, 7'}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              aria-label={isExpr ? 'Boolean expression' : 'Index list'}
              aria-invalid={Boolean(error)}
              aria-describedby="wb-status"
            />
          </label>

          {!isExpr && (
            <label className="wb-field wb-field--sub">
              <span className="wb-field-eq">d</span>
              <input
                value={src.dontCares}
                onChange={(e) => update({ dontCares: e.target.value })}
                placeholder="don't cares, e.g. 0, 2"
                spellCheck={false}
                autoComplete="off"
                aria-label="Don't-care indices"
              />
            </label>
          )}

          <div className="wb-console-foot">
            <div className="wb-ops" aria-label="Insert operator">
              {isExpr && OPS.map(([token, name]) => (
                <button key={token} type="button" className="wb-op" onClick={() => insert(token)} title={name || undefined}>
                  {token.trim() || token}
                </button>
              ))}
            </div>
            <p id="wb-status" className={`wb-status ${status.cls}`} role={error ? 'alert' : undefined}>
              {status.text}
            </p>
          </div>
        </div>

        <div className="wb-hero-actions">
          <a
            className="wb-cta"
            href="#circuit"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('circuit')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            See the circuit <IconArrow />
          </a>
          <div className="wb-chips" role="group" aria-label="Worked examples">
            <span className="t-label">Try</span>
            {EXAMPLES.map((e) => (
              <button key={e.id} type="button" className="wb-chip" title={e.description} onClick={() => pickExample(e.id)}>
                {e.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="wb-hero-foot" aria-hidden="true">
        <span>↓ scroll</span>
        <span>01 / 05</span>
      </div>
    </section>
  );
}
