@echo off
cd /d "%~dp0"
title Publish Iris update

echo.
echo === Publish Iris update to GitHub ===
echo Friends on the installer get this automatically.
echo Host pack zip is for the always-on second PC.
echo.
for /f "tokens=*" %%v in ('node -p "require('./package.json').version"') do set VER=%%v
echo Publishing version: v%VER%
echo If this version already exists on GitHub, bump package.json first.
echo.

where node >nul 2>&1 || (echo Need Node.js & pause & exit /b 1)
where gh >nul 2>&1 || (echo Need GitHub CLI ^(gh^) & pause & exit /b 1)

echo Building installer + portable...
call npx electron-builder --win nsis portable
if errorlevel 1 ( echo Build failed & pause & exit /b 1 )

echo Building host pack zip...
call "%~dp0Build Host Pack.bat" nopause
if errorlevel 1 ( echo Host pack failed & pause & exit /b 1 )

for /f "tokens=*" %%v in ('node -p "require('./package.json').version"') do set VER=%%v
set SETUP=dist\Iris-Setup-%VER%.exe
set PORTABLE=dist\Iris-Portable-%VER%.exe
set HOSTPACK=dist\Iris-Host-%VER%.zip

if not exist "%SETUP%" (
  echo Missing %SETUP%
  pause
  exit /b 1
)
if not exist "%HOSTPACK%" (
  echo Missing %HOSTPACK%
  pause
  exit /b 1
)

echo.
echo Creating GitHub release v%VER% ...
gh release create "v%VER%" "%SETUP%" "%PORTABLE%" "%HOSTPACK%" --title "Iris v%VER%" --notes "Setup = clients (auto-update). Host zip = always-on second PC (see How to Host.txt inside)." --repo AndrewRaney/Discord-app
if errorlevel 1 (
  echo Release may already exist — uploading assets...
  gh release upload "v%VER%" "%SETUP%" "%PORTABLE%" "%HOSTPACK%" --clobber --repo AndrewRaney/Discord-app
)

if not exist "Share" mkdir Share
copy /Y "%SETUP%" "Share\" >nul
copy /Y "%PORTABLE%" "Share\" >nul
copy /Y "%HOSTPACK%" "Share\" >nul
copy /Y "%SETUP%" "D:\Andrew\Desktop\" >nul 2>&1
copy /Y "%PORTABLE%" "D:\Andrew\Desktop\" >nul 2>&1
copy /Y "%HOSTPACK%" "D:\Andrew\Desktop\" >nul 2>&1

echo.
echo Done.
echo Clients:  %SETUP%
echo Host PC:  %HOSTPACK%
echo ^(Portable does NOT auto-update — use the Setup installer for that.^)
echo.
explorer "%~dp0Share"
pause
