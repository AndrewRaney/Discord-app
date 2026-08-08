@echo off
cd /d "%~dp0"
REM Legacy launcher â€” now one process. Prefer "Iris.vbs" or the Desktop shortcut.
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies...
  call npm install
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
