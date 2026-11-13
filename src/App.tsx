import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChatPanel } from './ui/ChatPanel';
import { restoreError, useStore } from './store';
import { saveLastProject } from './store/project';
import './App.css';
import './ui/shell.css';
import './ui/deep/deep.css';

interface NavItem {
  path: string;
  label: string;
  /** Used by the AI assistant to describe where the user is. */
  title: string;
  end?: boolean;
}

/** The continuous workbench is `/`; everything else is a deep-dive page. */
const navItems: NavItem[] = [
  { path: '/', label: 'Workbench', title: 'Combinational workbench', end: true },
  { path: '/sequential', label: 'Sequential', title: 'Sequential / FSM' },
  { path: '/timing', label: 'Timing', title: 'Timing & hazards' },
  { path: '/cost-power', label: 'Cost', title: 'IC cost & power' },
  { path: '/faults', label: 'Faults', title: 'Fault testing' },
  { path: '/blocks', label: 'Blocks', title: 'Standard MSI blocks' },
  { path: '/help', label: 'Learn', title: 'Concept guide' },
];

export const App: React.FC = () => {
  const [chatOpen, setChatOpen] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(restoreError);
  const location = useLocation();

  const currentNav = navItems.find((item) => item.path === location.pathname);

  // Keep the current page's link visible when the nav scrolls sideways on phones.
  useEffect(() => {
    document.querySelector('.shell-nav a.is-active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [location.pathname]);

  useEffect(() => {
    let timer = 0;
    const unsubscribe = useStore.subscribe((state) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          saveLastProject(state);
          setPersistenceError(null);
        } catch (error) {
          setPersistenceError(error instanceof Error ? error.message : String(error));
        }
      }, 300);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="shell-top">
        <NavLink to="/" end className="shell-brand" aria-label="Aletheia workbench home">
          ALETHEIA <i>[DOT]</i> LOGIC
        </NavLink>

        <nav className="shell-nav" aria-label="Pages">
          {navItems.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.end} className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="shell-actions">
          <button
            type="button"
            className={`shell-ai ${chatOpen ? 'is-open' : ''}`}
            onClick={() => setChatOpen(!chatOpen)}
            aria-expanded={chatOpen}
            title="Toggle AI study assistant"
          >
            AI
          </button>
        </div>
      </header>

      <main id="main" className="shell-main" tabIndex={-1}>
        <Outlet />
      </main>

      <ChatPanel
        open={chatOpen}
        page={location.pathname}
        pageLabel={currentNav?.title ?? 'workspace'}
        onClose={() => setChatOpen(false)}
      />

      {persistenceError && (
        <div className="persistence-alert" role="alert">
          Automatic session save failed: {persistenceError}
          <button onClick={() => setPersistenceError(null)} aria-label="Dismiss save warning">×</button>
        </div>
      )}
    </div>
  );
};

export default App;
