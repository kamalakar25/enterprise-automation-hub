import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { CheckCircle2, XCircle, Clock, Loader2, Download, Ban, Search, Filter } from 'lucide-react';
import clsx from 'clsx';

const statusConfig = {
  QUEUED: { icon: Clock, cls: 'text-slate-400 bg-slate-800' },
  RUNNING: { icon: Loader2, cls: 'text-blue-300 bg-blue-500/20 animate-pulse' },
  COMPLETED: { icon: CheckCircle2, cls: 'text-emerald-300 bg-emerald-500/20' },
  FAILED: { icon: XCircle, cls: 'text-red-300 bg-red-500/20' },
  CANCELLED: { icon: Ban, cls: 'text-slate-500 bg-slate-700' },
};

export default function JobHistory() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const { data: jobs, isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.listJobs,
    refetchInterval: 4000,
  });

  const filteredJobs = useMemo(() => {
    if (!jobs) return [];
    return jobs.filter((j) => {
      const matchStatus = statusFilter === 'ALL' || j.status === statusFilter;
      const term = searchTerm.toLowerCase();
      const matchSearch =
        !searchTerm ||
        j.module?.name?.toLowerCase().includes(term) ||
        j.triggeredBy?.fullName?.toLowerCase().includes(term) ||
        j.id?.toLowerCase().includes(term);
      return matchStatus && matchSearch;
    });
  }, [jobs, statusFilter, searchTerm]);

  if (isLoading) return <div className="text-slate-400">Loading automation history…</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Job History & Updates Tracker</h1>
          <p className="text-slate-400 text-sm mt-1">Real-time status of all automation executions</p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by module or user..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 w-56"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="RUNNING">Running</option>
              <option value="COMPLETED">Completed</option>
              <option value="FAILED">Failed</option>
              <option value="QUEUED">Queued</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-slate-400">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Module</th>
              <th className="text-left px-4 py-3 font-medium">Triggered By</th>
              <th className="text-left px-4 py-3 font-medium">Started</th>
              <th className="text-left px-4 py-3 font-medium">Duration</th>
              <th className="text-left px-4 py-3 font-medium">Output Report</th>
              <th className="text-left px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs?.map((j) => {
              const cfg = statusConfig[j.status] || statusConfig.QUEUED;
              const Icon = cfg.icon;
              const duration =
                j.startedAt && j.finishedAt
                  ? ((new Date(j.finishedAt) - new Date(j.startedAt)) / 1000).toFixed(1) + 's'
                  : '—';
              return (
                <tr key={j.id} className="border-t border-slate-800 hover:bg-slate-800/30 transition">
                  <td className="px-4 py-3">
                    <span className={clsx('badge', cfg.cls)}>
                      <Icon className={clsx('w-3 h-3 mr-1', j.status === 'RUNNING' && 'animate-spin')} />
                      {j.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="mr-2 text-base">{j.module?.icon}</span>
                    <span className="text-white font-medium">{j.module?.name}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{j.triggeredBy?.fullName || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {j.startedAt ? new Date(j.startedAt).toLocaleString() : new Date(j.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-slate-400 font-mono text-xs">{duration}</td>
                  <td className="px-4 py-3">
                    {j.outputFile ? (
                      <a
                        href={api.downloadFileUrl(j.outputFile.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-400 hover:text-brand-300 inline-flex items-center gap-1 font-medium hover:underline"
                      >
                        <Download className="w-4 h-4" /> Download
                      </a>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/jobs/${j.id}`} className="text-brand-400 hover:text-brand-300 font-medium hover:underline">
                      Live Stream →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!filteredJobs?.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No jobs match your filter criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
