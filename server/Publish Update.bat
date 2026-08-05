@echo off
cd /d "%~dp0"
title Publish Discord Lite update

echo.
echo === Publish Discord Lite update to GitHub ===
echo Friends on the installer get this automatically.
echo.

where node >nul 2>&1 || (echo Need Node.js & pause & exit /b 1)
where gh >nul 2>&1 || (echo Need GitHub CLI ^(gh^) & pause & exit /b 1)

echo Building installer + portable...
call npx electron-builder --win nsis portable
if errorlevel 1 ( echo Build failed & pause & exit /b 1 )

for /f "tokens=*" %%v in ('node -p "require('./package.json').version"') do set VER=%%v
set SETUP=dist\Discord-Lite-Setup-%VER%.exe
set PORTABLE=dist\Discord-Lite-Portable-%VER%.exe

if not exist "%SETUP%" (
  echo Missing %SETUP%
  pause
  exit /b 1
)

echo.
echo Creating GitHub release v%VER% ...
gh release create "v%VER%" "%SETUP%" "%PORTABLE%" --title "Discord Lite v%VER%" --notes "Auto-update release. Install Discord-Lite-Setup once; later updates install themselves." --repo AndrewRaney/Discord-app
if errorlevel 1 (
  echo Release may already exist — uploading assets...
  gh release upload "v%VER%" "%SETUP%" "%PORTABLE%" --clobber --repo AndrewRaney/Discord-app
)

if not exist "Share" mkdir Share
copy /Y "%SETUP%" "Share\" >nul
copy /Y "%PORTABLE%" "Share\" >nul
copy /Y "%SETUP%" "D:\Andrew\Desktop\" >nul 2>&1
copy /Y "%PORTABLE%" "D:\Andrew\Desktop\" >nul 2>&1

echo.
echo Done.
echo Send friends: %SETUP%
echo ^(Portable does NOT auto-update — use the Setup installer for that.^)
echo.
explorer "%~dp0Share"
pause
