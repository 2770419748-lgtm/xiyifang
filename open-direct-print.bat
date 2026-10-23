@echo off
rem Open the laundry system in "direct print" mode: labels go straight to the
rem Windows default printer, without the print preview dialog (--kiosk-printing).
rem A separate browser profile is used, so it works even if Edge/Chrome is already open.
rem Start the system first (start.bat), then double-click this file.
setlocal
set "URL=http://localhost:3000"
set "PROFILE=%LOCALAPPDATA%\LaundrySystemBrowser"

set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" goto notfound

start "" "%BROWSER%" --kiosk-printing --no-first-run --user-data-dir="%PROFILE%" "%URL%"
exit /b 0

:notfound
echo [!] Microsoft Edge or Google Chrome not found. Please install one of them.
pause
exit /b 1
