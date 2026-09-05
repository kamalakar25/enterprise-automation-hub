# Enterprise Automation Hub

A centralized web portal for internal enterprise automations — SAP tracking, procurement analysis, bulk vendor emailing, and any future Python/VBScript workflows — built from the architecture blueprint.

## Architecture

```
┌──────────────┐    HTTPS + Socket.io   ┌──────────────────┐    Redis Queue    ┌──────────────────┐
│  React SPA   │ ◄────────────────────► │  Express API     │ ───────────────► │  BullMQ Workers  │
│  (Vite)      │                        │  + Socket.io     │                  │  (Python/VBS)    │
└──────────────┘                        └────────┬─────────┘                  └────────┬─────────┘
                                                 │                                     │
                                                 ▼                                     ▼
                                        ┌──────────────────┐                  ┌──────────────────┐
                                        │  PostgreSQL      │                  │ Windows Worker   │
                                        │  (Prisma ORM)    │                  │ (SAP GUI VBS)    │
                                        └──────────────────┘                  └──────────────────┘
```

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, Tailwind CSS, React Router, TanStack Query, Zustand, Socket.io-client, Recharts, react-hot-toast |
| Backend | Node.js + Express, Socket.io, BullMQ, Prisma/PostgreSQL, JWT auth, Zod, Multer, Winston |
| Queue | Redis + BullMQ (retries, exponential backoff, cron scheduling) |
| Workers | child_process for Python, HTTP bridge to Windows SAP GUI agent |
| Security | Helmet, CORS, rate-limit, bcrypt, RBAC, audit logs |

## Project Structure

```
enterprise-automation-hub/
├── client/                  # React frontend
│   └── src/
│       ├── components/      # Layout, shared UI
│       ├── pages/           # Login, Dashboard, Modules, Job Runner, History, Schedules, Admin
│       ├── lib/             # API client, socket client
│       └── store/           # Zustand/auth context
└── server/
    ├── prisma/              # Schema + seed
    └── src/
        ├── config/          # Logger, Redis, Prisma
        ├── middleware/      # Auth, RBAC, audit
        ├── queue/           # BullMQ queue + event bus
        ├── routes/          # auth, modules, jobs, files, users, schedules, audit
        ├── workers/         # Worker processor, sample Python scripts
        └── server.js        # Express + Socket.io entrypoint
```

## Quick Start (Local Dev)

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 7+
- Python 3 (for headless Python workers)

### 1. Install dependencies

```bash
# Server
cd server
cp .env.example .env       # edit DB/Redis credentials
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed

# Client
cd ../client
npm install
```

### 2. Start services (3 terminals)

```bash
# Terminal A — Redis (via Docker)
docker run -p 6379:6379 redis:7-alpine

# Terminal B — Server API
cd server && npm run dev           # http://localhost:4000

# Terminal C — Worker process
cd server && npm run worker

# Terminal D — Frontend
cd client && npm run dev           # http://localhost:5173
```

### 3. Log in
- Admin: `admin@company.com` / `admin123`
- Operator: `operator@company.com` / `operator123`

## Available Modules (seeded)

| Module | Execution | Description |
|---|---|---|
| SAP Daily Tracker | `WINDOWS_VBS` | PO / Release batch updates via Windows SAP GUI worker |
| ZPRS Pending Tracker | `WINDOWS_VBS` | ZPRS priority tracking & SAP push |
| SAP ME2M Procurement Analyzer | `PYTHON_HEADLESS` | 90-day procurement analysis (sample Python worker included) |
| Bulk Vendor Email Dispatcher | `PYTHON_HEADLESS` | SMTP bulk email with templating (sample worker included) |

## Adding a New Automation

1. Add a row to the `AutomationModule` table (or POST `/api/modules` as admin).
2. Drop a Python script in `server/src/workers/scripts/python/<slug>.py` accepting `--params` and `--input`.
3. For VBS/SAP GUI automations, deploy the companion Windows Worker Agent (HTTP micro-service) on a VM with SAP GUI installed and set `WINDOWS_WORKER_URL`.
4. The module appears in the web UI automatically — users with appropriate roles can launch it, watch live logs, and download output reports.

## Windows Worker Agent (SAP GUI / VBS)

For VBScript automations (SAP Daily Tracker, ZPRS), the central server dispatches jobs to a remote **Windows Worker Agent** running on a VM with SAP GUI installed. The agent is a small Express server that:

1. Accepts multipart upload (XLSX) + parameters (PERNR, CUMMODE, runMode)
2. Creates per-run working directories
3. Orchestrates the full 5-stage pipeline (VBS export-sap → Python reconcile → Python validate-export → VBS update → Python apply-status)
4. Streams every line of console output back to the central server in real time (NDJSON)
5. Returns the updated `SAP_Daily_Input.xlsx` + `SAP_Daily_Input_RUN_REPORT.xlsx`

See **`server/src/workers/windows-agent-sample/SETUP.md`** for full deployment instructions. A `start-agent.bat` launcher is included.

### Deploying the Windows Agent

1. Copy `server/src/workers/windows-agent-sample/` to the Windows VM (e.g. `C:\AutomationHub\agent\`)
2. Place your production scripts (`SAP_Daily_Updater_v5_LO.vbs` + `update_excel_structure.py`) in a scripts folder
3. Run `npm install`, create `.env` from `.env.example`, set `WORKER_TOKEN` + `SCRIPTS_DIR`
4. `npm start` → agent listens on port 9000
5. Set `WINDOWS_WORKER_URL` + `WINDOWS_WORKER_TOKEN` in the central server's `.env`
6. Restart the API and worker processes

## Available Modules (seeded)

| Module | Execution | Inputs |
|---|---|---|
| SAP Daily Tracker | `WINDOWS_VBS` | XLSX upload + PERNR (6 digits) + CUMMODE (EMAIL/PHONE/VISIT/SANYOG) + Run Mode (DRY_RUN/LIVE/RETRY_FAILED) |
| ZPRS Pending Tracker | `WINDOWS_VBS` | XLSX upload + PERNR + CUMMODE (agent endpoint ready once VBS is added) |
| SAP ME2M Procurement Analyzer | `PYTHON_HEADLESS` | ME2M CSV/XLSX + horizon days (sample worker included) |
| Bulk Vendor Email Dispatcher | `PYTHON_HEADLESS` | Recipient list XLSX + email subject/body template with placeholders |
