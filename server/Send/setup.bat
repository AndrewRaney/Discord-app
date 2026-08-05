@echo off
cd /d "%~dp0"
echo Installing dependencies...
npm install
echo Done! You can now run server.bat to start the app.
pause
