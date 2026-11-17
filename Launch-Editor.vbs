Option Explicit
Dim shell, files, root, node, quote, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
quote = Chr(34)
node = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not files.FileExists(node) Then node = "node.exe"
result = shell.Run(quote & node & quote & " " & quote & root & "\desktop-launcher.mjs" & quote, 0, True)
If result <> 0 Then MsgBox "HTML Editor could not start. Please check desktop-launcher.log in the installation folder.", 48, "HTML Editor"
