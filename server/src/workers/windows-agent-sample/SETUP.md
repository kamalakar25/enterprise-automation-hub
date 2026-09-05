# SAP Windows Worker Agent — Setup Guide

This agent runs on a **Windows Server/VM** that has:

- SAP GUI for Windows installed and configured
- The `ZSCH_UPDATE` transaction accessible
- Python 3 with `openpyxl` installed (`pip install openpyxl`)
- Node.js 18+ installed

## Deployment Steps

### 1. Copy this folder to the Windows VM
Copy the entire `windows-agent-sample/` folder to e.g. `C:\AutomationHub\agent\`.

### 2. Place your production scripts in the scripts folder
Create a folder for your scripts, e.g. `C:\AutomationHub\scripts\`, and copy these files into it:

| File | Where to get it |
|---|---|
| `SAP_Daily_Updater_v5_LO.vbs` | Your existing VBS (the one in the pipeline BAT) |
| `update_excel_structure.py` | Your existing Python engine (the file you named e.g. `engine.py` or whatever the BAT calls `%PY%`). **Rename it to exactly `update_excel_structure.py`** OR edit `VBS_NAME`/`PY_NAME` constants at the top of `server.js` to match your filenames. |

### 3. Install Node.js dependencies and configure
```bat
cd C:\AutomationHub\agent
npm install
copy .env.example .env
notepad .env
```

Edit these values in `.env`:
```env
WORKER_TOKEN=choose-a-long-random-string-here   # must match central server WINDOWS_WORKER_TOKEN
SCRIPTS_DIR=C:\AutomationHub\scripts
WORK_DIR=C:\AutomationHub\runs
PYTHON_EXE=python              # or full path like C:\Python311\python.exe
CSCRIPT_EXE=cscript
PORT=9000
```

### 4. Install Python dependencies on Windows
```bat
pip install openpyxl
```

### 5. Test the agent
```bat
npm start
```
You should see:
```
info: SAP Windows Worker Agent listening on http://0.0.0.0:9000
```

From the central server (or any machine), test health:
```powershell
curl http://<windows-vm-ip>:9000/health -H "Authorization: Bearer YOUR_TOKEN"
```

### 6. Open firewall port 9000
The central API server must be able to reach this agent. Open inbound TCP port **9000** in Windows Firewall, and ensure the central server's IP can reach the VM (internal network, VPN, etc.).

### 7. Configure central server
On the central (Linux/Node) server, edit `server/.env`:
```env
WINDOWS_WORKER_URL=http://<windows-vm-ip-or-hostname>:9000
WINDOWS_WORKER_TOKEN=the-same-token-you-set-above
```
Restart the API and worker processes.

### 8. (Optional) Run as a Windows Service
To have the agent start automatically on boot, use **node-windows** or **NSSM** (Non-Sucking Service Manager):

```bat
nssm install SAPWorkerAgent "C:\Program Files\nodejs\node.exe" "C:\AutomationHub\agent\server.js"
nssm set SAPWorkerAgent AppDirectory C:\AutomationHub\agent
nssm set SAPWorkerAgent Start SERVICE_AUTO_START
nssm start SAPWorkerAgent
```

## How it works

The central server calls `POST /execute/sap-daily-tracker` with:
- The uploaded XLSX file (multipart)
- `pernr` (6-digit employee ID)
- `cummode` (EMAIL/PHONE/VISIT/SANYOG)
- `runMode` (DRY_RUN / LIVE / RETRY_FAILED)

The agent:
1. Creates a unique working directory under `WORK_DIR`
2. Copies VBS + Python engine + uploaded XLSX into it
3. Runs the 5-stage pipeline exactly like your BAT (Snapshot → Reconcile → Validate → VBS → Apply Status)
4. Streams every stdout/stderr line back as NDJSON events in real-time → central server relays them to the browser via Socket.io
5. Downloads final `SAP_Daily_Input.xlsx` (updated) and `SAP_Daily_Input_RUN_REPORT.xlsx` back to the central server
6. Cleans up intermediate CSVs exactly as your BAT does

## Supported Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check + script presence verification |
| POST | `/execute/sap-daily-tracker` | Full SAP Daily Tracker pipeline (multipart, streaming) |
| POST | `/execute/sap-daily-tracker/discover` | SAP column discovery (future) |
| GET | `/runs/:runId/files/:filename` | Download output artifacts |
