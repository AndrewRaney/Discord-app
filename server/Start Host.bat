@echo off
cd /d "%~dp0"
title Iris Host

echo.
echo === Iris Host ===
echo Runs the chat server only (tray icon when Electron is available).
echo Leave this running while friends are playing.
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not on PATH.
  echo Install LTS from https://nodejs.org then try again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies ^(first run^)...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

if not exist "server.js" (
  echo ERROR: server.js not found. Run this from the Iris server folder.
  pause
  exit /b 1
)

set "DISCORD_LITE_DATA=%APPDATA%\Discord Lite Host"
if not exist "%DISCORD_LITE_DATA%" mkdir "%DISCORD_LITE_DATA%"
set "DISCORD_LITE_HOST_MODE=1"

echo Data folder: %DISCORD_LITE_DATA%
echo Starting host on port 3001...
echo When the public tunnel is ready, see:
echo   Desktop\Iris-Host-URL.txt
echo.

if exist "node_modules\electron\cli.js" (
  echo Tray: look for "Iris Host — running" in the system tray.
  echo.
  call npx --yes electron . --host
) else (
  echo Electron not found — running console host ^(no tray^).
  echo.
  node server.js
)

echo.
echo Host stopped.
pause
