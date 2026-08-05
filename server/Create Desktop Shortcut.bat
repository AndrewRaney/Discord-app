@echo off
cd /d "%~dp0"
set "DESKTOP=%USERPROFILE%\Desktop"
if exist "%USERPROFILE%\OneDrive\Desktop" set "DESKTOP=%USERPROFILE%\OneDrive\Desktop"
if exist "D:\Andrew\Desktop" set "DESKTOP=D:\Andrew\Desktop"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$desktop = $env:DESKTOP; if (-not $desktop) { $desktop = [Environment]::GetFolderPath('Desktop') };" ^
  "$target = Join-Path '%~dp0' 'Discord Lite.vbs';" ^
  "$shortcutPath = Join-Path $desktop 'Discord Lite.lnk';" ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$sc = $ws.CreateShortcut($shortcutPath);" ^
  "$sc.TargetPath = 'wscript.exe';" ^
  "$sc.Arguments = '\"' + $target + '\"';" ^
  "$sc.WorkingDirectory = '%~dp0';" ^
  "$sc.WindowStyle = 1;" ^
  "$sc.Description = 'Open Discord Lite';" ^
  "$icon = Join-Path '%~dp0' 'node_modules\electron\dist\electron.exe';" ^
  "if (Test-Path $icon) { $sc.IconLocation = $icon + ',0' };" ^
  "$sc.Save();" ^
  "Write-Host ('Shortcut created: ' + $shortcutPath)"

echo.
echo Done. Look for "Discord Lite" on your Desktop.
pause
