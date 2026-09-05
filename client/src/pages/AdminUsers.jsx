import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import clsx from 'clsx';

export default function AdminUsers() {
  const qc = useQueryClient();
  const { data: users, isLoading } = useQuery({ queryKey: ['users'], queryFn: api.listUsers });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: '', username: '', fullName: '', password: '', role: 'OPERATOR', department: '' });

  const createMutation = useMutation({
    mutationFn: api.createUser,
    onSuccess: () => {
      toast.success('User created');
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowForm(false);
      setForm({ email: '', username: '', fullName: '', password: '', role: 'OPERATOR', department: '' });
    },
    onError: (e) => toast.error(e.message),
  });

  const deactivate = useMutation({
    mutationFn: api.deactivateUser,
    onSuccess: () => { toast.success('User deactivated'); qc.invalidateQueries({ queryKey: ['users'] }); },
  });

  const roleBadge = {
    ADMIN: 'bg-red-500/20 text-red-300',
    MANAGER: 'bg-amber-500/20 text-amber-300',
    OPERATOR: 'bg-emerald-500/20 text-emerald-300',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">User Management</h1>
          <p className="text-slate-400 mt-1">Create and manage platform users</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          {showForm ? 'Cancel' : '+ New User'}
        </button>
      </div>

      {showForm && (
        <form
          className="card grid grid-cols-2 gap-4"
          onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }}
        >
          <div><label className="label">Email</label><input className="input" required value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} /></div>
          <div><label className="label">Username</label><input className="input" required value={form.username} onChange={(e) => setForm({...form, username: e.target.value})} /></div>
          <div><label className="label">Full Name</label><input className="input" required value={form.fullName} onChange={(e) => setForm({...form, fullName: e.target.value})} /></div>
          <div><label className="label">Password</label><input type="password" className="input" required value={form.password} onChange={(e) => setForm({...form, password: e.target.value})} /></div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={(e) => setForm({...form, role: e.target.value})}>
              <option value="OPERATOR">Operator</option>
              <option value="MANAGER">Manager</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          <div><label className="label">Department</label><input className="input" value={form.department} onChange={(e) => setForm({...form, department: e.target.value})} /></div>
          <div className="col-span-2"><button className="btn-primary">Create User</button></div>
        </form>
      )}

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-slate-400">
            <tr>
              <th className="text-left px-4 py-3 font-medium">User</th>
              <th className="text-left px-4 py-3 font-medium">Email</th>
              <th className="text-left px-4 py-3 font-medium">Role</th>
              <th className="text-left px-4 py-3 font-medium">Department</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id} className="border-t border-slate-800">
                <td className="px-4 py-3 text-white">{u.fullName}<div className="text-xs text-slate-500">@{u.username}</div></td>
                <td className="px-4 py-3 text-slate-400">{u.email}</td>
                <td className="px-4 py-3"><span className={clsx('badge', roleBadge[u.role])}>{u.role}</span></td>
                <td className="px-4 py-3 text-slate-400">{u.department || '—'}</td>
                <td className="px-4 py-3">
                  <span className={clsx('badge', u.isActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300')}>
                    {u.isActive ? 'ACTIVE' : 'DEACTIVATED'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {u.isActive && (
                    <button onClick={() => deactivate.mutate(u.id)} className="text-red-400 hover:text-red-300 text-sm">
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
