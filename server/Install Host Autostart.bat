@echo off
cd /d "%~dp0"
title Install Discord Lite Host Autostart

echo.
echo === Install Host Autostart ===
echo Creates a Startup shortcut so the host starts when you log in.
echo.

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET=%~dp0Start Host.bat"
set "LINK=%STARTUP%\Discord Lite Host.lnk"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%LINK%'); $s.TargetPath = '%TARGET%'; $s.WorkingDirectory = '%~dp0'; $s.WindowStyle = 1; $s.Description = 'Discord Lite always-on host'; $s.Save()"

if errorlevel 1 (
  echo Failed to create Startup shortcut.
  pause
  exit /b 1
)

echo Created: %LINK%
echo.
echo The host will start at login. Keep the second PC awake ^(never sleep^).
echo To remove autostart, delete that shortcut from the Startup folder.
echo.
pause
