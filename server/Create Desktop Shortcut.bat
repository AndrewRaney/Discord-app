@echo off
cd /d "%~dp0"
powershell -NoProfile -Command ^
  "$desktop = [Environment]::GetFolderPath('Desktop');" ^
  "$target = Join-Path '%~dp0' 'Iris.vbs';" ^
  "$shortcutPath = Join-Path $desktop 'Iris.lnk';" ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$sc = $ws.CreateShortcut($shortcutPath);" ^
  "$sc.TargetPath = 'wscript.exe';" ^
  "$sc.Arguments = '\"' + $target + '\"';" ^
  "$sc.WorkingDirectory = '%~dp0';" ^
  "$sc.WindowStyle = 1;" ^
  "$sc.Description = 'Start Iris server + app';" ^
  "$sc.Save()"
echo.
echo Desktop shortcut created: Iris.lnk
echo Double-click it to start the server and open the app.
echo.
pause
