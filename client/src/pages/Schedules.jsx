import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { CalendarClock } from 'lucide-react';

export default function Schedules() {
  const { data: schedules, isLoading } = useQuery({ queryKey: ['schedules'], queryFn: api.listSchedules });

  if (isLoading) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Scheduled Automations</h1>
        <p className="text-slate-400 mt-1">Cron-based recurring jobs</p>
      </div>

      {!schedules?.length ? (
        <div className="card text-center py-12 text-slate-500">
          <CalendarClock className="w-12 h-12 mx-auto mb-3 opacity-40" />
          No schedules yet. Configure cron schedules via the Admin API or extend this UI.
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <div key={s.id} className="card flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-white">{s.name}</h3>
                <p className="text-sm text-slate-400">
                  {s.module?.icon} {s.module?.name} · cron: <code className="text-brand-400">{s.cronExpression}</code>
                </p>
              </div>
              <span className={`badge ${s.isActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-400'}`}>
                {s.isActive ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
