import { createBrowserRouter, Navigate } from 'react-router-dom';
import App from '../App';
import { PageErrorBoundary } from '../ui/PageErrorBoundary';
import {
  InputPage,
  TruthTablePage,
  KMapPage,
  CircuitPage,
  SequentialPage,
  TimingPage,
  CostPowerPage,
  FaultsPage,
  DashboardPage,
  SelfTestPage,
  HelpPage,
} from '../ui/pages';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/input" replace /> },
      { path: 'input', element: <PageErrorBoundary><InputPage /></PageErrorBoundary> },
      { path: 'truth-table', element: <PageErrorBoundary><TruthTablePage /></PageErrorBoundary> },
      { path: 'kmap', element: <PageErrorBoundary><KMapPage /></PageErrorBoundary> },
      { path: 'circuit', element: <PageErrorBoundary><CircuitPage /></PageErrorBoundary> },
      { path: 'sequential', element: <PageErrorBoundary><SequentialPage /></PageErrorBoundary> },
      { path: 'timing', element: <PageErrorBoundary><TimingPage /></PageErrorBoundary> },
      { path: 'cost-power', element: <PageErrorBoundary><CostPowerPage /></PageErrorBoundary> },
      { path: 'faults', element: <PageErrorBoundary><FaultsPage /></PageErrorBoundary> },
      { path: 'dashboard', element: <PageErrorBoundary><DashboardPage /></PageErrorBoundary> },
      { path: 'selftest', element: <PageErrorBoundary><SelfTestPage /></PageErrorBoundary> },
      { path: 'help', element: <PageErrorBoundary><HelpPage /></PageErrorBoundary> },
    ],
  },
]);
