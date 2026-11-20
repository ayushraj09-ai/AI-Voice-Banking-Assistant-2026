@echo off
setlocal
cd /d "%~dp0"
REM Builds the report from a scores_*.json made by ml\eval\make_scores.py (Colab notebook). No speaker service or model needed.
REM Drag a JSON file onto this .bat, or:  REPORT_FROM_SCORES.bat scores_public.json [--threshold 0.5]
if "%~1"=="" (
  echo Drag a scores_*.json file onto this file, or run: REPORT_FROM_SCORES.bat path\scores_public.json [--threshold 0.5]
  pause
  exit /b 1
)
node scripts\make_report.js --scores "%~1" %2 %3
if errorlevel 1 (
  echo Failed - see the message above.
  pause
  exit /b 1
)
for %%F in ("%~1") do start "" "%CD%\reports\security_report_%%~nF.html"
echo.
echo Report opened in your browser. Files are in the reports folder.
pause
