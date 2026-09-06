import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Play, Server, Monitor } from 'lucide-react';
import clsx from 'clsx';

const execIcon = {
  PYTHON_HEADLESS: Server,
  WINDOWS_VBS: Monitor,
  HTTP_WORKER: Server,
};

export default function Modules() {
  const { data: modules, isLoading } = useQuery({ queryKey: ['modules'], queryFn: api.listModules });

  if (isLoading) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Automation Modules</h1>
        <p className="text-slate-400 mt-1">All automations available to your role</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {modules?.map((m) => {
          const ExecIcon = execIcon[m.executionType] || Server;
          const isCompleted = m.slug === 'sap-daily-tracker';
          return (
            <div key={m.id} className="card flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-start justify-between mb-3">
                  <span className="text-4xl">{m.icon || '⚙️'}</span>
                  <div className="flex flex-col items-end gap-1.5">
                    {isCompleted ? (
                      <span className="badge bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-medium">
                        🟢 Production Ready
                      </span>
                    ) : (
                      <span className="badge bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px] font-medium">
                        🚧 In Development
                      </span>
                    )}
                    <span className="badge bg-slate-800 text-slate-400 flex items-center gap-1 text-[10px]">
                      <ExecIcon className="w-3 h-3" />
                      {m.executionType.replace('_', ' ').toLowerCase()}
                    </span>
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-white">{m.name}</h3>
                <p className="text-sm text-slate-400 mt-1 leading-relaxed">{m.description}</p>
              </div>

              <Link
                to={`/modules/${m.slug}`}
                className={clsx(
                  'btn-primary justify-center mt-2',
                  !isCompleted && 'opacity-80 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                )}
              >
                <Play className="w-4 h-4" />
                {isCompleted ? 'Launch' : 'Preview Module'}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
