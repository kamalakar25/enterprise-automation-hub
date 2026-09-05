import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Play, CheckCircle2, XCircle, Clock, Blocks } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

const statusIcon = {
  QUEUED: Clock,
  RUNNING: Play,
  COMPLETED: CheckCircle2,
  FAILED: XCircle,
  CANCELLED: XCircle,
};
const statusColor = {
  QUEUED: 'text-slate-400 bg-slate-800',
  RUNNING: 'text-blue-300 bg-blue-500/20 animate-pulse',
  COMPLETED: 'text-emerald-300 bg-emerald-500/20',
  FAILED: 'text-red-300 bg-red-500/20',
  CANCELLED: 'text-slate-500 bg-slate-700',
};

export default function Dashboard() {
  const { data: modules } = useQuery({ queryKey: ['modules'], queryFn: api.listModules });
  const { data: jobs } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.listJobs,
    refetchInterval: 5000,
  });

  const stats = {
    total: jobs?.length || 0,
    running: jobs?.filter((j) => j.status === 'RUNNING').length || 0,
    completed: jobs?.filter((j) => j.status === 'COMPLETED').length || 0,
    failed: jobs?.filter((j) => j.status === 'FAILED').length || 0,
  };

  const statCards = [
    { label: 'Total Runs', value: stats.total, icon: Play, color: 'from-brand-500 to-brand-700' },
    { label: 'Running', value: stats.running, icon: Clock, color: 'from-blue-500 to-blue-700' },
    { label: 'Completed', value: stats.completed, icon: CheckCircle2, color: 'from-emerald-500 to-emerald-700' },
    { label: 'Failed', value: stats.failed, icon: XCircle, color: 'from-red-500 to-red-700' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 mt-1">Monitor automation jobs and launch workflows</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <div key={s.label} className="card flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center`}>
              <s.icon className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-slate-400">{s.label}</p>
              <p className="text-2xl font-bold text-white">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Automations grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Blocks className="w-5 h-5 text-brand-400" /> Available Automations
          </h2>
          <Link to="/modules" className="text-sm text-brand-400 hover:text-brand-300">
            View all →
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules?.map((m) => (
            <Link
              key={m.id}
              to={`/modules/${m.slug}`}
              className="card hover:border-brand-500/50 hover:bg-slate-900/60 transition group cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-3xl">{m.icon || '⚙️'}</span>
                <span className="badge bg-slate-800 text-slate-400">{m.executionType.replace('_', ' ')}</span>
              </div>
              <h3 className="font-semibold text-white group-hover:text-brand-400 transition">{m.name}</h3>
              <p className="text-sm text-slate-400 mt-1 line-clamp-2">{m.description}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent jobs */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Recent Activity</h2>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 text-slate-400">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Module</th>
                <th className="text-left px-4 py-3 font-medium">Triggered By</th>
                <th className="text-left px-4 py-3 font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {jobs?.slice(0, 8).map((j) => {
                const Icon = statusIcon[j.status] || Clock;
                return (
                  <tr key={j.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <span className={clsx('badge', statusColor[j.status])}>
                        <Icon className="w-3 h-3 mr-1" />
                        {j.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white">{j.module?.name}</td>
                    <td className="px-4 py-3 text-slate-400">{j.triggeredBy?.fullName || '—'}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {j.startedAt ? new Date(j.startedAt).toLocaleString() : new Date(j.createdAt).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
              {!jobs?.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No jobs yet. Run an automation to see activity here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
