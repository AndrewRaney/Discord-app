@echo off
cd /d "%~dp0"
REM Single-click launcher: starts backend + Electron in one process (no extra consoles)
if not exist "node_modules\electron" (
  echo Installing dependencies first...
  call npm install
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
