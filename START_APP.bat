@echo off
setlocal
cd /d "%~dp0"
title Voice Banking Assistant

echo ==============================================
echo   Voice Banking Assistant - ECAPA Launcher
echo ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not in PATH.
  echo Install Node.js 18 or newer, then reopen this file.
  pause
  exit /b 1
)

if not exist "node_modules\express\package.json" (
  echo Installing Node.js dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed. Check your internet connection.
    pause
    exit /b 1
  )
)

REM First-run setup: create the Python environment automatically if it is missing.
if not exist "ml\.venv\Scripts\python.exe" (
  echo First run detected: setting up ECAPA Python environment.
  echo This needs internet and may take several minutes. Keep this window open.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\ml\setup_windows.ps1"
  if errorlevel 1 (
    echo.
    echo ERROR: Python setup failed. Check the error above and ensure Python 3.10-3.12 and internet are available.
    pause
    exit /b 1
  )
)

REM Start ECAPA service only with the configured Python environment.
if exist "ml\.venv\Scripts\python.exe" (
  echo Starting ECAPA-TDNN speaker verification service...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\ml\start_speaker_service.ps1"
  if errorlevel 1 (
    echo.
    echo ERROR: ECAPA service or model did not become ready. See the message above and logs\speaker_service.err.log
    echo If setup has not completed, run: powershell -ExecutionPolicy Bypass -File .\ml\setup_windows.ps1
    echo The app will NOT silently switch to weak MFCC verification.
    pause
    exit /b 1
  )
  set "SPEAKER_SERVICE_URL=http://127.0.0.1:5005"
) else (
  echo ERROR: ECAPA Python environment not found at ml\.venv\Scripts\python.exe
  echo Run .\ml\setup_windows.ps1 in PowerShell first.
  pause
  exit /b 1
)

REM Stop only the process currently listening on port 3000 so stale code cannot run.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
  if not "%%P"=="0" (
    echo Stopping existing process on port 3000: PID %%P
    taskkill /F /PID %%P >nul 2>nul
  )
)

echo.
echo Starting app with ECAPA-TDNN speaker verification.
echo IMPORTANT: Re-enroll your voice profile once after this update.
echo Open http://localhost:3000 in your browser.
echo Keep this window and the speaker-service window open.
echo.
start "" http://localhost:3000
set "STT_SERVICE_URL="
call npm start

REM Stop the speaker service only if this launcher started it (PID file written by start_speaker_service.ps1).
if exist "logs\speaker_service.pid" (
  powershell -NoProfile -Command "$p=[int](Get-Content 'logs\speaker_service.pid'); Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Remove-Item 'logs\speaker_service.pid' -ErrorAction SilentlyContinue"
)

echo.
echo The server has stopped. If there was an error above, take a screenshot.
pause
