import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChatPanel } from './ui/ChatPanel';
import { useStore } from './store';
import { loadLastProject, saveLastProject } from './store/project';
import './App.css';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const navItems: NavItem[] = [
  { path: '/input', label: 'Boolean Input', icon: '⌨️' },
  { path: '/truth-table', label: 'Truth Table', icon: '📊' },
  { path: '/kmap', label: 'K-Map & QM', icon: '🗺️' },
  { path: '/circuit', label: 'Circuit Schematic', icon: '⚡' },
  { path: '/sequential', label: 'Sequential / FSM', icon: '🔄' },
  { path: '/timing', label: 'Timing & Hazards', icon: '⏱️' },
  { path: '/cost-power', label: 'IC Cost & Power', icon: '🏷️' },
  { path: '/faults', label: 'Fault Testing', icon: '🔍' },
  { path: '/dashboard', label: 'Dashboard', icon: '📈' },
  { path: '/help', label: 'Concept Guide', icon: '📚' },
];

export const App: React.FC = () => {
  const [chatOpen, setChatOpen] = useState(false);
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    try {
      const saved = window.localStorage.getItem('ldam:theme');
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch {
      return 'system';
    }
  });
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const location = useLocation();

  const currentNav = navItems.find((item) => item.path === location.pathname);

  useEffect(() => {
    try {
      const savedProject = loadLastProject();
      if (savedProject) useStore.setState(savedProject);
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : String(error));
    }
  }, []);

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

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const applyTheme = () => {
      document.documentElement.dataset.theme = theme === 'system'
        ? (media.matches ? 'light' : 'dark')
        : theme;
    };
    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [theme]);

  const cycleTheme = () => {
    const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(next);
    try {
      if (next === 'system') window.localStorage.removeItem('ldam:theme');
      else window.localStorage.setItem('ldam:theme', next);
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="app-layout">
      {/* Top Header */}
      <header className="app-header">
        <div className="header-brand">
          <div className="logo-badge" aria-hidden="true">A</div>
          <div className="brand-text">
            <h2>Aletheia</h2>
            <span>Logic Design &amp; Microprocessor Workbench</span>
          </div>
        </div>

        <div className="header-actions">
          <div className="engine-badge">
            <span className="dot online"></span>
            Pure TS Engine: Active
          </div>
          <button
            className="theme-toggle"
            onClick={cycleTheme}
            aria-label={`Theme: ${theme}. Change theme`}
            title={`Theme: ${theme}`}
          >
            {theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '🌓'} Theme
          </button>
          <button
            className={`btn-chat-toggle ${chatOpen ? 'active' : ''}`}
            onClick={() => setChatOpen(!chatOpen)}
            title="Toggle AI Study Assistant"
            aria-expanded={chatOpen}
          >
            🤖 AI Assistant
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="app-body">
        {/* Left Navigation */}
        <aside className="app-sidebar">
          <div className="sidebar-section-title">Analysis Pipeline</div>
          <nav className="nav-menu">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Center Workspace */}
        <main className="app-workspace">
          <Outlet />
        </main>

        {/* Collapsible Right Chat Panel */}
        <ChatPanel
          open={chatOpen}
          page={location.pathname}
          pageLabel={currentNav?.label ?? 'workspace'}
          onClose={() => setChatOpen(false)}
        />
      </div>
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
