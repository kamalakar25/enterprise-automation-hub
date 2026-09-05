@echo off
REM ===========================================================================
REM  SAP Windows Worker Agent - Quick Start
REM ===========================================================================
REM  Run this on the Windows VM that has SAP GUI installed.
REM  Requires Node.js 18+ installed on the Windows machine.
REM ===========================================================================

chcp 65001 >nul
title SAP Automation Windows Worker Agent

cd /d "%~dp0"

if not exist node_modules (
    echo [SETUP] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

if not exist .env (
    echo [SETUP] Creating .env from template...
    copy .env.example .env
    echo.
    echo [ACTION REQUIRED] Edit .env and set:
    echo   - WORKER_TOKEN   (must match central server's WINDOWS_WORKER_TOKEN)
    echo   - SCRIPTS_DIR    (folder containing your VBS + Python engine)
    echo   - WORK_DIR       (folder for per-run temp data)
    echo.
    notepad .env
    echo.
    echo After saving .env, run this script again.
    pause
    exit /b 0
)

echo [START] Starting SAP Windows Worker Agent...
echo.
call npm start

echo.
echo Agent stopped. Press any key to exit.
pause
