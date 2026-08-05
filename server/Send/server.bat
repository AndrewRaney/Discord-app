@echo off
cd /d "%~dp0"
start cmd /k "cd /d "%~dp0" && node server.js"
timeout /t 2
start cmd /k "cd /d "%~dp0" && npx electron ."