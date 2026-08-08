@echo off
title Stop Iris Host

echo.
echo === Stop Iris Host ===
echo Killing whatever is listening on port 3001...
echo.

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
  echo Killing PID %%p
  taskkill /F /PID %%p >nul 2>&1
)

echo Done. You can close any leftover Host console windows.
pause
