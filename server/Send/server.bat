@echo off
cd /d "%~dp0.."
echo.
echo ========================================
echo  STOP — the Send folder is disabled.
echo  It caused wrong-database / missing UI.
echo ========================================
echo.
echo Use this folder instead:
echo   %CD%
echo.
echo Start host:   Start Host.bat
echo Start app:    Iris.bat
echo.
pause
if exist "Start Host.bat" (
  echo Launching Start Host.bat ...
  call "Start Host.bat"
)
