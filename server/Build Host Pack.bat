@echo off
cd /d "%~dp0"
title Build Iris Host Pack

echo.
echo === Build Host Pack zip ===
echo For the always-on second PC ^(no git clone needed^).
echo.

for /f "tokens=*" %%v in ('node -p "require('./package.json').version"') do set VER=%%v
if "%VER%"=="" set VER=dev

set "STAGE=%TEMP%\Iris-Host-%VER%"
set "ZIP=dist\Iris-Host-%VER%.zip"

if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%" 2>nul
if not exist "dist" mkdir "dist"

echo Staging files...
copy /Y "server.js" "%STAGE%\" >nul
copy /Y "package.json" "%STAGE%\" >nul
if exist "package-lock.json" copy /Y "package-lock.json" "%STAGE%\" >nul
copy /Y "index.html" "%STAGE%\" >nul
copy /Y "How to Host.txt" "%STAGE%\" >nul
copy /Y "Start Host.bat" "%STAGE%\" >nul
copy /Y "Stop Host.bat" "%STAGE%\" >nul
copy /Y "Install Host Autostart.bat" "%STAGE%\" >nul
copy /Y "Migrate Data to Host.bat" "%STAGE%\" >nul
if exist "README.md" copy /Y "README.md" "%STAGE%\" >nul

echo Creating %ZIP% ...
if exist "%ZIP%" del /f /q "%ZIP%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%ZIP%' -Force"
if errorlevel 1 (
  echo Zip failed.
  rmdir /s /q "%STAGE%" 2>nul
  exit /b 1
)

rmdir /s /q "%STAGE%" 2>nul

if not exist "Share" mkdir "Share"
copy /Y "%ZIP%" "Share\" >nul

echo.
echo Built: %ZIP%
echo Friend: unzip → install Node.js → Start Host.bat
echo.
if /i not "%~1"=="nopause" pause
exit /b 0
