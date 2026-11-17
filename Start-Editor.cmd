@echo off
setlocal
set "target=%~1"
if not defined target set /p "target=HTML file or folder (paste path): "
set "target=%target:"=%"
if not defined target exit /b 1
node "%~dp0server.mjs" "%target%"
if errorlevel 1 pause
