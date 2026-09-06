import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Upload, Play, Terminal, Download, ArrowLeft, Loader2, CheckCircle2, XCircle, Clock, FileSpreadsheet, FileText, Sparkles, Check,
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
  const [localAgentStatus, setLocalAgentStatus] = useState(null); // { ok: bool, vbs: bool, python: bool }
  const [execTarget, setExecTarget] = useState('LOCAL'); // 'LOCAL' | 'CENTRAL'
  const [outputViewMode, setOutputViewMode] = useState('HUMAN'); // 'HUMAN' | 'TECH'
  const [localOutputFiles, setLocalOutputFiles] = useState([]);
  const logRef = useRef(null);
  const humanFeedRef = useRef(null);
  const unsubRef = useRef(null);

  // Check if local desktop agent is running on this laptop
  useEffect(() => {
    let active = true;
    const checkAgent = async () => {
      const res = await api.checkLocalAgent();
      if (active) setLocalAgentStatus(res);
    };
    checkAgent();
    const interval = setInterval(checkAgent, 6000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

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
    if (humanFeedRef.current) humanFeedRef.current.scrollTop = humanFeedRef.current.scrollHeight;
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
    setLocalOutputFiles([]);
    setRunning(true);

    const isWindowsVbs = mod?.executionType === 'WINDOWS_VBS';

    // ── Mode 1: Execute on Local Desktop SAP GUI (Approach 1) ──
    if (isWindowsVbs && execTarget === 'LOCAL') {
      if (!localAgentStatus?.ok) {
        toast.error('Local SAP Agent is not reachable on localhost:9000. Please start it on this laptop first.');
        setRunning(false);
        return;
      }

      setJobData({ status: 'RUNNING' });
      const startedAt = new Date().toISOString();

      const runLogs = [];
      try {
        await api.executeLocalAgent(
          'http://localhost:9000',
          slug,
          paramValues,
          file,
          {
            onLog: (l) => {
              runLogs.push(l);
              setLogs((prev) => [...prev, l]);
            },
            onProgress: (p) => setProgress(p),
            onComplete: async ({ runId, outputFiles }) => {
              setRunning(false);
              setJobData({ status: 'COMPLETED' });
              toast.success('SAP Update completed on your local machine!');

              // Map output files to download links from local agent
              const mappedFiles = (outputFiles || []).map((f) => ({
                name: f.name,
                url: `http://localhost:9000/runs/${runId}/files/${f.name}`,
                size: f.size,
              }));
              setLocalOutputFiles(mappedFiles);

              // Sync run with central server database for job history & audit
              try {
                // Fetch the run report file blob to upload for central archive
                let reportBlob = null;
                const reportFileObj = outputFiles?.find((f) => f.name.includes('RUN_REPORT') || f.name.endsWith('.xlsx'));
                if (reportFileObj) {
                  const res = await fetch(`http://localhost:9000/runs/${runId}/files/${reportFileObj.name}`);
                  if (res.ok) reportBlob = new File([await res.blob()], reportFileObj.name);
                }

                await api.recordLocalRun({
                  moduleSlug: slug,
                  status: 'COMPLETED',
                  params: paramValues,
                  logs: runLogs,
                  startedAt,
                  finishedAt: new Date().toISOString(),
                  inputFile: file,
                  outputFile: reportBlob,
                });
              } catch (syncErr) {
                console.warn('Central sync error:', syncErr);
              }
            },
            onError: async (err, info) => {
              setRunning(false);
              setJobData({ status: 'FAILED', errorMessage: err.message });
              toast.error(err.message || 'Execution stopped');

              const files = info?.outputFiles || err?.outputFiles;
              const rId = info?.runId || err?.runId;
              if (files?.length && rId) {
                const mappedFiles = files.map((f) => ({
                  name: f.name,
                  url: `http://localhost:9000/runs/${rId}/files/${f.name}`,
                  size: f.size,
                }));
                setLocalOutputFiles(mappedFiles);
              }

              try {
                await api.recordLocalRun({
                  moduleSlug: slug,
                  status: 'FAILED',
                  params: paramValues,
                  logs: runLogs,
                  startedAt,
                  finishedAt: new Date().toISOString(),
                  errorMessage: err.message,
                  inputFile: file,
                });
              } catch {}
            },
          }
        );
      } catch (err) {
        setRunning(false);
        setJobData({ status: 'FAILED', errorMessage: err.message });
      }
      return;
    }

    // ── Mode 2: Central Queue Worker ──
    try {
      const res = await api.runJob(slug, paramValues, file);
      setJobId(res.jobId);
      setJobData({ id: res.jobId, status: 'QUEUED' });
      toast.loading('Job queued on central server…', { id: `job-${res.jobId}` });
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

          {/* Local Desktop vs Central Worker selector for Windows VBS modules */}
          {mod.executionType === 'WINDOWS_VBS' && (
            <div className="p-3 bg-slate-900 border border-slate-700 rounded-lg space-y-2">
              <label className="label mb-1">Execution Target</label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setExecTarget('LOCAL')}
                  className={clsx(
                    'p-2 rounded-lg border text-center font-medium transition',
                    execTarget === 'LOCAL'
                      ? 'border-brand-500 bg-brand-500/10 text-brand-300'
                      : 'border-slate-800 bg-slate-800/40 text-slate-400 hover:border-slate-700'
                  )}
                >
                  🖥️ My Laptop's SAP
                </button>
                <button
                  type="button"
                  onClick={() => setExecTarget('CENTRAL')}
                  className={clsx(
                    'p-2 rounded-lg border text-center font-medium transition',
                    execTarget === 'CENTRAL'
                      ? 'border-brand-500 bg-brand-500/10 text-brand-300'
                      : 'border-slate-800 bg-slate-800/40 text-slate-400 hover:border-slate-700'
                  )}
                >
                  ☁️ Central Worker
                </button>
              </div>

              {execTarget === 'LOCAL' && (
                <div className="mt-2 text-xs">
                  {localAgentStatus?.ok ? (
                    <div className="flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 p-2 rounded border border-emerald-500/20">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Local SAP Agent Online (localhost:9000)</span>
                    </div>
                  ) : (
                    <div className="text-amber-400 bg-amber-500/10 p-2 rounded border border-amber-500/20 space-y-1">
                      <div className="flex items-center gap-1.5 font-medium">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        <span>Local Agent Offline</span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Launch <code className="text-amber-300">start-agent.bat</code> on this laptop to automate your open SAP GUI.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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

        {/* Output & Process Monitoring Panel */}
        <div className="card lg:col-span-2 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white flex items-center gap-2">
                {outputViewMode === 'HUMAN' ? (
                  <Sparkles className="w-5 h-5 text-brand-400" />
                ) : (
                  <Terminal className="w-5 h-5 text-brand-400" />
                )}
                <span>Live Activity</span>
              </h3>
              {running && (
                <span className="flex items-center gap-1.5 text-xs text-brand-400 bg-brand-500/10 border border-brand-500/20 px-2 py-0.5 rounded-full animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
                  In Progress
                </span>
              )}
            </div>

            {/* View Mode Toggle: Human vs Developer */}
            <div className="flex items-center gap-2">
              <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setOutputViewMode('HUMAN')}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition',
                    outputViewMode === 'HUMAN'
                      ? 'bg-brand-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  )}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Human View</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOutputViewMode('TECH')}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition',
                    outputViewMode === 'TECH'
                      ? 'bg-slate-800 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  )}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Developer Logs</span>
                </button>
              </div>

              {outputFile?.id && (
                <a
                  href={api.downloadFileUrl(outputFile.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary text-xs py-1 px-3"
                >
                  <Download className="w-3.5 h-3.5" /> Download Report
                </a>
              )}
            </div>
          </div>

          {/* 5-Step Visual Process Stepper for SAP Daily Tracker */}
          {mod?.executionType === 'WINDOWS_VBS' && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 sm:p-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  { id: 1, name: '1. SAP Screen', desc: 'Read active window' },
                  { id: 2, name: '2. Match Rows', desc: 'Cross-check data' },
                  { id: 3, name: '3. Validation', desc: 'Verify rules & PERNR' },
                  { id: 4, name: '4. Update SAP', desc: 'Write transactions' },
                  { id: 5, name: '5. Run Report', desc: 'Generate Excel' },
                ].map((step) => {
                  const activeStage = getActiveStage(logs, running, jobData);
                  const isDone = activeStage > step.id || jobData?.status === 'COMPLETED';
                  const isCurrent = activeStage === step.id && running;
                  const isFailed = jobData?.status === 'FAILED' && activeStage === step.id;

                  return (
                    <div
                      key={step.id}
                      className={clsx(
                        'p-2.5 rounded-lg border text-left transition',
                        isDone && 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
                        isCurrent && 'bg-brand-500/15 border-brand-500/40 text-brand-300 ring-1 ring-brand-500/30 animate-pulse',
                        isFailed && 'bg-red-500/15 border-red-500/40 text-red-300',
                        !isDone && !isCurrent && !isFailed && 'bg-slate-800/30 border-slate-800 text-slate-500'
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-xs">{step.name}</span>
                        {isDone && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                        {isCurrent && <Loader2 className="w-3.5 h-3.5 text-brand-400 animate-spin" />}
                        {isFailed && <XCircle className="w-3.5 h-3.5 text-red-400" />}
                      </div>
                      <p className="text-[10px] text-slate-400 line-clamp-1">{step.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* HUMAN VIEW: Clear Business-Friendly Activity Feed */}
          {outputViewMode === 'HUMAN' && (
            <div
              ref={humanFeedRef}
              className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 h-96 overflow-y-auto space-y-2.5"
            >
              {logs.length === 0 && !running && (
                <div className="flex flex-col items-center justify-center h-full text-center p-6 text-slate-500">
                  <Sparkles className="w-10 h-10 mb-2 text-slate-600 opacity-60" />
                  <p className="font-medium text-slate-400">Ready to automate</p>
                  <p className="text-xs max-w-sm mt-1">
                    Upload your Excel sheet and click <strong>"Run Automation"</strong>. You will see friendly step-by-step progress and status messages here.
                  </p>
                </div>
              )}

              {logs.map((l, i) => {
                const humanMsg = parseHumanMessage(l);
                if (!humanMsg) return null; // Suppress raw technical noise in human view

                const isSuccess = humanMsg.type === 'success';
                const isError = humanMsg.type === 'error';
                const isWarn = humanMsg.type === 'warn';
                const isActive = humanMsg.type === 'active';

                return (
                  <div
                    key={i}
                    className={clsx(
                      'flex items-start gap-3 p-3 rounded-xl border text-sm transition',
                      isSuccess && 'bg-emerald-500/10 border-emerald-500/25 text-slate-200',
                      isError && 'bg-red-500/10 border-red-500/30 text-red-200',
                      isWarn && 'bg-amber-500/10 border-amber-500/25 text-amber-200',
                      isActive && 'bg-brand-500/10 border-brand-500/25 text-slate-200',
                      !isSuccess && !isError && !isWarn && !isActive && 'bg-slate-900/60 border-slate-800/70 text-slate-300'
                    )}
                  >
                    <span className="text-xl shrink-0 select-none">{humanMsg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-white text-xs sm:text-sm">{humanMsg.title}</span>
                        {humanMsg.badge && (
                          <span
                            className={clsx(
                              'text-[10px] px-2 py-0.5 rounded-full font-medium',
                              isSuccess && 'bg-emerald-500/20 text-emerald-300',
                              isError && 'bg-red-500/20 text-red-300',
                              isWarn && 'bg-amber-500/20 text-amber-300',
                              isActive && 'bg-brand-500/20 text-brand-300',
                              !isSuccess && !isError && !isWarn && !isActive && 'bg-slate-800 text-slate-400'
                            )}
                          >
                            {humanMsg.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{humanMsg.desc}</p>
                    </div>
                  </div>
                );
              })}

              {running && (
                <div className="flex items-center gap-2 p-3 bg-brand-500/5 border border-brand-500/20 rounded-xl text-xs text-brand-300 animate-pulse">
                  <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
                  <span>Automating SAP... please keep your SAP window open.</span>
                </div>
              )}
            </div>
          )}

          {/* DEVELOPER VIEW: Raw Console Output */}
          {outputViewMode === 'TECH' && (
            <div
              ref={logRef}
              className="bg-black/80 border border-slate-800 rounded-xl p-4 h-96 overflow-y-auto font-mono text-xs leading-relaxed"
            >
              {logs.length === 0 && !running && (
                <p className="text-slate-600">Console output will stream here in real time.</p>
              )}
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={clsx(
                    'whitespace-pre-wrap break-all py-0.5',
                    l.level === 'error' && 'text-red-400 font-semibold',
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
          )}

          {/* Error Message Box */}
          {jobData?.errorMessage && (
            <div className="p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm flex items-start gap-2.5">
              <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold text-red-200">Execution Error:</strong>
                <p className="text-xs text-red-300 mt-0.5">{jobData.errorMessage}</p>
              </div>
            </div>
          )}

          {/* Local Run Finished: Prominent Report Download Card */}
          {localOutputFiles.length > 0 && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span className="font-semibold text-white text-sm">Automation Finished — Download Output Reports</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {localOutputFiles.map((f) => (
                  <a
                    key={f.name}
                    href={f.url}
                    download={f.name}
                    className="flex items-center gap-2.5 text-sm bg-slate-900/80 hover:bg-slate-800 text-brand-300 hover:text-white rounded-lg px-3.5 py-2.5 border border-slate-700/60 hover:border-brand-500/60 transition shadow-sm"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="font-medium text-xs sm:text-sm truncate">{f.name}</span>
                    <span className="ml-auto text-[11px] text-slate-400 shrink-0">{f.size ? (f.size / 1024).toFixed(1) + ' KB' : ''}</span>
                    <Download className="w-4 h-4 text-brand-400 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Central Server Output Files */}
          {jobData?.id && outputFile && (
            <div className="pt-2 border-t border-slate-800">
              <p className="text-xs font-semibold text-slate-300 mb-2">Central Server Output Files</p>
              <OutputFileList jobId={jobData.id} primaryFileId={outputFile.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers for Human-Friendly Pipeline Monitoring ──

function getActiveStage(logs, running, jobData) {
  if (!logs || logs.length === 0) return 1;
  let stage = 1;
  for (const l of logs) {
    const text = l.line || '';
    if (text.includes('Step 0B') || text.includes('Reconciling SAP rows')) stage = 2;
    if (text.includes('Step 1') || text.includes('Validating workbook')) stage = 3;
    if (text.includes('Step 2') || text.includes('SAP UPDATE') || text.includes('DRY RUN')) stage = 4;
    if (text.includes('Step 3') || text.includes('Applying status codes') || text.includes('convert-reports')) stage = 5;
    if (text.includes('Pipeline complete') || text.includes('Status merged into workbook')) stage = 6;
  }
  if (jobData?.status === 'COMPLETED') return 6;
  return stage;
}

function parseHumanMessage(l) {
  const line = l.line || '';
  const level = l.level || 'info';

  if (line.includes('Pipeline starting')) {
    return { icon: '🚀', title: 'Starting Automation', desc: 'Preparing SAP execution environment on your desktop...', badge: 'Started', type: 'info' };
  }
  if (line.includes('Step 0:') || line.includes('Exporting SAP grid snapshot')) {
    return { icon: '📸', title: 'Connecting to SAP Window', desc: 'Reading current screen data from your open SAP GUI session.', badge: 'Step 1/5', type: 'active' };
  }
  if (line.includes('[PASS] SAP snapshot captured')) {
    return { icon: '✅', title: 'SAP Screen Data Read', desc: 'Successfully extracted current records from the SAP table.', badge: 'Snapshot OK', type: 'success' };
  }
  if (line.includes('Step 0B:') || line.includes('Reconciling SAP rows')) {
    return { icon: '🔍', title: 'Reconciling Data', desc: 'Comparing your uploaded spreadsheet with current SAP records.', badge: 'Step 2/5', type: 'active' };
  }
  if (line.includes('[PASS] Reconciliation complete')) {
    return { icon: '✅', title: 'Data Reconciled', desc: 'All rows aligned and verified against SAP data.', badge: 'Reconciled', type: 'success' };
  }
  if (line.includes('Step 1:') || line.includes('Validating workbook')) {
    return { icon: '🛡️', title: 'Validating Spreadsheet Rules', desc: 'Checking Employee ID (PERNR), required columns, and data formats.', badge: 'Step 3/5', type: 'active' };
  }
  if (line.includes('[PASS] Validation passed')) {
    return { icon: '✅', title: 'Validation Passed', desc: 'All employee ID and business validation checks passed.', badge: 'Valid', type: 'success' };
  }
  if (line.includes('Step 2: LIVE SAP UPDATE')) {
    return { icon: '⚡', title: 'Updating SAP Records Live', desc: 'Writing changes directly into the SAP transaction screen in real time.', badge: 'Step 4/5', type: 'active' };
  }
  if (line.includes('Step 2: DRY RUN')) {
    return { icon: '🧪', title: 'Simulating SAP Updates', desc: 'Running test simulation without making permanent changes to SAP.', badge: 'Dry Run', type: 'active' };
  }
  if (line.includes('[PASS] VBS processing complete')) {
    return { icon: '✅', title: 'SAP Updates Finished', desc: 'All transactions executed successfully in the SAP window.', badge: 'SAP Updated', type: 'success' };
  }
  if (line.includes('Step 3:') || line.includes('Applying status codes') || line.includes('convert-reports')) {
    return { icon: '📊', title: 'Generating Final Report', desc: 'Applying color-coded status codes and compiling the Excel summary.', badge: 'Step 5/5', type: 'active' };
  }
  if (line.includes('[PASS] Status merged') || line.includes('Pipeline complete')) {
    return { icon: '🎉', title: 'Automation Complete!', desc: 'Your updated Excel workbook with run reports is ready to download below.', badge: 'Finished', type: 'success' };
  }
  if (level === 'error' || line.includes('[ERROR]') || line.includes('[FATAL]') || line.includes('Error #:')) {
    let clean = line.replace(/\[ERROR\]|\[FATAL\]|\[FAIL\]/g, '').trim();
    if (clean.includes('Type mismatch')) clean = 'Data type mismatch detected in input file.';
    return { icon: '❌', title: 'Process Alert', desc: clean, badge: 'Error', type: 'error' };
  }
  if (level === 'warn' || line.includes('[WARN]')) {
    return { icon: '⚠️', title: 'Notice', desc: line.replace(/\[WARN\]/g, '').trim(), badge: 'Notice', type: 'warn' };
  }
  if (line.includes('Processed') || line.includes('Row') || line.includes('Count')) {
    return { icon: '📋', title: 'Progress Update', desc: line, badge: 'Info', type: 'info' };
  }
  return null;
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
