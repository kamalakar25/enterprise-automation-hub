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

  // ── Local Desktop Agent Helpers (Approach 1) ──
  checkLocalAgent: async (agentUrl = 'http://localhost:9000') => {
    try {
      const res = await fetch(`${agentUrl}/health`, {
        headers: { Authorization: 'Bearer shared-secret-change-me' },
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return { ok: false };
      return await res.json();
    } catch {
      return { ok: false };
    }
  },

  executeLocalAgent: async (agentUrl = 'http://localhost:9000', moduleSlug, params, file, { onLog, onProgress, onComplete, onError }) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null) fd.append(k, String(v));
    }
    if (file) fd.append('inputFile', file);

    const controller = new AbortController();
    try {
      const res = await fetch(`${agentUrl}/execute/${moduleSlug}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer shared-secret-change-me' },
        body: fd,
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new Error(`Local agent returned status ${res.status}: ${text}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let runId = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep last incomplete chunk

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.runId) runId = evt.runId;
            if (evt.event === 'log') {
              onLog?.({ level: evt.level || 'info', line: evt.line });
            } else if (evt.event === 'progress') {
              onProgress?.(evt);
            } else if (evt.event === 'complete') {
              onComplete?.({ runId, outputFiles: evt.outputFiles });
            } else if (evt.event === 'failed') {
              const err = new Error(evt.error || 'Execution failed');
              err.runId = runId;
              err.outputFiles = evt.outputFiles;
              onError?.(err, { runId, outputFiles: evt.outputFiles });
            }
          } catch {
            onLog?.({ level: 'info', line });
          }
        }
      }
      return { runId };
    } catch (err) {
      onError?.(err);
      throw err;
    }
  },

  recordLocalRun: async ({ moduleSlug, status, params, logs, startedAt, finishedAt, errorMessage, inputFile, outputFile }) => {
    const fd = new FormData();
    fd.append('moduleSlug', moduleSlug);
    fd.append('status', status);
    if (params) fd.append('params', JSON.stringify(params));
    if (logs) fd.append('logs', JSON.stringify(logs));
    if (startedAt) fd.append('startedAt', startedAt);
    if (finishedAt) fd.append('finishedAt', finishedAt);
    if (errorMessage) fd.append('errorMessage', errorMessage);
    if (inputFile) fd.append('inputFile', inputFile);
    if (outputFile) fd.append('outputFile', outputFile);
    return apiFetch('/jobs/record-local-run', { method: 'POST', formData: fd });
  },

  downloadFileUrl: (id) => {
    const token = getToken();
    return `${API_BASE}/files/${id}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },

  listUsers: () => apiFetch('/users'),
  createUser: (data) => apiFetch('/users', { method: 'POST', body: data }),
  updateUser: (id, data) => apiFetch(`/users/${id}`, { method: 'PUT', body: data }),
  deactivateUser: (id) => apiFetch(`/users/${id}`, { method: 'DELETE' }),

  listSchedules: () => apiFetch('/schedules'),
  createSchedule: (data) => apiFetch('/schedules', { method: 'POST', body: data }),

  listAudit: () => apiFetch('/audit'),
};
