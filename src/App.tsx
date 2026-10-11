import React, { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import './App.css';

interface NavItem {
  path: string;
  label: string;
  phase: string;
  icon: string;
}

const navItems: NavItem[] = [
  { path: '/input', label: 'Boolean Input', phase: 'P1', icon: '⌨️' },
  { path: '/truth-table', label: 'Truth Table', phase: 'P1', icon: '📊' },
  { path: '/kmap', label: 'K-Map & QM', phase: 'P2', icon: '🗺️' },
  { path: '/circuit', label: 'Circuit Schematic', phase: 'P3', icon: '⚡' },
  { path: '/sequential', label: 'Sequential / FSM', phase: 'P4', icon: '🔄' },
  { path: '/timing', label: 'Timing & Hazards', phase: 'P5', icon: '⏱️' },
  { path: '/cost-power', label: 'IC Cost & Power', phase: 'P6', icon: '🏷️' },
  { path: '/faults', label: 'Fault Testing', phase: 'P6', icon: '🔍' },
  { path: '/dashboard', label: 'Dashboard', phase: 'P8', icon: '📈' },
  { path: '/selftest', label: 'Self-Test Suite', phase: 'P8', icon: '🧪' },
];

export const App: React.FC = () => {
  const [chatOpen, setChatOpen] = useState(false);
  const location = useLocation();

  const currentNav = navItems.find((item) => item.path === location.pathname);

  return (
    <div className="app-layout">
      {/* Top Header */}
      <header className="app-header">
        <div className="header-brand">
          <div className="logo-badge">LDAM</div>
          <div className="brand-text">
            <h2>Logic Design & Applications</h2>
            <span>Digital Circuit Analyzer & Synthesis Platform</span>
          </div>
        </div>

        <div className="header-center">
          {currentNav && (
            <div className="current-phase-pill">
              <span className="pill-phase">{currentNav.phase}</span>
              <span className="pill-name">{currentNav.label}</span>
            </div>
          )}
        </div>

        <div className="header-actions">
          <div className="engine-badge">
            <span className="dot online"></span>
            Pure TS Engine: Active
          </div>
          <button
            className={`btn-chat-toggle ${chatOpen ? 'active' : ''}`}
            onClick={() => setChatOpen(!chatOpen)}
            title="Toggle AI Study Assistant"
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
                <span className="nav-phase-tag">{item.phase}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Center Workspace */}
        <main className="app-workspace">
          <Outlet />
        </main>

        {/* Collapsible Right Chat Panel */}
        <aside className={`app-chat-panel ${chatOpen ? 'open' : 'closed'}`}>
          <div className="chat-header">
            <div className="chat-title">
              <span>🤖</span> AI Study Assistant
            </div>
            <button className="chat-close" onClick={() => setChatOpen(false)}>
              ✕
            </button>
          </div>
          <div className="chat-content">
            <div className="chat-intro">
              <p>
                <strong>Course Assistant (Phase 7)</strong>
              </p>
              <p className="chat-desc">
                Ask step-by-step questions about Boolean minimization, K-map grouping, excitation
                equations, or circuit timing.
              </p>
            </div>
            <div className="chat-placeholder-box">
              <span className="icon">💡</span>
              <span>Contextually linked to active design on <em>{currentNav?.label || 'workspace'}</em></span>
            </div>
            <div className="suggested-prompts">
              <span className="prompt-label">Quick Prompts:</span>
              <button className="prompt-chip">"Why is this group minimal?"</button>
              <button className="prompt-chip">"Show step-by-step excitation derivation"</button>
              <button className="prompt-chip">"Explain static-1 hazard in this circuit"</button>
            </div>
          </div>
          <div className="chat-footer">
            <input
              type="text"
              placeholder="Ask a question about this circuit..."
              className="chat-input"
              disabled
            />
            <button className="chat-send" disabled>
              Send
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default App;
