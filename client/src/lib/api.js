const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('auth_token');
}

export async function apiFetch(path, { method = 'GET', body, headers = {}, formData } = {}) {
  const opts = {
    method,
    headers: { ...headers },
  };
  const token = getToken();
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;

  if (formData) {
    opts.body = formData;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, opts);
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const msg = data?.error || (typeof data === 'string' ? data : `Request failed (${res.status})`);
    throw new Error(msg);
  }
  return data;
}

export const api = {
  login: (email, password) => apiFetch('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => apiFetch('/auth/me'),
  logout: () => apiFetch('/auth/logout', { method: 'POST' }),

  listModules: () => apiFetch('/modules'),
  getModule: (slug) => apiFetch(`/modules/${slug}`),

  runJob: (moduleSlug, params, file) => {
    const fd = new FormData();
    fd.append('moduleSlug', moduleSlug);
    if (params) fd.append('params', JSON.stringify(params));
    if (file) fd.append('inputFile', file);
    return apiFetch('/jobs/run', { method: 'POST', formData: fd });
  },
  listJobs: () => apiFetch('/jobs'),
  getJob: (id) => apiFetch(`/jobs/${id}`),
  cancelJob: (id) => apiFetch(`/jobs/${id}/cancel`, { method: 'POST' }),

  downloadFileUrl: (id) => `${API_BASE}/files/${id}/download`,

  listUsers: () => apiFetch('/users'),
  createUser: (data) => apiFetch('/users', { method: 'POST', body: data }),
  updateUser: (id, data) => apiFetch(`/users/${id}`, { method: 'PUT', body: data }),
  deactivateUser: (id) => apiFetch(`/users/${id}`, { method: 'DELETE' }),

  listSchedules: () => apiFetch('/schedules'),
  createSchedule: (data) => apiFetch('/schedules', { method: 'POST', body: data }),

  listAudit: () => apiFetch('/audit'),
};
