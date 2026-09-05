import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Terminal } from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';

export default function JobDetail() {
  const { id } = useParams();
  const { data: job, refetch } = useQuery({ queryKey: ['job', id], queryFn: () => api.getJob(id) });
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (!id) return;
    const sock = getSocket();
    if (!sock.connected) sock.connect();
    sock.emit('subscribe:job', id);
    const onLog = (p) => {
      if (p.jobId === id) setLogs((prev) => [...prev, p]);
    };
    const onStatus = (p) => {
      if (p.jobId === id) refetch();
    };
    sock.on('log', onLog);
    sock.on('status', onStatus);
    return () => {
      sock.off('log', onLog);
      sock.off('status', onStatus);
      sock.emit('unsubscribe:job', id);
    };
  }, [id, refetch]);

  return (
    <div className="space-y-6">
      <Link to="/jobs" className="flex items-center gap-2 text-slate-400 hover:text-white text-sm">
        <ArrowLeft className="w-4 h-4" /> Back to jobs
      </Link>

      <h1 className="text-2xl font-bold text-white">Job Details</h1>

      {job && (
        <div className="card space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-slate-500">ID</div>
              <div className="text-white font-mono truncate">{job.id}</div>
            </div>
            <div>
              <div className="text-slate-500">Module</div>
              <div className="text-white">{job.module?.icon} {job.module?.name}</div>
            </div>
            <div>
              <div className="text-slate-500">Status</div>
              <div className="text-white font-semibold">{job.status}</div>
            </div>
            <div>
              <div className="text-slate-500">Triggered By</div>
              <div className="text-white">{job.triggeredBy?.fullName}</div>
            </div>
            <div>
              <div className="text-slate-500">Started</div>
              <div className="text-white">{job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}</div>
            </div>
            <div>
              <div className="text-slate-500">Finished</div>
              <div className="text-white">{job.finishedAt ? new Date(job.finishedAt).toLocaleString() : '—'}</div>
            </div>
          </div>

          {job.outputFile && (
            <div>
              <div className="text-slate-500 text-sm mb-1">Output Report</div>
              <a href={api.downloadFileUrl(job.outputFile.id)} target="_blank" rel="noreferrer"
                 className="btn-secondary inline-flex">
                <Download className="w-4 h-4" /> {job.outputFile.originalName}
              </a>
            </div>
          )}

          {job.errorMessage && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm">
              {job.errorMessage}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
          <Terminal className="w-5 h-5 text-brand-400" /> Console Output
        </h3>
        <div className="bg-black/50 border border-slate-800 rounded-lg p-4 h-80 overflow-y-auto font-mono text-sm">
          {logs.map((l, i) => (
            <div key={i} className={l.level === 'error' ? 'text-red-400' : 'text-slate-300'}>
              {l.line}
            </div>
          ))}
          {logs.length === 0 && <p className="text-slate-600">Connecting to log stream…</p>}
        </div>
      </div>
    </div>
  );
}
