@echo off
cd /d "%~dp0"
title Building Discord Lite share package

echo.
echo === Discord Lite — Build share package ===
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not on PATH.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)

echo.
echo Building portable exe (this can take a few minutes)...
call npx electron-builder --win portable
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

REM Restore sqlite3 for local Node so your Desktop shortcut still works
echo Restoring local sqlite3 bindings...
call npm rebuild sqlite3 >nul 2>&1

if not exist "Share" mkdir Share
copy /Y "dist\Discord-Lite-Portable.exe" "Share\Discord-Lite-Portable.exe" >nul
copy /Y "dist\Discord-Lite-Portable.exe" "%USERPROFILE%\Desktop\Discord-Lite-Portable.exe" >nul 2>&1
copy /Y "dist\Discord-Lite-Portable.exe" "D:\Andrew\Desktop\Discord-Lite-Portable.exe" >nul 2>&1

(
  echo Discord Lite
  echo.
  echo How to use:
  echo 1. Double-click Discord-Lite-Portable.exe
  echo 2. Create an account and chat
  echo.
  echo Notes:
  echo - No install needed. Friends do NOT need Node.js.
  echo - Each person who runs this has their OWN local server/data.
) > "Share\README.txt"

echo.
echo Done! Send this file to people:
echo   %~dp0Share\Discord-Lite-Portable.exe
echo.
explorer "%~dp0Share"
pause
