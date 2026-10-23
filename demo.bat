@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Laundry System - DEMO
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
echo.
echo DEMO mode: sample data is stored in the data-demo folder (your real data is not touched).
echo Manager: admin / admin123    Clerk: xiaoli / 123456
echo.
set OPEN_BROWSER=1
call npm run demo
pause
