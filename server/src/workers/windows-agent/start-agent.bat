@echo off
REM ===========================================================================
REM  SAP Windows Worker Agent (Pure Python Edition - No Node.js Required)
REM ===========================================================================
REM  Requires Python 3 (with openpyxl) installed on this Windows laptop.
REM ===========================================================================

chcp 65001 >nul
title SAP Windows Worker Agent (Port 9000)

cd /d "%~dp0"

echo [1/2] Checking Python environment...
where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python 3 is not installed or not in PATH.
    echo Please install Python from https://www.python.org/downloads/
    pause
    exit /b 1
)

python -c "import openpyxl" >nul 2>&1
if errorlevel 1 (
    echo [SETUP] Installing openpyxl library...
    pip install openpyxl
    if errorlevel 1 (
        echo [ERROR] Failed to install openpyxl.
        pause
        exit /b 1
    )
)

echo [2/2] Starting SAP Windows Worker Agent on port 9000...
echo.
python agent.py

echo.
echo Agent stopped. Press any key to exit.
pause
