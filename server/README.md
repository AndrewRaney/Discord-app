# Discord Lite — Setup Guide

## For you (development)
1. First time: double-click `setup.bat`
2. Double-click **Discord Lite** on your Desktop (or `Discord Lite.vbs`)

## Send to friends (with auto-updates)
1. Double-click `Publish Update.bat` after you change the app
2. Friends install **`Discord-Lite-Setup-….exe` once**
3. Later publishes update their app automatically on launch

Portable `.exe` is quick to try, but does **not** auto-update. Use the Setup installer for friends.

## Always-on host (recommended — friend’s second PC)
See **[How to Host.txt](./How%20to%20Host.txt)**.

Short version:
1. On the always-on PC: install Node.js → `npm install` in `server` → run **`Start Host.bat`**
2. Optionally run **`Install Host Autostart.bat`**
3. Share **`Desktop\Discord-Lite-Host-URL.txt`** with everyone
4. Clients paste that URL as Server address (their app skips starting a local server)

## Temporary host from the Discord Lite app
1. Host leaves Server address blank and signs in
2. Host: Settings → Connection → copy **Public tunnel** link
3. Friends paste that link in Server address → Create Account  
   (Host must keep the app open.)

## Repo
https://github.com/AndrewRaney/Discord-app
