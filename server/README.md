# Iris — Setup Guide

## For you (development)
1. First time: double-click `setup.bat`
2. Double-click **Iris** on your Desktop (or `Iris.vbs`)

## Send to friends (with auto-updates)
1. Double-click `Publish Update.bat` after you change the app
2. Friends install **`Iris-Setup-….exe` once**
3. Later publishes update their app automatically on launch

Portable `.exe` is quick to try, but does **not** auto-update. Use the Setup installer for friends.

## Always-on host (recommended — friendâ€™s second PC)
See **[How to Host.txt](./How%20to%20Host.txt)**.

Short version:
1. Download **`Iris-Host-….zip`** from [Releases](https://github.com/AndrewRaney/Discord-app/releases/latest)
2. Unzip → install Node.js → run **`Start Host.bat`**
3. Optionally **`Install Host Autostart.bat`**
4. Share **`Desktop\Iris-Host-URL.txt`**
5. To keep old accounts/messages: **`Migrate Data to Host.bat`**
6. Clients paste that URL as Server address

`Publish Update.bat` builds the Setup installer, Portable, and Host zip together.

## Temporary host from the Iris app
1. Host leaves Server address blank and signs in
2. Host: Settings → Connection → copy **Public tunnel** link
3. Friends paste that link in Server address → Create Account  
   (Host must keep the app open.)

## Repo
https://github.com/AndrewRaney/Discord-app
