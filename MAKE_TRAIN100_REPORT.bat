@echo off
setlocal
cd /d "%~dp0"
REM One click for the LibriSpeech train-clean-100 test.
REM Uses the folder you already extracted (nothing to copy or paste). Another folder: MAKE_TRAIN100_REPORT.bat "D:\path\LibriSpeech"
set "DS=C:\Users\DELL\Downloads\train-clean-100\LibriSpeech"
if not "%~1"=="" set "DS=%~1"
if not exist "%CD%\ml\.venv\Scripts\python.exe" (
  echo ERROR: ml\.venv not found in this folder: %CD%
  echo Run this file from the project folder that has ml\.venv ^(for you: C:\Users\DELL\Desktop\voice-banking-assistant^).
  pause
  exit /b 1
)
if not exist "%DS%" (
  echo ERROR: dataset folder not found: %DS%
  echo Pass the right path:  MAKE_TRAIN100_REPORT.bat "C:\path\to\LibriSpeech"
  pause
  exit /b 1
)
echo Step 1/2: preparing 60 speakers from %DS% ^(10-20 minutes, do not close this window^)...
"%CD%\ml\.venv\Scripts\python.exe" ml\eval\prepare_public_dataset.py --set train-clean-100 --folder "%DS%" --speakers 60
if errorlevel 1 (
  echo.
  echo Dataset preparation failed - see the message above.
  pause
  exit /b 1
)
echo.
echo Step 2/2: building the report ^(starts the ECAPA service, a few minutes^)...
call "%CD%\MAKE_REPORT.bat" public
