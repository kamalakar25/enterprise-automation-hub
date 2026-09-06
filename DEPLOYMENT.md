# Enterprise Automation Hub — Production Deployment Guide

This guide covers production deployment options for **Enterprise Automation Hub** (Central Server, Background Queue Worker, Frontend UI, and Windows SAP Execution Worker).

---

## Architecture Overview

```
                          ┌───────────────────────────┐
                          │   Browser (Users / Admins)│
                          └─────────────┬─────────────┘
                                        │ HTTP / WS
                                        ▼
                          ┌───────────────────────────┐
                          │   Frontend Nginx (Port 80)│
                          └─────────────┬─────────────┘
                                        │ Proxy /api, /socket.io
                                        ▼
     ┌──────────────────────────────────────────────────────────────────┐
     │ Central Platform (Docker / Linux VM / Cloud)                     │
     │                                                                  │
     │   ┌──────────────────────────┐    ┌──────────────────────────┐   │
     │   │   Node.js API Server     │    │   BullMQ Queue Worker    │   │
     │   │   (Port 4000)            │    │   (Background Jobs)      │   │
     │   └────────────┬─────────────┘    └────────────┬─────────────┘   │
     │                │                               │                 │
     │                ├───────────────┬───────────────┤                 │
     │                ▼               ▼               ▼                 │
     │       ┌─────────────────┐ ┌─────────┐ ┌─────────────────┐        │
     │       │ PostgreSQL 14+  │ │  Redis  │ │ Persistent Disk │        │
     │       │ (Data & Auth)   │ │ (Queue) │ │(Uploads/Reports)│        │
     │       └─────────────────┘ └─────────┘ └─────────────────┘        │
     └──────────────────────────────────┬───────────────────────────────┘
                                        │ HTTP Stream (Bearer Token)
                                        ▼
                     ┌────────────────────────────────────┐
                     │ Windows Worker VM (SAP GUI & VBS)  │
                     │  - SAP GUI Scripting Engine        │
                     │  - Node.js Agent (Port 9000)       │
                     └────────────────────────────────────┘
```

---

## Option 1: Docker Compose (Recommended for Single Server / VPS)

### 1. Prerequisites
- Docker Engine & Docker Compose (`docker compose version` >= 2.0)
- Domain or Static IP pointing to the server

### 2. Setup Environment
Create a `.env` in the project root on the production server:
```bash
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_super_strong_postgres_password
POSTGRES_DB=automation_hub

JWT_SECRET=generate_a_64_char_random_secret_string
WINDOWS_WORKER_URL=http://<windows_vm_ip>:9000
WINDOWS_WORKER_TOKEN=your_secure_shared_worker_token

PORT=80
CORS_ORIGIN=http://your-domain.com
```

### 3. Deploy
```bash
# Build and start all services in the background
docker compose -f docker-compose.prod.yml up -d --build

# View logs
docker compose -f docker-compose.prod.yml logs -f
```

All 5 containers (`postgres`, `redis`, `api`, `worker`, `client`) will launch with persistent volumes for data and reports. Database migrations are applied automatically on startup.

---

## Option 2: Linux VM with PM2 & Nginx (Bare Metal / AWS EC2 / DigitalOcean)

### 1. Install System Packages
```bash
sudo apt update && sudo apt install -y nodejs npm postgresql redis-server nginx python3 python3-pip
sudo npm install -g pm2
```

### 2. Configure Database & Redis
```bash
sudo -u postgres psql -c "CREATE USER hub_user WITH PASSWORD 'StrongPassword123';"
sudo -u postgres psql -c "CREATE DATABASE automation_hub OWNER hub_user;"
sudo systemctl enable --now redis-server
```

### 3. Setup Application
```bash
# Clone repository
git clone <your-github-repo-url> /opt/automation-hub
cd /opt/automation-hub

# Server setup
cd server
cp .env.example .env
# Edit .env with your real DATABASE_URL, JWT_SECRET, and REDIS credentials
npm ci
npx prisma generate
npx prisma migrate deploy
npm run db:seed

# Client build
cd ../client
npm ci
npm run build
```

### 4. Start Backend Services with PM2
```bash
cd /opt/automation-hub
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### 5. Configure Nginx
Create `/etc/nginx/sites-available/automation-hub`:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /opt/automation-hub/client/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 100M;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```
Enable and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/automation-hub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## Windows SAP Worker Node Setup

The Windows Worker Agent executes SAP GUI VBScripts and Python transformation tasks on a Windows VM:

1. **Install Node.js 18+ and Python 3** on the Windows machine.
2. Copy `server/src/workers/windows-agent` to `C:\AutomationHub\worker`.
3. In `C:\AutomationHub\worker\.env`:
   ```env
   PORT=9000
   WORKER_TOKEN=your_secure_shared_worker_token
   SCRIPTS_DIR=C:\AutomationHub\scripts
   WORK_DIR=C:\AutomationHub\runs
   ```
4. Install dependencies and start:
   ```cmd
   cd C:\AutomationHub\worker
   npm install
   npm start
   ```
5. Configure Windows Firewall to permit inbound traffic on port `9000` from the Central Server IP.

---

## Security Checklist Before Production

- [ ] Changed `JWT_SECRET` to a high-entropy 64+ character string.
- [ ] Changed default database passwords.
- [ ] Changed default admin password from `admin123`.
- [ ] Set `WINDOWS_WORKER_TOKEN` to a secret shared between Central Server and Windows Worker.
- [ ] Enabled HTTPS / SSL certificates (e.g. `certbot --nginx` on Nginx or via Cloudflare).
