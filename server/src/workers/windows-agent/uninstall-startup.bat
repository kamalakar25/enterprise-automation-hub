@echo off
chcp 65001 >nul
title Remove Silent Auto-Start for SAP Agent

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_FILE=%STARTUP_DIR%\SAP_Agent_Silent.lnk"

echo ============================================================
echo  Removing Auto-Start for SAP Agent
echo ============================================================

:: 1. Remove files from Startup folder
if exist "%STARTUP_DIR%\Start_SAP_Agent.vbs" (
    del /f /q "%STARTUP_DIR%\Start_SAP_Agent.vbs"
    echo [OK] Removed Start_SAP_Agent.vbs from shell:startup.
)
if exist "%SHORTCUT_FILE%" (
    del /f /q "%SHORTCUT_FILE%"
    echo [OK] Removed startup shortcut.
)
if exist "%STARTUP_DIR%\SAP_Agent_Silent.vbs" (
    del /f /q "%STARTUP_DIR%\SAP_Agent_Silent.vbs"
    echo [OK] Removed old startup script.
)

:: 2. Remove from Registry Run key
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "SAPAutomationAgent" /f >nul 2>&1
echo [OK] Removed registry auto-run entry.

:: 3. Stop running agent process if any
echo.
echo Stopping any running agent.py processes...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*agent.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Stopped Process ID ' + $_.ProcessId) -ForegroundColor Green }"

echo.
echo ============================================================
echo [DONE] Auto-start has been completely removed.
echo ============================================================
echo.
pause
