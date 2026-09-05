import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ScrollText } from 'lucide-react';

export default function AuditLogs() {
  const { data: logs, isLoading } = useQuery({ queryKey: ['audit'], queryFn: api.listAudit });

  if (isLoading) return <div className="text-slate-400">Loading…</div>;

  const actionColor = {
    LOGIN: 'text-emerald-300',
    LOGOUT: 'text-slate-400',
    RUN_JOB: 'text-blue-300',
    DOWNLOAD_FILE: 'text-amber-300',
    CREATE_USER: 'text-purple-300',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-brand-400" /> Audit Logs
        </h1>
        <p className="text-slate-400 mt-1">Track all user actions across the platform</p>
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-slate-400">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Time</th>
              <th className="text-left px-4 py-3 font-medium">User</th>
              <th className="text-left px-4 py-3 font-medium">Action</th>
              <th className="text-left px-4 py-3 font-medium">Resource</th>
              <th className="text-left px-4 py-3 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {logs?.map((l) => (
              <tr key={l.id} className="border-t border-slate-800">
                <td className="px-4 py-3 text-slate-400">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-white">{l.user?.fullName || 'System'}</td>
                <td className={`px-4 py-3 font-mono text-xs ${actionColor[l.action] || 'text-slate-300'}`}>{l.action}</td>
                <td className="px-4 py-3 text-slate-400">{l.resourceType} {l.resourceId ? `(${l.resourceId.slice(0,8)}…)` : ''}</td>
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{l.ipAddress || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
