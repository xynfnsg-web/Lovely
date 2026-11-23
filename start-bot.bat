@echo off
cd /d "%~dp0\bots\community-bot"
echo ====================================================
echo Starting Discord Community Bot (lovelyshell)...
echo ====================================================
node --dns-result-order=ipv4first src\index.js
pause
