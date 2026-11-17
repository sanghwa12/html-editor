$ErrorActionPreference = 'Stop'
$editorRoot = $PSScriptRoot
$icon = Join-Path $editorRoot 'assets\html-editor-cat.ico'
$launcher = Join-Path $editorRoot 'Launch-Editor.vbs'
if (!(Test-Path -LiteralPath $icon) -or !(Test-Path -LiteralPath $launcher)) { throw 'Editor launcher or icon is missing.' }
$desktop = [Environment]::GetFolderPath('Desktop')
$name = 'HTML ' + [char]0xD3B8 + [char]0xC9D1 + [char]0xAE30 + '.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $desktop $name))
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + $launcher + '"'
$shortcut.WorkingDirectory = $editorRoot
$shortcut.IconLocation = $icon + ',0'
$shortcut.Description = 'HTML editor with live preview'
$shortcut.Save()
Write-Output (Join-Path $desktop $name)
