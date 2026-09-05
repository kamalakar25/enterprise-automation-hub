import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './store/auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Modules from './pages/Modules.jsx';
import ModuleRunner from './pages/ModuleRunner.jsx';
import JobHistory from './pages/JobHistory.jsx';
import JobDetail from './pages/JobDetail.jsx';
import Schedules from './pages/Schedules.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import AuditLogs from './pages/AuditLogs.jsx';

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-slate-400">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="modules" element={<Modules />} />
        <Route path="modules/:slug" element={<ModuleRunner />} />
        <Route path="jobs" element={<JobHistory />} />
        <Route path="jobs/:id" element={<JobDetail />} />
        <Route path="schedules" element={<Schedules />} />
        <Route
          path="admin/users"
          element={
            <ProtectedRoute roles={['ADMIN']}>
              <AdminUsers />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/audit"
          element={
            <ProtectedRoute roles={['ADMIN', 'MANAGER']}>
              <AuditLogs />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
