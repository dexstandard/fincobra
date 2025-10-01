import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import Dashboard from './routes/Dashboard';
import Keys from './routes/Keys';
import PortfolioWorkflowSetup from './routes/PortfolioWorkflowSetup';
import WorkflowView from './routes/WorkflowView';
import Settings from './routes/Settings';
import Terms from './routes/Terms';
import Privacy from './routes/Privacy';
import Users from './routes/Users';
import { LanguageProvider } from './lib/i18n';

export default function App() {
  return (
    <LanguageProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/keys" element={<Keys />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/users" element={<Users />} />
          <Route
            path="/portfolio-workflow"
            element={<PortfolioWorkflowSetup />}
          />
          <Route path="/portfolio-workflows/:id" element={<WorkflowView />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </LanguageProvider>
  );
}
