@echo off
cd /d "%~dp0"
title Iris

echo.
echo === Iris ===
echo Starts the chat server + opens the app.
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not on PATH.
  echo Install LTS from https://nodejs.org then try again.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies ^(first run^)...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

set "DISCORD_LITE_FORCE_LOCAL=1"
set "DISCORD_LITE_HOST_MODE="

echo Starting server on port 3001 and opening Iris...
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0." --local
