@echo off
setlocal
rem ============================================================
rem  Update data\worlds.csv and push to GitHub
rem  Usage A: drag & drop the exported CSV onto this file
rem  Usage B: double-click -> uses the newest *.csv in this folder
rem ============================================================
cd /d "%~dp0"

set "SRC=%~1"
if not "%SRC%"=="" goto :confirm

for /f "delims=" %%F in ('dir /b /o-d /a-d "*.csv" 2^>nul') do (
  set "SRC=%~dp0%%F"
  goto :confirm
)
echo [ERROR] No CSV found. Drag and drop the exported CSV onto this file,
echo         or put it in this folder and double-click again.
pause & exit /b 1

:confirm
echo.
echo   CSV : %SRC%
echo.
choice /m "Update data\worlds.csv with this file and push to GitHub"
if errorlevel 2 exit /b 0

rem -- pull first: GitHub Actions also commits to main --
git pull --rebase origin main
if errorlevel 1 goto :err

copy /y "%SRC%" "data\worlds.csv" >nul
if errorlevel 1 goto :err

rem -- encoding check (skipped if Node is not installed) --
where node >nul 2>nul
if errorlevel 1 goto :stage
node -e "const t=require('fs').readFileSync('data/worlds.csv','utf8');const h=String.fromCharCode(0x30ef,0x30fc,0x30eb,0x30c9,0x540d);process.exit(t.includes(h)?0:1)"
if errorlevel 1 (
  echo [ERROR] Header check failed. Export the CSV as UTF-8
  echo         ^(Google Sheets download, or Excel: "CSV UTF-8"^).
  git checkout -- data/worlds.csv
  goto :err
)

:stage
git add data/worlds.csv
git diff --cached --quiet
if not errorlevel 1 (
  echo No changes in worlds.csv. Nothing to push.
  pause & exit /b 0
)
git commit -m "update worlds.csv"
if errorlevel 1 goto :err
git push origin main
if errorlevel 1 goto :err

echo.
echo [OK] Pushed! GitHub Actions will rebuild and deploy the site
echo      in a few minutes.
pause & exit /b 0

:err
echo.
echo [ERROR] Failed. See the messages above.
pause & exit /b 1
