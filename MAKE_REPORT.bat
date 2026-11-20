@echo off
setlocal
cd /d "%~dp0"
REM One click: starts/reuses the ECAPA service, builds the security report and opens it.
REM   MAKE_REPORT.bat          -> your own 18 recordings
REM   MAKE_REPORT.bat public   -> LibriSpeech set (downloads ~126 MB the first time)
set "SPEAKER_SERVICE_URL=http://127.0.0.1:5005"
echo Checking / starting the ECAPA speaker service...
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\ml\start_speaker_service.ps1"
if errorlevel 1 (
  echo.
  echo The speaker service is not ready - see the message above. Run START_APP.bat once, then try again.
  pause
  exit /b 1
)
if /i "%~1"=="public" (
  if not exist "data\public_samples\SOURCE.txt" (
    echo.
    echo Downloading and preparing the LibriSpeech dev-clean-2 set ^(~126 MB, needs internet, a few minutes^)...
    "%CD%\ml\.venv\Scripts\python.exe" ml\eval\prepare_public_dataset.py
    if errorlevel 1 goto :failed
  )
  node scripts\make_report.js --dir data\public_samples
  if errorlevel 1 goto :failed
  start "" "%CD%\reports\security_report_public.html"
) else (
  node scripts\make_report.js
  if errorlevel 1 goto :failed
  start "" "%CD%\reports\security_report.html"
)
echo.
echo Report opened in your browser. Files are in the reports folder.
pause
exit /b 0
:failed
echo.
echo Failed - see the message above.
pause
exit /b 1
