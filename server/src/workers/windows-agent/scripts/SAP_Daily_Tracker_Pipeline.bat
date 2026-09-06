@echo off
setlocal EnableDelayedExpansion

:: ---------------------------------------------------------------------------------
:: CONSOLE DESIGN SETUP (UTF-8, 110 Cols, 32 Lines)
:: ---------------------------------------------------------------------------------
chcp 65001 >nul
mode con: cols=110 lines=32
title SAP Daily Tracker Pipeline Gateway v5.0

:: Force enable Virtual Terminal Processing (ANSI Escape Codes)
reg add "HKCU\Console" /v VirtualTerminalLevel /t REG_DWORD /d 1 /f >nul 2>&1

:: Get ESC Character
for /f "delims=" %%A in ('powershell -NoProfile -Command "[char]27"') do set "ESC=%%A"

:: Style Codes
set "F_CYN=%ESC%[96m"
set "F_GRN=%ESC%[92m"
set "F_RED=%ESC%[91m"
set "F_YLW=%ESC%[93m"
set "F_MAG=%ESC%[95m"
set "F_WHT=%ESC%[97m"
set "F_DIM=%ESC%[90m"
set "E_RST=%ESC%[0m"
set "E_BLD=%ESC%[1m"
set "E_REV=%ESC%[7m"

:: Clean UI Borders (ASCII based to prevent CMD UTF-8 parser pointer offset bugs)
set "BORDER_TOP=+-------------------------------------------------------------------------------------------------+"
set "BORDER_MID=+-------------------------------------------------------------------------------------------------+"
set "BORDER_BOT=+-------------------------------------------------------------------------------------------------+"

:: =================================================================================
:: PATH INITIALIZATION
:: =================================================================================
set BASE=%~dp0
if "%BASE:~-1%"=="\" set BASE=%BASE:~0,-1%
set XLSX=%BASE%\SAP_Daily_Input.xlsx
set VBS=%BASE%\SAP_Daily_Updater_v5_LO.vbs
set PY=%BASE%\update_excel_structure.py
set WORKLIST=%BASE%\SAP_Daily_Input_WORKLIST.csv
set STATUSCSV=%BASE%\SAP_Daily_Input_STATUS.csv
set MATCHCSV=%BASE%\SAP_Daily_Input_MATCH_REPORT.csv
set SAPSNAPSHOT=%BASE%\SAP_Daily_Input_SAP_SNAPSHOT.csv
set REPORTXLSX=%BASE%\SAP_Daily_Input_RUN_REPORT.xlsx
set LOGDIR=%BASE%\Logs

:: Initialize Logging Directory
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1

:: Generate Run ID
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set TSTAMP=%%I
set RUNID=%TSTAMP%
set SESSIONLOG=%LOGDIR%\SAP_Session_%RUNID%.log

:: ---------------------------------------------------------------------------------
:: STEP 0: DIAGNOSTICS & PRE-FLIGHT INTEGRITY CHECKS
:: ---------------------------------------------------------------------------------
cls
echo.
echo %F_CYN%%BORDER_TOP%%E_RST%
echo %F_CYN%^|                     %E_BLD%S A P   D A I L Y   T R A C K E R   P I P E L I N E   v5.0%E_RST%                     %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_MID%%E_RST%
echo %F_CYN%^|%E_RST%  Executing Pre-flight Environment Diagnostics...                                                 %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%

:: Check Excel Master
if exist "%XLSX%" (
    echo %F_CYN%^|%E_RST%    %F_GRN%[ OK ]%E_RST% Master Excel Ledger found: %F_DIM%%XLSX%%E_RST%
) else (
    echo %F_CYN%^|%E_RST%    %F_RED%[FAIL]%E_RST% Master Excel Ledger missing: %F_DIM%%XLSX%%E_RST%
    set "FAULT=1"
)

:: Check VBS Controller
if exist "%VBS%" (
    echo %F_CYN%^|%E_RST%    %F_GRN%[ OK ]%E_RST% SAP Controller VBS found:  %F_DIM%%VBS%%E_RST%
) else (
    echo %F_CYN%^|%E_RST%    %F_RED%[FAIL]%E_RST% SAP Controller VBS missing:  %F_DIM%%VBS%%E_RST%
    set "FAULT=1"
)

:: Check Python Engine
if exist "%PY%" (
    echo %F_CYN%^|%E_RST%    %F_GRN%[ OK ]%E_RST% Structure Helper Script:   %F_DIM%%PY%%E_RST%
) else (
    echo %F_CYN%^|%E_RST%    %F_RED%[FAIL]%E_RST% Structure Helper missing:   %F_DIM%%PY%%E_RST%
    set "FAULT=1"
)

echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
if "%FAULT%"=="1" (
    echo %F_CYN%^|%E_RST%  %F_RED%[!] CRITICAL FAULT DETECTED: Core system components are missing.%E_RST%                           %F_CYN%^|%E_RST%
    echo %F_CYN%%BORDER_BOT%%E_RST%
    echo.
    powershell -NoProfile -Command "[Console]::Beep(880, 400)" >nul 2>&1
    goto :FAIL
)

echo %F_CYN%^|%E_RST%  %F_GRN%[+] Environment verification complete. Core components online.%E_RST%                              %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_BOT%%E_RST%
echo.
echo   Press any key to establish pipeline gateway...
pause >nul

:: ---------------------------------------------------------------------------------
:: RUN TYPE MENU SELECTION
:: ---------------------------------------------------------------------------------
:MENU_RUN_TYPE
cls
echo.
echo %F_CYN%%BORDER_TOP%%E_RST%
echo %F_CYN%^|                     %E_BLD%S A P   D A I L Y   T R A C K E R   P I P E L I N E   v5.0%E_RST%                     %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_MID%%E_RST%
echo %F_CYN%^|%E_RST%  Select Ingestion / Update Profile:                                                               %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    %E_BLD%[1] SAFE DRY-RUN%E_RST%      - Preflight checks, data validation, grid matching. (NO WRITE)       %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    %E_BLD%[2] LIVE UPDATE%E_RST%       - Full production run. Validates and pushes pending data to SAP.     %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    %E_BLD%[3] RETRIAGE FAILED%E_RST%    - Focuses solely on previously failed or validation-errored rows.    %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    %E_BLD%[4] PROFILE COLUMNS%E_RST%    - Scans and profiles SAP table column names into discovery report.   %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_BOT%%E_RST%
echo.
choice /c 1234 /n /m "  Enter option [1-4]: "
set TASKCHOICE=%ERRORLEVEL%

if "%TASKCHOICE%"=="1" (
    set "RERUNMODE=ALL"
    set "DRYRUN=YES"
    set "VBSARGS=--dry-run"
    set "TASK_DESC=SAFE DRY-RUN"
)
if "%TASKCHOICE%"=="2" (
    set "RERUNMODE=ALL"
    set "DRYRUN=NO"
    set "VBSARGS="
    set "TASK_DESC=LIVE PRODUCTION RUN"
)
if "%TASKCHOICE%"=="3" (
    set "RERUNMODE=FAILED"
    set "DRYRUN=NO"
    set "VBSARGS="
    set "TASK_DESC=RETRIAGE FAILED RECORDS"
)
if "%TASKCHOICE%"=="4" (
    set "TASK_DESC=SAP COLUMN DISCOVERY"
    goto :DISCOVER_ONLY
)

:: ---------------------------------------------------------------------------------
:: PARAMETER COLLECTION: EMPLOYEE ID (PERNR)
:: ---------------------------------------------------------------------------------
:ASK_PERNR
cls
echo.
echo %F_CYN%%BORDER_TOP%%E_RST%
echo %F_CYN%^|                         %E_BLD%OPERATOR IDENTITY VALIDATION (PERNR)%E_RST%                                  %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_MID%%E_RST%
echo %F_CYN%^|%E_RST%  Operator identification is required for auditing transactions.                                   %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    Instructions:                                                                                %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    - Enter your 6-digit SAP Employee ID (PERNR).                                                %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    - ID must contain exactly 6 numeric digits (e.g. 104523).                                    %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_BOT%%E_RST%
echo.
set "RUN_PERNR="
set /p RUN_PERNR=  %F_MAG%PERNR Code:%E_RST% 
echo %RUN_PERNR%| findstr /r "^[0-9][0-9][0-9][0-9][0-9][0-9]$" >nul
if errorlevel 1 (
    powershell -NoProfile -Command "[Console]::Beep(800, 150)" >nul 2>&1
    cls
    echo.
    echo %F_RED%%BORDER_TOP%%E_RST%
    echo %F_RED%^|                               %E_BLD%[!] IDENTITY EXCLUSION ALERT%E_RST%                                    %F_RED%^|%E_RST%
    echo %F_RED%%BORDER_MID%%E_RST%
    echo %F_RED%^|%E_RST%  The Employee ID entered is invalid.                                                           %F_RED%^|%E_RST%
    echo %F_RED%^|%E_RST%  Expected format: Exactly 6 digits. You entered: "%RUN_PERNR%"                                      %F_RED%^|%E_RST%
    echo %F_RED%%BORDER_BOT%%E_RST%
    echo.
    echo   Press any key to retry authentication...
    pause >nul
    goto :ASK_PERNR
)

:: ---------------------------------------------------------------------------------
:: PARAMETER COLLECTION: COMMUNICATION MODE
:: ---------------------------------------------------------------------------------
:ASK_CUMMODE
cls
echo.
echo %F_CYN%%BORDER_TOP%%E_RST%
echo %F_CYN%^|                       %E_BLD%COMMUNICATION CHANNELS MATRIX (CUMMODE)%E_RST%                                %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_MID%%E_RST%
echo %F_CYN%^|%E_RST%  Select the dispatch/contact channel used for these transactions:                                %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    [1] EMAIL                                                                                        %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    [2] PHONE                                                                                        %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    [3] VISIT                                                                                        %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    [4] SANYOG                                                                                       %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_BOT%%E_RST%
echo.
choice /c 1234 /n /m "  Select Dispatch Mode [1-4]: "
set MODECHOICE=%ERRORLEVEL%

if "%MODECHOICE%"=="1" set "RUN_CUMMODE=EMAIL"
if "%MODECHOICE%"=="2" set "RUN_CUMMODE=PHONE"
if "%MODECHOICE%"=="3" set "RUN_CUMMODE=VISIT"
if "%MODECHOICE%"=="4" set "RUN_CUMMODE=SANYOG"

:: ---------------------------------------------------------------------------------
:: RUN PROFILE SUMMARY & CONFIRMATION
:: ---------------------------------------------------------------------------------
cls
echo.
echo %F_CYN%%BORDER_TOP%%E_RST%
echo %F_CYN%^|                           %E_BLD%SAP DATA TRANSACTION LAUNCH PROFILE%E_RST%                                %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_MID%%E_RST%
echo %F_CYN%^|%E_RST%  Review Ingestion parameters before establishing connection:                                        %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    - PIPELINE RUN ID : %F_WHT%%RUNID%%E_RST%                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    - TARGET MODE     : %F_WHT%%TASK_DESC%%E_RST%                                                          %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    - OPERATOR ID     : %F_WHT%%RUN_PERNR%%E_RST%                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    - DISPATCH CHANNEL: %F_WHT%%RUN_CUMMODE%%E_RST%                                                               %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    - SYSTEM LOGS     : %F_DIM%%SESSIONLOG%%E_RST%                                            %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%  Ensure that:                                                                                       %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%  [1] The master workbook %F_DIM%SAP_Daily_Input.xlsx%E_RST% is closed.                                      %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%  [2] SAP GUI is running, with target transaction %F_DIM%ZSCH_UPDATE%E_RST% loaded.                            %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_BOT%%E_RST%
echo.
choice /c YN /n /m "  Confirm pipeline launch [Y/N]? "
if errorlevel 2 (
    echo.
    echo   [CANCELLED] Operation aborted by operator request.
    goto :END
)

:: ---------------------------------------------------------------------------------
:: RUNTIME PIPELINE CONTROLLER
:: ---------------------------------------------------------------------------------
cls
echo.
echo %F_CYN%%BORDER_TOP%%E_RST%
echo %F_CYN%^|                               %E_BLD%PIPELINE TRANSACTION CONTROL ROOM%E_RST%                                 %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_MID%%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%

:: Step 0: SAP Snapshot Export
echo %F_CYN%^|%E_RST%  %F_YLW%[ ^> ]%E_RST% Step 0: Exporting active SAP grid snapshot...                                       %F_CYN%^|%E_RST%
if exist "%SAPSNAPSHOT%" del /q "%SAPSNAPSHOT%" >nul 2>&1
cscript //nologo "%VBS%" --export-sap --run-id=%RUNID% >nul 2>&1
set "SAPEXPORTCODE=%ERRORLEVEL%"
if %SAPEXPORTCODE% NEQ 0 (
    echo %F_CYN%^|%E_RST%  %F_RED%[ERR]%E_RST% Step 0: Snapshot extraction failed. Exit Code: %SAPEXPORTCODE%                           %F_CYN%^|%E_RST%
    echo %F_CYN%^|%E_RST%        Please check your SAP GUI connection and layout.                                     %F_CYN%^|%E_RST%
    goto :FAIL_PIPELINE
)
if not exist "%SAPSNAPSHOT%" (
    echo %F_CYN%^|%E_RST%  %F_RED%[ERR]%E_RST% Step 0: Snapshot CSV not created.                                                  %F_CYN%^|%E_RST%
    goto :FAIL_PIPELINE
)
echo %F_CYN%^|%E_RST%  %F_GRN%[PASS]%E_RST% Step 0: SAP Grid Snapshot successfully cached.                                     %F_CYN%^|%E_RST%

:: Step 0B: Reconcile Master XLSX
echo %F_CYN%^|%E_RST%  %F_YLW%[ ^> ]%E_RST% Step 0B: Reconciling cached SAP rows with Master Excel...                          %F_CYN%^|%E_RST%
python "%PY%" --mode reconcile-sap --xlsx "%XLSX%" --sap-snapshot "%SAPSNAPSHOT%" --run-id "%RUNID%" >nul 2>&1
set "RECONCILECODE=%ERRORLEVEL%"
if %RECONCILECODE% NEQ 0 (
    echo %F_CYN%^|%E_RST%  %F_RED%[ERR]%E_RST% Step 0B: Reconciliation failed. Exit Code: %RECONCILECODE%                                %F_CYN%^|%E_RST%
    goto :FAIL_PIPELINE
)
echo %F_CYN%^|%E_RST%  %F_GRN%[PASS]%E_RST% Step 0B: Reconciliation complete. Master Ledger synced.                          %F_CYN%^|%E_RST%

:: Step 1: Pre-flight Verification & Worklist Compile
echo %F_CYN%^|%E_RST%  %F_YLW%[ ^> ]%E_RST% Step 1: Pre-flight ledger validation and compiling worklist...                   %F_CYN%^|%E_RST%
python "%PY%" --mode validate-export --xlsx "%XLSX%" --worklist "%WORKLIST%" --pernr "%RUN_PERNR%" --cummode "%RUN_CUMMODE%" --run-id "%RUNID%" --rerun "%RERUNMODE%" --write-validation-errors >nul 2>&1
set "PYEXITCODE=%ERRORLEVEL%"
if %PYEXITCODE% NEQ 0 (
    echo %F_CYN%^|%E_RST%  %F_RED%[ERR]%E_RST% Step 1: Ledger pre-validation failed. Exit Code: %PYEXITCODE%                          %F_CYN%^|%E_RST%
    echo %F_CYN%%BORDER_BOT%%E_RST%
    echo.
    echo %F_RED%[!] ERROR: Validation failures occurred. Displaying first rows:%E_RST%
    python "%PY%" --mode validate-export --xlsx "%XLSX%" --worklist "%WORKLIST%" --pernr "%RUN_PERNR%" --cummode "%RUN_CUMMODE%" --run-id "%RUNID%" --rerun "%RERUNMODE%" --write-validation-errors
    goto :FAIL
)
echo %F_CYN%^|%E_RST%  %F_GRN%[PASS]%E_RST% Step 1: Ledger validation passed. Worklist compiled.                              %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_BOT%%E_RST%
echo.

:: Confirmation before transaction commit
choice /c YN /n /m "  Ingestion checks passed. Proceed to SAP Transaction update [Y/N]? "
if errorlevel 2 (
    echo.
    echo   [CANCELLED] Transaction halted. Workbook state untouched.
    goto :END
)

:: Step 2: SAP Update Session
cls
echo.
echo %F_CYN%%BORDER_TOP%%E_RST%
echo %F_CYN%^|                           %E_BLD%ACTIVE AUTOMATION ENGINE TRANSACTION FEED%E_RST%                            %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_MID%%E_RST%
echo.

if exist "%STATUSCSV%" del /q "%STATUSCSV%" >nul 2>&1
if exist "%MATCHCSV%" del /q "%MATCHCSV%" >nul 2>&1

:: Run VBScript and stream output in real-time, also piping to the session log
powershell -NoProfile -Command "cscript.exe //nologo '%VBS%' %VBSARGS% 2>&1 | Tee-Object -FilePath '%SESSIONLOG%'"
set "VBSEXITCODE=%ERRORLEVEL%"

echo.
echo %F_CYN%%BORDER_TOP%%E_RST%
echo %F_CYN%^|                         %E_BLD%POST-TRANSACTION DATA CONSOLIDATION%E_RST%                                    %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_MID%%E_RST%

if %VBSEXITCODE% NEQ 0 (
    echo %F_CYN%^|%E_RST%  %F_RED%[ERR]%E_RST% Step 2: SAP transaction engine exited with error code: %VBSEXITCODE%                 %F_CYN%^|%E_RST%
    echo %F_CYN%^|%E_RST%        Status reconciliation bypassed to preserve ledger safety.                            %F_CYN%^|%E_RST%
    goto :FAIL_PIPELINE
)

if not exist "%STATUSCSV%" (
    echo %F_CYN%^|%E_RST%  %F_RED%[ERR]%E_RST% Step 2: Transaction Status file not created: %F_DIM%%STATUSCSV%%E_RST%           %F_CYN%^|%E_RST%
    goto :FAIL_PIPELINE
)

:: Step 3: Apply Status back to Master
if "%DRYRUN%"=="YES" (
    echo %F_CYN%^|%E_RST%  %F_YLW%[DRY]%E_RST% Step 3: Simulating reports generation (Dry Run Mode)...                            %F_CYN%^|%E_RST%
    python "%PY%" --mode convert-reports --xlsx "%XLSX%" >nul 2>&1
    echo %F_CYN%^|%E_RST%  %F_GRN%[PASS]%E_RST% Step 3: Simulated reports successfully compiled.                               %F_CYN%^|%E_RST%
    set "RUN_STATE=DRY RUN COMPLETE"
) else (
    echo %F_CYN%^|%E_RST%  %F_YLW%[ ^> ]%E_RST% Step 3: Integrating transaction statuses back to Master Excel...                   %F_CYN%^|%E_RST%
    python "%PY%" --mode apply-status --xlsx "%XLSX%" --status-csv "%STATUSCSV%" >nul 2>&1
    set "APPLYEXITCODE=%ERRORLEVEL%"
    if !APPLYEXITCODE! NEQ 0 (
        echo %F_CYN%^|%E_RST%  %F_RED%[ERR]%E_RST% Step 3: Status integration failed. Exit Code: !APPLYEXITCODE!                     %F_CYN%^|%E_RST%
        goto :FAIL_PIPELINE
    )
    echo %F_CYN%^|%E_RST%  %F_GRN%[PASS]%E_RST% Step 3: Status codes successfully merged into Ledger columns Q/R/S.               %F_CYN%^|%E_RST%
    set "RUN_STATE=COMPLETED SUCCESSFULLY"
)

:: Clean up intermediate CSV/TXT files
if exist "%WORKLIST%" del /q "%WORKLIST%" >nul 2>&1
if exist "%STATUSCSV%" del /q "%STATUSCSV%" >nul 2>&1
if exist "%MATCHCSV%" del /q "%MATCHCSV%" >nul 2>&1
if exist "%BASE%\SAP_Daily_Input_VALIDATION_REPORT.csv" del /q "%BASE%\SAP_Daily_Input_VALIDATION_REPORT.csv" >nul 2>&1
if exist "%BASE%\SAP_Daily_Input_CHECKPOINT.txt" del /q "%BASE%\SAP_Daily_Input_CHECKPOINT.txt" >nul 2>&1

echo %F_CYN%%BORDER_BOT%%E_RST%
echo.
echo   Press any key to render the final report card...
pause >nul

:: ---------------------------------------------------------------------------------
:: PARSE SUMMARY STATS FROM LOGS
:: ---------------------------------------------------------------------------------
set "METRIC_TOTAL=0"
set "METRIC_DONE=0"
set "METRIC_SAPERR=0"
set "METRIC_VALERR=0"
set "METRIC_SKIP=0"
set "METRIC_PENDING=0"

if exist "%SESSIONLOG%" (
    for /f "tokens=1,2 delims=," %%A in ('findstr /c:"," "%SESSIONLOG%"') do (
        if "%%A"=="Total Records" set "METRIC_TOTAL=%%B"
        if "%%A"=="Updated Successfully" set "METRIC_DONE=%%B"
        if "%%A"=="SAP Errors" set "METRIC_SAPERR=%%B"
        if "%%A"=="Validation Errors" set "METRIC_VALERR=%%B"
        if "%%A"=="Skipped" set "METRIC_SKIP=%%B"
        if "%%A"=="Still Pending" set "METRIC_PENDING=%%B"
    )
)

:: ---------------------------------------------------------------------------------
:: METRIC DASHBOARD / REPORT CARD
:: ---------------------------------------------------------------------------------
:RESULT
cls
echo.
echo %F_CYN%%BORDER_TOP%%E_RST%
echo %F_CYN%^|                             %E_BLD%S A P   D A I L Y   P I P E L I N E   R E P O R T%E_RST%                           %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_MID%%E_RST%
if "%DRYRUN%"=="YES" (
    echo %F_CYN%^|%E_RST%  %F_YLW%[ STATUS: %RUN_STATE% ]%E_RST%                                                              %F_CYN%^|%E_RST%
) else (
    echo %F_CYN%^|%E_RST%  %F_GRN%[ STATUS: %RUN_STATE% ]%E_RST%                                                              %F_CYN%^|%E_RST%
)
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    Run ID             : %F_WHT%%RUNID%%E_RST%                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    Audit Session Log  : %F_DIM%%SESSIONLOG%%E_RST%                                           %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%  %E_BLD%[ TRANSACTION ENGINE QUANTITATIVE METRICS ]%E_RST%                                                 %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    - Ingested Records : %F_WHT%%METRIC_TOTAL%%E_RST%                                                                %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    - SAP Saves        : %F_GRN%%METRIC_DONE%%E_RST%                                                                %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    - SAP Failures     : %F_RED%%METRIC_SAPERR%%E_RST%                                                                %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    - Ledger Violations: %F_RED%%METRIC_VALERR%%E_RST%                                                                %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    - Skipped Rows     : %F_YLW%%METRIC_SKIP%%E_RST%                                                                %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    - Remaining/Pending: %F_YLW%%METRIC_PENDING%%E_RST%                                                             %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%  %E_BLD%[ EXPORTED CONSOLIDATED REPORT ]%E_RST%                                                            %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%    - Consolidated Run Report (Sheet-Wise):                                                    %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%      %F_DIM%%REPORTXLSX%%E_RST%                                                               %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%      Sheets: Worklist, Validation, Vendor Dashboard, Run Summary, Status, SAP Match             %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_BOT%%E_RST%
echo.
goto :END

:: ---------------------------------------------------------------------------------
:: DISCOVER COLUMNS SCREEN
:: ---------------------------------------------------------------------------------
:DISCOVER_ONLY
cls
echo.
echo %F_CYN%%BORDER_TOP%%E_RST%
echo %F_CYN%^|                     %E_BLD%S A P   D A I L Y   T R A C K E R   P I P E L I N E   v5.0%E_RST%                     %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_MID%%E_RST%
echo %F_CYN%^|%E_RST%  Executing SAP Grid Structural Discovering Only...                                                  %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%  Scanning technical IDs and active columns mapped in SAP GUI...                                     %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
cscript //nologo "%VBS%" --discover-columns --run-id=%RUNID%
set DISCOVERCODE=%ERRORLEVEL%
python "%PY%" --mode convert-reports --xlsx "%XLSX%" >nul 2>&1
if %DISCOVERCODE% NEQ 0 (
    echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
    echo %F_CYN%^|%E_RST%  %F_RED%[ERR] Discovery failed. Make sure ZSCH_UPDATE transaction results are active in SAP.%E_RST%         %F_CYN%^|%E_RST%
    echo %F_CYN%%BORDER_BOT%%E_RST%
    goto :FAIL
)
echo %F_CYN%^|%E_RST%                                                                                                 %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%  %F_GRN%[PASS] Discovery Complete. Technical columns profiled successfully.%E_RST%                       %F_CYN%^|%E_RST%
echo %F_CYN%^|%E_RST%         Report compiled in: %F_DIM%%REPORTXLSX%%E_RST% (Sheet: 'SAP Columns')                      %F_CYN%^|%E_RST%
echo %F_CYN%%BORDER_BOT%%E_RST%
echo.
goto :END

:: ---------------------------------------------------------------------------------
:: EXITS & FAILS
:: ---------------------------------------------------------------------------------
:FAIL_PIPELINE
echo %F_CYN%%BORDER_BOT%%E_RST%
:FAIL
echo.
echo %F_RED%[FAILED] Pipeline aborted due to a critical error. Inspect diagnostic log above.%E_RST%
echo.
echo Press any key to close the gateway.
pause >nul
endlocal
exit /b 1

:END
echo.
echo Press any key to disconnect and close this console.
pause >nul
endlocal
exit /b 0
