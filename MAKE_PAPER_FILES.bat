@echo off
setlocal
cd /d "%~dp0"
REM One click: scores + paper files (CSV, LaTeX tables, PDF/PNG graphs, confidence intervals, dev/test split).
REM   MAKE_PAPER_FILES.bat          -> LibriSpeech set in data\public_samples (run MAKE_TRAIN100_REPORT.bat once first)
REM   MAKE_PAPER_FILES.bat own      -> your own 18 recordings (only 6 people: indicative only)
set "PY=%CD%\ml\.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo ERROR: ml\.venv not found in %CD%. Run this from the project folder that has ml\.venv.
  pause
  exit /b 1
)
if /i "%~1"=="own" (
  set "SRC=--own samples\own_18"
  set "NAME=own"
) else (
  if not exist "data\public_samples" (
    echo ERROR: data\public_samples not found. Run MAKE_TRAIN100_REPORT.bat first.
    pause
    exit /b 1
  )
  set "SRC=--dir data\public_samples"
  set "NAME=public"
)
echo Step 1/2: computing scores with the ECAPA model ^(several minutes on CPU^)...
"%PY%" ml\eval\make_scores.py %SRC% --out reports\scores_%NAME%.json
if errorlevel 1 goto :failed
echo.
echo Step 2/2: building the paper files...
"%PY%" ml\eval\paper_export.py --scores reports\scores_%NAME%.json --out paper\%NAME% --seed 1
if errorlevel 1 goto :failed
start "" explorer "%CD%\paper\%NAME%"
echo.
echo Done. Files are in paper\%NAME%
pause
exit /b 0
:failed
echo.
echo Failed - see the message above.
pause
exit /b 1
