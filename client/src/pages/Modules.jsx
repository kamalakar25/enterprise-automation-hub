import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Play, Server, Monitor } from 'lucide-react';

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
          return (
            <div key={m.id} className="card flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <span className="text-4xl">{m.icon || '⚙️'}</span>
                <span className="badge bg-slate-800 text-slate-400 flex items-center gap-1">
                  <ExecIcon className="w-3 h-3" />
                  {m.executionType.replace('_', ' ').toLowerCase()}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-white">{m.name}</h3>
              <p className="text-sm text-slate-400 mt-1 flex-1">{m.description}</p>
              <Link to={`/modules/${m.slug}`} className="btn-primary mt-4 justify-center">
                <Play className="w-4 h-4" />
                Launch
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
