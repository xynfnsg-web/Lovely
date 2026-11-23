@echo off
cd /d "%~dp0"
echo ====================================================
echo Starting Lovelyshell Web Service + Discord Bot...
echo ====================================================
set PORT=22433
echo Web URL: http://localhost:22433/
echo Health Check: http://localhost:22433/healthz
echo.
node bots\community-bot\production-host.js
pause
