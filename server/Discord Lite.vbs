' Discord Lite — silent launcher (no console window)
Option Explicit
Dim sh, dir, electron, appDir
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
electron = dir & "\node_modules\electron\dist\electron.exe"
appDir = dir
If Not CreateObject("Scripting.FileSystemObject").FileExists(electron) Then
  sh.Run "cmd /c cd /d """ & dir & """ && npm install", 1, True
End If
sh.CurrentDirectory = dir
sh.Run """" & electron & """ """ & appDir & """", 1, False
