# Enterprise Automation Hub — Deployment & Execution Architecture Guide

This comprehensive guide explains the **two deployment approaches** for executing SAP automations (such as **SAP Daily Tracker** and **ZPRS Pending Tracker**) across multiple laptops in an organization.

---

## Quick Architecture Comparison

```
+---------------------------------------------------------------------------------------------------+
| APPROACH 1: Distributed Local SAP Desktop Execution (Direct Local Agent Bridge)                  |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  [Central Server]                                [Employee Laptop 1]        [Employee Laptop 2]   |
|   - Web Portal (5173)                             - Chrome Browser           - Chrome Browser     |
|   - API Gateway (4000)                            - Open SAP GUI             - Open SAP GUI       |
|   - PostgreSQL Database                           - Local Agent (9000)       - Local Agent (9000) |
|   - Audit & History Logs                                                                          |
|                                                                                                   |
|  * Best when: Every employee logs into SAP GUI on their own laptop with their own credentials.    |
+---------------------------------------------------------------------------------------------------+
| APPROACH 2: Dedicated Central SAP Bot / Headless Queue Execution                                  |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  [Central Server]                                [Dedicated SAP VM / Bot]    [Any Employee Laptop]|
|   - Web Portal (5173)                             - Dedicated SAP GUI         - Chrome Browser    |
|   - API Gateway (4000)   <-- (BullMQ Queue) -->   - Worker Agent (9000)       - Zero software     |
|   - Redis Queue                                                                 needed            |
|   - PostgreSQL DB                                                                                 |
|                                                                                                   |
|  * Best when: A dedicated server/service account executes all SAP updates centrally.             |
+---------------------------------------------------------------------------------------------------+
```

---

# 🖥️ APPROACH 1: Distributed Local Desktop SAP Execution (Recommended)

In **Approach 1**, the central web portal is deployed once on a company server/host machine. Any employee across the organization can access the portal in Google Chrome/Edge and update **their own open SAP GUI session**.

### Why is this needed?
Google Chrome runs in a secure sandbox and cannot directly attach to Windows desktop COM objects (`GetObject("SAPGUI")`). A lightweight background agent (`localhost:9000`) on the employee's machine acts as the bridge.

---

### Part A: Central Host Machine Setup (1st Laptop / Server)

Run the central portal components on the host laptop (e.g., `172.20.10.3`):

1. Ensure **PostgreSQL** and **Redis** are running.
2. In `server/.env`, verify:
   ```env
   PORT=4000
   DATABASE_URL="postgresql://postgres:password@localhost:5432/automation_hub?schema=public"
   REDIS_HOST=localhost
   REDIS_PORT=6379
   WINDOWS_WORKER_URL=http://localhost:9000
   WINDOWS_WORKER_TOKEN=shared-secret-change-me
   ```
3. Start the services using `start-all.bat` or individually:
   ```cmd
   cd server && npm run dev
   cd client && npm run dev
   cd server && npm run worker
   ```
4. Find the host IP address using `ipconfig` (e.g., `172.20.10.3`).

---

### Part B: Employee Laptop Setup (2nd Laptop, 3rd Laptop, etc.)

#### 1. What to Copy to the Employee Laptop
Copy **ONLY ONE lightweight folder** from the project:
```text
server/src/workers/windows-agent
```
Paste it anywhere on the employee's laptop (e.g., `C:\SAP-Agent\` or on Desktop).

#### 2. Contents of `windows-agent`:
* `agent.py` — Pure Python local agent HTTP bridge (zero Node.js dependency)
* `scripts/`
  * `SAP_Daily_Updater_v5_LO.vbs` — SAP GUI VBScript update engine
  * `update_excel_structure.py` — Excel validation, lead time logic, and report generator
  * `SAP_Daily_Tracker_Pipeline.bat` — Optional manual batch runner
* `start-agent.bat` — 1-click launcher

#### 3. One-Time Prerequisites on Employee Laptop (Only 1 Software Tool!):
1. **Python 3** (with `openpyxl`):
   ```cmd
   pip install openpyxl
   ```
   *(Node.js is **NOT** required on the employee laptop!)*
2. **Enable SAP GUI Scripting**:
   * In SAP GUI, press `Alt+F12` → **Options**.
   * Navigate to **Accessibility & Scripting** → **Scripting**.
   * Check **"Enable scripting"**.
   * Uncheck *"Notify when a script attaches to SAP GUI"*.

---

### Part C: Daily Step-by-Step Workflow for Employee

```mermaid
sequenceDiagram
    autonumber
    actor User as Employee
    participant SAP as SAP GUI (ZSCH_UPDATE)
    participant Agent as Local Agent (localhost:9000)
    participant Chrome as Chrome Browser
    participant Server as Central Hub (172.20.10.3)

    User->>SAP: 1. Log in & open ZSCH_UPDATE
    User->>Agent: 2. Launch start-agent.bat (minimized)
    User->>Chrome: 3. Navigate to http://172.20.10.3:5173
    Chrome->>Agent: 4. Check localhost:9000/health (🟢 Online)
    User->>Chrome: 5. Upload Excel & Click "Run Automation"
    Chrome->>Agent: 6. POST /execute/sap-daily-tracker
    Agent->>SAP: 7. Validate Excel & Update SAP line items
    Agent-->>Chrome: 8. Stream real-time console logs
    Agent-->>Chrome: 9. Emit download links for RUN_REPORT.xlsx
    Chrome->>Server: 10. Sync run record & audit log to Central DB
```

1. **Running the Agent on Employee Laptops**:
   * **Silent Auto-Start on Windows Boot (Recommended — Zero User Action)**:
     Double-click **`install-startup.bat`** once. The agent will start silently in the background whenever the laptop turns on. No black console window will ever appear.
   * **Or Manual Launch**:
     Double-click **`start-agent.bat`**.

2. **Open SAP GUI**: Log in and open transaction `ZSCH_UPDATE`. Keep the results grid open.
3. **Open Chrome**: Go to `http://172.20.10.3:5173`.
4. **Log in**: Use operator credentials (e.g. `operator@company.com` / `operator123`).
5. **Run Automation**:
   * Open **SAP Daily Tracker**.
   * Confirm the green badge: `🟢 Local SAP Agent Online (localhost:9000)`.
   * Select **"🖥️ My Laptop's SAP"**.
   * Upload `SAP_Daily_Input.xlsx`, enter 6-digit **PERNR**, select **Mode**, and click **Run Automation**.
6. **Result**: Your local SAP GUI updates live on screen. Real-time human-friendly status updates appear in Chrome, and the generated `RUN_REPORT.xlsx` is available for instant download.

---

# ☁️ APPROACH 2: Dedicated Central SAP Bot / Server-Side Execution

In **Approach 2**, employees do **NOT** need anything installed on their laptops (no Python, no VBScript, no Node.js agent). Employees only need a web browser. A dedicated Windows VM or automation bot executes the queue.

---

### Part A: Architecture & Component Roles

```
[50+ Employee Laptops]
 └── Open Chrome: http://automation-hub.company.com:5173
 └── Upload SAP_Daily_Input.xlsx & click "Run"
        │
        ▼
[Central Web Hub & Database]
 ├── Stores uploaded files in /storage/uploads
 ├── Enqueues job in Redis Queue
 └── BullMQ Queue Worker
        │
        ▼  (HTTP POST /execute/sap-daily-tracker)
[Dedicated SAP Automation Bot (Windows VM with SAP GUI)]
 ├── Active Windows user session with SAP GUI open
 ├── Windows Worker Agent (Port 9000)
 └── Executes VBScript + Python -> Returns RUN_REPORT.xlsx
```

---

### Part B: Dedicated SAP Bot VM Setup

1. On the dedicated Windows VM/Server:
   * Keep an active Windows session logged in.
   * Open SAP GUI with transaction `ZSCH_UPDATE` loaded under the automation service account.
   * Place `windows-agent` on `C:\AutomationHub\windows-agent`.
   * Run `npm start` (or configure it as a Windows Service / Scheduled Task on boot).
   * Note the VM's static IP address (e.g., `172.20.10.200`).
2. Allow incoming port 9000 in Windows Firewall on the bot VM:
   ```powershell
   New-NetFirewallRule -DisplayName "SAP Agent Port 9000" -Direction Inbound -LocalPort 9000 -Protocol TCP -Action Allow
   ```
3. In `server/.env` on the Central Server:
   ```env
   WINDOWS_WORKER_URL=http://172.20.10.200:9000
   WINDOWS_WORKER_TOKEN=shared-secret-change-me
   ```

---

### Part C: Employee Workflow in Approach 2

1. Employee opens `http://172.20.10.3:5173` on any laptop, Mac, or tablet.
2. Selects **"☁️ Central Worker Queue"**.
3. Uploads `SAP_Daily_Input.xlsx` and clicks **Run Automation**.
4. The Central BullMQ worker sends the job to the dedicated SAP Bot VM.
5. Once completed, the employee downloads the output report directly from **Job History**.

---

# 📊 Comparison Matrix

| Feature | Approach 1 (Distributed Local Agent) | Approach 2 (Central Dedicated Bot) |
| :--- | :--- | :--- |
| **SAP User Context** | Each employee uses their own SAP login | Shared SAP automation service account |
| **SAP Screen Visibility** | Employee sees their own SAP screen update | Headless on dedicated VM |
| **Software on Employee Laptop** | Lightweight agent + Python `openpyxl` | **Zero** (Only Web Browser) |
| **Concurrent SAP Capacity** | **Unlimited** (each employee runs on their PC) | Limited to number of dedicated SAP VMs |
| **Network Configuration** | Communicates with `localhost:9000` | Central server dispatches to VM IP |
| **Central Audit & Reporting** | Synced to Central PostgreSQL DB | Synced to Central PostgreSQL DB |

---

# 🔧 Common Troubleshooting & FAQ

### 1. `Cannot connect to Windows Worker Agent at http://localhost:9000`
* **Cause**: `start-agent.bat` is not running on the local laptop.
* **Fix**: Double-click `start-agent.bat` in your `windows-agent` folder.

### 2. `SAP GUI not running. Open SAP and go to ZSCH_UPDATE first.`
* **Cause**: SAP GUI is not open or transaction `ZSCH_UPDATE` is not loaded.
* **Fix**: Open SAP GUI, log in, navigate to `ZSCH_UPDATE`, execute the selection to show the ALV grid, then run the automation.

### 3. `Scripting is disabled for this system`
* **Cause**: SAP GUI scripting is disabled in SAP GUI settings or backend RZ11.
* **Fix**: In SAP GUI Options → Accessibility & Scripting → Scripting → Check **"Enable scripting"**.
