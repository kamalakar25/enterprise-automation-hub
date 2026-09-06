"""
=============================================================================
 SAP DAILY TRACKER — Pure Python Windows Worker Agent (Zero Node.js Dependency)
=============================================================================
 Runs natively on Windows with standard Python 3:
   - No Node.js required!
   - Uses built-in standard library http.server + subprocess + threading
   - Hosts HTTP API on port 9000 with CORS and NDJSON log streaming
   - Executes VBS + Python pipeline and returns RUN_REPORT.xlsx

 Usage:
   python agent.py
=============================================================================
"""

import http.server
import json
import os
import re
import shutil
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid
from pathlib import Path

# Ensure stdout/stderr exist when running silently under pythonw / background services
if sys.stdout is None:
    try:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    except Exception:
        pass
if sys.stderr is None:
    try:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")
    except Exception:
        pass

# ── Configuration ──────────────────────────────────────────────────────────
PORT = int(os.environ.get("PORT", "9000"))
TOKEN = os.environ.get("WORKER_TOKEN", "shared-secret-change-me")
BASE_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = Path(os.environ.get("SCRIPTS_DIR", str(BASE_DIR / "scripts"))).resolve()
WORK_DIR = Path(os.environ.get("WORK_DIR", str(BASE_DIR / "runs"))).resolve()
PYTHON_EXE = os.environ.get("PYTHON_EXE", "python")
CSCRIPT_EXE = os.environ.get("CSCRIPT_EXE", "cscript")
VBS_TIMEOUT_SEC = int(os.environ.get("VBS_TIMEOUT_MS", "1800000")) // 1000

VBS_NAME = "SAP_Daily_Updater_v5_LO.vbs"
PY_NAME = "update_excel_structure.py"

SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
WORK_DIR.mkdir(parents=True, exist_ok=True)


def parse_multipart_form(rfile, headers):
    """Simple standard-library multipart form parser."""
    content_type = headers.get("Content-Type", "")
    if "boundary=" not in content_type:
        return {}, {}
    boundary = content_type.split("boundary=")[1].strip()
    if boundary.startswith('"') and boundary.endswith('"'):
        boundary = boundary[1:-1]
    boundary_bytes = ("--" + boundary).encode("latin-1")

    content_length = int(headers.get("Content-Length", 0))
    body = rfile.read(content_length)

    fields = {}
    files = {}

    parts = body.split(boundary_bytes)
    for part in parts:
        if not part or part == b"--\r\n" or part == b"--":
            continue
        if b"\r\n\r\n" not in part:
            continue
        raw_headers, raw_data = part.split(b"\r\n\r\n", 1)
        if raw_data.endswith(b"\r\n"):
            raw_data = raw_data[:-2]

        hdr_text = raw_headers.decode("latin-1", errors="replace")
        name_match = re.search(r'name="([^"]+)"', hdr_text)
        filename_match = re.search(r'filename="([^"]+)"', hdr_text)

        if not name_match:
            continue
        field_name = name_match.group(1)

        if filename_match:
            filename = filename_match.group(1)
            files[field_name] = {"filename": filename, "data": raw_data}
        else:
            fields[field_name] = raw_data.decode("utf-8", errors="replace").strip()

    return fields, files


class AgentHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Safe logging that doesn't fail when running without console / pythonw
        try:
            if sys.stderr:
                sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))
        except Exception:
            pass

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def is_authorized(self):
        auth_header = self.headers.get("Authorization", "")
        parsed_url = urllib.parse.urlparse(self.path)
        query_params = urllib.parse.parse_qs(parsed_url.query)
        token_query = query_params.get("token", [""])[0]

        if auth_header == f"Bearer {TOKEN}" or token_query == TOKEN:
            return True
        # Allow file downloads from browser
        if parsed_url.path.startswith("/runs/") and "/files/" in parsed_url.path:
            return True
        return False

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            vbs_exists = (SCRIPTS_DIR / VBS_NAME).exists()
            py_exists = (SCRIPTS_DIR / PY_NAME).exists()
            payload = {
                "ok": True,
                "service": "sap-windows-worker-python",
                "scripts": {"vbs": vbs_exists, "python": py_exists},
                "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            self.wfile.write(json.dumps(payload).encode("utf-8"))
            return

        if path.startswith("/runs/") and "/files/" in path:
            # Format: /runs/<runId>/files/<filename>
            parts = path.strip("/").split("/")
            if len(parts) == 4:
                run_id = parts[1]
                filename = parts[3]
                file_path = WORK_DIR / f"run_{run_id}" / filename
                if file_path.exists() and file_path.is_file():
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                    self.send_header("Content-Length", str(file_path.stat().st_size))
                    self.end_headers()
                    with open(file_path, "rb") as f:
                        shutil.copyfileobj(f, self.wfile)
                    return
                else:
                    self.send_response(404)
                    self.end_headers()
                    self.wfile.write(b'{"error":"File not found"}')
                    return

        self.send_response(404)
        self.end_headers()
        self.wfile.write(b'{"error":"Not found"}')

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if not self.is_authorized():
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"Unauthorized"}')
            return

        if path == "/execute/sap-daily-tracker":
            self.handle_execute_sap()
            return

        self.send_response(404)
        self.end_headers()
        self.wfile.write(b'{"error":"Endpoint not found"}')

    def handle_execute_sap(self):
        fields, files = parse_multipart_form(self.rfile, self.headers)

        pernr = fields.get("pernr", "").strip()
        cummode = fields.get("cummode", "").strip().upper()
        run_mode = fields.get("runMode", "LIVE").strip().upper()
        input_file = files.get("inputFile")

        if not input_file or not input_file.get("data"):
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"inputFile (XLSX) is required"}')
            return

        if not re.match(r"^\d{6}$", pernr):
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"PERNR must be exactly 6 digits"}')
            return

        run_id = str(uuid.uuid4())[:12]
        run_dir = WORK_DIR / f"run_{run_id}"
        run_dir.mkdir(parents=True, exist_ok=True)

        xlsx_path = run_dir / "SAP_Daily_Input.xlsx"
        with open(xlsx_path, "wb") as f:
            f.write(input_file["data"])

        # Copy production scripts to run dir
        shutil.copy2(SCRIPTS_DIR / VBS_NAME, run_dir / VBS_NAME)
        shutil.copy2(SCRIPTS_DIR / PY_NAME, run_dir / PY_NAME)

        # Start streaming NDJSON
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        def emit(obj):
            payload = json.dumps({"runId": run_id, "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **obj}) + "\n"
            try:
                self.wfile.write(payload.encode("utf-8"))
                self.wfile.flush()
            except Exception:
                pass

        def log_line(level, line):
            emit({"event": "log", "level": level, "line": line})

        emit({"event": "start", "message": f"Pipeline starting — {run_mode} mode"})

        try:
            # STEP 0: Export SAP Snapshot
            log_line("info", "== Step 0: Exporting SAP grid snapshot ==")
            snapshot_csv = run_dir / "SAP_Daily_Input_SAP_SNAPSHOT.csv"
            if snapshot_csv.exists():
                snapshot_csv.unlink()

            self.run_process(
                [CSCRIPT_EXE, "//nologo", VBS_NAME, "--export-sap", f"--run-id={run_id}"],
                cwd=run_dir,
                timeout=5 * 60,
                log_fn=log_line,
            )
            if not snapshot_csv.exists():
                raise RuntimeError("SAP snapshot CSV was not created by VBS")
            log_line("info", f"[PASS] SAP snapshot captured: {snapshot_csv.name}")

            # STEP 0B: Reconcile SAP Snapshot
            log_line("info", "== Step 0B: Reconciling SAP rows with master workbook ==")
            self.run_process(
                [PYTHON_EXE, PY_NAME, "--mode", "reconcile-sap", "--xlsx", str(xlsx_path), "--sap-snapshot", str(snapshot_csv), "--run-id", run_id],
                cwd=run_dir,
                timeout=2 * 60,
                log_fn=log_line,
            )
            log_line("info", "[PASS] Reconciliation complete")

            # STEP 1: Validate & Export Worklist
            rerun = "FAILED" if run_mode == "RETRY_FAILED" else "ALL"
            worklist_csv = run_dir / "SAP_Daily_Input_WORKLIST.csv"
            log_line("info", "== Step 1: Validating workbook and compiling worklist ==")

            try:
                self.run_process(
                    [
                        PYTHON_EXE, PY_NAME,
                        "--mode", "validate-export",
                        "--xlsx", str(xlsx_path),
                        "--worklist", str(worklist_csv),
                        "--pernr", pernr,
                        "--cummode", cummode,
                        "--run-id", run_id,
                        "--rerun", rerun,
                        "--write-validation-errors",
                    ],
                    cwd=run_dir,
                    timeout=2 * 60,
                    log_fn=log_line,
                )
                log_line("info", "[PASS] Validation passed. Worklist compiled.")
            except Exception as val_err:
                log_line("error", f"Validation stopped: {val_err}")
                report_xlsx = run_dir / "SAP_Daily_Input_RUN_REPORT.xlsx"
                output_files = []
                if report_xlsx.exists():
                    output_files.append({"name": report_xlsx.name, "size": report_xlsx.stat().st_size})
                emit({"event": "failed", "error": f"Validation failed: {val_err}", "outputFiles": output_files})
                return

            # STEP 2: VBS SAP Update
            status_csv = run_dir / "SAP_Daily_Input_STATUS.csv"
            match_csv = run_dir / "SAP_Daily_Input_MATCH_REPORT.csv"
            if status_csv.exists(): status_csv.unlink()
            if match_csv.exists(): match_csv.unlink()

            if run_mode == "DRY_RUN":
                log_line("info", "== Step 2: DRY RUN — invoking VBS with --dry-run ==")
                self.run_process(
                    [CSCRIPT_EXE, "//nologo", VBS_NAME, "--dry-run", f"--run-id={run_id}"],
                    cwd=run_dir,
                    timeout=VBS_TIMEOUT_SEC,
                    log_fn=log_line,
                )
            else:
                log_line("info", f"== Step 2: LIVE SAP UPDATE — invoking VBS ==")
                self.run_process(
                    [CSCRIPT_EXE, "//nologo", VBS_NAME, f"--run-id={run_id}"],
                    cwd=run_dir,
                    timeout=VBS_TIMEOUT_SEC,
                    log_fn=log_line,
                )

            if not status_csv.exists():
                raise RuntimeError(f"VBS did not produce STATUS.csv at {status_csv.name}")
            log_line("info", "[PASS] VBS processing complete")

            # STEP 3: Apply Status Back
            if run_mode == "DRY_RUN":
                log_line("info", "== Step 3: DRY RUN — generating reports only ==")
                self.run_process(
                    [PYTHON_EXE, PY_NAME, "--mode", "convert-reports", "--xlsx", str(xlsx_path)],
                    cwd=run_dir,
                    timeout=60,
                    log_fn=log_line,
                )
            else:
                log_line("info", "== Step 3: Applying status codes back to master workbook ==")
                self.run_process(
                    [PYTHON_EXE, PY_NAME, "--mode", "apply-status", "--xlsx", str(xlsx_path), "--status-csv", str(status_csv)],
                    cwd=run_dir,
                    timeout=2 * 60,
                    log_fn=log_line,
                )
                log_line("info", "[PASS] Status merged into workbook")

            # Collect Output Files
            report_xlsx = run_dir / "SAP_Daily_Input_RUN_REPORT.xlsx"
            output_files = []
            if xlsx_path.exists():
                output_files.append({"name": xlsx_path.name, "size": xlsx_path.stat().st_size})
            if report_xlsx.exists():
                output_files.append({"name": report_xlsx.name, "size": report_xlsx.stat().st_size})

            emit({"event": "complete", "outputFiles": output_files})
            log_line("info", "Pipeline complete ✓")

        except Exception as e:
            log_line("error", f"Pipeline error: {e}")
            emit({"event": "failed", "error": str(e)})

    def run_process(self, cmd, cwd, timeout, log_fn):
        p = subprocess.Popen(
            cmd,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            universal_newlines=True,
        )

        def read_stdout():
            for line in iter(p.stdout.readline, ""):
                if line.strip():
                    log_fn("info", line.rstrip())
            p.stdout.close()

        def read_stderr():
            for line in iter(p.stderr.readline, ""):
                if line.strip():
                    log_fn("warn", line.rstrip())
            p.stderr.close()

        t_out = threading.Thread(target=read_stdout)
        t_err = threading.Thread(target=read_stderr)
        t_out.start()
        t_err.start()

        try:
            p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            p.kill()
            raise RuntimeError(f"Process timed out after {timeout} seconds")
        finally:
            t_out.join()
            t_err.join()

        if p.returncode != 0:
            raise RuntimeError(f"Process exited with code {p.returncode}")


class ThreadedTCPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    server_address = ("0.0.0.0", PORT)
    httpd = ThreadedTCPServer(server_address, AgentHandler)
    print("=" * 60)
    print(" SAP Windows Worker Agent (Pure Python Engine)")
    print("=" * 60)
    print(f" Listening on : http://0.0.0.0:{PORT}")
    print(f" Scripts Dir  : {SCRIPTS_DIR}")
    print(f" Runs Dir     : {WORK_DIR}")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping agent...")
        httpd.server_close()


if __name__ == "__main__":
    main()
