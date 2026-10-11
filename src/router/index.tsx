import { createBrowserRouter, Navigate } from 'react-router-dom';
import App from '../App';
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
} from '../ui/pages';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/input" replace /> },
      { path: 'input', element: <InputPage /> },
      { path: 'truth-table', element: <TruthTablePage /> },
      { path: 'kmap', element: <KMapPage /> },
      { path: 'circuit', element: <CircuitPage /> },
      { path: 'sequential', element: <SequentialPage /> },
      { path: 'timing', element: <TimingPage /> },
      { path: 'cost-power', element: <CostPowerPage /> },
      { path: 'faults', element: <FaultsPage /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'selftest', element: <SelfTestPage /> },
    ],
  },
]);
