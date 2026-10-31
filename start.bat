@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Laundry System
rem When the system has moved to a cloud server (server-url.txt exists), do not start a local copy:
rem just open the server in the direct-print window, so the shop never ends up with two sets of data.
if exist "server-url.txt" (
  echo The laundry system now runs on the server. Opening it in the browser...
  call "%~dp0open-direct-print.bat"
  exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js not found. Please install Node.js 22 LTS: https://nodejs.org/zh-cn
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo [!] Node.js is too old. Please install Node.js 22 LTS or newer: https://nodejs.org/zh-cn
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies, please wait...
  call npm install --registry=https://registry.npmmirror.com
)
rem Open the browser window for direct printing (no print preview) once the system is up
set OPEN_BROWSER=1
call npm start
pause
