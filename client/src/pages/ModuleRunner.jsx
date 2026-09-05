import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Upload, Play, Terminal, Download, ArrowLeft, Loader2, CheckCircle2, XCircle, Clock, FileSpreadsheet, FileText,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { getModuleConfig } from '../lib/moduleConfig';

export default function ModuleRunner() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { data: mod, isLoading } = useQuery({ queryKey: ['module', slug], queryFn: () => api.getModule(slug) });
  const cfg = getModuleConfig(slug);

  const [file, setFile] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobData, setJobData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(null);
  const logRef = useRef(null);
  const unsubRef = useRef(null);

  // Initialize param defaults from config
  useEffect(() => {
    const defaults = {};
    (cfg.params || []).forEach((p) => {
      if (p.defaultValue !== undefined) defaults[p.name] = p.defaultValue;
    });
    setParamValues(defaults);
  }, [slug, cfg]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => () => { if (unsubRef.current) unsubRef.current(); }, []);

  const subscribeToJob = (jid) => {
    const sock = getSocket();
    if (!sock.connected) sock.connect();
    sock.emit('subscribe:job', jid);

    const onLog = (p) => { if (p.jobId === jid) setLogs((prev) => [...prev, p]); };
    const onStatus = (p) => {
      if (p.jobId !== jid) return;
      setJobData((prev) => ({ ...prev, status: p.status }));
      if (p.status === 'COMPLETED') {
        setRunning(false);
        toast.success('Job completed successfully!');
        api.getJob(jid).then(setJobData);
      }
      if (p.status === 'FAILED') {
        setRunning(false);
        toast.error('Job failed — see console output');
        api.getJob(jid).then(setJobData);
      }
    };
    const onProgress = (p) => {
      if (p.jobId === jid) setProgress(p);
    };

    sock.on('log', onLog);
    sock.on('status', onStatus);
    sock.on('progress', onProgress);

    unsubRef.current = () => {
      sock.off('log', onLog);
      sock.off('status', onStatus);
      sock.off('progress', onProgress);
      sock.emit('unsubscribe:job', jid);
    };
  };

  const validate = () => {
    for (const p of cfg.params || []) {
      if (!p.required) continue;
      const v = paramValues[p.name];
      if (!v || String(v).trim() === '') {
        toast.error(`${p.label} is required`);
        return false;
      }
      if (p.pattern && !new RegExp(p.pattern).test(String(v).trim())) {
        toast.error(p.patternError || `${p.label} is invalid`);
        return false;
      }
    }
    if (cfg.requiresFile && !file) {
      toast.error(`Please upload ${cfg.fileLabel || 'an input file'}`);
      return false;
    }
    return true;
  };

  const run = async () => {
    if (!validate()) return;
    setLogs([]);
    setJobData(null);
    setProgress(null);
    setRunning(true);
    try {
      const res = await api.runJob(slug, paramValues, file);
      setJobId(res.jobId);
      setJobData({ id: res.jobId, status: 'QUEUED' });
      toast.loading('Job queued…', { id: `job-${res.jobId}` });
      subscribeToJob(res.jobId);
    } catch (err) {
      toast.error(err.message);
      setRunning(false);
    }
  };

  const cancel = async () => {
    if (!jobId) return;
    try {
      await api.cancelJob(jobId);
      toast('Job cancelled', { icon: '⚠️' });
      setRunning(false);
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (isLoading) return <div className="text-slate-400">Loading…</div>;
  if (!mod) return <div className="text-red-400">Module not found</div>;

  const statusBadge = {
    QUEUED: { icon: Clock, cls: 'bg-slate-700 text-slate-300' },
    RUNNING: { icon: Loader2, cls: 'bg-blue-500/20 text-blue-300 animate-pulse' },
    COMPLETED: { icon: CheckCircle2, cls: 'bg-emerald-500/20 text-emerald-300' },
    FAILED: { icon: XCircle, cls: 'bg-red-500/20 text-red-300' },
    CANCELLED: { icon: XCircle, cls: 'bg-slate-700 text-slate-400' },
  };
  const StatusIcon = (jobData?.status && statusBadge[jobData.status]?.icon) || Clock;

  const outputFile = jobData?.outputFile;

  return (
    <div className="space-y-6">
      <button onClick={() => navigate('/modules')} className="flex items-center gap-2 text-slate-400 hover:text-white text-sm">
        <ArrowLeft className="w-4 h-4" /> Back to modules
      </button>

      <div className="flex items-start gap-4">
        <span className="text-5xl">{mod.icon || '⚙️'}</span>
        <div>
          <h1 className="text-2xl font-bold text-white">{mod.name}</h1>
          <p className="text-slate-400 mt-1">{mod.description}</p>
          <span className="badge bg-slate-800 text-slate-400 mt-2">{mod.executionType.replace('_', ' ')}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Config panel */}
        <div className="card lg:col-span-1 space-y-4">
          <h3 className="font-semibold text-white">Configuration</h3>

          {/* Dynamic param fields */}
          {(cfg.params || []).map((p) => (
            <div key={p.name}>
              <label className="label">
                {p.label}
                {p.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              {p.type === 'select' && (
                <select
                  className="input"
                  value={paramValues[p.name] || ''}
                  onChange={(e) => setParamValues({ ...paramValues, [p.name]: e.target.value })}
                  disabled={running}
                >
                  {p.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}
              {p.type === 'textarea' && (
                <textarea
                  className="input font-mono text-sm h-28 resize-y"
                  value={paramValues[p.name] || ''}
                  onChange={(e) => setParamValues({ ...paramValues, [p.name]: e.target.value })}
                  placeholder={p.placeholder}
                  disabled={running}
                />
              )}
              {(p.type === 'text' || p.type === 'number' || !p.type) && (
                <input
                  type={p.type || 'text'}
                  className="input font-mono"
                  value={paramValues[p.name] || ''}
                  onChange={(e) => setParamValues({ ...paramValues, [p.name]: e.target.value })}
                  placeholder={p.placeholder}
                  disabled={running}
                  pattern={p.pattern}
                />
              )}
              {p.help && <p className="text-xs text-slate-500 mt-1">{p.help}</p>}
            </div>
          ))}

          {/* File upload (if module requires file) */}
          {cfg.requiresFile && (
            <div>
              <label className="label">{cfg.fileLabel || 'Input File'}</label>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 rounded-lg p-5 cursor-pointer hover:border-brand-500 transition">
                <Upload className="w-8 h-8 text-slate-500 mb-2" />
                <span className="text-sm text-slate-400 text-center">
                  {file ? (
                    <span className="flex items-center gap-1 text-brand-400">
                      <FileSpreadsheet className="w-4 h-4" /> {file.name}
                    </span>
                  ) : (
                    <>Click to upload<br /><span className="text-xs text-slate-500">{cfg.fileAccept}</span></>
                  )}
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept={cfg.fileAccept}
                  onChange={(e) => setFile(e.target.files[0])}
                  disabled={running}
                />
              </label>
              {cfg.fileHelp && <p className="text-xs text-slate-500 mt-2">{cfg.fileHelp}</p>}
            </div>
          )}

          <button onClick={run} disabled={running} className="btn-primary w-full justify-center">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {running ? 'Running…' : 'Run Automation'}
          </button>

          {running && (
            <button onClick={cancel} className="btn-secondary w-full justify-center text-sm">
              Cancel
            </button>
          )}

          {jobData?.status && (
            <div className={clsx('badge w-full justify-center py-1.5', statusBadge[jobData.status]?.cls)}>
              <StatusIcon className={clsx('w-4 h-4 mr-1', jobData.status === 'RUNNING' && 'animate-spin')} />
              {jobData.status}
            </div>
          )}

          {progress && (
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>{progress.message || 'Working...'}</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="bg-brand-500 h-2 rounded-full transition-all" style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Console / output panel */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Terminal className="w-5 h-5 text-brand-400" /> Live Output
            </h3>
            {outputFile?.id && (
              <a
                href={api.downloadFileUrl(outputFile.id)}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary text-sm py-1.5"
              >
                <Download className="w-4 h-4" /> Download Result
              </a>
            )}
          </div>

          <div
            ref={logRef}
            className="bg-black/50 border border-slate-800 rounded-lg p-4 h-96 overflow-y-auto font-mono text-sm"
          >
            {logs.length === 0 && !running && (
              <p className="text-slate-600">
                {jobId ? 'Waiting for logs…' : 'Configure parameters and click "Run Automation" to start. Console output will stream here in real time.'}
              </p>
            )}
            {logs.map((l, i) => (
              <div
                key={i}
                className={clsx(
                  'whitespace-pre-wrap break-all',
                  l.level === 'error' && 'text-red-400',
                  l.level === 'warn' && 'text-amber-400',
                  (!l.level || l.level === 'info') && 'text-slate-300',
                  l.level === 'debug' && 'text-slate-500'
                )}
              >
                {l.line}
              </div>
            ))}
            {running && (
              <span className="inline-block w-2 h-4 bg-brand-400 animate-pulse ml-0.5" />
            )}
          </div>

          {jobData?.errorMessage && (
            <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm">
              <strong>Error:</strong> {jobData.errorMessage}
            </div>
          )}

          {/* List all output files when available */}
          {jobData?.id && outputFile && (
            <div className="mt-4 pt-4 border-t border-slate-800">
              <p className="text-sm font-medium text-slate-300 mb-2">Output Files</p>
              <OutputFileList jobId={jobData.id} primaryFileId={outputFile.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper component to fetch job and list all StoredFiles attached to it
function OutputFileList({ jobId }) {
  const { data: job } = useQuery({
    queryKey: ['job-files', jobId],
    queryFn: () => api.getJob(jobId),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.status === 'COMPLETED' || q.state.data?.status === 'FAILED' ? false : 3000),
  });

  const files = [];
  if (job?.outputFile) files.push({ ...job.outputFile, label: 'Primary Output' });
  if (job?.inputFile) files.push({ ...job.inputFile, label: 'Input (uploaded)' });

  return (
    <div className="space-y-1">
      {files.map((f) => (
        <a
          key={f.id}
          href={api.downloadFileUrl(f.id)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 bg-slate-800/50 rounded-lg px-3 py-2"
        >
          <FileText className="w-4 h-4" />
          {f.originalName}
          <span className="ml-auto text-xs text-slate-500">{(f.sizeBytes / 1024).toFixed(1)} KB</span>
          <Download className="w-4 h-4" />
        </a>
      ))}
    </div>
  );
}
