import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Blocks,
  History,
  CalendarClock,
  Users,
  ScrollText,
  LogOut,
  Cpu,
} from 'lucide-react';
import { useAuth } from '../store/auth.jsx';
import clsx from 'clsx';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/modules', icon: Blocks, label: 'Automations' },
    { to: '/jobs', icon: History, label: 'Job History' },
    { to: '/schedules', icon: CalendarClock, label: 'Schedules' },
  ];

  const adminItems = [
    { to: '/admin/users', icon: Users, label: 'Users', roles: ['ADMIN'] },
    { to: '/admin/audit', icon: ScrollText, label: 'Audit Logs', roles: ['ADMIN', 'MANAGER'] },
  ];

  const roleBadgeColor = {
    ADMIN: 'bg-red-500/20 text-red-300',
    MANAGER: 'bg-amber-500/20 text-amber-300',
    OPERATOR: 'bg-emerald-500/20 text-emerald-300',
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-5 border-b border-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <Cpu className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-white leading-tight">Automation</h1>
            <h1 className="font-bold text-brand-400 -mt-1">Hub</h1>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Workspace
          </div>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-brand-600/20 text-brand-400 border border-brand-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                )
              }
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}

          {(user?.role === 'ADMIN' || user?.role === 'MANAGER') && (
            <>
              <div className="px-3 py-2 mt-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Administration
              </div>
              {adminItems
                .filter((i) => i.roles.includes(user.role))
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                        isActive
                          ? 'bg-brand-600/20 text-brand-400 border border-brand-600/30'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      )
                    }
                  >
                    <item.icon className="w-5 h-5" />
                    {item.label}
                  </NavLink>
                ))}
            </>
          )}
        </nav>

        <div className="p-3 border-t border-slate-800">
          <div className="flex items-center gap-3 px-2 py-2 mb-2">
            <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-sm font-semibold text-white">
              {user?.fullName?.[0] || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.fullName}</p>
              <div className="flex items-center gap-2">
                <span className={clsx('badge', roleBadgeColor[user?.role])}>{user?.role}</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
