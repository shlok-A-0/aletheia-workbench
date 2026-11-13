import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import App from '../App';
import { PageErrorBoundary } from '../ui/PageErrorBoundary';
import { Workbench } from '../ui/workbench/Workbench';
import {
  InputPage,
  BlocksPage,
  SequentialPage,
  TimingPage,
  CostPowerPage,
  FaultsPage,
  DashboardPage,
  HelpPage,
} from '../ui/pages';

const guard = (node: ReactNode) => <PageErrorBoundary>{node}</PageErrorBoundary>;

/**
 * `/` is the continuous workbench (define → table → simplify → circuit → verify).
 * The old step pages now redirect into it so existing links keep working.
 * Deep-dive tools that deserve their own screen stay as separate pages.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: guard(<Workbench />) },

      // old wizard steps and in-page sections → scroll anchors of the workbench
      { path: 'truth-table', element: <Navigate to="/#table" replace /> },
      { path: 'table', element: <Navigate to="/#table" replace /> },
      { path: 'kmap', element: <Navigate to="/#simplify" replace /> },
      { path: 'simplify', element: <Navigate to="/#simplify" replace /> },
      { path: 'circuit', element: <Navigate to="/#circuit" replace /> },
      { path: 'verify', element: <Navigate to="/#verify" replace /> },

      // separate pages
      { path: 'input', element: guard(<InputPage />) },
      { path: 'blocks', element: guard(<BlocksPage />) },
      { path: 'sequential', element: guard(<SequentialPage />) },
      { path: 'timing', element: guard(<TimingPage />) },
      { path: 'cost-power', element: guard(<CostPowerPage />) },
      { path: 'faults', element: guard(<FaultsPage />) },
      { path: 'dashboard', element: guard(<DashboardPage />) },
      { path: 'help', element: guard(<HelpPage />) },
    ],
  },
]);
