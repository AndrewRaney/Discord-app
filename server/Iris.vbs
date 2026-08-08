' Iris — starts local server + app window (no console)
Option Explicit
Dim sh, fso, dir, electron
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
electron = dir & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(electron) Then
  sh.Run "cmd /c cd /d """ & dir & """ && npm install", 1, True
End If

sh.CurrentDirectory = dir
sh.Environment("Process")("DISCORD_LITE_FORCE_LOCAL") = "1"
sh.Environment("Process").Remove("DISCORD_LITE_HOST_MODE")
sh.Run """" & electron & """ """ & dir & """ --local", 1, False
