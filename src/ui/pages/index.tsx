import React from 'react';
import { PlaceholderPage } from './PlaceholderPage';

export { InputPage } from './InputPage';
export { TruthTablePage } from './TruthTablePage';
export { KMapPage } from './KMapPage';
export { CircuitPage } from './CircuitPage';
export { SequentialPage } from './SequentialPage';


export const TimingPage: React.FC = () => (
  <PlaceholderPage
    title="Timing Diagrams &amp; Hazards"
    phase="Phase 5"
    description="Digital waveforms, propagation delay modeling, setup/hold checks, and static-1 hazard identification."
  />
);

export const CostPowerPage: React.FC = () => (
  <PlaceholderPage
    title="IC Mapping, Cost &amp; Power"
    phase="Phase 6"
    description="Mapping logic to 7400-series TTL/CMOS ICs, bill of materials, package diagrams, and CMOS switching power estimates."
  />
);

export const FaultsPage: React.FC = () => (
  <PlaceholderPage
    title="Fault Testing &amp; Test Vectors"
    phase="Phase 6"
    description="Stuck-at fault simulation (SA0/SA1), fault coverage metrics, and minimal test vector generation."
  />
);

export const DashboardPage: React.FC = () => (
  <PlaceholderPage
    title="Comprehensive Design Dashboard"
    phase="Phase 8"
    description="Summary view comparing original, simplified, and NAND implementations across gate count, delay, cost, and power."
  />
);

export const SelfTestPage: React.FC = () => (
  <PlaceholderPage
    title="System Diagnostics &amp; Self-Test"
    phase="Phase 8"
    description="Diagnostic test runner verifying engine determinism and correctness against course benchmarks."
  />
);
