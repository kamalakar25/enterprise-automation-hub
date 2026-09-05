import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { CheckCircle2, XCircle, Clock, Loader2, Download, Ban } from 'lucide-react';
import clsx from 'clsx';

const statusConfig = {
  QUEUED: { icon: Clock, cls: 'text-slate-400 bg-slate-800' },
  RUNNING: { icon: Loader2, cls: 'text-blue-300 bg-blue-500/20 animate-pulse' },
  COMPLETED: { icon: CheckCircle2, cls: 'text-emerald-300 bg-emerald-500/20' },
  FAILED: { icon: XCircle, cls: 'text-red-300 bg-red-500/20' },
  CANCELLED: { icon: Ban, cls: 'text-slate-500 bg-slate-700' },
};

export default function JobHistory() {
  const { data: jobs, isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.listJobs,
    refetchInterval: 5000,
  });

  if (isLoading) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Job History</h1>
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-slate-400">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Module</th>
              <th className="text-left px-4 py-3 font-medium">Triggered By</th>
              <th className="text-left px-4 py-3 font-medium">Started</th>
              <th className="text-left px-4 py-3 font-medium">Duration</th>
              <th className="text-left px-4 py-3 font-medium">Output</th>
              <th className="text-left px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {jobs?.map((j) => {
              const cfg = statusConfig[j.status];
              const Icon = cfg.icon;
              const duration =
                j.startedAt && j.finishedAt
                  ? ((new Date(j.finishedAt) - new Date(j.startedAt)) / 1000).toFixed(1) + 's'
                  : '—';
              return (
                <tr key={j.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <span className={clsx('badge', cfg.cls)}>
                      <Icon className={clsx('w-3 h-3 mr-1', j.status === 'RUNNING' && 'animate-spin')} />
                      {j.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="mr-1">{j.module?.icon}</span>
                    <span className="text-white">{j.module?.name}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{j.triggeredBy?.fullName || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {j.startedAt ? new Date(j.startedAt).toLocaleString() : new Date(j.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{duration}</td>
                  <td className="px-4 py-3">
                    {j.outputFile ? (
                      <a href={api.downloadFileUrl(j.outputFile.id)} target="_blank" rel="noreferrer"
                         className="text-brand-400 hover:text-brand-300 inline-flex items-center gap-1">
                        <Download className="w-4 h-4" /> Report
                      </a>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/jobs/${j.id}`} className="text-brand-400 hover:text-brand-300">
                      View →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
