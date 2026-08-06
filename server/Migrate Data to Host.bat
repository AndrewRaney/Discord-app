@echo off
title Migrate Discord Lite data to Host folder

echo.
echo === Migrate accounts / messages to Host PC ===
echo Copies database.sqlite + uploads into:
echo   %APPDATA%\Discord Lite Host
echo.
echo STOP the host first (Stop Host.bat) before migrating.
echo.

set "DEST=%APPDATA%\Discord Lite Host"
set "SRC_DB="
set "SRC_UPLOADS="

if exist "%APPDATA%\Discord Lite\database.sqlite" (
  set "SRC_DB=%APPDATA%\Discord Lite\database.sqlite"
  set "SRC_UPLOADS=%APPDATA%\Discord Lite\uploads"
  echo Found: Discord Lite app data
) else if exist "%~dp0database.sqlite" (
  set "SRC_DB=%~dp0database.sqlite"
  set "SRC_UPLOADS=%~dp0uploads"
  echo Found: database next to this script
) else if exist "%~dp0..\database.sqlite" (
  set "SRC_DB=%~dp0..\database.sqlite"
  set "SRC_UPLOADS=%~dp0..\uploads"
  echo Found: database in parent folder
)

if not defined SRC_DB (
  echo No database.sqlite found.
  echo.
  echo Place database.sqlite next to this script, or run on the PC
  echo that already has Discord Lite installed ^(AppData^).
  pause
  exit /b 1
)

echo.
echo From: %SRC_DB%
echo To:   %DEST%\database.sqlite
echo.
set /p CONFIRM="Overwrite host data with this copy? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
  echo Cancelled.
  pause
  exit /b 0
)

if not exist "%DEST%" mkdir "%DEST%"
if not exist "%DEST%\uploads" mkdir "%DEST%\uploads"

copy /Y "%SRC_DB%" "%DEST%\database.sqlite" >nul
if errorlevel 1 (
  echo Failed to copy database.sqlite
  pause
  exit /b 1
)

if exist "%SRC_UPLOADS%\" (
  echo Copying uploads...
  xcopy /E /I /Y "%SRC_UPLOADS%\*" "%DEST%\uploads\" >nul
) else (
  echo No uploads folder — skipped.
)

echo.
echo Done. Run Start Host.bat
echo Friends sign in with their existing accounts on this host.
pause
