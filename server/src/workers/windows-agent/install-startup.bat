@echo off
chcp 65001 >nul
title Setup Auto-Start for SAP Agent
cd /d "%~dp0"

set "AGENT_DIR=%~dp0"
if "%AGENT_DIR:~-1%"=="\" set "AGENT_DIR=%AGENT_DIR:~0,-1%"

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_VBS=%STARTUP_DIR%\Start_SAP_Agent.vbs"

echo ============================================================
echo  Setting Up Silent Auto-Start in shell:startup
echo ============================================================
echo Agent Folder   : "%AGENT_DIR%"
echo Startup Folder : "%STARTUP_DIR%"
echo.

:: 1. Check Python
where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python 3 is not installed or not in PATH.
    echo Please install Python from https://www.python.org/downloads/
    pause
    exit /b 1
)

:: 2. Check openpyxl
python -c "import openpyxl" >nul 2>&1
if errorlevel 1 (
    echo [SETUP] Installing openpyxl library...
    pip install openpyxl
)

:: 3. Clean up previous startup files
if exist "%STARTUP_DIR%\SAP_Agent_Silent.vbs" del /f /q "%STARTUP_DIR%\SAP_Agent_Silent.vbs" >nul 2>&1
if exist "%STARTUP_DIR%\SAP_Agent_Silent.lnk" del /f /q "%STARTUP_DIR%\SAP_Agent_Silent.lnk" >nul 2>&1
if exist "%STARTUP_DIR%\Start_SAP_Agent.bat" del /f /q "%STARTUP_DIR%\Start_SAP_Agent.bat" >nul 2>&1

:: 4. Create Start_SAP_Agent.vbs inside shell:startup
powershell -NoProfile -Command "$agentPath = $env:AGENT_DIR; $startupPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\Start_SAP_Agent.vbs'; $lines = @('Set WshShell = CreateObject(\"WScript.Shell\")', ('WshShell.CurrentDirectory = \"' + $agentPath + '\"'), 'WshShell.Run \"cmd.exe /c python agent.py\", 0, False'); Set-Content -Path $startupPath -Value $lines -Encoding ASCII; Write-Host ('[OK] Created startup launcher: ' + $startupPath)"

echo.
echo [1/2] Startup script created successfully!

:: 5. Launch agent in background now
echo [2/2] Starting background agent...
wscript "%STARTUP_VBS%"

ping 127.0.0.1 -n 3 >nul

powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://localhost:9000/health' -TimeoutSec 3; Write-Host '[ONLINE] Agent is active on http://localhost:9000' -ForegroundColor Green } catch { Write-Host '[NOTICE] Agent started in background. Check http://localhost:9000/health in browser.' -ForegroundColor Yellow }"

echo.
echo ============================================================
echo [SUCCESS] Auto-start is now configured!
echo.
echo Whenever this laptop turns on, Windows shell:startup will
echo automatically launch the Python agent in the background.
echo The user will NOT see any black command prompt window.
echo ============================================================
echo.
pause
