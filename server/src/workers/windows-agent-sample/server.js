/**
 * ============================================================================
 *  SAP DAILY TRACKER — Windows Worker Agent
 * ============================================================================
 *
 *  Runs on a Windows VM/server with:
 *    - SAP GUI installed + ZSCH_UPDATE transaction available
 *    - Python 3 with openpyxl
 *    - Production scripts (VBS + Python engine) in SCRIPTS_DIR
 *
 *  Central API calls POST /execute/sap-daily-tracker (multipart) with:
 *    - inputFile  : SAP_Daily_Input.xlsx (the master workbook from browser upload)
 *    - pernr      : 6-digit employee ID
 *    - cummode    : EMAIL | PHONE | VISIT | SANYOG
 *    - runMode    : DRY_RUN | LIVE | RETRY_FAILED
 *
 *  Agent:
 *    1. Creates a run folder under WORK_DIR
 *    2. Copies scripts + uploaded XLSX into the run folder
 *    3. Streams each pipeline step (Snapshot → Reconcile → Validate → VBS → Apply Status)
 *       as newline-delimited JSON log events back to the central API via webhook
 *    4. Returns final XLSX + RUN_REPORT.xlsx when done
 *
 *  To start:  node server.js
 * ============================================================================
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import winston from 'winston';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 9000;
const TOKEN = process.env.WORKER_TOKEN || 'shared-secret-change-me';
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.join(__dirname, 'scripts');
const WORK_DIR = process.env.WORK_DIR || path.join(__dirname, 'runs');
const PYTHON_EXE = process.env.PYTHON_EXE || 'python';
const CSCRIPT_EXE = process.env.CSCRIPT_EXE || 'cscript';
const VBS_TIMEOUT_MS = Number(process.env.VBS_TIMEOUT_MS) || 30 * 60 * 1000;

// Expected script filenames — match what your BAT expects
const VBS_NAME = 'SAP_Daily_Updater_v5_LO.vbs';
const PY_NAME = 'update_excel_structure.py';

fs.mkdirSync(WORK_DIR, { recursive: true });
fs.mkdirSync(SCRIPTS_DIR, { recursive: true });

// ── Logger ────────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: path.join(WORK_DIR, 'worker-agent.log') }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, runId }) => `${level}${runId ? ' [' + runId + ']' : ''}: ${message}`)
      ),
    }),
  ],
});

// ── Express ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Token auth middleware
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'sap-windows-worker',
    scripts: {
      vbs: fs.existsSync(path.join(SCRIPTS_DIR, VBS_NAME)),
      python: fs.existsSync(path.join(SCRIPTS_DIR, PY_NAME)),
    },
    time: new Date().toISOString(),
  });
});

// Multer for XLSX uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, WORK_DIR),
    filename: (_req, _file, cb) => cb(null, `upload_${uuid()}.xlsx`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ── File copy helper (blocking but run dirs are small) ────────────────────
function copyFileSync(src, dest) {
  fs.copyFileSync(src, dest);
}

// ── Command runner: streams stdout/err line-by-line to both logger + SSE ─
function runCommand(cmd, args, opts, onLine) {
  return new Promise((resolve, reject) => {
    logger.info(`Running: ${cmd} ${args.join(' ')}`);
    const proc = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeout = opts.timeout
      ? setTimeout(() => {
          killed = true;
          proc.kill();
          reject(new Error(`Process timed out after ${opts.timeout}ms`));
        }, opts.timeout)
      : null;

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      text.split(/\r?\n/).filter(Boolean).forEach((line) => onLine({ level: 'info', line }));
    });
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      text.split(/\r?\n/).filter(Boolean).forEach((line) => onLine({ level: 'warn', line }));
    });
    proc.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      if (killed) return;
      if (code === 0) resolve({ stdout, stderr, exitCode: code });
      else reject(new Error(`Process exited with code ${code}\n${stderr.slice(-1000)}`));
    });
    proc.on('error', reject);
  });
}

// ── Main execute endpoint: SAP Daily Tracker ─────────────────────────────
app.post('/execute/sap-daily-tracker', upload.single('inputFile'), async (req, res) => {
  const runId = uuid().slice(0, 12);
  const runLog = logger.child({ runId });

  try {
    // Validate input
    if (!req.file) return res.status(400).json({ error: 'inputFile (XLSX) is required' });
    const pernr = (req.body.pernr || '').trim();
    const cummode = (req.body.cummode || '').trim().toUpperCase();
    const runMode = (req.body.runMode || 'LIVE').toUpperCase(); // DRY_RUN, LIVE, RETRY_FAILED

    if (!/^\d{6}$/.test(pernr)) return res.status(400).json({ error: 'PERNR must be exactly 6 digits' });
    if (!['EMAIL', 'PHONE', 'VISIT', 'SANYOG'].includes(cummode)) {
      return res.status(400).json({ error: 'CUMMODE must be EMAIL, PHONE, VISIT, or SANYOG' });
    }
    if (!['DRY_RUN', 'LIVE', 'RETRY_FAILED'].includes(runMode)) {
      return res.status(400).json({ error: 'runMode must be DRY_RUN, LIVE, or RETRY_FAILED' });
    }

    if (!fs.existsSync(path.join(SCRIPTS_DIR, VBS_NAME))) {
      return res.status(500).json({ error: `VBS script not found in SCRIPTS_DIR: ${VBS_NAME}` });
    }
    if (!fs.existsSync(path.join(SCRIPTS_DIR, PY_NAME))) {
      return res.status(500).json({ error: `Python script not found in SCRIPTS_DIR: ${PY_NAME}` });
    }

    // Set up per-run working directory
    const runDir = path.join(WORK_DIR, `run_${runId}`);
    fs.mkdirSync(runDir, { recursive: true });
    const xlsxPath = path.join(runDir, 'SAP_Daily_Input.xlsx');

    // Move uploaded XLSX to run dir with expected name
    fs.renameSync(req.file.path, xlsxPath);

    // Copy production scripts to run dir (so VBS auto-detects base dir correctly)
    copyFileSync(path.join(SCRIPTS_DIR, VBS_NAME), path.join(runDir, VBS_NAME));
    copyFileSync(path.join(SCRIPTS_DIR, PY_NAME), path.join(runDir, PY_NAME));

    runLog.info(`Run started — pernr=${pernr} mode=${runMode} cummode=${cummode} dir=${runDir}`);

    // We'll keep the connection open with newline-delimited JSON streaming so the
    // central API can relay logs in real time via Socket.io.
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const emit = (obj) => {
      res.write(JSON.stringify({ runId, ts: new Date().toISOString(), ...obj }) + '\n');
    };
    emit({ event: 'start', message: `Pipeline starting — ${runMode} mode` });

    const logLine = (level, line) => emit({ event: 'log', level, line });

    try {
      // ───────────────────────────────────────────────────────────────
      // STEP 0: Export SAP snapshot via VBS --export-sap
      // ───────────────────────────────────────────────────────────────
      logLine('info', '== Step 0: Exporting SAP grid snapshot ==');
      const snapshotCsv = path.join(runDir, 'SAP_Daily_Input_SAP_SNAPSHOT.csv');
      if (fs.existsSync(snapshotCsv)) fs.unlinkSync(snapshotCsv);

      await runCommand(
        CSCRIPT_EXE,
        ['//nologo', VBS_NAME, '--export-sap', `--run-id=${runId}`],
        { cwd: runDir, timeout: 5 * 60 * 1000 },
        ({ level, line }) => logLine(level, line)
      );
      if (!fs.existsSync(snapshotCsv)) throw new Error('SAP snapshot CSV was not created by VBS');
      logLine('info', `[PASS] SAP snapshot captured: ${snapshotCsv}`);

      // ───────────────────────────────────────────────────────────────
      // STEP 0B: Reconcile SAP snapshot → Master Excel
      // ───────────────────────────────────────────────────────────────
      logLine('info', '== Step 0B: Reconciling SAP rows with master workbook ==');
      await runCommand(
        PYTHON_EXE,
        [PY_NAME, '--mode', 'reconcile-sap', '--xlsx', xlsxPath, '--sap-snapshot', snapshotCsv, '--run-id', runId],
        { cwd: runDir, timeout: 2 * 60 * 1000 },
        ({ level, line }) => logLine(level, line)
      );
      logLine('info', '[PASS] Reconciliation complete');

      // ───────────────────────────────────────────────────────────────
      // STEP 1: Validate + export worklist (Python validate-export)
      // ───────────────────────────────────────────────────────────────
      const rerun = runMode === 'RETRY_FAILED' ? 'FAILED' : 'ALL';
      const worklistCsv = path.join(runDir, 'SAP_Daily_Input_WORKLIST.csv');
      logLine('info', '== Step 1: Validating workbook and compiling worklist ==');

      try {
        await runCommand(
          PYTHON_EXE,
          [
            PY_NAME,
            '--mode', 'validate-export',
            '--xlsx', xlsxPath,
            '--worklist', worklistCsv,
            '--pernr', pernr,
            '--cummode', cummode,
            '--run-id', runId,
            '--rerun', rerun,
            '--write-validation-errors',
          ],
          { cwd: runDir, timeout: 2 * 60 * 1000 },
          ({ level, line }) => logLine(level, line)
        );
        logLine('info', '[PASS] Validation passed. Worklist compiled.');
      } catch (err) {
        // Validation errors are returned as non-zero exit with messages — we still
        // want to surface the validation report, but we stop the run.
        logLine('error', `Validation failed: ${err.message}`);
        emit({ event: 'failed', error: 'Validation failed — check logs' });
        res.end();
        return;
      }

      // ───────────────────────────────────────────────────────────────
      // STEP 2: VBS SAP update (or dry-run)
      // ───────────────────────────────────────────────────────────────
      const statusCsv = path.join(runDir, 'SAP_Daily_Input_STATUS.csv');
      const matchCsv = path.join(runDir, 'SAP_Daily_Input_MATCH_REPORT.csv');
      const checkpt = path.join(runDir, 'SAP_Daily_Input_CHECKPOINT.txt');
      [statusCsv, matchCsv].forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));

      if (runMode === 'DRY_RUN') {
        logLine('info', '== Step 2: DRY RUN — invoking VBS with --dry-run ==');
        await runCommand(
          CSCRIPT_EXE,
          ['//nologo', VBS_NAME, '--dry-run', `--run-id=${runId}`],
          { cwd: runDir, timeout: VBS_TIMEOUT_MS },
          ({ level, line }) => logLine(level, line)
        );
      } else {
        logLine('info', `== Step 2: LIVE SAP UPDATE — invoking VBS (timeout ${VBS_TIMEOUT_MS / 60000}min) ==`);
        await runCommand(
          CSCRIPT_EXE,
          ['//nologo', VBS_NAME, `--run-id=${runId}`],
          { cwd: runDir, timeout: VBS_TIMEOUT_MS },
          ({ level, line }) => logLine(level, line)
        );
      }

      if (!fs.existsSync(statusCsv)) {
        throw new Error(`VBS did not produce STATUS.csv at ${statusCsv}`);
      }
      logLine('info', '[PASS] VBS processing complete');

      // ───────────────────────────────────────────────────────────────
      // STEP 3: Apply status back to master XLSX
      // ───────────────────────────────────────────────────────────────
      if (runMode === 'DRY_RUN') {
        logLine('info', '== Step 3: DRY RUN — generating reports only (no XLSX update) ==');
        await runCommand(
          PYTHON_EXE,
          [PY_NAME, '--mode', 'convert-reports', '--xlsx', xlsxPath],
          { cwd: runDir, timeout: 60 * 1000 },
          ({ level, line }) => logLine(level, line)
        );
      } else {
        logLine('info', '== Step 3: Applying status codes back to master workbook ==');
        await runCommand(
          PYTHON_EXE,
          [PY_NAME, '--mode', 'apply-status', '--xlsx', xlsxPath, '--status-csv', statusCsv],
          { cwd: runDir, timeout: 2 * 60 * 1000 },
          ({ level, line }) => logLine(level, line)
        );
        logLine('info', '[PASS] Status merged into workbook');
      }

      // ───────────────────────────────────────────────────────────────
      // Collect output files
      // ───────────────────────────────────────────────────────────────
      const reportXlsx = path.join(runDir, 'SAP_Daily_Input_RUN_REPORT.xlsx');
      const outputFiles = [];
      if (fs.existsSync(xlsxPath)) outputFiles.push({ name: 'SAP_Daily_Input.xlsx', path: xlsxPath, size: fs.statSync(xlsxPath).size });
      if (fs.existsSync(reportXlsx)) outputFiles.push({ name: 'SAP_Daily_Input_RUN_REPORT.xlsx', path: reportXlsx, size: fs.statSync(reportXlsx).size });
      if (fs.existsSync(snapshotCsv)) outputFiles.push({ name: 'SAP_SNAPSHOT.csv', path: snapshotCsv, size: fs.statSync(snapshotCsv).size });
      if (fs.existsSync(matchCsv)) outputFiles.push({ name: 'MATCH_REPORT.csv', path: matchCsv, size: fs.statSync(matchCsv).size });

      // Clean intermediate files (like your BAT does)
      [
        worklistCsv, statusCsv, matchCsv, checkpt,
        path.join(runDir, 'SAP_Daily_Input_VALIDATION_REPORT.csv'),
      ].forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));

      emit({ event: 'complete', outputFiles });
      logLine('info', 'Pipeline complete ✓');
      res.end();
    } catch (stageErr) {
      runLog.error(`Pipeline failed: ${stageErr.message}`);
      emit({ event: 'failed', error: stageErr.message });
      res.end();
    }
  } catch (outerErr) {
    runLog.error(`Unhandled error: ${outerErr.message}`);
    if (!res.headersSent) res.status(500).json({ error: outerErr.message });
    else res.end();
  }
});

// ── Endpoint to download output files produced by a run ──────────────────
app.get('/runs/:runId/files/:filename', (req, res) => {
  const filePath = path.join(WORK_DIR, `run_${req.params.runId}`, req.params.filename);
  // Safety: ensure path is still inside WORK_DIR
  if (!filePath.startsWith(WORK_DIR)) return res.status(400).json({ error: 'Invalid path' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath);
});

// ── Column discovery endpoint ────────────────────────────────────────────
app.post('/execute/sap-daily-tracker/discover', async (req, res) => {
  const runId = uuid().slice(0, 12);
  const runDir = path.join(WORK_DIR, `discover_${runId}`);
  fs.mkdirSync(runDir, { recursive: true });

  // We need an XLSX placeholder for the python step, but discovery doesn't
  // really use it.  Create a dummy empty workbook reference is unnecessary —
  // VBS discover doesn't read the XLSX.
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.flushHeaders?.();
  const emit = (obj) => res.write(JSON.stringify({ runId, ...obj }) + '\n');
  const logLine = (level, line) => emit({ event: 'log', level, line });

  try {
    // Need a dummy XLSX for the convert-reports step at minimum. Just use an
    // empty file? Better: run only VBS discover and return the CSV.
    copyFileSync(path.join(SCRIPTS_DIR, VBS_NAME), path.join(runDir, VBS_NAME));
    copyFileSync(path.join(SCRIPTS_DIR, PY_NAME), path.join(runDir, PY_NAME));

    logLine('info', 'Discovering SAP grid columns...');
    await runCommand(
      CSCRIPT_EXE,
      ['//nologo', VBS_NAME, '--discover-columns', `--run-id=${runId}`],
      { cwd: runDir, timeout: 60 * 1000 },
      ({ level, line }) => logLine(level, line)
    );

    const discCsv = path.join(runDir, 'SAP_Daily_Input_SAP_COLUMN_DISCOVERY.csv');
    if (fs.existsSync(discCsv)) {
      const content = fs.readFileSync(discCsv, 'utf8');
      emit({ event: 'complete', discovery: content });
    } else {
      emit({ event: 'failed', error: 'Discovery CSV not produced' });
    }
    res.end();
  } catch (err) {
    emit({ event: 'failed', error: err.message });
    res.end();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`SAP Windows Worker Agent listening on http://0.0.0.0:${PORT}`);
  logger.info(`Scripts dir : ${SCRIPTS_DIR}`);
  logger.info(`Work dir    : ${WORK_DIR}`);
});
