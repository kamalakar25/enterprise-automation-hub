import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import prisma from '../config/db.js';
import { bus } from '../queue/socketBus.js';
import logger from '../config/logger.js';

const WORKER_SCRIPTS_DIR = path.resolve('src/workers/scripts');
fs.mkdirSync(WORKER_SCRIPTS_DIR, { recursive: true });

/**
 * Emit a log line to both Winston and socket.io channel.
 */
function log(job, line, level = 'info') {
  const safe = String(line ?? '').replace(/\s+$/g, '');
  if (!safe) return;
  const dbJobId = job.data?.jobId || job.id;
  const msg = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${safe}`;
  bus.emit('log', { jobId: dbJobId, line: msg, level });
  logger.info(safe, { jobId: dbJobId });
}

async function setStatus(jobId, status, extra = {}) {
  await prisma.jobRun.update({
    where: { id: jobId },
    data: {
      status,
      ...(status === 'RUNNING' ? { startedAt: new Date() } : {}),
      ...(status === 'COMPLETED' || status === 'FAILED' ? { finishedAt: new Date() } : {}),
      ...extra,
    },
  });
  bus.emit('status', { jobId, status, ...extra });
}

/**
 * Register a file on disk as a StoredFile and attach it to the job as output.
 */
async function registerOutputFile(job, filePath, originalName) {
  if (!fs.existsSync(filePath)) return null;
  const dbJobId = job.data?.jobId || job.id;
  const stat = fs.statSync(filePath);
  const stored = await prisma.storedFile.create({
    data: {
      originalName: originalName || path.basename(filePath),
      storedPath: filePath,
      mimeType: guessMime(filePath),
      sizeBytes: stat.size,
      uploadedById: job.data.triggeredBy || null,
    },
  });
  await prisma.jobRun.update({
    where: { id: dbJobId },
    data: { outputFileId: stored.id },
  });
  return stored;
}

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
  }[ext] || 'application/octet-stream';
}

/**
 * Progress emitter 0-100
 */
function progress(job, pct, message) {
  const dbJobId = job.data?.jobId || job.id;
  bus.emit('progress', { jobId: dbJobId, percent: pct, message });
}

/**
 * Main dispatcher.
 */
export async function processJob(job) {
  let dbJobId = job.data?.jobId;
  if (!dbJobId) {
    const newRun = await prisma.jobRun.create({
      data: {
        moduleId: job.data.moduleId,
        triggeredById: job.data.triggeredBy || null,
        params: job.data.params || {},
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });
    dbJobId = newRun.id;
    job.data.jobId = dbJobId;
  }

  const { moduleSlug, executionType, params = {}, inputFile } = job.data;
  log(job, `Starting module: ${moduleSlug} (${executionType})`);
  await setStatus(dbJobId, 'RUNNING');
  progress(job, 5, 'Initializing...');

  try {
    let result;
    switch (executionType) {
      case 'PYTHON_HEADLESS':
        result = await runPythonWorker(job, moduleSlug, params, inputFile);
        break;

      case 'WINDOWS_VBS':
        result = await runWindowsWorker(job, moduleSlug, params, inputFile);
        break;

      default:
        throw new Error(`Unknown execution type: ${executionType}`);
    }

    // Register main output file if the worker produced one
    if (result?.outputFile) {
      await registerOutputFile(job, result.outputFile.path, result.outputFile.name);
    }
    if (result?.extraFiles?.length) {
      for (const ef of result.extraFiles) {
        await registerOutputFile(job, ef.path, ef.name);
      }
    }

    await setStatus(dbJobId, 'COMPLETED', {
      params: { ...params, __result: result?.summary || 'ok' },
    });
    progress(job, 100, 'Complete');
    log(job, `Module ${moduleSlug} completed successfully.`, 'info');
    return result;
  } catch (err) {
    log(job, `Module ${moduleSlug} FAILED: ${err.message}`, 'error');
    await setStatus(dbJobId, 'FAILED', { errorMessage: err.message });
    throw err;
  }
}

/* ──────────────────────────────────────────
 *  Python Headless Worker Runner
 * ────────────────────────────────────────── */
async function runPythonWorker(job, slug, params, inputFile) {
  const scriptPath = path.join(WORKER_SCRIPTS_DIR, 'python', `${slug}.py`);
  // Map route slugs to actual python script filenames
  const slugMap = {
    'me2m-analyzer': 'me2m_analyzer.py',
    'vendor-email': 'vendor_email.py',
  };
  const resolvedScript = path.join(WORKER_SCRIPTS_DIR, 'python', slugMap[slug] || `${slug}.py`);
  if (!fs.existsSync(resolvedScript)) {
    throw new Error(`Python worker script not found: ${resolvedScript}`);
  }

  const reportsDir = path.resolve(process.env.REPORTS_DIR || './storage/reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const pythonCmd = process.env.PYTHON_EXE || (process.platform === 'win32' ? 'python' : 'python3');

  return new Promise((resolve, reject) => {
    const args = [resolvedScript, '--params', JSON.stringify({ ...params, reportsDir })];
    if (inputFile) args.push('--input', inputFile.storedPath);

    log(job, `Spawning ${pythonCmd} ${args.join(' ')}`);
    const proc = spawn(pythonCmd, args, { cwd: WORKER_SCRIPTS_DIR, env: { ...process.env, REPORTS_DIR: reportsDir } });

    let stdout = '';
    let stderr = '';
    let reportedOutput = null;

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      text.split('\n').filter(Boolean).forEach((l) => {
        log(job, l, 'info');
        // Detect JSON result line
        const m = l.trim().match(/^\{.*"status"\s*:\s*"ok".*\}$/);
        if (m) {
          try {
            const parsed = JSON.parse(m[0]);
            if (parsed.output) reportedOutput = { path: parsed.output, name: path.basename(parsed.output) };
          } catch {}
        }
      });
    });
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      text.split('\n').filter(Boolean).forEach((l) => log(job, l, 'warn'));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          summary: stdout.slice(-500),
          exitCode: code,
          outputFile: reportedOutput,
        });
      } else {
        reject(new Error(`Python exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });
    proc.on('error', reject);
  });
}

/* ──────────────────────────────────────────
 *  Windows VBS Worker Runner (streaming NDJSON)
 * ────────────────────────────────────────── */
async function runWindowsWorker(job, slug, params, inputFile) {
  const workerUrl = process.env.WINDOWS_WORKER_URL;
  const workerToken = process.env.WINDOWS_WORKER_TOKEN;
  if (!workerUrl) throw new Error('WINDOWS_WORKER_URL not configured in .env');

  // Map our module slugs to the Windows agent endpoint + method
  const endpointMap = {
    'sap-daily-tracker': {
      path: '/execute/sap-daily-tracker',
      method: 'multipart',
      requiredParams: ['pernr', 'cummode'],
    },
    'zprs-pending-tracker': {
      // Future: add ZPRS-specific endpoint once VBS is ready
      path: '/execute/zprs-pending-tracker',
      method: 'multipart',
      requiredParams: ['pernr', 'cummode'],
    },
  };

  const ep = endpointMap[slug];
  if (!ep) throw new Error(`No Windows endpoint mapped for module: ${slug}`);

  // Validate required parameters were provided by the UI
  for (const p of ep.requiredParams || []) {
    if (!params[p]) throw new Error(`Required parameter "${p}" missing`);
  }

  log(job, `Dispatching to Windows worker: ${workerUrl}${ep.path}`);
  log(job, `Parameters: pernr=${params.pernr} cummode=${params.cummode} mode=${params.runMode || 'LIVE'}`);

  const url = `${workerUrl}${ep.path}`;
  const fd = new FormData();

  // Append fields
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') fd.append(k, String(v));
  }

  // Append uploaded input file (if present)
  if (inputFile && fs.existsSync(inputFile.storedPath)) {
    const fileBuf = fs.readFileSync(inputFile.storedPath);
    const blob = new Blob([fileBuf]);
    fd.append('inputFile', blob, inputFile.originalName || 'input.xlsx');
    log(job, `Uploading input file: ${inputFile.originalName} (${(fileBuf.length / 1024).toFixed(1)} KB)`);
  }

  const VBS_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VBS_TIMEOUT + 5 * 60 * 1000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${workerToken}` },
      body: fd,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Windows worker error (${res.status}): ${errText.slice(0, 500)}`);
    }

    // The Windows agent streams NDJSON. Read it line by line.
    progress(job, 10, 'Connected to Windows worker');

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf8');
    let buffer = '';
    let outputFiles = [];
    let runId = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const evt = JSON.parse(trimmed);
          if (evt.runId) runId = evt.runId;

          switch (evt.event) {
            case 'start':
              log(job, evt.message || 'Run started on Windows worker', 'info');
              break;
            case 'log':
              log(job, evt.line, evt.level || 'info');
              break;
            case 'progress':
              progress(job, evt.percent || 50, evt.message || '');
              break;
            case 'complete':
              if (Array.isArray(evt.outputFiles)) outputFiles = evt.outputFiles;
              log(job, `Windows worker reported completion. Output files: ${outputFiles.map((f) => f.name).join(', ')}`, 'info');
              break;
            case 'failed':
              throw new Error(evt.error || 'Windows worker reported failure');
          }
        } catch (e) {
          // If it's not JSON and not our thrown error, just log the raw line
          if (!e.message?.includes('Windows worker')) {
            log(job, trimmed, 'debug');
          } else {
            throw e;
          }
        }
      }
    }

    if (!outputFiles.length) throw new Error('Windows worker completed but produced no output files');

    // Download output files from the Windows worker into local reports dir
    const reportsDir = path.resolve(process.env.REPORTS_DIR || './storage/reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    const downloaded = [];
    for (const f of outputFiles) {
      const localPath = path.join(reportsDir, `${dbJobId}_${f.name}`);
      log(job, `Downloading ${f.name} (${(f.size / 1024).toFixed(1)} KB)...`);
      const dlRes = await fetch(`${workerUrl}/runs/${runId}/files/${encodeURIComponent(f.name)}`, {
        headers: { Authorization: `Bearer ${workerToken}` },
      });
      if (!dlRes.ok) {
        log(job, `Warning: could not download ${f.name} (${dlRes.status})`, 'warn');
        continue;
      }
      const arrBuf = await dlRes.arrayBuffer();
      fs.writeFileSync(localPath, Buffer.from(arrBuf));
      downloaded.push({ path: localPath, name: f.name });
      log(job, `Saved ${f.name} → ${localPath}`);
    }

    const mainXlsx = downloaded.find((f) => f.name.toLowerCase().endsWith('.xlsx') && !f.name.includes('RUN_REPORT')) || downloaded[0];
    return {
      summary: 'SAP pipeline completed successfully',
      outputFile: mainXlsx,
      extraFiles: downloaded.filter((f) => f !== mainXlsx),
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Windows worker timed out');
    if (err.message === 'fetch failed' || err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED') {
      throw new Error(
        `Cannot connect to Windows Worker Agent at ${workerUrl}. Please make sure the Windows Worker Agent process is running (cd server/src/workers/windows-agent-sample && npm start) and reachable.`
      );
    }
    throw err;
  }
}
