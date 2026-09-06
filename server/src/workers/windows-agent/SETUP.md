# SAP Windows Worker Agent — Setup Guide (Python Only)

This agent runs on an **Employee Windows Laptop or VM** that has:

- **SAP GUI for Windows** installed and logged in
- **Python 3** installed (with `pip install openpyxl`)
- **Zero Node.js required!** (Runs natively using Python standard library)

## Quick 1-Minute Setup on Employee Laptops

### 1. Prerequisite (Only 1 Software Tool!)
- Install **Python 3** from [python.org](https://www.python.org/downloads/) (check **"Add Python to PATH"**).

### 2. Copy this folder
Copy this `windows-agent/` folder anywhere on the laptop (e.g. `C:\SAP-Agent\` or `E:\Kamalakar\Projects\windows-agent\`).

### 3. Setup Auto-Start (1-Click)
Double-click **`install-startup.bat`**.

It will:
- Auto-install `openpyxl` if needed.
- Register silent auto-start in `shell:startup`.
- Start the agent immediately in the background on port 9000.

---

## Daily Usage
1. Open **SAP GUI** and log in to transaction `ZSCH_UPDATE`.
2. Open Chrome/Edge and go to the Automation Hub website (e.g. `http://<server-ip>:5173`).
3. You will see: **`🟢 Local SAP Agent Online (localhost:9000)`**.
4. Upload `SAP_Daily_Input.xlsx` and click **"Run Automation"**!

---

## Utility Scripts

| Script | Purpose |
|---|---|
| `install-startup.bat` | Sets up invisible auto-start on laptop boot via `shell:startup` |
| `start-agent.bat` | Starts the agent manually in a visible console window |
| `uninstall-startup.bat` | Removes the agent from `shell:startup` and stops any running process |

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
