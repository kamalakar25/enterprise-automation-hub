@echo off
title Enterprise Automation Hub - Launcher
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================================
echo   Starting Enterprise Automation Hub (All Services)
echo ========================================================
echo.

:: 1. Ensure Redis is running via Docker
echo [1/5] Checking Redis...
docker compose up -d redis >nul 2>&1

:: 2. Start Windows Execution Agent (Port 9000)
echo [2/5] Starting Windows Execution Worker Agent (Port 9000)...
start "Automation Hub - Windows Agent (9000)" cmd /k "cd /d ""%~dp0server"" && npm run agent"

:: 3. Start BullMQ Background Queue Worker
echo [3/5] Starting Queue Worker...
start "Automation Hub - Queue Worker" cmd /k "cd /d ""%~dp0server"" && npm run worker"

:: 4. Start Central API Server (Port 4000)
echo [4/5] Starting Central API Server (Port 4000)...
start "Automation Hub - API Server (4000)" cmd /k "cd /d ""%~dp0server"" && npm run dev"

:: 5. Start Frontend UI (Port 5173)
echo [5/5] Starting Frontend Client (Port 5173)...
start "Automation Hub - Frontend Client (5173)" cmd /k "cd /d ""%~dp0client"" && npm run dev"

echo.
echo ========================================================
echo   All 4 services started in separate windows!
echo   Frontend UI : http://localhost:5173
echo   Network UI  : http://172.20.10.3:5173
echo ========================================================
echo.
pause
