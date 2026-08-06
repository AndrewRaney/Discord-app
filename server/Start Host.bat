@echo off
cd /d "%~dp0"
title Discord Lite Host

echo.
echo === Discord Lite Host ===
echo Runs the chat server only (no Electron window).
echo Leave this window open while friends are playing.
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
  echo ERROR: server.js not found. Run this from the Discord Lite server folder.
  pause
  exit /b 1
)

set "DISCORD_LITE_DATA=%APPDATA%\Discord Lite Host"
if not exist "%DISCORD_LITE_DATA%" mkdir "%DISCORD_LITE_DATA%"

echo Data folder: %DISCORD_LITE_DATA%
echo Starting server on port 3001...
echo When the public tunnel is ready, see:
echo   Desktop\Discord-Lite-Host-URL.txt
echo.

node server.js
echo.
echo Host stopped.
pause
