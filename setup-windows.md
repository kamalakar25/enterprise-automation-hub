# Windows Setup Guide (PowerShell)

Follow these steps **in order** to get everything running on Windows.

## 1. Prerequisites you must install first

| Tool            | Download                                                                    | Verify install             |
| --------------- | --------------------------------------------------------------------------- | -------------------------- |
| Node.js 18+ LTS | https://nodejs.org/                                                         | `node --version`         |
| PostgreSQL 14+  | https://www.postgresql.org/download/windows/                                | `psql --version`         |
| Redis (Windows) | Use Memurai (https://www.memurai.com/)**or** run Redis in WSL2/Docker | `redis-cli ping` → PONG |
| Python 3        | https://www.python.org/downloads/windows/                                   | `python --version`       |
| Git             | https://git-scm.com/                                                        | `git --version`          |

> **Redis note on Windows:** Native Redis for Windows is outdated. The easiest options are:
>
> - Install **Memurai** (native Windows port, developer edition is free)
> - Or install **Docker Desktop** and run `docker run -p 6379:6379 redis:7-alpine`
> - Or install WSL2 + Ubuntu, then `sudo apt install redis-server`

### During PostgreSQL install:

- Remember the password you set for the `postgres` superuser. You'll need it in step 3.
- Keep the default port `5432`.

## 2. Create the database

Open **pgAdmin** (installed with PostgreSQL) or PowerShell:

```powershell
# Using psql (replace 'your_postgres_password' with whatever you set during install)
psql -U postgres -h localhost
# Then at the postgres=# prompt:
CREATE DATABASE automation_hub;
\q
```

## 3. Configure `.env`

The `.env` file is already created. **Edit it if your PostgreSQL password isn't `postgres`:**

Open `server\.env` in Notepad/VS Code and update the `DATABASE_URL` line:

```
DATABASE_URL="postgresql://postgres:YOUR_REAL_PASSWORD@localhost:5432/automation_hub?schema=public"
```

If your Redis uses a password or different port, update `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` too.

## 4. Install dependencies & initialize DB

Open PowerShell in the project folder and run these **one time**:

```powershell
cd server

npm install
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
```

You should see:

```
✅ Seeding complete.
   Admin user: admin@company.com / admin123
   Operator user: operator@company.com / operator123
```

## 5. Install frontend dependencies

```powershell
cd ..\client
npm install
```

## 6. Run all 3 processes (open 3 separate PowerShell windows)

### Window A — Make sure Redis is running

```powershell
# If using Memurai, it starts as a Windows Service automatically.
# If using Docker:
docker run -p 6379:6379 redis:7-alpine
```

### Window B — API server

```powershell
cd server
npm run dev
# → Server running on http://localhost:4000
```

### Window C — Worker (processes background jobs)

```powershell
cd server
npm run worker
```

### Window D — Frontend

```powershell
cd client
npm run dev
# → Open http://localhost:5173
```

## 7. Log in

- Admin: **admin@company.com** / **admin123**
- Operator: **operator@company.com** / **operator123**

---

## Troubleshooting

### `Environment variable not found: DATABASE_URL`

You don't have a `.env` file. Make sure `server\.env` exists (not just `.env.example`).

### `Can't reach database server at localhost:5432`

PostgreSQL isn't running. Open Services (`services.msc`) and start the "postgresql-x64-XX" service.

### `ECONNREFUSED 127.0.0.1:6379`

Redis/Memurai isn't running. Start it from Services or Docker.

### `password authentication failed for user "postgres"`

Your PostgreSQL password doesn't match what's in `DATABASE_URL`. Edit `server\.env` and put the correct password after the second colon: `postgresql://postgres:REAL_PASSWORD@localhost...`

### `psql is not recognized`

PostgreSQL binaries aren't in your PATH. Use pgAdmin instead (it's in your Start Menu), or add `C:\Program Files\PostgreSQL\16\bin` (adjust version) to PATH.
